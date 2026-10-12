// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the LightCraft fixtures. They are committed; run this only to change them (the JPEG needs
// Playwright's Chromium, `npx playwright install chromium`):
//   node tests/e2e/fixtures/lightcraft/make-fixtures.mjs
//
// probe-photo.jpg           120x80, a small landscape (sky, sun, ground, a dark house), encoded by
//                           Chromium's canvas (quality 0.9): the photo the tests open
// probe-scan.tif            90x60 baseline TIFF (RGB, 8 bit, uncompressed, one strip): a scan from
//                           another program
// elsewhere/probe-scan.tif  a different TIFF (64x64 checkerboard) under the same name: the file a
//                           user brings in from their own disk (File > Import Photos...)
// probe-raw.dng             96x64 DNG 1.4: an uncompressed 16-bit RGGB mosaic in IFD 0 with the
//                           colour tags a raw developer needs (black and white level, a colour
//                           matrix for linear sRGB primaries, AsShotNeutral), no preview
//
// The pictures differ in size and shape, so a test can tell from an export's size which photo it
// shows, and from swapped width and height that a rotation was applied.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));

// [r, g, b] in 0..255 at (x, y).
const PHOTO = {
  width: 120, height: 80, pixel(x, y) {
    if ((x - 88) ** 2 + (y - 20) ** 2 <= 100) return [255, 236, 150]; // sun
    if (x >= 26 && x < 52 && y >= 38 && y < 64) return [52, 36, 30]; // house
    if (y < 48) return [70 + y * 2, 120 + y * 2, 220]; // sky
    return [40 + (x >> 2), 130 - (y - 48), 50]; // ground
  },
};
const ELSEWHERE = { width: 64, height: 64, pixel: (x, y) => (((x >> 3) + (y >> 3)) & 1 ? [240, 150, 30] : [25, 25, 60]) };
const SCAN = {
  width: 90, height: 60, pixel(x, y) {
    if (x >= 66 && x < 82 && y >= 6 && y < 22) return [200, 30, 30]; // stamp
    if (x >= 8 && x < 60 && y >= 10 && y % 8 < 3) return [30, 30, 30]; // lines of text
    return [245, 242, 232]; // paper
  },
};
const RAW = {
  width: 96, height: 64, pixel(x, y) {
    if (x >= 60 && x < 84 && y >= 14 && y < 38) return [250, 250, 250];
    return [40 + x * 2, 30 + y * 3, 90];
  },
};

// A JPEG from Chromium's canvas encoder: Node has none. The callback of page.evaluate runs in the
// browser.
/* global document, ImageData */
async function jpeg({ width, height, pixel }) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const rgba = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.push(...pixel(x, y), 255);
    const bytes = await page.evaluate(async ({ width, height, rgba }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      return [...new Uint8Array(await blob.arrayBuffer())];
    }, { width, height, rgba });
    return Buffer.from(bytes);
  } finally {
    await browser.close();
  }
}

// A little-endian TIFF with one IFD. entries: [tag, type, values]; types 1 BYTE, 2 ASCII,
// 3 SHORT, 4 LONG, 5 RATIONAL, 10 SRATIONAL (rationals as [numerator, denominator] pairs). The
// image data follows the IFD; StripOffsets (273) is filled in.
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };
function tiff(entries, data) {
  entries = [...entries].sort((a, b) => a[0] - b[0]);
  const ifdSize = 2 + entries.length * 12 + 4;
  const encoded = entries.map(([tag, type, values]) => {
    const list = type === 2 ? [...Buffer.from(values + '\0', 'latin1')] : values;
    const buf = Buffer.alloc(list.length * SIZES[type]);
    list.forEach((v, i) => {
      const at = i * SIZES[type];
      if (type === 1 || type === 2) buf.writeUInt8(v, at);
      else if (type === 3) buf.writeUInt16LE(v, at);
      else if (type === 4) buf.writeUInt32LE(v, at);
      else if (type === 5) { buf.writeUInt32LE(v[0], at); buf.writeUInt32LE(v[1], at + 4); }
      else { buf.writeInt32LE(v[0], at); buf.writeInt32LE(v[1], at + 4); }
    });
    return { tag, type, count: list.length, buf };
  });
  // Values longer than 4 bytes go after the IFD, then the image data.
  let at = 8 + ifdSize;
  const extra = [];
  for (const e of encoded) {
    if (e.buf.length > 4) {
      e.offset = at;
      extra.push(e.buf);
      at += e.buf.length + (e.buf.length & 1);
      if (e.buf.length & 1) extra.push(Buffer.alloc(1));
    }
  }
  const dataOffset = at;
  const head = Buffer.alloc(8 + ifdSize);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  head.writeUInt16LE(encoded.length, 8);
  encoded.forEach((e, k) => {
    const o = 10 + k * 12;
    head.writeUInt16LE(e.tag, o);
    head.writeUInt16LE(e.type, o + 2);
    head.writeUInt32LE(e.count, o + 4);
    if (e.tag === 273) head.writeUInt32LE(dataOffset, o + 8);
    else if (e.buf.length > 4) head.writeUInt32LE(e.offset, o + 8);
    else e.buf.copy(head, o + 8);
  });
  return Buffer.concat([head, ...extra, data]);
}

function rgbTiff({ width, height, pixel }) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.set(pixel(x, y), (y * width + x) * 3);
  return tiff([
    [256, 3, [width]], [257, 3, [height]], [258, 3, [8, 8, 8]], [259, 3, [1]], [262, 3, [2]], [273, 4, [0]],
    [277, 3, [3]], [278, 3, [height]], [279, 4, [rgb.length]], [284, 3, [1]],
  ], rgb);
}

// The mosaic of a picture seen through an RGGB filter, linear, between the black and white level.
function rawDng({ width, height, pixel }) {
  const black = 256;
  const white = 16383;
  const data = Buffer.alloc(width * height * 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const channel = (y & 1) + (x & 1); // R G / G B
      const linear = (pixel(x, y)[channel] / 255) ** 2.2;
      data.writeUInt16LE(Math.round(black + linear * (white - black)), (y * width + x) * 2);
    }
  }
  // XYZ (D65) to linear sRGB, as ColorMatrix1: the camera's primaries are sRGB's.
  const matrix = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.2040, 1.0570];
  return tiff([
    [254, 4, [0]], [256, 4, [width]], [257, 4, [height]], [258, 3, [16]], [259, 3, [1]], [262, 3, [32803]],
    [271, 2, 'craftsuite'], [272, 2, 'probe'], [273, 4, [0]], [274, 3, [1]], [277, 3, [1]], [278, 4, [height]],
    [279, 4, [data.length]], [284, 3, [1]], [33421, 3, [2, 2]], [33422, 1, [0, 1, 1, 2]],
    [50706, 1, [1, 4, 0, 0]], [50707, 1, [1, 1, 0, 0]], [50708, 2, 'craftsuite probe'],
    [50714, 3, [black]], [50717, 3, [white]], [50721, 10, matrix.map((v) => [Math.round(v * 10000), 10000])],
    [50728, 5, [[1, 1], [1, 1], [1, 1]]], [50778, 3, [21]],
  ], data);
}

mkdirSync(path.join(here, 'elsewhere'), { recursive: true });
const files = {
  'probe-photo.jpg': await jpeg(PHOTO),
  'probe-scan.tif': rgbTiff(SCAN),
  'elsewhere/probe-scan.tif': rgbTiff(ELSEWHERE),
  'probe-raw.dng': rawDng(RAW),
};
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(path.join(here, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
