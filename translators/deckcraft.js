/*
 * craftsuite-layer adapter for DeckCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What DeckCraft (web build, checked with 0.5.0) does and why the rules
 * below follow from it is described in docs/apps/deckcraft.md. Source references are to the
 * v0.5.0 tag; web.rs is apps/deckcraft-web/src/web.rs, the other paths are under crates/.
 *  - It takes dropped files on its canvas (canvas#deckcraft_canvas) through eframe, whose only
 *    `drop` listener comes after the graphics and the app with its sample deck (web.rs:31-55), so
 *    the core's default drop target fits and no started() check is needed. The drop handler does
 *    not check isTrusted.
 *  - A document is always open when the host's file arrives: the sample deck 'Northern Lights'
 *    (with ?blank an empty 'Presentation1', web.rs:41-48). A dropped .deckcraft, .slidecraft,
 *    .pptx, .potx or .ppsx (any case) opens as another document (ui-egui/src/lib.rs:499-529),
 *    titled with the file name up to its last dot (engine/src/cmd/file.rs:80-82); a title stored in
 *    the file is ignored. DeckCraft tells native files from PPTX by content (file.rs:57-66).
 *    Pictures, audio, video, .txt and .md go into the active document.
 *  - Every download is a Blob behind an <a download> that is clicked and removed at once
 *    (web.rs:139-164).
 *  - Save (Ctrl+S), Save As (Ctrl+Shift+S) and Save as Template have no dialog on the web: they
 *    download '<title>.deckcraft', the whole document written as a new native zip
 *    (ui-egui/src/lib.rs:413-461, format/src/lib.rs:43-73). So an opened 'x.pptx' saves as
 *    'x.deckcraft' (savedName). Exports are '<title>.<ext>' (ui-egui/src/dialogs.rs:431-471): Export
 *    as PowerPoint of an opened 'x.pptx' comes back under the opened name, DeckCraft's lossy
 *    re-encoding (pptx/src/lib.rs:4-6), never a save.
 *  - New documents are titled 'PresentationN', counting in each session; the sample took 1
 *    (engine/src/lib.rs:388-391, engine/src/sample.rs:130-136). Their saves can take the opened
 *    file's name. The only identity a file carries is the creation time in its document
 *    properties (model/src/lib.rs:727-741), which only the PPTX reader sets
 *    (pptx/src/read/mod.rs:378-382, 651-667) and every save keeps; DeckCraft never sets one itself.
 *  - Files also reach the app from the user: a drop from the desktop and Open (Ctrl+O), a file
 *    picker (rfd, <input type=file>); both open like the host's file (web.rs:77-92, 107-127).
 *  - Readers ignore unknown fields (format/src/lib.rs:1-3), so a file written by a newer DeckCraft
 *    loses what this build does not know when Save rewrites it. With two presentation.json
 *    entries, DeckCraft's zip reader takes the last one (checked in Chromium).
 *  - The name only routes the drop: a PowerPoint package named 'x.deckcraft' opens as PowerPoint
 *    (file.rs:57-66) and saves as 'x.deckcraft', DeckCraft's re-encoding under the opened name.
 *
 * Rule: a download is the document only if it has the name DeckCraft saves the opened file under
 * ('<title>.deckcraft'), is a native file as Save writes it and can be read, no presentation the
 * user brought in saves under that name, and the creation times tell it from other documents: both
 * have the same one, or neither has one and the title is not one DeckCraft gives its own
 * documents. Such a save is a 'copy' instead if Save loses something of the opened file: a native
 * file a newer DeckCraft wrote (or one the adapter cannot read), or a PowerPoint package under the
 * name Save writes. Everything else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  const NATIVE = 'application/vnd.storyteller.deckcraft+zip';
  const LEGACY = 'application/vnd.storyteller.slidecraft+zip';
  const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  // What Save writes: a zip whose first entry is the stored 'mimetype' (format/src/lib.rs:43-73).
  const isSavedPackage = (bytes) => {
    if (bytes.length < 38 + NATIVE.length || ascii(bytes, 0, 4) !== 'PK\u0003\u0004') return false;
    const method = bytes[8] | (bytes[9] << 8);
    const nameLength = bytes[26] | (bytes[27] << 8);
    const extraLength = bytes[28] | (bytes[29] << 8);
    return method === 0 && nameLength === 8 && ascii(bytes, 30, 8) === 'mimetype' &&
      ascii(bytes, 38 + extraLength, NATIVE.length) === NATIVE;
  };
  // What DeckCraft opens as a native file (format/src/lib.rs:84-88): 'PK' and either MIME type
  // starting in the first 200 bytes. Anything else it reads as PPTX.
  const looksNative = (bytes) => bytes[0] === 0x50 && bytes[1] === 0x4b &&
    [NATIVE, LEGACY].some((mime) => ascii(bytes, 0, 199 + mime.length).includes(mime));

  // The titles DeckCraft gives documents it makes itself (not translated): New Presentation, and the
  // sample deck every web session starts with.
  const RESERVED = /^(Presentation\d+|Northern Lights)$/;
  // The title: the name up to its last dot (Rust's Path::file_stem for the names that arrive here).
  const stem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };

  // The core's safeName (core.js), which every save name passes through before it reaches
  // classify(): the save name of a file from the user is compared after the same changes.
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

  // Presentations the app read from a user's own drop or from its file picker, by the name their
  // saves get. The core's drop is synthetic (isTrusted false) and does not count. DeckCraft 0.5.0
  // reads both through `files` (eframe's drop handler, rfd's <input type=file>), as PhotoCraft
  // does; should a release read them another way, such files go unnoticed again (see
  // docs/apps/deckcraft.md, known gaps).
  const OPENS = /\.(deckcraft|slidecraft|pptx|potx|ppsx)$/i;
  const foreignNames = new Set();
  const seen = new WeakSet();
  const noteForeign = (file) => {
    if (!(file instanceof File) || seen.has(file)) return;
    seen.add(file);
    const name = String(file.name);
    if (OPENS.test(name)) foreignNames.add(safeName(stem(name) + '.deckcraft'));
  };
  const watchFiles = (proto, counts) => {
    const desc = Object.getOwnPropertyDescriptor(proto, 'files');
    if (!desc || typeof desc.get !== 'function' || !desc.configurable) return;
    Object.defineProperty(proto, 'files', {
      ...desc,
      get() {
        const list = desc.get.call(this);
        try {
          if (list && counts(this)) for (const file of list) noteForeign(file);
        } catch { /* never break the app's read */ }
        return list;
      },
    });
  };
  watchFiles(DataTransfer.prototype, () => {
    const event = window.event; // the drop being dispatched, if any
    return !!event && event.type === 'drop' && event.isTrusted;
  });
  watchFiles(HTMLInputElement.prototype, (input) => input.type === 'file');

  // Zip entries through the central directory, as DeckCraft's zip reader finds them.
  const MAX_ENTRY = 256 * 1024 * 1024;
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const zipEntries = (bytes) => {
    let end = -1; // the end of central directory record, within the last 64 KiB + 22 bytes
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
      if (u32(bytes, i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) return [];
    const entries = [];
    let at = u32(bytes, end + 16);
    for (let n = u16(bytes, end + 10); n > 0 && at + 46 <= bytes.length && u32(bytes, at) === 0x02014b50; n--) {
      const nameLength = u16(bytes, at + 28);
      entries.push({ name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
        method: u16(bytes, at + 10), size: u32(bytes, at + 20), local: u32(bytes, at + 42) });
      at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    }
    return entries;
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
        if (size > MAX_ENTRY) return null;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  };
  const entryText = async (bytes, entry) => {
    if (!entry || (entry.method !== 0 && entry.method !== 8) || entry.size > MAX_ENTRY) return null;
    const { local, size, method } = entry;
    if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) return null;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    if (start + size > bytes.length) return null;
    const data = method === 8 ? await inflate(bytes.subarray(start, start + size)) : bytes.subarray(start, start + size);
    return data && new TextDecoder().decode(data);
  };

  // XML text as DeckCraft's reader resolves it (pptx/src/xml.rs:227-320): character references,
  // the five named entities (others become nothing), CDATA as it is.
  const xmlText = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[0-9a-fA-F]+|#[0-9]+|\w+);|<[^>]*>/g, (_, cdata, ref) => {
    if (cdata !== undefined) return cdata;
    if (ref === undefined) return ''; // a tag inside the element: only its text counts
    if (ref[0] === '#') {
      const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[ref] ?? '';
  });
  const attr = (tag, name) => {
    const m = new RegExp(`\\s(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
    return m ? xmlText(m[1] ?? m[2]) : null;
  };
  // A part name as DeckCraft resolves a package-relative target (pptx/src/opc.rs:162-219): percent
  // decoded, without fragment, '.' and '..' applied, compared in lower case.
  const partName = (target) => {
    let decoded = target;
    try { decoded = decodeURIComponent(target.replace(/%(?![0-9a-f]{2})/gi, '%25')); } catch { /* as it is */ }
    const parts = [];
    for (const seg of decoded.split('#')[0].split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '' && seg !== '.') parts.push(seg);
    }
    return parts.join('/').replace(/\\/g, '/').toLowerCase();
  };

  // What DeckCraft reads from a file: whether it is a native file, its creation time
  // (presentation.json props.created of a native file; for a PPTX the last 'created' of the core
  // properties part that the first core-properties relationship of _rels/.rels names, read as in
  // pptx/src/read/mod.rs:378-382 and 651-667) and, for a native file, its writer (manifest
  // generator and format version; null if the adapter cannot read it, such as a presentation.json
  // over 256 MB, which DeckCraft reads up to 2 GB). Kept per byte array: the core asks savedName(),
  // identity() and classify() about the same bytes.
  const infos = new WeakMap();
  const read = async (bytes) => {
    const entries = zipEntries(bytes);
    // The last of equal names, as DeckCraft's zip readers take it.
    const last = (match) => [...entries].reverse().find(match);
    if (looksNative(bytes)) {
      const json = await entryText(bytes, last((e) => e.name === 'presentation.json'));
      const manifest = json && JSON.parse(json);
      if (!manifest || manifest.format !== 'deckcraft') return { native: true, created: null, writer: null };
      const created = manifest.presentation?.props?.created;
      return {
        native: true,
        created: typeof created === 'string' && created !== '' ? created : null,
        writer: { generator: String(manifest.generator ?? ''), version: Number(manifest.version) || 0 },
      };
    }
    // Entry names in lower case without a leading '/' (opc.rs:43-77).
    const find = (name) => last((e) => e.name.replace(/^\/+/, '').toLowerCase() === name);
    const rels = await entryText(bytes, find('_rels/.rels'));
    const rel = rels && [...rels.matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)].map((m) => m[0])
      .find((tag) => (attr(tag, 'Type') || '').split('/').pop() === 'core-properties');
    const target = rel && !/^external$/i.test(attr(rel, 'TargetMode') || '') ? attr(rel, 'Target') : null;
    const core = target && await entryText(bytes, find(partName(target)));
    const all = core ? [...core.matchAll(/<(?:[\w.-]+:)?created(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?created\s*>)/g)] : [];
    const created = all.length ? xmlText(all[all.length - 1][1] ?? '') : '';
    return { native: false, created: created !== '' ? created : null, writer: null };
  };
  const infoOf = (bytes) => {
    if (!infos.has(bytes)) infos.set(bytes, read(bytes).catch(() => ({ native: looksNative(bytes), created: null, writer: null })));
    return infos.get(bytes);
  };

  // Whether a save by this build loses what the opened file's writer stored: the file was written
  // by a newer DeckCraft, by another program, or in a newer format version. `saved` is the writer
  // of the save, that is of the build that runs.
  const versionOf = (generator) => {
    const m = /^DeckCraft (\d+)\.(\d+)\.(\d+)/.exec(generator);
    return m ? m.slice(1).map(Number) : null;
  };
  const losesFields = (opened, saved) => {
    if (opened.version > saved.version) return true;
    if (opened.generator === saved.generator) return false;
    const a = versionOf(opened.generator);
    const b = versionOf(saved.generator);
    if (!a || !b) return true;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  // Opened name -> what the opened file is: {native, writer}.
  const opens = new Map();

  window.craftsuiteLayer.register({
    app: 'deckcraft',
    // The drop listener comes after the graphics and the sample deck: 0.5-1.1 s after the start in
    // Chromium with SwiftShader. More room than the default 3 s for slow machines; a browser
    // without WebGPU and WebGL2 is then reported this much later.
    dropTargetTimeout: 10000,
    // Every opened presentation saves as '<title>.deckcraft': the host keeps an opened PPTX and
    // stores the DeckCraft file next to it, and later saves update that file. Also notes what the
    // opened file is and which DeckCraft wrote a native one.
    async savedName(name, bytes) {
      const { native, writer } = await infoOf(bytes);
      opens.set(name, { native, writer });
      return stem(name) + '.deckcraft';
    },
    // The document's creation time (see the header). The core sends a save whose identity differs
    // from the opened document's as an export without asking classify().
    async identity(bytes) {
      return (await infoOf(bytes)).created;
    },
    // 'document' may replace the opened .deckcraft (for an opened PPTX: the file the host stored
    // next to it); 'copy' goes to one new file next to it; everything else becomes a new file.
    // Save rewrites the whole file, so the saved name, the package and the identity decide.
    // Known gap: another presentation with the opened file's title and without a creation time
    // (or with the opened file's) that reaches the app in a way the watched getters miss.
    async classify(save, entry) {
      if (save.name !== entry.savedName || !isSavedPackage(save.bytes)) return 'export';
      // A presentation the user brought in saves under the same name.
      if (foreignNames.has(save.name)) return 'export';
      const { created, writer } = await infoOf(save.bytes);
      // A save the adapter cannot read: its creation time is unknown.
      if (!writer) return 'export';
      // An opened document with a creation time keeps it in every save (a different one never
      // gets here), so a save without one is another document.
      if (entry.identity && !created) return 'export';
      // DeckCraft never sets one itself, so a save that has one while the opened document has
      // none is another document, and one without cannot be told from a new presentation's or
      // the sample deck's save under their names.
      if (!entry.identity && (created || RESERVED.test(stem(save.name)))) return 'export';
      // The opened document, but Save loses something of the opened file: keep the original. A
      // native file of a newer DeckCraft, or one the adapter cannot read, loses what this build
      // does not know; a PowerPoint package under a DeckCraft name would be replaced by
      // DeckCraft's re-encoding (an opened 'x.pptx' saves under another name, a new file).
      const opened = opens.get(entry.name);
      if (opened?.native && (!opened.writer || losesFields(opened.writer, writer))) return 'copy';
      if (opened && !opened.native && save.name === entry.name) return 'copy';
      return 'document';
    },
  });
})();
