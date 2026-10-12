// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test host: stands in for the Nextcloud app page. Frames a Craft app, answers the translator's
// handshake, sends one fixture file and records everything in window.__host for the tests.
//
// The framed URL comes from the server's configuration (config.js), never from this page's URL:
// a real host must take the Craft URL from server-side settings, or a crafted link could make it
// send files to any origin. Query parameters only pick a configured target and test behaviour:
//   target=<app>|stub      which configured app to frame (default pdfcraft)
//   name=<fixture>         file to open, a path under fixtures/ (default craftsuite-probe.pdf);
//                          it is sent under its base name; open=0 opens nothing
//   appfile=1              let the app load the file itself with ?file= (no translator needed)
//   ack=0                  never confirm saves; fail=1 confirm, then report a failed store after
//                          fail-delay ms (default 300); result=0 confirm, but never report a result
//   app-<knob>=<value>     translator config for the test server (ack, result, startup, drop,
//                          allowed, version, adapter; see server/serve.mjs), and the stub's and
//                          the test adapter's parameters (see stub-app/)
//   lang=<tag>             frame the app with this language in the fragment, as the Nextcloud
//                          editor page does ('#craftsuite-layer:lang=<tag>'; an empty lang= sends
//                          an empty one)
'use strict';

const PROTOCOL = 'craftsuite-layer';
const params = new URLSearchParams(location.search);
const { targets, appOrigin } = window.CRAFTSUITE_TEST;
const target = params.get('target') || 'pdfcraft';
if (!Object.hasOwn(targets, target)) throw new Error('unknown target ' + target);
const appUrl = new URL(targets[target]);
if (params.get('appfile') === '1') appUrl.search = '?file=/files/craftsuite-probe.pdf';
// Test knobs for the injected translator config (app-ack, app-drop, app-version, ...), passed to
// the test server's index request; see server/serve.mjs.
for (const [key, value] of params) if (key.startsWith('app-')) appUrl.searchParams.set(key.slice(4), value);
if (params.has('lang')) appUrl.hash = 'craftsuite-layer:lang=' + encodeURIComponent(params.get('lang'));
const filePath = (params.get('name') || 'craftsuite-probe.pdf').replace(/[^\w ./-]/g, '').replace(/\.\.+/g, '.');
const fileName = filePath.split('/').pop();
// The type the editor page sends: Nextcloud's MIME type for the file, '' for those it does not know.
const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', psd: 'image/vnd.adobe.photoshop', svg: 'image/svg+xml', ai: 'application/illustrator',
};
const mime = MIME[fileName.split('.').pop().toLowerCase()] || '';
const iframe = document.getElementById('app');

const host = (window.__host = { state: 'starting', events: [], messages: [], saves: [], started: [], errors: [], opened: null, readies: [] });
document.getElementById('origin').textContent = location.origin;

function log(text) {
  const line = `${new Date().toISOString().slice(11, 23)} ${text}`;
  host.events.push(line);
  const el = document.getElementById('log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}

function setState(state) {
  host.state = state;
  document.getElementById('state').textContent = state;
}

function post(msg, transfer) {
  iframe.contentWindow.postMessage({ protocol: PROTOCOL, version: 1, ...msg }, appOrigin, transfer || []);
}

async function sha256(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Answer every hello: a hello after ready means the frame was reloaded and needs a new handshake.
// The translator ignores an init once it is connected.
function sendInit(reason) {
  log(`init (${reason})`);
  post({ type: 'init' });
  if (host.state === 'starting') setState('handshake');
}

// Read while the app loads, like the editor page, so that 'open' follows 'ready' at once.
const fileData = params.get('open') === '0' || params.get('appfile') === '1' ? null
  : fetch('/files/' + filePath.split('/').map(encodeURIComponent).join('/')).then((res) => {
    if (!res.ok) throw new Error(`fixture ${filePath}: HTTP ${res.status}`);
    return res.arrayBuffer();
  });
fileData?.catch((err) => log(String(err)));

async function openFile() {
  // A copy per open: posting transfers it, and a reloaded frame gets the file again.
  const data = (await fileData).slice(0);
  host.opened = { id: 1, name: fileName, size: data.byteLength, sha256: await sha256(data) };
  log(`open #1 -> ${fileName} (${data.byteLength} bytes)`);
  post({ type: 'open', id: 1, name: fileName, mime, data }, [data]);
}

window.addEventListener('message', async (event) => {
  if (event.source !== iframe.contentWindow || event.origin !== appOrigin) return;
  const msg = event.data;
  if (!msg || msg.protocol !== PROTOCOL || msg.version !== 1) return;
  host.messages.push({ type: msg.type, app: msg.app, id: msg.id ?? null, kind: msg.kind ?? null });
  switch (msg.type) {
    case 'hello':
      log(`hello from ${msg.app} (layer ${msg.layerVersion})`);
      sendInit('hello');
      break;
    case 'ready':
      log(`ready (app ${msg.appVersion}, layer ${msg.layerVersion}, language ${msg.language})`);
      host.readies.push({ layerVersion: msg.layerVersion, language: msg.language === undefined ? 'absent' : msg.language });
      setState('ready');
      if (params.get('open') !== '0' && params.get('appfile') !== '1') await openFile();
      break;
    case 'delivered':
      log(`delivered #${msg.id} ${msg.name} (${msg.size} bytes)`);
      setState('delivered');
      break;
    case 'save': {
      if (params.get('ack') === '0') {
        log(`save #${msg.id} <- ${msg.name}: not confirmed (test: host silent)`);
        host.saves.push({ id: msg.id, kind: msg.kind, name: msg.name, unconfirmed: true });
        break;
      }
      post({ type: 'save-received', id: msg.id });
      const entry = { id: msg.id, kind: msg.kind, openId: msg.openId, follows: msg.follows ?? null, name: msg.name, size: msg.size,
        sha256: await sha256(msg.data), base64: toBase64(msg.data) };
      host.saves.push(entry);
      log(`save #${msg.id} <- ${msg.kind} ${msg.name} (open #${msg.openId}, ${msg.size} bytes, sha256 ${entry.sha256.slice(0, 12)}…)`);
      setState(`saved ${host.saves.length}x`);
      if (params.get('result') === '0') {
        log(`save #${msg.id}: no result (test)`);
      } else if (params.get('fail') === '1') {
        const delay = Number(params.get('fail-delay') ?? 300);
        setTimeout(() => post({ type: 'save-result', id: msg.id, ok: false, error: 'test: 507 Insufficient Storage' }), delay);
      } else {
        post({ type: 'save-result', id: msg.id, ok: true });
      }
      break;
    }
    case 'save-started':
      host.started.push({ id: msg.id, name: msg.name });
      log(`save-started #${msg.id} ${msg.name}`);
      break;
    case 'error':
      host.errors.push({ of: msg.of, id: msg.id ?? null, message: msg.message });
      log(`error in ${msg.of} #${msg.id ?? '-'}: ${msg.message}`);
      break;
    default:
      log(`unknown message ${msg.type}`);
  }
});

// The translator also accepts an init that was not asked for (e.g. if its hello came too early).
iframe.addEventListener('load', () => sendInit('iframe load'));
iframe.src = appUrl.href;
log(`iframe -> ${appUrl.href}`);
