<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Listener;

use OCA\CraftsuiteLayer\Service\NewFiles;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Template\FileCreatedFromTemplateEvent;

/**
 * Gives a file Nextcloud just created without a template the Craft app's blank document
 * (lib/Service/NewFiles.php). Registered to run after other apps' listeners, which write their own
 * blank into every new file of their formats.
 *
 * @template-implements IEventListener<FileCreatedFromTemplateEvent>
 */
class FillNewFile implements IEventListener {
	/** Below the default of 0: the other apps' listeners run first. */
	public const PRIORITY = -100;

	public function __construct(
		private NewFiles $newFiles,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof FileCreatedFromTemplateEvent || $event->getTemplate() !== null) {
			return;
		}
		$this->newFiles->fill($event->getTarget());
	}
}
