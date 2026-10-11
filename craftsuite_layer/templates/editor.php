<?php
// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** @var array $_ */
/** @var \OCP\IL10N $l */
?>
<?php /* id app-content: the target of Nextcloud's "Skip to main content" link. */ ?>
<div id="app-content" class="craftsuite-editor" data-state="<?php p(isset($_['error']) ? 'error' : (isset($_['confirm']) ? 'confirm' : 'loading')); ?>">
<?php if (isset($_['error'])): ?>
	<p class="craftsuite-editor__message"><?php p($_['error']); ?></p>
<?php elseif (isset($_['confirm'])): ?>
	<?php /* Not opened from Files or a typed address (another site, a link Files opened by itself, a
		sign-in in between): nothing is read or framed until the user confirms here. The button
		carries the session's request token, which opens the editor directly. */ ?>
	<div class="craftsuite-editor__message">
		<p><strong><?php p($l->t('Open %1$s in %2$s?', [$_['fileName'], $_['appName']])); ?></strong></p>
		<p><?php p($l->t('Nextcloud cannot tell whether you opened this file yourself: links from other sites can open this page too. Continue only if you meant to open this file.')); ?></p>
		<p class="craftsuite-editor__actions">
			<a class="craftsuite-editor__open button primary" href="<?php p($_['openUrl'] . (str_contains($_['openUrl'], '?') ? '&' : '?') . 'requesttoken=' . rawurlencode($_['requesttoken'])); ?>"><?php p($l->t('Open in %s', [$_['appName']])); ?></a>
			<a class="craftsuite-editor__close button" href="<?php p($_['filesUrl']); ?>"><?php p($l->t('Close')); ?></a>
		</p>
	</div>
<?php else: ?>
	<div class="craftsuite-editor__bar">
		<span class="craftsuite-editor__name"><?php p($_['fileName']); ?></span>
		<span class="craftsuite-editor__status" role="status" aria-live="polite"><?php p($l->t('Loading %s …', [$_['appName']])); ?></span>
		<a class="craftsuite-editor__close button" href="<?php p($_['filesUrl']); ?>"><?php p($l->t('Close')); ?></a>
	</div>
	<?php /* Saves that could not be stored and whose only copy the page holds (src/editor.ts). */ ?>
	<ul class="craftsuite-editor__offers" aria-live="polite"></ul>
	<?php /* No top navigation for the framed app; popups for its links; downloads for its fallback.
		Only clipboard-write is delegated: the apps paste from paste events and never read the
		clipboard, which would otherwise happen under Nextcloud's permission. */ ?>
	<iframe class="craftsuite-editor__frame"
		title="<?php p($_['appName']); ?>"
		allow="clipboard-write"
		sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals"
		referrerpolicy="no-referrer"></iframe>
<?php endif; ?>
</div>
