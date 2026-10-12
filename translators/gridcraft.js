/*
 * craftsuite-layer adapter for GridCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What GridCraft (web build, checked with 0.5.0) does and why the rules
 * below follow from it is described in docs/apps/gridcraft.md (source paths at the v0.5.0 tag;
 * web.rs is apps/gridcraft-web/src/web.rs, the other paths are under crates/):
 *  - It takes dropped files on its canvas (canvas#gridcraft_canvas), where eframe registers its
 *    only drop listener once the app exists (web.rs:27-54); the core's default drop target fits.
 *    Every dropped file opens as a new workbook window, never into the open one
 *    (ui-egui/src/lib.rs:571-584): the content decides the format before the name (XLSX, ODS and
 *    XLSB as data imports, CSV for anything else, engine/src/io.rs:40-91). Import warnings
 *    (dropped macros, ...) show in a message box.
 *  - A dropped file has no path, so Save (Ctrl+S) and Save As (Ctrl+Shift+S) both download at once,
 *    without a dialog, named '<stem of the title>.xlsx' (ui-egui/src/lib.rs:395-408,
 *    engine/src/cmd/file.rs:80-113). The title is the opened name, or '<stem> (imported).xlsx' for
 *    ODS and XLSB (file.rs:50-56). So 'x.xlsx' saves as 'x.xlsx', 'x.xlsm' and 'x.csv' as 'x.xlsx',
 *    'x.ods' as 'x (imported).xlsx', and every later Save writes that name again.
 *  - Every download is a Blob behind an <a download> that is clicked and removed at once
 *    (web.rs:182-205). Besides Save, only Export as PDF (in Search Commands) downloads, as
 *    '<title with .pdf>' (ui-egui/src/lib.rs:266-275).
 *  - Save rewrites the whole package from GridCraft's model (xlsx/src/write.rs:138-358), with
 *    docProps/app.xml '<Application>GridCraft</Application>'. What the model lacks is lost, some
 *    of it with an import warning (a VBA project, external links, embedded objects and form
 *    controls), some silently (custom properties, customXml items, the creation time). A file
 *    GridCraft wrote comes back as it was: an unchanged save of it equals the opened bytes.
 *  - There is no document identity (no creation time, no id; the writer is deterministic). New
 *    workbooks are 'Book<N>' (engine/src/lib.rs:245-254), the samples of the Start dialog
 *    'Household Budget', 'Quarterly Sales Dashboard' and 'Gradebook' (engine/src/sample.rs:11-15),
 *    not translated; they save under those names, also while a file of that name is open.
 *    (sample.rs falls back to the title 'Sample', but file.new fails for an unknown sample before
 *    it gets there, file.rs:23-29.)
 *  - Files can also reach the app from the user: a drop from the desktop, or File > Open… (Ctrl+O),
 *    which reads a file input (web.rs:107-122). They open as further workbooks and save as
 *    '<stem>.xlsx' like the opened file.
 *  - View > New Window makes a copy of the active workbook titled '<title>:2'
 *    (engine/src/cmd/extra.rs:609-614). Path::file_stem cuts 'x.xlsx:2' at its last dot, so the
 *    copy of the opened workbook saves under the opened name and passes as the opened document, as
 *    on the desktop; the copy of 'Book1' has no dot and saves as 'Book1:2.xlsx'.
 *
 * Rules: a download may be the document only under the name GridCraft saves the opened file under
 * (savedName), ending in '.xlsx', not named like a new workbook or a sample, not the save name of a
 * file the user brought in, and written by GridCraft. Then:
 *  - a file saved under its own name (an opened .xlsx, also 'X.XLSX', which saves as 'X.xlsx': a
 *    host that compares names without letter case takes that for the opened file) is 'document'
 *    only if GridCraft wrote it (docProps/app.xml says GridCraft, and the package has no part
 *    GridCraft's writer never writes); a file of another program is 'copy': the first save becomes
 *    a new file next to it, later saves replace that file, and the opened file stays as it is;
 *  - a file saved under another name (.xlsm, .ods, .csv) is 'document': the host stores it next to
 *    the original, which is never replaced, and later saves replace it.
 * Everything else is an export.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // The name up to its last dot, as Rust's Path::file_stem cuts it (a leading dot is kept).
  const stem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };
  const extension = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  };

  // The core's safeName (core.js), which every save name passes through before it reaches
  // classify(): the save names of the user's own files are compared after the same changes.
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

  // Titles of new workbooks and of the samples, not translated, also those of the copies View >
  // New Window makes of them ('Book1:2', 'Book1:2:2', ...).
  const NEW_DOCUMENT = /^(?:Book\d+|Household Budget|Quarterly Sales Dashboard|Gradebook)(?::2)*$/;
  const ODS = 'application/vnd.oasis.opendocument.spreadsheet';
  const APPLICATION = '<Application>GridCraft</Application>';

  // Every part GridCraft's writer can produce (xlsx/src/write.rs, sheet_write.rs:455-523,
  // pivot.rs:284-344, richdata.rs:297-339, image types from drawing.rs:380-401). A package with
  // any other part (customXml/, docProps/custom.xml, xl/vbaProject.bin, xl/externalLinks/,
  // xl/embeddings/, xl/activeX/, xl/ctrlProps/, xl/calcChain.xml, xl/printerSettings/, ...) was
  // changed by another program since, even if app.xml still says GridCraft.
  const WRITER_PART = new RegExp('^(?:' + [
    '\\[Content_Types\\]\\.xml',
    '_rels/\\.rels',
    'docProps/(?:core|app)\\.xml',
    'xl/(?:workbook|styles|sharedStrings|metadata)\\.xml',
    'xl/_rels/workbook\\.xml\\.rels',
    'xl/theme/theme1\\.xml',
    'xl/worksheets/sheet\\d+\\.xml',
    'xl/worksheets/_rels/sheet\\d+\\.xml\\.rels',
    'xl/drawings/drawing\\d+\\.xml',
    'xl/drawings/_rels/drawing\\d+\\.xml\\.rels',
    'xl/drawings/vmlDrawing\\d+\\.vml',
    'xl/media/image\\d+\\.(?:png|jpeg|gif|bmp|tiff|svg|emf|wmf|webp)',
    'xl/media/cellImage\\d+\\.(?:png|jpeg)',
    'xl/charts/(?:chart|chartEx|style|colors)\\d+\\.xml',
    'xl/charts/_rels/chartEx\\d+\\.xml\\.rels',
    'xl/comments\\d+\\.xml',
    'xl/tables/table\\d+\\.xml',
    'xl/pivotCache/pivotCache(?:Definition|Records)\\d+\\.xml',
    'xl/pivotCache/_rels/pivotCacheDefinition\\d+\\.xml\\.rels',
    'xl/pivotTables/pivotTable\\d+\\.xml',
    'xl/pivotTables/_rels/pivotTable\\d+\\.xml\\.rels',
    'xl/richData/(?:rdrichvalue|rdrichvaluestructure|richValueRel)\\.xml',
    'xl/richData/_rels/richValueRel\\.xml\\.rels',
  ].join('|') + ')$');

  // The zip's central directory, as GridCraft's zip reader finds it: [{name, method, size, local}],
  // or null for anything that is not a zip.
  const MAX_PART = 1024 * 1024; // app.xml and mimetype are small; anything larger is not GridCraft's
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const utf8 = new TextDecoder();
  const entries = (bytes) => {
    if (bytes.length < 22 || u32(bytes, 0) !== 0x04034b50) return null;
    let end = -1; // the end of central directory record, within the last 64 KiB + 22 bytes
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
      if (u32(bytes, i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) return null;
    const list = [];
    let at = u32(bytes, end + 16);
    for (let n = u16(bytes, end + 10); n > 0; n--) {
      if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) return null;
      const nameLength = u16(bytes, at + 28);
      list.push({
        name: utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
        method: u16(bytes, at + 10),
        size: u32(bytes, at + 20),
        local: u32(bytes, at + 42),
      });
      at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    }
    return list;
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
        if (size > MAX_PART) return null;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  };
  // The text of one part, or null.
  const partText = async (bytes, list, wanted) => {
    const entry = list && list.find((e) => e.name === wanted);
    if (!entry || (entry.method !== 0 && entry.method !== 8) || entry.size > MAX_PART) return null;
    const local = entry.local;
    if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) return null;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    if (start + entry.size > bytes.length) return null;
    const data = bytes.subarray(start, start + entry.size);
    const text = entry.method === 8 ? await inflate(data) : data;
    return text && utf8.decode(text);
  };

  // What the adapter needs to know about a package, kept per byte array: the core asks savedName()
  // and classify() about the same bytes.
  //   gridcraft: docProps/app.xml says GridCraft (every GridCraft save does)
  //   pure: also no part GridCraft's writer never writes (the file was not changed elsewhere)
  //   ods: an ODS package (a 'mimetype' entry with exactly the ODS type, xlsx/src/ods.rs:33-44)
  const packages = new WeakMap();
  const packageOf = (bytes) => {
    if (!packages.has(bytes)) {
      packages.set(bytes, (async () => {
        const list = entries(bytes);
        if (!list) return { gridcraft: false, pure: false, ods: false };
        const app = await partText(bytes, list, 'docProps/app.xml');
        const gridcraft = app !== null && app.includes(APPLICATION);
        const pure = gridcraft && list.every((e) => WRITER_PART.test(e.name));
        const ods = (await partText(bytes, list, 'mimetype')) === ODS;
        return { gridcraft, pure, ods };
      })().catch(() => ({ gridcraft: false, pure: false, ods: false })));
    }
    return packages.get(bytes);
  };

  // GridCraft's title rule (file.rs:50-56): ODS and XLSB, by extension in any letter case or by
  // content, are imports titled '<stem> (imported).xlsx'. An XLSB under another name is not
  // recognised here: GridCraft then saves under a name other than savedName, and its saves stay
  // exports.
  const importedName = (name, pkg) => ['ods', 'xlsb'].includes(extension(name)) || pkg.ods;

  // Opened names whose save under the same name, in any letter case, would replace a file another
  // program wrote: such saves are copies.
  const foreign = new Set();

  // Save names of files the user brought in: a drop from the desktop or a file chosen in a file
  // input (File > Open…). They open as further workbooks and save as '<stem>.xlsx' (or
  // '<stem> (imported).xlsx') like the opened file, so a save under such a name may be that other
  // workbook. The core's drop is synthetic (isTrusted false) and the core uses no file input, so
  // neither counts. GridCraft 0.5.0 reads both through `files` (eframe's drop handler, rfd's file
  // input); should a release read them another way, such files go unnoticed again (see
  // docs/apps/gridcraft.md, known gaps). The picture picker (Insert > Picture) is not counted: its
  // files go into the workbook, not into a window of their own.
  const userNames = new Set();
  const seen = new WeakSet();
  const noteUserFile = (file) => {
    if (!(file instanceof File) || seen.has(file)) return;
    seen.add(file);
    const base = stem(String(file.name || 'dropped.xlsx'));
    userNames.add(safeName(base + '.xlsx'));
    userNames.add(safeName(base + ' (imported).xlsx'));
  };
  const IMAGE = /^(?:\.(?:png|jpe?g|gif|bmp|webp|tiff?|svg)|image\/.*)$/i;
  const imagesOnly = (accept) => {
    const types = String(accept || '').split(',').map((t) => t.trim()).filter(Boolean);
    return types.length > 0 && types.every((t) => IMAGE.test(t));
  };
  const watchFiles = (proto, counts) => {
    const desc = Object.getOwnPropertyDescriptor(proto, 'files');
    if (!desc || typeof desc.get !== 'function' || !desc.configurable) return;
    Object.defineProperty(proto, 'files', {
      ...desc,
      get() {
        const list = desc.get.call(this);
        try {
          if (list && counts(this)) for (const file of list) noteUserFile(file);
        } catch { /* never break the app's read */ }
        return list;
      },
    });
  };
  watchFiles(DataTransfer.prototype, () => {
    const event = window.event; // the drop being dispatched, if any
    return !!event && event.type === 'drop' && event.isTrusted;
  });
  watchFiles(HTMLInputElement.prototype, (input) => input.type === 'file' && !imagesOnly(input.accept));

  window.craftsuiteLayer.register({
    app: 'gridcraft',
    // The name Save gives the opened file. Also notes whether a save under the opened name would
    // replace a file GridCraft did not write. 'X.XLSX' saves as 'X.xlsx': only the letter case
    // differs, and a host may take that for the opened file (it is one on a file system that
    // ignores case), so it counts as the opened name.
    async savedName(name, bytes) {
      const pkg = await packageOf(bytes);
      const saved = stem(name) + (importedName(name, pkg) ? ' (imported).xlsx' : '.xlsx');
      if (saved.toLowerCase() === name.toLowerCase() && !pkg.pure) foreign.add(name);
      else foreign.delete(name);
      return saved;
    },
    // 'document' may replace the opened file (or, under another name, the file the host stored
    // next to it); 'copy' must not replace it; anything else becomes a new file. See the header.
    // Known behaviour: the window View > New Window opens on the opened workbook saves under the
    // opened name and passes as the document (or its copy), as GridCraft's desktop app writes both
    // windows to the same file.
    async classify(save, entry) {
      if (save.name !== entry.savedName || !save.name.endsWith('.xlsx')) return 'export';
      if (NEW_DOCUMENT.test(stem(save.name)) || userNames.has(save.name)) return 'export';
      if (!(await packageOf(save.bytes)).gridcraft) return 'export';
      if (foreign.has(entry.name)) return 'copy';
      return 'document';
    },
  });
})();
