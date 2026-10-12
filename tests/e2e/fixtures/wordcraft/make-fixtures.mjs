// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the WordCraft fixtures that other programs would write. They are committed; run this
// only to change them:
//   node tests/e2e/fixtures/wordcraft/make-fixtures.mjs
//
// from-word.docx  a Word package as Word writes it (docProps/app.xml: Application 'Microsoft
//                 Office Word'): stored title 'Stored Title', creation time
//                 2025-03-04T05:06:07Z, a paragraph with MARKER, a content control, a legacy
//                 check box form field and a custom XML part, three things a WordCraft 0.5.0
//                 save drops (its docs/file-format-parity.md)
// probe.odt       an OpenDocument text with MARKER, a stored title and meta:creation-date
// probe.rtf       an RTF with MARKER, a stored title and \creatim
//
// craftsuite-probe.docx next to them is not written here: WordCraft 0.5.0 saved it (see
// docs/apps/wordcraft.md, Tests).

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-wc01';
const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
// A fixed time in local time, so that the zip's DOS timestamps do not depend on the time zone.
const MTIME = new Date(2026, 0, 1);
const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([name, [text, level]]) =>
  [name, [strToU8(text), { level, mtime: MTIME }]])));

function fromWord() {
  return zip({
    '[Content_Types].xml': [X + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>
</Types>`, 6],
    '_rels/.rels': [X + `<Relationships xmlns="${PR}">
<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="${PR}/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/>
</Relationships>`, 6],
    'word/document.xml': [X + `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>
<w:p><w:r><w:t xml:space="preserve">${MARKER} Word fixture</w:t></w:r></w:p>
<w:sdt><w:sdtPr><w:alias w:val="ProbeControl"/><w:tag w:val="probe-tag"/><w:id w:val="12345"/><w:text/></w:sdtPr>
<w:sdtContent><w:p><w:r><w:t>SDT-CONTENT</w:t></w:r></w:p></w:sdtContent></w:sdt>
<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="ProbeCheck"/><w:enabled/><w:calcOnExit w:val="0"/><w:checkBox><w:sizeAuto/><w:default w:val="1"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> FORMFIELD</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`, 6],
    'word/_rels/document.xml.rels': [X + `<Relationships xmlns="${PR}">
<Relationship Id="rId9" Type="${R}/customXml" Target="../customXml/item1.xml"/>
</Relationships>`, 6],
    'customXml/item1.xml': [X + '<probe xmlns="urn:craftsuite-probe">CUSTOMXML</probe>', 6],
    'customXml/itemProps1.xml': [X + '<ds:datastoreItem ds:itemID="{11111111-2222-3333-4444-555555555555}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>', 6],
    'customXml/_rels/item1.xml.rels': [X + `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/customXmlProps" Target="itemProps1.xml"/></Relationships>`, 6],
    'docProps/core.xml': [X + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Stored Title</dc:title><dc:creator>Probe</dc:creator><cp:lastModifiedBy>Probe</cp:lastModifiedBy><cp:revision>3</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2025-03-04T05:06:07Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2025-03-05T06:07:08Z</dcterms:modified>
</cp:coreProperties>`, 6],
    'docProps/app.xml': [X + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application></Properties>', 6],
  });
}

function odt() {
  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"';
  return zip({
    mimetype: ['application/vnd.oasis.opendocument.text', 0],
    'META-INF/manifest.xml': [X + `<manifest:manifest ${ns} manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`, 6],
    'content.xml': [X + `<office:document-content ${ns} office:version="1.3"><office:body><office:text>
<text:p text:style-name="Standard">${MARKER} ODT fixture</text:p></office:text></office:body></office:document-content>`, 6],
    'meta.xml': [X + `<office:document-meta ${ns} office:version="1.3"><office:meta><meta:creation-date>2025-03-04T05:06:07</meta:creation-date><dc:title>Stored ODT Title</dc:title></office:meta></office:document-meta>`, 6],
    // A default paragraph style, as every LibreOffice file has: without one WordCraft 0.5.0 opens
    // the text but draws none of it.
    'styles.xml': [X + `<office:document-styles ${ns} xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"><office:styles>
<style:default-style style:family="paragraph"><style:text-properties fo:font-size="12pt"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/></office:styles></office:document-styles>`, 6],
  });
}

const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\info{\\title Stored RTF Title}{\\creatim\\yr2025\\mo3\\dy4\\hr5\\min6}}\\f0 ${MARKER} RTF fixture\\par}\n`;

writeFileSync(path.join(here, 'from-word.docx'), fromWord());
writeFileSync(path.join(here, 'probe.odt'), odt());
writeFileSync(path.join(here, 'probe.rtf'), rtf);
console.log('written: from-word.docx probe.odt probe.rtf');
