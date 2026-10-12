// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the GridCraft fixtures of other programs. They are committed; run this only to change
// them:
//   node tests/e2e/fixtures/gridcraft/make-fixtures.mjs
//
// from-excel.xlsx   a workbook as Excel writes it: docProps/app.xml says Microsoft Excel, core.xml
//                   has creation and change times, and two parts GridCraft does not read (custom
//                   properties, a customXml item); sheet 'Data' with MARKER in A1 and 42 in B1
// macros.xlsm       the same with a (fake) VBA project; GridCraft drops it with a warning
// data.csv          MARKER,42 and two more rows
// data.ods          MARKER and 42 in an OpenDocument spreadsheet (a data import for GridCraft)
//
// craftsuite-probe.xlsx is not written here: GridCraft 0.5.0 saved it itself (see
// docs/apps/gridcraft.md), because the tests need a file GridCraft wrote.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-gc01';
// Fixed zip times, so that a run without changes writes the same bytes.
const mtime = new Date('2026-01-01T00:00:00Z');

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';

function excelPackage({ macros = false } = {}) {
  const main = macros ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  const parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      (macros ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' : '') +
      `<Override PartName="/xl/workbook.xml" ContentType="${main}"/>` +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>' +
      '</Types>',
    '_rels/.rels': `<Relationships xmlns="${PR}">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      `<Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/>` +
      `<Relationship Id="rId4" Type="${R}/custom-properties" Target="docProps/custom.xml"/>` +
      '</Relationships>',
    'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="${R}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PR}">` +
      `<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId3" Type="${R}/customXml" Target="../customXml/item1.xml"/>` +
      (macros ? '<Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>' : '') +
      '</Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>${MARKER}</t></is></c><c r="B1"><v>42</v></c></row>` +
      '</sheetData></worksheet>',
    'xl/styles.xml': `<styleSheet xmlns="${NS}">` +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '</styleSheet>',
    'docProps/core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:creator>Probe Author</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-02T00:00:00Z</dcterms:modified></cp:coreProperties>',
    'docProps/app.xml': '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
      '<Application>Microsoft Excel</Application><AppVersion>16.0300</AppVersion></Properties>',
    'docProps/custom.xml': '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ProbeProperty"><vt:lpwstr>keep me</vt:lpwstr></property></Properties>',
    'customXml/item1.xml': '<probe xmlns="urn:craftsuite-probe">keep me</probe>',
  };
  const zip = Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(XML + text)]));
  if (macros) zip['xl/vbaProject.bin'] = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3, 4]);
  return zipSync(zip, { level: 6, mtime });
}

// ODS: the stored 'mimetype' entry first, then the manifest and the content.
function odsPackage() {
  const office = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }],
    'META-INF/manifest.xml': strToU8(XML + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
      '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>' +
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>'),
    'content.xml': strToU8(XML + `<office:document-content ${office} office:version="1.2"><office:body><office:spreadsheet>` +
      '<table:table table:name="Data"><table:table-row>' +
      `<table:table-cell office:value-type="string"><text:p>${MARKER}</text:p></table:table-cell>` +
      '<table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell>' +
      '</table:table-row></table:table></office:spreadsheet></office:body></office:document-content>'),
  }, { level: 6, mtime });
}

const put = (name, bytes) => {
  writeFileSync(path.join(here, name), bytes);
  console.log(`wrote ${name} (${bytes.length} bytes)`);
};
put('from-excel.xlsx', excelPackage());
put('macros.xlsm', excelPackage({ macros: true }));
put('data.csv', strToU8(`${MARKER},42\nalpha,1\nbeta,2\n`));
put('data.ods', odsPackage());
