// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the MaterialCraft fixture. It is committed; run this only to change it:
//   node tests/e2e/fixtures/materialcraft/make-fixtures.mjs
//
// craftsuite-probe.mcraft  a MaterialCraft project as its web build saves one: a zip with
//                          package.sbs (deflated), the package as SBS XML, and an empty
//                          resources/ folder. The package's identifier is 'craftsuite-probe' (the
//                          file's stem); it has one material graph, MARKER, with one Blur node.
//
// The elements and values are those MaterialCraft 0.3.0 writes for a new package and for a Blur
// node of its Atomic sample (crates/formats/src/sbs, crates/formats/src/project.rs at v0.3.0).

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE_PROBE_mc01';

const param = (name, value) =>
  `<parameter><name v="${name}"/><relativeTo v="0"/><paramValue>${value}</paramValue></parameter>`;
const blur =
  '<compNode><uid v="1000000004"/><GUILayout><gpos v="50 40 0"/></GUILayout>' +
  '<compOutputs><compOutput><uid v="1000000005"/><comptype v="2"/></compOutput></compOutputs>' +
  '<compImplementation><compFilter><filter v="blur"/><parameters>' +
  param('intensity', '<constantValueFloat1 v="1.5"/>') +
  '</parameters></compFilter></compImplementation></compNode>';
const sbs =
  '<?xml version="1.0" encoding="UTF-8"?><package><identifier v="craftsuite-probe"/>' +
  '<formatVersion v="1.1.0.202401"/><updaterVersion v="0.3.0"/><fileUID v="0"/><versionUID v="0"/>' +
  '<dependencies><dependency><filename v="?himself"/><uid v="1000000001"/><type v="package"/>' +
  '<fileUID v="0"/><versionUID v="0"/></dependency></dependencies>' +
  `<content><graph><identifier v="${MARKER}"/><uid v="1000000002"/><graphtype v="material"/>` +
  `<attributes></attributes><paraminputs></paraminputs><graphOutputs></graphOutputs><compNodes>${blur}</compNodes>` +
  `<baseParameters>${param('randomseed', '<constantValueInt32 v="0"/>')}</baseParameters><GUIObjects></GUIObjects>` +
  '<options><option><name v="defaultParentSize"/><value v="10x10"/></option></options>' +
  '<root><rootOutputs></rootOutputs></root></graph>' +
  '<group><uid v="1000000003"/><identifier v="Resources"/><content></content></group></content></package>';

// A fixed time for the zip entries, so the file only changes with its content.
const mtime = new Date(Date.UTC(2026, 10, 11, 12, 0, 0));
writeFileSync(path.join(here, 'craftsuite-probe.mcraft'),
  zipSync({ 'resources/': [new Uint8Array(0), { mtime }], 'package.sbs': [strToU8(sbs), { level: 6, mtime }] }));
