// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the PowerPoint fixture for DeckCraft. It is committed; run this only to change it:
//   node tests/e2e/fixtures/deckcraft/make-fixtures.mjs
//
// craftsuite-probe.pptx  a small PowerPoint package as Office writes one: a 16:9 slide with a text
//                        box holding MARKER; core properties with a stored title that differs from
//                        the file name and a creation time (dcterms:created, CREATED), the identity
//                        DeckCraft keeps; and a customXml part that DeckCraft does not model, so
//                        its PowerPoint export shows what it drops
//
// craftsuite-probe.deckcraft, the native fixture next to it, was saved by DeckCraft 0.5.0 (Ctrl+S
// in the test host) from the package powerPointPackage({ created: null }) returns: DeckCraft's own
// file of the same slide, without a creation time like every file made in DeckCraft (see
// docs/apps/deckcraft.md).
//
// The parts follow ECMA-376 as DeckCraft reads it (crates/pptx/src/read/, v0.5.0): no slide
// master or layout, which DeckCraft adds itself (format/src/lib.rs, repair).

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-dk01';
export const CREATED = '2025-01-02T03:04:05Z';
export const STORED_TITLE = 'Stored title differs';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  `xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const rels = (items) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('') + '</Relationships>';

// The package as a fixed list of parts; `created: null` leaves dcterms:created out.
export function powerPointPackage({ created = CREATED } = {}) {
  const parts = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>' +
      '</Types>',
    '_rels/.rels': rels([
      ['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ]),
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${STORED_TITLE}</dc:title><dc:creator>PowerPoint user</dc:creator>` +
      (created ? `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` : '') +
      '</cp:coreProperties>',
    'ppt/presentation.xml': `${XML}<p:presentation ${P}>` +
      '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>' +
      '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', `${REL}/slide`, 'slides/slide1.xml'],
      ['rId2', `${REL}/customXml`, '../customXml/item1.xml'],
    ]),
    'ppt/slides/slide1.xml': `${XML}<p:sld ${P}><p:cSld><p:spTree>` +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="TextBox 1"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="1524000" y="2743200"/><a:ext cx="9144000" cy="1371600"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
      `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="4000"/><a:t>${MARKER}</a:t></a:r></a:p></p:txBody>` +
      '</p:sp></p:spTree></p:cSld></p:sld>',
    'customXml/item1.xml': `${XML}<probe xmlns="urn:craftsuite-probe">${MARKER}-customxml</probe>`,
  };
  // A fixed time for every entry: the same input gives the same bytes.
  const mtime = new Date('2025-01-02T03:04:06Z');
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, [strToU8(xml), { mtime }]])), { level: 6 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(path.join(here, 'craftsuite-probe.pptx'), powerPointPackage());
  console.log('written: craftsuite-probe.pptx');
}
