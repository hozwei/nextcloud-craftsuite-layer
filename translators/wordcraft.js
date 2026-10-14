/*
 * craftsuite-layer adapter for WordCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What WordCraft (web build, checked with 0.5.0 and 0.6.1) does and why
 * the rules below follow from it is described in docs/apps/wordcraft.md. Source references are to
 * the v0.6.1 tag; web.rs is apps/wordcraft-web/src/web.rs, the other paths are under crates/.
 *  - It takes dropped files on its canvas (canvas#wordcraft_canvas) through eframe, whose only
 *    `drop` listener comes once the graphics and the app run (web.rs:40-74), so the core's
 *    default drop target and its `ready` fit. Each dropped file keeps its File.name (web.rs:130);
 *    then the name decides (ui-egui/src/lib.rs:1552-1578): pictures are inserted, font files are
 *    added (0.6.1), .csv and .tsv load mail-merge recipients, and so do .xlsx, .xlsm and .ods
 *    (0.6.1) and a .txt after Use an Existing List… (from a drop too); anything else is opened as
 *    the document (one at a time).
 *  - Every save is a Blob behind an <a download> that is clicked and removed at once
 *    (web.rs:392-415), but from 0.6.1 on only where the page has no showSaveFilePicker
 *    (web.rs:265-284); see "Saves are downloads" below. Save (Ctrl+S) and Save As (F12) ask for no
 *    name on the web (web.rs:226). The name is the opened file's stem plus its own extension for a
 *    Word package (.docx .docm .dotx .dotm, in the opened case), otherwise plus '.docx'
 *    (lib.rs:1268-1274): an opened .odt, .rtf, .doc or .dot saves as '<stem>.docx', and keeps that
 *    name for every later save.
 *  - Every save rewrites the whole Word package from WordCraft's model, stamps docProps/core.xml
 *    (modified, revision, and the creation time dcterms:created only where there is none,
 *    engine/src/session.rs:844-852) and writes 'WordCraft' as the Application in
 *    docProps/app.xml (docx/src/write/mod.rs:1079). What WordCraft does not model is lost
 *    (docs/apps/wordcraft.md).
 *  - File > Export writes '<title>.<ext>' (ui-egui/src/file_dialogs.rs:274-277): Export ODT of an
 *    opened .odt arrives under the opened name and is never the document; Export Word document
 *    writes what Save writes.
 *  - New documents (Ctrl+N, templates, Envelopes, Labels) have no file name and save as
 *    '<title or Document1>.docx' (lib.rs:1297-1308), 'Document1' translated with the interface
 *    language (0.6.1 takes the browser's, ui-egui/src/i18n/mod.rs:270-278); they get a creation
 *    time of their own on their first save. Mailings > Finish & Merge makes its new document as a
 *    copy of the open one (engine/src/cmd/mailings.rs:574, 661-662), with its title and creation
 *    time, so it can save under the opened name with the opened creation time. It turns the merge
 *    fields of the body (0.6.1: and of headers and footers) into text (mailings.rs:458-506,
 *    566-666, 699-736), with a recipient list from a file or typed into the app alike.
 *
 * Rules: a download is the document only under the name WordCraft saves the opened file under,
 * as a Word package, with the opened creation time if the opened file has one (identity(); the
 * core turns a save with another one into an export), and, without one, not under a new
 * document's name. Then it is 'document' if WordCraft wrote the opened file (Application
 * 'WordCraft') or the opened file was not a Word package (its '<stem>.docx' is a new file next to
 * it); a Word package from another program, or one whose app.xml cannot be read (an encrypted
 * one), is 'copy': the save drops what WordCraft does not model, so it must not replace the
 * original. Every save under that name becomes an export once a recipient list may have reached
 * the app (a .csv, .tsv, .txt, .xlsx, .xlsm or .ods from a drop or a picker: a merged document
 * could be saved under it), or once the user has brought in a file of their own that saves under
 * it. A save is also an export if the version of the document it follows (the opened bytes, then
 * each stored 'document' save: the core's entry.hash) had merge fields in its main part, or in its
 * headers and footers, and the save has none there, or its main part cannot be read: Finish &
 * Merge made it, also from a typed list.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // --- Saves are downloads. --------------------------------------------------------------------
  // From 0.6.1 on, WordCraft saves through showSaveFilePicker where the page has it (Chromium,
  // web.rs:265-284), and through an <a download>, which the core turns into a save, only without
  // it. In a frame of another origin Chromium refuses the picker with a SecurityError once the call
  // has returned, so WordCraft does not fall back and the save is lost (web.rs:323-363); in a frame
  // of the host's origin the file would go past the host. Without the function every save is a
  // download, as in 0.5.0.
  if ('showSaveFilePicker' in window) {
    try {
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, enumerable: true, writable: true, value: undefined });
    } catch {
      console.warn('[craftsuite-layer] cannot hide showSaveFilePicker: WordCraft\'s saves will not reach the host');
    }
  }

  // The extensions WordCraft saves back in their own format (docx/src/lib.rs:87-95, Flavor).
  const WORD_PACKAGE = /\.(docx|docm|dotx|dotm)$/i;
  // The names WordCraft gives new documents: 'Document1' and its translations in the 0.5.0 and
  // 0.6.1 catalogs (ui-egui/src/i18n/*.tsv), and the title of the sample (engine/src/sample.rs:32).
  const NEW_DOCUMENT = /^(Document1|Documento1|Dokument1|Dokumentum1|Belge1|文書 1|Документ1|文档1|文件1|The Open Studio Handbook)$/u;
  // The name without its last extension, as Rust's Path::file_stem cuts it.
  const stem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };
  // The name WordCraft saves a document opened from `name` under (lib.rs:1268-1274). As for
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
  // pickers (rfd, <input type=file>.files) and routes them by name (lib.rs:1552-1578). The core's
  // own drop is synthetic (isTrusted false) and is not the user's.
  //   recipientList: a recipient list may have reached the app: a .csv, .tsv, .xlsx, .xlsm or
  //                  .ods (the workbooks from 0.6.1 on), or a .txt, which WordCraft loads as
  //                  recipients while it waits for a list (from Select Recipients > Use an
  //                  Existing List… until the next command or file, lib.rs:640-642, 1237-1241,
  //                  1559-1562), from the picker and from a drop alike. From then on Finish & Merge
  //                  can make a copy of the opened document that saves under its name.
  //   foreignSaves:  the save names of documents the user opened from their own disk.
  // Should a release read such files another way, they go unnoticed (docs/apps/wordcraft.md).
  const NO_DOCUMENT = /\.(png|jpe?g|gif|webp|bmp|ttf|otf|ttc|otc|woff2?)$/i; // pictures and fonts
  const RECIPIENTS = /\.(csv|tsv|xlsx|xlsm|ods)$/i;
  const MAYBE_RECIPIENTS = /\.(csv|tsv|txt|xlsx|xlsm|ods)$/i;
  let recipientList = false;
  const foreignSaves = new Set();
  const noteFile = (file, trusted) => {
    if (!(file instanceof File)) return;
    const name = String(file.name);
    if (MAYBE_RECIPIENTS.test(name)) recipientList = true;
    if (trusted && !RECIPIENTS.test(name) && !NO_DOCUMENT.test(name)) foreignSaves.add(safeName(saveNameOf(name)));
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
  // docx/src/package.rs:194-200); null if missing, unreadable or larger than `cap` bytes.
  const part = async (map, name, cap = MAX_PART) => {
    const key = name.replace(/^\/+/, '');
    const e = map.get(key) || [...map].find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
    if (!e || (e.method !== 0 && e.method !== 8) || (e.method === 0 && e.data.length > cap)) return null;
    const data = e.method === 8 ? await inflate(e.data, cap) : e.data;
    const doc = data && new DOMParser().parseFromString(utf8(data), 'application/xml');
    return doc && !doc.getElementsByTagName('parsererror').length ? doc : null;
  };
  // The element children of the root, as WordCraft reads core.xml (docx/src/read/mod.rs:1311-1330).
  const children = (doc) => (doc ? [...doc.documentElement.children] : []);
  // A relationship's target as a part name, resolved against the folder of the part whose
  // relationships name it, and where a part's relationships are (docx/src/package.rs:210-212,
  // 300-313).
  const resolve = (dir, target) => {
    const parts = target.startsWith('/') ? [] : dir.split('/').filter(Boolean);
    for (const seg of target.split('#')[0].split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  };
  const folderOf = (name) => name.slice(0, Math.max(0, name.lastIndexOf('/')));
  const relsOf = (name) => (folderOf(name) ? folderOf(name) + '/' : '') + '_rels/' + name.slice(name.lastIndexOf('/') + 1) + '.rels';
  // The relationships whose type ends like `type`, as WordCraft matches types by their last
  // segment (docx/src/package.rs:133-136).
  const relations = (rels, type) => children(rels).filter((r) => r.localName === 'Relationship' &&
    (r.getAttribute('Type') || '').split('/').pop() === type);
  const external = (rel) => /^external$/i.test(rel.getAttribute('TargetMode') || '');
  // The target of the first package relationship of that type; `fallback` if there is none, or
  // with `internal`, if it points outside the package (docx/src/read/mod.rs:123, 244).
  const packageTarget = (rels, type, fallback, internal = false) => {
    const rel = relations(rels, type)[0];
    const target = rel && !(internal && external(rel)) ? rel.getAttribute('Target') : null;
    return target ? resolve('', target) : fallback;
  };

  // What the adapter asks about a file, read once per byte array (the core asks identity() and
  // classify() about the same bytes, and savedName() and identity() about the opened file):
  //   word:        a Word package: its main part typed as one of WordCraft's four flavours
  //                ([Content_Types].xml), or a compound file holding an encrypted package (how
  //                WordCraft saves a document with a password, docx/src/crypt.rs:56-66)
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
  // evaluate with the record's text (engine/src/cmd/mailings.rs:458-497, act and placeholder, and
  // 699-736). Counted here are the fields both 0.5.0 and 0.6.1 replace: a code that starts with
  // MERGEFIELD (in capitals), or whose first word is ADDRESSBLOCK, GREETINGLINE, NEXT, MERGEREC or
  // SKIPIF (any letter case), or IF with MERGEFIELD in its code (0.5.0 replaced every IF, 0.6.1
  // also replaces NEXTIF). Other fields (MERGESEQ, PAGE) stay fields, and so does every field in
  // notes and text boxes. 0.6.1 also replaces them in headers and footers (mailings.rs:500-506,
  // 566-666), which 0.5.0 leaves alone. A save of the document keeps its fields
  // (docx/src/write/story.rs:763-813, 862-884: begin, one w:instrText, separate, end).
  const MERGE_WORD = /^(ADDRESSBLOCK|GREETINGLINE|NEXT|MERGEREC|SKIPIF)$/;
  const isMergeCode = (code) => {
    const t = code.trim();
    const word = t.split(/\s/, 1)[0].replace(/[a-z]+/g, (s) => s.toUpperCase());
    return t.startsWith('MERGEFIELD') || MERGE_WORD.test(word) || (word === 'IF' && t.includes('MERGEFIELD'));
  };
  const WML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // Whether a story part (the main part, a header, a footer) has a merge field where WordCraft
  // reads a field of that story (docx/src/read/story.rs:463-470, 587-625, 746-830): simple
  // (w:fldSimple, code in w:instr) or complex (w:fldChar begin, the w:instrText and w:delInstrText
  // up to separate, end), and the outermost one of a nest: a field inside another's code or result
  // becomes text of that one. A text box (w:txbxContent) is a story of its own, which Finish &
  // Merge leaves alone.
  const hasMergeField = (doc) => {
    const fields = []; // the complex fields open at this point: {code, inCode}
    // A field ends: the outermost one is checked; one in the code of another adds its text to
    // that code (a stand-in here), so a code that starts with it starts with no word.
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
  // Per byte array, whether there are merge fields in the main part (`body`: the target of the
  // package's officeDocument relationship, else word/document.xml, docx/src/read/mod.rs:121-124)
  // and in its headers and footers (`headers`: the parts of its header and footer relationships,
  // at most MAX_HEADERS). Both null if the main part cannot be read: not a zip package (RTF, DOC,
  // an encrypted package), none (ODT), too large, not XML.
  const MAX_HEADERS = 200;
  const UNREAD = { body: null, headers: null };
  const merges = new WeakMap();
  const mergeFieldsOf = (bytes) => {
    if (!merges.has(bytes)) {
      merges.set(bytes, (async () => {
        const map = entries(bytes);
        if (!map) return UNREAD;
        const main = packageTarget(await part(map, '_rels/.rels'), 'officeDocument', 'word/document.xml', true);
        const doc = await part(map, main, MAX_BODY);
        if (!doc) return UNREAD;
        const rels = await part(map, relsOf(main));
        const stories = [...relations(rels, 'header'), ...relations(rels, 'footer')].filter((r) => !external(r)).slice(0, MAX_HEADERS);
        let headers = false;
        for (const rel of stories) {
          const story = await part(map, resolve(folderOf(main), rel.getAttribute('Target') || ''), MAX_BODY);
          if (story && hasMergeField(story)) { headers = true; break; }
        }
        return { body: hasMergeField(doc), headers };
      })().catch(() => UNREAD));
    }
    return merges.get(bytes);
  };
  // The answer for each version of an opened document that a save can follow, by the SHA-256 of
  // its bytes: the core compares a save with the bytes it keeps for the opened file (entry.hash),
  // first the opened file (passed to savedName()), then each stored 'document' save (classify()).
  // A version the adapter has not seen counts as one with merge fields in its main part.
  const UNSEEN = { body: true, headers: false };
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const sha256 = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const versions = new Map();
  const noteVersion = (hash, merge) => {
    versions.delete(hash);
    versions.set(hash, merge);
    if (versions.size > 1000) versions.delete(versions.keys().next().value);
  };
  // Merge fields that the version had and the save has not (or cannot be read for).
  const lost = (before, now) => before === true && now !== true;

  // Opened Word packages that WordCraft did not write (or whose app.xml cannot be read), by the
  // name they were opened under: their saves are copies.
  const foreignPackages = new Map();

  window.craftsuiteLayer.register({
    app: 'wordcraft',
    // The drop listener comes once eframe has made the graphics and the app: 0.2-0.5 s after the
    // start with 0.5.0, 0.3-0.6 s with 0.6.1, in Chromium with SwiftShader, and once more than the
    // default 3 s on a busy CI machine. More room for slow machines; a browser without WebGPU and
    // WebGL2 is then reported this much later.
    dropTargetTimeout: 10000,
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
    // A save without merge fields in its main part, or in its headers and footers, that follows a
    // version with some there is what Finish & Merge makes, whatever the recipient list came from
    // (also one typed into WordCraft); so is a save whose main part cannot be read then. A version
    // whose main part could not be read counts as one without.
    // Known gaps (docs/apps/wordcraft.md): a merge whose fields WordCraft leaves alone and a merge
    // of an opened file that is not a Word package before its first stored save are not seen; a
    // copy of the opened file that reaches WordCraft another way than the two watched passes as
    // the document; before the first stored save of an opened file without a creation time, a new
    // document the user titled like it does too.
    async classify(save, entry) {
      if (save.name !== entry.savedName || !WORD_PACKAGE.test(save.name)) return 'export';
      if (recipientList || foreignSaves.has(save.name)) return 'export';
      const info = await infoOf(save.bytes);
      if (!info.word) return 'export';
      if (entry.identity ? !info.created : NEW_DOCUMENT.test(stem(save.name))) return 'export';
      const merge = await mergeFieldsOf(save.bytes);
      const before = versions.get(hex(entry.hash)) || UNSEEN;
      if (lost(before.body, merge.body) || lost(before.headers, merge.headers)) return 'export';
      if (foreignPackages.get(entry.name)) return 'copy';
      noteVersion(await sha256(save.bytes), merge); // the core keeps it if the host stores it
      return 'document';
    },
  });
})();
