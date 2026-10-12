<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Listener;

use OCA\CraftsuiteLayer\Service\NewFiles;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Template\RegisterTemplateCreatorEvent;

/**
 * The Craft apps' entries in the "+ New" menu of Files: Nextcloud asks for them when it lists the
 * ways to create a file (lib/Service/NewFiles.php).
 *
 * @template-implements IEventListener<RegisterTemplateCreatorEvent>
 */
class RegisterNewFileCreators implements IEventListener {
	public function __construct(
		private NewFiles $newFiles,
	) {
	}

	public function handle(Event $event): void {
		if ($event instanceof RegisterTemplateCreatorEvent) {
			$this->newFiles->register($event->getTemplateManager());
		}
	}
}
