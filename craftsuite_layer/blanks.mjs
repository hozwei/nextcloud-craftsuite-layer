// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-FileCopyrightText: 2026 ArtCraft Team and the VectorCraft contributors
// SPDX-FileCopyrightText: 2026 ArtCraft Team and the DesignCraft contributors
// SPDX-FileCopyrightText: 2026 ArtCraft Team and the GridCraft contributors
// SPDX-FileCopyrightText: 2026 ArtCraft Team and the CADCraft contributors
// SPDX-FileCopyrightText: 2026 ArtCraft Team and the FilmCraft contributors
// SPDX-FileCopyrightText: 2026 ArtCraft Team and the EffectCraft contributors
// SPDX-FileCopyrightText: 2026 ArtCraft Team and the SoundCraft contributors
// SPDX-FileCopyrightText: 2026 ArtCraft Team and the FigCraft contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND (MIT OR Apache-2.0)
//
// What the apps write for a new document, taken from their own saves, is theirs (MIT OR
// Apache-2.0): VC_DOCUMENT and DC_DOCUMENT (VectorCraft, DesignCraft), GridCraft's styles part,
// CADCraft's DXF, FilmCraft's and EffectCraft's new project, SoundCraft's new session, FigCraft's new
// document. The rest is ours (AGPL-3.0-or-later).
// assets/LICENSE-MIT.txt carries the MIT notices in the app package.
//
// The blank documents of the Craft apps' "+ New" entries in Files (lib/Service/NewFiles.php), in
// assets/. Each is the smallest document its app opens from a drop and saves back into the same
// file, made as the app makes a new document, and checked against the tested version of the app
// (docs/nextcloud-app.md, New files). The files are committed; this script makes them again, the
// same bytes every time:
//
//   node blanks.mjs write   writes assets/
//   node blanks.mjs check   fails if assets/ differs from what this script makes, or if the
//                           stand-ins NewFiles::stamped() replaces are not there as it expects
//
// Paper: WordCraft, GridCraft and PdfCraft make US Letter pages; the app takes the A4 blank, and
// the -letter one for users in a region that uses Letter (NewFiles::LETTER).

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, 'assets');

const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const EP = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
// 1980-01-01 00:00 in local time: DOS time 0, what WordCraft's and GridCraft's zip writer stores,
// and the same in every time zone the script runs in.
const MTIME = new Date(1980, 0, 1);

// XML parts in the given order, deflated (level 9).
function zip(parts) {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) =>
    [name, [strToU8(X + text), { level: 9, mtime: MTIME }]]))));
}

const types = (overrides) => `<Types xmlns="${CT}">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('') + '</Types>';
const rels = (list) => `<Relationships xmlns="${PR}">`
  + list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('') + '</Relationships>';

// --- WordCraft (.docx) ---------------------------------------------------------------------------
// WordCraft 0.5.0's new document: one empty paragraph, 1" margins and 0.5" header and footer
// distance (doc/src/section.rs:304-317, doc/src/lib.rs:439-457), here on A4 or Letter. No styles
// part: WordCraft keeps its built-in styles only without one (docx/src/read/mod.rs:428-491).
// settings.xml with compatibility mode 15, or WordCraft lays it out as Word 2007 did. The
// translator takes a .docx for WordCraft's own by docProps/app.xml (translators/wordcraft.js), and
// WordCraft keeps the creation time it finds: the server writes the time the file is created
// (NewFiles::stamped()), so this one is only a stand-in.
const WORD_PAPER = { a4: [11906, 16838], letter: [12240, 15840] };
// The stand-in creation time of WordCraft's and DeckCraft's blank (W3CDTF), which the server
// replaces with the time a new file is made (NewFiles::stamped()).
export const CREATED_W3C = '2026-01-01T00:00:00Z';

function docx(paper) {
  const [w, h] = WORD_PAPER[paper];
  const main = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
  return zip({
    '[Content_Types].xml': types([
      ['/word/document.xml', `${main}document.main+xml`],
      ['/word/settings.xml', `${main}settings+xml`],
      ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
      ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
    ]),
    '_rels/.rels': rels([
      ['rId1', `${R}/officeDocument`, 'word/document.xml'],
      ['rId2', `${PR}/metadata/core-properties`, 'docProps/core.xml'],
      ['rId3', `${R}/extended-properties`, 'docProps/app.xml'],
    ]),
    'word/document.xml': `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p/>`
      + `<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`
      + '</w:body></w:document>',
    'word/_rels/document.xml.rels': rels([['rId1', `${R}/settings`, 'settings.xml']]),
    'word/settings.xml': `<w:settings xmlns:w="${W}"><w:compat>`
      + '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>'
      + '</w:compat></w:settings>',
    'docProps/core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
      + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${CREATED_W3C}</dcterms:created>`
      + `<dcterms:modified xsi:type="dcterms:W3CDTF">${CREATED_W3C}</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `<Properties xmlns="${EP}"><Application>WordCraft</Application></Properties>`,
  });
}

// --- GridCraft (.xlsx) ---------------------------------------------------------------------------
// GridCraft 0.5.0's new workbook: one sheet, its own styles part verbatim (without one it warns
// "no styles part", xlsx/src/read.rs:111-123); Letter has no paperSize (xlsx/src/sheet_write.rs:
// 420-426), A4 is paperSize 9. The translator takes the workbook for GridCraft's own by the exact
// <Application>GridCraft</Application> and by its parts (translators/gridcraft.js); an unchanged
// save of the Letter blank is byte for byte GridCraft's own new workbook.
function xlsx(paper) {
  const sml = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const pageSetup = paper === 'a4' ? '<pageSetup paperSize="9" orientation="portrait"/>' : '';
  return zip({
    '[Content_Types].xml': types([
      ['/xl/workbook.xml', `${sml}sheet.main+xml`],
      ['/xl/worksheets/sheet1.xml', `${sml}worksheet+xml`],
      ['/xl/styles.xml', `${sml}styles+xml`],
      ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
    ]),
    '_rels/.rels': rels([
      ['rId1', `${R}/officeDocument`, 'xl/workbook.xml'],
      ['rId3', `${R}/extended-properties`, 'docProps/app.xml'],
    ]),
    'docProps/app.xml': `<Properties xmlns="${EP}"><Application>GridCraft</Application></Properties>`,
    'xl/workbook.xml': `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([
      ['rId1', `${R}/worksheet`, 'worksheets/sheet1.xml'],
      ['rId2', `${R}/styles`, 'styles.xml'],
    ]),
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${S}" xmlns:r="${R}"><sheetData/>${pageSetup}</worksheet>`,
    'xl/styles.xml': `<styleSheet xmlns="${S}"><fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts>`
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"><bgColor indexed="64"/></patternFill></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"></dxfs>'
      + '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>',
  });
}

// --- PdfCraft (.pdf) -----------------------------------------------------------------------------
// One empty page, as PdfCraft 0.6.0's Create > Blank page builds it (create/src/lib.rs:25-71):
// catalog, page tree, a page with MediaBox and empty Resources. A classic cross-reference table
// with exact offsets: a file PdfCraft has to rebuild is rewritten as a whole on Save
// (cos/src/writer.rs:173-186), which is then a new file, not an incremental update of this one.
// No /ID: PdfCraft adds one with the first save.
const PDF_PAPER = { a4: '595.28 841.89', letter: '612 792' };

function pdf(paper) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAPER[paper]}] /Resources << >> >>`,
  ];
  let out = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets = objs.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// --- PhotoCraft (.psd) ---------------------------------------------------------------------------
// What PhotoCraft 0.7.0's File > New makes with its defaults (1920x1080 px, 72 ppi, RGB, 8 bit,
// white; crates/ui-egui/src/state.rs:1170-1172), as a flat PSD (version 1, 3 channels, no layer
// records): the merged image RLE-compressed (PackBits) as PhotoCraft writes it, the resolution in
// image resource 1005, no ICC profile (PhotoCraft does not ask for one). PhotoCraft opens the merged
// image of a flat file as a locked "Background" layer, as its own new document has
// (crates/io/src/psd_import.rs:701-745); its first save of it is byte for byte its own Untitled-1.psd.
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

// A row of n equal bytes in PackBits: runs of at most 128 (header 257 - k).
function packbitsRun(value, n) {
  const out = [];
  for (let left = n; left > 0; left -= 128) {
    const k = Math.min(left, 128);
    out.push(k === 1 ? 0 : 257 - k, value);
  }
  return Buffer.from(out);
}

function psd({ width = 1920, height = 1080, ppi = 72, value = 0xff } = {}) {
  const header = Buffer.concat([Buffer.from('8BPS', 'latin1'), u16(1), Buffer.alloc(6), u16(3), u32(height), u32(width), u16(8), u16(3)]);
  const fixed = u32(Math.round(ppi * 65536));
  const resolution = Buffer.concat([fixed, u16(1), u16(1), fixed, u16(1), u16(1)]); // pixels/inch, shown in inches
  const resource = Buffer.concat([Buffer.from('8BIM', 'latin1'), u16(1005), u16(0), u32(resolution.length), resolution]);
  const row = packbitsRun(value, width);
  const rows = 3 * height; // R, G and B, each top to bottom
  const counts = Buffer.alloc(2 * rows);
  for (let i = 0; i < rows; i++) counts.writeUInt16BE(row.length, 2 * i);
  // header, color mode data (none), image resources, layer and mask information (none), merged image
  return Buffer.concat([header, u32(0), u32(resource.length), resource, u32(0), u16(1), counts, Buffer.concat(new Array(rows).fill(row))]);
}

// The creation time the server replaces with the time a new file is made (NewFiles::stamped()),
// in seconds: 2026-01-01T00:00:00Z. VectorCraft and DesignCraft keep a document's creation time,
// and their adapters tell the document by it from a new one of the same name (an Untitled-N).
export const CREATED_SECONDS = 1767225600;

// --- VectorCraft (.vectorcraft) ------------------------------------------------------------------
// The document VectorCraft 0.9.0's File > New writes with the dialog's defaults (Print > Letter: one
// 612x792 pt artboard, CMYK, raster effects 300 ppi, its default CMYK swatches and graphic styles;
// crates/engine/src/cmd/newdoc.rs:430-442), captured from the app's own save, as plain JSON in
// format version 3 (what its Save As writes), with an empty title (the app then takes the file
// name; never Untitled-N) and without the saved view. "format" first: VectorCraft and the adapter
// look for it in the first 256 bytes.
const VC_DOCUMENT = {"version":1,"units":"Points","color_mode":"Cmyk","artboards":[{"id":1,"name":"Artboard 1","rect":{"x0":0,"y0":0,"x1":612,"y1":792},"show_center_mark":false,"show_cross_hairs":false}],"layers":[{"id":1,"name":"Layer 1","kind":{"type":"layer","color":{"Preset":0},"template":false,"printable":true,"children":[]}}],"swatches":[{"name":"[None]","paint":{"type":"none"},"global":false,"spot":false},{"name":"White","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0,"y":0,"k":0}},"global":false,"spot":false},{"name":"Black","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0,"y":0,"k":1}},"global":false,"spot":false},{"name":"Red","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.88,"y":0.85,"k":0.07}},"global":false,"spot":false},{"name":"Orange Red","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.63,"y":0.85,"k":0.05}},"global":false,"spot":false},{"name":"Orange","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.4,"y":0.88,"k":0.03}},"global":false,"spot":false},{"name":"Amber","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.3,"y":0.76,"k":0.02}},"global":false,"spot":false},{"name":"Yellow","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.06,"y":0.87,"k":0.01}},"global":false,"spot":false},{"name":"Yellow Green","paint":{"type":"solid","color":{"model":"cmyk","c":0.03,"m":0,"y":0.85,"k":0.12}},"global":false,"spot":false},{"name":"Lime","paint":{"type":"solid","color":{"model":"cmyk","c":0.29,"m":0,"y":0.68,"k":0.22}},"global":false,"spot":false},{"name":"Green","paint":{"type":"solid","color":{"model":"cmyk","c":0.69,"m":0,"y":0.59,"k":0.29}},"global":false,"spot":false},{"name":"Emerald","paint":{"type":"solid","color":{"model":"cmyk","c":1,"m":0,"y":0.53,"k":0.43}},"global":false,"spot":false},{"name":"Teal","paint":{"type":"solid","color":{"model":"cmyk","c":1,"m":0,"y":0.47,"k":0.59}},"global":false,"spot":false},{"name":"Aqua","paint":{"type":"solid","color":{"model":"cmyk","c":0.81,"m":0,"y":0.36,"k":0.29}},"global":false,"spot":false},{"name":"Cyan Green","paint":{"type":"solid","color":{"model":"cmyk","c":1,"m":0,"y":0.07,"k":0.34}},"global":false,"spot":false},{"name":"Cyan","paint":{"type":"solid","color":{"model":"cmyk","c":0.82,"m":0.24,"y":0,"k":0.11}},"global":false,"spot":false},{"name":"Azure","paint":{"type":"solid","color":{"model":"cmyk","c":1,"m":0.4,"y":0,"k":0.26}},"global":false,"spot":false},{"name":"Blue","paint":{"type":"solid","color":{"model":"cmyk","c":0.68,"m":0.66,"y":0,"k":0.43}},"global":false,"spot":false},{"name":"Indigo","paint":{"type":"solid","color":{"model":"cmyk","c":0.73,"m":0.8,"y":0,"k":0.61}},"global":false,"spot":false},{"name":"Violet","paint":{"type":"solid","color":{"model":"cmyk","c":0.3,"m":0.69,"y":0,"k":0.43}},"global":false,"spot":false},{"name":"Purple","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.73,"y":0.03,"k":0.42}},"global":false,"spot":false},{"name":"Magenta","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":1,"y":0.41,"k":0.38}},"global":false,"spot":false},{"name":"Rose","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.91,"y":0.58,"k":0.17}},"global":false,"spot":false},{"name":"Pink","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.87,"y":0.49,"k":0.07}},"global":false,"spot":false},{"name":"Brown","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.11,"y":0.23,"k":0.22}},"global":false,"spot":false},{"name":"Tan","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.12,"y":0.24,"k":0.4}},"global":false,"spot":false},{"name":"Coffee","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.14,"y":0.24,"k":0.55}},"global":false,"spot":false},{"name":"Chocolate","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.14,"y":0.22,"k":0.67}},"global":false,"spot":false},{"name":"Sand","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.21,"y":0.45,"k":0.22}},"global":false,"spot":false},{"name":"Copper","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.25,"y":0.51,"k":0.35}},"global":false,"spot":false},{"name":"Rust","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.3,"y":0.59,"k":0.45}},"global":false,"spot":false},{"name":"Walnut","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.35,"y":0.69,"k":0.54}},"global":false,"spot":false},{"name":"Espresso","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.42,"y":0.8,"k":0.62}},"global":false,"spot":false},{"name":"White, Black","paint":{"type":"gradient","gradient":{"kind":"Linear","stops":[{"offset":0,"color":{"model":"cmyk","c":0,"m":0,"y":0,"k":0},"opacity":1,"midpoint":0.5},{"offset":1,"color":{"model":"cmyk","c":0,"m":0,"y":0,"k":1},"opacity":1,"midpoint":0.5}]},"angle":0},"global":false,"spot":false},{"name":"Radial White, Black","paint":{"type":"gradient","gradient":{"kind":"Radial","stops":[{"offset":0,"color":{"model":"cmyk","c":0,"m":0,"y":0,"k":0},"opacity":1,"midpoint":0.5},{"offset":1,"color":{"model":"cmyk","c":0,"m":0,"y":0,"k":1},"opacity":1,"midpoint":0.5}]},"angle":0},"global":false,"spot":false},{"name":"Sunset","paint":{"type":"gradient","gradient":{"kind":"Linear","stops":[{"offset":0,"color":{"model":"cmyk","c":0,"m":0.3,"y":0.76,"k":0.02},"opacity":1,"midpoint":0.5},{"offset":1,"color":{"model":"cmyk","c":0,"m":0.91,"y":0.58,"k":0.17},"opacity":1,"midpoint":0.5}]},"angle":0},"global":false,"spot":false},{"name":"Ocean","paint":{"type":"gradient","gradient":{"kind":"Linear","stops":[{"offset":0,"color":{"model":"cmyk","c":0.82,"m":0.24,"y":0,"k":0.11},"opacity":1,"midpoint":0.5},{"offset":1,"color":{"model":"cmyk","c":0.68,"m":0.66,"y":0,"k":0.43},"opacity":1,"midpoint":0.5}]},"angle":0},"global":false,"spot":false}],"swatch_groups":[{"name":"Grays","swatches":[{"name":"K=90","paint":{"type":"solid","color":{"model":"gray","k":0.9}},"global":false,"spot":false},{"name":"K=80","paint":{"type":"solid","color":{"model":"gray","k":0.8}},"global":false,"spot":false},{"name":"K=70","paint":{"type":"solid","color":{"model":"gray","k":0.7}},"global":false,"spot":false},{"name":"K=60","paint":{"type":"solid","color":{"model":"gray","k":0.6}},"global":false,"spot":false},{"name":"K=50","paint":{"type":"solid","color":{"model":"gray","k":0.5}},"global":false,"spot":false},{"name":"K=40","paint":{"type":"solid","color":{"model":"gray","k":0.4}},"global":false,"spot":false},{"name":"K=30","paint":{"type":"solid","color":{"model":"gray","k":0.3}},"global":false,"spot":false},{"name":"K=20","paint":{"type":"solid","color":{"model":"gray","k":0.2}},"global":false,"spot":false},{"name":"K=10","paint":{"type":"solid","color":{"model":"gray","k":0.1}},"global":false,"spot":false}]},{"name":"Brights","swatches":[{"name":"Bright Red","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.89,"y":0.85,"k":0}},"global":false,"spot":false},{"name":"Bright Yellow","paint":{"type":"solid","color":{"model":"cmyk","c":0,"m":0.1,"y":1,"k":0}},"global":false,"spot":false},{"name":"Bright Green","paint":{"type":"solid","color":{"model":"cmyk","c":1,"m":0,"y":0.49,"k":0.1}},"global":false,"spot":false},{"name":"Bright Blue","paint":{"type":"solid","color":{"model":"cmyk","c":0.84,"m":0.53,"y":0,"k":0}},"global":false,"spot":false},{"name":"Bright Violet","paint":{"type":"solid","color":{"model":"cmyk","c":0.14,"m":1,"y":0,"k":0.02}},"global":false,"spot":false}]}],"graphic_styles":[{"name":"Default Graphic Style","appearance":{"items":[{"kind":"fill","paint":{"type":"solid","color":{"model":"rgb","r":1,"g":1,"b":1}}},{"kind":"stroke","paint":{"type":"solid","color":{"model":"rgb","r":0,"g":0,"b":0}},"width":1}]},"id":1,"unit_box":true},{"name":"Black Outline","appearance":{"items":[{"kind":"fill","paint":{"type":"none"}},{"kind":"stroke","paint":{"type":"solid","color":{"model":"rgb","r":0,"g":0,"b":0}},"width":1}]},"id":2,"unit_box":true},{"name":"Heavy Ink","appearance":{"items":[{"kind":"fill","paint":{"type":"solid","color":{"model":"rgb","r":0.105882354,"g":0.078431375,"b":0.39215687}}},{"kind":"stroke","paint":{"type":"solid","color":{"model":"rgb","r":0,"g":0,"b":0}},"width":4}]},"id":3,"unit_box":true},{"name":"Sunshine","appearance":{"items":[{"kind":"fill","paint":{"type":"solid","color":{"model":"rgb","r":0.9843137,"g":0.6901961,"b":0.23137255}}},{"kind":"stroke","paint":{"type":"solid","color":{"model":"rgb","r":0.94509804,"g":0.3529412,"b":0.14117648}},"width":2}]},"id":4,"unit_box":true}],"symbols":[],"guides":[],"grid":{"spacing":72,"subdivisions":8},"raster_effects_ppi":300,"next_id":2};

function vectorcraft() {
  const document = { version: 1, title: '', ...VC_DOCUMENT, metadata: { created: CREATED_SECONDS } };
  return Buffer.from(JSON.stringify({ format: 'vectorcraft', version: 3, generator: 'craftsuite-layer', document }), 'utf8');
}

// --- DesignCraft (.designcraft) ------------------------------------------------------------------
// The document DesignCraft 0.6.0's File > New Document writes with the dialog's defaults (Letter,
// 1 page, facing pages, 1 column, gutter 1p0, margins 3p0; crates/ui-egui/src/dialogs.rs:24-27,
// crates/doc/src/build.rs:69-88), captured from the app's own save, minus title, view and dates,
// as a package with every entry stored: mimetype first (DesignCraft and the adapter tell the package
// by it), meta.json and document.json, dated 1980-01-01 00:00 like DesignCraft's own.
const DC_DOCUMENT = {"settings":{"intent":"print","pageWidth":612,"pageHeight":792,"facingPages":true,"primaryTextFrame":false,"bleed":[0,0,0,0],"slug":[0,0,0,0],"horizontalUnits":"picas","verticalUnits":"picas","baselineGrid":{"start":36,"increment":12,"relativeTo":"topOfPage","color":[140,205,230],"viewThreshold":0.75},"grid":{"horizontal":72,"vertical":72,"subdivisions":8,"color":[200,200,200],"inBack":true},"pasteboard":[72,72],"marginColor":[255,56,255],"columnColor":[166,40,255],"bleedColor":[255,72,103],"slugColor":[100,188,221],"keyboardIncrement":1,"chapterNumber":1,"globalLight":120,"advancedType":{"superscriptSize":58.3,"superscriptPosition":33.3,"subscriptSize":58.3,"subscriptPosition":33.3},"blendSpace":"cmyk","overprintBlack":true,"trackChanges":false,"glyphFallback":false},"spreads":[{"id":7,"pages":[{"id":5,"width":612,"height":792,"x":0,"margins":{"top":36,"bottom":36,"inside":36,"outside":36},"columns":{"count":1,"gutter":12},"parent":4,"side":"right","showParentItems":true}],"items":[],"allowShuffle":true}],"parents":[{"id":4,"pages":[{"id":2,"width":612,"height":792,"x":0,"margins":{"top":36,"bottom":36,"inside":36,"outside":36},"columns":{"count":1,"gutter":12},"side":"left","showParentItems":true},{"id":3,"width":612,"height":792,"x":612,"margins":{"top":36,"bottom":36,"inside":36,"outside":36},"columns":{"count":1,"gutter":12},"side":"right","showParentItems":true}],"items":[],"parent":{"prefix":"A","name":"Parent"},"allowShuffle":true}],"layers":[{"id":1,"name":"Layer 1","color":[43,155,255],"visible":true,"locked":false,"printable":true,"showGuides":true,"suppressWrapWhenHidden":false}],"stories":{},"styles":{"paragraph":[{"name":"[No Paragraph Style]","para":{},"chars":{}},{"name":"[Basic Paragraph]","nextStyle":"[Basic Paragraph]","para":{},"chars":{}}],"character":[{"name":"[None]","chars":{}}],"object":[{"name":"[None]"},{"name":"[Basic Graphics Frame]","stroke":{"swatch":"[Black]","tint":1,"weight":1,"type":{"kind":"solid"},"align":"center","cap":"butt","join":"miter","miterLimit":4,"start":"none","end":"none","gapSwatch":"[None]","gapTint":1,"overprint":false}},{"name":"[Basic Text Frame]","fill":{"swatch":"[None]","tint":1,"overprint":false},"stroke":{"swatch":"[None]","tint":1,"weight":1,"type":{"kind":"solid"},"align":"center","cap":"butt","join":"miter","miterLimit":4,"start":"none","end":"none","gapSwatch":"[None]","gapTint":1,"overprint":false},"paragraphStyle":"[Basic Paragraph]"}],"cell":[{"name":"[None]"}],"table":[{"name":"[Basic Table]"}],"defaultParagraph":"[Basic Paragraph]","defaultCharacter":"[None]","defaultTextFrame":"[Basic Text Frame]","defaultGraphicFrame":"[Basic Graphics Frame]"},"swatches":[{"name":"[None]","value":{"kind":"none"},"locked":true,"named":true},{"name":"[Registration]","value":{"kind":"registration"},"locked":true,"named":true},{"name":"[Paper]","value":{"kind":"paper","color":{"model":"rgb","r":1,"g":1,"b":1}},"locked":true,"named":true},{"name":"[Black]","value":{"kind":"color","color":{"model":"cmyk","c":0,"m":0,"y":0,"k":1},"color_type":"process"},"locked":true,"named":true},{"name":"C=100 M=0 Y=0 K=0","value":{"kind":"color","color":{"model":"cmyk","c":1,"m":0,"y":0,"k":0},"color_type":"process"},"locked":false,"named":false},{"name":"C=0 M=100 Y=0 K=0","value":{"kind":"color","color":{"model":"cmyk","c":0,"m":1,"y":0,"k":0},"color_type":"process"},"locked":false,"named":false},{"name":"C=0 M=0 Y=100 K=0","value":{"kind":"color","color":{"model":"cmyk","c":0,"m":0,"y":1,"k":0},"color_type":"process"},"locked":false,"named":false},{"name":"C=0 M=100 Y=100 K=0","value":{"kind":"color","color":{"model":"cmyk","c":0,"m":1,"y":1,"k":0},"color_type":"process"},"locked":false,"named":false},{"name":"C=100 M=0 Y=100 K=0","value":{"kind":"color","color":{"model":"cmyk","c":1,"m":0,"y":1,"k":0},"color_type":"process"},"locked":false,"named":false},{"name":"C=100 M=100 Y=0 K=0","value":{"kind":"color","color":{"model":"cmyk","c":1,"m":1,"y":0,"k":0},"color_type":"process"},"locked":false,"named":false},{"name":"C=15 M=100 Y=100 K=0","value":{"kind":"color","color":{"model":"cmyk","c":0.15,"m":1,"y":1,"k":0},"color_type":"process"},"locked":false,"named":false},{"name":"C=75 M=5 Y=100 K=0","value":{"kind":"color","color":{"model":"cmyk","c":0.75,"m":0.05,"y":1,"k":0},"color_type":"process"},"locked":false,"named":false},{"name":"C=100 M=90 Y=10 K=0","value":{"kind":"color","color":{"model":"cmyk","c":1,"m":0.9,"y":0.1,"k":0},"color_type":"process"},"locked":false,"named":false}],"endnoteOptions":{"style":"arabic","startAt":1,"prefix":"","suffix":"","heading":"Endnotes","headingStyle":"[Basic Paragraph]","paraStyle":"[Basic Paragraph]","separator":"\t"},"sections":[{"start":0,"startNumber":1,"style":"arabic","includePrefix":false}],"assets":{},"textVariables":[{"name":"Chapter Number","type":"chapterNumber"},{"name":"Creation Date","type":"creationDate","format":"MM/dd/yy"},{"name":"File Name","type":"fileName","extension":false},{"name":"Last Page Number","type":"lastPageNumber","section":false},{"name":"Modification Date","type":"modificationDate","format":"MMMM d, yyyy h:mm aa"},{"name":"Output Date","type":"outputDate","format":"MM/dd/yy"},{"name":"Running Header","type":"runningHeader","style":"[Basic Paragraph]","use":"firstOnPage","character":false}],"footnoteOptions":{"style":"arabic","startAt":1,"restart":"never","prefix":"","suffix":"","affixIn":"none","refPosition":"superscript","refCharStyle":"[None]","paraStyle":"[Basic Paragraph]","separator":"\t","spaceBefore":0,"spaceBetween":0,"firstBaseline":"leading","firstBaselineMin":0,"spanColumns":false,"rule":{"on":true,"weight":1,"color":"[Black]","tint":1,"width":72,"offset":0,"leftIndent":0}},"xrefFormats":[{"name":"Full Paragraph & Page Number","definition":"\"<fullPara />\" on page <pageNum />"},{"name":"Full Paragraph","definition":"\"<fullPara />\""},{"name":"Paragraph Text & Page Number","definition":"\"<paraText />\" on page <pageNum />"},{"name":"Paragraph Text","definition":"\"<paraText />\""},{"name":"Paragraph Number & Page Number","definition":"<paraNum /> on page <pageNum />"},{"name":"Paragraph Number","definition":"<paraNum />"},{"name":"Text Anchor Name & Page Number","definition":"\"<txtAnchrName />\" on page <pageNum />"},{"name":"Text Anchor Name","definition":"\"<txtAnchrName />\""},{"name":"Page Number","definition":"page <pageNum />"},{"name":"Partial Paragraph & Page Number","definition":"\"<partialPara delim=\":\" includeDelim=\"false\" />\" on page <pageNum />"},{"name":"Partial Paragraph","definition":"\"<partialPara delim=\":\" includeDelim=\"false\" />\""}],"nextId":7};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// A zip of stored entries ([name, bytes], in order).
function zipStored(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name, 'utf8');
    const common = (b, at) => {
      b.writeUInt16LE(10, at); // version needed to extract: 1.0
      b.writeUInt16LE(0, at + 2); // flags
      b.writeUInt16LE(0, at + 4); // method: stored
      b.writeUInt16LE(0, at + 6); // time 00:00
      b.writeUInt16LE(0x21, at + 8); // date 1980-01-01
      b.writeUInt32LE(crc32(data), at + 10);
      b.writeUInt32LE(data.length, at + 14);
      b.writeUInt32LE(data.length, at + 18);
      b.writeUInt16LE(n.length, at + 22);
    };
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    common(local, 4);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // made by: MS-DOS, 2.0
    common(dir, 6);
    dir.writeUInt32LE(offset, 42);
    parts.push(local, n, data);
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function designcraft() {
  const document = { title: '', ...DC_DOCUMENT, created: CREATED_SECONDS, modified: 0 };
  return zipStored([
    ['mimetype', Buffer.from('application/vnd.designcraft+zip', 'latin1')],
    ['meta.json', Buffer.from(JSON.stringify({ format: 'designcraft', version: 1, generator: 'craftsuite-layer' }), 'utf8')],
    ['document.json', Buffer.from(JSON.stringify(document), 'utf8')],
  ]);
}

// --- DeckCraft (.deckcraft) ----------------------------------------------------------------------
// DeckCraft 0.5.0 takes every field a presentation lacks from its New Presentation (one title
// slide, 960x540 pt, crates/model/src/lib.rs:758-790), so the manifest's presentation needs only
// the creation time, a stand-in the server replaces (NewFiles::stamped()). The generator must be
// DeckCraft's own name and a version not newer than the app: the adapter makes a save of another
// program's file a copy (translators/deckcraft.js). mimetype first and stored, like DeckCraft's.
function deckcraft() {
  const manifest = { format: 'deckcraft', version: 1, generator: 'DeckCraft 0.5.0', presentation: { props: { created: CREATED_W3C } } };
  return zipStored([
    ['mimetype', Buffer.from('application/vnd.storyteller.deckcraft+zip', 'latin1')],
    ['presentation.json', Buffer.from(JSON.stringify(manifest), 'utf8')],
  ]);
}

// --- CADCraft (.dxf) -----------------------------------------------------------------------------
// Only the inch drawing is shipped: CADCraft's own default (File > New Drawing, Ctrl+N). The
// metric one opens and saves back too, but zoomed to 10 mm, not to the A3 sheet a new metric
// drawing of CADCraft shows.
// The pairs crates/io/src/dxf_write.rs (v0.5.0) writes for Drawing::new_imperial() / new_metric()
// (crates/doc/src/lib.rs:81-120, header.rs:89-148): no entities, so no $EXTMIN/$EXTMAX and the
// VPORT's default view; handles from handseed 0x100 + 0x1000, in the writer's allocation order.
function cadcraftBlank({ metric = false } = {}) {
  let next = 0x1100;
  const h = () => (next++).toString(16).toUpperCase();
  const pairs = [];
  const add = (...list) => { for (let i = 0; i < list.length; i += 2) pairs.push([list[i], list[i + 1]]); };
  // Handles allocated before the HEADER is written (dxf_write.rs:1200-1327).
  const br = { model: h(), paper: h(), paper0: h() };
  const tableStyle = h();
  const dict = { root: h(), group: h(), layout: h(), tableStyle: h() };
  const layout = { model: h(), layout1: h(), layout2: h() };
  const point = (code, x, y, z) => add(code, x, code + 10, y, ...(z === undefined ? [] : [code + 20, z]));

  add(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$DWGCODEPAGE', 3, 'ANSI_1252');
  add(9, '$INSBASE'); point(10, '0.0', '0.0', '0.0');
  add(9, '$LIMMIN'); point(10, '0.0', '0.0');
  add(9, '$LIMMAX'); point(10, metric ? '420.0' : '12.0', metric ? '297.0' : '9.0');
  add(9, '$FILLMODE', 70, '1', 9, '$MIRRTEXT', 70, '0', 9, '$LTSCALE', 40, '1.0', 9, '$ATTMODE', 70, '1',
    9, '$TEXTSIZE', 40, metric ? '2.5' : '0.2', 9, '$TEXTSTYLE', 7, 'Standard', 9, '$CLAYER', 8, '0',
    9, '$CELTYPE', 6, 'ByLayer', 9, '$CECOLOR', 62, '256', 9, '$CELTSCALE', 40, '1.0', 9, '$DIMSCALE', 40, '1.0',
    9, '$DIMSTYLE', 2, metric ? 'ISO-25' : 'Standard', 9, '$LUNITS', 70, '2', 9, '$LUPREC', 70, '4',
    9, '$AUNITS', 70, '0', 9, '$AUPREC', 70, '0', 9, '$ELEVATION', 40, '0.0', 9, '$THICKNESS', 40, '0.0',
    9, '$FILLETRAD', 40, '0.0');
  if (!metric) add(9, '$CHAMFERA', 40, '0.0', 9, '$CHAMFERB', 40, '0.0');
  add(9, '$ANGBASE', 50, '0.0', 9, '$ANGDIR', 70, '0', 9, '$PDMODE', 70, '0', 9, '$PDSIZE', 40, '0.0',
    9, '$CELWEIGHT', 370, '-1', 9, '$LWDISPLAY', 290, '0', 9, '$INSUNITS', 70, metric ? '4' : '1',
    9, '$MEASUREMENT', 70, metric ? '1' : '0', 9, '$PSLTSCALE', 70, '1', 9, '$CMLEADERSTYLE', 2, 'Standard');
  const seed = pairs.length; // filled in at the end: the next free handle
  add(9, '$HANDSEED', 5, '0', 0, 'ENDSEC');

  add(0, 'SECTION', 2, 'CLASSES');
  for (const [name, cpp] of [['TABLESTYLE', 'AcDbTableStyle'], ['MLEADERSTYLE', 'AcDbMLeaderStyle']]) {
    add(0, 'CLASS', 1, name, 2, cpp, 3, 'ObjectDBX Classes', 90, '4095', 280, '0', 281, '0');
  }
  add(0, 'ENDSEC', 0, 'SECTION', 2, 'TABLES');
  const table = (name, count, extra = []) => { const t = h(); add(0, 'TABLE', 2, name, 5, t, 330, '0', 100, 'AcDbSymbolTable', 70, String(count), ...extra); return t; };
  const record = (type, owner, subclass, handle = h(), handleCode = 5) => { add(0, type, handleCode, handle, 330, owner, 100, 'AcDbSymbolTableRecord', 100, subclass); return handle; };
  let t = table('VPORT', 1);
  record('VPORT', t, 'AcDbViewportTableRecord');
  add(2, '*Active', 70, '0'); point(10, '0.0', '0.0'); point(11, '1.0', '1.0'); point(12, '6.0', '4.5'); point(13, '0.0', '0.0');
  point(14, '0.5', '0.5'); point(15, '0.5', '0.5'); point(16, '0.0', '0.0', '1.0'); point(17, '0.0', '0.0', '0.0');
  add(40, '9.0', 41, '1.6', 42, '50.0', 50, '0.0', 0, 'ENDTAB');
  t = table('LTYPE', 3);
  const ltypes = {};
  for (const [name, description] of [['ByBlock', ''], ['ByLayer', ''], ['Continuous', 'Solid line']]) {
    ltypes[name] = record('LTYPE', t, 'AcDbLinetypeTableRecord');
    add(2, name, 70, '0', 3, description, 72, '65', 73, '0', 40, '-0.0');
  }
  add(0, 'ENDTAB');
  t = table('LAYER', 2);
  record('LAYER', t, 'AcDbLayerTableRecord'); add(2, '0', 70, '0', 62, '7', 6, 'Continuous', 370, '-3');
  record('LAYER', t, 'AcDbLayerTableRecord'); add(2, 'Defpoints', 70, '0', 62, '7', 6, 'Continuous', 290, '0', 370, '-3');
  add(0, 'ENDTAB');
  t = table('STYLE', 1);
  const standard = record('STYLE', t, 'AcDbTextStyleTableRecord');
  add(2, 'Standard', 70, '0', 40, '0.0', 41, '1.0', 50, '0.0', 71, '0', 42, '0.2', 3, 'txt', 4, '',
    1001, 'CADCRAFT', 1000, 'FONT', 1000, 'CADCraft Stroke', 0, 'ENDTAB');
  table('VIEW', 0); add(0, 'ENDTAB');
  table('UCS', 0); add(0, 'ENDTAB');
  t = table('APPID', 5);
  for (const app of ['ACAD', 'CADCRAFT', 'AcadAnnotative', 'AcCmTransparency', 'AcAecLayerStandard']) {
    record('APPID', t, 'AcDbRegAppTableRecord'); add(2, app, 70, '0');
  }
  add(0, 'ENDTAB');
  t = table('DIMSTYLE', metric ? 2 : 1, [100, 'AcDbDimStyleTable', 71, '0']);
  // Standard (inch) and ISO-25 (crates/doc DimStyle::default() / iso25()).
  const dimStyles = [['Standard', '0.18', '0.0625', '0.38', '0.18', '0.18', '0.09', '0.09', '1', '1', '0', '0', '4']];
  if (metric) dimStyles.push(['ISO-25', '2.5', '0.625', '3.75', '1.25', '2.5', '2.5', '0.625', '0', '0', '1', '8', '2']);
  for (const [name, dimasz, dimexo, dimdli, dimexe, dimtxt, dimcen, dimtsz0, dimtih, dimtoh, dimtad, dimzin, dimdec] of dimStyles) {
    record('DIMSTYLE', t, 'AcDbDimStyleTableRecord', h(), 105);
    add(2, name, 70, '0', 40, '1.0', 41, dimasz, 42, dimexo, 43, dimdli, 44, dimexe, 45, '0.0', 46, '0.0', 47, '0.0', 48, '0.0',
      140, dimtxt, 141, dimcen, 142, '0.0', 143, '25.4', 144, '1.0', 146, '1.0', 147, dimtsz0, 148, '0.0',
      71, '0', 72, '0', 73, dimtih, 74, dimtoh, 75, '0', 76, '0', 77, dimtad, 78, dimzin, 170, '0', 171, '2',
      176, '0', 177, '0', 178, '0', 179, '0', 271, dimdec, 272, '4', 273, '2', 275, '0', 276, '0', 277, '2', 278, '46',
      280, '0', 284, '0', 285, '0', 340, standard);
  }
  add(0, 'ENDTAB');
  t = table('BLOCK_RECORD', 3);
  record('BLOCK_RECORD', t, 'AcDbBlockTableRecord', br.model); add(2, '*Model_Space', 340, layout.model);
  record('BLOCK_RECORD', t, 'AcDbBlockTableRecord', br.paper); add(2, '*Paper_Space', 340, layout.layout1);
  record('BLOCK_RECORD', t, 'AcDbBlockTableRecord', br.paper0); add(2, '*Paper_Space0', 340, layout.layout2);
  add(0, 'ENDTAB', 0, 'ENDSEC');

  add(0, 'SECTION', 2, 'BLOCKS');
  for (const [name, owner, paper] of [['*Model_Space', br.model, false], ['*Paper_Space', br.paper, true], ['*Paper_Space0', br.paper0, true]]) {
    const space = paper ? [67, '1'] : [];
    add(0, 'BLOCK', 5, h(), 330, owner, 100, 'AcDbEntity', ...space, 8, '0', 100, 'AcDbBlockBegin', 2, name, 70, '0');
    point(10, '0.0', '0.0', '0.0');
    add(3, name, 1, '', 0, 'ENDBLK', 5, h(), 330, owner, 100, 'AcDbEntity', ...space, 8, '0', 100, 'AcDbBlockEnd');
  }
  add(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', 0, 'ENDSEC');

  add(0, 'SECTION', 2, 'OBJECTS');
  const mleaderDict = h();
  const mleaderStyle = h();
  add(0, 'DICTIONARY', 5, dict.root, 330, '0', 100, 'AcDbDictionary', 281, '1', 3, 'ACAD_GROUP', 350, dict.group,
    3, 'ACAD_LAYOUT', 350, dict.layout, 3, 'ACAD_MLEADERSTYLE', 350, mleaderDict, 3, 'ACAD_TABLESTYLE', 350, dict.tableStyle);
  add(0, 'DICTIONARY', 5, dict.group, 330, dict.root, 100, 'AcDbDictionary', 281, '1');
  add(0, 'DICTIONARY', 5, mleaderDict, 330, dict.root, 100, 'AcDbDictionary', 281, '1', 3, 'Standard', 350, mleaderStyle);
  add(0, 'MLEADERSTYLE', 5, mleaderStyle, 102, '{ACAD_REACTORS', 330, mleaderDict, 102, '}', 330, mleaderDict,
    100, 'AcDbMLeaderStyle', 179, '2', 170, '2', 171, '1', 172, '0', 90, '2', 40, '0.0', 41, '0.0', 173, '1',
    91, '-1056964608', 340, ltypes.ByBlock, 92, '-2', 290, '1', 42, '0.09', 291, '1', 43, '0.36', 3, '', 44, '0.18',
    300, '', 342, standard, 174, '1', 178, '1', 175, '1', 176, '0', 93, '-1056964608', 45, '0.18', 292, '0', 297, '0',
    46, '4.0', 94, '-1056964608', 47, '1.0', 49, '1.0', 140, '1.0', 293, '1', 141, '0.0', 294, '1', 177, '0',
    142, '1.0', 295, '0', 296, '0', 143, '0.125', 271, '0', 272, '9', 273, '9');
  add(0, 'DICTIONARY', 5, dict.tableStyle, 330, dict.root, 100, 'AcDbDictionary', 281, '1', 3, 'Standard', 350, tableStyle);
  add(0, 'TABLESTYLE', 5, tableStyle, 102, '{ACAD_REACTORS', 330, dict.tableStyle, 102, '}', 330, dict.tableStyle,
    100, 'AcDbTableStyle', 3, '', 70, '0', 71, '0', 40, '0.06', 41, '0.06', 280, '0', 281, '0');
  for (const [height, kind] of [['0.18', '4'], ['0.18', '5'], ['0.252', '5']]) {
    add(7, 'Standard', 140, height, 170, kind, 62, '0', 63, '7', 283, '0', 274, '-2', 275, '-2', 276, '-2', 277, '-2',
      278, '-2', 279, '-2', 284, '1', 285, '1', 286, '1', 287, '1', 288, '1', 289, '1', 64, '0', 65, '0', 66, '0',
      67, '0', 68, '0', 69, '0');
  }
  add(0, 'DICTIONARY', 5, dict.layout, 330, dict.root, 100, 'AcDbDictionary', 281, '1',
    3, 'Model', 350, layout.model, 3, 'Layout1', 350, layout.layout1, 3, 'Layout2', 350, layout.layout2);
  for (const [name, handle, order, owner] of [['Model', layout.model, '0', br.model], ['Layout1', layout.layout1, '1', br.paper], ['Layout2', layout.layout2, '2', br.paper0]]) {
    add(0, 'LAYOUT', 5, handle, 330, dict.layout, 100, 'AcDbPlotSettings', 1, '', 2, 'none_device',
      4, 'ANSI_A_(8.50_x_11.00_Inches)', 6, '', 40, '6.35', 41, '6.35', 42, '6.35', 43, '6.35', 44, '215.9', 45, '279.4',
      46, '0.0', 47, '0.0', 48, '0.0', 49, '0.0', 140, '0.0', 141, '0.0', 142, '1.0', 143, '1.0', 70, '688', 72, '0',
      73, '1', 74, '5', 7, '', 75, '16', 147, '1.0', 148, '0.0', 149, '0.0', 100, 'AcDbLayout', 1, name, 70, '1', 71, order);
    point(10, '0.0', '0.0'); point(11, '12.0', '9.0'); point(12, '0.0', '0.0', '0.0'); point(14, '0.0', '0.0', '0.0');
    point(15, '0.0', '0.0', '0.0');
    add(146, '0.0'); point(13, '0.0', '0.0', '0.0'); point(16, '1.0', '0.0', '0.0'); point(17, '0.0', '1.0', '0.0');
    add(76, '0', 330, owner);
  }
  add(0, 'ENDSEC', 0, 'EOF');
  pairs[seed + 1] = [5, h()];
  // ASCII DXF as CADCraft writes it: the group code right-aligned to 3, CRLF line ends.
  return Buffer.from(pairs.map(([code, value]) => `${String(code).padStart(3)}\r\n${value}\r\n`).join(''), 'latin1');
}


// --- FilmCraft (.fcproj) -------------------------------------------------------------------------
// crates/project/src/lib.rs Project::new(name) (:1343-1357) with ProjectSettings::default()
// (:1210-1226), in the envelope of crates/format/src/lib.rs encode_with_view (compact), with the
// view a project without sequences has. serde_json writes f64 20 as 20.0, so the settings are text.
function filmcraftBlank(name) {
  const n = JSON.stringify(String(name));
  return Buffer.from('{"format":"filmcraft.project","schema_version":15,"generator":"FilmCraft 0.6.0","project":{' +
    `"name":${n},"settings":{"renderer":"FilmCraft GPU Acceleration (wgpu)","video_display":"Timecode",` +
    '"audio_display_samples":true,"default_still_duration":1270080000000,"default_transition_duration_frames":24,' +
    '"default_audio_transition_duration":254016000000,"ingest":{"enabled":false,"action":"createProxies",' +
    '"destination":null,"preset":""},"title_safe":[20.0,20.0],"action_safe":[10.0,10.0],"capture_format":"DV",' +
    '"scratch":{"captured":null,"videoPreviews":null,"audioPreviews":null,"autoSave":null}},' +
    `"root":{"id":0,"name":${n},"children":[]},"items":{},"next_id":1},` +
    '"view":{"open_sequences":[],"active_sequence":null,"sequences":{}}}', 'utf8');
}

// --- EffectCraft (.ecproj) -----------------------------------------------------------------------
// crates/project/src/lib.rs Project::default() (:1204-1216) as to_file_json writes it
// (:1317-1330: savedBy first, serde_json pretty printing, no newline at the end).
function effectcraftBlank() {
  return Buffer.from(`{
  "savedBy": "0.8.0",
  "schema": 2,
  "settings": {
    "bit_depth": "Bpc8",
    "linearize": false,
    "working_space": null,
    "blend_linear": false,
    "time_display": "Timecode",
    "frame_start": 0,
    "audio_sample_rate": 48000,
    "gpu_acceleration": true,
    "color_engine": "Adobe",
    "hdr": "Clip",
    "output_space": null,
    "working_gamma": 2.2
  },
  "items": {},
  "next_id": 1
}`, 'utf8');
}

// --- SoundCraft (.scraftz) -----------------------------------------------------------------------
// The session SoundCraft 0.6.1 makes for File > New, as its serde writes it compact (with the
// fields that have defaults: without them the view changes), named 'New session', in the bundle
// the web build saves and opens: a zip of stored entries (it reads no deflate) with the session as
// a top-level '<name>.scraft' and no audio. Its name need not match the file's: the app names the
// session after the file it opened, and the first Save writes the file under that name
// (docs/apps/soundcraft.md).
const SC_SESSION = {"format_version":1,"name":"New session","sample_rate":48000,"bit_depth":"Int24","frame_rate":"Fps30","timecode_start":0,"tempo":{"tempos":[{"tick":0,"bpm":120}],"meters":[{"tick":0,"numerator":4,"denominator":4}]},"key_signatures":[],"tracks":[],"sources":[],"videos":[],"busses":[],"outputs":[{"name":"Out 1-2","first_channel":0,"format":"Stereo"}],"markers":[],"groups":[],"edit":{"tool":"Smart","edit_mode":"Slip","selection":{"start":0,"end":0},"selected_tracks":[],"selected_clips":[],"selected_sources":[],"playhead":0,"grid":{"Note":{"value":"Sixteenth","dotted":false,"triplet":false}},"nudge":{"Seconds":1},"grid_lines":true,"main_counter":"MinSecs","sub_counter":"Samples","zoom":{"samples_per_px":1024,"scroll":0,"waveform_zoom":1,"presets":[64,256,1024,4096,16384]},"rulers":["bars_beats","min_secs","tempo","meter","markers"],"link_timeline_edit":true,"link_track_edit":false,"insertion_follows_playback":false,"loop_playback":false,"pre_post_roll":false,"pre_roll":96000,"post_roll":96000,"tab_to_transient":false,"automation_follows_edit":true,"markers_follow_edit":false,"layered_editing":false,"mirrored_midi":false,"click":false,"countoff":false,"countoff_bars":2,"midi_merge":false,"record_mode":"normal","loop_record":false,"quickpunch":false,"scrolling":"page","solo_mode":"sip","pre_fader_metering":false,"delay_compensation":true,"keyboard_focus":"commands","timeline_selection":{"start":0,"end":0},"flags":["view.clip.gain_line","view.clip.name","view.clip.overlap_shadows","view.marker.ruler_lines","waveform.peak"],"values":{}},"next_id":1,"comments":"","midi_originals":{}};

function soundcraftBlank() {
  return zipStored([['New session.scraft', Buffer.from(JSON.stringify(SC_SESSION), 'utf8')]]);
}

// --- FigCraft (.figcraft) ------------------------------------------------------------------------
// The document FigCraft 0.12.1 makes for New design file, as its web build saves it: a zip with
// document.json (deflated), the document named 'Untitled' with one empty page. FigCraft names a
// document it opens 'Untitled' after the file's stem, so the first save goes to the file the user
// created (docs/apps/figcraft.md).
const FC_DOCUMENT = '{"format":"figcraft","version":1,"imageIndex":[],"name":"Untitled","pages":[1],"nodes":{"1":{"id":1,"name":"Page 1","type":"page","background":{"r":0.9607843,"g":0.9607843,"b":0.9607843,"a":1.0},"flows":[],"prototype":{"device":"None","background":{"r":0.11764706,"g":0.11764706,"b":0.11764706,"a":1.0},"rotation":"portrait"},"guides":[],"width":0.0,"height":0.0}},"next_id":2,"styles":[],"variables":{"collections":[],"variables":[]},"current_page":1,"document_colors":[],"comments":[]}';

function figcraftBlank() {
  return Buffer.from(zipSync({ 'document.json': [strToU8(FC_DOCUMENT), { level: 9, mtime: MTIME }] }));
}

// FilmCraft keeps the project's name in the file, and Save As and the adapter name a save after it:
// the server writes the new file's name instead of this one (NewFiles::stamped()).
export const FILMCRAFT_NAME = 'New FilmCraft project';

// The MIT notices of the parts of the blanks that come from the apps.
function licenseNotice() {
  // The license text without its template's copyright line: the notices above are those.
  const mit = readFileSync(path.join(here, '..', 'LICENSES', 'MIT.txt'), 'utf8').replace(/^Copyright \(c\) <year> <copyright holders>\n\n/m, '');
  return Buffer.from(`Parts of the blank documents in this folder are what the Craft apps write for a new document,
taken from their own saves; the apps are licensed under either of the Apache License, Version 2.0,
or the MIT license, at your option, and those parts are used here under the MIT license.

blank.vectorcraft: Copyright (c) 2026 ArtCraft Team and the VectorCraft contributors
blank.designcraft: Copyright (c) 2026 ArtCraft Team and the DesignCraft contributors
blank.xlsx, blank-letter.xlsx: Copyright (c) 2026 ArtCraft Team and the GridCraft contributors
blank.dxf: Copyright (c) 2026 ArtCraft Team and the CADCraft contributors
blank.fcproj: Copyright (c) 2026 ArtCraft Team and the FilmCraft contributors
blank.ecproj: Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors
blank.scraftz: Copyright (c) 2026 ArtCraft Team and the SoundCraft contributors
blank.figcraft: Copyright (c) 2026 ArtCraft Team and the FigCraft contributors

${mit}`, 'utf8');
}

// File name in assets/ => its bytes. NewFiles::blankPath() picks them by app and paper.
export function blanks() {
  return {
    'LICENSE-MIT.txt': licenseNotice(),
    'blank.docx': docx('a4'),
    'blank-letter.docx': docx('letter'),
    'blank.xlsx': xlsx('a4'),
    'blank-letter.xlsx': xlsx('letter'),
    'blank.pdf': pdf('a4'),
    'blank-letter.pdf': pdf('letter'),
    'blank.psd': psd(),
    'blank.vectorcraft': vectorcraft(),
    'blank.designcraft': designcraft(),
    'blank.deckcraft': deckcraft(),
    'blank.dxf': cadcraftBlank(),
    'blank.fcproj': filmcraftBlank(FILMCRAFT_NAME),
    'blank.ecproj': effectcraftBlank(),
    'blank.scraftz': soundcraftBlank(),
    'blank.figcraft': figcraftBlank(),
  };
}

const command = process.argv[2];
if (command === 'write') {
  mkdirSync(ASSETS, { recursive: true });
  for (const [name, bytes] of Object.entries(blanks())) writeFileSync(path.join(ASSETS, name), bytes);
  console.log(`wrote ${Object.keys(blanks()).length} blank documents to assets/`);
} else if (command === 'check') {
  const want = blanks();
  let failed = false;
  for (const [name, bytes] of Object.entries(want)) {
    let have = null;
    try {
      have = readFileSync(path.join(ASSETS, name));
    } catch { /* missing */ }
    if (!have || !have.equals(bytes)) { console.error(`assets/${name}: differs from what blanks.mjs makes (run: node craftsuite_layer/blanks.mjs write)`); failed = true; }
  }
  for (const name of readdirSync(ASSETS)) {
    if (!(name in want)) { console.error(`assets/${name}: not made by blanks.mjs`); failed = true; }
  }
  // NewFiles::stamped() replaces these stand-ins with the new file's time or name: the same values
  // there, and each exactly as often in the blank as it expects.
  const php = readFileSync(path.join(here, 'lib', 'Service', 'NewFiles.php'), 'utf8');
  const constant = (name) => /const\s+\w+\s+=\s+'?([^';]+)'?;/.exec(php.slice(php.indexOf(`const ${name} `)))?.[1];
  for (const [name, value] of [['CREATED_SECONDS', String(CREATED_SECONDS)], ['CREATED_W3C', CREATED_W3C], ['FILMCRAFT_NAME', FILMCRAFT_NAME]]) {
    if (constant(name) !== value) { console.error(`NewFiles::${name} is ${constant(name)}, blanks.mjs has ${value}`); failed = true; }
  }
  const count = (bytes, text) => bytes.toString('latin1').split(text).length - 1;
  for (const [name, text, times] of [
    ['blank.vectorcraft', `"created":${CREATED_SECONDS}`, 1],
    ['blank.designcraft', `"created":${CREATED_SECONDS}`, 1],
    ['blank.deckcraft', `"created":"${CREATED_W3C}"`, 1],
    ['blank.fcproj', `"name":${JSON.stringify(FILMCRAFT_NAME)}`, 2],
  ]) {
    if (count(want[name], text) !== times) { console.error(`assets/${name}: ${text} is not there ${times} time(s), as NewFiles::stamped() expects`); failed = true; }
  }
  for (const name of ['blank.docx', 'blank-letter.docx']) {
    const core = strFromU8(unzipSync(want[name])['docProps/core.xml'] ?? new Uint8Array());
    if (!core.includes(`>${CREATED_W3C}</dcterms:created>`) || !core.includes(`>${CREATED_W3C}</dcterms:modified>`)) {
      console.error(`assets/${name}: docProps/core.xml lacks the creation and change time NewFiles::stamped() replaces`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log(`${Object.keys(want).length} blank documents as blanks.mjs makes them`);
} else if (command !== undefined) {
  console.error('usage: node blanks.mjs write|check');
  process.exit(2);
}
