// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real LightCraft web build. See docs/apps/lightcraft.md. Four tests; a
// test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract   allowed host whose app URL asks for browser storage and a benchmark run
//              (store=opfs&workers=3&reset&bench): the frame runs with store=memory&workers=0, and
//              LightCraft confirms it (web.stats);
//              handshake with the served app version, open of a JPEG. After an edit, Ctrl+S (Save
//              Metadata to File, which fails on the web) sends nothing; Export arrives as a new file
//              under the opened name with the edit, and so does Export with Previous (Ctrl+E) after
//              another edit; a demo photo exported under the opened name arrives as a new file too.
//              Nothing is kept in the browser's storage, and nothing becomes a download, also not
//              after the deadlines for the host's confirmation and result. Startup: when memory mode
//              cannot be set, the host gets a startup error and the file is never handed over; a
//              failed load (no .wasm) reaches the host at once, not after the startup timeout
//   saved-as   exports under the opened file's name or type: an opened TIFF (a scan from another
//              program) exported as TIFF arrives under its own name as a new file, never as the
//              document or a copy; a different TIFF with the same name that the user brings in
//              (File > Import Photos...) exports under that name as a new file again. An opened raw
//              photo (DNG) is decoded (not shown from a preview) and exports as '<stem>.jpg', a
//              new file
//   language   the host names German (lang=de in the frame's fragment): ready reports de, which
//              the adapter does only when LightCraft answered its Edit > Language command
//              (app.language.german) with the code; the fragment is gone from the frame's address,
//              and the photo opens in memory mode without render workers, as without a language
//   ui (@ui)   the paths that need the pointer: File > Export..., a folder typed into the dialog,
//              OK: a new file under the opened name; File > Export with Previous: another one
//
// A daily canary runs this file against every new LightCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see (section
// "Contract"). LightCraft has no command palette, and its Export dialog has no keyboard path to OK.
// The steps use its shortcuts (crates/engine/src/cmd/*.rs, crates/ui-egui/src/shortcuts.rs) and its
// automation call, globalThis.lightcraft.command (index.html; apps/lightcraft-web/src/web.rs), which
// runs the commands its menus run by id: app.export is what the Export dialog's OK runs. The
// adapter relies on that call too (web.stats, and Edit > Language for the host's language). Only
// the test tagged @ui also clicks with the pointer: a moved menu item fails it without the
// translator being at fault.
//
// With workers=0 LightCraft renders on the page's own thread, one picture per frame, and every
// session starts by rendering the thumbnails of 24 demo photos: for the first minute or two a frame
// (and so each key press and each automation call) can take seconds in Chromium with SwiftShader.
// The tests wait for what the app reports (photo.inspect, web.stats), never for fixed times, and
// are marked slow. Pointer clicks need short frames, so the @ui test first waits until those
// renders are done (see untilRendered()).
//
// The fixtures in fixtures/lightcraft/ are written by its make-fixtures.mjs.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { press, waitForTextEditing } from '../lib/craft-ui.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures/lightcraft/', import.meta.url));
// The pictures of the fixtures (make-fixtures.mjs), width x height.
const PHOTO = { width: 120, height: 80 }; // probe-photo.jpg
const SCAN = { width: 90, height: 60 }; // probe-scan.tif
const ELSEWHERE = { width: 64, height: 64 }; // elsewhere/probe-scan.tif
const RAW = { width: 96, height: 64 }; // probe-raw.dng
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/lightcraft/`;
// Translator timeouts (host knobs app-ack, app-result) where a test waits for them, in ms. Longer
// than in the other specs: the translator's timers run on the page's thread, which LightCraft
// blocks for seconds at a time (main-thread rendering, see below). The result timeout also limits
// reading the download, so one frame longer than it right after an export made the translator
// give the save up (seen with 3 s: frames of up to 7 s).
const SHORT_ACK = 20_000;
const SHORT_RESULT = 20_000;
// The Export dialog's Folder must hold some text on the web (only the file name reaches the
// download); exports through the automation call name one too.
const FOLDER = 'Exports';
// Where `npm run craft:fetch` records the selected builds, as in server/serve.mjs.
const SELECTED = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)),
  process.env.CRAFT_BUILDS_DIR || '.craft-builds', 'selected.json');

// What the test host records in window.__host (tests/e2e/host/host.js).
interface HostSave {
  id: number;
  kind: 'document' | 'export';
  openId: number | null;
  follows: number | null;
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
  started: { id: number; name: string }[];
  errors: { of: string; id: number | null; message: string }[];
  opened: { id: number; name: string } | null;
  readies: { layerVersion: string; language: string | null }[]; // language 'absent': no field
}
type HostWindow = Window & {
  __host?: HostRecord;
  __appVersions?: unknown[]; // see recordAppVersions()
  CRAFTSUITE_TEST?: { versions?: Record<string, string> }; // the test server's config.js
};
// LightCraft's automation call (index.html): a command id and its parameters as JSON text, the
// result as JSON text.
type AppWindow = Window & { lightcraft?: { command(id: string, params: string): Promise<string> } };
// The active photo as photo.inspect reports it (crates/engine/src/cmd/query.rs).
interface Photo {
  id: number; file_name: string; width: number; height: number; kind: string; format: string; history: string[];
  preview_only?: string; // why a raw shows only its embedded preview; absent when it is decoded
}
// What web.stats reports (apps/lightcraft-web/src/web.rs).
interface WebStats { storage: string; workers: { alive: number }; renderQueue: number; rendersInFlight: number }

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

// Pinned: the @ui click positions depend on the layout and on the language of LightCraft's labels.
// LightCraft 0.6.0 ignores the browser's language (it starts in English unless the host names one,
// as in the language test); the locale is pinned in case a release starts to follow it.
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
// UI: drive LightCraft. egui draws everything into one canvas; what the app knows comes from its
// automation call.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on LightCraft 0.6.0), relative to the app frame at a 1400x1400
// viewport: the Export dialog is taller than the frame of a 900 px viewport, and egui centres it.
// This is the only layout knowledge in this file; when a release moves something, fix it here.
const AT = {
  // Menu bar, after the sidebar and history buttons: File.
  fileMenu: (b: Box) => ({ x: b.x + 140, y: b.y + 20 }),
  // File menu: Export..., the first row of its fifth group (after Import, Library, New and
  // Presets/Keywords).
  fileExport: (b: Box) => ({ x: b.x + 186, y: b.y + 453 }),
  // File menu: Export with Previous, the row below Export... (enabled after a first export).
  fileExportPrevious: (b: Box) => ({ x: b.x + 224, y: b.y + 479 }),
  // Export dialog: the Folder field, below File name.
  exportFolder: (b: Box) => ({ x: b.x + 742, y: b.y + 875 }),
  // Export dialog: OK, right of Cancel at the bottom left.
  exportOk: (b: Box) => ({ x: b.x + 549, y: b.y + 1010 }),
};

function appFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url().startsWith(APP));
  if (!frame) throw new Error(`no frame shows ${APP}`);
  return frame;
}

// Runs a command through LightCraft's automation call and returns its result. The app runs it on
// its next frame; a command that fails rejects with LightCraft's message.
async function lightcraft<T = unknown>(app: Frame, id: string, params: Record<string, unknown> = {}): Promise<T> {
  const answer = await app.evaluate(([id, params]) => (window as AppWindow).lightcraft!.command(id, params), [id, JSON.stringify(params)] as const);
  return JSON.parse(answer) as T;
}

// The photo LightCraft shows (the active one).
const activePhoto = (app: Frame) => lightcraft<Photo>(app, 'photo.inspect');

async function untilPhoto(app: Frame, what: string, done: (photo: Photo) => boolean, timeout = 90_000) {
  await expect.poll(async () => done(await activePhoto(app).catch(() => ({}) as Photo)), { message: what, timeout }).toBe(true);
}

// Resolves once the app has run at least `n` more frames: each automation call is answered on a
// frame of its own. Used where a pointer action must reach the app before the next one.
async function appTicks(app: Frame, n = 2) {
  for (let i = 0; i < n; i++) await lightcraft(app, 'web.stats');
}

// For the @ui test: waits until LightCraft has rendered what it queued (the demo thumbnails). egui
// takes a press and a release more than 0.8 s apart on its frame clock for a long press, not a
// click, so a click whose press and release land in two frames of seconds each is lost; keys have
// no such limit.
async function untilRendered(app: Frame) {
  await test.step('ui: wait until LightCraft has rendered what it queued (web.stats)', async () => {
    await expect.poll(async () => {
      const stats = await lightcraft<WebStats>(app, 'web.stats');
      return stats.renderQueue + stats.rendersInFlight;
    }, { message: 'renders queued or running', timeout: 240_000, intervals: [1000] }).toBe(0);
  });
}

// For the @ui test: a click at a point from AT, after a frame with the pointer over the target,
// as a user's pointer comes there first; the app has handled it when this returns.
async function clickApp(page: Page, app: Frame, what: string, at: (b: Box) => { x: number; y: number }) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const { x, y } = at(box);

  await test.step(`ui: click ${what}`, async () => {
    await page.mouse.move(x, y);
    await appTicks(app, 1);
    await page.mouse.click(x, y);
    await appTicks(app);
  });
}

// For the @ui test: File > <item>. The menu opens on the click and closes after the item ran.
async function fileMenu(page: Page, app: Frame, what: string, item: (b: Box) => { x: number; y: number }) {
  await clickApp(page, app, 'the File menu', AT.fileMenu);
  await clickApp(page, app, `${what} in the File menu`, item);
}

// Photo > Rotate Right (Cmd+], crates/engine/src/cmd/library.rs): the edit the tests export. It
// swaps the width and height of every export.
async function rotateRight(page: Page, app: Frame) {
  await test.step('ui: Rotate Right (Ctrl+])', async () => {
    const before = (await activePhoto(app)).history.length;
    await press(page, app, 'Control+BracketRight');
    await untilPhoto(app, 'the rotation is in the photo\'s history', (p) => p.history.length > before);
  });
}

// What the Export dialog's OK runs, with the dialog's Folder (and its other choices as `params`).
async function exportPhoto(app: Frame, what: string, params: Record<string, unknown> = {}) {
  await test.step(`ui: ${what} (app.export)`, async () => {
    await lightcraft(app, 'app.export', { dir: FOLDER, ...params });
  });
}

// Library > Previous Photo (Left): the photo before the active one in the filmstrip, where the
// opened photo comes after the demo photos.
async function previousPhoto(page: Page, app: Frame) {
  await test.step('ui: Previous Photo (Left)', async () => {
    const before = (await activePhoto(app)).id;
    await press(page, app, 'ArrowLeft');
    await untilPhoto(app, 'another photo is active', (p) => p.id !== before);
  });
}

// File > Import Photos... (Cmd+Shift+I), with a file from the user's disk through the browser's
// file picker. LightCraft imports it and makes it the active photo.
async function importFromDisk(page: Page, app: Frame, file: string) {
  await test.step(`ui: File > Import Photos... (Ctrl+Shift+I) of ${path.basename(file)} from the disk`, async () => {
    const before = (await activePhoto(app)).id;
    const chooser = page.waitForEvent('filechooser', { timeout: 30_000 });
    await press(page, app, 'Control+Shift+I');
    await (await chooser).setFiles(file);
    await untilPhoto(app, 'the imported photo is active', (p) => p.id !== before);
  });
}

// Loads the test host with a fixture and waits until LightCraft shows it.
async function openInHost(page: Page, name: string, query = '') {
  await page.goto(`${HOST}?target=lightcraft&name=${encodeURIComponent(`lightcraft/${name}`)}${query}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  // The app reads the dropped file and imports it a few frames after the drop.
  await untilPhoto(app, `${name} is in the library and active`, (p) => p.file_name === name);
  return app;
}

// ---------------------------------------------------------------------------------------------
// Contract: what the host and the browser see.
// ---------------------------------------------------------------------------------------------

const hostRecord = (page: Page): Promise<HostRecord> => page.evaluate(() => (window as HostWindow).__host!);

// The host record keeps only type, app, id and kind of each message, so record the appVersion of
// each ready message the host page receives. Call before loading the page.
async function recordAppVersions(page: Page) {
  await page.addInitScript((appOrigin) => {
    if (window !== window.top) return; // init scripts also run in the app frame
    const versions: unknown[] = ((window as HostWindow).__appVersions = []);
    window.addEventListener('message', (event) => {
      const msg = event.data as { protocol?: string; type?: string; appVersion?: unknown } | null;
      if (event.origin === appOrigin && msg?.protocol === 'craftsuite-layer' && msg.type === 'ready') versions.push(msg.appVersion);
    });
  }, APP_ORIGIN);
}

async function untilHost(page: Page, what: string, done: (h: HostRecord) => boolean, timeout = 60_000) {
  await expect.poll(async () => done(await hostRecord(page)), { message: what, timeout }).toBe(true);
}

// The first occurrence of each message type the host received, in order.
async function messageTypes(page: Page) {
  return [...new Set((await hostRecord(page)).messages.map((m) => m.type))];
}

// The n-th save (from 1) the host received, with the bytes it kept.
async function hostSave(page: Page, n: number) {
  await untilHost(page, `save #${n} reached the host`, (h) => h.saves.length >= n);
  const save = (await hostRecord(page)).saves[n - 1];
  const bytes = Buffer.from(save.base64 ?? '', 'base64');
  if (!save.unconfirmed) {
    expect(createHash('sha256').update(bytes).digest('hex'), 'the host hashed the bytes it kept').toBe(save.sha256);
    expect(save.size).toBe(bytes.length);
  }
  return { save, bytes };
}

// Every download of LightCraft: a new file, never the opened one, and no lineage of copies.
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, follows: null, name });
}

// The type and size of an exported picture, from its bytes: JPEG (the first frame header) or TIFF
// (the first IFD).
function picture(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 9 < bytes.length && bytes[at] === 0xff;) {
      const marker = bytes[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      }
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  const order = bytes.toString('latin1', 0, 2);
  if (order === 'II' || order === 'MM') {
    const le = order === 'II';
    const u16 = (at: number) => (le ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at));
    const u32 = (at: number) => (le ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at));
    const ifd = u32(4);
    const size = { type: 'tiff', width: 0, height: 0 };
    for (let k = 0; k < u16(ifd); k++) {
      const entry = ifd + 2 + k * 12;
      const value = u16(entry + 2) === 3 ? u16(entry + 8) : u32(entry + 8);
      if (u16(entry) === 256) size.width = value;
      if (u16(entry) === 257) size.height = value;
    }
    return size;
  }
  return { type: 'unknown', width: 0, height: 0 };
}

// The picture of a fixture with `turns` quarter turns applied.
const turned = (type: string, { width, height }: { width: number; height: number }, turns = 0) =>
  (turns % 2 ? { type, width: height, height: width } : { type, width, height });

// What the frame keeps in the browser's storage for its origin: OPFS entries, IndexedDB
// databases, Web Storage keys and Cache Storage caches. An API the browser lacks or refuses in
// the frame counts as empty: the app cannot store anything there either (WebKit refuses OPFS in
// this cross-site frame).
function browserStorage(app: Frame) {
  return app.evaluate(async () => {
    type Dir = { entries(): AsyncIterable<[string, { kind: string }]> };
    const opfs: string[] = [];
    const walk = async (dir: Dir, prefix: string) => {
      for await (const [name, handle] of dir.entries()) {
        opfs.push(prefix + name);
        if (handle.kind === 'directory') await walk(handle as unknown as Dir, prefix + name + '/');
      }
    };
    const root = await navigator.storage?.getDirectory?.().catch(() => null);
    if (root) await walk(root as unknown as Dir, '');
    const indexedDb = indexedDB.databases ? (await indexedDB.databases()).map((d) => String(d.name)) : [];
    const cacheStorage = typeof caches === 'undefined' ? [] : await caches.keys();
    return { opfs, indexedDb, localStorage: Object.keys(localStorage), sessionStorage: Object.keys(sessionStorage), cacheStorage };
  });
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// ---------------------------------------------------------------------------------------------

test('contract: memory mode, an allowed host opens the photo and gets every export as a new file, nothing is downloaded', async ({ context }) => {
  test.slow(); // main-thread rendering, see the header

  await scenario(context, 'the photo opens in memory mode; Ctrl+S sends nothing, every export is a new file', async (page, downloads) => {
    await recordAppVersions(page);
    // A configured app URL that asks for the stored library, render workers, its deletion and a
    // benchmark run (which would select another photo and change its Exposure).
    const app = await openInHost(page, 'probe-photo.jpg',
      `&app-store=opfs&app-workers=3&app-reset=1&app-bench=1&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

    await test.step('handshake: hello, ready with the served app version, delivered', async () => {
      expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
      const { messages } = await hostRecord(page);
      expect.soft(messages.filter((m) => m.app !== 'lightcraft'), 'messages from another app than lightcraft').toEqual([]);
      expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
      // The frame runs the build the run selected. A test server started before a later
      // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
      const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
      const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.lightcraft);
      expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.lightcraft);
      expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
    });

    await test.step('the adapter set memory mode without render workers, and LightCraft runs in it', async () => {
      const query = new URL(app.url()).searchParams;
      expect.soft(query.get('store'), 'store in the frame\'s URL').toBe('memory');
      expect.soft(query.get('workers'), 'workers in the frame\'s URL').toBe('0');
      expect.soft(query.has('reset'), 'reset in the frame\'s URL').toBe(false);
      expect.soft(query.has('bench'), 'bench in the frame\'s URL').toBe(false);
      const stats = await lightcraft<WebStats>(app, 'web.stats');
      expect.soft(stats.storage, 'storage LightCraft reports').toBe('memory');
      expect.soft(stats.workers.alive, 'render workers LightCraft runs').toBe(0);
    });

    await test.step('after an edit, Ctrl+S (Save Metadata to File) sends nothing; Export is a new file under the opened name, with the edit', async () => {
      await rotateRight(page, app);
      await press(page, app, 'Control+s');
      // Keys are handled after automation calls within a frame: wait two frames, so that the
      // export runs after the frame that handled Ctrl+S. If Ctrl+S had downloaded anything, it
      // would be save #1 (and the count at the end would be off).
      await appTicks(app);
      await exportPhoto(app, 'Export');
      const { save, bytes } = await hostSave(page, 1);
      expectExport(save, 'probe-photo.jpg');
      expect(picture(bytes), 'a JPEG of the opened photo, rotated').toEqual(turned('jpeg', PHOTO, 1));
      expect((await hostRecord(page)).started.map((s) => s.name), 'saves announced so far').toEqual(['probe-photo.jpg']);
    });

    await test.step('after another edit, Export with Previous (Ctrl+E) is a new file again', async () => {
      await rotateRight(page, app);
      await press(page, app, 'Control+e');
      const { save, bytes } = await hostSave(page, 2);
      expectExport(save, 'probe-photo.jpg');
      expect(picture(bytes), 'a JPEG of the opened photo, rotated twice').toEqual(turned('jpeg', PHOTO, 2));
    });

    await test.step('a demo photo exported under the opened name is a new file', async () => {
      // Every session starts with 24 demo photos, LightCraft's stand-in for new documents. The
      // file name template can give any of them the opened file's name.
      await previousPhoto(page, app);
      await exportPhoto(app, 'Export of a demo photo, file name probe-photo, 300 px', { naming: 'probe-photo', longEdge: 300 });
      const { save, bytes } = await hostSave(page, 3);
      expectExport(save, 'probe-photo.jpg');
      const size = picture(bytes);
      expect(Math.max(size.width, size.height), 'the demo photo at 300 px, not the opened photo').toBe(300);
    });

    await test.step('nothing is kept in the browser\'s storage', async () => {
      expect(await browserStorage(app)).toEqual({ opfs: [], indexedDb: [], localStorage: [], sessionStorage: [], cacheStorage: [] });
    });

    await test.step('nothing becomes a download, also not after both deadlines', async () => {
      // Every save was stored, so nothing may fall back to a download, also not once the deadlines
      // for the confirmation and for the result have passed for the last save. Short deadlines,
      // real time: eframe cannot run under a fake clock.
      // eslint-disable-next-line playwright/no-wait-for-timeout -- nothing may happen in this time
      await page.waitForTimeout(Math.max(SHORT_ACK, SHORT_RESULT) + 1000);
      const host = await hostRecord(page);
      expect.soft(host.errors, 'errors the host got').toEqual([]);
      expect.soft(host.started, 'saves announced: the three exports').toHaveLength(3);
      expect.soft(host.saves, 'saves the host got').toHaveLength(3);
      expectNoDownloads(downloads);
    });
  });

  // After the scenario above: LightCraft outside memory mode writes its demo library to the
  // browser's storage of this context.
  await scenario(context, 'when memory mode cannot be set, the host gets a startup error and the photo is never handed over', async (page, downloads) => {
    await page.addInitScript((appOrigin) => {
      if (location.origin !== appOrigin) return;
      History.prototype.replaceState = () => { throw new Error('blocked by the test'); };
    }, APP_ORIGIN);
    await page.goto(`${HOST}?target=lightcraft&name=lightcraft/probe-photo.jpg`);
    await untilHost(page, 'the host got an error', (h) => h.errors.length > 0, 90_000);
    const host = await hostRecord(page);
    expect(host.errors).toEqual([
      { of: 'startup', id: null, message: expect.stringMatching(/^the app would keep the photo in browser storage \((opfs|idb)\)$/) as unknown as string },
    ]);
    expect(await messageTypes(page), 'no ready, so no open and no delivered').toEqual(['hello', 'error']);
    expect(host.opened, 'the host never sent the photo').toBeNull();
    expectNoDownloads(downloads);
  });

  await scenario(context, 'a failed load reaches the host at once, not after the startup timeout', async (page) => {
    await page.route(`${APP}lightcraft_web_bg.wasm`, (route) => route.abort());
    // The startup timeout is 60 s; LightCraft reports the failure only in its page, which the
    // adapter turns into an error event.
    await page.goto(`${HOST}?target=lightcraft&name=lightcraft/probe-photo.jpg`);
    await untilHost(page, 'the host got an error within 30 s', (h) => h.errors.length > 0, 30_000);
    expect((await hostRecord(page)).errors).toEqual([
      { of: 'startup', id: null, message: expect.stringMatching(/^the app failed to load: .*LightCraft failed to load: /) as unknown as string },
    ]);
  });
});

test('saved-as: exports under the opened file\'s name or type are new files, never the document', async ({ context }) => {
  test.slow(); // main-thread rendering, see the header

  await scenario(context, 'an opened TIFF exported as TIFF under its own name is a new file, and so is a different TIFF of that name brought in', async (page, downloads) => {
    const app = await openInHost(page, 'probe-scan.tif');
    await rotateRight(page, app);
    // LightCraft's own rendering of a file from another program: a new file next to it, never a
    // replacement and never a copy that later exports replace.
    await exportPhoto(app, 'Export as TIFF', { format: 'tiff' });
    const own = await hostSave(page, 1);
    expectExport(own.save, 'probe-scan.tif');
    expect(picture(own.bytes), 'a TIFF of the opened scan, rotated').toEqual(turned('tiff', SCAN, 1));

    // A file from the user's disk with the same name, exported with the same choices.
    await importFromDisk(page, app, path.join(FIXTURES, 'elsewhere', 'probe-scan.tif'));
    await press(page, app, 'Control+e');
    const other = await hostSave(page, 2);
    expectExport(other.save, 'probe-scan.tif');
    expect(picture(other.bytes), 'a TIFF of the file from the disk').toEqual(turned('tiff', ELSEWHERE));
    expectNoDownloads(downloads);
  });

  await scenario(context, 'an opened raw photo (DNG) is decoded and exports as <stem>.jpg, a new file', async (page, downloads) => {
    const app = await openInHost(page, 'probe-raw.dng');
    const photo = await activePhoto(app);
    // A raw LightCraft cannot decode imports with kind 'raw' too, from its embedded preview
    // (preview_only); this DNG has none, and its export size shows the mosaic was developed.
    expect({ kind: photo.kind, format: photo.format, previewOnly: photo.preview_only }, 'imported as a raw photo, not as its preview')
      .toEqual({ kind: 'raw', format: 'DNG', previewOnly: undefined });
    await exportPhoto(app, 'Export');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'probe-raw.jpg');
    expect(picture(bytes), 'a JPEG of the developed mosaic').toEqual(turned('jpeg', RAW));
    expectNoDownloads(downloads);
  });
});

test('language: the host\'s language (de) reaches LightCraft through Edit > Language, and the photo opens in memory mode', { tag: '@language' }, async ({ page }) => {
  test.slow(); // main-thread rendering, see the header
  // The host frames the app with '#craftsuite-layer:lang=de'. LightCraft reads no language as it
  // starts (in memory mode always English); the adapter's started() runs app.language.german.
  const app = await openInHost(page, 'probe-photo.jpg', '&lang=de');

  await test.step('ready reports de: LightCraft answered app.language.german with its code', async () => {
    // The web build has no query for its interface language (ui.inspect is only on the desktop
    // control channel), so the command's answer, which ready carries, is what tells.
    expect.soft((await hostRecord(page)).readies.map((r) => r.language), 'language of each ready the host got').toEqual(['de']);
  });

  await test.step('memory mode without render workers, as without a language; the fragment is gone', async () => {
    const url = new URL(app.url());
    expect.soft(url.hash, 'fragment in the frame\'s address').toBe('');
    expect.soft(url.searchParams.get('store'), 'store in the frame\'s URL').toBe('memory');
    expect.soft(url.searchParams.get('workers'), 'workers in the frame\'s URL').toBe('0');
    const stats = await lightcraft<WebStats>(app, 'web.stats');
    expect.soft(stats.storage, 'storage LightCraft reports').toBe('memory');
    expect.soft(stats.workers.alive, 'render workers LightCraft runs').toBe(0);
  });
});

test('ui: File > Export… and File > Export with Previous with the pointer', { tag: '@ui' }, async ({ page }) => {
  test.slow(); // main-thread rendering, see the header
  await page.setViewportSize({ width: 1400, height: 1400 }); // see AT
  const downloads = trackDownloads(page);
  const app = await openInHost(page, 'probe-photo.jpg');
  await untilRendered(app);

  await test.step('File > Export…, a folder typed in, OK: a new file under the opened name', async () => {
    await fileMenu(page, app, 'Export…', AT.fileExport);
    await clickApp(page, app, 'the Folder field of the Export dialog', AT.exportFolder);
    await waitForTextEditing(app, true, 'the Folder field did not take the focus');
    await page.keyboard.insertText(FOLDER); // no key events: stray letters could be shortcuts
    await appTicks(app);
    await clickApp(page, app, 'OK in the Export dialog', AT.exportOk);
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'probe-photo.jpg');
    // The dialog's default, 2048 px on the long edge without enlarging, keeps the small photo.
    expect(picture(bytes), 'a JPEG of the opened photo').toEqual(turned('jpeg', PHOTO));
  });

  await test.step('File > Export with Previous: another new file', async () => {
    await fileMenu(page, app, 'Export with Previous', AT.fileExportPrevious);
    const { save } = await hostSave(page, 2);
    expectExport(save, 'probe-photo.jpg');
    expectNoDownloads(downloads);
  });
});
