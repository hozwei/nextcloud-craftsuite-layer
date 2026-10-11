/*
 * craftsuite-layer adapter for PhotoCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What PhotoCraft (web build, checked with 0.6.0) does and why the rules
 * below follow from it is described in docs/apps/photocraft.md:
 *  - It takes dropped files on its canvas (canvas#photocraft_canvas, through eframe); the core's
 *    default drop target fits. On the web every drop opens a new document tab, also while a
 *    document is open: the web shell reads dropped files itself and never places them.
 *  - Every download (Save, Save As, Export As, Quick Export as PNG, Save for Web, swatch, preset and
 *    measurement exports) is a Blob behind a hidden <a download> that is clicked and removed; the
 *    object URL is revoked after 10 s. The Blob type follows the extension.
 *  - Save and Save As show no dialog on the web. A dropped file has no path, so Save writes
 *    '<stem>.psd' (a .pdn: '<stem>.pcraft'), a full rewrite. Only a PSD opened under a lowercase
 *    '.psd' name comes back under its own name. The document then takes the name it was saved
 *    under, and every later Save writes that name again.
 *  - Flat exports keep the stem: Quick Export as PNG of an opened 'photo.png' downloads 'photo.png',
 *    a flattened copy. Such a download is never the document.
 *  - Files can also reach the app from the user (a drop from the desktop, File > Open). PhotoCraft
 *    saves most of them as '<stem>.psd' as well, so one with the opened file's stem would come back
 *    under the opened name with other content. A .pcraft saves under the document name stored in
 *    it, and a template (.psdt) opens as 'Untitled-N', so their save names cannot be told from
 *    their file names.
 *  - New documents are named 'Untitled-1' (File > New), 'Untitled' (File > New from Clipboard),
 *    'Untitled-N' (templates) or the like, also translated ('Unbenannt-1'), and save as
 *    '<name>.psd' without a dialog. A PSD carries nothing that tells two documents apart.
 *  - Some commands make new documents from the open one whose names keep its file name: Image >
 *    Duplicate ('photo.psd copy'), Split Channels ('photo.psd_Red') and Crop and Straighten Photos
 *    ('photo.psd copy 2'). Save cuts the name at its last dot, so they save as 'photo.psd' too and
 *    pass as the document: a known gap (docs/apps/photocraft.md), which only a document id in
 *    PhotoCraft's files could close.
 *
 * Rule: a download is the document only if it has exactly the name PhotoCraft saves the opened
 * file under (savedName: '<stem>.psd', so 'photo.png' gives 'photo.psd' and the host keeps the
 * PNG and stores 'photo.psd' next to it), that name ends in '.psd' or '.psb', its stem is not a
 * name PhotoCraft gives new documents, its bytes are a Photoshop file ('8BPS', version 1 or 2),
 * no file with the same save name reached the app from elsewhere in this frame, and no .pcraft
 * or template did. Everything else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // '8BPS' and the version as a big-endian u16: 1 is PSD, 2 is PSB. PhotoCraft writes a PSB under a
  // '.psd' name when the image is wider or taller than 30000 px or larger than 2 GB.
  const isPhotoshopFile = (b) => b.length >= 26 && b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 &&
    b[3] === 0x53 && b[4] === 0 && (b[5] === 1 || b[5] === 2);

  // The name without its last extension, as PhotoCraft replaces it when it picks the save name.
  const stem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };

  // The core's safeName (core.js), which every save name passes through before it reaches
  // classify(): the stem of a foreign file is compared after the same changes.
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

  // Names PhotoCraft gives new documents: 'Untitled-1' from File > New (new_doc_ui.rs), 'Untitled'
  // from New from Clipboard and file.new without a name, the first free 'Untitled-N' for a
  // template (file_open.rs, with the translated base), 'Untitled_Panorama<n>' and 'Untitled_HDR<n>'
  // (photo_cmds.rs). The translations of 'Untitled' are those of the 0.6.0 catalogs
  // (crates/ui-egui/src/i18n/*.tsv).
  const UNTITLED = new RegExp('^(?:(?:' + ['Untitled', 'Unbenannt', 'Sans titre', 'Sin título', 'Senza titolo',
    'Sem título', 'Naamloos', 'Bez názvu', 'Bez tytułu', 'Без имени', 'Без назви', 'Χωρίς τίτλο',
    'Tanpa Judul', '名称未設定', '未标题', '未命名', '제목 없음'].join('|') + ')(?:-\\d+)?|Untitled_(?:Panorama|HDR)\\d+)$', 'u');

  // Preset files open no document (preset_files_ui.rs, PRESET_EXTS, and the Preset Manager's own
  // .pcpresets): a brush named like the image must not block its saves.
  const PRESET = /\.(abr|grd|aco|ase|kys|psp|pcpresets)$/i;
  // A zip is a .pcraft by content (format/src/lib.rs is_pcraft); the other types PhotoCraft opens
  // are not zips.
  const ZIP = [0x50, 0x4b, 0x03, 0x04];

  // Files the app read from a user's own drop or from its file picker. The core's drop is
  // synthetic (isTrusted false) and does not count. PhotoCraft 0.6.0 reads both through `files`
  // (eframe's drop handler and the file picker's <input type=file>); should a release read them
  // another way, such files go unnoticed again (see docs/apps/photocraft.md, known gaps).
  // foreignStems: the stems of the names PhotoCraft saves them under ('<stem>.psd', after the
  // core's safeName). foreignUnnamed: a .pcraft or a template came in, whose save name is not
  // its file's: from then on no save is the document.
  const foreignStems = new Set();
  let foreignUnnamed = false;
  const seen = new WeakSet();
  const noteForeign = (file) => {
    if (!(file instanceof File) || seen.has(file)) return;
    seen.add(file);
    const name = String(file.name);
    if (PRESET.test(name)) return;
    if (/\.(pcraft|psdt)$/i.test(name)) {
      foreignUnnamed = true;
      return;
    }
    foreignStems.add(stem(safeName(stem(name) + '.psd')));
    file.slice(0, 4).arrayBuffer().then((head) => {
      const b = new Uint8Array(head);
      if (ZIP.every((x, i) => b[i] === x)) foreignUnnamed = true;
    }, () => { foreignUnnamed = true; });
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

  window.craftsuiteLayer.register({
    app: 'photocraft',
    // PhotoCraft waits up to 10 s for its preset storage (IndexedDB) before it takes drops.
    dropTargetTimeout: 15000,
    // Save As on the web: the opened name with the extension replaced, lower case (file_dialog.rs).
    savedName(name) {
      return stem(name) + (/\.pdn$/i.test(name) ? '.pcraft' : '.psd');
    },
    // 'document' may replace the opened file; everything else becomes a new file. A file whose
    // stem is a new document's name ('Untitled-1.png') is never saved back: a new document saves
    // under the same name, and nothing in the bytes tells the two apart.
    // Known gap: a new document (File > New) given the opened file's stem as its name.
    classify(save, entry) {
      if (save.name !== entry.savedName || !/\.ps[db]$/.test(save.name)) return 'export';
      if (UNTITLED.test(stem(save.name))) return 'export';
      if (foreignUnnamed || foreignStems.has(stem(save.name))) return 'export';
      return isPhotoshopFile(save.bytes) ? 'document' : 'export';
    },
  });
})();
