/*
 * craftsuite-layer adapter for CADCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What CADCraft (web build, checked with 0.5.0) does and why the rules
 * below follow from it is described in docs/apps/cadcraft.md. Source references are to the v0.5.0
 * tag; main.rs, upload.rs and download.rs are in apps/cadcraft-web/src/, the other paths under
 * crates/:
 *  - It takes dropped files on its canvas (canvas#cadcraft_canvas, through eframe), the page's
 *    only drop listener, installed once the app runs (main.rs:65-105); the core's default drop
 *    target fits. Every drop, and every file picked with File > Open (a hidden <input type=file>
 *    appended to <body>, upload.rs:41-67), opens a new drawing tab titled with the file's name,
 *    also while a tab with that name is open (engine/src/cmd/file.rs:85-88). The content decides
 *    whether it is a DXF (io/src/lib.rs:32-42); DWG does not open on the web.
 *  - Every download is a Blob typed application/octet-stream behind an <a download> that is
 *    appended, clicked and removed; the URL is revoked after 60 s (download.rs:16-55,
 *    engine/src/cmd/file.rs:151-156).
 *  - Save (Ctrl+S) and Save As (Ctrl+Shift+S) show no dialog on the web: a drawing opened from a
 *    file downloads under its title, the file's name trimmed, plus '.dxf' if it has no
 *    extension (ui-egui/src/menus.rs:87-95, ui-egui/src/lib.rs:104-112, main.rs:50-54), and every
 *    later save under the name it was saved under (engine/src/cmd/file.rs:164-175).
 *  - Every save is a full rewrite of CADCraft's model as R2000 ASCII DXF (io/src/dxf_write.rs).
 *    It writes only what CADCraft models: entities of types it does not model (dxf_write.rs:896-897),
 *    header variables outside its list (dxf_write.rs:185-222) and other programs' xdata and
 *    objects are lost. A DXF from another program loses them on its first save.
 *  - New drawings are 'Drawing<N>', counting from 1 in each session, and Drawing1 is open from the
 *    start (engine/src/lib.rs:466-503); Help > Open Sample Drawing opens 'Bracket'
 *    (ui-egui/src/menus.rs:111-117). They save as 'Drawing<N>.dxf' and 'Bracket.dxf'. CADCraft
 *    writes no document identity into a DXF.
 *  - Exports (saveas with a .svg, .png or .pdf path, typed with JSON parameters) have their own
 *    names (io/src/lib.rs:54-68). Print and Export to PDF download nothing on the web.
 *
 * Rule: a download under the opened file's name, ending in '.dxf', is the document ('document',
 * it may replace the opened file) only if the name is not one CADCraft gives drawings it makes
 * itself, no other file with that save name has entered the app in this frame, the download is a
 * DXF as CADCraft 0.5.0 writes it, and so is the opened file. If the opened file is any other
 * DXF, such a save is a 'copy': the opened file stays as it is, the first save becomes a new file
 * next to it and the later ones replace that file. Everything else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // A DXF as CADCraft 0.5.0 writes it, and would write again without losing anything: its exact
  // start (dxf_write.rs:1329-1335, CRLF line ends from crates/dxf/src/lib.rs:378-391), its own
  // APPID record, '0 EOF' as the last pair, and nothing outside the writer's vocabulary: the
  // object types it writes (group 0, dxf_write.rs and dxf_image.rs), the header variables
  // (group 9 in HEADER, dxf_write.rs:185-222, 1329-1352), the xdata applications (group 1001)
  // and the keys of the named object dictionary (dxf_write.rs:1731-1753). A DXF in CADCraft's
  // layout with anything else (written by a newer CADCraft, or edited by another tool) would
  // lose it on save, so it is not one. Check these lists with every CADCraft release.
  const HEAD = '  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$ACADVER\r\n  1\r\nAC1015\r\n  9\r\n$DWGCODEPAGE\r\n  3\r\nANSI_1252\r\n';
  const APPID = '\r\n100\r\nAcDbRegAppTableRecord\r\n  2\r\nCADCRAFT\r\n';
  const words = (text) => new Set(text.trim().split(/\s+/));
  const TYPES = words(`SECTION ENDSEC TABLE ENDTAB BLOCK ENDBLK EOF CLASS APPID DIMSTYLE LAYER LTYPE
    STYLE UCS VIEW VPORT BLOCK_RECORD 3DFACE ACAD_TABLE ARC ATTDEF ATTRIB CIRCLE DIMENSION ELLIPSE
    HATCH IMAGE INSERT LEADER LINE LWPOLYLINE MTEXT POINT POLYLINE SEQEND SPLINE TEXT VERTEX
    VIEWPORT WIPEOUT RAY XLINE SOLID TRACE DICTIONARY DIMASSOC GROUP LAYOUT MLEADERSTYLE TABLESTYLE
    XRECORD IMAGEDEF IMAGEDEF_REACTOR RASTERVARIABLES`);
  const VARS = words(`$ACADVER $DWGCODEPAGE $EXTMIN $EXTMAX $INSBASE $LIMMIN $LIMMAX $ORTHOMODE
    $FILLMODE $MIRRTEXT $LTSCALE $ATTMODE $TEXTSIZE $TRACEWID $TEXTSTYLE $CLAYER $CELTYPE $CECOLOR
    $CELTSCALE $DIMSCALE $DIMSTYLE $LUNITS $LUPREC $AUNITS $AUPREC $ELEVATION $THICKNESS $FILLETRAD
    $CHAMFERA $CHAMFERB $ANGBASE $ANGDIR $PDMODE $PDSIZE $PLINEWID $CELWEIGHT $LWDISPLAY $INSUNITS
    $MEASUREMENT $PSLTSCALE $CMLEADERSTYLE $HANDSEED`);
  const APPS = words('ACAD CADCRAFT AcadAnnotative AcCmTransparency AcAecLayerStandard');
  const ROOT_KEYS = words(`ACAD_GROUP ACAD_IMAGE_DICT ACAD_IMAGE_VARS ACAD_LAYOUT ACAD_MLEADERSTYLE
    ACAD_TABLESTYLE CADCRAFT_CONSTRAINTS CADCRAFT_LAYERSTATES`);

  const readCadcraftDxf = (bytes) => {
    // The start first, so that a large DXF of another program is not decoded as a whole.
    if (bytes.length < HEAD.length || new TextDecoder('latin1').decode(bytes.subarray(0, HEAD.length)) !== HEAD) return false;
    const text = new TextDecoder('latin1').decode(bytes);
    if (!text.includes(APPID)) return false;
    let section = null; // the section the pairs are in, from the '2' after '0 SECTION'
    let objects = 0; // in OBJECTS: 1 before the named object dictionary, 2 in it, 3 after it
    let previous = '';
    for (let at = 0; at < text.length;) {
      const a = text.indexOf('\r\n', at);
      const b = a < 0 ? -1 : text.indexOf('\r\n', a + 2);
      if (b < 0) return false;
      const code = text.slice(at, a).trim();
      const value = text.slice(a + 2, b);
      at = b + 2;
      if (code === '0') {
        if (!TYPES.has(value)) return false;
        if (value === 'EOF') return at === text.length;
        if (objects === 2) objects = 3;
        if (objects === 1 && value === 'DICTIONARY') objects = 2;
      } else if (code === '2' && previous === 'SECTION') {
        section = value;
        if (section === 'OBJECTS') objects = 1;
      } else if ((code === '9' && section === 'HEADER' && !VARS.has(value)) || (code === '1001' && !APPS.has(value)) ||
        (code === '3' && objects === 2 && !ROOT_KEYS.has(value))) {
        return false;
      }
      previous = code === '0' ? value : '';
    }
    return false; // no '0 EOF'
  };
  // Kept per byte array: the core asks identity() and classify() about the same bytes.
  const checked = new WeakMap();
  const isCadcraftDxf = (bytes) => {
    if (!checked.has(bytes)) checked.set(bytes, readCadcraftDxf(bytes));
    return checked.get(bytes);
  };
  const PROVENANCE = 'cadcraft-0.5.0-dxf';

  // Names CADCraft gives drawings it makes itself: new drawings (counting from 1) and the sample.
  // Not translated.
  const MADE_BY_APP = /^(?:Drawing[1-9]\d*|Bracket)\.dxf$/;

  // The core's safeName (core.js), which every save name passes through before it reaches
  // classify(): the save names of files that enter the app are compared after the same changes.
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
  // The name CADCraft saves a file under that it opened: its title, the file name, trimmed, plus
  // '.dxf' if it has no extension (ui-egui/src/lib.rs:104-112, as Rust's Path::extension). Rust's
  // trim removes Unicode White_Space, which is not what JavaScript's trim() removes: it includes
  // U+0085 and not U+FEFF. A file named 'plan.dxf' followed by U+0085 saves as 'plan.dxf'.
  const SPACE = '[\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const RUST_TRIM = new RegExp(`^${SPACE}+|${SPACE}+$`, 'g');
  const saveNameOf = (fileName) => {
    const title = String(fileName).replace(RUST_TRIM, '');
    return safeName(!title ? 'Drawing.dxf' : title.lastIndexOf('.') > 0 ? title : title + '.dxf');
  };

  // Files that entered the app, by the name CADCraft saves them under: the core's drop of the
  // opened file, and every other drop or File > Open pick. The host opens one file per frame, so
  // a second one with the same save name is another drawing that saves under the opened name.
  // The listeners are added in started(), after the app's drop listener: the core takes the first
  // drop listener on the page for the app's drop target.
  const entered = new Map();
  const note = (files) => {
    try {
      for (const file of files || []) {
        const name = saveNameOf(file.name);
        entered.set(name, (entered.get(name) || 0) + 1);
      }
    } catch { /* never break the app's drop */ }
  };

  window.craftsuiteLayer.register({
    app: 'cadcraft',
    // CADCraft can take files as soon as its drop listener exists; this only starts listening.
    started() {
      window.addEventListener('drop', (event) => note(event.dataTransfer && event.dataTransfer.files), true);
      document.addEventListener('change', (event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'file') note(event.target.files);
      }, true);
      return Promise.resolve();
    },
    // Not an identity (CADCraft writes none): whether the bytes are a DXF as CADCraft 0.5.0 writes
    // it. The core keeps it with the opened file and takes it from every stored document save.
    identity(bytes) {
      return isCadcraftDxf(bytes) ? PROVENANCE : null;
    },
    // 'document' may replace the opened file, 'copy' goes next to it; everything else becomes a
    // new file. Save rewrites the whole file, so there is no prefix to compare.
    // Known gap: another drawing that takes the opened name through a typed JSON command (saveas
    // with that path, or open with base64 data and that name).
    classify(save, entry) {
      if (save.name !== entry.name || !/\.dxf$/i.test(save.name)) return 'export';
      if (MADE_BY_APP.test(save.name)) return 'export'; // could be the new drawing or the sample
      if ((entered.get(entry.name) || 0) > 1) return 'export'; // another drawing has the name too
      if (!isCadcraftDxf(save.bytes)) return 'export'; // not what Save writes
      return entry.identity === PROVENANCE ? 'document' : 'copy';
    },
  });
})();
