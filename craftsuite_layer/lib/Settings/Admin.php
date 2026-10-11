<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Settings;

use OCA\CraftsuiteLayer\AppInfo\Application;
use OCA\CraftsuiteLayer\Service\CraftApps;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\Settings\ISettings;
use OCP\Util;

/**
 * The form with one address per Craft app (templates/admin.php, src/admin.ts). The page is
 * rendered on the server; the script only submits it to SettingsController and shows the result.
 */
class Admin implements ISettings {
	public function __construct(
		private CraftApps $craftApps,
	) {
	}

	public function getForm(): TemplateResponse {
		$apps = [];
		foreach (CraftApps::APPS as $app => $info) {
			$url = $this->craftApps->storedUrl($app);
			$apps[$app] = [
				'name' => $info['name'],
				'url' => $url,
				'extensions' => $info['extensions'],
				'problem' => $url === '' ? null : $this->craftApps->problem($url),
			];
		}
		Util::addScript(Application::APP_ID, 'admin');
		Util::addStyle(Application::APP_ID, 'admin');
		return new TemplateResponse(Application::APP_ID, 'admin', ['apps' => $apps], '');
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 10;
	}
}
