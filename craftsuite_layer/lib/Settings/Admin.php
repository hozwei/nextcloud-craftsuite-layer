<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Settings;

use OCA\CraftsuiteLayer\AppInfo\Application;
use OCA\CraftsuiteLayer\Service\CraftApps;
use OCP\App\IAppManager;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\Settings\ISettings;
use OCP\Util;

/**
 * The form with the address for all Craft apps and, per app, whether it is used, its own address,
 * the language it starts in and whether it is the default app for all its types
 * (templates/admin.php, src/admin.ts). The page is rendered on the server;
 * the script only names the languages, submits the form to SettingsController and shows the result.
 */
class Admin implements ISettings {
	public function __construct(
		private CraftApps $craftApps,
		private IAppManager $appManager,
	) {
	}

	public function getForm(): TemplateResponse {
		$apps = [];
		foreach (CraftApps::APPS as $app => $info) {
			$url = $this->craftApps->storedUrl($app);
			// Its own address (also while the app is switched off: saving checks it), else the one it
			// takes from the address for all apps.
			$address = $url !== '' ? $url : $this->craftApps->address($app);
			$language = $this->craftApps->storedLanguage($app);
			$apps[$app] = [
				'name' => $info['name'],
				'url' => $url,
				'disabled' => $this->craftApps->isDisabled($app),
				'problem' => $address === '' ? null : $this->craftApps->problem($address),
				'languages' => $info['languages'],
				'language' => $language,
				'languageProblem' => $this->craftApps->languageProblem($app, $language),
				// null: only Craft apps open its types, a click always opens them in it.
				'defaultApp' => CraftApps::sharedExtensions($app) === [] ? null : $this->craftApps->isDefaultApp($app),
				'hint' => $this->craftApps->hint($app),
			];
		}
		$base = $this->craftApps->storedBaseUrl();
		Util::addScript(Application::APP_ID, 'admin');
		Util::addStyle(Application::APP_ID, 'admin');
		return new TemplateResponse(Application::APP_ID, 'admin', [
			'apps' => $apps,
			'baseUrl' => $base,
			'baseProblem' => $base === '' ? null : $this->craftApps->problem($base),
			// Nextcloud refuses the app's routes, saving included (HTTP 412), to an administrator the
			// app is not enabled for (it is limited to groups they are not in); the page says so.
			'enabledForUser' => $this->appManager->isEnabledForUser(Application::APP_ID),
		], '');
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 10;
	}
}
