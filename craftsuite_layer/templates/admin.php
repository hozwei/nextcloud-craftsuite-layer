<?php
// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** @var array $_ */
/** @var \OCP\IL10N $l */
?>
<div id="craftsuite-layer-admin" class="section">
	<h2><?php p($l->t('Craft app addresses')); ?></h2>
<?php if (!$_['enabledForUser']): ?>
	<p class="settings-hint craftsuite-admin__warning"><?php p($l->t('This app is enabled only for groups you are not in, so Nextcloud does not let you save these settings. Add yourself to one of those groups, or set the values with occ config:app:set craftsuite_layer.')); ?></p>
<?php endif; ?>
	<p class="settings-hint"><?php p($l->t('Where each Craft app is hosted, for example https://craft.example.com/pdfcraft/. The address must use https and another host name than Nextcloud, and its hosting must allow this Nextcloud. Files offers "Open in …" only for apps with an address.')); ?></p>
	<p class="settings-hint"><?php p($l->t('With an address for all apps, each app without an address of its own is in a folder of that address named after it, for example https://craft.example.com/soundcraft/: an app that a new version of this Nextcloud app brings then needs no setting. Untick an app to keep it out of Files, such as one your hosting does not serve.')); ?></p>
	<p class="settings-hint"><?php p($l->t('The language each app starts in: the app\'s own default, the user\'s Nextcloud language, or a fixed one. A language a user picks inside PdfCraft, PhotoCraft or CADCraft stays theirs.')); ?></p>
	<p class="settings-hint"><?php p($l->t('On a click in Files, an app opens the file types no other app opens. Made the default app, it also opens the types another app opens (the Viewer, Nextcloud Office, ONLYOFFICE, Euro-Office), and that app stays in the file\'s menu. The line under each app says which types a click opens in it.')); ?></p>
	<form class="craftsuite-admin" novalidate>
		<div class="craftsuite-admin__row craftsuite-admin__head" aria-hidden="true">
			<span></span>
			<span><?php p($l->t('Address')); ?></span>
			<span><?php p($l->t('Starts in')); ?></span>
			<span><?php p($l->t('On a click')); ?></span>
		</div>
		<div class="craftsuite-admin__row">
			<label for="craftsuite-layer-base"><?php p($l->t('All apps')); ?></label>
			<input id="craftsuite-layer-base" data-base type="url" value="<?php p($_['baseUrl']); ?>"
				placeholder="https://craft.example.com/" autocomplete="off" spellcheck="false"
				aria-describedby="craftsuite-layer-base-hint"<?php if ($_['baseProblem'] !== null): ?> aria-invalid="true"<?php endif; ?>>
			<span id="craftsuite-layer-base-hint" data-hint="<?php p($l->t('Optional. Each app without an address of its own is at this address followed by its name and a slash.')); ?>"
				class="craftsuite-admin__hint<?php if ($_['baseProblem'] !== null): ?> craftsuite-admin__hint--error<?php endif; ?>"><?php p($_['baseProblem'] ?? $l->t('Optional. Each app without an address of its own is at this address followed by its name and a slash.')); ?></span>
		</div>
<?php foreach ($_['apps'] as $id => $app):
	$hint = $app['hint'];
	$problem = $app['problem'] ?? $app['languageProblem'];
	$choices = array_merge(['user'], $app['languages']); ?>
		<div class="craftsuite-admin__row">
			<span class="craftsuite-admin__app">
				<input id="craftsuite-layer-<?php p($id); ?>-use" type="checkbox" data-use="<?php p($id); ?>"<?php if (!$app['disabled']): ?> checked<?php endif; ?>
					aria-label="<?php p($l->t('Use %s', [$app['name']])); ?>" aria-describedby="craftsuite-layer-<?php p($id); ?>-hint">
				<label for="craftsuite-layer-<?php p($id); ?>"><?php p($app['name']); ?></label>
			</span>
			<input id="craftsuite-layer-<?php p($id); ?>" name="<?php p($id); ?>" type="url" value="<?php p($app['url']); ?>"
				placeholder="<?php p($_['baseUrl'] !== '' ? \OCA\CraftsuiteLayer\Service\CraftApps::underBase($_['baseUrl'], $id) : 'https://craft.example.com/' . $id . '/'); ?>" autocomplete="off" spellcheck="false"
				aria-describedby="craftsuite-layer-<?php p($id); ?>-hint"<?php if ($app['problem'] !== null): ?> aria-invalid="true"<?php endif; ?>>
<?php if ($app['languages'] !== []): ?>
			<select id="craftsuite-layer-<?php p($id); ?>-language" data-app="<?php p($id); ?>"
				aria-label="<?php p($l->t('Language %s starts in', [$app['name']])); ?>"
				aria-describedby="craftsuite-layer-<?php p($id); ?>-hint"<?php if ($app['languageProblem'] !== null): ?> aria-invalid="true"<?php endif; ?>>
				<option value=""<?php if (!in_array($app['language'], $choices, true)): ?> selected<?php endif; ?>><?php p($l->t('App\'s default')); ?></option>
				<option value="user"<?php if ($app['language'] === 'user'): ?> selected<?php endif; ?>><?php p($l->t('User\'s Nextcloud language')); ?></option>
<?php foreach ($app['languages'] as $tag): ?>
				<option value="<?php p($tag); ?>" lang="<?php p($tag); ?>"<?php if ($app['language'] === $tag): ?> selected<?php endif; ?>><?php p($tag); ?></option>
<?php endforeach; ?>
			</select>
<?php else: ?>
			<span class="craftsuite-admin__fixed" title="<?php p($l->t('This version of %s always starts in English.', [$app['name']])); ?>"><?php p($l->t('English')); ?></span>
<?php endif; ?>
<?php if ($app['defaultApp'] !== null): ?>
			<label class="craftsuite-admin__default" title="<?php p($l->t('A click in Files also opens in %s the file types another app opens. The other app stays in the file\'s menu.', [$app['name']])); ?>">
				<input id="craftsuite-layer-<?php p($id); ?>-default" type="checkbox" data-app="<?php p($id); ?>"<?php if ($app['defaultApp']): ?> checked<?php endif; ?>
					aria-describedby="craftsuite-layer-<?php p($id); ?>-hint">
				<span><span class="hidden-visually"><?php p($app['name']); ?>: </span><?php p($l->t('Default app')); ?></span>
			</label>
<?php else: ?>
			<span class="craftsuite-admin__fixed" title="<?php p($l->t('Only Craft apps open these file types: a click opens them in %s once it has an address.', [$app['name']])); ?>"><span class="hidden-visually"><?php p($l->t('On a click')); ?>: </span><?php p($l->t('Always')); ?></span>
<?php endif; ?>
			<span id="craftsuite-layer-<?php p($id); ?>-hint" data-hint="<?php p($hint); ?>"
				class="craftsuite-admin__hint<?php if ($problem !== null): ?> craftsuite-admin__hint--error<?php endif; ?>"><?php p($problem ?? $hint); ?></span>
		</div>
<?php endforeach; ?>
		<div class="craftsuite-admin__actions">
			<button type="submit" class="button primary"><?php p($l->t('Save')); ?></button>
			<span class="craftsuite-admin__status" role="status" aria-live="polite"></span>
		</div>
	</form>
</div>
