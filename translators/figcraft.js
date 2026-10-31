/*
 * craftsuite-layer adapter for FigCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What FigCraft (web build, checked with 0.12.1) does and why the rules
 * below follow from it is described in docs/apps/figcraft.md. Source references are to the v0.12.1
 * tag: web.rs is apps/figcraft-web/src/web.rs, the other paths are under crates/.
 *  - index.html is a Trunk loader that preloads the .wasm and dispatches TrunkApplicationStarted;
 *    eframe's drop listener is on canvas#figcraft_canvas, so the core's defaults fit. The app
 *    starts with one new document, 'Untitled', and keeps nothing in the browser's storage.
 *  - A dropped .figcraft, .fig, .sketch or .json opens as a document of its own in a new tab, which
 *    becomes the active one (ui-egui/src/canvas/input.rs import_dropped); images and SVG dropped on
 *    the canvas are placed into the open document. The document is named as engine/src/cmd/file/
 *    load.rs load_with does: an image or SVG after the file's stem; a .fig after the file name in
 *    its meta.json, else the stem; a native file (a zip with document.json, or that JSON alone)
 *    keeps the name stored in it, unless that is empty or 'Untitled' (then the stem).
 *  - Save and Save As (Ctrl+S, Ctrl+Shift+S, File menu) write the whole file of the active tab,
 *    never an update of the opened bytes, as the download '<document name>.figcraft' (ui-egui/src/
 *    app/files.rs save_as_dialog, engine/src/cmd/file/save.rs save_to): a zip with document.json
 *    (`format` 'figcraft'). There is no autosave in the browser. Exports have other names or types
 *    (PNG, SVG, PDF, a zip of several).
 *  - New documents are named 'Untitled' (a board: 'Untitled board'), so they save under that name.
 *    A file stores no identity of its document.
 *  - Files from the user: a drop from the desktop, or File > Open (Ctrl+O, an <input type=file>
 *    whose accept lists '.json' among FigCraft's types), which opens any file it is given as a
 *    document (web.rs pick_file). Both go through the `files` getters watched below.
 *  - The interface language follows navigator.language (web.rs system_language); a language picked
 *    in the app lasts for the page.
 *
 * Rule: a download is the document only if it has the name a save of the opened file gets
 * (savedName), that name is not a new document's, no file from the user would save under it, and
 * it is a FigCraft file. Everything else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // The languages the web build shows (0.12.1), BCP 47 tag -> FigCraft's code. Left out: bn, ja,
  // ko, th and zh-Hans, which it shows in English on the web (no font for their scripts).
  const LANGUAGES = {
    en: 'en', cs: 'cs', de: 'de', es: 'es', 'es-419': 'es-419', fi: 'fi', fr: 'fr', id: 'id', it: 'it',
    ka: 'ka', nl: 'nl', pl: 'pl', 'pt-BR': 'pt-BR', ru: 'ru', sv: 'sv', tr: 'tr', vi: 'vi',
  };
  // Regions whose Spanish FigCraft shows as es-419 (ui-egui/src/i18n.rs LATIN_AMERICA).
  const LATIN_AMERICA = new Set(['419', 'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GT', 'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'US', 'UY', 'VE']);

  // Rust's Path::file_stem and extension() for a file name, as load.rs uses them.
  const stem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };
  const ext = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  };
  const PICTURES = new Set(['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff']);
  // What a new document saves under (engine/src/session/new.rs, engine/src/cmd/file.rs).
  const NEW_DOCUMENT = new Set(['Untitled', 'Untitled board']);

  // A zip member found through the central directory, unpacked up to MAX_JSON bytes; null for
  // anything else. Enough for the members read here (FigCraft writes them stored or deflated).
  const MAX_JSON = 256 * 1024 * 1024;
  const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const isZip = (bytes) => bytes.length >= 22 && u32(bytes, 0) === 0x04034b50;
  const entryData = (bytes, wanted) => {
    let end = -1; // the end of central directory record, within the last 64 KiB + 22 bytes
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
      if (u32(bytes, i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) return null;
    let at = u32(bytes, end + 16);
    for (let n = u16(bytes, end + 10); n > 0 && at + 46 <= bytes.length && u32(bytes, at) === 0x02014b50; n--) {
      const nameLength = u16(bytes, at + 28);
      if (ascii(bytes, at + 46, nameLength) === wanted) {
        const method = u16(bytes, at + 10);
        const size = u32(bytes, at + 20);
        const local = u32(bytes, at + 42);
        if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) return null;
        const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
        return start + size <= bytes.length ? { method, data: bytes.subarray(start, start + size) } : null;
      }
      at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    }
    return null;
  };
  const inflate = async (data) => {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
        if (size > MAX_JSON) return null;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  };
  const memberJson = async (bytes, name) => {
    const entry = entryData(bytes, name);
    if (!entry || (entry.method !== 0 && entry.method !== 8) || (entry.method === 0 && entry.data.length > MAX_JSON)) return null;
    const json = entry.method === 8 ? await inflate(entry.data) : entry.data;
    const value = json && JSON.parse(new TextDecoder().decode(json));
    return value && typeof value === 'object' ? value : null;
  };

  // The document of a native file: document.json of the zip, or the file itself when it is JSON
  // (format/src/lib.rs load_within). Kept per byte array: savedName() and classify() ask about the
  // same bytes.
  const documents = new WeakMap();
  const documentOf = (bytes) => {
    if (!documents.has(bytes)) {
      documents.set(bytes, (async () => {
        const first = bytes.findIndex((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c);
        if (first >= 0 && bytes[first] === 0x7b && bytes.length <= MAX_JSON) {
          const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          return doc && typeof doc === 'object' ? doc : null;
        }
        return isZip(bytes) ? memberJson(bytes, 'document.json') : null;
      })().catch(() => null));
    }
    return documents.get(bytes);
  };

  // The name FigCraft gives the document it opens from a file (see the header), as a promise.
  const documentName = async (name, bytes) => {
    const fallback = stem(name);
    if (PICTURES.has(ext(name))) return fallback;
    if (ascii(bytes, 0, 4) === 'fig-') return fallback;
    if (isZip(bytes) && entryData(bytes, 'canvas.fig')) {
      const meta = await memberJson(bytes, 'meta.json').catch(() => null);
      const named = meta && typeof meta.file_name === 'string' && meta.file_name.trim() !== '' ? meta.file_name : null;
      return named || fallback;
    }
    const doc = await documentOf(bytes);
    const stored = doc && typeof doc.name === 'string' ? doc.name : '';
    return stored !== '' && stored !== 'Untitled' ? stored : fallback;
  };
  const savedName = async (name, bytes) => (await documentName(name, bytes)) + '.figcraft';

  // The names that files from the user save under: a drop from the desktop (the core's drop is
  // synthetic, isTrusted false, and does not count) and files read from File > Open, whose
  // picker lists '.json' (Import and Place image do not, and keep what they read inside the open
  // document). eframe reads drops through DataTransfer.files, the picker's input through files;
  // should a release read them another way, such files go unnoticed (docs/apps/figcraft.md). Both
  // the stem and the name the file stores count, so a file that cannot be read still counts.
  const userNames = new Set();
  const reading = new Set();
  const noteUserFile = (file) => {
    userNames.add(stem(file.name) + '.figcraft');
    const read = (async () => {
      if (file.size > MAX_JSON) return;
      userNames.add(await savedName(file.name, new Uint8Array(await file.arrayBuffer())));
    })().catch(() => undefined).finally(() => reading.delete(read));
    reading.add(read);
  };
  const watchFiles = (proto, counts) => {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'files');
    if (!desc || typeof desc.get !== 'function' || !desc.configurable) return;
    const seen = new WeakSet();
    Object.defineProperty(proto, 'files', {
      ...desc,
      get() {
        const list = desc.get.call(this);
        try {
          if (list) for (const file of list) if (file instanceof File && !seen.has(file) && counts(this)) { seen.add(file); noteUserFile(file); }
        } catch { /* never break the app's read */ }
        return list;
      },
    });
  };
  watchFiles(window.DataTransfer && DataTransfer.prototype, () => {
    const event = window.event; // the drop being dispatched, if any
    return !!event && event.type === 'drop' && event.isTrusted;
  });
  watchFiles(window.HTMLInputElement && HTMLInputElement.prototype,
    (input) => input.type === 'file' && /(^|,)\s*\.json\s*(,|$)/i.test(input.accept));

  window.craftsuiteLayer.register({
    app: 'figcraft',
    // An opened file saves as '<document name>.figcraft' (see the header). If that is not the
    // opened name (another type, or a document named otherwise than its file), the host keeps the
    // file and stores the saves in a new file next to it.
    savedName,
    // 'document' may replace the opened file (or the file the host stored next to it); everything
    // else becomes a new file. Save rewrites the whole file, so there is no prefix to compare: the
    // name and the type decide, as in DesignCraft.
    // Known gaps: an opened file whose document is named 'Untitled' saves as a new file each time;
    // a new document from a template, a duplicate or a document renamed in the app saves as the
    // document if its name is the opened document's.
    async classify(save, entry) {
      if (save.name !== entry.savedName || NEW_DOCUMENT.has(stem(save.name))) return 'export';
      await Promise.all([...reading]);
      if (userNames.has(save.name)) return 'export';
      const doc = await documentOf(save.bytes);
      return isZip(save.bytes) && doc && doc.format === 'figcraft' ? 'document' : 'export';
    },
    // The host's language, through navigator.language, which FigCraft reads as it starts.
    language(tag, util) {
      let key = util.matchLanguage(tag, LANGUAGES);
      const region = /^es-([A-Za-z]{2}|\d{3})$/i.exec(tag || '');
      if (key === 'es' && region && LATIN_AMERICA.has(region[1].toUpperCase())) key = 'es-419';
      if (key) util.preferLanguages(LANGUAGES[key]);
      return key;
    },
  });
})();
