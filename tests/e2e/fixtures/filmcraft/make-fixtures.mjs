// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the FilmCraft fixtures that are derived from FilmCraft's own files. They are committed;
// run this only to change them:
//   node tests/e2e/fixtures/filmcraft/make-fixtures.mjs
//
// Made by FilmCraft and kept as it wrote them (see docs/apps/filmcraft.md):
//   FilmCraft Demo.fcproj    Ctrl+S of the demo project FilmCraft opens at start, by 0.16.0
//                            (schema 17; the first Save of 0.6.0's schema 15 file)
//   Main Edit.edl            File > Export > EDL… of the same project by 0.6.0 (its sequence
//                            'Main Edit')
// Written here:
//   craftsuite-probe.fcproj  the demo project with the stored name 'Probe Title' (another name
//                            than the file's) and MARKER as its project notes
//   old-schema.fcproj        the demo project in schema 15 as FilmCraft 0.6.0 wrote it, stored
//                            name 'Old Schema': 0.16.0's save of 0.6.0's file differs only in
//                            schema_version, generator and next_id (48 then)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-fc01';

const demo = JSON.parse(readFileSync(path.join(here, 'FilmCraft Demo.fcproj'), 'utf8'));
if (demo.schema_version !== 17 || demo.project.name !== 'FilmCraft Demo') throw new Error('not FilmCraft 0.16.0\'s demo save');

// A copy with another stored name: FilmCraft keeps the project name in the project and in the
// name of its root bin (engine/src/commands.rs name_project).
const renamed = (name) => {
  const doc = structuredClone(demo);
  doc.project.name = name;
  doc.project.root.name = name;
  return doc;
};

const probe = renamed('Probe Title');
probe.project.notes = MARKER;
// Compact JSON, as FilmCraft writes it (crates/format/src/lib.rs encode_with_view).
writeFileSync(path.join(here, 'craftsuite-probe.fcproj'), JSON.stringify(probe));

const old = renamed('Old Schema');
old.schema_version = 15;
old.generator = 'FilmCraft 0.6.0';
old.project.next_id = 48;
writeFileSync(path.join(here, 'old-schema.fcproj'), JSON.stringify(old));

console.log('fixtures written to', here);
