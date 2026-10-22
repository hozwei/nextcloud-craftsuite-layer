/*
 * craftsuite-layer adapter for CADCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What CADCraft (web build, checked with 0.5.0 and 0.6.2, its DXF writer
 * also with 0.10.0) does and why the rules below follow from it is described in
 * docs/apps/cadcraft.md. Source references are to the v0.6.2 tag; main.rs, upload.rs and
 * download.rs are in apps/cadcraft-web/src/, the other paths under crates/:
 *  - It takes dropped files on its canvas (canvas#cadcraft_canvas, through eframe), the page's
 *    only drop listener, installed once the app runs (main.rs:95-148); the core's default drop
 *    target fits. Every drop, and every file picked with File > Open (a hidden <input type=file>
 *    appended to <body>, upload.rs:41-68), opens a new drawing tab titled with the file's name,
 *    also while a tab with that name is open (engine/src/cmd/file.rs:231-243). DWG does not open
 *    on the web.
 *  - Every download is a Blob behind an <a download> that is appended, clicked and removed; the
 *    URL is revoked after 60 s (download.rs:16-55, engine/src/cmd/file.rs:316-331).
 *  - Save (Ctrl+S) and Save As (Ctrl+Shift+S) show no dialog on the web: a drawing opened from a
 *    file downloads under its title, the file's name trimmed, plus '.dxf' if it has no
 *    extension (ui-egui/src/menus.rs:148-156, ui-egui/src/lib.rs:130-136, main.rs:67-71), and
 *    every later save under the name it was saved under (engine/src/cmd/file.rs:337-351).
 *  - Every save is a full rewrite of the drawing as ASCII DXF (io/src/dxf_write.rs). The first
 *    save of an opened file writes the DXF version chosen in OPTIONS (2018 unless the user
 *    changed it, ui-egui/src/menus.rs:368-374), every later one that version again
 *    (io/src/lib.rs:40-42). CADCraft keeps entities, objects and xdata it does not model
 *    (io/src/dxf_raw.rs), but not header variables outside its list (dxf_write.rs:219-261): a DXF
 *    from another program loses them on its first save. An older version holds less (no
 *    MULTILEADER before 2007, dxf_write.rs:845). CADCraft 0.5.0 wrote only R2000 and kept only
 *    what it models.
 *  - New drawings are 'Drawing<N>', counting from 1 in each session, and Drawing1 is open from the
 *    start (engine/src/lib.rs:599-644); Help > Open Sample Drawing opens 'Bracket'
 *    (ui-egui/src/menus.rs:172-178). They save as 'Drawing<N>.dxf' and 'Bracket.dxf'. CADCraft
 *    writes no document identity into a DXF.
 *  - Exports (saveas with a .svg, .png or .pdf path, typed with JSON parameters) have their own
 *    names (io/src/lib.rs:109-126), and so has TABLEEXPORT (a CSV). Print, Export, Publish and
 *    Export to PDF download nothing on the web.
 *
 * Rule: a download under the opened file's name, ending in '.dxf', is the document ('document',
 * it may replace the opened file) only if the name is not one CADCraft gives drawings it makes
 * itself, no other file with that save name has entered the app in this frame, the download is a
 * DXF in CADCraft's layout, and the opened file is one that the CADCraft that wrote the download
 * writes again without losing anything: a DXF as the same or an older release the adapter knows
 * writes it, in the same or an older DXF version. If the opened file is any other DXF, such a
 * save is a 'copy': the opened file stays as it is, the first save becomes a new file next to it
 * and the later ones replace that file. Everything else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // What each CADCraft release the adapter knows writes, oldest first. A DXF that fits a release's
  // lists is one that release writes again without losing anything, and so does every later
  // release (each reads what the earlier ones wrote; checked when it was added). A DXF in
  // CADCraft's layout with anything else (written by a newer CADCraft, edited by another tool, or
  // with another program's data that CADCraft keeps) could lose it on save, so it fits none. The
  // lists: the DXF versions ($ACADVER) and code pages the release writes, the object types
  // (group 0), the header variables (group 9 in HEADER), the xdata applications (group 1001) and
  // the keys of the named object dictionary. Add each new release: the canary fails when a file
  // that the release saved does not save in place when it is opened again.
  const words = (text) => new Set(text.trim().split(/\s+/));
  const TYPES_0_5 = `SECTION ENDSEC TABLE ENDTAB BLOCK ENDBLK EOF CLASS APPID DIMSTYLE LAYER LTYPE STYLE
    UCS VIEW VPORT BLOCK_RECORD 3DFACE ACAD_TABLE ARC ATTDEF ATTRIB CIRCLE DIMENSION ELLIPSE HATCH
    IMAGE INSERT LEADER LINE LWPOLYLINE MTEXT POINT POLYLINE SEQEND SPLINE TEXT VERTEX VIEWPORT
    WIPEOUT RAY XLINE SOLID TRACE DICTIONARY DIMASSOC GROUP LAYOUT MLEADERSTYLE TABLESTYLE XRECORD
    IMAGEDEF IMAGEDEF_REACTOR RASTERVARIABLES`;
  const VARS_BOTH = `$ACADVER $DWGCODEPAGE $EXTMIN $EXTMAX $INSBASE $LIMMIN $LIMMAX $ORTHOMODE
    $FILLMODE $MIRRTEXT $LTSCALE $ATTMODE $TEXTSIZE $TRACEWID $TEXTSTYLE $CLAYER $CELTYPE $CECOLOR
    $CELTSCALE $DIMSCALE $DIMSTYLE $LUNITS $LUPREC $AUNITS $AUPREC $ELEVATION $THICKNESS $FILLETRAD
    $CHAMFERA $CHAMFERB $ANGBASE $ANGDIR $PDMODE $PDSIZE $PLINEWID $CELWEIGHT $LWDISPLAY $INSUNITS
    $MEASUREMENT $PSLTSCALE $HANDSEED`;
  const APPS = words('ACAD CADCRAFT AcadAnnotative AcCmTransparency AcAecLayerStandard');
  const KEYS_0_5 = `ACAD_GROUP ACAD_IMAGE_DICT ACAD_IMAGE_VARS ACAD_LAYOUT ACAD_MLEADERSTYLE
    ACAD_TABLESTYLE CADCRAFT_CONSTRAINTS CADCRAFT_LAYERSTATES`;
  const VERSIONS_0_6 = 'AC1015 AC1018 AC1021 AC1024 AC1027 AC1032';
  const CODE_PAGE_0_6 = (cp) => /^[\x21-\x7e]{1,32}$/.test(cp);
  const TYPES_0_6 = `${TYPES_0_5} MLINE HELIX MULTILEADER TOLERANCE MLINESTYLE ACDBDICTIONARYWDFLT
    ACDBPLACEHOLDER SCALE`;
  const VARS_0_6 = `${VARS_BOTH} $SNAPUNIT $GRIDUNIT $CMLSTYLE $CMLJUST $CMLSCALE`;
  const KEYS_0_6 = `${KEYS_0_5} ACAD_MLINESTYLE ACAD_PLOTSTYLENAME ACAD_SCALELIST CADCRAFT_HANDSEED
    CADCRAFT_MLEADERSTYLE CADCRAFT_PLOTSTYLES CADCRAFT_ANNOTATION`;
  const RELEASES = [
    // 0.5.0: R2000 only (v0.5.0 io/src/dxf_write.rs and dxf_image.rs, header 185-222 and
    // 1329-1352, dictionary 1731-1753).
    {
      versions: words('AC1015'),
      codePage: (cp) => cp === 'ANSI_1252',
      types: words(TYPES_0_5),
      vars: words(`${VARS_BOTH} $CMLEADERSTYLE`),
      apps: APPS,
      keys: words(KEYS_0_5),
    },
    // 0.6.2: R2000 to R2018 (io/src/lib.rs:82-103), before 2007 in the code page of the file it
    // read, else ANSI_1252 (dxf_write.rs:1035-1039); new entities and objects (dxf_write.rs,
    // dxf_mline.rs), header variables (dxf_write.rs:219-261, 1648-1666) and dictionary keys
    // (dxf_write.rs:2066-2096, dxf_ext.rs:22-37). It always writes CADCRAFT_HANDSEED.
    {
      versions: words(VERSIONS_0_6),
      codePage: CODE_PAGE_0_6,
      types: words(TYPES_0_6),
      vars: words(VARS_0_6),
      apps: APPS,
      keys: words(KEYS_0_6),
    },
    // 0.10.0 (0.7.0 and 0.8.0 write what 0.6.2 writes): the current dimension style's variables
    // in the header, after $DIMSTYLE: the style's DIMVARS but $DIMSCALE (a header variable of its
    // own) and the three linetypes, each that the style has a value for (v0.10.0
    // io/src/dxf_write.rs:297-339 and 381, doc/src/tables.rs:279-347; upstream #1051). Otherwise
    // the 0.6.2 lists.
    {
      versions: words(VERSIONS_0_6),
      codePage: CODE_PAGE_0_6,
      types: words(TYPES_0_6),
      vars: words(`${VARS_0_6} $DIMASZ $DIMEXO $DIMEXE $DIMTXT $DIMGAP $DIMDEC $DIMADEC $DIMLFAC
        $DIMTAD $DIMTIH $DIMTOH $DIMBLK $DIMBLK1 $DIMBLK2 $DIMTSZ $DIMCLRD $DIMCLRE $DIMCLRT
        $DIMTXSTY $DIMPOST $DIMCEN $DIMZIN $DIMLUNIT $DIMTOL $DIMTP $DIMTM $DIMDLI $DIMDLE $DIMJUST
        $DIMRND $DIMDSEP $DIMFRAC $DIMLIM $DIMTDEC $DIMTFAC $DIMTZIN $DIMALT $DIMALTF $DIMALTD
        $DIMAPOST $DIMALTRND $DIMALTU $DIMALTZ $DIMAUNIT $DIMSE1 $DIMSE2 $DIMSD1 $DIMSD2 $DIMATFIT
        $DIMTIX $DIMSOXD $DIMTOFL $DIMTMOVE $DIMTVP $DIMTOLJ $DIMAZIN $DIMARCSYM $DIMLDRBLK $DIMLWD
        $DIMLWE $DIMFXLON $DIMFXL $DIMJOGANG`),
      apps: APPS,
      keys: words(KEYS_0_6),
    },
  ];
  const LISTS = ['types', 'vars', 'apps', 'keys'];
  const anyRelease = (list, value) => RELEASES.some((r) => r[list].has(value));
  // How every DXF CADCraft writes starts: $ACADVER, then $DWGCODEPAGE (dxf_write.rs:1648-1652),
  // CRLF line ends (crates/dxf/src/lib.rs:411-426).
  const START = /^ {2}0\r\nSECTION\r\n {2}2\r\nHEADER\r\n {2}9\r\n\$ACADVER\r\n {2}1\r\n(AC\d{4})\r\n {2}9\r\n\$DWGCODEPAGE\r\n {2}3\r\n([^\r\n]*)\r\n/;
  const APPID = '\r\n100\r\nAcDbRegAppTableRecord\r\n  2\r\nCADCRAFT\r\n';

  // The version and, by the values the DXF holds, the oldest release that writes all of them
  // ('fits') and the oldest that writes all of them that some release writes ('writer').
  const summary = ([, version, codePage], seen) => {
    const oldest = (holds) => RELEASES.findIndex((r) => r.versions.has(version) && r.codePage(codePage) &&
      LISTS.every((list) => [...seen[list]].every((value) => holds(r, list, value))));
    return {
      version,
      fits: oldest((r, list, value) => r[list].has(value)),
      writer: oldest((r, list, value) => r[list].has(value) || !anyRelease(list, value)),
    };
  };
  // A DXF in CADCraft's layout (its start and APPID record, CRLF, '0 EOF' as the last pair) as
  // {version ($ACADVER), fits, writer}, else null. fits: the oldest release (index in RELEASES)
  // that writes the file again without losing anything, -1 for none. writer: the oldest release
  // that writes every value in it that some release writes, -1 for none; for a save, the
  // CADCraft that runs (what it keeps of other programs' data is in no list).
  const readCadcraftDxf = (bytes) => {
    // The start first, so that a large DXF of another program is not decoded as a whole.
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200)).match(START);
    if (!head) return null;
    const text = new TextDecoder('latin1').decode(bytes);
    if (!text.includes(APPID)) return null;
    const seen = { types: new Set(), vars: new Set(), apps: new Set(), keys: new Set() };
    let section = null; // the section the pairs are in, from the '2' after '0 SECTION'
    let objects = 0; // in OBJECTS: 1 before the named object dictionary, 2 in it, 3 after it
    let previous = '';
    for (let at = 0; at < text.length;) {
      const a = text.indexOf('\r\n', at);
      const b = a < 0 ? -1 : text.indexOf('\r\n', a + 2);
      if (b < 0) return null;
      const code = text.slice(at, a).trim();
      const value = text.slice(a + 2, b);
      at = b + 2;
      if (code === '0') {
        seen.types.add(value);
        if (value === 'EOF') return at === text.length ? summary(head, seen) : null;
        if (objects === 2) objects = 3;
        if (objects === 1 && value === 'DICTIONARY') objects = 2;
      } else if (code === '2' && previous === 'SECTION') {
        section = value;
        if (section === 'OBJECTS') objects = 1;
      } else if (code === '9' && section === 'HEADER') {
        seen.vars.add(value);
      } else if (code === '1001') {
        seen.apps.add(value);
      } else if (code === '3' && objects === 2) {
        seen.keys.add(value);
      }
      previous = code === '0' ? value : '';
    }
    return null; // no '0 EOF'
  };
  // Kept per byte array: the core asks identity() and classify() about the same bytes.
  const checked = new WeakMap();
  const cadcraftDxf = (bytes) => {
    if (!checked.has(bytes)) checked.set(bytes, readCadcraftDxf(bytes));
    return checked.get(bytes);
  };
  const MARK = 'cadcraft-dxf';
  // readCadcraftDxf() of every DXF in CADCraft's layout that the core asked identity() about (the
  // opened file and every save under its name), by SHA-256: the core keeps that hash with the
  // opened file and with every save of it that the host stored, so classify() finds what the
  // file it would replace holds.
  const found = new Map();
  const hex = (digest) => Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');

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
  // '.dxf' if it has no extension (ui-egui/src/lib.rs:130-136, as Rust's Path::extension). Rust's
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

  // The interface language: CADCraft follows navigator.languages (the first tag whose primary
  // subtag it has) while its stored preference ('cadcraft.prefs', interfaceLanguage) is Auto,
  // which it also is until the user picks a language in Edit > Interface Language; a stored
  // choice wins (apps/cadcraft-web/src/main.rs:115-122, crates/ui-egui/src/i18n/mod.rs:98-110,
  // :154-158). Chinese is left out: the web build has no font for it and shows English instead
  // (ui-egui/src/lib.rs:256-259, theme.rs:387-394), also when it is the stored choice.
  const LANGUAGES = { en: 'en', cs: 'cs', de: 'de', es: 'es', fr: 'fr', 'pt-BR': 'pt-BR', ru: 'ru', uk: 'uk' };
  const CHOICES = new Set([...Object.values(LANGUAGES), 'zh']);

  window.craftsuiteLayer.register({
    app: 'cadcraft',
    language(tag, util) {
      const key = util.matchLanguage(tag, LANGUAGES);
      if (!key) return null;
      util.preferLanguages(LANGUAGES[key]);
      try {
        const stored = JSON.parse(localStorage.getItem('cadcraft.prefs') || '{}').interfaceLanguage;
        if (CHOICES.has(stored)) return stored === LANGUAGES[key] ? key : null;
      } catch { /* unreadable: CADCraft takes it as Auto */ }
      return key;
    },
    // CADCraft can take files as soon as its drop listener exists; this only starts listening.
    started() {
      window.addEventListener('drop', (event) => note(event.dataTransfer && event.dataTransfer.files), true);
      document.addEventListener('change', (event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'file') note(event.target.files);
      }, true);
      return Promise.resolve();
    },
    // Not an identity (CADCraft writes none): one mark for every DXF in CADCraft's layout, whichever
    // release wrote it and whatever it holds, so that the core leaves the decision to classify().
    // What the bytes hold is kept by their hash.
    async identity(bytes) {
      const dxf = cadcraftDxf(bytes);
      if (!dxf) return null;
      found.set(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))), dxf);
      return MARK;
    },
    // 'document' may replace the opened file, 'copy' goes next to it; everything else becomes a
    // new file. Save rewrites the whole file, so there is no prefix to compare.
    // Known gap: another drawing that takes the opened name through a typed JSON command (saveas
    // with that path, or open with base64 data and that name).
    classify(save, entry) {
      if (save.name !== entry.name || !/\.dxf$/i.test(save.name)) return 'export';
      if (MADE_BY_APP.test(save.name)) return 'export'; // could be the new drawing or the sample
      if ((entered.get(entry.name) || 0) > 1) return 'export'; // another drawing has the name too
      const written = cadcraftDxf(save.bytes);
      if (!written) return 'export'; // not what Save writes
      // The file the save would replace: as the CADCraft that runs or an older one writes it, in
      // the same or an older DXF version ('AC1015' < 'AC1032'). Anything else, also a file of a
      // newer CADCraft that an older one saves, could lose data.
      const opened = entry.identity === MARK && entry.hash ? found.get(hex(entry.hash)) : null;
      return opened && opened.fits >= 0 && opened.fits <= written.writer && opened.version <= written.version ? 'document' : 'copy';
    },
  });
})();
