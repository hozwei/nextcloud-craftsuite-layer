<?php
// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** @var array $_ */
/** @var \OCP\IL10N $l */
?>
<div id="craftsuite-layer-admin" class="section">
	<h2><?php p($l->t('Craft app addresses')); ?></h2>
	<p class="settings-hint"><?php p($l->t('Where each Craft app is hosted, for example https://craft.example.com/pdfcraft/. The address must use https and another host name than Nextcloud, and its hosting must allow this Nextcloud. Files offers "Open in …" only for apps with an address.')); ?></p>
	<p class="settings-hint"><?php p($l->t('The language each app starts in: the app\'s own default, the user\'s Nextcloud language, or a fixed one. A language a user picks inside PdfCraft, PhotoCraft or CADCraft stays theirs.')); ?></p>
	<form class="craftsuite-admin" novalidate>
		<div class="craftsuite-admin__row craftsuite-admin__head" aria-hidden="true">
			<span></span>
			<span><?php p($l->t('Address')); ?></span>
			<span><?php p($l->t('Starts in')); ?></span>
		</div>
<?php foreach ($_['apps'] as $id => $app):
	$hint = $l->t('Opens: %s', [implode(', ', array_map(fn (string $e) => '.' . $e, $app['extensions']))]);
	$problem = $app['problem'] ?? $app['languageProblem'];
	$choices = array_merge(['user'], $app['languages']); ?>
		<div class="craftsuite-admin__row">
			<label for="craftsuite-layer-<?php p($id); ?>"><?php p($app['name']); ?></label>
			<input id="craftsuite-layer-<?php p($id); ?>" name="<?php p($id); ?>" type="url" value="<?php p($app['url']); ?>"
				placeholder="https://craft.example.com/<?php p($id); ?>/" autocomplete="off" spellcheck="false"
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
