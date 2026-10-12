// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real FilmCraft web build. See docs/apps/filmcraft.md. Four tests; a
// test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract   allowed host: handshake with the served app version, 'ready' only once FilmCraft's
//              graphics run (#loading removed), although its drop listener came earlier; the frame
//              address carries FilmCraft's flag `fresh` next to the host's query; open of a
//              .fcproj whose stored name differs from its file name; a marker saved with Ctrl+S
//              arrives as the document under the opened name, with the edit, and so does the next
//              Ctrl+S; Save a Copy (Ctrl+Alt+S) and the save of a new project (Ctrl+Alt+N) arrive
//              as new files; nothing becomes a download, also not after the deadlines for the
//              host's confirmation and result. Without WebGL2 and WebGPU the host gets a startup
//              error and no 'ready'
//   saved-as   saves under other names: File > Export > Selection as FilmCraft Project… of an
//              opened '<stored name> Selection.fcproj' (a subset with the opened name and a stored
//              name to match, but no editor view) is a new file; Save As (Ctrl+Shift+S) first
//              writes '<stored name>.fcproj', the document, and so does the next Ctrl+S; Save a
//              Copy of an opened
//              '<name> copy.fcproj' is a new file, the next Ctrl+S the document; the first save of
//              an older schema brings FilmCraft's backup of the original as a new file, then the
//              document; saves named like the projects FilmCraft makes ('FilmCraft Demo.fcproj',
//              the Save As of an opened 'Untitled.fcproj' storing that name, and 'Untitled.fcproj',
//              a new project saved under the opened name) are new files; an opened EDL is
//              imported, and its export under the opened name is a new file; after a project file
//              with the opened name from the user's disk (Chromium: a drop from the desktop;
//              WebKit: Open Project), Ctrl+S is a new file; where OPFS can be written, a project
//              FilmCraft refuses leaves neither an earlier session's unsaved project of the same
//              name nor its media open (`fresh`), and the save of what is open is a new file
//   language   the host's language (lang=de) under the browser locale en-US: ready reports 'de',
//              FilmCraft reports German as its interface language (ui.inspect) and labels File >
//              Save 'Speichern' (ui.menu.list), and it has the opened .fcproj open
//   ui (@ui)  the File menu with the pointer, on an opened .fcproj: Save saves the document;
//              Export > EDL… arrives as a new file
//
// A daily canary runs this file against every new FilmCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see (section
// "Contract"). FilmCraft has no command palette; the steps use its keyboard shortcuts
// (crates/engine/src/shortcut_presets.rs) and, for menu commands without one (File > Export >
// EDL… and Selection as FilmCraft Project…) and for selecting an item in the Project panel, the
// page's own automation API window.filmcraft, whose execute() runs a command the way its menu
// item or click does (crates/ui-egui/src/control.rs, menus::invoke). Only the test tagged @ui
// clicks with the pointer: a moved menu item fails it without the translator being at fault.
//
// The fixtures in fixtures/filmcraft/: 'FilmCraft Demo.fcproj' and 'Main Edit.edl' were saved by
// FilmCraft 0.6.0; make-fixtures.mjs derives craftsuite-probe.fcproj (stored name 'Probe Title',
// MARKER as its project notes) and old-schema.fcproj (schema 14) from the former.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { appFrames, press, settle } from '../lib/craft-ui.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/filmcraft/${name}`, import.meta.url));
const PROBE = fixture('craftsuite-probe.fcproj');
const OLD = fixture('old-schema.fcproj');
const MARKER = 'CRAFTSUITE-PROBE-fc01';
const STORED = 'Probe Title'; // the project name stored in PROBE
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/filmcraft/`;
// Translator timeouts (host knobs app-ack, app-result) where a test waits for them, in ms.
const SHORT_ACK = 3000;
const SHORT_RESULT = 3000;
// Where `npm run craft:fetch` records the selected builds, as in server/serve.mjs.
const SELECTED = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)),
  process.env.CRAFT_BUILDS_DIR || '.craft-builds', 'selected.json');

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
  readies: { layerVersion: string; language: string | null }[]; // language 'absent': no such field
}
type HostWindow = Window & {
  __host?: HostRecord;
  __ready?: { at: number[]; versions: unknown[] }; // see recordStartup()
  CRAFTSUITE_TEST?: { versions?: Record<string, string> }; // the test server's config.js
};
// FilmCraft's automation API on its own page (apps/filmcraft-web/src/api.rs), as far as used here.
interface FilmcraftApi {
  request(method: string, params?: unknown): Promise<unknown>;
  execute(command: string, params?: unknown): Promise<unknown>;
  importFiles(files: File): Promise<{ paths: string[]; errors: unknown[] }>;
  files(): { path: string; size: number; kind: string }[];
  info(): { restoredMedia?: number };
}
type AppWindow = Window & {
  filmcraft?: FilmcraftApi;
  __startup?: { drop: number | null; loadingSeen: boolean; loadingGone: number | null }; // see recordStartup()
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

// Pinned: the @ui click positions depend on the layout, and FilmCraft's labels follow the
// browser's languages.
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
// UI: drive FilmCraft. egui draws everything into one canvas; FilmCraft's own automation API
// (window.filmcraft) tells what it shows.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on FilmCraft 0.6.0), relative to the app frame at the pinned
// viewport. This is the only layout knowledge in this file; when a release moves something, fix
// it here.
const AT = {
  // Menu bar, after the Import, Edit and Export modes: File.
  fileMenu: (b: Box) => ({ x: b.x + 254, y: b.y + 19 }),
  // File menu: Export, the third row (after New and Import From), which opens a submenu.
  fileExport: (b: Box) => ({ x: b.x + 300, y: b.y + 96 }),
  // File > Export: EDL…, the first row of the submenu, level with Export.
  exportEdl: (b: Box) => ({ x: b.x + 629, y: b.y + 96 }),
  // File menu: Save, the ninth row (after Close All Other Projects).
  fileSave: (b: Box) => ({ x: b.x + 300, y: b.y + 240 }),
};

function appFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url().startsWith(APP));
  if (!frame) throw new Error(`no frame shows ${APP}`);
  return frame;
}

// What FilmCraft lists as on screen (window.filmcraft's ui.elements), by element id and label.
const elements = (app: Frame) => app.evaluate(() => (window as AppWindow).filmcraft!.request('ui.elements')
  .then((list) => (list as { id: string; label: string }[]).map(({ id, label }) => ({ id, label })), () => []));

// Waits until FilmCraft shows what `shown` looks for. Should a release list its elements
// otherwise, fall back to waiting until the picture stands still; the contract checks decide.
async function untilShown(page: Page, app: Frame, what: string, shown: (list: { id: string; label: string }[]) => boolean) {
  try {
    await expect.poll(async () => shown(await elements(app)), { message: what, timeout: 30_000 }).toBe(true);
  } catch {
    test.info().annotations.push({ type: 'warning', description: `FilmCraft did not show: ${what}` });
    await settle(page.locator('#app'), app);
  }
}

// The project FilmCraft has open, as its Project panel shows it: '<project name>.fcproj'.
const showsProject = (page: Page, app: Frame, name: string) => untilShown(page, app, `the project ${name}`,
  (list) => list.some((e) => e.id === 'project.breadcrumb' && e.label === `${name}.fcproj`));

// Markers > Add Marker (M) at the playhead: the edit the tests save. FilmCraft handles each key in
// its next frame, so a few frames later the next shortcut cannot overtake it.
async function addMarker(page: Page, app: Frame) {
  await test.step('ui: add a marker (M)', async () => {
    await press(page, app, 'm');
    await appFrames(app, 3);
  });
}

// A shortcut, followed by a few frames for FilmCraft to handle it.
async function shortcut(page: Page, app: Frame, what: string, key: string) {
  await test.step(`ui: ${what} (${key})`, async () => {
    await press(page, app, key);
    await appFrames(app, 3);
  });
}

// File > New > Project… (Ctrl+Alt+N): a new project 'Untitled', without a dialog.
async function newProject(page: Page, app: Frame) {
  await shortcut(page, app, 'a new project', 'Control+Alt+n');
  await showsProject(page, app, 'Untitled');
}

// A command of FilmCraft's menu, run the way its menu item runs it.
async function menuCommand(app: Frame, command: string) {
  await test.step(`ui: run ${command} as its menu item does`, async () => {
    const result = await app.evaluate((command) => (window as AppWindow).filmcraft!.execute(command, {})
      .then(() => 'ok', (e: Error) => e.message), command);
    expect(result, command).toBe('ok');
  });
}

// Selects a project item as a click on it in the Project panel does (project.select,
// crates/ui-egui/src/panels/project_views.rs).
async function selectItem(app: Frame, item: string) {
  await test.step(`ui: select item ${item} in the Project panel`, async () => {
    const result = await app.evaluate((item) => (window as AppWindow).filmcraft!.execute('project.select', { items: [Number(item)] })
      .then(() => 'ok', (e: Error) => e.message), item);
    expect(result, 'project.select').toBe('ok');
  });
}

// For the @ui test: a click at a point from AT, after a hover frame so egui sees the target.
async function clickApp(page: Page, app: Frame, what: string, at: (b: Box) => { x: number; y: number }) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const { x, y } = at(box);

  await test.step(`ui: click ${what}`, async () => {
    await page.mouse.move(x, y, { steps: 4 });
    await appFrames(app, 2);
    await page.mouse.click(x, y);
  });
}

// For the @ui test: File > ... The menu opens on the click; a submenu on hovering its row.
async function fileMenu(page: Page, app: Frame) {
  await clickApp(page, app, 'the File menu', AT.fileMenu);
  await untilShown(page, app, 'the File menu', (list) => list.some((e) => e.id === 'menu.file.save'));
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

// File > Open Project… (Ctrl+O) with a file from the user's disk. Without the File System Access
// picker (WebKit, Firefox) FilmCraft asks through an <input type=file>; Chromium has the picker
// and blocks it in a frame of another origin.
async function openFromDisk(page: Page, app: Frame, file: string) {
  await test.step(`ui: File > Open Project… (Ctrl+O) of ${path.basename(file)} from the disk`, async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await press(page, app, 'Control+o');
    await (await chooser).setFiles(file);
  });
}

// A media file imported by the user (File > Import… or a drop), through FilmCraft's own API.
async function importMedia(app: Frame, name: string, bytes: Buffer) {
  return test.step(`ui: import ${name}`, () => app.evaluate(([name, base64]) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return (window as AppWindow).filmcraft!.importFiles(new File([data], name));
  }, [name, bytes.toString('base64')] as const));
}

// Runs `run` only where FilmCraft can keep files in the origin's storage (OPFS, written with
// createWritable as in apps/filmcraft-web/src/opfs.rs); elsewhere the test notes that it did not
// run. The tests' WebKit (Playwright's WPE build) fails every OPFS call with UnknownError, so
// FilmCraft keeps nothing between sessions there.
async function withOpfs(app: Frame, run: () => Promise<void>) {
  const writable = await app.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const stream = await (await root.getFileHandle('craftsuite-probe', { create: true })).createWritable();
      await stream.write('probe');
      await stream.close();
      await root.removeEntry('craftsuite-probe');
      return true;
    } catch {
      return false;
    }
  });
  if (writable) return run();
  test.info().annotations.push({ type: 'skipped scenario', description: 'FilmCraft cannot write OPFS in this browser, so it keeps nothing from earlier sessions' });
}

// Loads the test host with a fixture and waits until FilmCraft has taken it: a project once FilmCraft
// read it (as '/projects/<name>'), opened it a frame later and shows the project `shows` (by
// default the name stored in the file; FilmCraft's own demo project shows before), anything else
// once its import is registered ('/files/<name>'). `bytes` serves those bytes under `name` instead
// of a file in fixtures/filmcraft/.
async function openInHost(page: Page, name: string, options: { query?: string; bytes?: Buffer; shows?: string } = {}) {
  if (options.bytes) {
    const body = options.bytes;
    await page.route(`${HOST}files/filmcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body, contentType: 'application/octet-stream' }));
  }
  await page.goto(`${HOST}?target=filmcraft&name=${encodeURIComponent(`filmcraft/${name}`)}${options.query ?? ''}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  const project = /\.fcproj$/i.test(name);
  const read = `${project ? '/projects/' : '/files/'}${name}`;
  await expect.poll(() => app.evaluate((read) => (window as AppWindow).filmcraft!.files().some((f) => f.path === read), read),
    { message: `FilmCraft read ${name}` }).toBe(true);
  await appFrames(app, 5);
  const shows = options.shows ?? (project ? storedName(options.bytes ?? fixture(name)) : null);
  if (shows) await showsProject(page, app, shows);
  return app;
}

// ---------------------------------------------------------------------------------------------
// Contract: what the host and the browser see.
// ---------------------------------------------------------------------------------------------

const hostRecord = (page: Page): Promise<HostRecord> => page.evaluate(() => (window as HostWindow).__host!);

// Times, in the clock both documents share (Date.now()), of what decides when the app can take
// files: in the app frame, FilmCraft's first `drop` listener and the removal of #loading; in the
// host page, each ready message with its appVersion (the host record keeps neither). Call before
// loading the page.
async function recordStartup(page: Page) {
  await page.addInitScript((appOrigin) => {
    if (location.origin === appOrigin) {
      const marks = { drop: null as number | null, loadingSeen: false, loadingGone: null as number | null };
      (window as AppWindow).__startup = marks;
      // Runs before the translator, which wraps this in turn.
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: Parameters<EventTarget['addEventListener']>) {
        if (args[0] === 'drop' && marks.drop === null) marks.drop = Date.now();
        return add.apply(this, args);
      };
      new MutationObserver(() => {
        if (document.getElementById('loading')) marks.loadingSeen = true;
        else if (marks.loadingSeen && marks.loadingGone === null) marks.loadingGone = Date.now();
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
  const save = (await hostRecord(page)).saves[n - 1];
  const bytes = Buffer.from(save.base64 ?? '', 'base64');
  if (!save.unconfirmed) {
    expect(createHash('sha256').update(bytes).digest('hex'), 'the host hashed the bytes it kept').toBe(save.sha256);
    expect(save.size).toBe(bytes.length);
  }
  return { save, bytes };
}

// The opened document: the host may replace its file with these bytes (or, under another name
// than the opened one, store them next to it and replace that file on later saves).
function expectDocument(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'document', openId: 1, name });
}

// Anything else (exports, other projects): the host stores it as a new file.
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, name });
}

// A FilmCraft project file (crates/format/src/lib.rs): the envelope and what the tests look at.
interface Fcproj {
  format?: string;
  schema_version?: number;
  project: { name: string; notes?: string; items: Record<string, { kind: { Sequence?: { markers?: unknown[] } } }> };
  view?: { active_sequence?: number };
}
const fcproj = (bytes: Buffer) => JSON.parse(bytes.toString('utf8')) as Fcproj;
const storedName = (bytes: Buffer) => {
  try {
    return fcproj(bytes).project.name;
  } catch {
    return null; // not a project: FilmCraft imports it
  }
};
const markers = (doc: Fcproj) => Object.values(doc.project.items).reduce((n, item) => n + (item.kind.Sequence?.markers?.length ?? 0), 0);
const FIXTURE_MARKERS = markers(fcproj(PROBE));
const FIXTURE_ITEMS = Object.keys(fcproj(PROBE).project.items).length;
const SEQUENCE = String(fcproj(PROBE).view!.active_sequence); // the item id of its sequence 'Main Edit'

// PROBE with another stored name and notes.
function renamedProbe(name: string, notes: string) {
  const doc = fcproj(PROBE) as Fcproj & { project: { root: { name: string } } };
  doc.project.name = name;
  doc.project.root.name = name;
  doc.project.notes = notes;
  return Buffer.from(JSON.stringify(doc));
}

// The opened project as Save writes it: FilmCraft's envelope with the editor view, renamed after
// the file, with `added` markers more than the fixture.
function expectSavedProject(bytes: Buffer, name: string, added: number) {
  const doc = fcproj(bytes);
  expect(doc.format, 'a FilmCraft project').toBe('filmcraft.project');
  expect(doc.view, 'the editor view, which only Save, Save As and Save a Copy write').toBeTruthy();
  expect(doc.project.name, 'the project, named after the file').toBe(name);
  expect(doc.project.notes, 'the opened project\'s notes').toBe(MARKER);
  expect(markers(doc), `the fixture's markers and ${added} added`).toBe(FIXTURE_MARKERS + added);
}

// One second of a 440 Hz tone, 8 kHz mono 16-bit PCM: a media file FilmCraft imports.
function toneWav() {
  const rate = 8000;
  const wav = Buffer.alloc(44 + rate * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + rate * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
  return wav;
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the project and stores every save, nothing is downloaded', async ({ page, context }) => {
  const downloads = trackDownloads(page);
  await recordStartup(page);
  const app = await openInHost(page, 'craftsuite-probe.fcproj', { query: `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}` });

  await test.step('handshake: hello, ready with the served app version once the graphics run, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'filmcraft'), 'messages from another app than filmcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.filmcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.filmcraft);
    const ready = (await page.evaluate(() => (window as HostWindow).__ready))!;
    expect.soft(ready.versions, 'appVersion of the one ready').toEqual([served]);
    // FilmCraft listens for drops before its graphics start and removes #loading once they run.
    // The core alone would send ready at the first listener; the adapter's started() holds it
    // back until #loading is gone (a drop in between would wait, forever if the graphics fail).
    const marks = (await app.evaluate(() => (window as AppWindow).__startup))!;
    expect.soft(marks.drop, 'FilmCraft registered a drop listener').not.toBeNull();
    expect.soft(marks.loadingGone, 'FilmCraft removed #loading').not.toBeNull();
    expect.soft(marks.drop!, 'the drop listener comes before the graphics run').toBeLessThan(marks.loadingGone!);
    expect.soft(ready.at[0], 'ready only once #loading is gone').toBeGreaterThanOrEqual(marks.loadingGone!);
  });

  await test.step('the frame address carries FilmCraft\'s flag fresh after the host\'s query', async () => {
    // Set by the adapter before FilmCraft reads it; the effect is checked in saved-as.
    expect(new URL(app.url()).search).toBe(`?ack=${SHORT_ACK}&result=${SHORT_RESULT}&fresh`);
  });

  await test.step('Ctrl+S saves the edit as the document, under the opened name, not the stored one', async () => {
    await addMarker(page, app);
    await shortcut(page, app, 'Save', 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.fcproj');
    expectSavedProject(bytes, 'craftsuite-probe', 1);
  });

  await test.step('Ctrl+S after another edit is the document again', async () => {
    await shortcut(page, app, 'one frame on', 'ArrowRight');
    await shortcut(page, app, 'one frame on', 'ArrowRight');
    await addMarker(page, app);
    await shortcut(page, app, 'Save', 'Control+s');
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, 'craftsuite-probe.fcproj');
    expectSavedProject(bytes, 'craftsuite-probe', 2);
  });

  await test.step('Save a Copy (Ctrl+Alt+S) arrives as a new file', async () => {
    await shortcut(page, app, 'Save a Copy', 'Control+Alt+s');
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'craftsuite-probe copy.fcproj');
    expectSavedProject(bytes, 'craftsuite-probe', 2);
  });

  await test.step('the save of a new project arrives as a new file', async () => {
    await newProject(page, app);
    await shortcut(page, app, 'Save', 'Control+s');
    const { save, bytes } = await hostSave(page, 4);
    expectExport(save, 'Untitled.fcproj');
    expect(Object.keys(fcproj(bytes).project.items), 'the new, empty project').toEqual([]);
  });

  await test.step('nothing becomes a download, also not after both deadlines', async () => {
    // Every save was stored, so nothing may fall back to a download, also not once the deadlines
    // for the confirmation and for the result have passed for the last save. Short deadlines,
    // real time: eframe cannot run under a fake clock.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- nothing may happen in this time
    await page.waitForTimeout(Math.max(SHORT_ACK, SHORT_RESULT) + 1000);
    expect.soft((await hostRecord(page)).errors, 'errors the host got').toEqual([]);
    expect.soft((await hostRecord(page)).saves, 'saves the host got').toHaveLength(4);
    expectNoDownloads(downloads);
  });

  await test.step('without WebGL2 and WebGPU: a startup error instead of ready, though FilmCraft listened for drops', async () => {
    const other = await context.newPage();
    await recordStartup(other);
    await withoutGraphics(other);
    await other.goto(`${HOST}?target=filmcraft&name=filmcraft/craftsuite-probe.fcproj`);
    await untilHost(other, 'an error reached the host', (h) => h.errors.length > 0, 60_000);
    const record = await hostRecord(other);
    expect(record.errors).toEqual([{ of: 'startup', id: null, message: expect.stringMatching(/^the app failed to start: failed to create wgpu surface/) }]);
    expect(record.messages.map((m) => m.type), 'no ready, so no open').not.toContain('ready');
    // FilmCraft reloads itself once with ?webgl when the error names the graphics (index.html),
    // and keeps the adapter's flag. Its drop listener was there: only started() kept ready back.
    const frame = appFrame(other);
    expect(new URL(frame.url()).search).toBe('?fresh&webgl');
    expect((await frame.evaluate(() => (window as AppWindow).__startup))?.drop, 'FilmCraft registered a drop listener').not.toBeNull();
    await other.close();
  });
});

test('saved-as: saves under other names, project files from elsewhere, and what FilmCraft keeps from earlier sessions', async ({ context, browserName }) => {
  test.slow(); // eight page loads of the 43 MB app
  await scenario(context, 'Export Selection as Project under the opened name is a new file; Save As (Ctrl+Shift+S) first writes <stored name>.fcproj, the document, and so does the next Ctrl+S', async (page, downloads) => {
    // Opened as '<stored name> Selection.fcproj', the name File > Export > Selection as
    // FilmCraft Project… gives its subset, which stores that stem as its name: only the missing
    // editor view tells it from a save (crates/engine/src/project_tools.rs export_selection).
    const app = await openInHost(page, `${STORED} Selection.fcproj`, { bytes: PROBE });
    await selectItem(app, SEQUENCE);
    await menuCommand(app, 'file.exportSelectionProject');
    const subset = await hostSave(page, 1);
    expectExport(subset.save, `${STORED} Selection.fcproj`);
    const part = fcproj(subset.bytes);
    expect(part.project.name, 'the subset, named after its file').toBe(`${STORED} Selection`);
    expect(part.view, 'no editor view').toBeUndefined();
    expect(Object.keys(part.project.items).length, 'only the selected sequence and what it uses').toBeLessThan(FIXTURE_ITEMS);

    await addMarker(page, app);
    await shortcut(page, app, 'Save As', 'Control+Shift+S');
    const first = await hostSave(page, 2);
    // FilmCraft names it after the project, not the file; the host stores it next to the opened file.
    expectDocument(first.save, `${STORED}.fcproj`);
    expectSavedProject(first.bytes, STORED, 1);

    await addMarker(page, app);
    await shortcut(page, app, 'Save', 'Control+s');
    const second = await hostSave(page, 3);
    expectDocument(second.save, `${STORED}.fcproj`);
    expectSavedProject(second.bytes, STORED, 2);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'Save a Copy of an opened \'<name> copy.fcproj\' is a new file; the next Ctrl+S is the document', async (page, downloads) => {
    // The integration makes such files: Save a Copy of a project stored as 'Probe Title' writes
    // 'Probe Title copy.fcproj', which still stores 'Probe Title' (Save a Copy renames nothing).
    const app = await openInHost(page, `${STORED} copy.fcproj`, { bytes: PROBE });
    await addMarker(page, app);
    await shortcut(page, app, 'Save a Copy', 'Control+Alt+s');
    const copy = await hostSave(page, 1);
    expectExport(copy.save, `${STORED} copy.fcproj`);
    expectSavedProject(copy.bytes, STORED, 1);

    await shortcut(page, app, 'Save', 'Control+s');
    const own = await hostSave(page, 2);
    expectDocument(own.save, `${STORED} copy.fcproj`);
    expectSavedProject(own.bytes, `${STORED} copy`, 1);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'an older schema: FilmCraft\'s backup of the original is a new file, the save the document', async (page, downloads) => {
    const app = await openInHost(page, 'old-schema.fcproj');
    await shortcut(page, app, 'Save', 'Control+s');
    const backup = await hostSave(page, 1);
    expectExport(backup.save, 'old-schema (schema v14 backup).fcproj');
    expect(backup.bytes.equals(OLD), 'the backup holds the opened bytes').toBe(true);
    const own = await hostSave(page, 2);
    expectDocument(own.save, 'old-schema.fcproj');
    expect(fcproj(own.bytes), 'the project in the current schema').toMatchObject({ schema_version: 15, project: { name: 'old-schema' } });
    expectNoDownloads(downloads);
  });

  // Names FilmCraft gives the projects it makes: a project file stores no identity, so a save
  // under them cannot be told from a new project's.
  await scenario(context, 'saves named like FilmCraft\'s own projects are new files: Save As of a project storing \'FilmCraft Demo\', and a new project saved as the opened \'Untitled.fcproj\'', async (page, downloads) => {
    const app = await openInHost(page, 'Untitled.fcproj', { bytes: renamedProbe('FilmCraft Demo', MARKER) });
    await shortcut(page, app, 'Save As', 'Control+Shift+S');
    const demo = await hostSave(page, 1);
    expectExport(demo.save, 'FilmCraft Demo.fcproj'); // the name a Save As of the opened file gets
    expect(fcproj(demo.bytes).project.notes, 'the opened project, not FilmCraft\'s demo').toBe(MARKER);

    await newProject(page, app);
    await shortcut(page, app, 'Save', 'Control+s');
    const other = await hostSave(page, 2);
    expectExport(other.save, 'Untitled.fcproj'); // the opened name
    expect(Object.keys(fcproj(other.bytes).project.items), 'the new, empty project').toEqual([]);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'an opened EDL is imported; its export under the opened name and the project\'s save are new files', async (page, downloads) => {
    const app = await openInHost(page, 'Main Edit.edl');
    await menuCommand(app, 'file.exportEdl');
    expectExport((await hostSave(page, 1)).save, 'Main Edit.edl');
    // The EDL went into the project FilmCraft opened at start.
    await shortcut(page, app, 'Save', 'Control+s');
    expectExport((await hostSave(page, 2)).save, 'FilmCraft Demo.fcproj');
    expectNoDownloads(downloads);
  });

  await scenario(context, 'after a project file from the user\'s disk with the opened name, Ctrl+S is a new file', async (page, downloads) => {
    const app = await openInHost(page, 'craftsuite-probe.fcproj');
    const file = test.info().outputPath('disk', 'craftsuite-probe.fcproj');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, renamedProbe('Other Project', 'FROM-THE-DISK'));
    // A drop from the desktop works in every browser; the file picker of Open Project only
    // without the File System Access API, which Chromium blocks in the frame.
    if (browserName === 'chromium') await dropFromDesktop(page, file);
    else await openFromDisk(page, app, file);
    await showsProject(page, app, 'Other Project');
    await shortcut(page, app, 'Save', 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'craftsuite-probe.fcproj');
    expect(fcproj(bytes).project.notes, 'the project from the disk').toBe('FROM-THE-DISK');
    expectNoDownloads(downloads);
  });

  await scenario(context, 'a refused project leaves an earlier session\'s unsaved project and media closed (fresh); its save is a new file', async (page, downloads) => {
    // An earlier session: unsaved changes to a project named 'corrupt' and an imported WAV, which
    // FilmCraft keeps in the origin's storage (OPFS) to reopen at its next start.
    let app = await openInHost(page, 'earlier.fcproj', { bytes: renamedProbe('corrupt', 'EARLIER-SESSION') });
    await withOpfs(app, async () => {
      expect((await importMedia(app, 'tone.wav', toneWav())).paths).toEqual(['/files/tone.wav']);
      await expect.poll(() => app.evaluate(async () => {
        try {
          const root = await navigator.storage.getDirectory();
          const recovery = await root.getDirectoryHandle('recovery');
          const meta = JSON.parse(await (await (await recovery.getFileHandle('meta.json')).getFile()).text()) as { dirty?: boolean; name?: string };
          await (await root.getDirectoryHandle('media')).getFileHandle('tone.wav');
          return meta.dirty === true && meta.name === 'corrupt';
        } catch {
          return false;
        }
      }), { message: 'FilmCraft stored the unsaved project and the WAV in OPFS' }).toBe(true);

      // The host opens 'corrupt.fcproj', a schema 15 project that FilmCraft cannot read. Without
      // `fresh` the recovered 'corrupt' would stay open and its Ctrl+S would have the opened name.
      const corrupt = Buffer.from(JSON.stringify({ format: 'filmcraft.project', schema_version: 15, generator: 'FilmCraft 0.6.0', project: { name: 'corrupt', items: 5 } }));
      app = await openInHost(page, 'corrupt.fcproj', { bytes: corrupt, shows: 'FilmCraft Demo' });
      expect(new URL(app.url()).searchParams.has('fresh'), 'the flag is set').toBe(true);
      const paths = await app.evaluate(() => (window as AppWindow).filmcraft!.files().map((f) => f.path));
      expect(paths.filter((p) => p.startsWith('/recovered/') || p.startsWith('/files/')), 'nothing reopened from the earlier session').toEqual([]);
      expect(await app.evaluate(() => (window as AppWindow).filmcraft!.info().restoredMedia), 'media registered from OPFS').toBe(0);
      await shortcut(page, app, 'Save', 'Control+s');
      expectExport((await hostSave(page, 1)).save, 'FilmCraft Demo.fcproj');
      // The same media again takes its own name, so its copy in OPFS replaces the earlier one
      // instead of piling up as 'tone (2).wav'.
      expect((await importMedia(app, 'tone.wav', toneWav())).paths).toEqual(['/files/tone.wav']);
    });
    expectNoDownloads(downloads);
  });
});

// FilmCraft follows navigator.languages on its first frame (its preference is always 'system': the
// web build stores none); the adapter's language member puts the host's language first in it.
// Under the pinned locale en-US, lang=de must start FilmCraft in German.
test('language: the host\'s lang=de starts FilmCraft in German, and the project opens as without it', { tag: '@language' }, async ({ page }) => {
  const app = await openInHost(page, 'craftsuite-probe.fcproj', { query: '&lang=de' });

  await test.step('ready reports de, and FilmCraft shows German: its interface language and the label of File > Save', async () => {
    expect.soft((await hostRecord(page)).readies[0]?.language, 'language of the ready message').toBe('de');
    // FilmCraft answers a request before its frame applies the language, so a reply on its very
    // first frame can still say 'en'.
    await expect.poll(() => app.evaluate(() => (window as AppWindow).filmcraft!.request('ui.inspect')
      .then((reply) => (reply as { ui?: { language?: unknown } }).ui?.language, (e: Error) => e.message)),
    { message: 'the interface language FilmCraft reports (ui.inspect)' }).toBe('de');
    const save = await app.evaluate(() => (window as AppWindow).filmcraft!.request('ui.menu.list')
      .then((items) => (items as { id: string; label: string }[]).find((item) => item.id === 'file.save')?.label));
    expect.soft(save, 'the label of File > Save (ui.menu.list)').toBe('Speichern');
  });

  await test.step('FilmCraft has the opened project open', async () => {
    const project = await app.evaluate(() => (window as AppWindow).filmcraft!.execute('project.inspect', {}));
    expect(project, 'the open project (project.inspect)').toMatchObject({ name: STORED, path: '/projects/craftsuite-probe.fcproj' });
  });
});

test('ui: File > Save and File > Export > EDL… with the pointer', { tag: '@ui' }, async ({ page }) => {
  const downloads = trackDownloads(page);
  const app = await openInHost(page, 'craftsuite-probe.fcproj');
  await addMarker(page, app);

  await test.step('File > Save saves the document, like Ctrl+S', async () => {
    await fileMenu(page, app);
    await clickApp(page, app, 'Save in the File menu', AT.fileSave);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.fcproj');
    expectSavedProject(bytes, 'craftsuite-probe', 1);
  });

  await test.step('File > Export > EDL… arrives as a new file', async () => {
    await fileMenu(page, app);
    await clickApp(page, app, 'Export in the File menu', AT.fileExport);
    await untilShown(page, app, 'the Export submenu', (list) => list.some((e) => e.id === 'menu.file.exportEdl'));
    await clickApp(page, app, 'EDL… in the Export submenu', AT.exportEdl);
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'Main Edit.edl');
    expect(bytes.toString('utf8'), 'an EDL of the sequence').toMatch(/^TITLE: Main Edit\r?\n/);
    expectNoDownloads(downloads);
  });
});
