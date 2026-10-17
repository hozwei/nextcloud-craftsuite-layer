<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Service;

use OCA\CraftsuiteLayer\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\IURLGenerator;
use OCP\Preview\IMimeIconProvider;
use Psr\Container\ContainerInterface;

/**
 * The Craft apps' icons for the file types they open, in Files (docs/nextcloud-app.md).
 *
 * Files shows a file without a preview with the icon of its MIME type, from the server's
 * IMimeIconProvider (/core/mimeicon, and /core/preview's fallback; also the file pickers, versions
 * and public shares). That provider only knows the icons in Nextcloud's own folders, which every
 * server update replaces. So this app puts its own provider in its place, which answers for the
 * Craft types and passes everything else to Nextcloud's: the icons stay in the app's folder,
 * survive updates, leave Nextcloud's integrity check clean and go away with the app.
 *
 * A file gets the icon of the first Craft app in ICONS that has an address, and only for users
 * the app is enabled for (on a public share page: only if it is enabled for everyone). Others,
 * and file types whose Craft app has no address, keep Nextcloud's icon.
 *
 * Nextcloud has no API for this: the provider is replaced in the server's container
 * (registerService, deprecated since Nextcloud 20, internal in 36). register() does it only where
 * that method and Nextcloud's own provider exist; without them Files keeps Nextcloud's icons.
 */
class MimeIcons implements IMimeIconProvider {
	/**
	 * MIME type => the Craft apps whose icon it gets, the first with an address wins: every type
	 * a Craft app opens that Nextcloud shows with a general icon only (its image or file icon).
	 * Office files, PDFs and common images keep theirs. Camera raws share one type, so the
	 * LightCraft icon also shows on the raw formats LightCraft is not offered for (dcr, erf, iiq,
	 * k25, kdc, mef, sr2, srf, xrf; docs/apps/lightcraft.md).
	 */
	public const ICONS = [
		'application/x-photoshop' => ['photocraft'],
		'application/x-photocraft' => ['photocraft'],
		'image/tga' => ['photocraft'],
		'application/x-vectorcraft' => ['vectorcraft'],
		'application/illustrator' => ['vectorcraft'],
		'image/x-eps' => ['vectorcraft'],
		'image/svg+xml-compressed' => ['vectorcraft'],
		'image/emf' => ['vectorcraft'],
		'image/wmf' => ['vectorcraft'],
		// As on a click (CraftApps::PREFERRED): CADCraft, else VectorCraft.
		'image/vnd.dxf' => ['cadcraft', 'vectorcraft'],
		'application/vnd.designcraft+zip' => ['designcraft'],
		'application/vnd.adobe.indesign-idml-package' => ['designcraft'],
		'application/x-deckcraft' => ['deckcraft'],
		'image/x-dcraw' => ['lightcraft'],
		'application/x-filmcraft' => ['filmcraft'],
		'application/x-effectcraft' => ['effectcraft'],
		'application/x-soundcraft-session' => ['soundcraft'],
	];

	/** The icon file of each app in img/types/ (the apps' own icons, see REUSE.toml). */
	public const FILES = [
		'photocraft' => 'photocraft.svg',
		'vectorcraft' => 'vectorcraft.svg',
		'designcraft' => 'designcraft.svg',
		'deckcraft' => 'deckcraft.svg',
		'cadcraft' => 'cadcraft.png',
		'lightcraft' => 'lightcraft.svg',
		'filmcraft' => 'filmcraft.svg',
		'effectcraft' => 'effectcraft.svg',
		'soundcraft' => 'soundcraft.svg',
	];

	/** @var list<string>|null */
	private ?array $configured = null;

	public function __construct(
		private IMimeIconProvider $nextcloud,
		private IURLGenerator $urlGenerator,
		private IAppManager $appManager,
		private CraftApps $craftApps,
	) {
	}

	/**
	 * Puts this provider in place of Nextcloud's, for this request. $app is the app's own
	 * container, which builds CraftApps.
	 */
	public static function register(ContainerInterface $app): void {
		$server = \OCP\Server::get(ContainerInterface::class);
		if (!method_exists($server, 'registerService') || !class_exists(\OC\Preview\MimeIconProvider::class)) {
			return;
		}
		$server->registerService(IMimeIconProvider::class, static fn (ContainerInterface $c) => new self(
			$c->get(\OC\Preview\MimeIconProvider::class),
			$c->get(IURLGenerator::class),
			$c->get(IAppManager::class),
			$app->get(CraftApps::class),
		));
	}

	public function getMimeIconUrl(string $mime): ?string {
		$apps = self::ICONS[$mime] ?? null;
		if ($apps !== null && $this->appManager->isEnabledForUser(Application::APP_ID)) {
			$this->configured ??= $this->craftApps->configured();
			foreach ($apps as $app) {
				if (in_array($app, $this->configured, true)) {
					try {
						$path = $this->urlGenerator->imagePath(Application::APP_ID, 'types/' . self::FILES[$app]);
					} catch (\RuntimeException) {
						break; // the icon file is missing: Nextcloud's icon
					}
					// Versioned: an app update may bring new icons under the same names.
					return $this->urlGenerator->getAbsoluteURL($path) . '?v=' . rawurlencode($this->appManager->getAppVersion(Application::APP_ID));
				}
			}
		}
		return $this->nextcloud->getMimeIconUrl($mime);
	}
}
