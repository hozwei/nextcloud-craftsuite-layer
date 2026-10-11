// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Builds the app's front end: src/<entry>.ts -> js/<entry>.mjs, one self-contained ES module per
// entry (Nextcloud loads .mjs as <script type="module">). Type checking is tsc's job
// (npm run typecheck); esbuild only strips types and bundles.
//
// Next to each bundle, js/<entry>.mjs.license lists the bundled npm packages with version,
// license and authors, in the REUSE format Nextcloud's own bundles use.
//
//   node build.mjs           production build (minified)
//   node build.mjs --dev     readable output with inline source maps

import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');
const entries = ['editor', 'files', 'admin'];

rmSync(path.join(here, 'js'), { recursive: true, force: true });
const result = await build({
  absWorkingDir: here,
  entryPoints: Object.fromEntries(entries.map((e) => [e, `src/${e}.ts`])),
  outdir: 'js',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  // What Nextcloud 34 and 35 support (@nextcloud/browserslist-config: current browsers).
  target: ['es2022', 'chrome111', 'firefox115', 'safari16.4'],
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  charset: 'utf8',
  metafile: true,
  logLevel: 'info',
});

// Package name -> package.json of every npm package that went into each bundle.
function packageOf(input) {
  const parts = input.split('/');
  const at = parts.lastIndexOf('node_modules');
  if (at < 0) return null;
  const name = parts[at + 1].startsWith('@') ? `${parts[at + 1]}/${parts[at + 2]}` : parts[at + 1];
  const dir = parts.slice(0, at + 1 + name.split('/').length).join('/');
  return { name, json: JSON.parse(readFileSync(path.join(here, dir, 'package.json'), 'utf8')) };
}
const authorOf = (a) => (typeof a === 'string' ? a : a?.name ? [a.name, a.email && `<${a.email}>`].filter(Boolean).join(' ') : null);

for (const [out, meta] of Object.entries(result.metafile.outputs)) {
  if (!out.endsWith('.mjs')) continue;
  const packages = new Map();
  for (const input of Object.keys(meta.inputs)) {
    const pkg = packageOf(input);
    if (pkg) packages.set(pkg.name, pkg.json);
  }
  const own = '2026 The nextcloud-craftsuite-layer contributors';
  const licenses = new Set(['AGPL-3.0-or-later']);
  const authors = new Set();
  const list = [];
  for (const [name, json] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const license = json.license ?? 'UNKNOWN';
    licenses.add(license);
    authors.add(authorOf(json.author) ?? `${name} developers`);
    list.push(`- ${name}`, `\t- version: ${json.version}`, `\t- license: ${license}`);
  }
  if ([...licenses].includes('UNKNOWN')) throw new Error(`${out}: a bundled package declares no license`);
  const text = [
    ...[...licenses].sort().map((l) => `SPDX-License-Identifier: ${l}`),
    `SPDX-FileCopyrightText: ${own}`,
    ...[...authors].sort().map((a) => `SPDX-FileCopyrightText: ${a}`),
    '',
    packages.size ? 'This file is generated from multiple sources. Included packages:' : 'This file is generated from the sources in src/.',
    ...list,
    '',
  ].join('\n');
  writeFileSync(path.join(here, `${out}.license`), text);
  console.log(`${out}: ${(meta.bytes / 1024).toFixed(1)} KiB, ${packages.size} packages`);
}
