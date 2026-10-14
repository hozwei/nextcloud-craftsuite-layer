// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the CADCraft fixtures that a script can write. They are committed; run this only to
// change them:
//   node tests/e2e/fixtures/cadcraft/make-fixtures.mjs
//
// craftsuite-probe.dxf  (not written here) saved by CADCraft 0.5.0: a circle and a text with
//                       PROBE_MARKER, see docs/apps/cadcraft.md
// foreign.dxf           an R2018 ASCII DXF as another CAD program writes it, with what CADCraft
//                       does not keep: header variables ($ACADMAINTVER, $TDCREATE,
//                       $FINGERPRINTGUID, $VERSIONGUID); and with what 0.5.0 did not keep and
//                       0.6.2 keeps: another application's xdata on a LINE, an MLINE and that
//                       application's XRECORD in the named object dictionary; a TEXT with
//                       FOREIGN_MARKER
// newer-cadcraft.dxf    craftsuite-probe.dxf with what no CADCraft release writes: $FINGERPRINTGUID
//                       (which CADCraft drops), another application's xdata on the TEXT, and an
//                       MLINE (0.5.0 drops both, 0.6.2 keeps them). Its layout is still CADCraft's
//                       (header start, APPID, CRLF)
//
// DXF is CRLF text: the files must stay byte for byte as written.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROBE_MARKER = 'CRAFTSUITE-PROBE-cc01';
export const FOREIGN_MARKER = 'CRAFTSUITE-FOREIGN-cc02';

// Group code and value pairs as ASCII DXF: the code right-aligned to 3, CRLF line ends.
const dxf = (pairs) => pairs.map(([code, value]) => `${String(code).padStart(3)}\r\n${value}\r\n`).join('');

const FINGERPRINT = [[9, '$FINGERPRINTGUID'], [2, '{6B3C1F8E-0D4A-4C55-9E7B-2A1D3C4B5E6F}']];
const ACME_XDATA = [[1001, 'ACME_APP'], [1000, 'keep-me-xdata']];
// A two-segment MLINE of the STANDARD style from (0, 8) to (6, 8), with the given handle.
const mline = (handle) => [
  [0, 'MLINE'], [5, handle], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbMline'], [2, 'STANDARD'],
  [40, '1.0'], [70, '0'], [71, '1'], [72, '2'], [73, '2'], [10, '0.0'], [20, '8.0'], [30, '0.0'],
  ...[0, 6].flatMap((x) => [
    [11, `${x}.0`], [21, '8.0'], [31, '0.0'], [12, '1.0'], [22, '0.0'], [32, '0.0'], [13, '0.0'], [23, '1.0'], [33, '0.0'],
    [74, '2'], [41, '0.0'], [41, '0.0'], [75, '0'], [74, '2'], [41, '-1.0'], [41, '0.0'], [75, '0'],
  ]),
];

const foreign = dxf([
  [0, 'SECTION'], [2, 'HEADER'],
  [9, '$ACADVER'], [1, 'AC1032'],
  [9, '$ACADMAINTVER'], [70, '105'],
  [9, '$DWGCODEPAGE'], [3, 'ANSI_1252'],
  [9, '$INSUNITS'], [70, '4'],
  [9, '$TDCREATE'], [40, '2461041.5'],
  ...FINGERPRINT,
  [9, '$VERSIONGUID'], [2, '{11111111-2222-3333-4444-555555555555}'],
  [9, '$HANDSEED'], [5, 'FF'],
  [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'TABLES'],
  [0, 'TABLE'], [2, 'APPID'], [5, '9'], [70, '2'],
  [0, 'APPID'], [5, '12'], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbRegAppTableRecord'], [2, 'ACAD'], [70, '0'],
  [0, 'APPID'], [5, '13'], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbRegAppTableRecord'], [2, 'ACME_APP'], [70, '0'],
  [0, 'ENDTAB'],
  [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'ENTITIES'],
  [0, 'LINE'], [5, 'A1'], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbLine'],
  [10, '0.0'], [20, '0.0'], [30, '0.0'], [11, '10.0'], [21, '5.0'], [31, '0.0'],
  ...ACME_XDATA,
  [0, 'TEXT'], [5, 'A2'], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbText'],
  [10, '1.0'], [20, '1.0'], [30, '0.0'], [40, '0.5'], [1, FOREIGN_MARKER], [100, 'AcDbText'],
  ...mline('A3'),
  [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'OBJECTS'],
  [0, 'DICTIONARY'], [5, 'C'], [330, '0'], [100, 'AcDbDictionary'], [281, '1'], [3, 'ACME_SETTINGS'], [350, 'D'],
  [0, 'XRECORD'], [5, 'D'], [330, 'C'], [100, 'AcDbXrecord'], [280, '1'], [1, 'acme-setting-keep-me'],
  [0, 'ENDSEC'],
  [0, 'EOF'],
]);

// `text` with `insert` before the first `before` that follows the first `after`.
function insert(text, after, before, insert) {
  const from = text.indexOf(after);
  const at = from < 0 ? -1 : text.indexOf(before, from + after.length);
  if (at < 0) throw new Error(`craftsuite-probe.dxf has no ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  return text.slice(0, at) + insert + text.slice(at);
}

function newerCadcraft() {
  let text = readFileSync(path.join(here, 'craftsuite-probe.dxf'), 'latin1');
  // The header variable right after $DWGCODEPAGE, as the first of CADCraft's own; the xdata at the
  // end of the TEXT with the marker; the MLINE at the end of ENTITIES.
  text = insert(text, '$DWGCODEPAGE\r\n  3\r\nANSI_1252\r\n', '  9\r\n', dxf(FINGERPRINT));
  text = insert(text, `  1\r\n${PROBE_MARKER}\r\n`, '  0\r\n', dxf(ACME_XDATA));
  return insert(text, '  2\r\nENTITIES\r\n', '  0\r\nENDSEC\r\n', dxf(mline('FFF0')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(here, 'foreign.dxf'), foreign, 'latin1');
  writeFileSync(path.join(here, 'newer-cadcraft.dxf'), newerCadcraft(), 'latin1');
  console.log('fixtures written');
}
