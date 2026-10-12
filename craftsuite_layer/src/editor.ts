// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Editor page: frames the Craft app the administrator configured and is the host of the
// translator protocol (docs/protocol.md). The file is read and written through WebDAV as the
// logged-in user, so Nextcloud's permissions, locks, quota and versions apply:
//  - a 'document' save replaces the file that holds the opened document (If-Match): at first the
//    opened file. An app that saves the opened file under another name or type (an opened PNG as
//    PSD, an IDML as .designcraft) gets a new file next to the original on that first save, and
//    later saves replace that file. If the file changed meanwhile (412), its version cannot be
//    checked, or the user may not change it, the save becomes a new file and later saves follow
//    it. Reads and writes run one after the other.
//  - a 'document' that follows an export (PdfCraft's Save after it rewrote the whole file) goes
//    to the file that export became, and so does every later save of that lineage (the same
//    'follows'), on the same terms; saves without 'follows' still go to the opened document's file.
//  - everything else (exports, other documents, an older save of the document that arrives after
//    a newer one) becomes a new file next to the original (If-None-Match: *, with ' (2)', ' (3)',
//    ... while the name is taken in any letter case).
//    Nothing is ever overwritten that the user did not open or this page did not create.
// A save that cannot be stored is reported with ok:false; the translator then downloads it. When
// the page that sent it may be gone (the frame reloaded), the page offers the file itself.

import { t } from './l10n.ts';

const PROTOCOL = 'craftsuite-layer';
const VERSION = 1;
const START_TIMEOUT_MS = 90_000;
// The translator says hello as soon as the app's page has loaded, long before the app itself. No
// hello by then: the frame shows something else, typically a sign-in page of the Craft site.
const HELLO_HINT_MS = 15_000;
// While requests to the server make progress, save-received is repeated at most this often: the
// translator's result timer then runs out only when storing has really stopped.
const KEEP_ALIVE_MS = 60_000;
// A request that gets no answer, or no bytes of it, for this long has stalled.
const STALL_MS = 120_000;
// Once an upload has been sent, the server may take this long to answer (it writes the file, and
// may scan it).
const ANSWER_MS = 300_000;
// A save the translator announced (save-started) and has not sent this long after: given up. The
// translator gives up on reading it after 5 minutes (its default data-save-result-timeout).
const ANNOUNCED_MS = 360_000;
// After ok:false, the translator reports its own download (an 'error' of 'save') at once. If none
// comes in this time, its page is gone and this page offers the file itself.
const FALLBACK_MS = 5_000;
// Nextcloud refuses file names longer than 250 bytes (UTF-8).
const MAX_NAME_BYTES = 250;

interface EditorState {
  app: string;
  appName: string;
  appUrl: string;
  // The language the app is to start in (a BCP 47 tag), or null: the app decides.
  language?: string | null;
  file: { id: number; name: string; mime: string; url: string; updatable: boolean };
  folderUrl: string;
  filesUrl: string;
}

interface Message {
  protocol?: unknown;
  version?: unknown;
  type?: unknown;
  id?: unknown;
  kind?: unknown;
  openId?: unknown;
  follows?: unknown;
  name?: unknown;
  data?: unknown;
  of?: unknown;
  message?: unknown;
}

// A Nextcloud file that holds the opened document.
interface DocFile {
  name: string;
  url: string;
  etag: string | null;
  updatable: boolean;
  // Fallback for the type sent with 'open' when a read reports none.
  mime: string;
}

// One open of the file in the app: the file it was given, and the files its document saves go
// to, by the name the app saves under.
interface Open {
  id: number;
  file: DocFile | null;
  documents: Map<string, DocFile>;
  // The newest save stored as this open's document: an older one must not replace it.
  lastDocId: number;
  // Save notices shown before this open began (see notices).
  notices: number;
}

// An export a later save may continue (follows), by the export's save id: the file its lineage is
// stored in (at first the new file the export became), and the newest save stored there.
interface Lineage {
  file: DocFile;
  lastId: number;
  // Whether a save has continued it yet.
  continued: boolean;
}

// One load of the app's page in the frame. The translator numbers saves anew after a reload, so
// what is known about save ids belongs to the load.
interface Load {
  exports: Map<number, Lineage>;
  // Saves the translator announced (save-started) whose 'save' has not arrived yet, with the
  // timer that gives up on each.
  started: Map<number, { name: string; timer: number }>;
  // Saves reported failed to the page (ok:false) whose download it has not confirmed yet: offered
  // here once FALLBACK_MS have passed or the page has gone.
  failing: Map<number, { timer: number; offer: () => void }>;
  // Saves the translator gave up on and downloaded itself (its 'error' of 'save').
  downloaded: Set<number>;
}

type Stored = { how: 'updated' | 'followed' | 'new' | 'created' | 'readonly' | 'conflict' | 'unchecked'; name: string };

const root = document.querySelector<HTMLElement>('.craftsuite-editor');
const frame = root?.querySelector<HTMLIFrameElement>('.craftsuite-editor__frame');
const statusLine = root?.querySelector<HTMLElement>('.craftsuite-editor__status');
const offerList = root?.querySelector<HTMLElement>('.craftsuite-editor__offers');
const nameLabel = root?.querySelector<HTMLElement>('.craftsuite-editor__name');
const closeLink = root?.querySelector<HTMLAnchorElement>('.craftsuite-editor__close');

// Files' entry adds the session's request token to the address (src/files.ts), which tells the
// server that the user opened the file there. It has done its job: out of the address bar, the
// history and bookmarks. (The page and its frame send no referrer.)
const address = new URL(window.location.href);
if (address.searchParams.has('requesttoken')) {
  address.searchParams.delete('requesttoken');
  window.history.replaceState(window.history.state, '', address.href);
}

function loadState(): EditorState {
  const input = document.querySelector<HTMLInputElement>('#initial-state-craftsuite_layer-editor');
  if (!input) throw new Error('the editor state is missing');
  return JSON.parse(atob(input.value)) as EditorState;
}

// A page to open in a new tab, after the text.
interface StatusLink { href: string; label: string }

function setStatus(state: 'loading' | 'ready' | 'saving' | 'saved' | 'error', text: string, link?: StatusLink): void {
  if (root) root.dataset.state = state;
  if (statusLine) {
    statusLine.textContent = text;
    if (link) {
      const a = document.createElement('a');
      a.href = link.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = link.label;
      statusLine.append(' ', a);
    }
    statusLine.classList.toggle('craftsuite-editor__status--error', state === 'error');
  }
}

// --- WebDAV as the logged-in user. ---------------------------------------------------------------
class StoreError extends Error {}

function requestToken(): string {
  return document.head.dataset.requesttoken ?? '';
}

// What this page uses of an answer, with the whole body read.
interface DavResponse {
  status: number;
  ok: boolean;
  header: (name: string) => string | null;
  body: ArrayBuffer;
}

// Each time a request sends or receives part of a body (force: an upload has been sent
// completely), so that saves waiting for their turn tell the translator that storing goes on.
const progressListeners = new Set<(force: boolean) => void>();
const progressed = (force: boolean) => {
  for (const listener of progressListeners) listener(force);
};

const stalled = () => new StoreError(t('craftsuite_layer', 'the connection to the server stalled'));

// GET and PROPFIND. Never from the HTTP cache: Nextcloud sends no Cache-Control on WebDAV, and a
// cached copy would be an old version. Given up when no answer, or no bytes of its body, arrive
// for STALL_MS (a large file may take longer as long as it keeps coming).
async function fetchDav(url: string, method: 'GET' | 'PROPFIND', headers: Record<string, string>, body?: string): Promise<DavResponse> {
  const controller = new AbortController();
  let timer = 0;
  const wait = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => controller.abort(), STALL_MS);
  };
  wait();
  try {
    const res = await fetch(url, { method, body, cache: 'no-store', credentials: 'same-origin', headers, signal: controller.signal });
    const parts: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    while (reader) {
      wait();
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.byteLength;
      progressed(false);
    }
    const data = new Uint8Array(size);
    let at = 0;
    for (let i = 0; i < parts.length; i++) {
      data.set(parts[i], at);
      at += parts[i].byteLength;
      parts[i] = data.subarray(0, 0); // released while the rest is copied
    }
    return { status: res.status, ok: res.ok, header: (name) => res.headers.get(name), body: data.buffer };
  } catch (err) {
    throw controller.signal.aborted ? stalled() : err;
  } finally {
    window.clearTimeout(timer);
  }
}

// PUT, through XMLHttpRequest for its upload progress. Given up when the upload makes no progress
// for STALL_MS, or the answer has not come ANSWER_MS after the last byte was sent.
function putDav(url: string, headers: Record<string, string>, data: ArrayBuffer): Promise<DavResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer = 0;
    const wait = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => xhr.abort(), ms);
    };
    xhr.open('PUT', url);
    xhr.responseType = 'arraybuffer';
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.addEventListener('progress', () => {
      wait(STALL_MS);
      progressed(false);
    });
    xhr.upload.addEventListener('load', () => {
      wait(ANSWER_MS);
      progressed(true);
    });
    xhr.addEventListener('progress', () => wait(STALL_MS));
    xhr.addEventListener('load', () => {
      window.clearTimeout(timer);
      resolve({
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        header: (name) => xhr.getResponseHeader(name),
        body: xhr.response instanceof ArrayBuffer ? xhr.response : new ArrayBuffer(0),
      });
    });
    xhr.addEventListener('error', () => {
      window.clearTimeout(timer);
      reject(new TypeError('the request failed'));
    });
    xhr.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(stalled());
    });
    wait(STALL_MS);
    xhr.send(data);
  });
}

// A file is locked for a moment while it is written (by this page, a sync client, another app):
// such a request is repeated a few times before it counts as failed.
async function unlocked(send: () => Promise<DavResponse>): Promise<DavResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await send();
    if (res.status !== 423 || attempt >= 4) return res;
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
}

const dav = (url: string, method: 'GET' | 'PROPFIND', headers: Record<string, string> = {}, body?: string) =>
  unlocked(() => fetchDav(url, method, { requesttoken: requestToken(), ...headers }, body));

const davPut = (url: string, headers: Record<string, string>, data: ArrayBuffer) =>
  unlocked(() => putDav(url, { requesttoken: requestToken(), 'Content-Type': 'application/octet-stream', ...headers }, data));

const bodyText = (res: DavResponse) => new TextDecoder().decode(res.body);

// The ETag for If-Match. OC-ETag first: Nextcloud sets it itself, so a proxy that compresses the
// response (and makes ETag weak or appends to it) leaves it alone. A weak ETag never matches.
function etagOf(res: DavResponse): string | null {
  for (const raw of [res.header('OC-ETag'), res.header('ETag')]) {
    if (raw && !raw.startsWith('W/')) return raw.startsWith('"') ? raw : `"${raw}"`;
  }
  return null;
}

// Without a usable header: the ETag property, which no proxy rewrites. Null if it cannot be had:
// the next save of the file then keeps both versions.
async function etagProperty(url: string): Promise<string | null> {
  let res: DavResponse;
  try {
    res = await dav(url, 'PROPFIND', { Depth: '0', 'Content-Type': 'application/xml' },
      '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>');
  } catch {
    return null;
  }
  const raw = res.status === 207 ? /<(?:\w+:)?getetag>([^<]+)</.exec(bodyText(res))?.[1] : undefined;
  if (!raw) return null;
  const etag = raw.replace(/&quot;/g, '"');
  return etag.startsWith('W/') ? null : etag.startsWith('"') ? etag : `"${etag}"`;
}

// The translator's own error texts are fixed English (docs/protocol.md#errors); the known ones are
// shown translated, anything else as it came.
function translatorMessage(raw: unknown): string {
  const text = String(raw);
  if (text === 'the app did not start in time') return t('craftsuite_layer', 'the app did not start in time');
  if (text === 'the app registered no drop target') return t('craftsuite_layer', 'the app registered no drop target');
  if (text === 'the app did not get ready in time') return t('craftsuite_layer', 'the app did not get ready in time');
  if (text === 'the translator could not read the file in time') return t('craftsuite_layer', 'the translator could not read the file in time');
  const failed = /^the app failed to load: (.*)$/s.exec(text);
  if (failed) return t('craftsuite_layer', 'the app failed to load: {detail}', { detail: failed[1] });
  const notStarted = /^the app failed to start: (.*)$/s.exec(text);
  if (notStarted) return t('craftsuite_layer', 'the app failed to start: {detail}', { detail: notStarted[1] });
  return text;
}

function readError(res: DavResponse): StoreError {
  const reasons: Record<number, string> = {
    401: t('craftsuite_layer', 'the session expired, log in again'),
    403: t('craftsuite_layer', 'you may not download this file'),
    404: t('craftsuite_layer', 'the file no longer exists'),
    423: t('craftsuite_layer', 'the file is locked'),
  };
  return new StoreError(reasons[res.status] ?? t('craftsuite_layer', 'the server answered HTTP {status}', { status: res.status }));
}

function writeError(res: DavResponse): StoreError {
  const reasons: Record<number, string> = {
    // Nextcloud's file name rules: a name it forbids (the administrator can add some), or too long.
    400: t('craftsuite_layer', 'the name is not allowed on the server'),
    401: t('craftsuite_layer', 'the session expired, log in again'),
    403: t('craftsuite_layer', 'no permission to write there'),
    404: t('craftsuite_layer', 'the folder no longer exists'),
    409: t('craftsuite_layer', 'the folder no longer exists'),
    412: t('craftsuite_layer', 'the file changed meanwhile'),
    413: t('craftsuite_layer', 'the file is too large for the server'),
    423: t('craftsuite_layer', 'the file is locked'),
    507: t('craftsuite_layer', 'not enough storage space'),
  };
  return new StoreError(reasons[res.status] ?? t('craftsuite_layer', 'the server answered HTTP {status}', { status: res.status }));
}

// --- Names. ------------------------------------------------------------------------------------
// The translator already sends a plain basename; a host must not rely on that. Direction
// overrides and invisible format characters become '_', as in the translator, so a name cannot
// hide its real extension ('invoice\u202efdp.exe').
function cleanName(raw: unknown): string {
  const name = String(raw ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return name || 'download';
}

// A name for a new file: without the characters Windows does not allow, so that sync clients on
// Windows can take it (Nextcloud refuses them when it enforces Windows-compatible names).
function storableName(name: string): string {
  return name.replace(/[<>:"|?*]/g, '_');
}

function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

const extensionOf = (name: string) => splitName(name).ext.toLowerCase();

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

// stem + tag + ext within Nextcloud's limit: the stem is shortened by whole characters, so that
// the tag (' (2)', ' (conflict …)') and the extension stay.
function fitName(stem: string, tag: string, ext: string): string {
  if (utf8Length(tag + ext) > MAX_NAME_BYTES / 2) {
    stem += ext;
    ext = '';
  }
  const room = MAX_NAME_BYTES - utf8Length(tag + ext);
  if (utf8Length(stem) <= room) return stem + tag + ext;
  let cut = '';
  let used = 0;
  for (const char of stem) {
    const size = utf8Length(char);
    if (used + size > room) break;
    cut += char;
    used += size;
  }
  return (cut.replace(/[\s.]+$/, '') || 'download') + tag + ext;
}

// The name the app gets: with a lower-case extension, which every Craft app recognises (PhotoCraft
// saves '.psd' in lower case, so a 'Photo.PSD' sent as is would come back as a second file).
function openName(name: string): string {
  const { stem, ext } = splitName(name);
  return stem + ext.toLowerCase();
}

function conflictTag(): string {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return ` (conflict ${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}-${two(now.getMinutes())})`;
}

function start(state: EditorState, iframe: HTMLIFrameElement): void {
  const appOrigin = new URL(state.appUrl).origin;
  const appName = state.appName;
  // The file with the latest version of the document: the file the newest stored save of a
  // document went to. The name label shows it, and the app gets it (again, after a reload).
  let current: DocFile = { name: state.file.name, url: state.file.url, etag: null, updatable: state.file.updatable, mime: state.file.mime };
  let openSeq = 0;
  // The open the app holds. A save belongs to the open (and the load) that was current when it
  // arrived, also if the frame reloads while it waits to be stored.
  let open: Open = { id: 0, file: null, documents: new Map(), lastDocId: 0, notices: 0 };
  const newLoad = (): Load => ({ exports: new Map(), started: new Map(), failing: new Map(), downloaded: new Set() });
  let load = newLoad();
  // Saves being stored.
  let pendingSaves = 0;
  // Status texts about saves that went somewhere unexpected or failed: the 'opened' text of an
  // open that began before one of them must not replace it.
  let notices = 0;
  let helloSeen = false;
  // Whether the page in the frame has said 'ready' (since it was loaded), and whether any page has.
  let ready = false;
  let wasReady = false;
  // Whether leaving the page may lose work: from the moment the app has the file.
  let armed = false;
  let leaving = false;
  // Close was chosen while saves were pending: leave once they are stored.
  let leaveWhenStored = false;
  // Object URLs of saves the page offers for download itself; released when the page goes.
  const offered = new Set<string>();

  const pending = () => pendingSaves + load.started.size;

  // Reads and writes of the file run one after the other: a second save waits for the first
  // (and then has its ETag), and a reload reads what the last save wrote.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const post = (msg: Record<string, unknown>, transfer: Transferable[] = []) => {
    iframe.contentWindow?.postMessage({ protocol: PROTOCOL, version: VERSION, ...msg }, appOrigin, transfer);
  };

  const follow = (file: DocFile) => {
    current = file;
    if (nameLabel) nameLabel.textContent = file.name;
  };

  const notice = (state: 'saved' | 'error', text: string, link?: StatusLink) => {
    notices++;
    setStatus(state, text, link);
  };

  // The only copy of a save this page could not store: offered for download below the bar until
  // the user discards it or leaves the page. Not in the status line, which every later message
  // replaces.
  const offer = (file: string, data: ArrayBuffer) => {
    if (!offerList) return;
    const href = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    offered.add(href);
    const item = document.createElement('li');
    item.className = 'craftsuite-editor__offer';
    const link = document.createElement('a');
    link.href = href;
    link.download = file;
    link.textContent = t('craftsuite_layer', 'Download {file}', { file });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = t('craftsuite_layer', 'Discard');
    dismiss.addEventListener('click', () => {
      item.remove();
      offered.delete(href);
      URL.revokeObjectURL(href);
    });
    item.append(t('craftsuite_layer', 'Not stored in Nextcloud:'), ' ', link, ' ', dismiss);
    offerList.append(item);
  };

  const leave = () => {
    // Asked already: no second question from the browser, and nothing more from the app.
    leaving = true;
    iframe.remove();
    window.location.assign(closeLink?.href ?? state.filesUrl);
  };

  // After a save ended: leave if Close is waiting for it and nothing else is pending.
  const settled = () => {
    if (!leaveWhenStored) return;
    if (pending() > 0) setStatus('saving', t('craftsuite_layer', 'Waiting for the save …'));
    else leave();
  };

  // A save failed while Close waited: stay, so the user sees why and the download can happen.
  const stayAfterFailure = () => {
    leaveWhenStored = false;
  };

  // Announced saves of a load that will not come: the page that announced them is gone, or has
  // not sent them in the time it allows itself.
  const giveUp = (own: Load, ids: number[]) => {
    let name = '';
    for (const id of ids) {
      const entry = own.started.get(id);
      if (!entry) continue;
      window.clearTimeout(entry.timer);
      own.started.delete(id);
      name = entry.name;
    }
    if (name) notice('error', t('craftsuite_layer', '{app} started saving {file}, but the file did not arrive.', { app: appName, file: name }));
    settled();
  };

  // The page in the frame was replaced (reloaded, or navigated elsewhere): what the old page
  // announced will not come, and the files it may have downloaded itself are offered here now.
  const replaceLoad = () => {
    const old = load;
    load = newLoad();
    ready = false;
    for (const [id, failing] of old.failing) {
      window.clearTimeout(failing.timer);
      old.failing.delete(id);
      failing.offer();
    }
    giveUp(old, [...old.started.keys()]);
  };

  // Reads the current file, inside the queue so that it is what the last save wrote.
  const readCurrent = () => serial(async () => {
    const file = current;
    const res = await dav(file.url, 'GET');
    if (!res.ok) throw readError(res);
    file.etag = etagOf(res) ?? (await etagProperty(file.url));
    const mime = res.header('Content-Type')?.split(';')[0].trim() || file.mime;
    return { file, data: res.body, mime };
  });
  // Read while the app loads; a later 'ready' (after a reload of the frame) reads again.
  let prefetched: ReturnType<typeof readCurrent> | null = readCurrent();
  prefetched.catch(() => undefined);

  // Names in the folder, in lower case: a name that differs from another only in letter case
  // clashes on Windows and macOS sync clients. Null if the folder cannot be listed; If-None-Match
  // still keeps every existing file safe.
  const takenNames = async (): Promise<Set<string> | null> => {
    try {
      const res = await dav(state.folderUrl, 'PROPFIND', { Depth: '1', 'Content-Type': 'application/xml' },
        '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>');
      if (res.status !== 207) return null;
      const xml = new DOMParser().parseFromString(bodyText(res), 'application/xml');
      const names = new Set<string>();
      for (const href of Array.from(xml.getElementsByTagNameNS('DAV:', 'href'))) {
        const last = (href.textContent ?? '').replace(/\/+$/, '').split('/').pop() ?? '';
        try {
          names.add(decodeURIComponent(last).toLowerCase());
        } catch {
          names.add(last.toLowerCase());
        }
      }
      return names;
    } catch {
      return null;
    }
  };

  // A new file named like raw (plus tag, such as ' (conflict …)'), under the first free name.
  const createFree = async (raw: string, data: ArrayBuffer, tag = ''): Promise<DocFile> => {
    const { stem, ext } = splitName(storableName(raw));
    const taken = await takenNames();
    for (let n = 1, tries = 0; n <= 1000 && tries < 100; n++) {
      const candidate = fitName(stem, n === 1 ? tag : `${tag} (${n})`, ext);
      if (taken?.has(candidate.toLowerCase())) continue;
      tries++;
      const url = state.folderUrl + encodeURIComponent(candidate);
      const res = await davPut(url, { 'If-None-Match': '*' }, data);
      if (res.ok) return { name: candidate, url, etag: etagOf(res) ?? (await etagProperty(url)), updatable: true, mime: '' };
      if (res.status !== 412) throw writeError(res);
    }
    throw new StoreError(t('craftsuite_layer', 'no free file name in the folder'));
  };

  // Writes a save of a document into its file, only over the version this page read or wrote
  // last. Where it went: that file ('updated'), or a new file next to it when the user may not
  // change the file, its version is unknown, or it was changed by someone else meanwhile.
  const write = async (name: string, file: DocFile, data: ArrayBuffer): Promise<{ how: Stored['how']; file: DocFile }> => {
    if (!file.updatable) return { how: 'readonly', file: await createFree(name, data) };
    // Never write without knowing which version is replaced.
    if (!file.etag) return { how: 'unchecked', file: await createFree(file.name, data, conflictTag()) };
    const res = await davPut(file.url, { 'If-Match': file.etag }, data);
    if (res.ok) {
      file.etag = etagOf(res) ?? (await etagProperty(file.url));
      return { how: 'updated', file };
    }
    if (res.status !== 412) throw writeError(res);
    return { how: 'conflict', file: await createFree(file.name, data, conflictTag()) };
  };

  const store = async (msg: Message, data: ArrayBuffer, own: Open, ownLoad: Load): Promise<Stored> => {
    const name = cleanName(msg.name);
    const id = typeof msg.id === 'number' ? msg.id : 0;
    const isNew = async (): Promise<Stored> => {
      const file = await createFree(name, data);
      if (msg.kind === 'export' && id > 0) ownLoad.exports.set(id, { file, lastId: id, continued: false });
      return { how: 'new', name: file.name };
    };
    // Only a save of the open's document may replace a file.
    if (msg.kind !== 'document' || msg.openId !== own.id) return isNew();
    if (msg.follows !== null && msg.follows !== undefined) {
      // A save that continues an export of this load (PdfCraft after a full rewrite): it goes to
      // the file that lineage is stored in, as do the later saves that continue it. The opened
      // document's file stays where saves without 'follows' go.
      const exportId = typeof msg.follows === 'number' ? msg.follows : null;
      const lineage = exportId === null ? undefined : ownLoad.exports.get(exportId);
      if (!lineage) {
        // An export this page did not store: the save becomes a new file, which the rest of the
        // lineage replaces.
        const file = await createFree(name, data);
        if (exportId !== null) ownLoad.exports.set(exportId, { file, lastId: id, continued: true });
        follow(file);
        return { how: 'created', name: file.name };
      }
      // An older save of the lineage that arrives after a newer one never replaces it.
      if (id <= lineage.lastId) return isNew();
      const placed = await write(name, lineage.file, data);
      const first = !lineage.continued;
      Object.assign(lineage, { file: placed.file, lastId: id, continued: true });
      follow(placed.file);
      return { how: placed.how === 'updated' && first ? 'followed' : placed.how, name: placed.file.name };
    }
    // An older save of the document that arrives after a newer one never replaces it (the
    // translator sends them in order; this page does not rely on that).
    if (id <= own.lastDocId) return isNew();
    const file = own.documents.get(name);
    let stored: Stored;
    if (!file || extensionOf(file.name) !== extensionOf(name)) {
      // The first save under a name of its own (or of a type the file under that name does not
      // have): a new file, which later saves under that name replace.
      const created = await createFree(name, data);
      own.documents.set(name, created);
      follow(created);
      stored = { how: 'created', name: created.name };
    } else {
      const placed = await write(name, file, data);
      own.documents.set(name, placed.file);
      follow(placed.file);
      stored = { how: placed.how, name: placed.file.name };
    }
    own.lastDocId = id;
    return stored;
  };

  const onSave = async (msg: Message) => {
    const id = msg.id;
    // Bound now: the frame may reload while this save waits behind others.
    const own = open;
    const ownLoad = load;
    if (typeof id === 'number') {
      window.clearTimeout(ownLoad.started.get(id)?.timer);
      ownLoad.started.delete(id);
    }
    post({ type: 'save-received', id });
    const file = cleanName(msg.name);
    if (!(msg.data instanceof ArrayBuffer)) {
      post({ type: 'save-result', id, ok: false, error: 'no file data' });
      stayAfterFailure();
      settled();
      return;
    }
    const data = msg.data;
    pendingSaves++;
    setStatus('saving', t('craftsuite_layer', 'Saving {file} …', { file }));
    // Answers about this save reach only the page that sent it.
    const answer = (reply: Record<string, unknown>) => {
      if (ownLoad === load) post({ ...reply, id });
    };
    // The translator's result timer starts again with each save-received. Repeated while the
    // requests ahead of this save and its own upload make progress (at most once a minute), when
    // an upload has been sent, and when its turn comes: it runs out only if storing stalls.
    let lastAlive = Date.now();
    const alive = (force: boolean) => {
      if (!force && Date.now() - lastAlive < KEEP_ALIVE_MS) return;
      lastAlive = Date.now();
      answer({ type: 'save-received' });
    };
    progressListeners.add(alive);
    try {
      const stored = await serial(() => {
        alive(true); // its turn now
        return store(msg, data, own, ownLoad);
      });
      answer({ type: 'save-result', ok: true });
      const name = stored.name;
      if (stored.how === 'updated') setStatus('saved', t('craftsuite_layer', 'Saved {file}', { file: name }));
      else {
        notice('saved', stored.how === 'new' ? t('craftsuite_layer', 'Saved as a new file: {file}', { file: name })
          : stored.how === 'followed' ? t('craftsuite_layer', 'Saved {file}, where your previous save went. Later saves go there.', { file: name })
            : stored.how === 'created' ? t('craftsuite_layer', 'Saved as {file} next to the original. Later saves go there.', { file: name })
              : stored.how === 'readonly' ? t('craftsuite_layer', 'You may not change the original, so your version is in {file}. Later saves go there.', { file: name })
                : stored.how === 'conflict' ? t('craftsuite_layer', 'The file was changed elsewhere, so your version is in {file}. Later saves go there.', { file: name })
                  : t('craftsuite_layer', 'Could not check whether the file changed meanwhile, so your version is in {file}. Later saves go there.', { file: name }));
      }
    } catch (err) {
      const reason = err instanceof StoreError ? err.message : t('craftsuite_layer', 'the connection to the server failed');
      stayAfterFailure();
      notice('error', t('craftsuite_layer', 'Could not store {file}: {reason}.', { file, reason }));
      if (typeof id !== 'number' || ownLoad !== load) {
        // The page that sent it was replaced, and its copy with it (unless it gave up on the save
        // before and downloaded it already).
        if (typeof id !== 'number' || !ownLoad.downloaded.has(id)) offer(file, data);
      } else if (!ownLoad.downloaded.has(id)) {
        // The page that sent it downloads it, and says so at once. Unless it has gone meanwhile
        // (its frame reloading or navigating away), when this page offers it instead.
        post({ type: 'save-result', id, ok: false, error: reason });
        const failing = {
          offer: () => offer(file, data),
          timer: window.setTimeout(() => {
            ownLoad.failing.delete(id);
            offer(file, data);
          }, FALLBACK_MS),
        };
        ownLoad.failing.set(id, failing);
      }
    } finally {
      progressListeners.delete(alive);
      pendingSaves--;
      settled();
    }
  };

  const openCurrent = async () => {
    const own: Open = { id: ++openSeq, file: null, documents: new Map(), lastDocId: 0, notices };
    const ownLoad = load;
    open = own;
    try {
      const { file, data, mime } = await (prefetched ?? readCurrent());
      prefetched = null;
      // The app was reloaded meanwhile: the new page asks for its own open.
      if (own !== open || ownLoad !== load) return;
      own.file = file;
      post({ type: 'open', id: own.id, name: openName(file.name), mime, data }, [data]);
    } catch (err) {
      prefetched = null;
      const reason = err instanceof StoreError ? err.message : t('craftsuite_layer', 'the connection to the server failed');
      setStatus('error', t('craftsuite_layer', 'Could not read {file}: {reason}.', { file: current.name, reason }));
    }
  };

  // The frame's page said hello since its last 'load' event (the translator says hello while the
  // page loads, before that event).
  let helloSinceLoad = false;
  let frameLoaded = false;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== appOrigin) return;
    const msg = event.data as Message;
    if (!msg || msg.protocol !== PROTOCOL || msg.version !== VERSION) return;
    switch (msg.type) {
      case 'hello':
        if (!helloSeen && root?.dataset.state === 'loading') setStatus('loading', t('craftsuite_layer', 'Loading {app} …', { app: appName }));
        helloSeen = true;
        helloSinceLoad = true;
        // After 'ready', a hello means the app was reloaded and needs a new handshake.
        if (ready) replaceLoad();
        post({ type: 'init' });
        break;
      case 'ready':
        ready = true;
        wasReady = true;
        void openCurrent();
        break;
      case 'delivered':
        if (msg.id === open.id && open.file) {
          // The name the app uses for the file; its saves under that name replace it.
          open.documents.set(cleanName(msg.name), open.file);
          armed = true;
          // A save that ended meanwhile keeps its message (where it went, or why it failed).
          if (notices === open.notices) setStatus('ready', t('craftsuite_layer', 'Opened in {app}. Save there to store it in Nextcloud.', { app: appName }));
        }
        break;
      case 'save-started':
        // Reading and hashing a large file takes the translator a moment: from now on leaving
        // waits for this save, until it arrives or the translator would have given up on it.
        if (typeof msg.id === 'number') {
          const id = msg.id;
          const own = load;
          window.clearTimeout(own.started.get(id)?.timer);
          own.started.set(id, { name: cleanName(msg.name), timer: window.setTimeout(() => giveUp(own, [id]), ANNOUNCED_MS) });
          setStatus('saving', t('craftsuite_layer', 'Saving {file} …', { file: cleanName(msg.name) }));
        }
        break;
      case 'save':
        void onSave(msg);
        break;
      case 'error':
        if (msg.of === 'startup') setStatus('error', t('craftsuite_layer', '{app} could not start: {reason}', { app: appName, reason: translatorMessage(msg.message) }));
        else if (msg.of === 'open') setStatus('error', t('craftsuite_layer', '{app} could not take the file: {reason}', { app: appName, reason: translatorMessage(msg.message) }));
        else if (msg.of === 'save') {
          if (typeof msg.id === 'number') {
            window.clearTimeout(load.started.get(msg.id)?.timer);
            load.started.delete(msg.id);
            load.downloaded.add(msg.id);
            window.clearTimeout(load.failing.get(msg.id)?.timer);
            load.failing.delete(msg.id);
          }
          stayAfterFailure();
          notice('error', t('craftsuite_layer', 'A save was not stored in Nextcloud ({reason}); {app} downloaded it instead.', { app: appName, reason: translatorMessage(msg.message) }));
          settled();
        }
        break;
    }
  });

  // Every navigation of the frame ends with a 'load' event of the iframe element, also one to a
  // page without the translator or an error page. A page that loaded without saying hello first
  // replaced the app's page: nothing the old page announced will come. (A reloaded app says hello
  // before its 'load'; that hello did the same. A frame whose page crashed fires nothing: the
  // timers of its announced saves end them.) The initial about:blank, whose document is this
  // page's, does not count.
  iframe.addEventListener('load', () => {
    let initial = false;
    try {
      initial = iframe.contentDocument !== null;
    } catch {
      // another origin
    }
    if (initial) return;
    if (frameLoaded && !helloSinceLoad) replaceLoad();
    frameLoaded = true;
    helloSinceLoad = false;
  });

  // The page cannot see whether the app has unsaved changes, so leaving asks once the app has the
  // file (the browser's own question), and while a save is still being stored.
  window.addEventListener('beforeunload', (event) => {
    if (!leaving && (armed || pending() > 0)) event.preventDefault();
  });
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return; // kept for a return to the page (back/forward cache)
    for (const href of offered) URL.revokeObjectURL(href);
    offered.clear();
  });
  closeLink?.addEventListener('click', (event) => {
    event.preventDefault();
    if (leaveWhenStored) {
      // Close again while waiting: leave now if the user accepts losing the pending save.
      const question = pendingSaves > 0 ? t('craftsuite_layer', 'A save is still being stored. Leave anyway?')
        : t('craftsuite_layer', '{app} has started a save that has not arrived yet. Leave anyway?', { app: appName });
      if (window.confirm(question)) leave();
      return;
    }
    if ((armed || pending() > 0) && !window.confirm(t('craftsuite_layer', 'Leave {app}? Changes you have not saved there are lost.', { app: appName }))) return;
    if (pending() === 0) {
      leave();
      return;
    }
    // Leaving now would discard the save (the frame holds it, and the upload would stop): wait.
    leaveWhenStored = true;
    settled();
  });

  // From here on the frame loads; a frame that never loads must not keep the page waiting either.
  // The language goes to the translator in the fragment (docs/protocol.md, Host settings): the
  // hosting never sees it, the translator takes it out before the app runs, and an older
  // translator leaves it alone (no app reads it). The configured address has no fragment.
  iframe.src = state.appUrl + (state.language ? '#craftsuite-layer:lang=' + encodeURIComponent(state.language) : '');
  window.setTimeout(() => {
    if (!helloSeen && root?.dataset.state === 'loading') {
      setStatus('loading', t('craftsuite_layer', '{app} has not answered yet. If its site asks you to sign in, sign in there, then reload this page.', { app: appName }),
        { href: state.appUrl, label: t('craftsuite_layer', 'Open {app} in a new tab', { app: appName }) });
    }
  }, HELLO_HINT_MS);
  window.setTimeout(() => {
    // A more specific error (from the translator or a failed read) stays.
    if (!wasReady && root?.dataset.state !== 'error') setStatus('error', t('craftsuite_layer', '{app} did not start. Is it reachable at {origin}?', { app: appName, origin: appOrigin }));
  }, START_TIMEOUT_MS);
}

if (root && frame) {
  try {
    start(loadState(), frame);
  } catch (err) {
    setStatus('error', t('craftsuite_layer', 'The editor could not start: {reason}', { reason: err instanceof Error ? err.message : String(err) }));
  }
}
