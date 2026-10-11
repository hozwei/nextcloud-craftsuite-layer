/*
 * craftsuite-layer adapter for VectorCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What VectorCraft (web build, checked with 0.9.0) does and why the
 * rules below follow from it is described in docs/apps/vectorcraft.md:
 *  - It takes dropped files on its canvas (canvas#vectorcraft_canvas, through eframe). With no
 *    document open a drop opens the file; with one open, a drop on the canvas places the file into
 *    that document. Hosts open one file per frame.
 *  - Its first `drop` listener (which only follows the pointer) comes before eframe's, which reads
 *    the files and is installed only once the graphics have started. A drop in between is lost, so
 *    the app counts as started only when the page removes its loading text (#vectorcraft_loading),
 *    which it does once eframe runs. If the graphics cannot start, the page writes the reason there
 *    instead (as <p> lines). Builds with a fonts/ folder fetch their startup fonts before even the
 *    first listener (see dropTargetTimeout below).
 *  - Every download (Save, Save As, Save a Copy, Save as PDF, Export As, Export for Screens, ...)
 *    is a Blob behind a clicked <a download>; its type follows the name's extension.
 *  - A dropped file has no path in the app: the first Save asks with a Save As dialog (drawn in the
 *    canvas, answered by the user) that suggests '<title without extension>.vectorcraft', where the
 *    title of a native file is the one stored in it (document.title) and that of an import is its
 *    file name; later Saves write the confirmed name without asking. savedName() returns the
 *    suggested name, so that a save under it counts as the opened document although its name
 *    differs (an SVG, a renamed file). An opened .vectorcraft saved under its own name (typed into
 *    the dialog instead of the suggestion) is the opened document too.
 *  - Saves rewrite the whole file. Only the native format is a lossless save: SVG, PDF and .ai
 *    under the opened name are re-encodings of what VectorCraft could read, and Export As in the
 *    opened file's own format also arrives under the opened name.
 *  - File > New names a document 'Untitled-N', counting from 1 in each session (opening a file
 *    does not count), and its first Save suggests 'Untitled-N.vectorcraft'. Save never changes the
 *    stored title, so many files keep 'Untitled-N' inside. A native file made by the desktop app
 *    stores its creation time (document.metadata.created), which every save keeps; the web build
 *    has no clock and stores none, neither for a new document nor on a save. identity() returns
 *    that time: a save without it, or with another one, is not the opened document. Without it a
 *    save under 'Untitled-N.vectorcraft' cannot be told from a new document's and is never the
 *    document.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  const CANVAS = 'vectorcraft_canvas';
  const LOADING = 'vectorcraft_loading';
  const START_WAIT_MS = 120000;

  const stem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };

  // The name VectorCraft gives a new document (engine lib.rs next_untitled, not translated).
  const UNTITLED = /^Untitled-\d+$/;

  // A native document is UTF-8 JSON whose first 256 bytes name the format, gzip-compressed with
  // Use Compression (format/src/lib.rs sniff()). Since format version 4 the JSON may be followed by
  // binary data ("\n\0VCBLOBS\0" and large images); JSON text never contains a NUL byte, so it ends
  // before the first one.
  const HEAD = 256;
  const MAX_UNPACKED = 512 * 1024 * 1024; // VectorCraft's own limit for compressed files
  const isGzip = (bytes) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const looksNative = (head) => {
    const text = new TextDecoder().decode(head.subarray(0, HEAD));
    return /^\s*\{/.test(text) && /"(vectorcraft|drawcraft)"/.test(text);
  };
  const concat = (chunks, size) => {
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  };

  // The JSON part of a native file, or null. A gzip file is unpacked as a stream, only up to the
  // first NUL byte and at most MAX_UNPACKED bytes, so that neither a decompression bomb nor the
  // image data after the JSON is held in memory.
  const jsonPart = async (bytes) => {
    if (!isGzip(bytes)) {
      if (!looksNative(bytes)) return null;
      const end = bytes.indexOf(0);
      return end < 0 ? bytes : bytes.subarray(0, end);
    }
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = [];
    let size = 0;
    let sniffed = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const end = value.indexOf(0);
        const part = end < 0 ? value : value.subarray(0, end);
        chunks.push(part);
        size += part.length;
        if (size > MAX_UNPACKED) return null;
        // Stop early for anything else in gzip (an SVG Compressed save).
        if (!sniffed && size >= HEAD) {
          sniffed = true;
          if (!looksNative(concat(chunks, size))) return null;
        }
        if (end >= 0) break;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    const json = concat(chunks, size);
    return looksNative(json) ? json : null;
  };

  // The `document` object of a native file, or null. Kept per byte array: the core asks
  // savedName(), identity() and classify() about the same bytes.
  const documents = new WeakMap();
  const nativeDocument = (bytes) => {
    if (!documents.has(bytes)) {
      documents.set(bytes, jsonPart(bytes).then((json) => {
        const doc = json && JSON.parse(new TextDecoder().decode(json))?.document;
        return doc && typeof doc === 'object' ? doc : null;
      }).catch(() => null));
    }
    return documents.get(bytes);
  };

  // The creation time stored in a native document (File Info), or null.
  const createdOf = (doc) => {
    const created = doc?.metadata?.created;
    return typeof created === 'number' && Number.isFinite(created) ? String(created) : null;
  };

  window.craftsuiteLayer.register({
    app: 'vectorcraft',
    // How long the core waits from the app's start (TrunkApplicationStarted) for the first `drop`
    // listener. In VectorCraft that is the pointer listener, added just before the graphics start,
    // so this wait does not include them. It does include the startup fonts, which the page fetches
    // before that listener (web.rs start(), fonts.rs): builds with a fonts/ folder fetch Noto Sans
    // Arabic there, up to 20 s per font, and with the core's default of 3 s the host would get a
    // provisional startup error ('the app registered no drop target') before 'ready'. Builds
    // without the folder (0.8.0, 0.9.0) add the listener right after their start. Should a
    // release drop the pointer listener, eframe's, added after the graphics start, would be the
    // first, and this wait would include the graphics start too.
    dropTargetTimeout: 30000,
    dropTarget(registered) {
      return document.getElementById(CANVAS) || registered;
    },
    // Ready once the loading text is gone; failed when the page shows why it could not start.
    started() {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + START_WAIT_MS;
        const check = () => {
          const el = document.getElementById(LOADING);
          if (!el) return resolve();
          const lines = [...el.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
          if (lines.length) return reject(new Error('the app failed to start: ' + lines.join(' ')));
          if (Date.now() > deadline) return reject(new Error('the app did not start in time'));
          setTimeout(check, 50);
        };
        check();
      });
    },
    // The name the Save As dialog suggests, which users confirm with Enter: the stored title of a
    // native file (none or an empty one: the app takes the file name), else the opened name.
    async savedName(name, bytes) {
      const doc = /\.(vectorcraft|drawcraft)$/i.test(name) ? await nativeDocument(bytes) : null;
      const title = typeof doc?.title === 'string' && doc.title !== '' ? doc.title : null;
      return stem(title || name) + '.vectorcraft';
    },
    // The document's creation time (see the header). The core sends a save whose identity differs
    // from the opened document's as an export without asking classify().
    async identity(bytes) {
      return createdOf(await nativeDocument(bytes));
    },
    // 'document' may replace the opened file (or, when saved under another name, the .vectorcraft
    // file the host stored next to it); everything else becomes a new file. A native save under
    // the suggested name is the document, and so is one under the opened name (typed into the
    // dialog). The latter adds only an opened native .vectorcraft whose stored title gives another
    // suggested name: an import's opened name does not end in .vectorcraft, and for any other file
    // it is the suggested name already. Then the identity: an opened document with a creation time
    // keeps it in every save, so a save without one is another document; an opened document
    // without one cannot be told from a new document saved as 'Untitled-N.vectorcraft'.
    // Known gap: another native document with the same name and creation time (a copy).
    async classify(save, entry) {
      if ((save.name !== entry.savedName && save.name !== entry.name) || !/\.vectorcraft$/i.test(save.name)) return 'export';
      const doc = await nativeDocument(save.bytes);
      if (!doc) return 'export';
      if (entry.identity) return createdOf(doc) ? 'document' : 'export';
      return UNTITLED.test(stem(save.name)) ? 'export' : 'document';
    },
  });
})();
