// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the VectorCraft fixtures. They are committed; run this only to change them:
//   node tests/e2e/fixtures/vectorcraft/make-fixtures.mjs
//
// craftsuite-probe.vectorcraft  native file, plain JSON (format version 4), stored title equal to
//                               its file name; a 200x120 artboard named MARKER with two shapes
// renamed-probe.vectorcraft     the same drawing as a file renamed after it was saved: gzip (Use
//                               Compression), stored title 'craftsuite-probe.svg' (the title of an
//                               imported SVG), and an image kept after the JSON (format version 4,
//                               "blob"), so the JSON is not the whole file
// probe.svg                     the same drawing as SVG, MARKER as the id of its rectangle
//
// The native layout follows crates/format/src/lib.rs of VectorCraft 0.8.0 (format doc at the top,
// BLOB_MAGIC, split_tail, load_file).

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, gzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-7f3a';
// What separates the JSON of a version 4 file from the data after it.
const BLOB_MAGIC = Buffer.from('\n\0VCBLOBS\0', 'latin1');

const fill = (r, g, b) => ({ items: [{ kind: 'fill', paint: { type: 'solid', color: { model: 'rgb', r, g, b } } }] });
const k = 0.5522847498 * 30; // circle of radius 30 from four cubic segments

function drawing(title) {
  return {
    version: 1,
    title,
    units: 'Pixels',
    color_mode: 'Rgb',
    artboards: [{ id: 1, name: MARKER, rect: { x0: 0, y0: 0, x1: 200, y1: 120 }, show_center_mark: false, show_cross_hairs: false }],
    layers: [{
      id: 1,
      name: 'Layer 1',
      kind: {
        type: 'layer',
        color: { Preset: 0 },
        template: false,
        printable: true,
        children: [
          {
            id: 2,
            name: 'box',
            appearance: fill(0.9098039, 0.34117648, 0.24705882),
            kind: { type: 'path', path: { subpaths: [{ anchors: [{ p: [20, 20] }, { p: [100, 20] }, { p: [100, 80] }, { p: [20, 80] }], closed: true }] } },
          },
          {
            id: 3,
            name: 'dot',
            appearance: fill(0.12156863, 0.23137255, 0.34117648),
            kind: {
              type: 'path',
              path: {
                subpaths: [{
                  anchors: [
                    { p: [180, 60], in: [180, 60 - k], out: [180, 60 + k], kind: 'Smooth' },
                    { p: [150, 90], in: [150 + k, 90], out: [150 - k, 90], kind: 'Smooth' },
                    { p: [120, 60], in: [120, 60 + k], out: [120, 60 - k], kind: 'Smooth' },
                    { p: [150, 30], in: [150 - k, 30], out: [150 + k, 30], kind: 'Smooth' },
                  ],
                  closed: true,
                }],
              },
            },
          },
        ],
      },
    }],
    next_id: 4,
  };
}

const native = (title, images = {}) => JSON.stringify({
  format: 'vectorcraft',
  version: 4,
  generator: 'craftsuite-layer test fixture',
  document: drawing(title),
  images,
}, null, 2);

// A small RGB PNG (a gradient), for the data after the JSON.
function png(w, h) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw.set([x * 4, y * 6, 128], y * (w * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function renamed() {
  const image = png(64, 40);
  const json = native('craftsuite-probe.svg', { probe: { mime: 'image/png', blob: [0, image.length] } });
  const gz = gzipSync(Buffer.concat([Buffer.from(json, 'utf8'), BLOB_MAGIC, image]));
  gz[9] = 0xff; // OS unknown: the same bytes on every platform
  return gz;
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect id="${MARKER}" x="20" y="20" width="80" height="60" fill="#e8573f"/>
  <circle id="dot" cx="150" cy="60" r="30" fill="#1f3b57"/>
</svg>
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(here, 'craftsuite-probe.vectorcraft'), native('craftsuite-probe.vectorcraft') + '\n');
  writeFileSync(path.join(here, 'renamed-probe.vectorcraft'), renamed());
  writeFileSync(path.join(here, 'probe.svg'), svg);
  console.log('fixtures written');
}
