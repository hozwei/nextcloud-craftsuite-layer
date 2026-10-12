/*
 * craftsuite-layer adapter for WordCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What WordCraft (web build, checked with 0.5.0) does and why the rules
 * below follow from it is described in docs/apps/wordcraft.md. Source references are to the
 * v0.5.0 tag; web.rs is apps/wordcraft-web/src/web.rs, the other paths are under crates/.
 *  - It takes dropped files on its canvas (canvas#wordcraft_canvas) through eframe, whose only
 *    `drop` listener comes once the graphics and the app run (web.rs:38-56), so the core's
 *    default drop target and its `ready` fit. Each dropped file keeps its File.name (web.rs:84);
 *    then the name decides (ui-egui/src/lib.rs:941-961): pictures are inserted, .csv and .tsv
 *    load mail-merge recipients (so does a .txt after Use an Existing List…, from a drop too),
 *    anything else is opened as the document (one at a time).
 *  - Every download is a Blob behind an <a download> that is clicked and removed at once
 *    (web.rs:203-227). Save (Ctrl+S) and Save As (F12) ask for no name on the web (web.rs:176).
 *    The name is the opened file's stem plus its own extension for a Word package (.docx .docm
 *    .dotx .dotm, in the opened case), otherwise plus '.docx' (lib.rs:741-762): an opened .odt,
 *    .rtf, .doc or .dot saves as '<stem>.docx', and keeps that name for every later save.
 *  - Every save rewrites the whole Word package from WordCraft's model, stamps docProps/core.xml
 *    (modified, revision, and the creation time dcterms:created only where there is none,
 *    engine/src/session.rs:450-458) and writes 'WordCraft' as the Application in
 *    docProps/app.xml (docx/src/write/mod.rs:940). What WordCraft does not model is lost:
 *    content controls, legacy form fields, custom XML parts and more (docs/apps/wordcraft.md).
 *  - File > Export writes '<title>.<ext>' (ui-egui/src/file_dialogs.rs:173-176): Export ODT of an
 *    opened .odt arrives under the opened name and is never the document; Export Word document
 *    writes what Save writes.
 *  - New documents (Ctrl+N, templates, Envelopes, Labels) have no file name and save as
 *    '<title or Document1>.docx' (lib.rs:751-762), 'Document1' translated with the interface
 *    language; they get a creation time of their own on their first save. Mailings > Finish &
 *    Merge makes its new document as a copy of the open one (engine/src/cmd/mailings.rs:426,
 *    455-456), with its title and creation time, so it can save under the opened name with the
 *    opened creation time. It turns every merge field of the body into text (mailings.rs:351-378,
 *    488-512), with a recipient list from a file or typed into the app alike.
 *
 * Rules: a download is the document only under the name WordCraft saves the opened file under,
 * as a Word package, with the opened creation time if the opened file has one (identity(); the
 * core turns a save with another one into an export), and, without one, not under a new
 * document's name. Then it is 'document' if WordCraft wrote the opened file (Application
 * 'WordCraft') or the opened file was not a Word package (its '<stem>.docx' is a new file next to
 * it); a Word package from another program, or one whose app.xml cannot be read (an encrypted
 * one), is 'copy': the save drops what WordCraft does not model, so it must not replace the
 * original. Every save under that name becomes an export once a recipient list may have reached
 * the app (a .csv, .tsv or .txt from a drop or a picker: a merged document could be saved under
 * it), or once the user has brought in a file of their own that saves under it. A save is also
 * an export if the version of the document it follows (the opened bytes, then each stored
 * 'document' save: the core's entry.hash) had merge fields in word/document.xml and the save has
 * none, or its main part cannot be read: Finish & Merge made it, also from a typed list.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // The extensions WordCraft saves back in their own format (docx/src/lib.rs:55-63, Flavor).
  const WORD_PACKAGE = /\.(docx|docm|dotx|dotm)$/i;
  // The names WordCraft gives new documents: 'Document1' and its translations in the 0.5.0
  // catalogs (ui-egui/src/i18n/*.tsv), and the title of the sample (engine/src/sample.rs:32).
  const NEW_DOCUMENT = /^(Document1|Documento1|Dokument1|文書 1|Документ1|文档1|文件1|The Open Studio Handbook)$/u;
  // The name without its last extension, as Rust's Path::file_stem cuts it.
  const stem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };
  // The name WordCraft saves a document opened from `name` under (lib.rs:741-747). As for
  // Path::extension, a name without a dot after its first character ('.docx') has no extension.
  const saveNameOf = (name) => (stem(name) !== name && WORD_PACKAGE.test(name) ? name : stem(name) + '.docx');

  // The core's safeName (core.js), which every save name passes through before it reaches
  // classify(): the save name of a file from elsewhere is compared after the same changes.
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

  // --- Files the user brings in. ---------------------------------------------------------------
  // WordCraft reads a user's drop (eframe, DataTransfer.files) and a file chosen in any of its
  // pickers (rfd, <input type=file>.files) and routes them by name (lib.rs:941-961). The core's
  // own drop is synthetic (isTrusted false) and is not the user's.
  //   recipientList: a recipient list may have reached the app: a .csv or .tsv, or a .txt, which
  //                  WordCraft loads as recipients while it waits for a list (from Select
  //                  Recipients > Use an Existing List… until the next command, lib.rs:166-168,
  //                  356-358, 948), from the picker and from a drop alike. From then on Finish &
  //                  Merge can make a copy of the opened document that saves under its name.
  //   foreignSaves:  the save names of documents the user opened from their own disk.
  // Should a release read such files another way, they go unnoticed (docs/apps/wordcraft.md).
  const PICTURE = /\.(png|jpe?g|gif|webp|bmp)$/i;
  const RECIPIENTS = /\.(csv|tsv)$/i;
  const MAYBE_RECIPIENTS = /\.(csv|tsv|txt)$/i;
  let recipientList = false;
  const foreignSaves = new Set();
  const noteFile = (file, trusted) => {
    if (!(file instanceof File)) return;
    const name = String(file.name);
    if (MAYBE_RECIPIENTS.test(name)) recipientList = true;
    if (trusted && !RECIPIENTS.test(name) && !PICTURE.test(name)) foreignSaves.add(safeName(saveNameOf(name)));
  };
  // `how(this)` says whether the list counts: null (not at all), else whether it is the user's.
  const watchFiles = (proto, how) => {
    const desc = Object.getOwnPropertyDescriptor(proto, 'files');
    if (!desc || typeof desc.get !== 'function' || !desc.configurable) return;
    Object.defineProperty(proto, 'files', {
      ...desc,
      get() {
        const list = desc.get.call(this);
        try {
          const trusted = list ? how(this) : null;
          if (trusted !== null) for (const file of list) noteFile(file, trusted);
        } catch { /* never break the app's read */ }
        return list;
      },
    });
  };
  watchFiles(DataTransfer.prototype, () => {
    const event = window.event; // the drop being dispatched, if any
    return event && event.type === 'drop' ? event.isTrusted : null;
  });
  watchFiles(HTMLInputElement.prototype, (input) => (input.type === 'file' ? true : null));

  // --- Reading a Word package: the zip's central directory, as WordCraft's zip crate does. -----
  const MAX_PART = 4 * 1024 * 1024; // the property parts read here are a few KB
  const MAX_BODY = 8 * 1024 * 1024; // the main part: the text of some hundred pages
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const utf8 = (b) => new TextDecoder().decode(b);
  // name -> {method, data} for every entry, or null if there is no central directory.
  const entries = (bytes) => {
    if (bytes.length < 30 || u32(bytes, 0) !== 0x04034b50) return null;
    let end = -1; // the end of central directory record, within the last 64 KiB + 22 bytes
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
      if (u32(bytes, i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) return null;
    const out = new Map();
    let at = u32(bytes, end + 16);
    for (let n = u16(bytes, end + 10); n > 0 && at + 46 <= bytes.length && u32(bytes, at) === 0x02014b50; n--) {
      const nameLength = u16(bytes, at + 28);
      const name = utf8(bytes.subarray(at + 46, at + 46 + nameLength));
      const method = u16(bytes, at + 10);
      const size = u32(bytes, at + 20);
      const local = u32(bytes, at + 42);
      if (local + 30 <= bytes.length && u32(bytes, local) === 0x04034b50) {
        const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
        if (start + size <= bytes.length) out.set(name.replace(/^\/+/, ''), { method, data: bytes.subarray(start, start + size) });
      }
      at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    }
    return out;
  };
  const inflate = async (data, cap) => {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
        if (size > cap) return null;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  };
  // A part as XML, looked up as WordCraft does (leading '/' ignored, then any letter case,
  // docx/src/package.rs:178-184); null if missing, unreadable or larger than `cap` bytes.
  const part = async (map, name, cap = MAX_PART) => {
    const key = name.replace(/^\/+/, '');
    const e = map.get(key) || [...map].find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
    if (!e || (e.method !== 0 && e.method !== 8) || (e.method === 0 && e.data.length > cap)) return null;
    const data = e.method === 8 ? await inflate(e.data, cap) : e.data;
    const doc = data && new DOMParser().parseFromString(utf8(data), 'application/xml');
    return doc && !doc.getElementsByTagName('parsererror').length ? doc : null;
  };
  // The element children of the root, as WordCraft reads core.xml (docx/src/read/mod.rs:811-829).
  const children = (doc) => (doc ? [...doc.documentElement.children] : []);
  // The target of the package relationship whose type ends like `type`, as WordCraft matches
  // types by their last segment (docx/src/package.rs:123-126); `fallback` if there is none.
  const packageTarget = (rels, type, fallback) => {
    const rel = children(rels).find((r) => r.localName === 'Relationship' && (r.getAttribute('Type') || '').split('/').pop() === type);
    return rel?.getAttribute('Target') || fallback;
  };

  // What the adapter asks about a file, read once per byte array (the core asks identity() and
  // classify() about the same bytes, and savedName() and identity() about the opened file):
  //   word:        a Word package: its main part typed as one of WordCraft's four flavours
  //                ([Content_Types].xml), or a compound file holding an encrypted package (how
  //                WordCraft saves a document with a password, docx/src/crypt.rs:58-66)
  //   created:     the text of dcterms:created in the core properties, trimmed, the last one as
  //                WordCraft reads it; null if none
  //   application: the Application in the extended properties (docProps/app.xml); null if none
  const MAIN_TYPE = /^application\/vnd\.(openxmlformats-officedocument\.wordprocessingml\.(document|template)\.main\+xml|ms-word\.(document\.macroEnabled|template\.macroEnabledTemplate)\.main\+xml)$/;
  const DCTERMS = 'http://purl.org/dc/terms/';
  const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const utf16 = (s) => new Uint8Array([...s].flatMap((c) => [c.charCodeAt(0), 0]));
  const contains = (hay, needle) => {
    for (let i = hay.indexOf(needle[0]); i >= 0 && i + needle.length <= hay.length; i = hay.indexOf(needle[0], i + 1)) {
      let j = 1;
      while (j < needle.length && hay[i + j] === needle[j]) j++;
      if (j === needle.length) return true;
    }
    return false;
  };
  const NOTHING = { word: false, created: null, application: null };
  const infos = new WeakMap();
  const infoOf = (bytes) => {
    if (!infos.has(bytes)) {
      infos.set(bytes, (async () => {
        if (CFB.every((x, i) => bytes[i] === x)) {
          const encrypted = contains(bytes, utf16('EncryptedPackage')) && contains(bytes, utf16('EncryptionInfo'));
          return { ...NOTHING, word: encrypted };
        }
        const map = entries(bytes);
        if (!map) return NOTHING;
        const types = children(await part(map, '[Content_Types].xml'));
        const word = types.some((t) => t.localName === 'Override' && MAIN_TYPE.test(t.getAttribute('ContentType') || ''));
        const rels = await part(map, '_rels/.rels');
        const core = children(await part(map, packageTarget(rels, 'core-properties', 'docProps/core.xml')));
        const created = core.filter((e) => e.namespaceURI === DCTERMS && e.localName === 'created').pop()?.textContent.trim() || null;
        const app = children(await part(map, packageTarget(rels, 'extended-properties', 'docProps/app.xml')));
        const application = app.find((e) => e.localName === 'Application')?.textContent.trim() || null;
        return { word, created, application };
      })().catch(() => NOTHING));
    }
    return infos.get(bytes);
  };

  // --- Merge fields: what Finish & Merge turns into text. --------------------------------------
  // Finish & Merge copies the body once per record and replaces each field whose code it can
  // evaluate with the record's text (engine/src/cmd/mailings.rs:351-378, eval, and 488-512):
  // MERGEFIELD (a prefix, in capitals), ADDRESSBLOCK, GREETINGLINE, NEXT, MERGEREC, SKIPIF and IF
  // (the first word, in any letter case). Other fields (NEXTIF, MERGESEQ, PAGE) stay fields, and
  // so does every field in headers, footers, notes and text boxes. A save of the document keeps
  // its fields (docx/src/write/story.rs:606-624: begin, one w:instrText, separate, end).
  const MERGE_WORD = /^(ADDRESSBLOCK|GREETINGLINE|NEXT|MERGEREC|SKIPIF|IF)$/;
  const isMergeCode = (code) => {
    const t = code.trim();
    return t.startsWith('MERGEFIELD') || MERGE_WORD.test(t.split(/\s/, 1)[0].replace(/[a-z]+/g, (s) => s.toUpperCase()));
  };
  const WML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // Whether the main part has a merge field where WordCraft reads a field of the body
  // (docx/src/read/story.rs:347-353, 454-461, 485-490, 555-620): simple (w:fldSimple, code in
  // w:instr) or complex (w:fldChar begin, the w:instrText and w:delInstrText up to separate, end),
  // and the outermost one of a nest: a field inside another's code or result becomes text of that
  // one. A text box (w:txbxContent) is a story of its own, which Finish & Merge leaves alone.
  const hasMergeField = (doc) => {
    const fields = []; // the complex fields open at this point: {code, inCode}
    // A field ends: the outermost one is checked; one in the code of another adds a character to
    // that code (WordCraft adds its text), so a code that starts with it starts with no word.
    const ended = (code) => {
      const outer = fields[fields.length - 1];
      if (!outer) return isMergeCode(code);
      if (outer.inCode) outer.code += '\ufffc';
      return false;
    };
    const todo = [doc.documentElement];
    while (todo.length) {
      const el = todo.pop();
      const name = el.namespaceURI === WML ? el.localName : '';
      if (name === 'txbxContent') continue;
      if (name === 'fldSimple') {
        if (ended(el.getAttributeNS(WML, 'instr') || '')) return true;
        continue; // its result is text of this field
      }
      if (name === 'fldChar') {
        const type = el.getAttributeNS(WML, 'fldCharType');
        if (type === 'begin') fields.push({ code: '', inCode: true });
        else if (type === 'separate' && fields.length) fields[fields.length - 1].inCode = false;
        else if (type === 'end' && fields.length && ended(fields.pop().code)) return true;
        continue;
      }
      if (name === 'instrText' || name === 'delInstrText') {
        const field = fields[fields.length - 1];
        if (field && field.inCode) field.code += el.textContent;
        continue;
      }
      for (let i = el.children.length - 1; i >= 0; i--) todo.push(el.children[i]);
    }
    return false;
  };
  // Per byte array: true or false, or null if the main part (the target of the package's
  // officeDocument relationship, else word/document.xml, docx/src/read/mod.rs:86) cannot be read:
  // not a zip package (RTF, DOC, an encrypted package), none (ODT), too large, not XML.
  const merges = new WeakMap();
  const mergeFieldsOf = (bytes) => {
    if (!merges.has(bytes)) {
      merges.set(bytes, (async () => {
        const map = entries(bytes);
        if (!map) return null;
        const main = packageTarget(await part(map, '_rels/.rels'), 'officeDocument', 'word/document.xml');
        const doc = await part(map, main, MAX_BODY);
        return doc ? hasMergeField(doc) : null;
      })().catch(() => null));
    }
    return merges.get(bytes);
  };
  // The answer for each version of an opened document that a save can follow, by the SHA-256 of
  // its bytes: the core compares a save with the bytes it keeps for the opened file (entry.hash),
  // first the opened file (passed to savedName()), then each stored 'document' save (classify()).
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const sha256 = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const versions = new Map();
  const noteVersion = (hash, merge) => {
    versions.delete(hash);
    versions.set(hash, merge);
    if (versions.size > 1000) versions.delete(versions.keys().next().value);
  };

  // Opened Word packages that WordCraft did not write (or whose app.xml cannot be read), by the
  // name they were opened under: their saves are copies.
  const foreignPackages = new Map();

  window.craftsuiteLayer.register({
    app: 'wordcraft',
    // An opened Word package saves under its own name; anything else as '<stem>.docx', which the
    // host stores next to the original, and later saves replace that file. The core passes the
    // opened bytes only here, so this also notes who wrote an opened Word package and whether it
    // has merge fields.
    async savedName(name, bytes) {
      const info = await infoOf(bytes);
      foreignPackages.set(name, WORD_PACKAGE.test(name) && info.application !== 'WordCraft');
      noteVersion(await sha256(bytes), await mergeFieldsOf(bytes));
      return saveNameOf(name);
    },
    // The document's creation time (see the header). The core sends a save whose identity differs
    // from the opened document's as an export without asking classify().
    async identity(bytes) {
      return (await infoOf(bytes)).created;
    },
    // 'document' may replace the opened file (or, for a file of another type, the '<stem>.docx'
    // next to it); 'copy' is a new file next to the opened one, which later copies replace;
    // anything else is a new file. An opened document with a creation time keeps it in every
    // save, so a save without one (an encrypted save has none that can be read) is not taken for
    // it; an opened document without one cannot be told from a new document saved under a new
    // document's name.
    // A save without merge fields that follows a version with some is what Finish & Merge makes,
    // whatever the recipient list came from (also one typed into WordCraft); so is a save whose
    // main part cannot be read then. A version the adapter has not seen counts as one with merge
    // fields; one it could not read, as one without.
    // Known gaps (docs/apps/wordcraft.md): a merge whose fields WordCraft leaves alone (none in
    // the body outside text boxes) and a merge of an opened file that is not a Word package
    // before its first stored save are not seen; a copy of the opened file that reaches WordCraft
    // another way than the two watched passes as the document; before the first stored save of an
    // opened file without a creation time, a new document the user titled like it does too.
    async classify(save, entry) {
      if (save.name !== entry.savedName || !WORD_PACKAGE.test(save.name)) return 'export';
      if (recipientList || foreignSaves.has(save.name)) return 'export';
      const info = await infoOf(save.bytes);
      if (!info.word) return 'export';
      if (entry.identity ? !info.created : NEW_DOCUMENT.test(stem(save.name))) return 'export';
      const merge = await mergeFieldsOf(save.bytes);
      const before = versions.get(hex(entry.hash));
      if (before !== false && before !== null && merge !== true) return 'export';
      if (foreignPackages.get(entry.name)) return 'copy';
      noteVersion(await sha256(save.bytes), merge); // the core keeps it if the host stores it
      return 'document';
    },
  });
})();
