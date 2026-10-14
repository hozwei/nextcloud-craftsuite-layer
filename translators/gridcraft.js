/*
 * craftsuite-layer adapter for GridCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What GridCraft (web build, checked with 0.5.0 and 0.6.1) does and why
 * the rules below follow from it is described in docs/apps/gridcraft.md (source paths at the
 * v0.6.1 tag; web.rs is apps/gridcraft-web/src/web.rs, the other paths are under crates/):
 *  - It takes dropped files on its canvas (canvas#gridcraft_canvas), where eframe registers its
 *    only drop listener once the app exists (web.rs:28-56); the core's default drop target fits.
 *    Every dropped file opens as a new workbook window, never into the open one
 *    (web.rs:76-92, ui-egui/src/lib.rs:948-970): the content decides the format before the name
 *    (XLSX; ODS, XLSB and legacy XLS as data imports; CSV for anything else,
 *    engine/src/io.rs:87-140). Import warnings (macros not run, ...) show in a message box.
 *  - A dropped file has no path, so Save (Ctrl+S) and Save As (Ctrl+Shift+S) both download at once,
 *    without a dialog, named '<stem of the title>.xlsx' (ui-egui/src/lib.rs:615-630,
 *    engine/src/cmd/file.rs:94-133). The title is the opened name, or '<stem> (imported).xlsx' for
 *    ODS, XLSB and XLS (file.rs:60-67). So 'x.xlsx' saves as 'x.xlsx', 'x.xlsm' and 'x.csv' as
 *    'x.xlsx', 'x.ods' as 'x (imported).xlsx', and every later Save writes that name again. The File
 *    view's Save opens its Save As page, whose Download (.xlsx) does the same
 *    (ui-egui/src/backstage.rs:221-233, :517-551).
 *  - Every download is a Blob behind an <a download> that is clicked and removed at once
 *    (web.rs:358-379); since 0.6.1 only where the browser has no window.showSaveFilePicker or
 *    refuses it (a cross-origin frame in Chromium), web.rs:250-334. Besides Save, Export as PDF
 *    downloads '<title with .pdf>' (ui-egui/src/lib.rs:395-406) and, since 0.6.1, the File view's
 *    Export and Save As pages '<stem>.csv' and '<stem>.html' (backstage.rs:713-791).
 *  - Save rewrites the whole package from GridCraft's model (xlsx/src/write.rs:164-420), with
 *    docProps/app.xml '<Application>GridCraft</Application>'. What the model lacks is lost: in
 *    0.5.0 every part it does not write (custom properties, customXml items, external links, ...);
 *    since 0.6.1 it keeps most such parts unread under their names (xlsx/src/passthrough.rs), but
 *    still drops the creation time, Excel's own properties and what reaches a part it rewrites. A
 *    file GridCraft wrote comes back as it was: an unchanged save of it equals the opened bytes.
 *  - There is no document identity (no creation time, no id; the writer is deterministic). New
 *    workbooks are 'Book<N>' (engine/src/lib.rs:296-305), the samples of the Start dialog
 *    'Household Budget', 'Quarterly Sales Dashboard' and 'Gradebook' (engine/src/sample.rs:11-15),
 *    not translated; they save under those names, also while a file of that name is open.
 *    (sample.rs falls back to the title 'Sample', but file.new fails for an unknown sample before
 *    it gets there, file.rs:32-42.)
 *  - Files can also reach the app from the user: a drop from the desktop, or File > Open… (Ctrl+O),
 *    which reads a file input (web.rs:109-124). They open as further workbooks and save as
 *    '<stem>.xlsx' like the opened file.
 *  - View > New Window makes a copy of the active workbook titled '<title>:2'
 *    (engine/src/cmd/extra.rs:764-770). Path::file_stem cuts 'x.xlsx:2' at its last dot, so the
 *    copy of the opened workbook saves under the opened name and passes as the opened document, as
 *    on the desktop; the copy of 'Book1' has no dot and saves as 'Book1:2.xlsx'.
 *
 * Rules: a download may be the document only under the name GridCraft saves the opened file under
 * (savedName), ending in '.xlsx', not named like a new workbook or a sample, not the save name of a
 * file the user brought in, and written by GridCraft. Then:
 *  - a file saved under its own name (an opened .xlsx, also 'X.XLSX', which saves as 'X.xlsx': a
 *    host that compares names without letter case takes that for the opened file) is 'document'
 *    only if GridCraft wrote it (docProps/app.xml says GridCraft) and the save still has every part
 *    of it that GridCraft does not rebuild from its model; a file of another program, or a save
 *    that lost such a part, is 'copy': the first save becomes a new file next to it, later saves
 *    replace that file, and the opened file stays as it is;
 *  - a file saved under another name (.xlsm, .ods, .csv) is 'document': the host stores it next to
 *    the original, which is never replaced, and later saves replace it.
 * Everything else is an export.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // GridCraft 0.6.1 saves through the browser's save picker where there is one (web.rs:250-334). A
  // cross-origin frame may not show it in Chromium, and GridCraft then downloads; a frame the
  // browser let show it would write the save to the user's disk, never to the host. Without the
  // function GridCraft downloads at once, as 0.5.0 always did.
  try {
    delete window.showSaveFilePicker;
  } catch { /* not configurable: the browser's refusal still leads to a download */ }

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

  // The parts GridCraft rebuilds from its model on every save, as every release since 0.5.0 writes
  // them (xlsx/src/write.rs, sheet_write.rs:495-575, pivot.rs:284-350, richdata.rs:280-340, image
  // types from drawing.rs:466-489); a save may renumber them or leave them out as the workbook
  // changes. Every other part of a file GridCraft wrote must still be in the save under its name:
  // parts GridCraft keeps unread since 0.6.1 (customXml/, docProps/custom.xml, xl/externalLinks/,
  // xl/embeddings/, xl/ctrlProps/, ...) and parts only newer releases write from their model
  // (xl/threadedComments/, xl/persons/, xl/featurePropertyBag/), which an older release drops; and
  // parts another program added, which GridCraft may drop (xl/vbaProject.bin, xl/calcChain.xml, a
  // part no relationship reaches, ...).
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
  //   names: the names of its parts
  //   others: those that are not a WRITER_PART
  //   ods: an ODS package (a 'mimetype' entry with exactly the ODS type, xlsx/src/ods.rs:34-45)
  const NO_PACKAGE = { gridcraft: false, names: new Set(), others: [], ods: false };
  const packages = new WeakMap();
  const packageOf = (bytes) => {
    if (!packages.has(bytes)) {
      packages.set(bytes, (async () => {
        const list = entries(bytes);
        if (!list) return NO_PACKAGE;
        const app = await partText(bytes, list, 'docProps/app.xml');
        const gridcraft = app !== null && app.includes(APPLICATION);
        const names = new Set(list.map((e) => e.name));
        const others = [...names].filter((name) => !WRITER_PART.test(name));
        const ods = (await partText(bytes, list, 'mimetype')) === ODS;
        return { gridcraft, names, others, ods };
      })().catch(() => NO_PACKAGE));
    }
    return packages.get(bytes);
  };

  // GridCraft's title rule (file.rs:60-67, io.rs:25-39): ODS, XLSB and, since 0.6.1, XLS (also
  // .xlt), by extension in any letter case or by content, are imports titled
  // '<stem> (imported).xlsx'. An XLSB or XLS under another name is not recognised here: GridCraft
  // then saves under a name other than savedName, and its saves stay exports.
  const importedName = (name, pkg) => ['ods', 'xlsb', 'xls', 'xlt'].includes(extension(name)) || pkg.ods;

  // Opened names whose saves come back under the same name, in any letter case: null for a file
  // GridCraft did not write (every save of it is a copy), else the parts of the opened file that a
  // save must still have to replace it (see WRITER_PART).
  const ownName = new Map();

  // Save names of files the user brought in: a drop from the desktop or a file chosen in a file
  // input (File > Open…). They open as further workbooks and save as '<stem>.xlsx' (or
  // '<stem> (imported).xlsx') like the opened file, so a save under such a name may be that other
  // workbook. The core's drop is synthetic (isTrusted false) and the core uses no file input, so
  // neither counts. GridCraft (0.5.0 and 0.6.1) reads both through `files` (eframe's drop handler,
  // rfd's file input); should a release read them another way, such files go unnoticed again (see
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

  // The interface language: GridCraft reads navigator.language (only the first preference, by
  // its primary subtag) when the app is created, and stores no choice on the web
  // (crates/ui-egui/src/i18n.rs:76-104). BCP 47 tag -> what navigator.language has to say. Chinese,
  // Japanese and Korean the web build itself drops (no font, apps/gridcraft-web/src/web.rs:42-50).
  const LANGUAGES = { en: 'en', es: 'es', 'pt-BR': 'pt', ru: 'ru' };

  window.craftsuiteLayer.register({
    app: 'gridcraft',
    language(tag, util) {
      const key = util.matchLanguage(tag, LANGUAGES);
      if (key) util.preferLanguages(LANGUAGES[key]);
      return key;
    },
    // The name Save gives the opened file. Also notes what a save under the opened name must keep
    // to replace it. 'X.XLSX' saves as 'X.xlsx': only the letter case differs, and a host may take
    // that for the opened file (it is one on a file system that ignores case), so it counts as the
    // opened name.
    async savedName(name, bytes) {
      const pkg = await packageOf(bytes);
      const saved = stem(name) + (importedName(name, pkg) ? ' (imported).xlsx' : '.xlsx');
      if (saved.toLowerCase() === name.toLowerCase()) ownName.set(name, pkg.gridcraft ? pkg.others : null);
      else ownName.delete(name);
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
      const pkg = await packageOf(save.bytes);
      if (!pkg.gridcraft) return 'export';
      if (!ownName.has(entry.name)) return 'document';
      const keep = ownName.get(entry.name);
      return keep && keep.every((part) => pkg.names.has(part)) ? 'document' : 'copy';
    },
  });
})();
