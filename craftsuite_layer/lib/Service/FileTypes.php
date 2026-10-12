<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Service;

use OCA\CraftsuiteLayer\AppInfo\Application;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\Files\IMimeTypeDetector;
use OCP\Files\IMimeTypeLoader;
use OCP\IAppConfig;
use OCP\IDBConnection;
use OCP\Lock\ILockingProvider;
use Psr\Log\LoggerInterface;

/**
 * The file types behind the Craft apps' icons in Files (MimeIcons, docs/nextcloud-app.md).
 *
 * Nextcloud picks a file's icon by its MIME type, which it stores when it scans or writes the file,
 * from the extension. For extensions it does not know (.pcraft, .vectorcraft, .dxf, ...) that is
 * application/octet-stream, so those files cannot get an icon of their own. This app therefore
 * adds MIME types for them to Nextcloud's config/mimetypemapping.json, as Nextcloud's Maps app
 * does for its types, and, for the new application/* types, the plain file icon as their alias in
 * config/mimetypealiases.json: everyone who gets no Craft icon sees them as before. It adds only
 * keys that nothing else defines (except eps, see MAPPINGS), notes in its own configuration what
 * it added, and takes back what is still unchanged when the app is disabled (the uninstall repair
 * step, which Nextcloud runs on every disable). Both files are kept across server updates.
 *
 * Files that exist already get the new type in one pass over the file cache; on disable they get
 * back the type Nextcloud would give them without these entries.
 */
class FileTypes {
	/**
	 * Extension => [MIME type, the type to send instead for downloads or null]: the extensions a
	 * Craft app opens that Nextcloud 34 and 35 store as application/octet-stream, typed as the
	 * apps' own packaging or the registries (IANA, freedesktop.org) name them. Camera raws join
	 * image/x-dcraw like the raws Nextcloud knows, so Memories and raw previews treat them alike.
	 * eps is the one type Nextcloud has: it shares application/postscript with .ps, which no Craft
	 * app opens, so .eps gets freedesktop.org's own image/x-eps. .dotm (WordCraft) gets its Office
	 * type, which Nextcloud already shows with its document icon.
	 */
	public const MAPPINGS = [
		'psb' => ['application/x-photoshop', null],
		'pcraft' => ['application/x-photocraft', null],
		'vectorcraft' => ['application/x-vectorcraft', null],
		'drawcraft' => ['application/x-vectorcraft', null],
		'eps' => ['image/x-eps', null],
		// Gzip'd SVG: never served as an image the browser would render.
		'svgz' => ['image/svg+xml-compressed', 'application/octet-stream'],
		'wmf' => ['image/wmf', null],
		'dxf' => ['image/vnd.dxf', null],
		'designcraft' => ['application/vnd.designcraft+zip', null],
		'idml' => ['application/vnd.adobe.indesign-idml-package', null],
		'deckcraft' => ['application/x-deckcraft', null],
		'cr3' => ['image/x-dcraw', null],
		'nrw' => ['image/x-dcraw', null],
		'rwl' => ['image/x-dcraw', null],
		'srw' => ['image/x-dcraw', null],
		'fcproj' => ['application/x-filmcraft', null],
		'ecproj' => ['application/x-effectcraft', null],
		'dotm' => ['application/vnd.ms-word.template.macroEnabled.12', null],
	];

	/**
	 * The icon of each new application/* type for everyone who gets no Craft icon: Nextcloud's
	 * plain file icon, as before (without an alias Nextcloud would show its cog for application/*).
	 * The new image/* types fall back to Nextcloud's image icon by themselves.
	 */
	public const ALIASES = [
		'application/x-photocraft' => 'file',
		'application/x-vectorcraft' => 'file',
		'application/vnd.designcraft+zip' => 'file',
		'application/vnd.adobe.indesign-idml-package' => 'file',
		'application/x-deckcraft' => 'file',
		'application/x-filmcraft' => 'file',
		'application/x-effectcraft' => 'file',
	];

	/** Where this app notes the entries it added (JSON: {"mappings": {...}, "aliases": {...}}). */
	public const KEY = 'file_types';
	private const LOCK = 'craftsuite_layer/mimetype-config';

	public function __construct(
		private IMimeTypeDetector $detector,
		private IMimeTypeLoader $loader,
		private IDBConnection $db,
		private IAppConfig $appConfig,
		private ILockingProvider $locking,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Adds the mappings and aliases nothing else defines, keeps those added before, and gives
	 * existing files the new types. Runs on every enable and app update (repair steps).
	 *
	 * @return string what was done, for the repair step's output
	 */
	public function register(): string {
		return $this->locked(fn () => $this->registerLocked())
			?? 'The MIME type configuration is locked by another run (see the log): the Craft file types are not registered.';
	}

	private function registerLocked(): string {
		$owned = $this->owned();
		$mappings = $this->detector->getAllMappings();
		$aliases = $this->detector->getAllAliases();
		$wantMappings = [];
		foreach (self::MAPPINGS as $ext => $value) {
			$current = $mappings[$ext] ?? null;
			$ours = isset($owned['mappings'][$ext]) && self::sameMapping($current, $owned['mappings'][$ext]);
			if ($current === null || $ours || ($ext === 'eps' && ($current[0] ?? null) === 'application/postscript')) {
				$wantMappings[$ext] = $value;
			}
		}
		$wantAliases = [];
		foreach (self::ALIASES as $type => $alias) {
			$current = $aliases[$type] ?? null;
			if ($current === null || ($owned['aliases'][$type] ?? null) === $current) {
				$wantAliases[$type] = $alias;
			}
		}
		[$now, $ok] = $this->write($owned, $wantMappings, $wantAliases);
		$this->setOwned($now);
		$types = array_map(fn (array $value) => $value[0], $now['mappings']);
		$changed = $this->retype($types);
		return $ok ? sprintf('%d file types registered, %d existing files retyped.', count($now['mappings']), $changed)
			: 'Nextcloud\'s config folder cannot be written (see the log): the Craft file types are registered only in part, if at all.';
	}

	/**
	 * Takes back the entries this app added that are still unchanged, and gives the files with
	 * those extensions the type Nextcloud gives them without the entries. Runs on every disable.
	 */
	public function unregister(): string {
		return $this->locked(fn () => $this->unregisterLocked())
			?? 'The MIME type configuration is locked by another run (see the log): the Craft file types stay registered.';
	}

	private function unregisterLocked(): string {
		$owned = $this->owned();
		if ($owned['mappings'] === [] && $owned['aliases'] === []) {
			return 'No Craft file types to remove.';
		}
		// What the extensions are without this app's entries: another app's own registration (it
		// differs from ours in Nextcloud's list), else the administrator's or Nextcloud's default,
		// else nothing. The files get those types first: should that fail, the entries stay, and the
		// files keep types Nextcloud still knows.
		$mappings = $this->detector->getAllMappings();
		$defaults = $this->readJson(\OC::$SERVERROOT . '/resources/config/mimetypemapping.dist.json') ?? [];
		$config = $this->readJson($this->configPath('mimetypemapping.json')) ?? [];
		$types = [];
		foreach ($owned['mappings'] as $ext => $ours) {
			$current = $mappings[$ext] ?? null;
			$other = $current !== null && !self::sameMapping($current, $ours) ? $current[0] : null;
			$admin = isset($config[$ext]) && $config[$ext] != self::stored($ours) ? $config[$ext][0] ?? null : null;
			$fallback = $admin ?? $defaults[$ext][0] ?? null;
			$types[(string)$ext] = (string)($other ?? (is_string($fallback) ? $fallback : 'application/octet-stream'));
		}
		$changed = $this->retype($types);
		[$now, $ok] = $this->write($owned, [], []);
		$this->setOwned($now);
		return $ok ? sprintf('Craft file types removed, %d files retyped.', $changed)
			: sprintf('%d files retyped, but Nextcloud\'s config folder cannot be written (see the log): Craft file types stay registered.', $changed);
	}

	/**
	 * The aliases this app added (type => icon name), for pages whose script resolves icons itself
	 * (src/aliases.ts): Nextcloud's own list there comes from occ maintenance:mimetype:update-js.
	 *
	 * @return array<string, string>
	 */
	public function addedAliases(): array {
		return $this->owned()['aliases'];
	}

	/**
	 * Runs $work under this app's lock on the MIME type configuration, from reading what it owns
	 * to noting it again, so that two runs (an enable in the browser and one with occ) do not mix;
	 * null if another run holds the lock.
	 *
	 * @param callable(): string $work
	 */
	private function locked(callable $work): ?string {
		try {
			$this->locking->acquireLock(self::LOCK, ILockingProvider::LOCK_EXCLUSIVE);
		} catch (\Throwable $e) {
			$this->logger->warning('Could not lock the MIME type configuration', ['app' => Application::APP_ID, 'exception' => $e]);
			return null;
		}
		try {
			return $work();
		} finally {
			$this->locking->releaseLock(self::LOCK, ILockingProvider::LOCK_EXCLUSIVE);
		}
	}

	/**
	 * Writes the wanted entries into the config files and removes this app's earlier entries that
	 * are no longer wanted, all only where the file still holds what this app wrote. Returns what
	 * this app owns afterwards (for a file it could not change, what it owned before) and whether
	 * both files could be read and written.
	 *
	 * @param array{mappings: array<string, array{0: string, 1: ?string}>, aliases: array<string, string>} $owned
	 * @param array<string, array{0: string, 1: ?string}> $mappings
	 * @param array<string, string> $aliases
	 * @return array{0: array{mappings: array<string, array{0: string, 1: ?string}>, aliases: array<string, string>}, 1: bool}
	 */
	private function write(array $owned, array $mappings, array $aliases): array {
		$result = $owned;
		$ok = true;
		foreach ([['mimetypemapping.json', 'mappings', $mappings], ['mimetypealiases.json', 'aliases', $aliases]] as [$name, $kind, $wanted]) {
			$path = $this->configPath($name);
			$data = file_exists($path) ? $this->readJson($path) : [];
			if ($data === null) {
				$this->logger->warning('Not changing ' . $path . ': it is not a JSON object', ['app' => Application::APP_ID]);
				$ok = false;
				continue;
			}
			$before = $data;
			$mine = [];
			foreach ($owned[$kind] as $key => $value) {
				// Ours and unchanged, but no longer wanted: removed. Changed meanwhile: left alone.
				if (!array_key_exists($key, $wanted) && array_key_exists($key, $data) && $data[$key] == self::stored($value)) {
					unset($data[$key]);
				}
			}
			foreach ($wanted as $key => $value) {
				$ours = array_key_exists($key, $owned[$kind]) && ($data[$key] ?? null) == self::stored($owned[$kind][$key]);
				if (!array_key_exists($key, $data) || $ours) {
					$data[$key] = self::stored($value);
					$mine[$key] = $value;
				}
			}
			if ($data !== $before && !$this->writeJson($path, $data)) {
				$ok = false;
				continue; // unchanged: what it owned before still holds
			}
			$result[$kind] = $mine;
		}
		return [$result, $ok];
	}

	/**
	 * Gives the files with the extensions in $types (extension => MIME type) that type, in one
	 * pass over the file cache, and returns how many it changed. Also sets the major type
	 * (mimepart), which Nextcloud's searches by type use.
	 *
	 * @param array<string, string> $types
	 */
	private function retype(array $types): int {
		if ($types === []) {
			return 0;
		}
		$select = $this->db->getQueryBuilder();
		$names = [];
		foreach (array_keys($types) as $ext) {
			$names[] = $select->expr()->like($select->func()->lower('name'), $select->createNamedParameter('%.' . $this->db->escapeLikeParameter((string)$ext)));
		}
		$select->select('fileid', 'name', 'mimetype')
			->from('filecache')
			->where($select->expr()->orX(...$names))
			->andWhere($select->expr()->neq('mimetype', $select->createNamedParameter($this->loader->getId('httpd/unix-directory'), IQueryBuilder::PARAM_INT)));
		$result = $select->executeQuery();
		$byType = [];
		while (($row = $result->fetch()) !== false) {
			$type = $types[CraftApps::extension((string)$row['name'])] ?? null;
			if ($type !== null && (int)$row['mimetype'] !== $this->loader->getId($type)) {
				$byType[$type][] = (int)$row['fileid'];
			}
		}
		$result->closeCursor();
		$changed = 0;
		foreach ($byType as $type => $ids) {
			$id = $this->loader->getId($type);
			$part = $this->loader->getId(explode('/', $type)[0]);
			foreach (array_chunk($ids, 1000) as $chunk) {
				$update = $this->db->getQueryBuilder();
				$update->update('filecache')
					->set('mimetype', $update->createNamedParameter($id, IQueryBuilder::PARAM_INT))
					->set('mimepart', $update->createNamedParameter($part, IQueryBuilder::PARAM_INT))
					->where($update->expr()->in('fileid', $update->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)));
				$changed += $update->executeStatement();
			}
		}
		return $changed;
	}

	/** @return array{mappings: array<string, array{0: string, 1: ?string}>, aliases: array<string, string>} */
	private function owned(): array {
		$owned = json_decode($this->appConfig->getValueString(Application::APP_ID, self::KEY, ''), true);
		$mappings = [];
		foreach ((array)($owned['mappings'] ?? []) as $ext => $value) {
			if (is_string($ext) && is_array($value) && is_string($value[0] ?? null)) {
				$mappings[$ext] = [$value[0], is_string($value[1] ?? null) ? $value[1] : null];
			}
		}
		$aliases = array_filter((array)($owned['aliases'] ?? []), fn ($value, $key) => is_string($key) && is_string($value), ARRAY_FILTER_USE_BOTH);
		return ['mappings' => $mappings, 'aliases' => $aliases];
	}

	/** @param array{mappings: array<string, array{0: string, 1: ?string}>, aliases: array<string, string>} $owned */
	private function setOwned(array $owned): void {
		if ($owned['mappings'] === [] && $owned['aliases'] === []) {
			$this->appConfig->deleteKey(Application::APP_ID, self::KEY);
		} else {
			$this->appConfig->setValueString(Application::APP_ID, self::KEY, json_encode($owned, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
		}
	}

	/**
	 * A mapping or alias as config/*.json hold it: an alias is a string, a mapping a list of the
	 * type and, if there is one, the type to send instead.
	 *
	 * @param string|array{0: string, 1: ?string} $value
	 * @return string|list<string>
	 */
	private static function stored(string|array $value): string|array {
		return is_string($value) ? $value : array_values(array_filter($value, fn ($type) => $type !== null));
	}

	/**
	 * @param array<array-key, mixed>|null $current
	 * @param array{0: string, 1: ?string} $ours
	 */
	private static function sameMapping(?array $current, array $ours): bool {
		return $current !== null && ($current[0] ?? null) === $ours[0] && ($current[1] ?? null) === $ours[1];
	}

	private function configPath(string $name): string {
		// Nextcloud reads its custom MIME type files from its config folder (\OC::$configDir, which
		// ends with a slash), as Nextcloud's Maps app writes them.
		return \OC::$configDir . $name;
	}

	/** @return array<array-key, mixed>|null */
	private function readJson(string $path): ?array {
		$text = @file_get_contents($path);
		if ($text === false) {
			return null;
		}
		$data = json_decode($text, true);
		return is_array($data) ? $data : null;
	}

	/** @param array<array-key, mixed> $data */
	private function writeJson(string $path, array $data): bool {
		// A file left without entries goes: it would only say what Nextcloud has without it.
		if ($data === []) {
			return @unlink($path) || !file_exists($path);
		}
		// Written next to the file and renamed over it, so Nextcloud never reads half a file.
		$temp = $path . '.craftsuite-layer.tmp';
		$json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
		if ($json === false || @file_put_contents($temp, $json . "\n") === false || !@rename($temp, $path)) {
			@unlink($temp);
			$this->logger->warning('Could not write ' . $path, ['app' => Application::APP_ID]);
			return false;
		}
		return true;
	}
}
