/*
 * craftsuite-layer translator core
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Runs inside an unmodified Craft web app (another origin than Nextcloud). The hosting injects it
 * into the app's index.html as a classic script in <head>, followed by the app's adapter, so both
 * run before the app's wasm module:
 *
 *   <script src="./craftsuite-layer/core.js" data-allowed-origins="https://cloud.example.com"
 *           data-app-version="0.5.0"></script>
 *   <script src="./craftsuite-layer/pdfcraft.js"></script>
 *
 * It stays inactive (the app behaves as without it; Save is a browser download) unless the page
 * is framed, an adapter registered, and the parent proved an allowed origin by answering `hello`
 * with `init`. Then it opens files the parent sends by simulating a drop, and turns the app's
 * downloads into `save` messages. The message protocol is described in docs/protocol.md.
 *
 * The host may also name the language the app should start in, in the frame's address
 * ('#craftsuite-layer:lang=de'); the adapter applies it before the app's module runs.
 */
(() => {
  'use strict';

  const LAYER_VERSION = '0.5.0';
  const PROTOCOL = 'craftsuite-layer';
  const PROTOCOL_VERSION = 1;

  const script = document.currentScript;
  const config = script ? script.dataset : {};
  const parentWin = window.parent;
  const log = (...args) => console.warn('[craftsuite-layer]', ...args);

  // Allowed parent origins: https, or http on loopback for tests. Anything else is dropped.
  const allowedOrigins = [];
  for (const entry of (config.allowedOrigins || '').split(/[\s,]+/).filter(Boolean)) {
    let url = null;
    try { url = new URL(entry); } catch { /* rejected below */ }
    const loopback = url && /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(url.hostname);
    const ok = url && url.origin !== 'null' && !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === '/' || url.pathname === '') &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback));
    if (ok) allowedOrigins.push(url.origin);
    else log('ignoring allowed origin', entry);
  }
  if (parentWin === window || allowedOrigins.length === 0) return;
  if (!window.isSecureContext || !window.crypto || !crypto.subtle) {
    log('inactive: the app is not served in a secure context (https)');
    return;
  }

  // --- The host's settings for this frame: the language the app starts in. ---------------------
  // The host frames '<address>#craftsuite-layer:lang=<BCP 47 tag>'. They are read here, before the
  // adapter and the app's module run, taken out of the address, and kept in the frame's own name,
  // so that later loads of this frame have them too: a reload, an app that reloads itself, or a
  // sign-in page of the hosting that returns without the fragment. A fragment always wins; an
  // empty or invalid one clears them. Only a language tag gets through (language, script, region:
  // 'de', 'pt-BR', 'zh-Hant'), canonicalised by the browser.
  const SETTINGS = 'craftsuite-layer:';
  const languageTag = (raw) => {
    if (typeof raw !== 'string' || raw.length > 35 || !/^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|\d{3}))?$/.test(raw)) return null;
    try {
      const tag = Intl.getCanonicalLocales(raw)[0];
      return tag && tag !== 'und' ? tag : null;
    } catch {
      return null;
    }
  };
  let hostLanguage = null;
  try {
    if (location.hash.startsWith('#' + SETTINGS)) {
      hostLanguage = languageTag(new URLSearchParams(location.hash.slice(1 + SETTINGS.length)).get('lang'));
      history.replaceState(history.state, '', location.pathname + location.search);
      window.name = hostLanguage ? SETTINGS + 'lang=' + hostLanguage : '';
    } else if (typeof window.name === 'string' && window.name.startsWith(SETTINGS)) {
      hostLanguage = languageTag(new URLSearchParams(window.name.slice(SETTINGS.length)).get('lang'));
    }
  } catch { /* no language: the app picks its own */ }
  // What adapter.language() returned: the tag the app starts in, null, or a promise of either.
  let languageResult = null;

  // Timeouts in ms from data-* attributes; anything but a positive, finite number means the default.
  const ms = (value, fallback) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; };
  const SAVE_ACK_TIMEOUT_MS = ms(config.saveAckTimeout, 10000);
  const SAVE_RESULT_TIMEOUT_MS = ms(config.saveResultTimeout, 300000);
  const STARTUP_TIMEOUT_MS = ms(config.startupTimeout, 60000);
  const DROP_TARGET_DEFAULT_MS = 3000;

  let adapter = null;
  let hostOrigin = null; // set once the parent has proven an allowed origin
  let saveSeq = 0;

  const send = (msg, transfer) => {
    if (!hostOrigin) return false;
    parentWin.postMessage({ protocol: PROTOCOL, version: PROTOCOL_VERSION, app: adapter.app, ...msg }, hostOrigin, transfer || []);
    return true;
  };

  // Names come from documents (e.g. an attachment's /UF) and go to the host: keep a plain
  // basename, as a browser download would. Direction overrides and invisible format characters
  // become '_', so a name cannot hide its real extension ('invoice\u202efdp.exe'). Shorten long
  // names keeping a short extension and whole characters, then trim, so a name never ends in a
  // dot or space.
  const MAX_NAME = 200;
  const safeName = (raw) => {
    let name = String(raw || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '_');
    if (name.length > MAX_NAME) {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
      name = name.slice(0, MAX_NAME - ext.length).replace(/[\uD800-\uDBFF]$/, '') + ext;
    }
    name = name.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
    return name || 'download';
  };

  const sha256 = async (view) => new Uint8Array(await crypto.subtle.digest('SHA-256', view));
  const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // --- Startup: where the app takes drops, and whether it started at all. ----------------------
  // The app installs its drop listener once it runs; that element receives the synthetic drop.
  let resolveDropTarget;
  let dropSeen = false;
  let appStarted = false;
  let startupFailed = false; // provisional: cleared if the app registers its drop target later
  let startupMessage = '';
  const dropTargetReady = new Promise((resolve) => { resolveDropTarget = resolve; });
  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const addEventListenerHook = function (type, listener, options) {
    if (type === 'drop' && !dropSeen) {
      dropSeen = true;
      startupFailed = false;
      if (EventTarget.prototype.addEventListener === addEventListenerHook) EventTarget.prototype.addEventListener = nativeAddEventListener;
      resolveDropTarget(this instanceof Element ? this : (document.querySelector('canvas') || document.body));
    }
    return nativeAddEventListener.call(this, type, listener, options);
  };
  EventTarget.prototype.addEventListener = addEventListenerHook;

  // Tell the host when the app cannot take files instead of leaving it waiting: no WebGL (started,
  // but no drop target), no WebAssembly, a failed .wasm download or a blocking CSP (never started).
  // `force` reports even after a drop target was seen (the adapter's started() decides then).
  const startupFailure = (message, force = false) => {
    if ((dropSeen && !force) || startupFailed) return;
    startupFailed = true;
    startupMessage = message;
    send({ type: 'error', of: 'startup', message });
  };
  let appReadyNow = false;
  nativeAddEventListener.call(window, 'TrunkApplicationStarted', () => {
    appStarted = true;
    // An adapter may need longer for apps that load more before taking drops; a valid
    // data-drop-target-timeout on the script tag still wins.
    const wait = ms(config.dropTargetTimeout, 0) || ms(adapter && adapter.dropTargetTimeout, DROP_TARGET_DEFAULT_MS);
    setTimeout(() => startupFailure('the app registered no drop target'), wait);
    setTimeout(() => { if (!appReadyNow) startupFailure('the app did not get ready in time', true); }, STARTUP_TIMEOUT_MS);
  });
  nativeAddEventListener.call(window, 'error', (event) => {
    const t = event.target;
    const fatal = event instanceof ErrorEvent || (t && (t.tagName === 'SCRIPT' || (t.tagName === 'LINK' && /preload/.test(t.rel))));
    if (!appStarted && fatal) startupFailure('the app failed to load: ' + (event.message || t.href || t.src || 'resource error'));
  }, true);
  nativeAddEventListener.call(window, 'unhandledrejection', (event) => {
    if (!appStarted) startupFailure('the app failed to load: ' + String(event.reason));
  });
  nativeAddEventListener.call(window, 'load', () => {
    setTimeout(() => { if (!appStarted) startupFailure('the app did not start in time'); }, STARTUP_TIMEOUT_MS);
  });

  // --- Keep the Blob behind each object URL: apps revoke the URL right after click(). ---------
  const blobs = new Map();
  const nativeCreateObjectURL = URL.createObjectURL;
  const nativeRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    const url = nativeCreateObjectURL.call(URL, obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    blobs.delete(url);
    return nativeRevokeObjectURL.call(URL, url);
  };

  // --- Opened files: length and hash of their current stored bytes, per name. -----------------
  // Hashes instead of copies: a large scan would otherwise be held two or three times.
  // savedName: the name the app gives this document when it saves it (adapter.savedName), so a
  // save under another name or type (an .idml saved as .designcraft) still finds its document.
  // identity: what the adapter reads from the bytes to tell documents apart (adapter.identity),
  // for apps that give new documents the same names ('Untitled-1'); null if it has none.
  const opened = new Map(); // name -> {id, name, savedName, length, hash, identity}
  const identityOf = async (bytes) => {
    if (!adapter.identity) return null;
    try {
      const value = await adapter.identity(bytes);
      return typeof value === 'string' && value ? value : null;
    } catch {
      return null;
    }
  };
  // Language and script of a tag, as the browser completes them ('de-AT' -> 'de-Latn').
  const languageAndScript = (tag) => {
    try {
      const full = new Intl.Locale(tag).maximize();
      return full.language + '-' + (full.script || '');
    } catch {
      return null;
    }
  };
  const util = {
    // True if `bytes` start with exactly the bytes last stored for `entry` (an incremental save).
    async extendsOpened(bytes, entry) {
      return bytes.length >= entry.length && sameBytes(await sha256(bytes.subarray(0, entry.length)), entry.hash);
    },
    // The key of `table` (BCP 47 tags of the languages the app shows: 'de', 'pt-BR', 'zh-Hant')
    // that fits `tag`, or null: the same tag in any letter case, else the first with the same
    // language and script ('de-AT' -> 'de', 'pt-PT' -> 'pt-BR', 'zh-TW' -> 'zh-Hant', 'zh' ->
    // 'zh-Hans'; 'sr-Latn' never matches Cyrillic 'sr').
    matchLanguage(tag, table) {
      if (typeof tag !== 'string' || !tag) return null;
      const keys = Object.keys(table);
      const exact = keys.find((key) => key.toLowerCase() === tag.toLowerCase());
      if (exact) return exact;
      const wanted = languageAndScript(tag);
      return (wanted && keys.find((key) => languageAndScript(key) === wanted)) || null;
    },
    // Makes the page report `code` as the browser's language: navigator.language, and first in
    // navigator.languages, before the browser's own. For apps that read them as they start.
    preferLanguages(code) {
      const own = [...(navigator.languages || [])].filter((l) => l.toLowerCase() !== code.toLowerCase());
      const list = Object.freeze([code, ...own]);
      Object.defineProperty(Navigator.prototype, 'language', { configurable: true, enumerable: true, get() { return code; } });
      Object.defineProperty(Navigator.prototype, 'languages', { configurable: true, enumerable: true, get() { return list; } });
    },
  };

  // --- Download interception: a detached <a download href="blob:..."> clicked by the app. ------
  // The file stays here until the host reports it stored. Without `save-received` in time, with
  // `save-result` ok:false, or without a result in time, it is downloaded as without translator.
  const pendingSaves = new Map(); // id -> {name, blob, timer, stored, posted}
  // Exports under an opened document's name that were sent to the host and not given up on, for
  // adapters whose app keeps editing on the bytes of such a save (adapter.continuesExports):
  // name -> [{id, openId, length, hash}]. Each is the start of a lineage of its own: the saves
  // that extend it continue it, whichever document of the app they come from.
  const postedExports = new Map();
  // Copies, for adapters that classify a save of the opened file as 'copy' (the opened file must
  // stay as it is, such as a file of another program that the app saves with losses): open id ->
  // id of the first such save, not given up on. Every copy is sent as the document with 'follows':
  // the first follows its own id, which the host has no file for, so it stores a new file next to
  // the original and keeps it for the lineage; the later ones follow the first and replace it.
  const copies = new Map();
  const forgetExport = (id) => {
    for (const [name, list] of postedExports) postedExports.set(name, list.filter((e) => e.id !== id));
    for (const [openId, first] of copies) if (first === id) copies.delete(openId);
  };
  const nativeClick = HTMLElement.prototype.click;
  const nativeDownload = (name, blob) => {
    const url = nativeCreateObjectURL.call(URL, blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    nativeClick.call(a);
    setTimeout(() => nativeRevokeObjectURL.call(URL, url), 60000);
  };
  const failSave = (id, message) => {
    const pending = pendingSaves.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSaves.delete(id);
    forgetExport(id); // the host has no file for it: nothing to continue
    log('save', id, 'not stored by the host (' + message + '), downloading instead');
    send({ type: 'error', of: 'save', id, message });
    // A neutral type: browsers may rename e.g. a .docx typed application/pdf to .pdf.
    nativeDownload(pending.name, new Blob([pending.blob], { type: 'application/octet-stream' }));
  };
  const arm = (id, ms, message) => {
    const pending = pendingSaves.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => failSave(id, message), ms);
  };
  // Reading, hashing and classifying run in parallel, but saves are posted in the order the app
  // started them: a host that stores them in arrival order must not let an older save replace a
  // newer one.
  const prepareSave = async (id, name, blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const entry = opened.get(name) || [...opened.values()].find((e) => e.savedName === name) || null;
    let kind = 'export';
    let copy = false;
    const identity = entry ? await identityOf(bytes) : null;
    const otherDocument = Boolean(entry && entry.identity && identity && identity !== entry.identity);
    if (entry && !otherDocument) {
      const verdict = await adapter.classify({ name, bytes }, entry, util);
      if (verdict === 'document') kind = 'document';
      else copy = verdict === 'copy';
    }
    const hash = kind === 'document' || (entry && adapter.continuesExports) ? await sha256(bytes) : null;
    return { bytes, entry, kind, copy, follows: null, identity, otherDocument, hash };
  };
  // Run in the chain, right before posting, so that it sees every export posted before it, also
  // one the host is still storing.
  const continueExport = async (id, name, prepared) => {
    const { bytes, entry, kind, copy, otherDocument } = prepared;
    if (kind !== 'export' || !entry || otherDocument) return prepared;
    if (copy) {
      prepared.kind = 'document';
      prepared.follows = copies.has(entry.id) ? copies.get(entry.id) : id;
      return prepared;
    }
    if (!adapter.continuesExports) return prepared;
    for (const previous of [...(postedExports.get(name) || [])].reverse()) {
      if (previous.openId === entry.id && (await util.extendsOpened(bytes, previous))) {
        prepared.kind = 'document';
        prepared.follows = previous.id;
        break;
      }
    }
    return prepared;
  };
  const postSave = (id, name, prepared) => {
    const pending = pendingSaves.get(id);
    if (!pending) return; // already failed over
    pending.posted = true;
    const { bytes, entry, kind, copy, follows, identity, hash } = prepared;
    // A continued export stays its own lineage: it does not become the opened file's reference.
    if (kind === 'document' && follows === null) pending.stored = { id: entry.id, name, savedName: name, length: bytes.length, hash, identity: identity || entry.identity };
    if (copy && follows === id) copies.set(entry.id, id);
    if (kind === 'export' && entry && adapter.continuesExports) {
      postedExports.set(name, [...(postedExports.get(name) || []), { id, openId: entry.id, length: bytes.length, hash }].slice(-10));
    }
    arm(id, SAVE_ACK_TIMEOUT_MS, 'no confirmation from the host');
    const data = bytes.buffer;
    send({ type: 'save', id, kind, openId: kind === 'document' ? entry.id : null, follows, name, size: data.byteLength, data }, [data]);
  };
  let saveChain = Promise.resolve();
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
    configurable: true,
    writable: true,
    value: function () {
      // Never throw from here: the app's wasm calls this synchronously.
      const blob = hostOrigin && this.hasAttribute('download') ? blobs.get(this.href) : undefined;
      if (!blob) return nativeClick.call(this);
      const id = ++saveSeq;
      const name = safeName(this.download);
      pendingSaves.set(id, { name, blob, timer: null, stored: null, posted: false });
      // At once, before the file is read: the host knows a save is coming (and that the page must
      // not be left yet), however long reading and hashing take.
      send({ type: 'save-started', id, name });
      // A preparation that never ends (an adapter whose promise hangs) must not hold back the
      // saves after it: it falls back to a download once data-save-result-timeout has passed.
      let deadline;
      const prepared = Promise.race([prepareSave(id, name, blob), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('the translator could not read the file in time')), SAVE_RESULT_TIMEOUT_MS);
      })]).finally(() => clearTimeout(deadline));
      prepared.catch(() => undefined); // handled in the chain below
      const fail = (err) => failSave(id, String(err && err.message || err));
      saveChain = saveChain.then(() => prepared).then((p) => continueExport(id, name, p)).then((p) => {
        postSave(id, name, p);
        p.bytes = null; // posted (transferred): keep nothing alive that an adapter keyed on it
      }).catch(fail);
    },
  });

  // --- Links: keep the editor in the frame. Some app links open with target _self. -------------
  // Links can come from documents (a PDF's link, an SVG's <a href>): only web and mail links and
  // the app's own blob: and about:blank windows open, never javascript: or data:. A page of
  // another origin opens without a handle on this frame (noopener), so it cannot reach the frame
  // or, through it, navigate the host's page.
  const nativeOpen = window.open;
  window.open = function (url, target, features) {
    if (hostOrigin) {
      // Checked and opened as the same absolute URL.
      let resolved = null;
      try { resolved = new URL(String(url ?? ''), document.baseURI); } catch { /* blocked below */ }
      const allowed = resolved && (/^(https?|mailto|blob):$/.test(resolved.protocol) || resolved.href === 'about:blank');
      if (!allowed) {
        log('not opening a link with this scheme:', resolved ? resolved.protocol : String(url));
        return null;
      }
      if (/^_(self|top|parent)$/i.test(String(target || ''))) target = '_blank';
      if (/^https?:$/.test(resolved.protocol) && resolved.origin !== location.origin && !/(^|,)\s*noopener\s*(=|,|$)/i.test(String(features || ''))) {
        features = features ? String(features) + ',noopener' : 'noopener';
      }
      if (url != null && url !== '') url = resolved.href;
    }
    return nativeOpen.call(window, url, target, features);
  };

  // --- Open: hand the file to the app the way a user's drop would. ----------------------------
  const openFile = async (msg) => {
    if (startupFailed) throw new Error(startupMessage);
    const registered = await appReady;
    const target = adapter.dropTarget ? adapter.dropTarget(registered) : registered;
    const name = safeName(msg.name);
    const view = new Uint8Array(msg.data);
    const savedName = adapter.savedName ? safeName(await adapter.savedName(name, view)) : name;
    opened.set(name, { id: msg.id, name, savedName, length: view.byteLength, hash: await sha256(view), identity: await identityOf(view) });
    const file = new File([msg.data], name, { type: typeof msg.mime === 'string' ? msg.mime : '', lastModified: Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const box = target.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: transfer,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    };
    for (const type of ['dragover', 'drop']) target.dispatchEvent(new DragEvent(type, init));
    send({ type: 'delivered', id: msg.id, name, size: file.size });
  };

  // --- Messages from the parent. ---------------------------------------------------------------
  const onMessage = (event) => {
    if (event.source !== parentWin) return;
    const msg = event.data;
    if (!msg || msg.protocol !== PROTOCOL || msg.version !== PROTOCOL_VERSION) return;
    if (!hostOrigin) {
      if (msg.type !== 'init' || !allowedOrigins.includes(event.origin)) return;
      hostOrigin = event.origin;
      if (startupFailed) send({ type: 'error', of: 'startup', message: startupMessage });
      // `language`: the tag the app started in, as the adapter reported it (an adapter that sets
      // it through the app's API knows that once started() has finished), or null.
      appReady.then(async () => {
        let language = null;
        try {
          const value = await Promise.race([Promise.resolve(languageResult), new Promise((resolve) => setTimeout(resolve, 5000, null))]);
          language = typeof value === 'string' && value ? value : null;
        } catch { /* null */ }
        send({ type: 'ready', appVersion: config.appVersion || null, layerVersion: LAYER_VERSION, language });
      }, () => undefined);
      return;
    }
    if (event.origin !== hostOrigin) return;
    if (msg.type === 'open' && msg.data instanceof ArrayBuffer && typeof msg.name === 'string') {
      openFile(msg).catch((err) => send({ type: 'error', of: 'open', id: msg.id, message: String(err && err.message || err) }));
    } else if (msg.type === 'save-received') {
      // Only for a save that was sent: after a reload, a late answer about the previous page's
      // save with the same id must not end a save that is still being prepared.
      if (pendingSaves.get(msg.id)?.posted) arm(msg.id, SAVE_RESULT_TIMEOUT_MS, 'no result from the host');
    } else if (msg.type === 'save-result') {
      const pending = pendingSaves.get(msg.id);
      if (!pending || !pending.posted) return; // unknown, finished, or not sent yet
      if (msg.ok !== true) return failSave(msg.id, String(msg.error || 'the host could not store it'));
      clearTimeout(pending.timer);
      pendingSaves.delete(msg.id);
      // The next save of this document builds on what was stored now (also when it was stored
      // under another name than it was opened with), unless the host has opened that name again
      // meanwhile (then that newer file is the reference).
      const stored = pending.stored;
      const current = stored && opened.get(stored.name);
      if (stored && (!current || current.id === stored.id)) opened.set(stored.name, stored);
    }
  };

  // --- Adapter registration, then announce ourselves. -----------------------------------------
  // `ready` waits for the drop target and then for the adapter's started(): some apps register a
  // drop listener of their own before the one that opens files, or finish starting later.
  let appReady = null;
  const startHandshake = () => {
    appReady = dropTargetReady.then(async (registered) => {
      if (adapter.started) await adapter.started(registered);
      appReadyNow = true;
      startupFailed = false;
      return registered;
    });
    appReady.catch((err) => startupFailure(String(err && err.message || err), true));
    nativeAddEventListener.call(window, 'message', onMessage);
    let hellos = 0;
    const hello = () => {
      if (hostOrigin || hellos++ >= 30) return clearInterval(timer);
      for (const origin of allowedOrigins) {
        try {
          parentWin.postMessage({ protocol: PROTOCOL, version: PROTOCOL_VERSION, app: adapter.app, type: 'hello', layerVersion: LAYER_VERSION }, origin);
        } catch { /* try the next origin */ }
      }
    };
    const timer = setInterval(hello, 1000);
    hello();
  };
  Object.defineProperty(window, 'craftsuiteLayer', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      version: LAYER_VERSION,
      register(candidate) {
        if (adapter || !candidate || typeof candidate.app !== 'string' || typeof candidate.classify !== 'function') return false;
        adapter = Object.freeze({ ...candidate });
        // The host's language, or null (then an adapter that wrote one into the app's own
        // preferences on an earlier start takes it back). Now, before the app's module runs.
        if (typeof adapter.language === 'function') {
          try {
            languageResult = adapter.language(hostLanguage, util);
            // A promise that fails before the app starts would count as a failed start.
            if (languageResult && typeof languageResult.then === 'function') Promise.resolve(languageResult).catch(() => undefined);
          } catch (err) {
            log('could not apply the language', hostLanguage, err);
          }
        }
        startHandshake();
        return true;
      },
    }),
  });
  nativeAddEventListener.call(document, 'DOMContentLoaded', () => { if (!adapter) log('inactive: no adapter registered'); });
})();
