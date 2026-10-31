<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Service;

use OCA\CraftsuiteLayer\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\Files\File;
use OCP\Files\Template\ITemplateManager;
use OCP\Files\Template\TemplateFileCreator;
use OCP\IL10N;
use OCP\IRequest;
use OCP\ITempManager;
use OCP\IUserSession;
use Psr\Log\LoggerInterface;

/**
 * The Craft apps' entries in the "+ New" menu of Files (docs/nextcloud-app.md, New files).
 *
 * Files lists them through Nextcloud's template API: the user names the file (and may pick one of
 * their own templates from the Templates folder), Nextcloud creates it, empty without a template,
 * and announces it (FileCreatedFromTemplateEvent); Files then opens it with its click action. So
 * each Craft app has an entry only for a format a click opens in it (CraftApps::clickApp()): its
 * own format, or one of the default app's. And an empty new file of such a format gets the app's
 * blank document from assets/, also when another app's entry created it (Euro-Office, ONLYOFFICE
 * and Nextcloud Office write their own blank into every new Office file): it opens in the Craft
 * app, which saves its own blank back in place and another program's as a copy.
 */
class NewFiles {
	/**
	 * App => the format of its new files: the extension, the MIME type the user's own templates
	 * must have, and the aspect ratio of their previews in the template picker. LightCraft has no
	 * entry: it develops photos, it does not make new ones.
	 */
	public const FORMATS = [
		'pdfcraft' => ['ext' => 'pdf', 'mime' => 'application/pdf', 'ratio' => 21 / 29.7],
		'photocraft' => ['ext' => 'psd', 'mime' => 'application/x-photoshop', 'ratio' => 16 / 9],
		'vectorcraft' => ['ext' => 'vectorcraft', 'mime' => 'application/x-vectorcraft', 'ratio' => 21 / 29.7],
		'designcraft' => ['ext' => 'designcraft', 'mime' => 'application/vnd.designcraft+zip', 'ratio' => 21 / 29.7],
		'wordcraft' => ['ext' => 'docx', 'mime' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'ratio' => 21 / 29.7],
		'gridcraft' => ['ext' => 'xlsx', 'mime' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'ratio' => 21 / 29.7],
		'deckcraft' => ['ext' => 'deckcraft', 'mime' => 'application/x-deckcraft', 'ratio' => 16 / 9],
		'cadcraft' => ['ext' => 'dxf', 'mime' => 'image/vnd.dxf', 'ratio' => 21 / 29.7],
		'filmcraft' => ['ext' => 'fcproj', 'mime' => 'application/x-filmcraft', 'ratio' => 16 / 9],
		'effectcraft' => ['ext' => 'ecproj', 'mime' => 'application/x-effectcraft', 'ratio' => 16 / 9],
		'soundcraft' => ['ext' => 'scraftz', 'mime' => 'application/x-soundcraft-session', 'ratio' => 16 / 9],
		'figcraft' => ['ext' => 'figcraft', 'mime' => 'application/x-figcraft', 'ratio' => 16 / 9],
	];

	/**
	 * The creators' order: after the office suites' (Nextcloud's default is 100). Files' menu sorts
	 * all creators' entries by name; the order counts in Nextcloud 35's Office app, where the first
	 * creator of a kind of file names its menu entry.
	 */
	private const ORDER = 200;

	/**
	 * The regions that print on US Letter (CLDR, paperSize "US-Letter"): users whose Nextcloud
	 * locale is in one (or is Nextcloud's plain 'en', American English) get the Letter blank of the
	 * apps in PAPER, everyone else A4.
	 */
	public const LETTER = ['BZ', 'CA', 'CL', 'CO', 'CR', 'GT', 'MX', 'NI', 'PA', 'PH', 'PR', 'SV', 'US', 'VE'];

	/** The apps whose blank has a page size: A4 (blank.<ext>) and Letter (blank-letter.<ext>). */
	public const PAPER = ['pdfcraft', 'wordcraft', 'gridcraft'];

	public function __construct(
		private CraftApps $craftApps,
		private IAppManager $appManager,
		private IUserSession $userSession,
		private IRequest $request,
		private IL10N $l,
		private ITempManager $tempManager,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Adds the entries the current user gets to Nextcloud's list (RegisterTemplateCreatorEvent).
	 * Never on a public share page: there Files makes the file empty, without the event, and has
	 * no Craft entries to open it. Nextcloud does not catch errors here, and in Nextcloud 35 the
	 * Office app lists the creators on every page, so nothing may be thrown; an entry without an
	 * icon would even stop Files from starting, so an app whose icon is missing gets none.
	 */
	public function register(ITemplateManager $manager): void {
		try {
			if (str_starts_with($this->request->getPathInfo() ?: '', '/s/')) {
				return;
			}
			foreach (array_keys(self::FORMATS) as $app) {
				if ($this->appFor(self::FORMATS[$app]['ext']) !== $app) {
					continue;
				}
				$icon = $this->icon($app);
				if ($icon === null) {
					continue;
				}
				$creator = new TemplateFileCreator(Application::APP_ID, $this->label($app), '.' . self::FORMATS[$app]['ext']);
				$creator->addMimetype(self::FORMATS[$app]['mime']);
				$creator->setIconSvgInline($icon);
				$creator->setRatio(self::FORMATS[$app]['ratio']);
				$creator->setOrder(self::ORDER);
				$manager->registerTemplateFileCreator(fn (): TemplateFileCreator => $creator);
			}
		} catch (\Throwable $e) {
			$this->logger->error('Could not list the Craft apps\' New entries', ['app' => Application::APP_ID, 'exception' => $e]);
		}
	}

	/**
	 * Writes the app's blank document into a file Nextcloud just created without a template
	 * (FileCreatedFromTemplateEvent), if it is of a format a click opens in a Craft app.
	 */
	public function fill(File $target): void {
		$app = $this->appFor(CraftApps::extension($target->getName()));
		if ($app === null) {
			return;
		}
		$blank = self::blankPath($app, $this->letter());
		$content = @file_get_contents($blank);
		try {
			if ($content === false) {
				throw new \RuntimeException('The blank document ' . $blank . ' is missing');
			}
			$target->putContent($this->stamped($app, $content, pathinfo($target->getName(), PATHINFO_FILENAME)));
		} catch (\Throwable $e) {
			$this->logger->error('Could not write the blank document into ' . $target->getPath(), ['app' => Application::APP_ID, 'exception' => $e]);
			// An empty file the app cannot open goes, and Files says the file could not be created
			// (Nextcloud turns the exception into its message); another app's blank stays.
			if ($target->getSize() === 0) {
				try {
					$target->delete();
				} catch (\Throwable) {
					// it stays empty
				}
				throw new \RuntimeException('The new file could not get its blank document', 0, $e);
			}
		}
	}

	/** Where the app's blank document is (assets/, made by blanks.mjs). */
	public static function blankPath(string $app, bool $letter = false): string {
		$paper = $letter && in_array($app, self::PAPER, true) ? '-letter' : '';
		return dirname(__DIR__, 2) . '/assets/blank' . $paper . '.' . self::FORMATS[$app]['ext'];
	}

	/**
	 * Whether the current user's locale is in a region that prints on Letter: the locale Nextcloud
	 * formats their pages with (the one they chose, else the server's default_locale, else their
	 * language: 'de' is A4, the plain 'en' American English).
	 */
	private function letter(): bool {
		$locale = $this->l->getLocaleCode();
		if ($locale === 'en') {
			return true;
		}
		$parts = explode('_', $locale);
		return count($parts) > 1 && in_array(strtoupper((string)end($parts)), self::LETTER, true);
	}

	/** The stand-in creation time in the blanks (blanks.mjs): in seconds, and as W3CDTF text. */
	private const CREATED_SECONDS = 1767225600;
	private const CREATED_W3C = '2026-01-01T00:00:00Z';

	/** The project name in FilmCraft's blank (blanks.mjs), which the new file's name replaces. */
	private const FILMCRAFT_NAME = 'New FilmCraft project';

	/**
	 * The blank made the new file's own. WordCraft, VectorCraft, DesignCraft and DeckCraft keep a
	 * document's creation time as they find it (their document information shows it), and their
	 * adapters tell the opened document by it from a new one saved under the same name: it becomes
	 * the time of now. FilmCraft keeps the project's name, which names its Save As and the adapter's
	 * saves: it becomes the file's name ($stem). The blank as it is if it cannot be changed: then the
	 * stand-in stays, which only a file named like an app's new document (Untitled-1) minds.
	 */
	private function stamped(string $app, string $blank, string $stem): string {
		$now = time();
		$seconds = fn (string $json): string => str_replace('"created":' . self::CREATED_SECONDS, '"created":' . $now, $json);
		$w3c = gmdate('Y-m-d\\TH:i:s\\Z', $now);
		return match ($app) {
			'vectorcraft' => $seconds($blank),
			// Stored again like the blank's entries (the apps read deflated ones too; only the
			// mimetype entry must stay first and stored, which the change keeps).
			'designcraft' => $this->changeEntry($blank, 'document.json', $seconds, true) ?? $blank,
			'deckcraft' => $this->changeEntry($blank, 'presentation.json',
				fn (string $json): string => str_replace('"created":"' . self::CREATED_W3C . '"', '"created":"' . $w3c . '"', $json), true) ?? $blank,
			'wordcraft' => $this->changeEntry($blank, 'docProps/core.xml', fn (string $xml): string => (string)preg_replace(
				'#(<dcterms:(?:created|modified)\\b[^>]*>)[^<]*#', '${1}' . $w3c, $xml)) ?? $blank,
			'filmcraft' => str_replace('"name":"' . self::FILMCRAFT_NAME . '"',
				'"name":' . (string)json_encode($stem, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), $blank),
			default => $blank,
		};
	}

	/**
	 * The zip package $zip with its entry $name changed by $change, stored if $store, or null if
	 * it cannot be changed.
	 *
	 * @param callable(string): string $change
	 */
	private function changeEntry(string $zip, string $name, callable $change, bool $store = false): ?string {
		if (!class_exists(\ZipArchive::class)) {
			return null;
		}
		$temp = $this->tempManager->getTemporaryFile('.zip');
		if ($temp === false || file_put_contents($temp, $zip) === false) {
			return null;
		}
		$archive = new \ZipArchive();
		if ($archive->open($temp) !== true) {
			return null;
		}
		$entry = $archive->getFromName($name);
		$changed = is_string($entry) && $archive->addFromString($name, $change($entry))
			&& (!$store || $archive->setCompressionName($name, \ZipArchive::CM_STORE));
		if (!$archive->close() || !$changed) {
			return null;
		}
		$result = file_get_contents($temp);
		return $result === false ? null : $result;
	}

	/**
	 * The Craft app whose new-file format $ext is and which a click opens it in, for the current
	 * user (logged in, the app enabled for them, the Craft app configured), or null.
	 */
	private function appFor(string $ext): ?string {
		if ($ext === '' || !$this->userSession->isLoggedIn() || !$this->appManager->isEnabledForUser(Application::APP_ID)) {
			return null;
		}
		$app = CraftApps::clickApp($ext, $this->craftApps->configured(), $this->craftApps->defaultApps());
		return $app !== null && (self::FORMATS[$app]['ext'] ?? null) === $ext ? $app : null;
	}

	/** The entry's name, which Files also offers as the new file's name (with the extension). */
	private function label(string $app): string {
		return match ($app) {
			'pdfcraft' => $this->l->t('New PdfCraft document'),
			'photocraft' => $this->l->t('New PhotoCraft image'),
			'vectorcraft' => $this->l->t('New VectorCraft drawing'),
			'designcraft' => $this->l->t('New DesignCraft document'),
			'wordcraft' => $this->l->t('New WordCraft document'),
			'gridcraft' => $this->l->t('New GridCraft spreadsheet'),
			'deckcraft' => $this->l->t('New DeckCraft presentation'),
			'cadcraft' => $this->l->t('New CADCraft drawing'),
			'filmcraft' => $this->l->t('New FilmCraft project'),
			'effectcraft' => $this->l->t('New EffectCraft project'),
			'soundcraft' => $this->l->t('New SoundCraft session'),
			'figcraft' => $this->l->t('New FigCraft design'),
			default => $app,
		};
	}

	/**
	 * The entry's icon: the Craft app's own (img/new/, 48 px) in an SVG, since Files takes inline
	 * SVG only; as a data: URI, because Nextcloud 35's Office app shows the SVG as a CSS background,
	 * which loads nothing else. 48 px: sharp at the 20 px Files shows on a screen with double
	 * resolution, and small, since Files puts every entry into every Files page (and Nextcloud
	 * 35's app menu into every page). Null if the file is missing.
	 */
	private function icon(string $app): ?string {
		$png = @file_get_contents(dirname(__DIR__, 2) . '/img/new/' . $app . '.png');
		if ($png === false || $png === '') {
			return null;
		}
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><image width="48" height="48" href="data:image/png;base64,'
			. base64_encode($png) . '"/></svg>';
	}
}
