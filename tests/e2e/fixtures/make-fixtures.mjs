// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the PDF fixtures. They are committed; run this only to change them:
//   node tests/e2e/fixtures/make-fixtures.mjs
//
// craftsuite-probe.pdf   two pages, a marker in /Info and in the text, classic xref (so PdfCraft
//                        saves incrementally and the tests can compare prefixes)
// attach-traversal.pdf   one page with an embedded PDF whose file name is
//                        '../../Team/Budget 2026.pdf' (a document-controlled name)

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-7f3a';

// objs: array of strings or Buffers (object bodies, numbered from 1). Returns the file.
function pdf(objs, rootId, infoId) {
  const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    offset += chunk.length;
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length + 1} /Root ${rootId} 0 R${infoId ? ` /Info ${infoId} 0 R` : ''} >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

const stream = (content) => `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`;

function probe() {
  const page = (n) => `BT /F1 28 Tf 72 700 Td (craftsuite-layer probe, page ${n}) Tj ET\n` +
    `BT /F1 14 Tf 72 660 Td (marker ${MARKER}) Tj ET\n0.12 0.23 0.34 rg 72 300 300 200 re f\n`;
  // 1 font, 2/3 page 1 content/page, 4/5 page 2, 6 pages, 7 catalog, 8 info
  const objs = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(page(1)),
    '<< /Type /Page /Parent 6 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >>',
    stream(page(2)),
    '<< /Type /Page /Parent 6 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >> /Contents 4 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Catalog /Pages 6 0 R >>',
    `<< /Title (${MARKER}) /Producer (craftsuite-layer fixtures) >>`,
  ];
  return pdf(objs, 7, 8);
}

function attachTraversal() {
  const inner = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream('BT /F1 24 Tf 72 700 Td (ATTACHED CONTENT) Tj ET\n'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ], 1).toString('latin1');
  const name = '../../Team/Budget 2026.pdf';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(a) 6 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    stream('BT /F1 24 Tf 72 700 Td (Document with attachment) Tj ET\n'),
    `<< /Type /EmbeddedFile /Subtype /application#2Fpdf /Length ${Buffer.byteLength(inner, 'latin1')} >>\nstream\n${inner}endstream`,
    `<< /Type /Filespec /F (${name}) /UF (${name}) /EF << /F 5 0 R >> >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  return pdf(objs, 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(here, 'craftsuite-probe.pdf'), probe());
  writeFileSync(path.join(here, 'attach-traversal.pdf'), attachTraversal());
  console.log('fixtures written');
}
