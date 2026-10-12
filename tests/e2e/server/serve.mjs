// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test server with three origins, standing in for Nextcloud, the Craft hosting and a foreign site:
//
//   host     http://127.0.0.1:<base>    test host page (stands in for the Nextcloud app page)
//   app      http://127.0.0.2:<base+1>  Craft web builds and the stub app, with the translator
//                                       injected into index.html the way the hosting does it
//   foreign  http://127.0.0.1:<base+2>  the same host page on an origin that is not allowed
//
// Test knobs: query parameters on an app's index.html request tune the injected translator (see
// inject() below): allowed, ack, result, startup, drop, version and adapter.
//
// Environment: CRAFTSUITE_PORT_BASE (default 8701), CRAFT_BUILDS_DIR (default .craft-builds),
// CRAFTSUITE_EXTRA_ALLOWED (more allowed parent origins, e.g. a test Nextcloud).
// The Craft builds come from `npm run craft:fetch`, which records the fetched versions in
// <CRAFT_BUILDS_DIR>/selected.json.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const e2e = path.resolve(here, '..');
const base = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const buildsDir = path.resolve(repo, process.env.CRAFT_BUILDS_DIR || '.craft-builds');

const origins = {
  host: { host: '127.0.0.1', port: base },
  app: { host: '127.0.0.2', port: base + 1 },
  foreign: { host: '127.0.0.1', port: base + 2 },
};
const url = (o) => `http://${o.host}:${o.port}`;
const hostOrigin = url(origins.host);
// Further parents the translator accepts by default, e.g. a test Nextcloud (space-separated).
const extraAllowed = (process.env.CRAFTSUITE_EXTRA_ALLOWED || '').split(/\s+/).filter(Boolean);
const appOrigin = url(origins.app);

// Craft apps served under /<app>/, like a hosting with one path per app. selected.json is read
// on every request, so a running server picks up builds fetched after it started.
const selectedFile = path.join(buildsDir, 'selected.json');
function loadApps() {
  const selected = existsSync(selectedFile) ? JSON.parse(readFileSync(selectedFile, 'utf8')) : {};
  const apps = {};
  for (const [app, version] of Object.entries(selected)) {
    apps[app] = { root: path.join(buildsDir, app, version, `${app}-web-${version}`), adapter: app, version };
  }
  // The stub imitates PdfCraft's browser-facing behaviour without the app (fast, any browser).
  apps.stub = { root: path.join(e2e, 'stub-app'), adapter: 'pdfcraft', version: 'stub' };
  return apps;
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.pdf': 'application/pdf',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

function within(root, rel) {
  try { rel = decodeURIComponent(rel); } catch { return null; }
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

// /files/<name>: a fixture, or with blanks/<name> a blank document of the Nextcloud app's "+ New"
// entries (craftsuite_layer/assets), which the specs open as Files would.
function fixture(rel) {
  return rel.startsWith('blanks/')
    ? within(path.join(repo, 'craftsuite_layer', 'assets'), rel.slice('blanks/'.length))
    : within(path.join(e2e, 'fixtures'), rel);
}

async function sendFile(res, file, transform) {
  try {
    if (!file || !(await stat(file)).isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  let body = await readFile(file);
  if (transform) body = Buffer.from(transform(body.toString('utf8')), 'utf8');
  res.writeHead(200, {
    'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// What the hosting does to each app's index.html: add the translator before anything else runs.
// Query parameters on the index request tune the translator for tests (never in production):
// allowed, ack, result, startup and drop set data-allowed-origins and the data-*-timeout
// attributes; version replaces data-app-version, and an empty version leaves it out; adapter=<name>
// loads the test adapter <name>-adapter.js from the app's own folder instead of the app's adapter
// (the stub app has stub-adapter.js).
function inject(html, app, query) {
  const data = {
    'allowed-origins': query.get('allowed') ?? [hostOrigin, ...extraAllowed].join(' '),
    'app-version': query.has('version') ? query.get('version') || null : app.version,
    'save-ack-timeout': query.get('ack'),
    'save-result-timeout': query.get('result'),
    'startup-timeout': query.get('startup'),
    'drop-target-timeout': query.get('drop'),
  };
  const attrs = Object.entries(data).filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => ` data-${k}="${attr(v)}"`).join('');
  const testAdapter = query.get('adapter');
  const adapter = testAdapter && /^[a-z0-9-]+$/.test(testAdapter) ? `./${testAdapter}-adapter.js` : `./craftsuite-layer/${app.adapter}.js`;
  const tags = `<script src="./craftsuite-layer/core.js"${attrs}></script>` +
    `<script src="${adapter}"></script>`;
  // The first real <head> tag: not one inside a comment, not <header>.
  const masked = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
  const at = masked.search(/<head(\s[^>]*)?>/i);
  if (at < 0) throw new Error('index.html has no <head>');
  const end = masked.indexOf('>', at) + 1;
  return html.slice(0, end) + '\n    ' + tags + html.slice(end);
}

function hostSite(req, res, u) {
  if (u.pathname === '/config.js') {
    const apps = loadApps();
    const targets = Object.fromEntries(Object.keys(apps).map((app) => [app, `${appOrigin}/${app}/`]));
    const versions = Object.fromEntries(Object.entries(apps).map(([app, a]) => [app, a.version]));
    const body = `window.CRAFTSUITE_TEST = ${JSON.stringify({ targets, versions, appOrigin })};\n`;
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }
  if (u.pathname.startsWith('/files/')) return sendFile(res, fixture(u.pathname.slice(7)));
  const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
  return sendFile(res, within(path.join(e2e, 'host'), rel));
}

function appSite(req, res, u) {
  if (u.pathname.startsWith('/files/')) return sendFile(res, fixture(u.pathname.slice(7)));
  const m = u.pathname.match(/^\/([a-z0-9_-]+)\/(.*)$/);
  const apps = loadApps();
  const app = m && Object.hasOwn(apps, m[1]) ? apps[m[1]] : null;
  if (!app) return sendFile(res, null);
  const rest = m[2];
  const layer = rest.match(/^craftsuite-layer\/([a-z0-9_-]+\.js)$/);
  if (layer) return sendFile(res, within(path.join(repo, 'translators'), layer[1]));
  if (rest === '' || rest === 'index.html') {
    return sendFile(res, within(app.root, 'index.html'), (html) => inject(html, app, u.searchParams));
  }
  return sendFile(res, within(app.root, rest));
}

for (const [name, o] of Object.entries(origins)) {
  const site = name === 'app' ? appSite : hostSite;
  createServer((req, res) => {
    const u = new URL(req.url, url(o));
    Promise.resolve(site(req, res, u)).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err));
    });
  }).listen(o.port, o.host, () => console.log(`${name.padEnd(7)} ${url(o)}`));
}
console.log(`apps: ${Object.entries(loadApps()).map(([a, v]) => `${a} ${v.version}`).join(', ')}`);
