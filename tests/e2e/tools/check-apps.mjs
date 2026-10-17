// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Checks apps.json, the one list of the Craft apps, and everything that must follow it:
//
//   - its own fields (docs/hosting.md#the-app-list),
//   - the Nextcloud app: CraftApps::APPS has the same apps, names and order, and MimeIcons and
//     NewFiles name no other app,
//   - per app an adapter (translators/<app>.js registering that id), a spec
//     (tests/e2e/specs/<app>.spec.ts, the canary tests apps by it) and a page (docs/apps/<app>.md),
//     and its name wherever all apps are listed,
//   - the NON_BLOCKING lists of ci.yml and canary.yml: the same in both, Playwright projects only.
//
//   node tests/e2e/tools/check-apps.mjs        (npm run apps:check; PHP from $PHP, else php)
//
// Needs PHP 8.2 or later for the constants of the Nextcloud app: it loads their files with stand-ins
// for Nextcloud's interfaces, without a Nextcloud.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => readFileSync(path.join(repo, file), 'utf8');
const errors = [];
const fail = (message) => errors.push(message);

// --- apps.json ------------------------------------------------------------------------------
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const compare = (a, b) => {
  const [x, y] = [VERSION.exec(a), VERSION.exec(b)];
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
  return 0;
};
const FIELDS = ['name', 'repo', 'description', 'color', 'startupTimeout', 'minVersion', 'tested'];
const list = JSON.parse(read('apps.json'));
if (list.format !== 1) fail(`apps.json: format ${JSON.stringify(list.format)}, expected 1`);
for (const key of Object.keys(list)) if (!['$comment', 'format', 'apps'].includes(key)) fail(`apps.json: unknown field ${key}`);
const apps = Object.entries(list.apps ?? {});
if (!apps.length) fail('apps.json: no apps');
const text = (value) => typeof value === 'string' && value.trim() === value && value !== '' && !/[<>&"\n]/.test(value);
for (const [id, app] of apps) {
  const where = `apps.json: ${id}`;
  if (!/^[a-z][a-z0-9]*$/.test(id)) fail(`${where}: the id must match ^[a-z][a-z0-9]*$`);
  for (const key of Object.keys(app)) if (!FIELDS.includes(key)) fail(`${where}: unknown field ${key}`);
  if (!text(app.name)) fail(`${where}: name must be a plain text`);
  if (typeof app.repo !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(app.repo)) fail(`${where}: repo must be owner/name`);
  if (!app.description || Object.keys(app.description).join() !== 'en,de' || !text(app.description.en) || !text(app.description.de)) {
    fail(`${where}: description must have the plain texts en and de, in that order`);
  }
  if (typeof app.color !== 'string' || !/^#[0-9a-f]{6}$/.test(app.color)) fail(`${where}: color must match ^#[0-9a-f]{6}$`);
  if ('startupTimeout' in app && !(Number.isInteger(app.startupTimeout) && app.startupTimeout >= 1 && app.startupTimeout <= 2147483647)) {
    fail(`${where}: startupTimeout must be a whole number from 1 to 2147483647`);
  }
  if (!VERSION.test(app.minVersion ?? '') || !VERSION.test(app.tested ?? '')) fail(`${where}: minVersion and tested must be versions like 1.2.3`);
  else if (compare(app.minVersion, app.tested) > 0) fail(`${where}: minVersion ${app.minVersion} is above tested ${app.tested}`);
}
const ids = apps.map(([id]) => id);

// --- The Nextcloud app ----------------------------------------------------------------------
// The constants, read by PHP itself: stand-ins for the OCP and PSR interfaces let the files load.
const php = String.raw`
spl_autoload_register(function (string $class): void {
  if (preg_match('/^(OCP|Psr)\\\\(.+)\\\\(\w+)$/', $class, $m) === 1) {
    eval('namespace ' . $m[1] . '\\' . $m[2] . '; interface ' . $m[3] . ' {}');
  }
});
$dir = $argv[1] . '/craftsuite_layer/lib/Service/';
foreach (['CraftApps', 'MimeIcons', 'NewFiles'] as $file) require $dir . $file . '.php';
use OCA\CraftsuiteLayer\Service\{CraftApps, MimeIcons, NewFiles};
echo json_encode([
  'apps' => array_map(fn (array $a) => $a['name'], CraftApps::APPS),
  'order' => array_keys(CraftApps::APPS),
  'icons' => MimeIcons::ICONS,
  'iconFiles' => MimeIcons::FILES,
  'newFiles' => array_keys(NewFiles::FORMATS),
  'paper' => NewFiles::PAPER,
]);
`;
let nc = null;
try {
  nc = JSON.parse(execFileSync(process.env.PHP || 'php', ['-r', php, repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (err) {
  fail(`could not read the Nextcloud app's constants with PHP (set $PHP): ${String(err.stderr || err.message).trim().split('\n')[0]}`);
}
if (nc) {
  if (nc.order.join() !== ids.join()) {
    fail(`CraftApps::APPS has ${nc.order.join(', ')}; apps.json has ${ids.join(', ')} (the same apps in the same order)`);
  }
  for (const [id, app] of apps) {
    if (nc.apps[id] !== undefined && nc.apps[id] !== app.name) fail(`CraftApps::APPS names ${id} '${nc.apps[id]}', apps.json '${app.name}'`);
  }
  const known = (where, values) => { for (const v of values) if (!ids.includes(v)) fail(`${where} names ${v}, which apps.json does not list`); };
  for (const [mime, owners] of Object.entries(nc.icons)) known(`MimeIcons::ICONS (${mime})`, owners);
  known('MimeIcons::FILES', Object.keys(nc.iconFiles));
  for (const file of Object.values(nc.iconFiles)) {
    if (!existsSync(path.join(repo, 'craftsuite_layer/img/types', file))) fail(`MimeIcons::FILES: img/types/${file} is missing`);
  }
  known('NewFiles::FORMATS', nc.newFiles);
  known('NewFiles::PAPER', nc.paper);
}

// --- Per app: adapter, spec, page, and its name where all apps are listed ------------------
for (const [id, app] of apps) {
  const adapter = `translators/${id}.js`;
  if (!existsSync(path.join(repo, adapter))) fail(`${adapter} is missing`);
  else if (!new RegExp(`\\bapp: '${id}'`).test(read(adapter))) fail(`${adapter} does not register app: '${id}'`);
  for (const file of [`tests/e2e/specs/${id}.spec.ts`, `docs/apps/${id}.md`]) {
    if (!existsSync(path.join(repo, file))) fail(`${file} is missing`);
  }
  for (const [file, mention] of [
    ['README.md', app.name], ['docs/architecture.md', app.name], ['docs/nextcloud-app.md', app.name],
    ['craftsuite_layer/appinfo/info.xml', app.name], ['docs/README.md', `apps/${id}.md`], ['translators/README.md', `\`${id}.js\``],
  ]) {
    if (!read(file).includes(mention)) fail(`${file} does not mention ${mention}`);
  }
}

// --- NON_BLOCKING in both workflows ---------------------------------------------------------
const nonBlocking = (file) => {
  const lines = [...read(file).matchAll(/^\s*NON_BLOCKING: *(.*)$/gm)].map((m) => m[1].trim());
  if (lines.length !== 1) fail(`${file}: expected one NON_BLOCKING line, found ${lines.length}`);
  return (lines[0] ?? '').split(/\s+/).filter(Boolean);
};
const ci = nonBlocking('.github/workflows/ci.yml');
const canary = nonBlocking('.github/workflows/canary.yml');
if ([...ci].sort().join() !== [...canary].sort().join()) fail('NON_BLOCKING differs between ci.yml and canary.yml');
for (const name of new Set([...ci, ...canary])) {
  const m = /^([a-z][a-z0-9]*)-(chromium|firefox|webkit)$/.exec(name);
  if (!m || ![...ids, 'translator', 'nextcloud'].includes(m[1])) fail(`NON_BLOCKING names ${name}, which is no Playwright project`);
}

if (errors.length) {
  for (const e of errors) console.error(`apps:check: ${e}`);
  process.exit(1);
}
console.log(`apps:check: ${ids.length} apps (${ids.join(', ')}) consistent`);
