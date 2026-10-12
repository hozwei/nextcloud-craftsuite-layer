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
 *  - Its interface language comes only from its own preferences, the JSON in localStorage
 *    'pdfcraft' (formerly 'printcraft'), field 'language': 'auto' (English on the web) or one of
 *    its codes in any letter case (apps/pdfcraft-web/src/main.rs:27-29, crates/ui-egui/src/lib.rs
 *    1454-1456). It reads them once when the app is created, and Edit > Preferences stores the
 *    user's choice there.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // The languages the web build shows, BCP 47 tag -> PdfCraft's code. Left out: zh-Hans, zh-Hant
  // and te, which it draws with missing glyphs.
  const LANGUAGES = { en: 'en', ar: 'ar', bg: 'bg', cs: 'cs', de: 'de', es: 'es', fr: 'fr', hu: 'hu', it: 'it', ja: 'ja', pl: 'pl', 'pt-BR': 'pt-br', ru: 'ru', uk: 'uk' };
  const PREFS = 'pdfcraft';
  // The codes this adapter has written (a JSON list). A stored language that is none of them (and
  // not 'auto') is the user's own choice in the app, which the host's language does not replace.
  // A list, not the last code: a PdfCraft that is still open writes its preferences back from
  // memory (every 30 s and when it loses the focus), so a language from an earlier start can come
  // back after a later start wrote another.
  const MARK = 'craftsuite-layer:pdfcraft:language';
  const written = () => {
    try {
      const list = JSON.parse(localStorage.getItem(MARK) ?? '[]');
      return Array.isArray(list) ? list.filter((code) => typeof code === 'string') : [];
    } catch {
      return [];
    }
  };

  window.craftsuiteLayer.register({
    app: 'pdfcraft',
    // The host's language, written into PdfCraft's preferences before its module reads them. With
    // no host language, a value this adapter wrote goes back to 'auto'. Blocked or unreadable
    // storage is left alone: PdfCraft then starts as it would without the layer.
    language(tag, util) {
      try {
        const key = util.matchLanguage(tag, LANGUAGES);
        const raw = localStorage.getItem(PREFS) ?? localStorage.getItem('printcraft');
        const prefs = raw === null ? {} : JSON.parse(raw);
        if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return null;
        const stored = typeof prefs.language === 'string' ? prefs.language.toLowerCase() : 'auto';
        const marks = written();
        if (stored !== 'auto' && !marks.includes(stored)) return null;
        const code = key ? LANGUAGES[key] : marks.length > 0 ? 'auto' : null;
        if (code === null) return null;
        prefs.language = code;
        localStorage.setItem(PREFS, JSON.stringify(prefs));
        if (key) localStorage.setItem(MARK, JSON.stringify([...new Set([...marks, code])]));
        else localStorage.removeItem(MARK);
        return key;
      } catch {
        return null;
      }
    },
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
