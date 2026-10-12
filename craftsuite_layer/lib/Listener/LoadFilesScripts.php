<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Listener;

use OCA\CraftsuiteLayer\AppInfo\Application;
use OCA\CraftsuiteLayer\Service\CraftApps;
use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCP\AppFramework\Services\IInitialState;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * Adds the "Open in <app>" entries to Files (src/files.ts), for the Craft apps an administrator
 * configured. Files dispatches the event only on its own page for a logged-in user; public share
 * pages do not, so the entries never appear there.
 *
 * @template-implements IEventListener<LoadAdditionalScriptsEvent>
 */
class LoadFilesScripts implements IEventListener {
	public function __construct(
		private CraftApps $craftApps,
		private IInitialState $initialState,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof LoadAdditionalScriptsEvent) {
			return;
		}
		$apps = [];
		$configured = $this->craftApps->configured();
		foreach ($configured as $app) {
			$apps[] = [
				'id' => $app,
				'name' => CraftApps::APPS[$app]['name'],
				'extensions' => CraftApps::APPS[$app]['extensions'],
				// One app per extension: where two configured apps have the same default, only
				// one of them gets it (CraftApps::clickApp()).
				'default' => CraftApps::clickExtensions($app, $configured),
			];
		}
		if ($apps === []) {
			return;
		}
		$this->initialState->provideInitialState('files', $apps);
		// An init script runs before Files renders its list; it also loads the translations.
		Util::addInitScript(Application::APP_ID, 'files');
	}
}
