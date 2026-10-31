// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real SoundCraft web build. See docs/apps/soundcraft.md. Three tests; a
// test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract   allowed host: handshake with the served app version, 'ready' once SoundCraft listens
//              for drops on its canvas and has removed its loading text; the frame address carries
//              SoundCraft's flag `empty` after the host's query; open of craftsuite-probe.scraftz
//              (two tracks, one selected); the Save shortcut (Ctrl+S, Cmd+S under a Mac user
//              agent) saves the document under the opened name, a bundle of the opened session;
//              after Select All the next save is the document too (an export of the selected tracks
//              would have the same bytes, but it came right after the shortcut); nothing becomes a
//              download, also not after the deadlines for the host's confirmation and result.
//              The blank of the Nextcloud app's + New entry (an empty session in a bundle) opens,
//              and its first Ctrl+S, without an edit, is the document. Without WebGL2 and WebGPU
//              the host gets a startup error and no 'ready'
//   exports    under a Mac user agent, for SoundCraft's Search (Cmd+Ctrl+S, Mac only): File >
//              Export > Selected Tracks as New Session…, under the opened name, is a new file, and
//              Cmd+S after it the document; an opened 'Untitled.scraftz' is never saved back; a
//              session SoundCraft cannot open leaves the empty session open (`empty`), whose save
//              is a new 'Untitled.scraftz'; after a session with the opened name from the user's
//              disk (File > Open Session…, a file without extension, which the picker opens as a
//              session too; in Chromium also one dropped from the desktop), Cmd+S is a new file
//   ui (@ui)   with the pointer, on the opened session: File > Save Session saves the document;
//              File > Export > Selected Tracks as New Session… with its dialog's OK arrives as a
//              new file; after Select All, File > Save Session is a new file too (it cannot be told
//              from that export)
//
// A daily canary runs this file against every new SoundCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see (section
// "Contract"). SoundCraft has no automation API in the browser and no other trace of what it has
// open, so the steps wait for its picture to settle, and the saved bytes show what was open. The
// steps use its shortcuts (crates/engine/src/cmd/, crates/ui-egui/src/shortcuts.rs), which follow
// the platform egui reads from the user agent: Ctrl in Chromium, Cmd in WebKit with Safari's. Its
// Search, the only keyboard way to menu commands without a shortcut, opens only with the Mac chord
// Cmd+Ctrl+S, so the exports test runs under a Mac user agent. Only the test tagged @ui clicks with
// the pointer: a moved menu item fails it without the translator being at fault.
//
// The fixture fixtures/soundcraft/craftsuite-probe.scraftz is written by make-fixtures.mjs: a
// session 'craftsuite-probe' with MARKER as its comments and the tracks 'Tone A' (selected) and
// 'Tone B'. The other files the tests open are derived from it below.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, devices, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { appFrames, press, settle, waitForTextEditing } from '../lib/craft-ui.ts';

const PROBE = readFileSync(new URL('../fixtures/soundcraft/craftsuite-probe.scraftz', import.meta.url));
const MARKER = 'CRAFTSUITE-PROBE-sc01';
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/soundcraft/`;
// Translator timeouts (host knobs app-ack, app-result) where a test waits for them, in ms.
const SHORT_ACK = 3000;
const SHORT_RESULT = 3000;
// Where `npm run craft:fetch` records the selected builds, as in server/serve.mjs.
const SELECTED = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)),
  process.env.CRAFT_BUILDS_DIR || '.craft-builds', 'selected.json');
// A Mac user agent for Chromium, so that egui takes the Mac shortcuts (Search: Cmd+Ctrl+S). WebKit
// has Safari's, a Mac one, already.
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// What the test host records in window.__host (tests/e2e/host/host.js).
interface HostSave {
  id: number;
  kind: 'document' | 'export';
  openId: number | null;
  name: string;
  size: number;
  sha256: string;
  base64: string;
  unconfirmed?: boolean;
}
interface HostRecord {
  state: string;
  events: string[];
  messages: { type: string; app: string; id: number | null; kind: string | null }[];
  saves: HostSave[];
  errors: { of: string; id: number | null; message: string }[];
}
type HostWindow = Window & {
  __host?: HostRecord;
  __ready?: { at: number[]; versions: unknown[] }; // see recordStartup()
  CRAFTSUITE_TEST?: { versions?: Record<string, string> }; // the test server's config.js
};
type AppWindow = Window & {
  __startup?: { drop: number | null; dropOn: string | null; loadingGone: number | null }; // see recordStartup()
};

const test = baseTest.extend<{ diagnostics: void }>({
  // On failure, attach what the app and the host said in each page of the test: a canary failure
  // must be readable without rerunning it.
  diagnostics: [async ({ context }, use, testInfo) => {
    const ids = new Map<Page, number>();
    const label = (page: Page | null) => {
      if (!page) return '[context]';
      if (!ids.has(page)) ids.set(page, ids.size + 1);
      return `[page ${ids.get(page)}]`;
    };
    for (const page of context.pages()) label(page);
    context.on('page', label);
    const lines: string[] = [];
    context.on('console', (m) => lines.push(`${label(m.page())} [${m.type()}] ${m.text()}`));
    context.on('weberror', (e) => lines.push(`${label(e.page())} [pageerror] ${e.error().message}`));
    await use();
    if (testInfo.status === testInfo.expectedStatus) return;
    const events: string[] = [];
    for (const page of context.pages()) {
      const host = await page.evaluate(() => (window as HostWindow).__host?.events).catch(() => undefined);
      if (host) events.push(`${label(page)} ${page.url()}`, ...host.map((line) => `  ${line}`));
    }
    await testInfo.attach('console.txt', { body: lines.join('\n'), contentType: 'text/plain' });
    await testInfo.attach('host-events.txt', { body: events.join('\n'), contentType: 'text/plain' });
  }, { auto: true }],
});

// Pinned: the @ui click positions depend on the layout.
test.use({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });

// The browser downloads of a page, from now on.
function trackDownloads(page: Page) {
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  return downloads;
}

// For a test with several independent scenarios: each runs as a step in a page of its own, and a
// failure is reported (as a soft error) without stopping the scenarios after it, so one run lists
// every scenario that broke. The page of a passed scenario is closed; a failed one stays open for
// the diagnostics.
async function scenario(context: BrowserContext, title: string, body: (page: Page, downloads: Download[]) => Promise<void>) {
  const errorsBefore = test.info().errors.length;
  let page: Page | undefined;
  const failure = await test.step(title, async () => {
    page = await context.newPage();
    await body(page, trackDownloads(page));
  }).then(() => null, (error: unknown) => error);
  expect.soft(() => { if (failure) throw failure; }, `scenario failed: ${title}`).not.toThrow();
  if (test.info().errors.length === errorsBefore) await page?.close();
}

// ---------------------------------------------------------------------------------------------
// UI: drive SoundCraft. egui draws everything into one canvas, and SoundCraft tells nothing about
// what it shows, so the steps wait for the picture to settle.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on SoundCraft 0.6.1, 0.7.0 and 0.14.0), relative to the app frame at
// the pinned viewport. This is the only layout knowledge in this file; when a release moves
// something, fix it here. The File menu's rows come from `menu` (see fileMenu()).
const AT = {
  // Menu bar, after SoundCraft: File.
  fileMenu: (b: Box) => ({ x: b.x + 96, y: b.y + 11 }),
  // File menu: Save Session, after New, Open, (Open Recent,) Dashboard and Close Session.
  fileSave: (b: Box, menu: Menu) => ({ x: b.x + 129, y: b.y + menu.first + menu.row * (4 + menu.recent) }),
  // File menu: Export, nine rows below Save Session, which opens a submenu.
  fileExport: (b: Box, menu: Menu) => ({ x: b.x + 150, y: b.y + menu.first + menu.row * (13 + menu.recent) }),
  // File > Export: Selected Tracks as New Session…, the second row of the submenu, which starts
  // level with Export.
  exportSession: (b: Box, menu: Menu) => ({ x: b.x + 384, y: b.y + menu.first + menu.row * (14 + menu.recent) }),
  // The OK button of the name dialog it opens, in the middle of the frame, 80 points up.
  dialogOk: (b: Box) => ({ x: b.x + 609, y: b.y + 316 }),
};

// The File menu: the middle of its first row (New), the row height, and whether Open Recent sits
// above Save Session (since 0.7.0; 0.6.1 is the oldest version this spec runs on). Since 0.14.0
// the rows are 24 points high instead of 22, and the first one is 3 points lower.
type Menu = { first: number; row: number; recent: number };
async function fileMenu(page: Page): Promise<Menu> {
  const version = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.soundcraft ?? '');
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major > 0 || minor >= 14) return { first: 39, row: 24, recent: 1 };
  return { first: 36, row: 22, recent: minor >= 7 ? 1 : 0 };
}

function appFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url().startsWith(APP));
  if (!frame) throw new Error(`no frame shows ${APP}`);
  return frame;
}

// The modifier of SoundCraft's shortcuts: egui reads the platform from the user agent, and on a
// Mac its Cmd is the Meta key.
async function mod(app: Frame) {
  return (await app.evaluate(() => navigator.userAgent.includes('Mac'))) ? 'Meta' : 'Control';
}

// A shortcut, followed by a few frames for SoundCraft to handle it.
async function shortcut(page: Page, app: Frame, what: string, key: string) {
  await test.step(`ui: ${what} (${key})`, async () => {
    await press(page, app, key);
    await appFrames(app, 3);
  });
}

// File > Save Session: Ctrl+S, or Cmd+S on a Mac. With a path (an opened file) it saves at once.
const save = async (page: Page, app: Frame) => shortcut(page, app, 'Save Session', `${await mod(app)}+s`);

// Edit > Select All: every visible track, and the whole session as the edit selection.
const selectAll = async (page: Page, app: Frame) => shortcut(page, app, 'Select All', `${await mod(app)}+a`);

// A name dialog (Save Session As, an export) takes Enter as its OK, also while its text field does
// not have the focus (crates/ui-egui/src/dialogs.rs).
async function confirmDialog(page: Page, app: Frame) {
  await settle(page.locator('#app'), app);
  await shortcut(page, app, 'OK in the dialog', 'Enter');
}

// A command from SoundCraft's Search (Window > Search; Cmd+Ctrl+S, which egui has only on a Mac):
// its label, then Enter for the best match (crates/ui-egui/src/palette.rs).
async function search(page: Page, app: Frame, label: string) {
  await test.step(`ui: run "${label}" from Search (Cmd+Ctrl+S)`, async () => {
    await press(page, app, 'Meta+Control+s');
    await waitForTextEditing(app, true, 'Search did not open on Cmd+Ctrl+S');
    await page.keyboard.insertText(label); // no key events: stray letters could be shortcuts
    await appFrames(app, 3);
    await page.keyboard.press('Enter');
    await appFrames(app, 3);
  });
}

// For the @ui test: a click at a point from AT, after a hover frame so egui sees the target.
async function clickApp(page: Page, app: Frame, what: string, at: (b: Box, menu: Menu) => { x: number; y: number }) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const { x, y } = at(box, await fileMenu(page));

  await test.step(`ui: click ${what}`, async () => {
    await page.mouse.move(x, y, { steps: 4 });
    await appFrames(app, 2);
    await page.mouse.click(x, y);
    await appFrames(app, 3);
  });
}

// A user's drag and drop of a file from the desktop onto the middle of the app. Only Chromium can
// send such a trusted drop (DevTools protocol).
async function dropFromDesktop(page: Page, file: string) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await test.step(`ui: drop ${path.basename(file)} from the desktop`, async () => {
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, ...at, data });
    await cdp.detach();
  });
}

// File > Open Session… (Ctrl+O, Cmd+O) with a file from the user's disk: SoundCraft shows the
// browser's file picker (an <input type=file>).
async function openFromDisk(page: Page, app: Frame, file: string) {
  await test.step(`ui: File > Open Session… of ${path.basename(file)} from the disk`, async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await press(page, app, `${await mod(app)}+o`);
    await (await chooser).setFiles(file);
  });
}

// Loads the test host with a fixture and waits until SoundCraft shows it: the host delivered the
// file, then the picture settles (the open takes a frame or two after the drop). `bytes` serves
// those bytes under `name` instead of a file in fixtures/soundcraft/.
async function openInHost(page: Page, name: string, options: { query?: string; bytes?: Buffer; folder?: string } = {}) {
  if (options.bytes) {
    const body = options.bytes;
    await page.route(`${HOST}files/soundcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body, contentType: 'application/octet-stream' }));
  }
  // `folder`: a file of another folder of the test server (blanks: the Nextcloud app's blank documents).
  await page.goto(`${HOST}?target=soundcraft&name=${encodeURIComponent(`${options.folder ?? 'soundcraft'}/${name}`)}${options.query ?? ''}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  await settle(page.locator('#app'), app);
  return app;
}

// ---------------------------------------------------------------------------------------------
// Contract: what the host and the browser see.
// ---------------------------------------------------------------------------------------------

const hostRecord = (page: Page): Promise<HostRecord> => page.evaluate(() => (window as HostWindow).__host!);

// Times, in the clock both documents share (Date.now()), of what decides when the app can take
// files: in the app frame, SoundCraft's first `drop` listener (and its element) and the removal of
// #soundcraft_loading; in the host page, each ready message with its appVersion. Call before
// loading the page.
async function recordStartup(page: Page) {
  await page.addInitScript((appOrigin) => {
    if (location.origin === appOrigin) {
      const marks = { drop: null as number | null, dropOn: null as string | null, loadingGone: null as number | null };
      (window as AppWindow).__startup = marks;
      // Runs before the translator, which wraps this in turn.
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: Parameters<EventTarget['addEventListener']>) {
        if (args[0] === 'drop' && marks.drop === null) {
          marks.drop = Date.now();
          marks.dropOn = this instanceof Element ? `${this.tagName.toLowerCase()}#${this.id}` : String(this);
        }
        return add.apply(this, args);
      };
      let seen = false;
      new MutationObserver(() => {
        if (document.getElementById('soundcraft_loading')) seen = true;
        else if (seen && marks.loadingGone === null) marks.loadingGone = Date.now();
      }).observe(document, { childList: true, subtree: true });
      return;
    }
    if (window !== window.top) return;
    const ready = ((window as HostWindow).__ready = { at: [] as number[], versions: [] as unknown[] });
    window.addEventListener('message', (event) => {
      const msg = event.data as { protocol?: string; type?: string; appVersion?: unknown } | null;
      if (event.origin !== appOrigin || msg?.protocol !== 'craftsuite-layer' || msg.type !== 'ready') return;
      ready.at.push(Date.now());
      ready.versions.push(msg.appVersion);
    });
  }, APP_ORIGIN);
}

// A browser without WebGL2 and WebGPU, for the app frame only.
async function withoutGraphics(page: Page) {
  await page.addInitScript((appOrigin) => {
    if (location.origin !== appOrigin) return;
    for (const proto of [HTMLCanvasElement.prototype, globalThis.OffscreenCanvas?.prototype]) {
      if (!proto) continue;
      const getContext = proto.getContext as (this: unknown, type: string, ...rest: unknown[]) => unknown;
      Object.defineProperty(proto, 'getContext', {
        configurable: true,
        writable: true,
        value(this: unknown, type: string, ...rest: unknown[]) {
          return /webgl|webgpu/i.test(String(type)) ? null : getContext.call(this, type, ...rest);
        },
      });
    }
    delete (Navigator.prototype as { gpu?: unknown }).gpu;
  }, APP_ORIGIN);
}

async function untilHost(page: Page, what: string, done: (h: HostRecord) => boolean, timeout = 30_000) {
  await expect.poll(async () => done(await hostRecord(page)), { message: what, timeout }).toBe(true);
}

// The first occurrence of each message type the host received, in order.
async function messageTypes(page: Page) {
  return [...new Set((await hostRecord(page)).messages.map((m) => m.type))];
}

// The n-th save (from 1) the host received, with the bytes it kept.
async function hostSave(page: Page, n: number) {
  await untilHost(page, `save #${n} reached the host`, (h) => h.saves.length >= n);
  const saved = (await hostRecord(page)).saves[n - 1];
  const bytes = Buffer.from(saved.base64 ?? '', 'base64');
  if (!saved.unconfirmed) {
    expect(createHash('sha256').update(bytes).digest('hex'), 'the host hashed the bytes it kept').toBe(saved.sha256);
    expect(saved.size).toBe(bytes.length);
  }
  return { save: saved, bytes };
}

// The opened session: the host may replace its file with these bytes.
function expectDocument(saved: HostSave, name: string) {
  expect(saved).toMatchObject({ kind: 'document', openId: 1, name });
}

// Anything else (exports, other sessions): the host stores it as a new file.
function expectExport(saved: HostSave, name: string) {
  expect(saved).toMatchObject({ kind: 'export', openId: null, name });
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// The entries of a zip of stored entries, by name, as SoundCraft writes it: every entry has ZIP64
// fields in the central directory, which fflate reads only in archives with a ZIP64 end record
// (SoundCraft's have none).
function unzipStored(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (end < 0) throw new Error('not a zip');
  const files: Record<string, Buffer> = {};
  let at = bytes.readUInt32LE(end + 16);
  for (let left = bytes.readUInt16LE(end + 10); left > 0; left--) {
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    let size = bytes.readUInt32LE(at + 20);
    let full = bytes.readUInt32LE(at + 24);
    let local = bytes.readUInt32LE(at + 42);
    for (let x = at + 46 + nameLength; x + 4 <= at + 46 + nameLength + extraLength; x += 4 + bytes.readUInt16LE(x + 2)) {
      if (bytes.readUInt16LE(x) !== 1) continue;
      let field = x + 4;
      if (full === 0xffffffff) { full = Number(bytes.readBigUInt64LE(field)); field += 8; }
      if (size === 0xffffffff) { size = Number(bytes.readBigUInt64LE(field)); field += 8; }
      if (local === 0xffffffff) local = Number(bytes.readBigUInt64LE(field));
    }
    if (bytes.readUInt16LE(at + 10) !== 0 || size !== full) throw new Error('not a stored entry');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files[bytes.toString('utf8', at + 46, at + 46 + nameLength)] = bytes.subarray(start, start + size);
    at += 46 + nameLength + extraLength + bytes.readUInt16LE(at + 32);
  }
  return files;
}

// A SoundCraft session (crates/model/src/session.rs), as far as the tests look at it.
interface Session {
  format_version: number;
  name: string;
  comments: string;
  tracks: { id: number; name: string; kind: string }[];
  edit: { selected_tracks: number[] };
}
// The session in a bundle and the bundle's entries.
function bundle(bytes: Buffer) {
  const files = unzipStored(bytes);
  const names = Object.keys(files);
  const scraft = names.find((n) => !n.includes('/') && n.endsWith('.scraft'));
  if (!scraft) throw new Error(`no session in the bundle: ${names.join(', ')}`);
  return { names, scraft, session: JSON.parse(files[scraft].toString('utf8')) as Session };
}
// The fixture with its session changed.
function probeWith(change: (session: Session) => void) {
  const files = unzipStored(PROBE);
  const { scraft, session } = bundle(PROBE);
  change(session);
  return Buffer.from(zipSync({ ...files, [scraft]: Buffer.from(JSON.stringify(session, null, 2)) }, { level: 0 }));
}

// A save of the opened session as SoundCraft writes it: a bundle named after the file, with the
// session stored under the same stem, the audio of every source of the fixture (an export of
// selected tracks keeps them all), the fixture's comments, these tracks and this selection.
function expectSession(bytes: Buffer, stem: string, tracks: string[], selected: string[], comments = MARKER) {
  const { names, scraft, session } = bundle(bytes);
  expect(scraft, 'the session in the bundle').toBe(`${stem}.scraft`);
  expect(names.filter((n) => n !== scraft).sort(), 'its audio').toEqual(['Audio Files/Tone A.wav', 'Audio Files/Tone B.wav']);
  expect(session.name, 'the session, named after the file').toBe(stem);
  expect(session.comments, 'the session comments').toBe(comments);
  expect(session.tracks.map((t) => t.name), 'its tracks').toEqual(tracks);
  const ids = new Set(session.edit.selected_tracks);
  expect(session.tracks.filter((t) => ids.has(t.id)).map((t) => t.name), 'its selected tracks').toEqual(selected);
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the session and stores every save, nothing is downloaded', async ({ page, context }) => {
  const downloads = trackDownloads(page);
  await recordStartup(page);
  const app = await openInHost(page, 'craftsuite-probe.scraftz', { query: `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}` });

  await test.step('handshake: hello, ready with the served app version once SoundCraft takes drops, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'soundcraft'), 'messages from another app than soundcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.soundcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.soundcraft);
    const ready = (await page.evaluate(() => (window as HostWindow).__ready))!;
    expect.soft(ready.versions, 'appVersion of the one ready').toEqual([served]);
    // eframe listens for drops on the canvas once the graphics and the app run, and SoundCraft
    // removes its loading text right after: the core's ready at that listener fits.
    const marks = (await app.evaluate(() => (window as AppWindow).__startup))!;
    expect.soft(marks.dropOn, 'SoundCraft\'s drop listener').toBe('canvas#soundcraft_canvas');
    expect.soft(marks.loadingGone, 'SoundCraft removed #soundcraft_loading').not.toBeNull();
    expect.soft(ready.at[0], 'ready once SoundCraft listens for drops').toBeGreaterThanOrEqual(marks.drop!);
  });

  await test.step('the frame address carries SoundCraft\'s flag empty after the host\'s query', async () => {
    // Set by the adapter before SoundCraft reads it; its effect is checked in the exports test.
    expect(new URL(app.url()).search).toBe(`?ack=${SHORT_ACK}&result=${SHORT_RESULT}&empty`);
  });

  await test.step('the Save shortcut saves the opened session as the document, under the opened name', async () => {
    await save(page, app);
    const { save: saved, bytes } = await hostSave(page, 1);
    expectDocument(saved, 'craftsuite-probe.scraftz');
    expectSession(bytes, 'craftsuite-probe', ['Tone A', 'Tone B'], ['Tone A']);
  });

  await test.step('after Select All, the Save shortcut saves the document again', async () => {
    // Every track selected: an export of the selected tracks would have these bytes. The adapter
    // takes it as the document because it came right after the shortcut.
    await selectAll(page, app);
    await save(page, app);
    const { save: saved, bytes } = await hostSave(page, 2);
    expectDocument(saved, 'craftsuite-probe.scraftz');
    expectSession(bytes, 'craftsuite-probe', ['Tone A', 'Tone B'], ['Tone A', 'Tone B']);
  });

  await test.step('nothing becomes a download, also not after both deadlines', async () => {
    // Every save was stored, so nothing may fall back to a download, also not once the deadlines
    // for the confirmation and for the result have passed for the last save. Short deadlines,
    // real time: eframe cannot run under a fake clock.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- nothing may happen in this time
    await page.waitForTimeout(Math.max(SHORT_ACK, SHORT_RESULT) + 1000);
    expect.soft((await hostRecord(page)).errors, 'errors the host got').toEqual([]);
    expect.soft((await hostRecord(page)).saves, 'saves the host got').toHaveLength(2);
    expectNoDownloads(downloads);
  });

  await test.step('the + New blank opens, and its first save, without an edit, is the document', async () => {
    const other = await context.newPage();
    const otherDownloads = trackDownloads(other);
    const blank = await openInHost(other, 'blank.scraftz', { folder: 'blanks' });
    await save(other, blank);
    const { save: saved, bytes } = await hostSave(other, 1);
    expectDocument(saved, 'blank.scraftz');
    const { names, session } = bundle(bytes);
    expect(names, 'a session without audio').toEqual(['blank.scraft']);
    expect(session.name, 'named after the file').toBe('blank');
    expect(session.tracks, 'no tracks').toEqual([]);
    expectNoDownloads(otherDownloads);
    await other.close();
  });

  await test.step('without WebGL2 and WebGPU: a startup error instead of ready', async () => {
    // eframe fails before it listens for drops, and SoundCraft writes why into its loading text.
    // The core reports the missing drop target after the adapter's 10 s.
    const other = await context.newPage();
    await withoutGraphics(other);
    await other.goto(`${HOST}?target=soundcraft&name=soundcraft/craftsuite-probe.scraftz`);
    await untilHost(other, 'an error reached the host', (h) => h.errors.length > 0, 60_000);
    const record = await hostRecord(other);
    expect(record.errors).toEqual([{ of: 'startup', id: null, message: 'the app registered no drop target' }]);
    expect(record.messages.map((m) => m.type), 'no ready, so no open').not.toContain('ready');
    const shown = await appFrame(other).evaluate(() => document.getElementById('soundcraft_loading')?.textContent);
    expect(shown, 'SoundCraft\'s own message').toMatch(/^SoundCraft failed to start: .*wgpu surface/);
    await other.close();
  });
});

test.describe('under a Mac user agent', () => {
  test.use({ userAgent: async ({ browserName }, use) => use(browserName === 'webkit' ? devices['Desktop Safari'].userAgent : MAC_CHROME) });

  test('exports: an export under the opened name, sessions named Untitled, a session SoundCraft cannot open, sessions from the disk', async ({ context, browserName }) => {
    await scenario(context, 'Export > Selected Tracks as New Session… under the opened name is a new file; Cmd+S after it is the document', async (page, downloads) => {
      // Its dialog proposes '<session name>.scraftz', and the fixture stores its own stem.
      const app = await openInHost(page, 'craftsuite-probe.scraftz');
      await search(page, app, 'Selected Tracks as New Session');
      await confirmDialog(page, app);
      const part = await hostSave(page, 1);
      expectExport(part.save, 'craftsuite-probe.scraftz');
      expectSession(part.bytes, 'craftsuite-probe', ['Tone A'], ['Tone A']);

      await save(page, app);
      const whole = await hostSave(page, 2);
      expectDocument(whole.save, 'craftsuite-probe.scraftz');
      expectSession(whole.bytes, 'craftsuite-probe', ['Tone A', 'Tone B'], ['Tone A']);
      expectNoDownloads(downloads);
    });

    await scenario(context, 'an opened \'Untitled.scraftz\' is never saved back: every new session has that name', async (page, downloads) => {
      const app = await openInHost(page, 'Untitled.scraftz', { bytes: PROBE });
      await save(page, app);
      const { save: saved, bytes } = await hostSave(page, 1);
      expectExport(saved, 'Untitled.scraftz');
      expectSession(bytes, 'Untitled', ['Tone A', 'Tone B'], ['Tone A']);
      expectNoDownloads(downloads);
    });

    await scenario(context, 'a session SoundCraft cannot open leaves the empty session open (empty), whose save is a new \'Untitled.scraftz\'', async (page, downloads) => {
      // A deflated bundle: SoundCraft reads only stored entries. Without `empty` its demo session
      // would stay open instead.
      const deflated = Buffer.from(zipSync(unzipStored(PROBE), { level: 6 }));
      const app = await openInHost(page, 'craftsuite-probe.scraftz', { bytes: deflated });
      await save(page, app); // no path: Save asks for a name, 'Untitled.scraftz'
      await confirmDialog(page, app);
      const { save: saved, bytes } = await hostSave(page, 1);
      expectExport(saved, 'Untitled.scraftz');
      expect(bundle(bytes).session, 'the empty session').toMatchObject({ name: 'Untitled', tracks: [], comments: '' });
      expectNoDownloads(downloads);
    });

    // The picker opens any file as a session: this one has no extension, and SoundCraft still
    // names it after the opened file.
    await scenario(context, 'after a session with the opened name from the user\'s disk (File > Open Session…, a file without extension), Cmd+S is a new file', async (page, downloads) => {
      const app = await openInHost(page, 'craftsuite-probe.scraftz');
      const file = test.info().outputPath('disk', 'craftsuite-probe');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, probeWith((s) => { s.comments = 'FROM-THE-DISK'; }));
      await openFromDisk(page, app, file);
      await settle(page.locator('#app'), app);
      await save(page, app);
      const { save: saved, bytes } = await hostSave(page, 1);
      expectExport(saved, 'craftsuite-probe.scraftz');
      expectSession(bytes, 'craftsuite-probe', ['Tone A', 'Tone B'], ['Tone A'], 'FROM-THE-DISK');
      expectNoDownloads(downloads);
    });

    await scenario(context, 'after a session with the opened name dropped from the desktop (Chromium), Cmd+S is a new file', async (page, downloads) => {
      // Only Chromium can send a trusted drop (DevTools protocol); the picker above runs everywhere.
      if (browserName !== 'chromium') {
        test.info().annotations.push({ type: 'skipped scenario', description: 'a drop from the desktop needs Chromium' });
        return;
      }
      const app = await openInHost(page, 'craftsuite-probe.scraftz');
      const file = test.info().outputPath('desktop', 'craftsuite-probe.scraftz');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, probeWith((s) => { s.comments = 'FROM-THE-DESKTOP'; }));
      await dropFromDesktop(page, file);
      await settle(page.locator('#app'), app);
      await save(page, app);
      const { save: saved, bytes } = await hostSave(page, 1);
      expectExport(saved, 'craftsuite-probe.scraftz');
      expectSession(bytes, 'craftsuite-probe', ['Tone A', 'Tone B'], ['Tone A'], 'FROM-THE-DESKTOP');
      expectNoDownloads(downloads);
    });
  });
});

test('ui: File > Save Session and File > Export > Selected Tracks as New Session… with the pointer', { tag: '@ui' }, async ({ page }) => {
  const downloads = trackDownloads(page);
  const app = await openInHost(page, 'craftsuite-probe.scraftz');

  await test.step('File > Save Session saves the document (a track is not selected)', async () => {
    await clickApp(page, app, 'the File menu', AT.fileMenu);
    await clickApp(page, app, 'Save Session in the File menu', AT.fileSave);
    const { save: saved, bytes } = await hostSave(page, 1);
    expectDocument(saved, 'craftsuite-probe.scraftz');
    expectSession(bytes, 'craftsuite-probe', ['Tone A', 'Tone B'], ['Tone A']);
  });

  await test.step('File > Export > Selected Tracks as New Session…, OK: a new file under the opened name', async () => {
    await clickApp(page, app, 'the File menu', AT.fileMenu);
    await clickApp(page, app, 'Export in the File menu', AT.fileExport);
    await clickApp(page, app, 'Selected Tracks as New Session… in the Export submenu', AT.exportSession);
    await settle(page.locator('#app'), app);
    await clickApp(page, app, 'OK in its dialog', AT.dialogOk);
    const { save: saved, bytes } = await hostSave(page, 2);
    expectExport(saved, 'craftsuite-probe.scraftz');
    expect(bundle(bytes).session.tracks.map((t) => t.name), 'only the selected track').toEqual(['Tone A']);
    expectSession(bytes, 'craftsuite-probe', ['Tone A'], ['Tone A']);
  });

  await test.step('after Select All, File > Save Session is a new file: it cannot be told from that export', async () => {
    await selectAll(page, app);
    await clickApp(page, app, 'the File menu', AT.fileMenu);
    await clickApp(page, app, 'Save Session in the File menu', AT.fileSave);
    const { save: saved, bytes } = await hostSave(page, 3);
    expectExport(saved, 'craftsuite-probe.scraftz');
    expectSession(bytes, 'craftsuite-probe', ['Tone A', 'Tone B'], ['Tone A', 'Tone B']);
    expectNoDownloads(downloads);
  });
});
