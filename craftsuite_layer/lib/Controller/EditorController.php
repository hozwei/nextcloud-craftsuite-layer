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
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\Storage\ISharedStorage;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Util;

/**
 * The editor page: frames a Craft app and lets the page's script hand the file to it and store
 * what the app saves (docs/architecture.md). The page only describes the file and where it lives
 * in WebDAV; the browser reads and writes it as the logged-in user, so Nextcloud's own checks
 * (permissions, locks, quota, versions) apply.
 */
class EditorController extends Controller {
	public function __construct(
		IRequest $request,
		private CraftApps $craftApps,
		private IRootFolder $rootFolder,
		private IUserSession $userSession,
		private IInitialState $initialState,
		private IURLGenerator $urlGenerator,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/edit/{fileId}', requirements: ['fileId' => '\d+'])]
	public function edit(int $fileId, string $app = ''): TemplateResponse {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return $this->error($this->l->t('You are not logged in.'), Http::STATUS_UNAUTHORIZED);
		}
		$userFolder = $this->rootFolder->getUserFolder($user->getUID());
		$node = $userFolder->getFirstNodeById($fileId);
		if (!$node instanceof File || !$node->isReadable()) {
			return $this->error($this->l->t('The file does not exist or you cannot read it.'), Http::STATUS_NOT_FOUND);
		}
		// A share without download permission may still be viewed (and read through WebDAV, with
		// shareapi_allow_view_without_download, the default), but handing it to a Craft app, which
		// can save and export it, would be a download.
		$storage = $node->getStorage();
		if ($storage->instanceOfStorage(ISharedStorage::class)) {
			/** @var ISharedStorage $storage */
			if (!$storage->getShare()->canDownload()) {
				return $this->error($this->l->t('This file is shared without permission to download it, so it cannot be opened in a Craft app.'), Http::STATUS_FORBIDDEN);
			}
		}
		// The app comes from the Files entry the user chose (?app=); without it, the app that opens
		// this type of file. Either way only an app the admin configured, and only for its types.
		$app = $app !== '' ? $app : (CraftApps::forFileName($node->getName(), $this->craftApps->configured(), $this->craftApps->defaultApps()) ?? '');
		if (!CraftApps::opens($app, $node->getName())) {
			return $this->error($this->l->t('No Craft app opens this type of file.'), Http::STATUS_BAD_REQUEST);
		}
		if ($this->craftApps->isDisabled($app)) {
			return $this->error($this->l->t('%s is switched off. An administrator has to switch it on first.', [CraftApps::APPS[$app]['name']]), Http::STATUS_SERVICE_UNAVAILABLE);
		}
		// Its own address, else the one it takes from the address for all apps.
		$stored = $this->craftApps->address($app);
		if ($stored === '') {
			return $this->error($this->l->t('%s is not configured. An administrator has to set its address first.', [CraftApps::APPS[$app]['name']]), Http::STATUS_SERVICE_UNAVAILABLE);
		}
		$problem = $this->craftApps->problem($stored);
		if ($problem !== null) {
			return $this->error($this->l->t('The address of %1$s cannot be used: %2$s An administrator has to change it.', [CraftApps::APPS[$app]['name'], $problem]), Http::STATUS_SERVICE_UNAVAILABLE);
		}
		$appUrl = $stored;

		$path = $userFolder->getRelativePath($node->getPath());
		if ($path === null) {
			return $this->error($this->l->t('The file does not exist or you cannot read it.'), Http::STATUS_NOT_FOUND);
		}
		$dir = dirname($path);
		$filesUrl = $this->urlGenerator->linkToRoute('files.view.index', ['dir' => $dir]);

		// The page hands the file to the Craft origin as soon as it loads. Any site, the Craft
		// origin included, can open this address with the user's session cookie (SameSite=Lax):
		// with a link, a popup or a redirect, and also as a same-origin navigation, through Files,
		// which opens a file of a link to /f/<id> by itself, or through the sign-in page's redirect.
		// So the editor opens directly only for an address the user typed, bookmarked or opened
		// from outside the browser (Sec-Fetch-Site: none), or with the session's request token,
		// which Files' entry adds on a click of the user (src/files.ts) and the question's button
		// carries. Everything else, browsers without Sec-Fetch-Site included, asks first.
		if ($this->request->getHeader('Sec-Fetch-Site') !== 'none' && !$this->request->passesCSRFCheck()) {
			Util::addStyle(Application::APP_ID, 'editor');
			return self::isolated(new TemplateResponse(Application::APP_ID, 'editor', [
				'confirm' => true,
				'appName' => CraftApps::APPS[$app]['name'],
				'fileName' => $node->getName(),
				'openUrl' => $this->urlGenerator->linkToRoute('craftsuite_layer.editor.edit', ['fileId' => $fileId, 'app' => $app]),
				'filesUrl' => $filesUrl,
			]));
		}

		$dav = $this->urlGenerator->linkTo('', 'remote.php') . '/dav/files/' . rawurlencode($user->getUID());
		$this->initialState->provideInitialState('editor', [
			'app' => $app,
			'appName' => CraftApps::APPS[$app]['name'],
			'appUrl' => $appUrl,
			// The language the app is to start in (a BCP 47 tag), or null to let it decide.
			'language' => $this->craftApps->startLanguage($app),
			'file' => [
				'id' => $node->getId(),
				'name' => $node->getName(),
				'mime' => $node->getMimetype(),
				'url' => $dav . self::encodePath($path),
				'updatable' => $node->isUpdateable(),
			],
			'folderUrl' => $dav . rtrim(self::encodePath($dir), '/') . '/',
			'filesUrl' => $filesUrl,
		]);
		Util::addScript(Application::APP_ID, 'editor');
		Util::addStyle(Application::APP_ID, 'editor');

		$response = new TemplateResponse(Application::APP_ID, 'editor', [
			'appName' => CraftApps::APPS[$app]['name'],
			'fileName' => $node->getName(),
			'filesUrl' => $filesUrl,
		]);
		$csp = new ContentSecurityPolicy();
		$csp->addAllowedFrameDomain(CraftApps::origin($appUrl));
		$response->setContentSecurityPolicy($csp);
		return self::isolated($response);
	}

	private function error(string $message, int $status): TemplateResponse {
		Util::addStyle(Application::APP_ID, 'editor');
		$response = new TemplateResponse(Application::APP_ID, 'editor', ['error' => $message]);
		$response->setStatus($status);
		return self::isolated($response);
	}

	/**
	 * Every answer of this route opens in a browsing context group of its own: a window that the
	 * framed app (or a link in a document) opens gets no handle on this page, so it cannot
	 * navigate the Nextcloud tab, for example to a fake login page. Browsers apply it on https
	 * and on localhost.
	 */
	private static function isolated(TemplateResponse $response): TemplateResponse {
		$response->addHeader('Cross-Origin-Opener-Policy', 'same-origin');
		return $response;
	}

	private static function encodePath(string $path): string {
		return implode('/', array_map('rawurlencode', explode('/', $path)));
	}
}
