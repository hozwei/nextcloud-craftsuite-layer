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
 * The form with one address per Craft app, the language it starts in and whether it is the default
 * app for all its types (templates/admin.php, src/admin.ts). The page is rendered on the server;
 * the script only names the languages, submits the form to SettingsController and shows the result.
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
			$language = $this->craftApps->storedLanguage($app);
			$apps[$app] = [
				'name' => $info['name'],
				'url' => $url,
				'problem' => $url === '' ? null : $this->craftApps->problem($url),
				'languages' => $info['languages'],
				'language' => $language,
				'languageProblem' => $this->craftApps->languageProblem($app, $language),
				// null: only Craft apps open its types, a click always opens them in it.
				'defaultApp' => CraftApps::sharedExtensions($app) === [] ? null : $this->craftApps->isDefaultApp($app),
				'hint' => $this->craftApps->hint($app),
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
