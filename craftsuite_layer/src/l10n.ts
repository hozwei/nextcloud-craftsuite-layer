// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Translations for texts set with textContent. Nextcloud loads l10n/<language>.js before the
// app's scripts (Util::addScript and addInitScript do that), and @nextcloud/l10n looks them up.
// Its defaults escape and sanitise HTML, which would show '&amp;' in plain text, so both are off:
// the DOM never parses these strings.
//
// Call it as t('craftsuite_layer', 'Text {name}', { name }): translationtool and the l10n check
// find the strings by that shape (a literal app id, then a literal text).

import { translate } from '@nextcloud/l10n';

export function t(app: 'craftsuite_layer', text: string, vars?: Record<string, string | number>): string {
  return translate(app, text, vars ?? {}, { escape: false, sanitize: false });
}
