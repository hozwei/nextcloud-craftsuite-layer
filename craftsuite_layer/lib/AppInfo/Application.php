<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\CraftsuiteLayer\AppInfo;

use OCA\CraftsuiteLayer\ConfigLexicon;
use OCA\CraftsuiteLayer\Listener\LoadFilesScripts;
use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;

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
	}

	public function boot(IBootContext $context): void {
		// Deliberately empty: boot() runs on every request that loads the app, so the work belongs
		// in the editor page and in event listeners, which run only when needed.
	}
}
