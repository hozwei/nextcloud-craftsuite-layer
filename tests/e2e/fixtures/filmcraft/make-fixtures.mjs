// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the FilmCraft fixtures that are derived from FilmCraft's own files. They are committed;
// run this only to change them:
//   node tests/e2e/fixtures/filmcraft/make-fixtures.mjs
//
// Made by FilmCraft 0.6.0 and kept as it wrote them (see docs/apps/filmcraft.md):
//   FilmCraft Demo.fcproj    Ctrl+S of the demo project FilmCraft opens at start (schema 15)
//   Main Edit.edl            File > Export > EDL… of the same project (its sequence 'Main Edit')
// Written here:
//   craftsuite-probe.fcproj  the demo project with the stored name 'Probe Title' (another name
//                            than the file's) and MARKER as its project notes
//   old-schema.fcproj        the demo project in schema 14, stored name 'Old Schema': the step
//                            to schema 15 only added the project notes (crates/format/src/lib.rs),
//                            which the demo has none of, so only schema_version changes

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-fc01';

const demo = JSON.parse(readFileSync(path.join(here, 'FilmCraft Demo.fcproj'), 'utf8'));
if (demo.schema_version !== 15 || demo.project.name !== 'FilmCraft Demo') throw new Error('not FilmCraft 0.6.0\'s demo save');

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
old.schema_version = 14;
writeFileSync(path.join(here, 'old-schema.fcproj'), JSON.stringify(old));

console.log('fixtures written to', here);
