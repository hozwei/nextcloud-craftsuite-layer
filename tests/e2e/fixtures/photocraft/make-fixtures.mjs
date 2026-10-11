// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the PhotoCraft fixtures, without any image library. They are committed; run this only to
// change them:
//   node tests/e2e/fixtures/photocraft/make-fixtures.mjs
//
// probe.psd             64x48, a minimal flat PSD (version 1, RGB, 8 bit, no layers, raw
//                       composite): red rises from left to right, green from top to bottom, blue 64
// probe.png             the same picture as an 8-bit RGB PNG
// elsewhere/probe.psd   a different PSD (40x40 checkerboard) with the same name: the file a user
//                       brings in from their own disk (File > Open)
//
// No ICC profiles, so PhotoCraft opens them without its profile-mismatch prompt.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));

// The probe picture: [r, g, b] at (x, y).
const PROBE = { width: 64, height: 48, pixel: (x, y) => [(x * 255 / 63) | 0, (y * 255 / 47) | 0, 64] };
const CHECKER = { width: 40, height: 40, pixel: (x, y) => (((x >> 3) + (y >> 3)) & 1 ? [250, 220, 40] : [30, 30, 30]) };

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

// Header, empty color mode data, image resources and layer and mask sections, then the composite
// uncompressed, one plane per channel.
function psd({ width, height, pixel }) {
  const header = Buffer.concat([Buffer.from('8BPS', 'latin1'), u16(1), Buffer.alloc(6), u16(3), u32(height), u32(width), u16(8), u16(3)]);
  const planes = [0, 1, 2].map((c) => {
    const plane = Buffer.alloc(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) plane[y * width + x] = pixel(x, y)[c];
    return plane;
  });
  return Buffer.concat([header, u32(0), u32(0), u32(0), u16(0), ...planes]);
}

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
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
};

function png({ width, height, pixel }) {
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])]); // 8 bit, RGB
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height); // filter byte 0 (none) on every row
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) Buffer.from(pixel(x, y)).copy(raw, y * stride + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(here, 'probe.psd'), psd(PROBE));
  writeFileSync(path.join(here, 'probe.png'), png(PROBE));
  mkdirSync(path.join(here, 'elsewhere'), { recursive: true });
  writeFileSync(path.join(here, 'elsewhere', 'probe.psd'), psd(CHECKER));
  console.log('fixtures written');
}
