<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\CraftsuiteLayer\AppInfo;

use OCA\CraftsuiteLayer\ConfigLexicon;
use OCA\CraftsuiteLayer\Listener\AddMimeTypeAliases;
use OCA\CraftsuiteLayer\Listener\LoadFilesScripts;
use OCA\CraftsuiteLayer\Service\MimeIcons;
use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;

/**
 * Entry point of the app. Nextcloud finds this class through <namespace> in appinfo/info.xml
 * (OCA\<namespace>\AppInfo\Application), so the two must stay in sync.
 */
class Application extends App implements IBootstrap {
	public const APP_ID = 'craftsuite_layer';

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
		// The "Open in <app>" entries in Files. The event class belongs to the Files app; the
		// listener only runs when Files renders its page, so a missing Files app costs nothing.
		$context->registerEventListener(LoadAdditionalScriptsEvent::class, LoadFilesScripts::class);
		// Declares the <app>_url keys (Nextcloud 32+): type, default and a description for occ.
		$context->registerConfigLexicon(ConfigLexicon::class);
		// The Craft apps' icons for their file types in Files, and the aliases of those types for
		// the pages that pick icons in the browser (lib/Service/MimeIcons.php, FileTypes.php).
		MimeIcons::register($this->getContainer());
		$context->registerEventListener(BeforeTemplateRenderedEvent::class, AddMimeTypeAliases::class);
	}

	public function boot(IBootContext $context): void {
		// Deliberately empty: boot() runs on every request that loads the app, so the work belongs
		// in the editor page and in event listeners, which run only when needed.
	}
}
