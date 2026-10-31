// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the FigCraft fixture. It is committed; run this only to change it:
//   node tests/e2e/fixtures/figcraft/make-fixtures.mjs
//
// craftsuite-probe.figcraft  a FigCraft file as its web build saves one: a zip with document.json
//                            (deflated), the document as JSON with FigCraft's `format`/`version`
//                            header. The document is named 'craftsuite-probe' (the file's stem)
//                            and has one page, 'Page 1', with one frame named MARKER.
//
// The fields and values are those FigCraft 0.12.1 writes for a frame drawn on a new document
// (crates/format/src/lib.rs, crates/doc/src/lib.rs at v0.12.1), without the thumbnail.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-fg01';

const grey = (v) => ({ r: v, g: v, b: v, a: 1 });
const doc = {
  format: 'figcraft',
  version: 1,
  imageIndex: [],
  name: 'craftsuite-probe',
  pages: [1],
  nodes: {
    1: {
      id: 1, name: 'Page 1', type: 'page', background: grey(0.9607843), flows: [],
      prototype: { device: 'None', background: grey(0.11764706), rotation: 'portrait' },
      guides: [], children: [2], width: 0, height: 0,
    },
    2: {
      id: 2, name: MARKER, type: 'frame', parent: 1, children: [], blend: 'normal', transform: [1, 0, 0, 1, 104, 110],
      width: 200, height: 150,
      fills: [{ type: 'solid', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }, opacity: 1, visible: true, blend: 'normal' }], clip: true,
    },
  },
  next_id: 3,
  styles: [],
  variables: { collections: [], variables: [] },
  current_page: 1,
  document_colors: [],
  comments: [],
};

// A fixed time for the zip entry, so the file only changes with its content.
const mtime = new Date(Date.UTC(2026, 9, 31, 12, 0, 0));
writeFileSync(path.join(here, 'craftsuite-probe.figcraft'),
  zipSync({ 'document.json': [strToU8(JSON.stringify(doc)), { level: 6, mtime }] }));
