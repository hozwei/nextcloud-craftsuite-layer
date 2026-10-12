// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test adapter for the stub app: PdfCraft's classify (translators/pdfcraft.js), without its
// continuesExports, and with optional adapter members PdfCraft does not use. The test server loads
// it instead of the app's adapter for adapter=stub (see server/serve.mjs). Each member is switched
// on by a query parameter of the app's URL (the test host passes app-<name>=<value> through):
//   adapter-drop=<ms>  dropTargetTimeout
//   identity=1         identity(bytes): the text of the last '/StubId (<text>)' in the bytes, or
//                      null without one (so the probe and the other test files have none)
//   copy=<name>        a save under <name>, of a file opened as <name>, that still holds the text
//                      'from another program' is a 'copy' (a file the app would save with losses:
//                      the first save becomes a new file, later ones replace it); others are exports
//   language=<tags>    language(tag, util): the app 'shows' these comma-separated BCP 47 tags;
//                      returns util.matchLanguage(tag, ...) and records each call in
//                      window.__stubLanguage ({tag, key, href, name}); prefer=1 also calls
//                      util.preferLanguages(key)
'use strict';

(() => {
  if (!window.craftsuiteLayer) return; // core inactive
  const params = new URLSearchParams(location.search);
  const adapter = {
    app: 'stub',
    async classify(save, entry, util) {
      if (save.name !== entry.name) return 'export';
      if (params.has('copy') && entry.name === params.get('copy')) {
        return new TextDecoder('latin1').decode(save.bytes).includes('from another program') ? 'copy' : 'export';
      }
      return (await util.extendsOpened(save.bytes, entry)) ? 'document' : 'export';
    },
  };
  if (params.has('adapter-drop')) adapter.dropTargetTimeout = Number(params.get('adapter-drop'));
  if (params.has('language')) {
    const table = Object.fromEntries(params.get('language').split(',').filter(Boolean).map((tag) => [tag, tag]));
    adapter.language = (tag, util) => {
      const key = util.matchLanguage(tag, table);
      if (key && params.get('prefer') === '1') util.preferLanguages(key);
      (window.__stubLanguage = window.__stubLanguage || []).push({ tag, key, href: location.href, name: window.name });
      return key;
    };
  }
  if (params.get('identity') === '1') {
    adapter.identity = (bytes) => {
      const ids = [...new TextDecoder('latin1').decode(bytes).matchAll(/\/StubId \(([^)]*)\)/g)];
      return ids.length ? ids[ids.length - 1][1] : null;
    };
  }
  window.craftsuiteLayer.register(adapter);
})();
