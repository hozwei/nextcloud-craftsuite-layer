// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Downloads the Craft web builds the tests run against, verifies them and unpacks them to
// <out>/<app>/<version>/<app>-web-<version>/. Records the versions in <out>/selected.json.
//
//   node tests/e2e/tools/fetch-craft.mjs                     tested versions (craft-versions.json)
//   node tests/e2e/tools/fetch-craft.mjs --latest            newest release of each app
//   node tests/e2e/tools/fetch-craft.mjs --app pdfcraft --version 0.5.0
//                                                            one app; the others keep their entry
//   options: --out <dir> (default .craft-builds)
//
// Uses github.com release URLs only (no API calls, so no API rate limit). The zip must match its
// line in the release's SHA256SUMS.txt and may only contain <app>-web-<version>/.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const manifest = JSON.parse(readFileSync(path.join(here, '..', 'craft-versions.json'), 'utf8'));

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const out = path.resolve(repo, opt('--out') || process.env.CRAFT_BUILDS_DIR || '.craft-builds');
const latest = args.includes('--latest');
const onlyApp = opt('--app');
const fixedVersion = opt('--version');

const VERSION = /^\d+\.\d+\.\d+$/;

async function get(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < 4) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`, { cause: err });
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    }
  }
}

async function latestVersion(repoName) {
  // github.com/<repo>/releases/latest redirects to .../releases/tag/v<version>.
  const res = await get(`https://github.com/${repoName}/releases/latest`, { redirect: 'manual' });
  const tag = (res.headers.get('location') || '').split('/tag/')[1];
  const version = tag && decodeURIComponent(tag).replace(/^v/, '');
  if (!version || !VERSION.test(version)) throw new Error(`${repoName}: no release found (${res.status})`);
  return version;
}

async function fetchBuild(app, repoName, version) {
  const dir = path.join(out, app, version);
  const stamp = path.join(dir, '.verified');
  if (existsSync(stamp)) return JSON.parse(readFileSync(stamp, 'utf8'));
  const release = `https://github.com/${repoName}/releases/download/v${version}`;
  const zipName = `${app}-web-${version}.zip`;
  const sums = await get(`${release}/SHA256SUMS.txt`);
  if (!sums.ok) throw new Error(`${app} ${version}: SHA256SUMS.txt HTTP ${sums.status}`);
  const line = (await sums.text()).split('\n').find((l) => l.trim().endsWith(' ' + zipName) || l.trim().endsWith('*' + zipName));
  const expected = line && line.trim().split(/\s+/)[0].toLowerCase();
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Error(`${app} ${version}: ${zipName} not in SHA256SUMS.txt`);
  const res = await get(`${release}/${zipName}`);
  if (!res.ok) throw new Error(`${app} ${version}: ${zipName} HTTP ${res.status}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const actual = createHash('sha256').update(zip).digest('hex');
  if (actual !== expected) throw new Error(`${app} ${version}: checksum mismatch (${actual} != ${expected})`);
  const prefix = `${app}-web-${version}/`;
  const files = unzipSync(zip);
  for (const [name, data] of Object.entries(files)) {
    const clean = path.posix.normalize(name);
    if (!clean.startsWith(prefix) || clean.includes('..') || path.posix.isAbsolute(clean)) {
      throw new Error(`${app} ${version}: unexpected entry ${name}`);
    }
    if (name.endsWith('/')) continue;
    const file = path.join(dir, ...clean.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  if (!existsSync(path.join(dir, prefix, 'index.html'))) throw new Error(`${app} ${version}: no index.html in the build`);
  const record = { app, version, zip: zipName, sha256: actual };
  writeFileSync(stamp, JSON.stringify(record, null, 2));
  return record;
}

if (onlyApp && !Object.hasOwn(manifest.apps, onlyApp)) {
  throw new Error(`--app ${onlyApp}: not in craft-versions.json (${Object.keys(manifest.apps).join(', ')})`);
}
// With --app, the other apps keep their entries: the test server serves what this file lists.
const selectedFile = path.join(out, 'selected.json');
let selected = {};
if (onlyApp && existsSync(selectedFile)) {
  try {
    const found = JSON.parse(readFileSync(selectedFile, 'utf8'));
    if (found && typeof found === 'object' && !Array.isArray(found)) selected = found;
  } catch { /* unreadable: start afresh */ }
}
for (const [app, entry] of Object.entries(manifest.apps)) {
  if (onlyApp && app !== onlyApp) continue;
  const version = fixedVersion || (latest ? await latestVersion(entry.repo) : entry.tested);
  if (!VERSION.test(version)) throw new Error(`${app}: bad version ${version}`);
  const record = await fetchBuild(app, entry.repo, version);
  selected[app] = version;
  console.log(`${app} ${version} ${record.sha256}${version === entry.tested ? '' : ` (tested: ${entry.tested})`}`);
}
mkdirSync(out, { recursive: true });
// Replaced in one step: a running test server reads the file on every request.
const tmp = `${selectedFile}.${process.pid}.tmp`;
writeFileSync(tmp, JSON.stringify(selected, null, 2) + '\n');
renameSync(tmp, selectedFile);
