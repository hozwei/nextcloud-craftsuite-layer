// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real VectorCraft web build. See docs/apps/vectorcraft.md. Four tests;
// a test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract      allowed host: handshake with the served app version; the file sent right after
//                 'ready' really opens (VectorCraft takes drops only once its graphics run, after
//                 a first drop listener of its own); Ctrl+S asks with the Save As dialog, Enter
//                 saves the edit as the document under the opened name, a second Ctrl+S saves
//                 without asking and is the document again; Save as PDF arrives as an export;
//                 nothing becomes a download, also not after the deadlines for the host's
//                 confirmation and result have passed
//   another name  the opened name and the one the Save As dialog suggests differ: an SVG saves as
//                 '<stem>.vectorcraft', the document, twice, while Export As SVG under the opened
//                 name stays an export; a renamed native file (gzip, data after the JSON) saves
//                 under the title stored in it, as the document; saved under its opened name
//                 instead (typed over the suggestion), it is the document too, also on the second
//                 Ctrl+S. Untitled-1.vectorcraft from the desktop app (stored title 'Untitled-1',
//                 a creation time) saves as the document, and a new document (File > New) saved
//                 under the same name is an export
//   startup      no WebGPU and no WebGL2: the host gets VectorCraft's own reason as an error of
//                 startup instead of waiting
//   ui (@ui)      the paths that need pointer clicks: File > Save and the OK button of the Save
//                 As dialog save the document; File > Export > Export As SVG... and the OK button
//                 of SVG Options give an export; VectorCraft's own link with target _self (About
//                 > Contributors) opens a new window
//
// A daily canary runs this file against every new VectorCraft release, so the steps that drive
// the app (section "UI") are kept apart from the checks of what the host and the browser see
// (section "Contract"). Steps use the keyboard and the command palette (Ctrl+Shift+/, "Search
// Commands..."), with shortcuts and command ids from crates/ui-egui/src/menus.rs (Save, the
// palette, the File menu) and crates/engine/src/cmd/ (Select All in select.rs, Group and Ungroup
// in object.rs). The palette runs the first command whose English label, shown label or id
// contains every typed word (crates/ui-egui/src/palette.rs), so a label such as "Export As SVG"
// can pick another command; the steps type command ids instead (VectorCraft keeps aliases when it
// renames one, palette.rs). Only the test tagged @ui also clicks with the pointer: a moved menu
// entry fails it without the translator being at fault.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { appFrames, PALETTE_KEYS, press, runCommand, settle } from '../lib/craft-ui.ts';

const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/vectorcraft/`;
// Fixtures (tests/e2e/fixtures/vectorcraft/make-fixtures.mjs): the artboard of the drawing, or the
// id of the SVG's rectangle, carries this marker; it shows that a save holds the opened drawing.
const MARKER = 'CRAFTSUITE-PROBE-7f3a';
const NATIVE = 'vectorcraft/craftsuite-probe.vectorcraft';
const RENAMED = 'vectorcraft/renamed-probe.vectorcraft';
const SVG = 'vectorcraft/probe.svg';
// Served as NATIVE made by VectorCraft's desktop app from File > New (see desktopUntitled()).
const UNTITLED = 'vectorcraft/Untitled-1.vectorcraft';
const CREATED = 1767225600; // its creation time, 2026-01-01
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

// Pinned: the @ui click positions depend on the layout, and VectorCraft's labels on the language.
test.use({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });

// The browser downloads of a page, from now on.
function trackDownloads(page: Page) {
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  return downloads;
}

// For a test with several independent scenarios: each runs as a step in a page of its own, and a
// failure is reported (as a soft error) without stopping the scenarios after it, so one run lists
// every scenario that broke. The app starts without what an earlier page stored (preferences,
// Data Recovery copies, which would put a Recover Documents dialog over the opened file), as in
// a fresh browser. The page of a passed scenario is closed; a failed one stays open for the
// diagnostics.
async function scenario(context: BrowserContext, title: string, body: (page: Page, downloads: Download[]) => Promise<void>) {
  const errorsBefore = test.info().errors.length;
  let page: Page | undefined;
  const failure = await test.step(title, async () => {
    page = await context.newPage();
    await page.addInitScript((appOrigin) => {
      try { if (location.origin === appOrigin) localStorage.clear(); } catch { /* no storage: nothing stored */ }
    }, APP_ORIGIN);
    await body(page, trackDownloads(page));
  }).then(() => null, (error: unknown) => error);
  expect.soft(() => { if (failure) throw failure; }, `scenario failed: ${title}`).not.toThrow();
  if (test.info().errors.length === errorsBefore) await page?.close();
}

// ---------------------------------------------------------------------------------------------
// UI: drive VectorCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (VectorCraft 0.8.0), relative to the app frame at the pinned viewport. This is
// the only layout knowledge in this file; when a release moves something, fix it here.
const AT = {
  // Menu bar: File, after the app menu "VectorCraft".
  fileMenu: (b: Box) => ({ x: b.x + 157, y: b.y + 21 }),
  // File menu: Save (after Close and Close All), and Export, which opens a submenu on hover.
  fileSave: (b: Box) => ({ x: b.x + 168, y: b.y + 267 }),
  fileExport: (b: Box) => ({ x: b.x + 173, y: b.y + 521 }),
  // File > Export submenu: Export As SVG..., third after Export for Screens and Export As.
  exportAsSvg: (b: Box) => ({ x: b.x + 444, y: b.y + 579 }),
  // Save As and SVG Options, modals centred horizontally in the frame: OK, the bottom-right button.
  saveAsOk: (b: Box) => ({ x: b.x + b.width / 2 + 154, y: b.y + 510 }),
  svgOptionsOk: (b: Box) => ({ x: b.x + b.width / 2 + 154, y: b.y + 573 }),
  // About VectorCraft, a modal centred in the frame and sized to its tab. On the About tab: the
  // Contributors tab, second in its tab row. On the Contributors tab: the first name, a link.
  aboutContributorsTab: (b: Box) => ({ x: b.x + b.width / 2 - 99, y: b.y + b.height / 2 - 101 }),
  firstContributor: (b: Box) => ({ x: b.x + b.width / 2 - 303, y: b.y + b.height / 2 + 20 }),
};

function appFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url().startsWith(APP));
  if (!frame) throw new Error(`no frame shows ${APP}`);
  return frame;
}

async function pointFrom(page: Page, at: (b: Box) => { x: number; y: number }) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  return at(box);
}

// For the @ui test: a click at a point from AT, after a hover frame so egui sees the target; then
// the picture settles.
async function clickApp(page: Page, app: Frame, what: string, at: (b: Box) => { x: number; y: number }) {
  const { x, y } = await pointFrom(page, at);

  await test.step(`ui: click ${what}`, async () => {
    await page.mouse.move(x, y);
    await appFrames(app, 2);
    await page.mouse.click(x, y);
    await settle(page.locator('#app'), app);
  });
}

// The pointer on a submenu entry, which opens the submenu.
async function hoverApp(page: Page, app: Frame, what: string, at: (b: Box) => { x: number; y: number }) {
  const { x, y } = await pointFrom(page, at);

  await test.step(`ui: hover ${what}`, async () => {
    await page.mouse.move(x, y);
    await settle(page.locator('#app'), app);
  });
}

// Runs a command of VectorCraft's palette by its id (see the header).
const command = (page: Page, app: Frame, id: string) => runCommand(page, app, id, PALETTE_KEYS.vectorcraft);

// Loads the test host and waits until the translator has handed the file to the app.
async function openInHost(page: Page, query = '') {
  await page.goto(HOST + query);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  await settle(page.locator('#app'), app); // the app opens the file a few frames after the drop
  return app;
}

// A keyboard edit that shows in the saved file: select all, then Group (Ctrl+G) or Ungroup
// (Ctrl+Shift+G).
async function editByKeyboard(page: Page, app: Frame, shortcut: 'Control+g' | 'Control+Shift+g') {
  await test.step(`ui: select all, ${shortcut}`, async () => {
    await press(page, app, 'Control+a');
    await appFrames(app, 3);
    await press(page, app, shortcut);
    await settle(page.locator('#app'), app);
  });
}

// eframe moves the focus to its hidden <input> while an egui text field has it: the first Save of
// a dropped file opens VectorCraft's Save As dialog with the file name field focused.
const textEditing = (app: Frame) => app.evaluate(() => document.activeElement?.tagName === 'INPUT');

// Ctrl+S on a document without a file of its own: VectorCraft asks with its Save As dialog (drawn
// in the canvas, so only the user can answer it), which suggests '<title without extension>
// .vectorcraft'. No dialog means no document is open: the file the host sent was lost.
async function openSaveAs(page: Page, app: Frame) {
  await press(page, app, 'Control+s');
  await expect.poll(() => textEditing(app), {
    message: 'Ctrl+S opened the Save As dialog (without one, no document is open: the dropped file was lost)',
    timeout: 10_000,
  }).toBe(true);
  await settle(page.locator('#app'), app);
}

// The first Save: Enter confirms the suggested name.
async function firstSave(page: Page, app: Frame) {
  await test.step('ui: Ctrl+S, Enter in the Save As dialog', async () => {
    await openSaveAs(page, app);
    await page.keyboard.press('Enter');
  });
}

// The first Save under a name the user types over the suggested one: select all in the name
// field, the name, Enter.
async function firstSaveAs(page: Page, app: Frame, name: string) {
  await test.step(`ui: Ctrl+S, '${name}' and Enter in the Save As dialog`, async () => {
    await openSaveAs(page, app);
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(name); // no key events: stray letters could be shortcuts
    await appFrames(app, 3); // the field takes the text on its next frame; Enter must see it
    await page.keyboard.press('Enter');
  });
}

// File > New… (command id file.newDialog), confirmed with Enter: a new document, 'Untitled-1' in
// a session that has made none (crates/engine/src/cmd/newdoc.rs).
async function newDocument(page: Page, app: Frame) {
  await test.step('ui: File > New…, Enter', async () => {
    await command(page, app, 'file.newDialog');
    await settle(page.locator('#app'), app); // the New Document dialog
    await page.keyboard.press('Enter');
    await settle(page.locator('#app'), app);
  });
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
async function hostSave(page: Page, n: number, what = `save #${n} reached the host`) {
  await untilHost(page, what, (h) => h.saves.length >= n);
  const save = (await hostRecord(page)).saves[n - 1];
  const bytes = Buffer.from(save.base64 ?? '', 'base64');
  if (!save.unconfirmed) {
    expect(createHash('sha256').update(bytes).digest('hex'), 'the host hashed the bytes it kept').toBe(save.sha256);
    expect(save.size).toBe(bytes.length);
  }
  return { save, bytes };
}

// The opened document: the host may replace its file with these bytes (or, under another name
// than the opened one, store them next to it).
function expectDocument(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'document', openId: 1, name });
}

// Anything else: the host stores it as a new file.
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, name });
}

// A native VectorCraft file (crates/format/src/lib.rs): JSON naming the format and holding the
// opened drawing, gzip-compressed with Use Compression (off unless the user turns it on), and
// since version 4 possibly followed by binary data, which starts with a NUL byte. Returns the JSON.
function expectNative(bytes: Buffer, title: string) {
  const unpacked = bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ? gunzipSync(bytes) : bytes;
  const end = unpacked.indexOf(0);
  const json = unpacked.subarray(0, end < 0 ? unpacked.length : end).toString('utf8');
  const file = JSON.parse(json) as { format?: string; document?: { title?: string } };
  expect(file.format, 'the native format').toBe('vectorcraft');
  expect(file.document?.title, 'the stored title').toBe(title);
  expect(json.includes(MARKER), 'the opened drawing (marker)').toBe(true);
  return json;
}

// Group (Ctrl+G) puts the selected objects into a group node.
const hasGroup = (json: string) => /"type": ?"group"/.test(json);

// The creation time a native file stores (File Info), from expectNative()'s JSON.
const createdIn = (json: string) => (JSON.parse(json) as { document?: { metadata?: { created?: unknown } } }).document?.metadata?.created;

// NATIVE as VectorCraft's desktop app writes a drawing from File > New: stored title 'Untitled-1'
// and a creation time, which every save keeps (crates/doc/src/metadata.rs, created). Its first
// Save suggests 'Untitled-1.vectorcraft', the name a new document's first Save suggests too.
async function desktopUntitled() {
  const file = JSON.parse(await readFile(new URL(`../fixtures/${NATIVE}`, import.meta.url), 'utf8')) as
    { document: { title: string; metadata?: { created: number } } };
  file.document.title = 'Untitled-1';
  file.document.metadata = { created: CREATED };
  return Buffer.from(JSON.stringify(file, null, 2));
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, `?target=vectorcraft&name=${NATIVE}&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'vectorcraft'), 'messages from another app than vectorcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.vectorcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.vectorcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('the file sent right after ready opened, and Ctrl+S saves the edit as the document', async () => {
    // The host sends 'open' the moment 'ready' arrives. Should 'ready' come before VectorCraft
    // takes drops (see started() in translators/vectorcraft.js), the drop is lost in Chromium:
    // no document, so Ctrl+S opens no dialog and nothing arrives.
    await editByKeyboard(page, app, 'Control+g');
    await firstSave(page, app);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.vectorcraft');
    expect(hasGroup(expectNative(bytes, 'craftsuite-probe.vectorcraft')), 'the edit (a group)').toBe(true);
  });

  await test.step('a second Ctrl+S saves without asking, again as the document', async () => {
    await editByKeyboard(page, app, 'Control+Shift+g');
    await press(page, app, 'Control+s');
    // A dialog here would wait for Enter: then no save arrives.
    const { save, bytes } = await hostSave(page, 2, 'save #2 reached the host without a dialog');
    expectDocument(save, 'craftsuite-probe.vectorcraft');
    expect(hasGroup(expectNative(bytes, 'craftsuite-probe.vectorcraft')), 'the edit (ungrouped)').toBe(false);
  });

  await test.step('Save as PDF arrives as a new file next to the document', async () => {
    await command(page, app, 'file.export.pdf'); // File > Save as PDF...
    await settle(page.locator('#app'), app); // the Save PDF dialog
    await page.keyboard.press('Enter');
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'craftsuite-probe.pdf');
    expect(bytes.subarray(0, 5).toString('latin1'), 'a PDF').toBe('%PDF-');
  });

  await test.step('nothing becomes a download, also not after both deadlines', async () => {
    // Every save was stored, so nothing may fall back to a download, also not once the deadlines
    // for the confirmation and for the result have passed for the last save. Short deadlines,
    // real time: eframe cannot run under a fake clock.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- nothing may happen in this time
    await page.waitForTimeout(Math.max(SHORT_ACK, SHORT_RESULT) + 1000);
    expect.soft((await hostRecord(page)).errors, 'errors the host got').toEqual([]);
    expectNoDownloads(downloads);
  });
});

test('another name: a save of the document under another name than the opened one is still the document', async ({ context }) => {
  await scenario(context, 'an SVG saves as <stem>.vectorcraft, the document, twice; Export As SVG under the opened name stays an export', async (page, downloads) => {
    const app = await openInHost(page, `?target=vectorcraft&name=${SVG}`);
    await editByKeyboard(page, app, 'Control+g');
    await firstSave(page, app);
    const first = await hostSave(page, 1);
    // The host stores this as a new file next to probe.svg, and later saves replace that file.
    expectDocument(first.save, 'probe.vectorcraft');
    // An import's title is its file name.
    expect(hasGroup(expectNative(first.bytes, 'probe.svg')), 'the edit (a group)').toBe(true);

    await editByKeyboard(page, app, 'Control+Shift+g');
    await press(page, app, 'Control+s');
    const second = await hostSave(page, 2, 'save #2 reached the host without a dialog');
    expectDocument(second.save, 'probe.vectorcraft');
    expect(hasGroup(expectNative(second.bytes, 'probe.svg')), 'the edit (ungrouped)').toBe(false);

    // An SVG written by VectorCraft under the opened name: a re-encoding of what it could import,
    // so it must not replace the original.
    await command(page, app, 'file.export.svg'); // File > Export > Export As SVG...
    await settle(page.locator('#app'), app); // SVG Options
    await page.keyboard.press('Enter');
    const svg = await hostSave(page, 3);
    expectExport(svg.save, 'probe.svg');
    expect(svg.bytes.toString('utf8'), 'an SVG').toContain('<svg');
    expectNoDownloads(downloads);
  });

  await scenario(context, 'a renamed native file saves under the title stored in it, as the document', async (page, downloads) => {
    // renamed-probe.vectorcraft: gzip, stored title 'craftsuite-probe.svg', an image after the
    // JSON. The adapter must unpack it and read the title from the JSON alone.
    const app = await openInHost(page, `?target=vectorcraft&name=${RENAMED}`);
    await editByKeyboard(page, app, 'Control+g');
    await firstSave(page, app);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.vectorcraft');
    expect(hasGroup(expectNative(bytes, 'craftsuite-probe.svg')), 'the edit (a group)').toBe(true);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'a renamed native file saved under its opened name is the document, twice', async (page, downloads) => {
    // The user types the opened name over the suggested 'craftsuite-probe.vectorcraft' (a file
    // renamed in Nextcloud, saved back under its name there). The stored title stays as it was.
    const app = await openInHost(page, `?target=vectorcraft&name=${RENAMED}`);
    await editByKeyboard(page, app, 'Control+g');
    await firstSaveAs(page, app, 'renamed-probe.vectorcraft');
    const first = await hostSave(page, 1);
    expectDocument(first.save, 'renamed-probe.vectorcraft');
    expect(hasGroup(expectNative(first.bytes, 'craftsuite-probe.svg')), 'the edit (a group)').toBe(true);

    await editByKeyboard(page, app, 'Control+Shift+g');
    await press(page, app, 'Control+s');
    const second = await hostSave(page, 2, 'save #2 reached the host without a dialog');
    expectDocument(second.save, 'renamed-probe.vectorcraft');
    expect(hasGroup(expectNative(second.bytes, 'craftsuite-probe.svg')), 'the edit (ungrouped)').toBe(false);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'Untitled-1.vectorcraft saves as the document; a new document saved under the same name is a new file', async (page, downloads) => {
    // The opened file and the new document both get 'Untitled-1.vectorcraft' suggested; only the
    // creation time stored in the opened file tells them apart (the web build stores none).
    const bytes = await desktopUntitled();
    await page.route(`${HOST}files/${UNTITLED}`, (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
    const app = await openInHost(page, `?target=vectorcraft&name=${UNTITLED}`);
    await editByKeyboard(page, app, 'Control+g');
    await firstSave(page, app);
    const own = await hostSave(page, 1);
    expectDocument(own.save, 'Untitled-1.vectorcraft');
    const json = expectNative(own.bytes, 'Untitled-1');
    expect(hasGroup(json), 'the edit (a group)').toBe(true);
    expect(createdIn(json), 'the creation time, kept by Save').toBe(CREATED);

    await newDocument(page, app);
    await firstSave(page, app); // the new document has no file yet: Save asks again
    const other = await hostSave(page, 2);
    expectExport(other.save, 'Untitled-1.vectorcraft');
    expect(other.bytes.includes(MARKER), 'the new document, not the opened drawing').toBe(false);
    expectNoDownloads(downloads);
  });
});

test('startup: without WebGPU and WebGL2 the host gets the reason instead of waiting', async ({ page }) => {
  // VectorCraft renders through wgpu: WebGPU where there is one, else WebGL2. Take both away in
  // the app frame.
  await page.addInitScript((appOrigin) => {
    if (location.origin !== appOrigin) return;
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
    const getContext = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      writable: true,
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return /webgl/i.test(type) ? null : getContext.call(this, type, ...rest);
      },
    });
  }, APP_ORIGIN);
  // A short startup timeout as a backstop: should the adapter miss VectorCraft's message, the test
  // gets 'the app did not get ready in time' within the wait below and fails on it, instead of
  // timing out without a message.
  await page.goto(`${HOST}?target=vectorcraft&name=${SVG}&app-startup=15000`);
  await untilHost(page, 'the host got an error of startup', (h) => h.errors.some((e) => e.of === 'startup'));
  const { errors } = await hostRecord(page);
  expect.soft(errors.map((e) => e.of), 'errors the host got').toEqual(['startup']);
  // web.rs shows 'VectorCraft failed to start: <reason>' and 'A browser with WebGPU or WebGL2 is
  // required.' in #vectorcraft_loading; the adapter passes them on.
  expect.soft(errors.find((e) => e.of === 'startup')?.message,
    'the adapter passed on VectorCraft\'s own message, not only the startup timeout')
    .toMatch(/^the app failed to start: VectorCraft failed to start: .* A browser with WebGPU or WebGL2 is required\.$/);
  const types = await messageTypes(page);
  expect.soft(types, 'message types the host got').not.toContain('ready');
  expect.soft(types, 'message types the host got').not.toContain('delivered');
});

test('ui: File menu, dialog buttons and About > Contributors with the pointer', { tag: '@ui' }, async ({ context }) => {
  // Three paths in a page each; a path that misses its target runs into its waits on its own.
  test.slow();

  await scenario(context, 'File > Save and OK in the Save As dialog save the document', async (page, downloads) => {
    const app = await openInHost(page, `?target=vectorcraft&name=${NATIVE}`);
    await clickApp(page, app, 'the File menu', AT.fileMenu);
    await clickApp(page, app, 'Save in the File menu', AT.fileSave);
    await clickApp(page, app, 'OK in the Save As dialog', AT.saveAsOk);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.vectorcraft');
    expectNative(bytes, 'craftsuite-probe.vectorcraft');
    expectNoDownloads(downloads);
  });

  await scenario(context, 'File > Export > Export As SVG... and OK in SVG Options give an export', async (page, downloads) => {
    const app = await openInHost(page, `?target=vectorcraft&name=${NATIVE}`);
    await clickApp(page, app, 'the File menu', AT.fileMenu);
    await hoverApp(page, app, 'Export in the File menu', AT.fileExport);
    await clickApp(page, app, 'Export As SVG... in the Export submenu', AT.exportAsSvg);
    await clickApp(page, app, 'OK in SVG Options', AT.svgOptionsOk);
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'craftsuite-probe.svg');
    expect(bytes.toString('utf8'), 'an SVG').toContain('<svg');
    expectNoDownloads(downloads);
  });

  await scenario(context, 'VectorCraft\'s own link with target _self (About > Contributors) opens a new window', async (page, downloads) => {
    // The links lead to https pages: answer them here, so the test needs no network. The test
    // origins are all http.
    await context.route((url) => url.protocol === 'https:', (route) => route.fulfill({ contentType: 'text/html', body: '' }));
    const app = await openInHost(page, `?target=vectorcraft&name=${NATIVE}`);
    await command(page, app, 'help.about'); // About VectorCraft
    await settle(page.locator('#app'), app);
    await clickApp(page, app, 'the Contributors tab of About', AT.aboutContributorsTab);
    const popup = page.waitForEvent('popup', { timeout: 10_000 });
    await clickApp(page, app, 'the first contributor\'s link', AT.firstContributor);
    let opened: Page;
    try {
      opened = await popup;
    } catch {
      const url = app.isDetached() ? 'nothing' : app.url();
      throw new Error(url.startsWith(APP)
        ? 'no new window, and the editor is still in the frame: the click missed the link (check AT)'
        : `no new window: the link replaced the editor in the frame, which now shows ${url}`);
    }
    await expect(opened, 'the link opened in the new window').toHaveURL(/^https:\/\//);
    await opened.close();
    expect(app.isDetached(), 'the app frame is still there').toBe(false);
    const href = await app.evaluate(() => location.href);
    expect(href.startsWith(APP), `the app frame still shows ${APP}, not ${href}`).toBe(true);
    expectNoDownloads(downloads);
  });
});
