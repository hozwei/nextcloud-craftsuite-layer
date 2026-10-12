// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stub app for the translator tests. It does in the browser what PdfCraft 0.5.0 (eframe 0.36)
// does where the translator depends on it, without wasm or WebGL, so it runs in every engine:
//  - Start: the wasm module loads asynchronously; eframe then installs its listeners (keydown and
//    dragover/dragleave/drop on the canvas, pointerup on the document) and Trunk's loader
//    dispatches `TrunkApplicationStarted` on window.
//  - Drop: eframe keeps the File objects of dataTransfer.files; the app reads them with
//    File.arrayBuffer() in a later frame and opens them under the file's name.
//  - Download: like PdfCraft's download(): a Blob of type application/pdf (for every export), an
//    object URL, a detached <a download=name>, click(), and revokeObjectURL right away.
//  - Save: an incremental update appended to the bytes last saved, under the document's name.
//    Ctrl+S runs in the next animation frame; a click on the toolbar (pointerup in the top 40 px)
//    runs the frame logic inside the event handler, as eframe does on pointerup. After redaction
//    or Sanitize, Save writes the whole file anew, and later saves append to those bytes.
//  - Links: eframe opens a link that is not meant for a new tab with window.open(url, '_self').
//
// Query parameters (the test host passes app-<name>=<value> through to the app's URL):
//   mode=start             start normally (default)
//   mode=gap               dispatch TrunkApplicationStarted first, install the listeners a bit later
//   mode=docdrop           take drops on the document instead of the canvas
//   mode=late              start, but install the listeners only when __stub.attach() is called
//                          or after `late` ms (default 4000, after the default 3 s of
//                          data-drop-target-timeout)
//   mode=manual            start only when __stub.start() is called
//   mode=nostart           start without a drop target (like eframe without WebGL)
//   mode=hang              never start and never fail
//   mode=noload            the loader, a module script like Trunk's, rejects at its top-level await
//                          (what a failed wasm download or instantiation does)
//   mode=noload-import     the loader's import of the app's JavaScript fails (missing file)
//   mode=noload-script     a classic script of the app fails to load
//   mode=noload-rejection  a promise nobody handles is rejected before the start
//   mode=noload-preload    preload the wasm from ./missing_bg.wasm and never start; the test makes
//                          the request fail (Chromium and WebKit report a failed preload only
//                          for a network error, not for an HTTP error status)
//   delay=<ms>             time the simulated wasm takes to load (default 50)
//   file=<url>             open this file at startup, like PdfCraft's ?file= (no translator needed)
//
// Everything the app saw and did is in window.__stub; tests call its hooks with frame.evaluate.
// The stub uses nothing but timers and animation frames for time, so tests can fake its clock.
'use strict';

(() => {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'start';
  const delay = Number(params.get('delay') || 50);
  const canvas = document.getElementById('pdfcraft');
  canvas.tabIndex = 0; // eframe makes the canvas focusable; it takes the key events
  const encoder = new TextEncoder();

  const stub = (window.__stub = {
    mode,
    token: Math.random().toString(36).slice(2), // tells whether this document was replaced
    started: false, // TrunkApplicationStarted dispatched
    attached: false, // drop, key and pointer listeners installed
    failures: [], // load failures that reached the window (noload modes)
    docs: [], // opened documents: {name, type, size, original, saved}
    downloads: [], // every download the app made: {name, base64}
    dragovers: [], // dataTransfer.items.length seen by each dragover
    drops: [], // {isTrusted, files, inside}: the drop events the app handled
    messages: [], // protocol messages that reached the window: {type, id, ok, fromParent, origin}
    errors: [], // the stub's own problems (reading a dropped file, fetching ?file=)
    // What the app sees as it starts (after the translator ran): its address and the browser's
    // languages, for the tests of the host's language.
    startHref: location.href,
    startLanguages: [navigator.language, ...(navigator.languages || [])],
  });

  // --- Helpers ------------------------------------------------------------------------------------
  const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const toBase64 = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const active = () => {
    const doc = stub.docs[stub.docs.length - 1];
    if (!doc) throw new Error('stub: no document open');
    return doc;
  };
  const stem = (name) => name.replace(/\.[^.]*$/, '');

  function paint() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = canvas.clientWidth || 300;
    canvas.height = canvas.clientHeight || 150;
    ctx.fillStyle = '#333';
    ctx.font = '14px sans-serif';
    const lines = [`stub app (mode ${mode})${stub.attached ? '' : ' - no drop target'}`,
      ...stub.docs.map((d, i) => `#${i + 1} ${d.name} (${d.saved.length} bytes)`)];
    lines.forEach((line, i) => ctx.fillText(line, 12, 60 + i * 20));
  }

  // --- What PdfCraft does ---------------------------------------------------------------------------
  function openDocument(name, bytes, type) {
    stub.docs.push({ name, type, size: bytes.length, original: bytes, saved: bytes });
    paint();
  }

  // editing.rs download(), step by step.
  function download(name, bytes) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    stub.downloads.push({ name, base64: toBase64(bytes) });
  }

  // Save: the bytes last saved (or, with base 'original', the bytes as opened) plus an update.
  // full: the file written anew (the old bytes behind a new header), as PdfCraft's Save does after
  // redaction or Sanitize. stubId: the update also carries '/StubId (<stubId>)', which the test
  // adapter's identity reads. pad: the update is that many bytes larger.
  let edits = 0;
  function save({ change = true, base = 'saved', full = false, stubId = null, pad = 0 } = {}) {
    const doc = active();
    let bytes = base === 'original' ? doc.original : doc.saved;
    if (full) bytes = concat(encoder.encode('%PDF-1.7\n% written anew by the stub\n'), bytes);
    if (change) {
      edits += 1;
      const id = stubId === null ? '' : ` /StubId (${stubId})`;
      bytes = concat(bytes, encoder.encode(`\n${900 + edits} 0 obj\n<< /StubEdit ${edits}${id} >>\nendobj\n`),
        new Uint8Array(pad).fill(0x20), encoder.encode('%%EOF\n'));
    }
    doc.saved = bytes;
    download(doc.name, bytes);
    paint();
  }

  function onDrop(event) {
    const dt = event.dataTransfer;
    if (!dt) return;
    const files = Array.from(dt.files || []);
    const box = canvas.getBoundingClientRect();
    stub.drops.push({
      isTrusted: event.isTrusted,
      files: files.length,
      inside: event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom,
    });
    event.stopPropagation();
    event.preventDefault();
    // open_dropped(): the next frame reads each file asynchronously.
    requestAnimationFrame(() => {
      for (const file of files) {
        file.arrayBuffer().then(
          (buf) => openDocument(file.name, new Uint8Array(buf), file.type),
          (err) => stub.errors.push('reading ' + file.name + ': ' + err),
        );
      }
    });
  }

  // eframe's install_event_handlers(), reduced to what matters here.
  function attach() {
    if (stub.attached) return;
    stub.attached = true;
    const dropTarget = mode === 'docdrop' ? document : canvas;
    canvas.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (stub.docs.length) requestAnimationFrame(() => save());
      }
    });
    document.addEventListener('pointerup', (event) => {
      if (event.button === 0 && event.clientY < 40 && stub.docs.length) save();
    });
    dropTarget.addEventListener('dragover', (event) => {
      if (!event.dataTransfer) return;
      stub.dragovers.push(event.dataTransfer.items.length);
      event.stopPropagation();
      event.preventDefault();
    });
    dropTarget.addEventListener('dragleave', (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    dropTarget.addEventListener('drop', onDrop);
    paint();
  }

  function started() {
    stub.started = true;
    dispatchEvent(new CustomEvent('TrunkApplicationStarted', { detail: { wasm: {} } }));
    const file = params.get('file');
    if (file) {
      fetch(file)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('HTTP ' + res.status))))
        .then((buf) => openDocument(file.split('/').pop().split('?')[0], new Uint8Array(buf), 'application/pdf'))
        .catch((err) => stub.errors.push('fetching ' + file + ': ' + err));
    }
  }

  // Not something PdfCraft does: lets tests see that a message or a load failure reached the app's
  // window. The translator's listeners were added earlier, so they have run when these run.
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || !('protocol' in msg)) return;
    stub.messages.push({ type: msg.type, id: msg.id ?? null, ok: msg.ok ?? null, fromParent: event.source === window.parent, origin: event.origin });
  });
  window.addEventListener('error', (event) => {
    stub.failures.push(event instanceof ErrorEvent ? 'exception: ' + event.message : 'resource: ' + event.target.tagName);
  }, true);
  window.addEventListener('unhandledrejection', (event) => stub.failures.push('rejection: ' + event.reason));

  // --- Hooks for the tests ----------------------------------------------------------------------
  Object.assign(stub, {
    attach,
    start() {
      attach();
      started();
    },
    // Incremental save of the active document, from an animation frame (Ctrl+S) or right away
    // (the toolbar's Save button). change:false saves without an edit; base:'original' appends
    // to the bytes as opened instead of those last saved; full, stubId and pad: see save() above.
    save(options = {}) {
      if (options.timing === 'raf') requestAnimationFrame(() => save(options));
      else save(options);
    },
    // An export under another name, e.g. Export to Word (still typed application/pdf).
    exportAs(name, text) {
      download(name ?? stem(active().name) + '.docx', encoder.encode(text ?? 'PK\u0003\u0004 stub export of ' + active().name));
    },
    // The Action Wizard: a rewritten file under the document's own name.
    rewrite() {
      const doc = active();
      download(doc.name, concat(encoder.encode('%PDF-1.7\n% rewritten by the stub action\n'), doc.saved));
    },
    // Several downloads in one task, like Split's parts.
    burst(names) {
      names.forEach((name, i) => download(name, encoder.encode(`%PDF-1.7\n% part ${i + 1} of ${names.length}: ${name}\n%%EOF\n`)));
    },
    // A download under any name the app could produce (e.g. an attachment's /UF).
    download(name, text) {
      download(name, encoder.encode(text ?? '%PDF-1.7\n% stub download\n%%EOF\n'));
    },
    // What eframe's open_url does (it discards the window that window.open returns). Returns that
    // window as seen from here: 'same' (this frame), 'new', or 'none' (no handle: nothing opened,
    // or a window opened with noopener).
    openWindow(url, target) {
      const win = window.open(url, target);
      return win === window ? 'same' : win ? 'new' : 'none';
    },
    // Not something PdfCraft does: clicks a detached link the way download() does, for checking
    // which clicks the translator takes. href is 'blob' (a live object URL), 'revoked' (an object
    // URL revoked before the click), 'data' (a data: URL) or any URL; download is the attribute's
    // value, or null for none. A click that reaches the link is cancelled (no navigation, no
    // download). Returns whether it reached the link.
    clickAnchor(href, download) {
      const bytes = encoder.encode('%PDF-1.7\n% stub link\n%%EOF\n');
      let url = href;
      if (href === 'blob' || href === 'revoked') url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      if (href === 'revoked') URL.revokeObjectURL(url);
      if (href === 'data') url = 'data:application/pdf;base64,' + toBase64(bytes);
      const a = document.createElement('a');
      a.href = url;
      if (download !== null) a.download = download;
      let reached = false;
      a.addEventListener('click', (event) => {
        reached = true;
        event.preventDefault();
      });
      a.click();
      if (href === 'blob') URL.revokeObjectURL(url);
      return reached;
    },
    opened() {
      return stub.docs.map((d) => ({ name: d.name, type: d.type, size: d.size, base64: toBase64(d.original) }));
    },
  });

  // --- Start ----------------------------------------------------------------------------------------
  const wasmLoaded = () => new Promise((resolve) => setTimeout(resolve, delay));
  // Trunk's loader is an inline module script: import the app's JavaScript, await init(wasm).
  const loader = (source) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = source;
    document.head.append(script);
  };
  paint();
  switch (mode) {
    case 'start':
    case 'docdrop':
      wasmLoaded().then(() => { attach(); started(); });
      break;
    case 'gap':
      wasmLoaded().then(() => { started(); setTimeout(attach, 300); });
      break;
    case 'late':
      wasmLoaded().then(() => { started(); setTimeout(attach, Number(params.get('late') || 4000)); });
      break;
    case 'nostart':
      wasmLoaded().then(started);
      break;
    case 'manual':
    case 'hang':
      break;
    case 'noload':
      loader(`await new Promise((resolve) => setTimeout(resolve, ${delay}));\nthrow new Error('stub could not load its wasm module');`);
      break;
    case 'noload-import':
      loader(`import './missing-loader.js';`);
      break;
    case 'noload-script':
      document.head.append(Object.assign(document.createElement('script'), { src: './missing-loader.js' }));
      break;
    case 'noload-rejection':
      wasmLoaded().then(() => Promise.reject(new Error('stub could not instantiate its wasm module')));
      break;
    case 'noload-preload':
      document.head.append(Object.assign(document.createElement('link'), { rel: 'preload', as: 'fetch', href: './missing_bg.wasm', crossOrigin: 'anonymous' }));
      break;
    default:
      throw new Error('stub: unknown mode ' + mode);
  }
})();
