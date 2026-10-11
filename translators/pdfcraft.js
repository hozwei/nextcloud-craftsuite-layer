/*
 * craftsuite-layer adapter for PdfCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What PdfCraft (web build, checked with 0.6.0) does and why the rules
 * below follow from it is described in docs/apps/pdfcraft.md:
 *  - It takes dropped files on its canvas; the core's default drop target fits.
 *  - Every download (Save, Print to PDF, exports, Action Wizard, split parts) is a Blob behind a
 *    detached <a download>. Its type is always application/pdf, so it says nothing. (With
 *    '?host=parent' in its URL, 0.6.0 posts saves to a parent on its own origin instead; the
 *    hosting must not set it.)
 *  - Save names the file exactly like the opened document. It writes an incremental update (the
 *    saved bytes start with the bytes last saved), except after redaction, Sanitize document,
 *    Remove hidden information or a security change, or for a file it repaired on open: then it
 *    rewrites the whole file, and every later Save appends to the bytes it wrote. The Action
 *    Wizard also uses the document's name but rewrites the file, so the name alone does not
 *    identify a save.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  window.craftsuiteLayer.register({
    app: 'pdfcraft',
    // A rewritten Save arrives as an export (a new file; the opened file keeps what was removed).
    // PdfCraft goes on editing the bytes it wrote, so the core sends a later save that extends
    // such a stored export as the document, with `follows` naming that export: the host keeps
    // saving into the new file instead of making another one per save.
    continuesExports: true,
    // 'document' may replace the opened file; everything else becomes a new file.
    // Known gap: the Action Wizard on a signed PDF also writes incrementally and passes as 'document'.
    async classify(save, entry, util) {
      if (save.name !== entry.name) return 'export';
      return (await util.extendsOpened(save.bytes, entry)) ? 'document' : 'export';
    },
  });
})();
