/*
 * craftsuite-layer adapter for LightCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What LightCraft (web build, checked with 0.6.0) does and why the rules
 * below follow from it is described in docs/apps/lightcraft.md. Source references are to the
 * v0.6.0 tag; web.rs, backend.rs, bench.rs and safety.rs are in apps/lightcraft-web/src/, the
 * other paths under crates/.
 *  - LightCraft is a photo library and raw developer, not a document editor. A dropped file is
 *    imported into the library and selected (web.rs:476-496); a second drop adds a second photo.
 *    eframe reads the dropped files and does not check isTrusted. Its drop listener is the page's
 *    first and comes once the library and the graphics run (web.rs:665-705), so the core's
 *    default drop target (the canvas) and its `ready` fit.
 *  - By default the library lives in the browser's storage for the app's origin, OPFS or else
 *    IndexedDB, with the bytes of every imported photo, and is kept across visits (web.rs:278-363,
 *    backend.rs): a second copy of the user's photos next to Nextcloud. The page reads `?store`,
 *    `?workers`, `?reset` and `?bench` from its URL when its module starts (web.rs:67-96).
 *    `store=memory` keeps nothing; in that mode the render workers cannot read a photo (they read
 *    originals from storage), so `workers=0` renders on the page, which holds the bytes. `bench`
 *    runs a scripted measurement: once the thumbnails are done, it selects the first photo of the
 *    grid (a demo photo) and drags its Exposure (bench.rs:69-112). This adapter therefore sets
 *    `?store=memory&workers=0` (and drops `reset` and `bench`) with history.replaceState before
 *    the module runs (both scripts run in <head>, the module is deferred), and its started() asks
 *    the app (`lightcraft.command('web.stats')`, the automation call index.html exposes,
 *    web.rs:576-617) whether the library is in memory and no worker runs. If not, or if it cannot
 *    tell, the host gets a startup error and no file is handed over. In memory mode the page also
 *    skips its Web Lock and the persistent-storage request.
 *  - Nothing saves the opened file. Save (Ctrl+S) is Save Metadata to File, an XMP sidecar written
 *    with std::fs, which fails on the web without a download (engine/src/cmd/xmp.rs:72-80,
 *    engine/src/sidecar.rs:475-486). Export (File > Export..., Shift+E; Export with Previous,
 *    Ctrl+E) renders the photo with its edits and downloads '<stem>.jpg|png|tif|webp'
 *    (engine/src/export.rs:577-620, 1035-1052): for an opened JPEG that is the opened name, a new,
 *    lossy rendering (by default 2048 px on the long edge). The formats Original files and DNG read
 *    the original with std::fs and fail on the web; AVIF is not compiled into the web build.
 *  - Every download is a Blob typed after the extension behind a detached <a download> that is
 *    clicked; the URL is revoked after 5 s (web.rs:142-165).
 *  - The page never dispatches TrunkApplicationStarted. A failed load or start shows only as text:
 *    'LightCraft failed to load: ...' in #lightcraft_loading (index.html), 'LightCraft failed to
 *    start: ...' in #lightcraft_status (web.rs:699-702), and a panic covers the page with
 *    #lightcraft_blocking (safety.rs:49-89). None raises an error event, so the core would report
 *    the failure only after data-startup-timeout, as 'the app did not start in time'. This adapter
 *    raises those texts as error events until the app has a drop target (the core reports them at
 *    once), and its started() fails on them after that. A panic after `ready` reaches no one: the
 *    protocol has no message for it (docs/apps/lightcraft.md, known gaps).
 *
 * Rules: every download is an export (a new file next to the original); nothing is ever
 * 'document' or 'copy'. The photo stays in the frame's memory and is gone when the frame closes.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  const LOADING = 'lightcraft_loading';
  const STATUS = 'lightcraft_status';
  const BLOCKING = 'lightcraft_blocking';
  // How long started() waits for the app to answer web.stats (it answers on its next frame).
  const STATS_WAIT_MS = 30000;

  // Keep nothing in browser storage, and render where the photo's bytes are (see the header).
  // Runs before the app's module reads location.search. `reset` would delete a stored library,
  // which memory mode never opens; `bench` would select another photo and change its Exposure.
  try {
    const url = new URL(location.href);
    url.searchParams.set('store', 'memory');
    url.searchParams.set('workers', '0');
    url.searchParams.delete('reset');
    url.searchParams.delete('bench');
    if (url.href !== location.href) history.replaceState(history.state, '', url.href);
  } catch { /* started() refuses to go on unless the library is in memory */ }

  // What the page says when LightCraft cannot run: a failed load or start, or the cover that a
  // panic (or another tab holding the library, not in memory mode) puts over the page.
  const failureText = () => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    };
    const blocking = text(BLOCKING);
    if (blocking) return blocking;
    for (const id of [LOADING, STATUS]) {
      if (/^LightCraft failed to (load|start)\b/.test(text(id))) return text(id);
    }
    return null;
  };

  // The page writes those texts into its DOM, which otherwise hardly changes. Until the app has a
  // drop target, a text is raised as an error event, which the core reports as a failed load at
  // once; afterwards started() takes over (onFailure), until the app is ready.
  const raise = (text) => {
    const error = new Error(text);
    if (typeof window.reportError === 'function') window.reportError(error);
    else setTimeout(() => { throw error; });
  };
  let onFailure = raise;
  const observer = new MutationObserver(() => {
    const text = onFailure && failureText();
    if (!text) return;
    const handle = onFailure;
    onFailure = null;
    observer.disconnect();
    handle(text);
  });
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });

  // The interface language: the web build reads none at start (in memory mode it has no stored
  // ui.json, so it starts in English), but its automation call takes the Edit > Language commands
  // (crates/ui-egui/src/menus.rs:16-51). BCP 47 tag -> command name. The language is set in
  // started(), before web.stats, so it applies from the app's first frame on; `ready` reports it
  // only if the app answered with a code.
  const LANGUAGES = { en: 'english', de: 'german', es: 'spanish', fr: 'french', ja: 'japanese', 'pt-BR': 'portuguese', ru: 'russian', uk: 'ukrainian', 'zh-Hans': 'simplifiedChinese', 'zh-Hant': 'traditionalChinese' };
  let wantedLanguage = null;
  let settleLanguage = () => undefined;
  const languageApplied = new Promise((resolve) => { settleLanguage = resolve; });
  // The command runs on the app's next frame, like web.stats.
  const LANGUAGE_WAIT_MS = 10000;
  const applyLanguage = async (api) => {
    if (!wantedLanguage) return settleLanguage(null);
    let timer;
    try {
      const answer = JSON.parse(await Promise.race([
        api.command('app.language.' + LANGUAGES[wantedLanguage], '{}'),
        new Promise((resolve, reject) => { timer = setTimeout(reject, LANGUAGE_WAIT_MS, new Error('no answer')); }),
      ]));
      settleLanguage(typeof answer === 'string' && answer ? wantedLanguage : null);
    } catch (error) {
      // The app goes on in its own language; this is no reason to fail the start.
      console.warn('[craftsuite-layer] LightCraft did not take the language', error);
      settleLanguage(null);
    } finally {
      clearTimeout(timer);
    }
  };

  window.craftsuiteLayer.register({
    app: 'lightcraft',
    language(tag, util) {
      wantedLanguage = util.matchLanguage(tag, LANGUAGES);
      return wantedLanguage ? languageApplied : null;
    },
    // Ready only with the library in memory and no render workers: otherwise the photo would be
    // copied into the browser's storage (or would not render). web.stats runs on the app's next
    // frame; a frame that never comes, or a failure text, is a failed start.
    started() {
      return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => finish(new Error('the app did not get ready in time')), STATS_WAIT_MS);
        const finish = (error) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          onFailure = null;
          observer.disconnect();
          if (error) reject(error);
          else resolve();
        };
        const failed = (text) => finish(new Error('the app failed to start: ' + text));
        // Also a text that is already there (raised before, while the core waited for the drop
        // target).
        const text = failureText();
        if (text) {
          failed(text);
          return;
        }
        onFailure = failed;
        observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
        const api = window.lightcraft;
        if (!api || typeof api.command !== 'function') {
          finish(new Error('the app cannot confirm that it keeps nothing in browser storage'));
          return;
        }
        Promise.resolve().then(() => applyLanguage(api)).then(() => api.command('web.stats', '{}')).then((answer) => {
          const stats = JSON.parse(answer);
          if (!stats || stats.storage !== 'memory') {
            finish(new Error('the app would keep the photo in browser storage (' + String(stats && stats.storage) + ')'));
          } else if (!stats.workers || stats.workers.alive !== 0) {
            finish(new Error('the app would render in workers that cannot read the photo'));
          } else {
            finish(null);
          }
        }).catch((error) => {
          finish(new Error('the app cannot confirm that it keeps nothing in browser storage: ' + String(error && error.message || error)));
        });
      });
    },
    // No download of LightCraft is a save of the opened file: exports are renderings of the photo
    // with its edits (lossy, by default resized), also when they take the opened file's name.
    classify() {
      return 'export';
    },
  });
})();
