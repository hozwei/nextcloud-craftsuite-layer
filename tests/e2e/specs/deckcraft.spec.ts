// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real DeckCraft web build. See docs/apps/deckcraft.md. Three tests; a
// test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract   allowed host: handshake with the served app version, open of a .deckcraft whose
//              stored title differs from its name; a new slide saved with Ctrl+S arrives as the
//              document under the opened name, a DeckCraft file with the opened text and the new
//              slide, and Save As (Ctrl+Shift+S) after another new slide is the document again;
//              Export (PDF) and the save of a new presentation (Ctrl+N) arrive as new files;
//              nothing becomes a download, also not after the deadlines for the host's
//              confirmation and result
//   saved-as   saves under another name, copies, new presentations and files from the user: an
//              opened .pptx saves as '<stem>.deckcraft', as the document, keeping its creation
//              time, and so does the next save; 'Deck.v2.PPSX' saves as 'Deck.v2.deckcraft'. A
//              .deckcraft written by a newer DeckCraft, and a PowerPoint file named .deckcraft,
//              save as a copy: the first save is a new file, the next one replaces that file.
//              The blank of the "+ New" entry in Files (blanks/blank.deckcraft) opens, and its
//              first save, without an edit, is the document. Presentation2.deckcraft from
//              PowerPoint (a creation time) saves as the document, while a new presentation
//              (Ctrl+N) and the sample deck (Next Window) saved meanwhile are new files.
//              Presentation2.deckcraft and 'Northern Lights.deckcraft' without a creation time
//              are never saved back. A PowerPoint file the adapter did not see arrive, and a
//              presentation with the opened name that the user opens with Open (Ctrl+O; in
//              Chromium also one dropped from the desktop), save as new files
//   ui (@ui)   with the pointer, on an opened .pptx: a slide from the New Slide menu, then the
//              title bar's Save button saves the document; the PowerPoint choice of the Export
//              dialog, under the opened name, arrives as a new file
//
// A daily canary runs this file against every new DeckCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see
// (section "Contract"). Steps use the keyboard and the command palette (Ctrl+Shift+P), with
// shortcuts and labels from DeckCraft's crates/ui-egui/src/menus.rs, ui-egui/src/lib.rs
// (UI_COMMANDS) and engine/src/cmd/. Only the test tagged @ui also clicks with the pointer: a moved
// button fails it without the translator being at fault.
//
// The fixtures are in fixtures/deckcraft/: craftsuite-probe.pptx, written by make-fixtures.mjs,
// and craftsuite-probe.deckcraft, DeckCraft 0.5.0's save of the same slide without a creation time.
// Both hold one slide with MARKER and the stored title 'Stored title differs'. The other files the
// tests open are derived from them below.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { appFrames, press, runCommand, settle } from '../lib/craft-ui.ts';

const PROBE = readFileSync(new URL('../fixtures/deckcraft/craftsuite-probe.deckcraft', import.meta.url));
const PPTX = readFileSync(new URL('../fixtures/deckcraft/craftsuite-probe.pptx', import.meta.url));
const MARKER = 'CRAFTSUITE-PROBE-dk01';
const OTHER = 'CRAFTSUITE-OTHER-dk02'; // the text of otherPresentation()
const CREATED = '2025-01-02T03:04:05Z'; // the creation time in craftsuite-probe.pptx
const NATIVE_TYPE = 'application/vnd.storyteller.deckcraft+zip';
const PALETTE = 'Control+Shift+P';
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/deckcraft/`;
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

// Pinned: the @ui click positions depend on the layout, and DeckCraft's labels on the language.
// Scale factor 1 also in WebKit (Desktop Safari has 2), where software rendering is slow.
test.use({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' });

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

// A scenario that needs a trusted drop (dropFromDesktop) runs in Chromium only; elsewhere the
// test notes that it did not run.
async function chromiumOnly(browserName: string, run: () => Promise<void>) {
  if (browserName === 'chromium') return run();
  test.info().annotations.push({ type: 'skipped scenario', description: 'a drop from the desktop needs Chromium (DevTools protocol)' });
}

// ---------------------------------------------------------------------------------------------
// UI: drive DeckCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on DeckCraft 0.5.0), relative to the app frame at the pinned
// viewport. This is the only layout knowledge in this file; when a release moves something, fix
// it here.
const AT = {
  // Title bar: Save, the floppy disk after the home button (ribbon.rs title_bar).
  titleSave: (b: Box) => ({ x: b.x + 47, y: b.y + 18 }),
  // Home tab: the lower half of New Slide, which opens its menu of layouts.
  newSlideMenu: (b: Box) => ({ x: b.x + 171, y: b.y + 130 }),
  // New Slide menu: Title Only, the second layout of the second row.
  newSlideTitleOnly: (b: Box) => ({ x: b.x + 309, y: b.y + 258 }),
  // Export dialog: PowerPoint Presentation (.pptx), the fifth choice.
  exportPowerPoint: (b: Box) => ({ x: b.x + 645, y: b.y + 289 }),
  // Export dialog: the Export button once PowerPoint is chosen (the PDF options are gone); by
  // 0.11.1 the dialog lists Outline/RTF as an eighth choice, which moved it down from y 432.
  exportButton: (b: Box) => ({ x: b.x + 833, y: b.y + 456 }),
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
    await settle(page.locator('#app'), app);
  });
}

// New Slide (slide.new, engine/src/cmd/slide.rs): the edit the tests save. Wait until the
// app shows the slide: a key pressed in the frames right after the palette closed can get lost
// (DeckCraft ignores keys while an egui widget still has the focus, ui-egui/src/lib.rs keyboard).
async function newSlide(page: Page, app: Frame) {
  await runCommand(page, app, 'New Slide', PALETTE);
  await settle(page.locator('#app'), app);
}

// New Presentation (file.new, Cmd+N, engine/src/cmd/file.rs): another document, 'Presentation2' in a
// session that started with the sample deck.
async function newPresentation(page: Page, app: Frame) {
  await test.step('ui: new presentation (Ctrl+N)', async () => {
    await press(page, app, 'Control+n');
    await settle(page.locator('#app'), app);
  });
}

// Next Window (window.next): the next open document, after the last the first. Its
// shortcut Cmd+` does nothing in the web build, so through the palette.
async function nextWindow(page: Page, app: Frame) {
  await runCommand(page, app, 'Next Window', PALETTE);
  await settle(page.locator('#app'), app);
}

// The Export dialog (app.exportDialog; the palette's label 'Export…' would first find
// file.export, which needs a path) with its default, PDF, confirmed with Enter
// (ui-egui/src/dialogs.rs: buttons).
async function exportPdf(page: Page, app: Frame) {
  await runCommand(page, app, 'app.exportDialog', PALETTE);
  await settle(page.locator('#app'), app); // the dialog

  await test.step('ui: Export (Enter)', () => page.keyboard.press('Enter'));
}

// Open (app.openDialog, Ctrl+O) of a file from the user's disk, through the browser's file picker.
async function openFromDisk(page: Page, app: Frame, name: string, bytes: Buffer) {
  await test.step(`ui: Open (Ctrl+O) of ${name} from the disk`, async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await press(page, app, 'Control+o');
    await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
    await settle(page.locator('#app'), app); // another document
  });
}

// A user's drag and drop of a file from the desktop onto the middle of the app. Only Chromium
// can send such a trusted drop (DevTools protocol), see chromiumOnly().
async function dropFromDesktop(page: Page, app: Frame, name: string, bytes: Buffer) {
  const file = test.info().outputPath('desktop', name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await test.step(`ui: drop ${name} from the desktop`, async () => {
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, ...at, data });
    await cdp.detach();
    await settle(page.locator('#app'), app); // another document
  });
}

// A file that reaches DeckCraft in a way the adapter does not see: a synthetic drop like the
// translator's own (not trusted, so the adapter does not note it), dispatched in the app frame.
async function dropUnseen(page: Page, app: Frame, name: string, bytes: Buffer) {
  await test.step(`ui: ${name} reaches the app unseen (a synthetic drop)`, async () => {
    await app.evaluate(({ name, base64 }) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], name));
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('no canvas');
      const box = canvas.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer,
        clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
      canvas.dispatchEvent(new DragEvent('dragover', init));
      canvas.dispatchEvent(new DragEvent('drop', init));
    }, { name, base64: bytes.toString('base64') });
    await settle(page.locator('#app'), app); // another document
  });
}

// Loads the test host with a fixture and waits until the translator has handed it to the app.
// `bytes` serves those bytes under `name` instead of a file in fixtures/deckcraft/. 'blanks/<file>'
// opens a blank of the Nextcloud app's "+ New" entries (craftsuite_layer/assets/) as '<file>'.
async function openInHost(page: Page, name: string, query = '', bytes?: Buffer) {
  if (bytes) {
    await page.route(`${HOST}files/deckcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  }
  const file = name.startsWith('blanks/') ? name : `deckcraft/${name}`;
  await page.goto(`${HOST}?target=deckcraft&name=${encodeURIComponent(file)}${query}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  await settle(page.locator('#app'), app); // the app reads the file and opens it some frames after the drop
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
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, follows: null, name });
}

// The content of a zip's first entry if it is a stored 'mimetype', as DeckCraft writes its files
// (format/src/lib.rs, save).
function zipMimetype(bytes: Buffer) {
  if (bytes.length < 30 || bytes.readUInt32LE(0) !== 0x04034b50) return null;
  const size = bytes.readUInt32LE(18);
  const nameLength = bytes.readUInt16LE(26);
  const start = 30 + nameLength + bytes.readUInt16LE(28);
  if (bytes.readUInt16LE(8) !== 0 || bytes.toString('latin1', 30, 30 + nameLength) !== 'mimetype') return null;
  return bytes.toString('latin1', start, start + size);
}

interface Manifest {
  generator: string;
  presentation: { slides: Record<string, unknown>[]; props: { created: string } } & Record<string, unknown>;
}

// A DeckCraft file: its slides, creation time and whether it holds `text`.
function deckcraftFile(bytes: Buffer) {
  expect(zipMimetype(bytes), 'a DeckCraft file (first zip entry mimetype)').toBe(NATIVE_TYPE);
  const json = strFromU8(unzipSync(bytes)['presentation.json']);
  const manifest = JSON.parse(json) as Manifest;
  return {
    slides: manifest.presentation.slides.length,
    created: manifest.presentation.props.created,
    has: (text: string) => json.includes(text),
  };
}

// PROBE with a changed manifest, written as DeckCraft writes its files: 'mimetype' first and
// stored, presentation.json deflated.
function changedProbe(change: (manifest: Manifest) => void) {
  const files = unzipSync(PROBE);
  const manifest = JSON.parse(strFromU8(files['presentation.json'])) as Manifest;
  change(manifest);
  const out: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    out[name] = [name === 'presentation.json' ? strToU8(JSON.stringify(manifest)) : data, { level: name === 'mimetype' ? 0 : 6 }];
  }
  return Buffer.from(zipSync(out));
}

// PROBE as DeckCraft saves a presentation that came from PowerPoint: with its creation time.
const fromPowerPoint = () => changedProbe((m) => { m.presentation.props.created = CREATED; });
// PROBE as a newer DeckCraft would write it: another generator, and fields 0.5.0 does not know.
const FUTURE = 'CRAFTSUITE-FUTURE-FIELD';
const fromNewerDeckCraft = () => changedProbe((m) => {
  m.generator = 'DeckCraft 9.0.0';
  m.presentation.futureField = FUTURE;
  m.presentation.slides[0].futureField = FUTURE;
});
// Another presentation without a creation time, as on the user's disk.
const otherPresentation = () => changedProbe((m) => {
  m.presentation.slides = JSON.parse(JSON.stringify(m.presentation.slides).replaceAll(MARKER, OTHER)) as Record<string, unknown>[];
});

// The opened presentation, saved with `added` slides more than the fixture has.
function expectSavedPresentation(bytes: Buffer, added: number, created = '') {
  const saved = deckcraftFile(bytes);
  expect(saved.has(MARKER), 'the opened presentation\'s text').toBe(true);
  expect(saved.slides, `the fixture's slide and ${added} new`).toBe(1 + added);
  expect(saved.created, 'the creation time').toBe(created);
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, 'craftsuite-probe.deckcraft', `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'deckcraft'), 'messages from another app than deckcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.deckcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.deckcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('Ctrl+S saves the edit as the document, under the opened name, not the stored title', async () => {
    await newSlide(page, app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.deckcraft');
    expectSavedPresentation(bytes, 1);
  });

  await test.step('Save As (Ctrl+Shift+S) after another edit is the document again', async () => {
    await newSlide(page, app);
    await press(page, app, 'Control+Shift+S');
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, 'craftsuite-probe.deckcraft');
    expectSavedPresentation(bytes, 2);
  });

  await test.step('Export (PDF) arrives as a new file', async () => {
    await exportPdf(page, app);
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'craftsuite-probe.pdf');
    expect(bytes.subarray(0, 5).toString('latin1'), 'a PDF').toBe('%PDF-');
  });

  await test.step('the save of a new presentation arrives as a new file', async () => {
    await newPresentation(page, app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 4);
    expectExport(save, 'Presentation2.deckcraft');
    expect(deckcraftFile(bytes).has(MARKER), 'not the opened presentation').toBe(false);
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

test('saved-as: saves under another name, copies, new presentations and files from the user', async ({ context, browserName }) => {
  // Ten scenarios in a page each (nine outside Chromium).
  test.slow();

  await scenario(context, 'an opened .pptx saves as <stem>.deckcraft, the document, and so does the next save', async (page, downloads) => {
    const app = await openInHost(page, 'craftsuite-probe.pptx');
    await press(page, app, 'Control+s');
    const first = await hostSave(page, 1);
    // A DeckCraft file named after the PowerPoint file: the host stores it next to the PPTX,
    // which stays as it is. It keeps the creation time, the identity of the document.
    expectDocument(first.save, 'craftsuite-probe.deckcraft');
    expectSavedPresentation(first.bytes, 0, CREATED);

    await newSlide(page, app);
    await press(page, app, 'Control+s');
    const second = await hostSave(page, 2);
    expectDocument(second.save, 'craftsuite-probe.deckcraft');
    expectSavedPresentation(second.bytes, 1, CREATED);
    expectNoDownloads(downloads);
  });

  // DeckCraft opens these names in any letter case and titles them up to the last dot
  // (ui-egui/src/lib.rs open_or_insert_bytes, engine/src/cmd/file.rs add_opened).
  const renamed: [opened: string, bytes: Buffer, saved: string][] = [
    ['Deck.v2.PPSX', PPTX, 'Deck.v2.deckcraft'],
  ];
  for (const [opened, bytes, saved] of renamed) {
    await scenario(context, `'${opened}' saves as '${saved}', the document`, async (page, downloads) => {
      const app = await openInHost(page, opened, '', bytes);
      await press(page, app, 'Control+s');
      const { save, bytes: stored } = await hostSave(page, 1);
      expectDocument(save, saved);
      expectSavedPresentation(stored, 0, CREATED);
      expectNoDownloads(downloads);
    });
  }

  // Save rewrites the opened file from what DeckCraft 0.5.0 knows, under the opened name, so the
  // opened file must stay: a newer DeckCraft's fields are dropped, and a PowerPoint package named
  // .deckcraft (DeckCraft picks the reader by content, engine/src/cmd/file.rs open_presentation)
  // would be replaced by DeckCraft's re-encoding.
  const copies: [what: string, bytes: Buffer, created: string][] = [
    ['a .deckcraft from a newer DeckCraft', fromNewerDeckCraft(), ''],
    ['a PowerPoint file named .deckcraft', PPTX, CREATED],
  ];
  for (const [what, bytes, created] of copies) {
    await scenario(context, `${what} saves as a copy: a new file, which the next save replaces`, async (page, downloads) => {
      const app = await openInHost(page, 'craftsuite-probe.deckcraft', '', bytes);
      await press(page, app, 'Control+s');
      const first = await hostSave(page, 1);
      // It follows its own id, which names no file the host has: the host makes it a new file.
      expect(first.save).toMatchObject({ kind: 'document', openId: 1, follows: first.save.id, name: 'craftsuite-probe.deckcraft' });
      expectSavedPresentation(first.bytes, 0, created);
      expect(deckcraftFile(first.bytes).has(FUTURE), 'what DeckCraft 0.5.0 does not know is gone').toBe(false);

      await newSlide(page, app);
      await press(page, app, 'Control+s');
      const second = await hostSave(page, 2);
      expect(second.save).toMatchObject({ kind: 'document', openId: 1, follows: first.save.id, name: 'craftsuite-probe.deckcraft' });
      expectSavedPresentation(second.bytes, 1, created);
      expectNoDownloads(downloads);
    });
  }

  // The blank of the "+ New" entry in Files: a native file from DeckCraft 0.5.0 with a creation
  // time, which Save keeps. Should a release not open it, Ctrl+S saves the sample deck, a new file.
  await scenario(context, 'the + New blank opens and its first save replaces it', async (page, downloads) => {
    const app = await openInHost(page, 'blanks/blank.deckcraft');
    await press(page, app, 'Control+s');
    expectDocument((await hostSave(page, 1)).save, 'blank.deckcraft');
    expectNoDownloads(downloads);
  });

  await scenario(context, 'Presentation2.deckcraft from PowerPoint saves as the document; a new presentation and the sample deck saved meanwhile are new files', async (page, downloads) => {
    // The opened file and a new presentation are both titled 'Presentation2' and save as
    // 'Presentation2.deckcraft'; only the creation time stored in the opened file tells them apart.
    const app = await openInHost(page, 'Presentation2.deckcraft', '', fromPowerPoint());
    await press(page, app, 'Control+s');
    const own = await hostSave(page, 1);
    expectDocument(own.save, 'Presentation2.deckcraft');
    expectSavedPresentation(own.bytes, 0, CREATED);

    await newPresentation(page, app);
    await press(page, app, 'Control+s');
    const other = await hostSave(page, 2);
    expectExport(other.save, 'Presentation2.deckcraft');
    expect(deckcraftFile(other.bytes).has(MARKER), 'the new presentation, not the opened one').toBe(false);

    await nextWindow(page, app); // after the last document the first: the sample deck
    await press(page, app, 'Control+s');
    expectExport((await hostSave(page, 3)).save, 'Northern Lights.deckcraft');

    await nextWindow(page, app); // the opened presentation
    await newSlide(page, app);
    await press(page, app, 'Control+s');
    const again = await hostSave(page, 4);
    expectDocument(again.save, 'Presentation2.deckcraft');
    expectSavedPresentation(again.bytes, 1, CREATED);
    expectNoDownloads(downloads);
  });

  // A new presentation or the sample deck saves under these names, and a file made in DeckCraft
  // has no creation time to tell it from them.
  for (const opened of ['Presentation2.deckcraft', 'Northern Lights.deckcraft']) {
    await scenario(context, `${opened} without a creation time is never saved back`, async (page, downloads) => {
      const app = await openInHost(page, opened, '', PROBE);
      await press(page, app, 'Control+s');
      const { save, bytes } = await hostSave(page, 1);
      expectExport(save, opened);
      expectSavedPresentation(bytes, 0);
      expectNoDownloads(downloads);
    });
  }

  await scenario(context, 'a PowerPoint file that arrives unseen and a presentation the user opens with the opened name are never the document', async (page, downloads) => {
    const app = await openInHost(page, 'craftsuite-probe.deckcraft');
    await press(page, app, 'Control+s');
    expectDocument((await hostSave(page, 1)).save, 'craftsuite-probe.deckcraft'); // before the others arrived

    // The adapter does not see this file arrive, but its save has a creation time, which
    // DeckCraft never sets and the opened file lacks.
    await dropUnseen(page, app, 'craftsuite-probe.pptx', PPTX);
    await press(page, app, 'Control+s'); // saves the active document: the PowerPoint file
    const unseen = await hostSave(page, 2);
    expectExport(unseen.save, 'craftsuite-probe.deckcraft');
    expect(deckcraftFile(unseen.bytes).created, 'the PowerPoint file\'s creation time').toBe(CREATED);

    // No creation time on either, but the adapter saw the user's file arrive.
    await openFromDisk(page, app, 'craftsuite-probe.deckcraft', otherPresentation());
    await press(page, app, 'Control+s'); // saves the active document: the file from the disk
    const fromDisk = await hostSave(page, 3);
    expectExport(fromDisk.save, 'craftsuite-probe.deckcraft');
    expect(deckcraftFile(fromDisk.bytes).has(OTHER), 'the presentation from the disk').toBe(true);
    expectNoDownloads(downloads);
  });

  await chromiumOnly(browserName, () => scenario(context, 'a presentation with the opened name dropped from the desktop is never the document', async (page, downloads) => {
    const app = await openInHost(page, 'craftsuite-probe.deckcraft');
    await dropFromDesktop(page, app, 'craftsuite-probe.deckcraft', otherPresentation());
    await press(page, app, 'Control+s'); // saves the active document: the dropped file
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'craftsuite-probe.deckcraft');
    expect(deckcraftFile(bytes).has(OTHER), 'the dropped presentation').toBe(true);
    expectNoDownloads(downloads);
  }));
});

test('ui: the New Slide menu, the Save button and the Export dialog with the pointer', { tag: '@ui' }, async ({ context }) => {
  await scenario(context, 'a slide from the New Slide menu, then the title bar\'s Save button saves the document', async (page, downloads) => {
    const app = await openInHost(page, 'craftsuite-probe.pptx');
    await clickApp(page, app, 'the New Slide menu', AT.newSlideMenu);
    await clickApp(page, app, 'Title Only in the New Slide menu', AT.newSlideTitleOnly);
    await clickApp(page, app, 'Save in the title bar', AT.titleSave);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.deckcraft');
    expectSavedPresentation(bytes, 1, CREATED);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'PowerPoint in the Export dialog, under the opened name, arrives as a new file', async (page, downloads) => {
    // DeckCraft's re-encoding of what it read: it must not replace the opened file.
    const app = await openInHost(page, 'craftsuite-probe.pptx');
    await runCommand(page, app, 'app.exportDialog', PALETTE);
    await settle(page.locator('#app'), app); // the dialog
    await clickApp(page, app, 'PowerPoint Presentation in the Export dialog', AT.exportPowerPoint);
    await clickApp(page, app, 'Export in the Export dialog', AT.exportButton);
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'craftsuite-probe.pptx');
    expect(Object.keys(unzipSync(bytes)), 'a PowerPoint package').toContain('ppt/presentation.xml');
    expectNoDownloads(downloads);
  });
});
