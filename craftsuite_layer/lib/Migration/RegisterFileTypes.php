<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Migration;

use OCA\CraftsuiteLayer\Service\FileTypes;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;
use Psr\Log\LoggerInterface;

/**
 * Registers the Craft file types (FileTypes) on every enable and app update. Nextcloud runs the
 * install steps of appinfo/info.xml on every enable and the post-migration steps after an update.
 */
class RegisterFileTypes implements IRepairStep {
	public function __construct(
		private FileTypes $fileTypes,
		private LoggerInterface $logger,
	) {
	}

	public function getName(): string {
		return 'Register the file types of the Craft apps';
	}

	public function run(IOutput $output): void {
		// Without the types Files only shows Nextcloud's icons: never a reason to stop an enable or
		// a disable (Nextcloud's repair runner catches only \Exception).
		try {
			$output->info($this->fileTypes->register());
		} catch (\Throwable $e) {
			$this->logger->error('Could not register the file types of the Craft apps', ['app' => 'craftsuite_layer', 'exception' => $e]);
			$output->warning('Could not register the file types of the Craft apps: ' . $e->getMessage());
		}
	}
}
