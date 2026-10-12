// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real CADCraft web build. See docs/apps/cadcraft.md. Four tests; a test
// with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract   allowed host: handshake with the served app version, open of a DXF that CADCraft
//              wrote; an edit saved with Ctrl+S arrives as the document under the opened name, a
//              CADCraft DXF with the edit, and Save As (Ctrl+Shift+S) after another edit is the
//              document again; an SVG export (saveas with a typed path) and the save of a new
//              drawing (Ctrl+N, 'Drawing2.dxf') arrive as new files; nothing becomes a download,
//              also not after the deadlines for the host's confirmation and result
//   saved-as   saves that must not replace the opened file: a DXF from another program and one in
//              CADCraft's layout with what 0.5.0 drops are copies (the first save a new file, the
//              next one replaces that file), with the edit and without what CADCraft does not
//              keep; an opened 'Drawing2.dxf' or 'Bracket.dxf' is never saved back, and the new
//              drawing (Ctrl+N) or the sample (ui.sample) saved under that name is a new file; a
//              drawing the user brings in that saves under the opened name (dropped as
//              'craftsuite-probe.dxf', or picked with File > Open as 'craftsuite-probe' followed
//              by U+0085) makes that name's saves new files
//   language   the host's language (lang=uk) under the browser locale en-US: ready reports 'uk',
//              the app frame's navigator.languages starts with 'uk', and the menu bar is the one a
//              start under the browser locale uk-UA shows, not the one of a start without lang
//              (English, ready reports null); with English stored as the user's choice in
//              CADCraft's preferences, lang=uk gives ready null and the English menu bar
//   ui (@ui)   menus with the pointer: File > Save saves the document; Help > Open Sample Drawing,
//              then File > Save, arrives as a new file 'Bracket.dxf'
//
// A daily canary runs this file against every new CADCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see (section
// "Contract"). The steps use CADCraft's shortcuts (crates/engine/src/cmd/file.rs) and its command
// line (crates/ui-egui/src/cmdline.rs), where typed words run commands. Only the test tagged @ui
// also clicks with the pointer: a moved menu item fails it without the translator being at fault.
// The language test compares pictures of the menu bar at a fixed place, which a moved menu bar
// fails in the same way.
//
// The fixtures are in fixtures/cadcraft/: craftsuite-probe.dxf was saved by CADCraft 0.5.0 (a
// circle and a text with PROBE_MARKER), make-fixtures.mjs writes the others.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { appFrames, press, settle } from '../lib/craft-ui.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/cadcraft/${name}`, import.meta.url));
const PROBE = fixture('craftsuite-probe.dxf');
const FOREIGN = fixture('foreign.dxf');
const PROBE_MARKER = 'CRAFTSUITE-PROBE-cc01';
const FOREIGN_MARKER = 'CRAFTSUITE-FOREIGN-cc02';
// What CADCraft 0.5.0 drops on save from the two fixtures that are not its own DXF: an entity type
// it does not write, a header variable outside its list, another application's xdata.
const NOT_KEPT = ['MLINE', '$FINGERPRINTGUID', 'ACME_APP'];
// How every DXF CADCraft 0.5.0 writes starts (crates/io/src/dxf_write.rs): R2000, CRLF.
const CADCRAFT_HEAD = '  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$ACADVER\r\n  1\r\nAC1015\r\n';
// English chosen in Edit > Interface Language, as CADCraft 0.5.0 stores it in the frame's
// localStorage, the other preferences at their defaults (crates/ui-egui/src/lib.rs prefs_json).
const PREFS_KEY = 'cadcraft.prefs';
const ENGLISH_CHOSEN = '{"interfaceLanguage":"en","saveFormat":"dxf","theme":"dark"}';
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/cadcraft/`;
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
  readies: { layerVersion: string; language: string | null }[]; // language 'absent': no such field
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

// Pinned: the @ui click positions depend on the layout, and CADCraft's labels on the language.
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
// UI: drive CADCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets and the menu bar (measured on CADCraft 0.5.0), relative to the app frame at the
// pinned viewport. This is the only layout knowledge in this file; when a release moves something,
// fix it here.
const AT = {
  // The menu bar below the toolbar: File, the first entry, and Help, the last.
  fileMenu: (b: Box) => ({ x: b.x + 17, y: b.y + 43 }),
  helpMenu: (b: Box) => ({ x: b.x + 465, y: b.y + 43 }),
  // The menu bar's labels: File to Help in English, Файл to Довідка (up to x 680) in Ukrainian.
  menuBar: (b: Box) => ({ x: b.x, y: b.y + 33, width: 700, height: 20 }),
  // File menu: Save, the fifth row (after New Drawing…, Open…, Close and Close All).
  fileSave: (b: Box) => ({ x: b.x + 40, y: b.y + 166 }),
  // Help menu: Open Sample Drawing, the first row.
  helpSample: (b: Box) => ({ x: b.x + 520, y: b.y + 70 }),
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
  });
}

// For the @ui test: <menu> > <item>. The menu opens on the click and closes after the item ran.
async function menu(page: Page, app: Frame, menuAt: (b: Box) => { x: number; y: number }, what: string, item: (b: Box) => { x: number; y: number }) {
  await clickApp(page, app, `the menu of ${what}`, menuAt);
  await settle(page.locator('#app'), app); // the menu
  await clickApp(page, app, what, item);
  await settle(page.locator('#app'), app);
}

// Types a command line as a user does, then Enter. On CADCraft's command line Space ends a word
// like Enter, except at a prompt for free text (ui-egui/src/cmdline.rs).
async function typeCommand(page: Page, app: Frame, line: string) {
  await test.step(`ui: type "${line}"`, async () => {
    await press(page, app, 'Escape'); // no command running, nothing typed
    await page.keyboard.type(line, { delay: 10 });
    await page.keyboard.press('Enter');
    await settle(page.locator('#app'), app);
  });
}

// Single Line Text with `text` at (2, y), height 0.5, rotation 0: the edit the tests save. TEXT
// asks for the text after the rotation, and an empty line ends it.
async function addText(page: Page, app: Frame, text: string, y: number) {
  await test.step(`ui: add the text ${text}`, async () => {
    await press(page, app, 'Escape');
    await page.keyboard.type(`text 2,${y} 0.5 0`, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type(text, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await settle(page.locator('#app'), app);
  });
}

// A command with JSON parameters (`saveas {"path": ...}`), the only way to name a file on the web.
// A typed Space would end the command name, so the line goes in as one text input through eframe's
// hidden text field, as an input method delivers it; Enter on the canvas runs it. eframe takes the
// focus back from that field on every frame in which no egui text field is edited, so the focus
// and the input happen in one task (eframe 0.36 web/app_runner.rs, web/text_agent.rs).
async function runJson(page: Page, app: Frame, line: string) {
  await test.step(`ui: enter "${line}"`, async () => {
    await press(page, app, 'Escape');
    await app.evaluate((line) => {
      const input = document.querySelector('input[type=text]') as HTMLInputElement;
      input.focus();
      input.value += line;
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: line, bubbles: true }));
    }, line);
    await appFrames(app, 3);
    await press(page, app, 'Enter');
    await settle(page.locator('#app'), app);
  });
}

// File > New Drawing… (Ctrl+N): 'Drawing2', after the Drawing1 the page starts with.
async function newDrawing(page: Page, app: Frame) {
  await test.step('ui: new drawing (Ctrl+N)', async () => {
    await press(page, app, 'Control+n');
    await settle(page.locator('#app'), app);
  });
}

// A file the user drops onto the app from the desktop: the drop event CADCraft's canvas gets, as
// the translator's own drop. The adapter counts every drop, trusted or not.
async function dropFile(page: Page, app: Frame, name: string, bytes: Buffer) {
  await test.step(`ui: drop ${name} onto the app`, async () => {
    await app.evaluate(({ name, base64 }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name));
      const canvas = document.querySelector('canvas')!;
      const box = canvas.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
      for (const type of ['dragover', 'drop']) canvas.dispatchEvent(new DragEvent(type, init));
    }, { name, base64: bytes.toString('base64') });
    await settle(page.locator('#app'), app); // a new drawing tab
  });
}

// File > Open… (Ctrl+O) of a file from the user's disk, through the browser's file picker.
async function openFromDisk(page: Page, app: Frame, name: string, bytes: Buffer) {
  await test.step(`ui: File > Open (Ctrl+O) of ${name} from the disk`, async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await press(page, app, 'Control+o');
    await (await chooser).setFiles({ name, mimeType: '', buffer: bytes });
    await settle(page.locator('#app'), app); // a new drawing tab
  });
}

// Loads the test host with a fixture and waits until the translator has handed it to the app.
// `bytes` serves those bytes under `name` instead of a file in fixtures/cadcraft/.
async function openInHost(page: Page, name: string, query = '', bytes?: Buffer) {
  if (bytes) {
    await page.route(`${HOST}files/cadcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  }
  await page.goto(`${HOST}?target=cadcraft&name=${encodeURIComponent(`cadcraft/${name}`)}${query}`);
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

// The n-th save (from 1) the host received, with the bytes it kept as text (DXF is ASCII).
async function hostSave(page: Page, n: number) {
  await untilHost(page, `save #${n} reached the host`, (h) => h.saves.length >= n);
  const save = (await hostRecord(page)).saves[n - 1];
  const bytes = Buffer.from(save.base64 ?? '', 'base64');
  if (!save.unconfirmed) {
    expect(createHash('sha256').update(bytes).digest('hex'), 'the host hashed the bytes it kept').toBe(save.sha256);
    expect(save.size).toBe(bytes.length);
  }
  return { save, text: bytes.toString('latin1') };
}

// The opened document: the host may replace its file with these bytes.
function expectDocument(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'document', openId: 1, follows: null, name });
}

// Anything else (exports, other drawings): the host stores it as a new file.
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, follows: null, name });
}

// A DXF as CADCraft writes it (every save is a full rewrite), with the given texts.
function expectCadcraftDxf(text: string, contains: string[], lacks: string[] = []) {
  expect(text.startsWith(CADCRAFT_HEAD), 'CADCraft\'s R2000 DXF (header start)').toBe(true);
  expect(text.endsWith('  0\r\nEOF\r\n'), 'a complete DXF (0 EOF at the end)').toBe(true);
  for (const s of contains) expect.soft(text, `the save holds ${s}`).toContain(s);
  for (const s of lacks) expect.soft(text, `the save lacks ${s}`).not.toContain(s);
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// The menu bar as the page shows it (PNG). CADCraft draws its labels into the canvas, so the
// language it shows is only in the picture.
async function menuBar(page: Page) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  return page.screenshot({ clip: AT.menuBar(box), caret: 'initial', scale: 'css' });
}

// Whether the menu bar of a start is, byte for byte, the one of `other` (same: true) or not. When
// not as expected, both pictures are attached to the report.
async function compareMenuBars(shown: Buffer, other: Buffer, otherStart: string, same: boolean) {
  const equal = shown.equals(other);
  if (equal !== same) {
    await test.info().attach('menu bar of this start', { body: shown, contentType: 'image/png' });
    await test.info().attach(`menu bar of ${otherStart}`, { body: other, contentType: 'image/png' });
  }
  expect.soft(equal, `the menu bar ${same ? 'equals' : 'differs from'} the one of ${otherStart}`).toBe(same);
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  // A checkout that turned the fixture's CRLF into LF makes it another program's DXF: a copy.
  expect(PROBE.toString('latin1').startsWith(CADCRAFT_HEAD), 'craftsuite-probe.dxf as CADCraft wrote it, with CRLF (see .gitattributes)').toBe(true);
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, 'craftsuite-probe.dxf', `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'cadcraft'), 'messages from another app than cadcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.cadcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.cadcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('Ctrl+S saves the edit as the document, under the opened name', async () => {
    await addText(page, app, 'CRAFTSUITE-EDIT-1', 6);
    await press(page, app, 'Control+s');
    const { save, text } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.dxf');
    expectCadcraftDxf(text, [PROBE_MARKER, 'CRAFTSUITE-EDIT-1']);
  });

  await test.step('Save As (Ctrl+Shift+S, no dialog on the web) after another edit is the document again', async () => {
    await addText(page, app, 'CRAFTSUITE-EDIT-2', 7);
    await press(page, app, 'Control+Shift+S');
    const { save, text } = await hostSave(page, 2);
    expectDocument(save, 'craftsuite-probe.dxf');
    expectCadcraftDxf(text, [PROBE_MARKER, 'CRAFTSUITE-EDIT-1', 'CRAFTSUITE-EDIT-2']);
  });

  await test.step('an SVG export (saveas with a typed path) arrives as a new file', async () => {
    await runJson(page, app, 'saveas {"path": "craftsuite-probe.svg"}');
    const { save, text } = await hostSave(page, 3);
    expectExport(save, 'craftsuite-probe.svg');
    expect(text, 'an SVG').toContain('<svg');
  });

  await test.step('the save of a new drawing (Ctrl+N) arrives as a new file', async () => {
    await newDrawing(page, app);
    await press(page, app, 'Control+s');
    const { save, text } = await hostSave(page, 4);
    expectExport(save, 'Drawing2.dxf');
    expectCadcraftDxf(text, [], [PROBE_MARKER]);
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

test('saved-as: saves that must not replace the opened file become new files', async ({ context }) => {
  // Six scenarios, each loading the app in a page of its own: on a busy machine (two browsers of
  // the run and the other projects' tests) they need more than the default two minutes.
  test.slow();

  // Saves of a DXF that CADCraft would write with losses: the opened file stays, the first save
  // goes next to it, and the next one replaces that copy.
  const copies: [file: string, what: string, bytes: Buffer, marker: string][] = [
    ['foreign.dxf', 'a DXF from another program', FOREIGN, FOREIGN_MARKER],
    ['newer-cadcraft.dxf', 'CADCraft\'s layout with what 0.5.0 drops', fixture('newer-cadcraft.dxf'), PROBE_MARKER],
  ];
  for (const [file, what, bytes, marker] of copies) {
    await scenario(context, `'${file}' (${what}): the first save is a new file, the next one replaces it`, async (page, downloads) => {
      const app = await openInHost(page, file, '', bytes);
      await addText(page, app, 'CRAFTSUITE-EDIT-C', 6);
      await press(page, app, 'Control+s');
      const first = await hostSave(page, 1);
      // The document of the open, following its own id, which names no file the host has: the
      // host stores it as a new file.
      expect(first.save).toMatchObject({ kind: 'document', openId: 1, follows: first.save.id, name: file });
      expectCadcraftDxf(first.text, [marker, 'CRAFTSUITE-EDIT-C'], NOT_KEPT);

      // The document of the open, replacing the file the host stored the first copy in.
      await press(page, app, 'Control+s');
      const second = await hostSave(page, 2);
      expect(second.save).toMatchObject({ kind: 'document', openId: 1, follows: first.save.id, name: file });
      expectCadcraftDxf(second.text, [marker, 'CRAFTSUITE-EDIT-C'], NOT_KEPT);
      expectNoDownloads(downloads);
    });
  }

  // Names CADCraft gives drawings it makes (engine/src/lib.rs new_drawing, ui-egui/src/menus.rs
  // ui.sample): nothing in the DXF tells such a drawing from an opened file of that name.
  const madeByApp: [name: string, make: string, makeOther: (page: Page, app: Frame) => Promise<void>][] = [
    ['Drawing2.dxf', 'a new drawing (Ctrl+N)', newDrawing],
    ['Bracket.dxf', 'the sample (ui.sample)', (page, app) => typeCommand(page, app, 'ui.sample')],
  ];
  for (const [name, make, makeOther] of madeByApp) {
    await scenario(context, `an opened '${name}' is never saved back, and ${make} saved under that name is a new file`, async (page, downloads) => {
      const app = await openInHost(page, name, '', PROBE);
      await press(page, app, 'Control+s');
      const own = await hostSave(page, 1);
      expectExport(own.save, name);
      expectCadcraftDxf(own.text, [PROBE_MARKER]);

      await makeOther(page, app);
      await press(page, app, 'Control+s'); // saves the active tab: the drawing just made
      const other = await hostSave(page, 2);
      expectExport(other.save, name);
      expectCadcraftDxf(other.text, [], [PROBE_MARKER]);
      expectNoDownloads(downloads);
    });
  }

  // Every drop and every File > Open pick opens a new tab titled with the file name, which Save
  // uses, trimmed as Rust trims (also U+0085, which JavaScript's trim() keeps), with '.dxf' added
  // if it has no extension (ui-egui/src/lib.rs suggested_name): a second drawing that saves under
  // the opened name.
  const broughtIn: [what: string, bringIn: (page: Page, app: Frame) => Promise<void>][] = [
    ['dropped as \'craftsuite-probe.dxf\'', (page, app) => dropFile(page, app, 'craftsuite-probe.dxf', FOREIGN)],
    ['picked with File > Open as \'craftsuite-probe\' followed by U+0085', (page, app) => openFromDisk(page, app, 'craftsuite-probe\u0085', FOREIGN)],
  ];
  for (const [what, bringIn] of broughtIn) {
    await scenario(context, `a drawing ${what} saves under the opened name as a new file`, async (page, downloads) => {
      const app = await openInHost(page, 'craftsuite-probe.dxf');
      await press(page, app, 'Control+s');
      expectDocument((await hostSave(page, 1)).save, 'craftsuite-probe.dxf'); // before the other file arrived

      await bringIn(page, app);
      await press(page, app, 'Control+s'); // saves the active tab: the drawing brought in
      const { save, text } = await hostSave(page, 2);
      expectExport(save, 'craftsuite-probe.dxf');
      expectCadcraftDxf(text, [FOREIGN_MARKER], [PROBE_MARKER]);
      expectNoDownloads(downloads);
    });
  }
});

// CADCraft takes the host's language through navigator.languages, which it reads once as it starts
// (the adapter's language member puts the host's language first), unless a language the user
// chose is stored in its preferences, and shows it only in the picture. Under the pinned locale
// en-US, a start with lang=uk must look like a start under the browser locale uk-UA and not like
// one without lang; with English stored as the user's choice, like the one without lang.
test('language: the host\'s lang=uk starts CADCraft in Ukrainian, as the browser locale uk-UA does, unless the user chose English', { tag: '@language' }, async ({ page, browser }) => {
  // Four starts of CADCraft: more than the default timeout allows on a busy machine.
  test.slow();
  const app = await openInHost(page, 'craftsuite-probe.dxf', '&lang=uk');
  const shown = await menuBar(page);

  await test.step('ready reports uk, and the app frame sees uk first in the browser languages', async () => {
    expect.soft((await hostRecord(page)).readies[0]?.language, 'language of the ready message').toBe('uk');
    expect.soft(await app.evaluate(() => navigator.languages[0]), 'navigator.languages[0] in the app frame').toBe('uk');
  });

  await test.step('the menu bar is the one of a start under the browser locale uk-UA', async () => {
    // The locale belongs to a context; this one has the spec's other options (viewport, device).
    const ukrainian = await browser.newContext({ locale: 'uk-UA' });
    try {
      const other = await ukrainian.newPage();
      await openInHost(other, 'craftsuite-probe.dxf');
      await compareMenuBars(shown, await menuBar(other), 'a start under the locale uk-UA', true);
    } finally {
      await ukrainian.close();
    }
  });

  // In the same page from here on, so that no other CADCraft runs in this context when the next
  // step stores the user's choice.
  const english = await test.step('without lang: ready reports null, the app frame sees the browser languages, another menu bar', async () => {
    const frame = await openInHost(page, 'craftsuite-probe.dxf');
    expect.soft((await hostRecord(page)).readies[0]?.language, 'language of the ready message').toBeNull();
    expect.soft(await frame.evaluate(() => [...navigator.languages]), 'navigator.languages in the app frame')
      .toEqual(await page.evaluate(() => [...navigator.languages]));
    const bar = await menuBar(page);
    await compareMenuBars(shown, bar, 'a start without lang (locale en-US)', false);
    return bar;
  });

  await test.step('English stored as the user\'s choice wins over lang=uk: ready reports null, the English menu bar', async () => {
    // Stored only while no CADCraft runs, because eframe writes the running app's preferences back
    // (when the canvas loses the focus, and every 30 s): the frame leaves CADCraft for another page
    // of its origin (a 404), which shares its storage, and the next start reads the choice.
    const frame = appFrame(page);
    await frame.goto(`${APP_ORIGIN}/`);
    await frame.evaluate(([key, value]) => localStorage.setItem(key, value), [PREFS_KEY, ENGLISH_CHOSEN]);
    await openInHost(page, 'craftsuite-probe.dxf', '&lang=uk');
    expect.soft((await hostRecord(page)).readies[0]?.language, 'language of the ready message').toBeNull();
    await compareMenuBars(await menuBar(page), english, 'a start without lang (locale en-US)', true);
  });
});

test('ui: File > Save and Help > Open Sample Drawing with the pointer', { tag: '@ui' }, async ({ page }) => {
  const downloads = trackDownloads(page);
  const app = await openInHost(page, 'craftsuite-probe.dxf');

  await test.step('File > Save saves the document, like Ctrl+S', async () => {
    await menu(page, app, AT.fileMenu, 'File > Save', AT.fileSave);
    const { save, text } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.dxf');
    expectCadcraftDxf(text, [PROBE_MARKER]);
  });

  await test.step('Help > Open Sample Drawing, then File > Save, arrives as a new file Bracket.dxf', async () => {
    await menu(page, app, AT.helpMenu, 'Help > Open Sample Drawing', AT.helpSample);
    await menu(page, app, AT.fileMenu, 'File > Save', AT.fileSave);
    const { save, text } = await hostSave(page, 2);
    expectExport(save, 'Bracket.dxf');
    expectCadcraftDxf(text, []);
    expect(text, 'the sample, not the opened drawing').not.toContain(PROBE_MARKER);
    expectNoDownloads(downloads);
  });
});
