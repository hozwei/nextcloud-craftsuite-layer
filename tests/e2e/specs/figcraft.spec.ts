// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real FigCraft web build. See docs/apps/figcraft.md. Four tests; a
// test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract   allowed host: handshake with the served app version, open of craftsuite-probe.figcraft
//              (its document has the file's name); an edit saved with Ctrl+S arrives as the
//              document under the opened name, a FigCraft file with the edit, and Save As
//              (Ctrl+Shift+S) after another edit is the document again; Export frames to PDF and
//              the save of a new document (Ctrl+N, 'Untitled') arrive as new files; nothing becomes
//              a download, also not after the deadlines for the host's confirmation and result
//   saved-as   names: a file whose document has another name saves under that name, as the
//              document, and so does the next save; a document stored as 'Untitled' takes the
//              file's name; Untitled.figcraft cannot be told from a new document and saves as a new
//              file; a document from the user's disk (File > Open) that saves under the opened name
//              is a new file; the blank of the "+ New" entry in Files opens and its first save is
//              the document
//   language   (@language) the host's de reaches FigCraft as the browser's language: ready reports
//              de, and the actions palette runs 'Speichern' (File > Save in German)
//   ui (@ui)   the main menu with the pointer: File > Save saves the document; Export page as PNG
//              in the right panel arrives as a new file
//
// A daily canary runs this file against every new FigCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see (section
// "Contract"). The steps use FigCraft's keyboard shortcuts (crates/engine/src/keymap.rs) and its
// actions palette (Ctrl+K), which runs the command whose label matches; only the test tagged @ui
// clicks with the pointer: a moved menu item fails it without the translator being at fault.
//
// fixtures/figcraft/craftsuite-probe.figcraft is written by its make-fixtures.mjs: a document named
// 'craftsuite-probe' with one frame named MARKER.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { appFrames, press, runCommand, settle } from '../lib/craft-ui.ts';

const PROBE = readFileSync(new URL('../fixtures/figcraft/craftsuite-probe.figcraft', import.meta.url));
const MARKER = 'CRAFTSUITE-PROBE-fg01';
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/figcraft/`;
const PALETTE = 'Control+k';
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
  errors: { of: string; id: number | null; message: string }[];
  readies: { layerVersion: string; language: string | null }[];
}
type HostWindow = Window & {
  __host?: HostRecord;
  __appVersions?: unknown[]; // see recordAppVersions()
  CRAFTSUITE_TEST?: { versions?: Record<string, string> }; // the test server's config.js
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

// Pinned: the @ui click positions depend on the layout, and FigCraft's labels on the language.
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
// UI: drive FigCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on FigCraft 0.12.1), relative to the app frame at the pinned viewport.
// This is the only layout knowledge in this file; when a release moves something, fix it here.
const AT = {
  // The left rail's top: FigCraft's mark, which opens the main menu.
  mainMenu: (b: Box) => ({ x: b.x + 28, y: b.y + 65 }),
  // Main menu: File, its first row below the Actions… field; it opens a submenu to its right.
  file: (b: Box) => ({ x: b.x + 80, y: b.y + 146 }),
  // File submenu: Save, after New design file, New board, New from template…, New window, Open…,
  // Import from file…, Place image… and a separator.
  fileSave: (b: Box) => ({ x: b.x + 318, y: b.y + 351 }),
  // Right panel with nothing selected: Export page as PNG, the last button.
  exportPage: (b: Box) => ({ x: b.x + b.width - 120, y: b.y + 461 }),
};

function appFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url().startsWith(APP));
  if (!frame) throw new Error(`no frame shows ${APP}`);
  return frame;
}

// For the @ui test: a click at a point from AT, after a hover frame so egui sees the target.
async function clickApp(page: Page, app: Frame, what: string, at: (b: Box) => { x: number; y: number }) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const { x, y } = at(box);

  await test.step(`ui: click ${what}`, async () => {
    await page.mouse.move(x, y);
    await appFrames(app, 2);
    await page.mouse.click(x, y);
    await appFrames(app, 3);
  });
}

// Select All (Ctrl+A) and Duplicate (Ctrl+D): the edit the tests save, one more copy of the
// frame each time (the first time the fixture's frame, then that frame and its copies).
async function duplicateAll(page: Page, app: Frame) {
  await test.step('ui: select all and duplicate (Ctrl+A, Ctrl+D)', async () => {
    await press(page, app, 'Control+a');
    await appFrames(app, 3);
    await press(page, app, 'Control+d');
    await settle(page.locator('#app'), app);
  });
}

// File > New design file (Ctrl+N): a second document, 'Untitled', in a new tab.
async function newDocument(page: Page, app: Frame) {
  await test.step('ui: new design file (Ctrl+N)', async () => {
    await press(page, app, 'Control+n');
    await settle(page.locator('#app'), app);
  });
}

// File > Open… (Ctrl+O) with a file from the user's disk, through the browser's file picker: it
// opens as a document of its own in a new tab.
async function openFromDisk(page: Page, app: Frame, file: { name: string; buffer: Buffer }) {
  await test.step(`ui: File > Open… (Ctrl+O) of ${file.name} from the disk`, async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
    await press(page, app, 'Control+o');
    await (await chooser).setFiles({ ...file, mimeType: 'application/octet-stream' });
    await settle(page.locator('#app'), app);
  });
}

// Loads the test host with a fixture and waits until the translator has handed it to the app.
// `bytes` serves those bytes under `name` instead of a file in fixtures/figcraft/. A name under
// blanks/ is a blank of the "+ New" entries in Files (craftsuite_layer/assets/).
async function openInHost(page: Page, name: string, query = '', bytes?: Buffer) {
  if (bytes) {
    await page.route(`${HOST}files/figcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  }
  const file = name.startsWith('blanks/') ? name : `figcraft/${name}`;
  await page.goto(`${HOST}?target=figcraft&name=${encodeURIComponent(file)}${query}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  await settle(page.locator('#app'), app); // the app opens the file in a new tab a few frames after the drop
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
  expect(save).toMatchObject({ kind: 'document', openId: 1, follows: null, name });
}

// Anything else (exports, other documents): the host stores it as a new file.
function expectExport(save: HostSave, name: string | RegExp) {
  expect(save).toMatchObject({ kind: 'export', openId: null, name: typeof name === 'string' ? name : expect.stringMatching(name) });
}

// A FigCraft file: the document in its document.json (format/src/lib.rs, doc/src/lib.rs).
function figcraftDocument(bytes: Buffer) {
  const files = unzipSync(bytes);
  expect(Object.keys(files), 'a FigCraft file: a zip with document.json').toContain('document.json');
  const doc = JSON.parse(strFromU8(files['document.json'])) as { format: string; name: string; nodes: Record<string, { name: string }> };
  expect(doc.format, 'its format header').toBe('figcraft');
  return { name: doc.name, markers: Object.values(doc.nodes).filter((n) => n.name === MARKER).length };
}

// The opened document, saved with `copies` copies of its frame.
function expectSavedDocument(bytes: Buffer, copies: number) {
  expect(figcraftDocument(bytes).markers, `the fixture's frame and ${copies} copies`).toBe(1 + copies);
}

// PROBE with its document renamed (`name`), and with its frame renamed too when `frame` is given:
// the same zip as make-fixtures.mjs writes.
function probeNamed(name: string, frame = MARKER) {
  const doc = JSON.parse(strFromU8(unzipSync(PROBE)['document.json'])) as { name: string; nodes: Record<string, { name: string }> };
  doc.name = name;
  doc.nodes['2'].name = frame;
  return Buffer.from(zipSync({ 'document.json': [strToU8(JSON.stringify(doc)), { level: 6 }] }));
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, 'craftsuite-probe.figcraft', `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'figcraft'), 'messages from another app than figcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.figcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.figcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('Ctrl+S saves the edit as the document, under the opened name', async () => {
    await duplicateAll(page, app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.figcraft');
    expectSavedDocument(bytes, 1);
  });

  await test.step('Save As (Ctrl+Shift+S) after another edit is the document again', async () => {
    await duplicateAll(page, app);
    await press(page, app, 'Control+Shift+S');
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, 'craftsuite-probe.figcraft');
    expectSavedDocument(bytes, 3);
  });

  await test.step('Export frames to PDF arrives as a new file', async () => {
    await runCommand(page, app, 'Export frames to PDF', PALETTE);
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'craftsuite-probe.pdf');
    expect(bytes.subarray(0, 5).toString('latin1'), 'a PDF').toBe('%PDF-');
  });

  await test.step('the save of a new document, Untitled.figcraft, arrives as a new file', async () => {
    await newDocument(page, app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 4);
    expectExport(save, 'Untitled.figcraft');
    expect(figcraftDocument(bytes).markers, 'not the opened document').toBe(0);
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
});

test('saved-as: saves go under the document\'s name; one FigCraft cannot tell apart is a new file', async ({ context }) => {
  await scenario(context, 'a file whose document has another name saves under that name, the document, and so does the next save', async (page, downloads) => {
    // The host keeps renamed.figcraft and stores the saves next to it.
    const app = await openInHost(page, 'renamed.figcraft', '', probeNamed('Probe board'));
    await press(page, app, 'Control+s');
    const first = await hostSave(page, 1);
    expectDocument(first.save, 'Probe board.figcraft');
    expectSavedDocument(first.bytes, 0);

    await duplicateAll(page, app);
    await press(page, app, 'Control+s');
    const second = await hostSave(page, 2);
    expectDocument(second.save, 'Probe board.figcraft');
    expectSavedDocument(second.bytes, 1);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'a document stored as \'Untitled\' takes the file\'s name and saves into the file', async (page, downloads) => {
    const app = await openInHost(page, 'Plan 7.figcraft', '', probeNamed('Untitled'));
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'Plan 7.figcraft');
    expect(figcraftDocument(bytes).name, 'the name FigCraft gave the document').toBe('Plan 7');
    expectNoDownloads(downloads);
  });

  await scenario(context, 'Untitled.figcraft saves as a new file: a new document saves under the same name', async (page, downloads) => {
    const app = await openInHost(page, 'Untitled.figcraft', '', probeNamed('Untitled'));
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'Untitled.figcraft');
    expectSavedDocument(bytes, 0);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'a document from the disk (File > Open) that saves under the opened name is a new file', async (page, downloads) => {
    const app = await openInHost(page, 'craftsuite-probe.figcraft');
    await openFromDisk(page, app, { name: 'from-disk.figcraft', buffer: probeNamed('craftsuite-probe', 'FROM-DISK') });
    await press(page, app, 'Control+s');
    const other = await hostSave(page, 1);
    expectExport(other.save, 'craftsuite-probe.figcraft');
    expect(figcraftDocument(other.bytes).markers, 'the document from the disk, not the opened one').toBe(0);
    expectNoDownloads(downloads);
  });

  // The blank of the "+ New" entry in Files (craftsuite_layer/blanks.mjs): FigCraft names its
  // document, stored as 'Untitled', after the file.
  await scenario(context, 'the + New blank (blank.figcraft) opens, and its first save is the document', async (page, downloads) => {
    const app = await openInHost(page, 'blanks/blank.figcraft');
    await press(page, app, 'Control+s');
    expectDocument((await hostSave(page, 1)).save, 'blank.figcraft');
    expectNoDownloads(downloads);
  });
});

test('language: the host\'s de reaches FigCraft as the browser\'s language, and it runs German commands', { tag: '@language' }, async ({ page }) => {
  // The browser stays en-US (see test.use), so German can only come from the host.
  const app = await openInHost(page, 'craftsuite-probe.figcraft', '&lang=de');
  expect.soft((await hostRecord(page)).readies[0]?.language, 'the language ready reported').toBe('de');
  expect.soft(await app.evaluate(() => navigator.language), 'the frame\'s navigator.language').toBe('de');
  // The actions palette matches the labels in the interface language: 'Speichern' is File > Save
  // only in German.
  await runCommand(page, app, 'Speichern', PALETTE);
  expectDocument((await hostSave(page, 1)).save, 'craftsuite-probe.figcraft');
});

test('ui: File > Save in the main menu and Export page as PNG with the pointer', { tag: '@ui' }, async ({ page }) => {
  const downloads = trackDownloads(page);
  const app = await openInHost(page, 'craftsuite-probe.figcraft');

  await test.step('main menu > File > Save saves the document, like Ctrl+S', async () => {
    await clickApp(page, app, 'FigCraft\'s mark (the main menu)', AT.mainMenu);
    await settle(page.locator('#app'), app); // the menu
    await clickApp(page, app, 'File in the main menu', AT.file);
    await settle(page.locator('#app'), app); // its submenu
    await clickApp(page, app, 'Save in the File submenu', AT.fileSave);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.figcraft');
    expectSavedDocument(bytes, 0);
  });

  await test.step('Export page as PNG in the right panel arrives as a new file', async () => {
    await clickApp(page, app, 'Export page as PNG', AT.exportPage);
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'Page 1.png');
    expect(bytes.subarray(0, 8).toString('latin1'), 'a PNG').toBe('\x89PNG\r\n\x1a\n');
    expectNoDownloads(downloads);
  });
});
