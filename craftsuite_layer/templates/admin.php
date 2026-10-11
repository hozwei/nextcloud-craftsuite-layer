<?php
// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** @var array $_ */
/** @var \OCP\IL10N $l */
?>
<div id="craftsuite-layer-admin" class="section">
	<h2><?php p($l->t('Craft app addresses')); ?></h2>
	<p class="settings-hint"><?php p($l->t('Where each Craft app is hosted, for example https://craft.example.com/pdfcraft/. The address must use https and another host name than Nextcloud, and its hosting must allow this Nextcloud. Files offers "Open in …" only for apps with an address.')); ?></p>
	<form class="craftsuite-admin" novalidate>
<?php foreach ($_['apps'] as $id => $app):
	$hint = $l->t('Opens: %s', [implode(', ', array_map(fn (string $e) => '.' . $e, $app['extensions']))]); ?>
		<div class="craftsuite-admin__row">
			<label for="craftsuite-layer-<?php p($id); ?>"><?php p($app['name']); ?></label>
			<input id="craftsuite-layer-<?php p($id); ?>" name="<?php p($id); ?>" type="url" value="<?php p($app['url']); ?>"
				placeholder="https://craft.example.com/<?php p($id); ?>/" autocomplete="off" spellcheck="false"
				aria-describedby="craftsuite-layer-<?php p($id); ?>-hint"<?php if ($app['problem'] !== null): ?> aria-invalid="true"<?php endif; ?>>
			<span id="craftsuite-layer-<?php p($id); ?>-hint" data-hint="<?php p($hint); ?>"
				class="craftsuite-admin__hint<?php if ($app['problem'] !== null): ?> craftsuite-admin__hint--error<?php endif; ?>"><?php p($app['problem'] ?? $hint); ?></span>
		</div>
<?php endforeach; ?>
		<div class="craftsuite-admin__actions">
			<button type="submit" class="button primary"><?php p($l->t('Save')); ?></button>
			<span class="craftsuite-admin__status" role="status" aria-live="polite"></span>
		</div>
	</form>
</div>
