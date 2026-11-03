/*
 * craftsuite-layer adapter for DesignCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What DesignCraft (web build, checked with 0.6.0) does and why the
 * rules below follow from it is described in docs/apps/designcraft.md:
 *  - It takes dropped files on its canvas (canvas#designcraft_canvas, through eframe); the core's
 *    default drop target fits. A dropped .designcraft or .idml opens as a new document titled
 *    with the file name up to its last dot (an IDML package also loses any '.idml' left at the
 *    end of that; since 0.17.0 the whole name less one '.designcraft', or for an IDML package one
 *    '.idml', '.indd' or '.indt', any case); a title stored inside the file is ignored. Anything
 *    else is placed into the
 *    open document, and with no document open nothing opens. A file dropped while a dialog is
 *    open is not opened.
 *  - Every download is a Blob behind an <a download> that is clicked and removed at once. Its type
 *    follows the extension (since 0.6.0 application/vnd.designcraft+zip for .designcraft).
 *  - Save and Save As (no dialog on the web) write '<title>.designcraft': the whole document as a
 *    new zip package, not an update of the opened bytes. Exports are named '<title>.<ext>' (Export
 *    PDF since 0.6.0: the title in its dialog) or '<title>-p<n>.png', so Export IDML of an opened
 *    .idml reuses the opened name; that is DesignCraft's own rewrite of the file, never a save of
 *    it.
 *  - New documents are titled 'Untitled-N', counting from 1 in each session (opening a file does
 *    not count), so a new document can save under the opened file's name. The package's
 *    document.json stores the creation time (`created`, Unix seconds), set when a document is
 *    created or imported and kept by every save. The desktop app sets it; the web build has no
 *    clock and stores 0. identity() returns it: a save without it, or with another one, is not
 *    the opened document. Without it a save under 'Untitled-N.designcraft' cannot be told from a
 *    new document's and is never the document.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // A .designcraft file and an IDML package are both zips whose first entry is an uncompressed
  // 'mimetype' holding their MIME type.
  const PACKAGE = 'application/vnd.designcraft+zip';
  const IDML = 'application/vnd.adobe.indesign-idml-package';
  const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  const isZipOf = (bytes, mime) => {
    if (bytes.length < 38 + mime.length || ascii(bytes, 0, 4) !== 'PK\u0003\u0004') return false;
    const method = bytes[8] | (bytes[9] << 8);
    const nameLength = bytes[26] | (bytes[27] << 8);
    const extraLength = bytes[28] | (bytes[29] << 8);
    return method === 0 && nameLength === 8 && ascii(bytes, 30, 8) === 'mimetype' &&
      ascii(bytes, 38 + extraLength, mime.length) === mime;
  };

  // The name DesignCraft gives new documents (engine/src/cmd/file.rs, not translated).
  const UNTITLED = /^Untitled-\d+$/;
  const stem = (name) => name.replace(/\.[^.]*$/, '');

  // The app version core.js was given (data-app-version), or null when the host did not say.
  const appVersion = (() => {
    const script = document.querySelector('script[data-app-version]');
    return script && script.dataset.appVersion ? script.dataset.appVersion : null;
  })();
  // major.minor.patch, anything after '-' or '+' ignored; an unknown version counts as the newest.
  const atLeast = (version, wanted) => {
    if (!version) return true;
    const parts = (v) => String(v).split(/[-+]/)[0].split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
    const a = parts(version);
    const b = parts(wanted);
    for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    return true;
  };
  // Since 0.17.0 the web build passes the whole file name and the engine removes one extension
  // (engine/src/cmd/file/open.rs without_native_extension, interchange.rs
  // without_document_extension); before, the web build cut the name at its last dot.
  const FULL_NAME = atLeast(appVersion, '0.17.0');

  // The name DesignCraft saves an opened file under: its title plus '.designcraft'. An IDML
  // package is told by its content, not by its name. Since 0.17.0 the title is the name less one
  // '.designcraft' (a .designcraft package, unless nothing is left) or one '.idml', '.indd' or
  // '.indt' (an IDML package), any case, so 'x.idml.idml' saves as 'x.idml.designcraft'. Before,
  // the title was the name up to its last dot, and an IDML package also lost every '.idml' left at
  // the end ('x.idml.idml' saved as 'x.designcraft'). Equal to the opened name only for a
  // .designcraft in lower case.
  const savedName = (opened, bytes) => {
    const idml = isZipOf(bytes, IDML);
    if (FULL_NAME) {
      const title = idml ? opened.replace(/\.(idml|indd|indt)$/i, '') : opened.replace(/(.)\.designcraft$/i, '$1');
      return title + '.designcraft';
    }
    let title = stem(opened);
    if (idml) title = title.replace(/(\.idml)+$/, '');
    return title + '.designcraft';
  };

  // document.json of a package, found through the zip's central directory as DesignCraft reads it
  // (format/src/lib.rs), unpacked as a stream up to MAX_JSON bytes and parsed; null for anything
  // else. Kept per byte array: the core asks identity() and classify() about the same bytes.
  const MAX_JSON = 256 * 1024 * 1024;
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
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
  const documents = new WeakMap();
  const documentJson = (bytes) => {
    if (!documents.has(bytes)) {
      documents.set(bytes, (async () => {
        if (!isZipOf(bytes, PACKAGE)) return null;
        const entry = entryData(bytes, 'document.json');
        if (!entry || (entry.method !== 0 && entry.method !== 8) || (entry.method === 0 && entry.data.length > MAX_JSON)) return null;
        const json = entry.method === 8 ? await inflate(entry.data) : entry.data;
        const doc = json && JSON.parse(new TextDecoder().decode(json));
        return doc && typeof doc === 'object' ? doc : null;
      })().catch(() => null));
    }
    return documents.get(bytes);
  };

  // The creation time stored in a package, or null for none (0: made in the web build).
  const createdOf = (doc) => {
    const created = doc?.created;
    return typeof created === 'number' && Number.isFinite(created) && created > 0 ? String(created) : null;
  };

  window.craftsuiteLayer.register({
    app: 'designcraft',
    // An opened 'x.idml' saves as 'x.designcraft': the host keeps the IDML and stores the
    // DesignCraft file next to it, and later saves update that file.
    savedName,
    // The document's creation time (see the header). The core sends a save whose identity differs
    // from the opened document's as an export without asking classify().
    async identity(bytes) {
      return createdOf(await documentJson(bytes));
    },
    // 'document' may replace the opened file; everything else becomes a new file. Save rewrites
    // the whole file, so there is no prefix to compare: the name a save of the opened file gets,
    // the package type and the identity decide. An opened document with a creation time keeps it
    // in every save, so a save without one is another document; an opened document without one
    // cannot be told from a new document saved as 'Untitled-N.designcraft'.
    // Known gap: another document without a creation time (made in the web build), opened from
    // the user's disk or created, saves under the opened name if it has the same title, and
    // passes as 'document' unless that title is 'Untitled-N'.
    async classify(save, entry) {
      if (save.name !== entry.savedName || !isZipOf(save.bytes, PACKAGE)) return 'export';
      if (entry.identity) return createdOf(await documentJson(save.bytes)) ? 'document' : 'export';
      return UNTITLED.test(stem(save.name)) ? 'export' : 'document';
    },
  });
})();
