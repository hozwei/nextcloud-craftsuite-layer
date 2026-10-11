<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer;

use OCA\CraftsuiteLayer\Service\CraftApps;
use OCP\Config\Lexicon\Entry;
use OCP\Config\Lexicon\ILexicon;
use OCP\Config\Lexicon\Strictness;
use OCP\Config\ValueType;

/**
 * The app's configuration keys. Nextcloud uses this for the type and default of each key and
 * shows the definitions in occ config:app:get --details; an unknown key (a typo in occ) is
 * refused and logged (Strictness::WARNING).
 */
class ConfigLexicon implements ILexicon {
	public function getStrictness(): Strictness {
		return Strictness::WARNING;
	}

	public function getAppConfigs(): array {
		$entries = [];
		foreach (CraftApps::APPS as $app => $info) {
			$entries[] = new Entry(
				key: CraftApps::key($app),
				type: ValueType::STRING,
				defaultRaw: '',
				definition: 'Address of ' . $info['name'] . ' (https, on another host name than Nextcloud), e.g. https://craft.example.com/' . $app . '/',
				// Needed on every Files page (which entries to show), so not lazy.
				lazy: false,
				note: 'occ does not check the address; an unusable one leaves ' . $info['name'] . ' without an entry in Files, and its editor page says why. The admin settings page checks it.',
			);
		}
		return $entries;
	}

	public function getUserConfigs(): array {
		return [];
	}
}
