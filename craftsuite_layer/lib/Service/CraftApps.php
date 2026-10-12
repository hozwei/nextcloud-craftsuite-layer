<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Service;

use OCA\CraftsuiteLayer\AppInfo\Application;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\L10N\IFactory;

/**
 * The Craft apps this layer can open, which files each opens, and where an administrator says
 * they are hosted (the settings page, or occ config:app:set craftsuite_layer <app>_url).
 *
 * Files are matched by extension, never by MIME type: Nextcloud stores application/octet-stream
 * for extensions it does not know (.designcraft, .vectorcraft, .idml) until FileTypes has added
 * types for them, which it may not (a read-only config folder, an administrator's own entry). The
 * Files entry (src/files.ts) gets these lists from the listener's initial state, so they exist
 * only here.
 *
 * The address must come from here, never from a request: the editor page sends file contents to
 * that origin (docs/security.md).
 *
 * Each app may also have a language it starts in (<app>_language): '' lets the app decide as it
 * does without the layer, 'user' takes the user's Nextcloud language, anything else must be one of
 * the app's 'languages'. The editor page hands it to the translator in the frame's address
 * (docs/protocol.md), whose adapter applies it.
 */
class CraftApps {
	/**
	 * App id => display name, the extensions it opens (lower case, no dot) and those it opens on
	 * a click in Files (default action; only types no common Nextcloud app opens by default, so a
	 * PDF stays with the PDF viewer, a PNG or SVG with the Viewer and Office files with Nextcloud
	 * Office or ONLYOFFICE). Each list follows what the app opens from a drop and saves back well;
	 * docs/apps/<app>.md has the reasons, including the types left out on purpose (such as .pdn,
	 * whose saves PhotoCraft writes as new .pcraft files every time). SoundCraft is missing on
	 * purpose: its web build can neither open nor save files.
	 *
	 * 'languages': the BCP 47 tags of the interface languages the app's adapter can start it in,
	 * as the tested version shows them (docs/apps/<app>.md; the adapter's LANGUAGES table must have
	 * the same keys). Empty for apps whose web build reads no language at start.
	 */
	public const APPS = [
		'pdfcraft' => [
			'name' => 'PdfCraft',
			'extensions' => ['pdf'],
			'default' => [],
			'languages' => ['en', 'ar', 'bg', 'cs', 'de', 'es', 'fr', 'hu', 'it', 'ja', 'pl', 'pt-BR', 'ru', 'uk'],
		],
		'photocraft' => [
			'name' => 'PhotoCraft',
			'extensions' => ['psd', 'psb', 'pcraft', 'tga', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'ico', 'heic', 'heif'],
			'default' => ['psd', 'psb', 'pcraft', 'tga'],
			'languages' => ['en', 'cs', 'de', 'el', 'es', 'fr', 'id', 'it', 'nl', 'pl', 'pt-BR', 'ru', 'uk'],
		],
		'vectorcraft' => [
			'name' => 'VectorCraft',
			'extensions' => ['vectorcraft', 'drawcraft', 'ai', 'eps', 'svgz', 'dxf', 'svg', 'emf', 'wmf', 'pdf'],
			// Not 'ai': Nextcloud's PDF viewer (shipped, enabled by default) opens it on a click.
			'default' => ['vectorcraft', 'drawcraft', 'eps', 'svgz', 'dxf'],
			'languages' => ['en', 'cs', 'de', 'es', 'fr', 'it', 'ja', 'pt-BR', 'ru', 'uk'],
		],
		// DesignCraft 0.6.0 always starts in English (it reads no language at start).
		'designcraft' => ['name' => 'DesignCraft', 'extensions' => ['designcraft', 'idml'], 'default' => ['designcraft', 'idml'], 'languages' => []],
		// Saves of Word files from other programs become a copy next to them (docs/apps/wordcraft.md).
		// WordCraft 0.5.0 always starts in English.
		'wordcraft' => ['name' => 'WordCraft', 'extensions' => ['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'odt', 'rtf'], 'default' => [], 'languages' => []],
		// GridCraft's Spanish only switches the names of formula functions.
		'gridcraft' => ['name' => 'GridCraft', 'extensions' => ['xlsx', 'xlsm', 'ods', 'csv'], 'default' => [], 'languages' => ['en', 'es', 'pt-BR', 'ru']],
		// DeckCraft 0.5.0 is English only.
		'deckcraft' => ['name' => 'DeckCraft', 'extensions' => ['deckcraft', 'pptx', 'potx', 'ppsx'], 'default' => ['deckcraft'], 'languages' => []],
		// 'dxf' is also VectorCraft's default; CADCraft wins it when both are configured (PREFERRED).
		'cadcraft' => ['name' => 'CADCraft', 'extensions' => ['dxf'], 'default' => ['dxf'], 'languages' => ['en', 'uk']],
		// Every result is a new file: LightCraft exports, it never saves a photo back.
		'lightcraft' => [
			'name' => 'LightCraft',
			'extensions' => ['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'srw', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'],
			'default' => ['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'srw'],
			'languages' => ['en', 'de', 'es', 'fr', 'ja', 'pt-BR', 'ru', 'uk', 'zh-Hans', 'zh-Hant'],
		],
		'filmcraft' => ['name' => 'FilmCraft', 'extensions' => ['fcproj'], 'default' => ['fcproj'], 'languages' => ['en', 'de', 'es', 'fr', 'ja', 'pt-BR', 'ru', 'uk']],
		// EffectCraft's Spanish and Portuguese translate only the menu bar.
		'effectcraft' => ['name' => 'EffectCraft', 'extensions' => ['ecproj'], 'default' => ['ecproj'], 'languages' => ['en', 'es', 'pt-BR', 'uk']],
	];

	/**
	 * Extension => the app that opens it on a click when several configured apps have it as their
	 * default. Without an entry the first of them in APPS wins. An app that is not configured
	 * never takes the click away from one that is.
	 */
	private const PREFERRED = ['dxf' => 'cadcraft'];

	public function __construct(
		private IAppConfig $appConfig,
		private IConfig $config,
		private IURLGenerator $urlGenerator,
		private IRequest $request,
		private IL10N $l,
		private IFactory $l10nFactory,
	) {
	}

	public static function key(string $app): string {
		return $app . '_url';
	}

	public static function languageKey(string $app): string {
		return $app . '_language';
	}

	/** The stored start language of the app ('', 'user' or a tag), as typed. */
	public function storedLanguage(string $app): string {
		if (!isset(self::APPS[$app]) || self::APPS[$app]['languages'] === []) {
			return '';
		}
		return trim($this->appConfig->getValueString(Application::APP_ID, self::languageKey($app), ''));
	}

	/** Why $value cannot be the start language of $app, or null if it can. */
	public function languageProblem(string $app, string $value): ?string {
		if ($value === '' || ($value === 'user' && (self::APPS[$app]['languages'] ?? []) !== [])
			|| in_array($value, self::APPS[$app]['languages'] ?? [], true)) {
			return null;
		}
		return $this->l->t('%s cannot be started in this language.', [self::APPS[$app]['name'] ?? $app]);
	}

	/**
	 * The language the app is to start in for the current user, as a BCP 47 tag, or null to let the
	 * app decide. 'user' is the language Nextcloud shows its own pages in for this user (and this
	 * request: ?forceLanguage and force_language count too); the adapter matches it against what
	 * the app has, and leaves the app's own choice if it has nothing close.
	 */
	public function startLanguage(string $app): ?string {
		$value = $this->storedLanguage($app);
		if ($value === '' || $this->languageProblem($app, $value) !== null) {
			return null;
		}
		return $value === 'user' ? self::languageTag($this->l10nFactory->findLanguage()) : $value;
	}

	/**
	 * A Nextcloud language code as a BCP 47 tag ('de' -> 'de', 'de_DE' -> 'de-DE', 'pt_BR' ->
	 * 'pt-BR', 'es_419' -> 'es-419', 'sr@latin' -> 'sr-Latn'), or null for anything else.
	 */
	public static function languageTag(string $code): ?string {
		if (preg_match('/^([a-z]{2,3})(?:_([A-Z]{2}|[0-9]{3}))?(@latin)?$/', $code, $m) !== 1) {
			return null;
		}
		return $m[1] . (isset($m[3]) && $m[3] !== '' ? '-Latn' : '') . (isset($m[2]) && $m[2] !== '' ? '-' . $m[2] : '');
	}

	/** Lower-case extension of a file name without the dot, '' if it has none. */
	public static function extension(string $name): string {
		$dot = strrpos($name, '.');
		return $dot === false || $dot === 0 ? '' : strtolower(substr($name, $dot + 1));
	}

	/** Whether $app opens files named like $name. */
	public static function opens(string $app, string $name): bool {
		return isset(self::APPS[$app]) && in_array(self::extension($name), self::APPS[$app]['extensions'], true);
	}

	/**
	 * The app among $apps that opens files with extension $ext on a click in Files, or null.
	 *
	 * @param list<string> $apps
	 */
	public static function clickApp(string $ext, array $apps): ?string {
		$claims = array_values(array_filter($apps, fn (string $app) => isset(self::APPS[$app]) && in_array($ext, self::APPS[$app]['default'], true)));
		if ($claims === []) {
			return null;
		}
		$preferred = self::PREFERRED[$ext] ?? null;
		return $preferred !== null && in_array($preferred, $claims, true) ? $preferred : $claims[0];
	}

	/**
	 * The extensions $app opens on a click in Files when $apps are configured: its defaults that
	 * no other app among $apps takes (clickApp()).
	 *
	 * @param list<string> $apps
	 * @return list<string>
	 */
	public static function clickExtensions(string $app, array $apps): array {
		return array_values(array_filter(self::APPS[$app]['default'] ?? [], fn (string $ext) => self::clickApp($ext, $apps) === $app));
	}

	/**
	 * The app that opens $name when no app was chosen: the one that opens it on a click, then the
	 * first that opens it at all, both among the configured apps $configured. If none of them
	 * opens it, the same among all apps, so that the editor can say which app is missing.
	 *
	 * @param list<string> $configured
	 */
	public static function forFileName(string $name, array $configured): ?string {
		$ext = self::extension($name);
		foreach ([$configured, array_keys(self::APPS)] as $apps) {
			$app = self::clickApp($ext, $apps);
			if ($app !== null) {
				return $app;
			}
			foreach ($apps as $candidate) {
				if (self::opens($candidate, $name)) {
					return $candidate;
				}
			}
		}
		return null;
	}

	/** The stored address, as typed (may be empty or not acceptable). */
	public function storedUrl(string $app): string {
		return trim($this->appConfig->getValueString(Application::APP_ID, self::key($app), ''));
	}

	/** The configured address of the app, or null if it is missing or not acceptable. */
	public function url(string $app): ?string {
		$url = $this->storedUrl($app);
		return $url !== '' && $this->problem($url) === null ? $url : null;
	}

	/** @return list<string> ids of the apps with an acceptable address */
	public function configured(): array {
		return array_values(array_filter(array_keys(self::APPS), fn (string $app) => $this->url($app) !== null));
	}

	/**
	 * Why $url cannot be used as a Craft app address, or null if it can. Checked when it is saved
	 * and again on every open, because the server's own addresses may change.
	 */
	public function problem(string $url): ?string {
		$parts = parse_url($url);
		if (is_array($parts) && isset($parts['host']) && self::canonicalHost($parts['host']) === null) {
			// What the browser and the Content-Security-Policy would not agree on: a Unicode name
			// in a CSP is invalid, and characters such as ';' would end the frame-src directive.
			return preg_match('/[^\x00-\x7f]/', $parts['host']) === 1 && !function_exists('idn_to_ascii')
				? $this->l->t('Type international host names in their xn-- form: this server cannot convert them.')
				: $this->l->t('The host name is not valid. Use letters, digits, hyphens and dots, or an IP address.');
		}
		if (!self::isAcceptable($url)) {
			return $this->l->t('Use an https:// address without user name, password, ?query or #fragment (http:// only on localhost).');
		}
		// On a Nextcloud host the app's code would share the user's session (same origin), or at
		// least receive Nextcloud's cookies (cookies do not separate ports, RFC 6265 8.5).
		if (in_array(self::comparableHost((string)parse_url($url, PHP_URL_HOST)), $this->nextcloudHosts(), true)) {
			return $this->l->t('The Craft app must be hosted on another host name than Nextcloud.');
		}
		return null;
	}

	/**
	 * @return list<string> host names (in the form canonicalHost() gives) this Nextcloud answers
	 *                      on. trusted_domains entries are taken as written: a wildcard entry is
	 *                      not expanded, as '*.example.com' would also cover a separate Craft host
	 *                      such as craft.example.com; the request's own host catches a Craft host
	 *                      that Nextcloud really serves.
	 */
	private function nextcloudHosts(): array {
		$hosts = [
			self::comparableHost((string)parse_url($this->urlGenerator->getAbsoluteURL('/'), PHP_URL_HOST)),
			self::comparableHost(self::stripPort($this->request->getServerHost())),
		];
		foreach ((array)$this->config->getSystemValue('trusted_domains', []) as $domain) {
			if (is_string($domain) && $domain !== '') {
				// Entries may carry a port.
				$hosts[] = self::comparableHost(self::stripPort($domain));
			}
		}
		return array_values(array_unique(array_filter($hosts)));
	}

	private static function stripPort(string $host): string {
		$host = strtolower(trim($host));
		// [::1]:8080 -> [::1]; host:8080 -> host; a bare IPv6 address stays as it is.
		if (preg_match('/^(\[[^\]]+\])(:\d+)?$/', $host, $m) === 1) {
			return $m[1];
		}
		return substr_count($host, ':') === 1 ? explode(':', $host)[0] : $host;
	}

	/** A host for comparisons: canonical where possible (a bare IPv6 address gets brackets). */
	private static function comparableHost(string $host): string {
		$host = trim($host);
		if ($host !== '' && $host[0] !== '[' && filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false) {
			$host = '[' . $host . ']';
		}
		return self::canonicalHost($host) ?? strtolower($host);
	}

	/**
	 * The host as the browser writes it in an origin, or null if the browser and a
	 * Content-Security-Policy would not agree on it. Accepted: names of letters, digits and
	 * hyphens (lower-cased; an international name is converted to its xn-- form when the intl
	 * extension is there), a dotted IPv4 address, and an IPv6 address in brackets (in its
	 * shortest form, as browsers write it).
	 */
	public static function canonicalHost(string $host): ?string {
		if (preg_match('/^\[([^\]]+)\]$/', $host, $m) === 1) {
			$packed = filter_var($m[1], FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false ? false : inet_pton($m[1]);
			return $packed === false ? null : '[' . self::ipv6($packed) . ']';
		}
		if (preg_match('/[^\x00-\x7f]/', $host) === 1) {
			if (!function_exists('idn_to_ascii')) {
				return null;
			}
			// UTS #46 without transitional processing, as browsers convert names.
			$ascii = idn_to_ascii($host, IDNA_NONTRANSITIONAL_TO_ASCII | IDNA_CHECK_BIDI | IDNA_CHECK_CONTEXTJ, INTL_IDNA_VARIANT_UTS46);
			if (!is_string($ascii)) {
				return null;
			}
			$host = $ascii;
		}
		$host = strtolower($host);
		if (strlen($host) > 253) {
			return null;
		}
		$labels = explode('.', $host);
		foreach ($labels as $label) {
			if (preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $label) !== 1) {
				return null;
			}
		}
		// A last label of digits makes browsers read the whole host as an IPv4 address ('127.1' is
		// 127.0.0.1): only the dotted form, which they keep as it is, is accepted.
		if (preg_match('/^(?:\d+|0x[0-9a-f]*)$/', $labels[count($labels) - 1]) === 1) {
			return filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false ? null : $host;
		}
		return $host;
	}

	/** An IPv6 address (16 bytes) as the URL Standard serialises it: the first longest run of two or more zero pieces becomes '::'. */
	private static function ipv6(string $packed): string {
		/** @var list<int> $pieces */
		$pieces = array_values((array)unpack('n8', $packed));
		$start = -1;
		$length = 1;
		for ($i = 0; $i < 8; $i++) {
			$end = $i;
			while ($end < 8 && $pieces[$end] === 0) {
				$end++;
			}
			if ($end - $i > $length) {
				$start = $i;
				$length = $end - $i;
			}
			$i = max($i, $end);
		}
		$out = '';
		for ($i = 0; $i < 8; $i++) {
			if ($i === $start) {
				$out .= $i === 0 ? '::' : ':';
				$i += $length - 1;
				continue;
			}
			$out .= dechex($pieces[$i]) . ($i < 7 ? ':' : '');
		}
		return $out;
	}

	/**
	 * https only, or http on a loopback address for development; no credentials, no query and no
	 * fragment;
	 * a host that canonicalHost() accepts. The translator in the app applies the same rule to the
	 * Nextcloud origin.
	 */
	public static function isAcceptable(string $url): bool {
		$parts = parse_url($url);
		// No query: several Craft apps read their query as switches (PdfCraft's ?host=parent drops
		// every save under another origin, others restore sessions or keep files in the browser);
		// adapters set the switches their app needs themselves (translators/README.md).
		if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
			return false;
		}
		$host = self::canonicalHost($parts['host']);
		if ($host === null) {
			return false;
		}
		$scheme = strtolower($parts['scheme']);
		$loopback = preg_match('/^(localhost|127(\.\d{1,3}){3}|\[::1\])$/', $host) === 1;
		return $scheme === 'https' || ($scheme === 'http' && $loopback);
	}

	/**
	 * scheme://host[:port] of an acceptable URL, as the browser reports it in MessageEvent.origin
	 * and as the editor page's frame-src needs it.
	 */
	public static function origin(string $url): string {
		$parts = parse_url($url);
		$scheme = strtolower((string)$parts['scheme']);
		$host = (string)$parts['host'];
		$origin = $scheme . '://' . (self::canonicalHost($host) ?? strtolower($host));
		$port = $parts['port'] ?? null;
		if ($port !== null && !(($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80))) {
			$origin .= ':' . $port;
		}
		return $origin;
	}
}
