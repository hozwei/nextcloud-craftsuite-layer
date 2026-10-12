<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Listener;

use OCA\CraftsuiteLayer\AppInfo\Application;
use OCA\CraftsuiteLayer\Service\FileTypes;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Services\IInitialState;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * Gives the browser the aliases of the file types this app added (src/aliases.ts), on every page
 * of a logged-in user, for everyone: they keep Nextcloud's plain file icon for the new types where
 * a page resolves icons itself (Recommended files, Talk) and would show its cog otherwise.
 *
 * @template-implements IEventListener<BeforeTemplateRenderedEvent>
 */
class AddMimeTypeAliases implements IEventListener {
	public function __construct(
		private FileTypes $fileTypes,
		private IInitialState $initialState,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof BeforeTemplateRenderedEvent || !$event->isLoggedIn()) {
			return;
		}
		$aliases = $this->fileTypes->addedAliases();
		if ($aliases === []) {
			return;
		}
		$this->initialState->provideInitialState('aliases', $aliases);
		Util::addScript(Application::APP_ID, 'aliases');
	}
}
