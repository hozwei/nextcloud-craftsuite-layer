<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer;

use OCA\CraftsuiteLayer\Service\CraftApps;
use OCA\CraftsuiteLayer\Service\FileTypes;
use OCP\Config\Lexicon\Entry;
use OCP\Config\Lexicon\ILexicon;
use OCP\Config\Lexicon\Strictness;
use OCP\Config\ValueType;
use OCP\IAppConfig;

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
			// Only for apps the layer can start in a chosen language.
			if ($info['languages'] !== []) {
				$entries[] = new Entry(
					key: CraftApps::languageKey($app),
					type: ValueType::STRING,
					defaultRaw: '',
					definition: 'Language ' . $info['name'] . ' starts in: empty = as the app decides, user = the user\'s Nextcloud language, or one of ' . implode(', ', $info['languages']),
					// Read only by the editor page and the settings page.
					lazy: true,
					note: 'occ does not check the value; another one counts as empty, and the admin settings page says so.',
				);
			}
		}
		$entries[] = new Entry(
			key: FileTypes::KEY,
			type: ValueType::STRING,
			defaultRaw: '',
			definition: 'The MIME type mappings and aliases this app added to Nextcloud\'s config/mimetypemapping.json and mimetypealiases.json (JSON); it removes them when it is disabled',
			// Read on every page of a logged-in user (src/aliases.ts), so not lazy.
			lazy: false,
			flags: IAppConfig::FLAG_INTERNAL,
		);
		return $entries;
	}

	public function getUserConfigs(): array {
		return [];
	}
}
