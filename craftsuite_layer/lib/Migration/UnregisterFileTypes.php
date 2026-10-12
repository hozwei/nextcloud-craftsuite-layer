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
 * Takes the Craft file types (FileTypes) back. Nextcloud runs the uninstall steps of
 * appinfo/info.xml on every disable, also on occ app:remove (unless --keep-data) and when an
 * update disables the app as incompatible.
 */
class UnregisterFileTypes implements IRepairStep {
	public function __construct(
		private FileTypes $fileTypes,
		private LoggerInterface $logger,
	) {
	}

	public function getName(): string {
		return 'Remove the file types of the Craft apps';
	}

	public function run(IOutput $output): void {
		// Without the types Files only shows Nextcloud's icons: never a reason to stop an enable or
		// a disable (Nextcloud's repair runner catches only \Exception).
		try {
			$output->info($this->fileTypes->unregister());
		} catch (\Throwable $e) {
			$this->logger->error('Could not remove the file types of the Craft apps', ['app' => 'craftsuite_layer', 'exception' => $e]);
			$output->warning('Could not remove the file types of the Craft apps: ' . $e->getMessage());
		}
	}
}
