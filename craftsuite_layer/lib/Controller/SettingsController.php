<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\CraftsuiteLayer\Controller;

use OCA\CraftsuiteLayer\AppInfo\Application;
use OCA\CraftsuiteLayer\Service\CraftApps;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\PasswordConfirmationRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IAppConfig;
use OCP\IL10N;
use OCP\IRequest;

/**
 * Saves the Craft app addresses from the admin settings page. Administrators only (no
 * NoAdminRequired), with a recent password confirmation: the address decides where users' files
 * are sent. All fields are checked first; one bad address saves nothing.
 */
class SettingsController extends Controller {
	public function __construct(
		IRequest $request,
		private CraftApps $craftApps,
		private IAppConfig $appConfig,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/** @param array<string, mixed> $urls app id => address ('' removes it) */
	#[PasswordConfirmationRequired]
	#[FrontpageRoute(verb: 'POST', url: '/settings')]
	public function save(array $urls = []): JSONResponse {
		$errors = [];
		$values = [];
		foreach (CraftApps::APPS as $app => $info) {
			if (!array_key_exists($app, $urls)) {
				continue;
			}
			$url = is_string($urls[$app]) ? trim($urls[$app]) : null;
			if ($url === null || strlen($url) > 2000) {
				$errors[$app] = $this->l->t('Not a valid address.');
				continue;
			}
			$problem = $url === '' ? null : $this->craftApps->problem($url);
			if ($problem !== null) {
				$errors[$app] = $problem;
				continue;
			}
			$values[$app] = $url;
		}
		if ($errors !== []) {
			return new JSONResponse(['errors' => $errors], Http::STATUS_BAD_REQUEST);
		}
		foreach ($values as $app => $url) {
			if ($url === '') {
				$this->appConfig->deleteKey(Application::APP_ID, CraftApps::key($app));
			} else {
				$this->appConfig->setValueString(Application::APP_ID, CraftApps::key($app), $url);
			}
		}
		return new JSONResponse(['saved' => array_keys($values)]);
	}
}
