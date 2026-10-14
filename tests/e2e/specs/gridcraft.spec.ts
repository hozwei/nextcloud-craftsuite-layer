// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real GridCraft web build. See docs/apps/gridcraft.md. Four tests; a
// test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract   allowed host: handshake with the served app version, open of an .xlsx GridCraft
//              wrote; an edit saved with Ctrl+S arrives as the document under the opened name,
//              with the edit, and Save As (Ctrl+Shift+S) after another edit is the document again;
//              the save of a new workbook (Ctrl+N, 'Book1.xlsx') arrives as a new file; nothing
//              becomes a download, also not after the deadlines for the host's confirmation and
//              result
//   saved-as   an .xlsx another program wrote, and a GridCraft file another program changed (a
//              part GridCraft drops) under an upper-case name ('.XLSX', saved as '.xlsx'), are
//              never replaced: the first save arrives as a new file, the next one replaces that
//              file (follows it); the copy, GridCraft's own file, opened again saves back into
//              itself, also with the parts of Excel's file that GridCraft keeps; macros.xlsm,
//              data.ods and data.csv save as 'macros.xlsx', 'data (imported).xlsx' and
//              'data.xlsx', the document (a new file next to the original), and so does the next
//              save; GridCraft's sales sample (charts, a table, notes) saves back unchanged as the
//              document; an opened Book1.xlsx, named like a new workbook, is never saved back, and
//              the save of a new workbook under that name is a new file too; the blanks of the
//              "+ New" entry in Files (blanks/blank.xlsx on A4, and blank-letter.xlsx) open, and
//              their first saves are the document; a different craftsuite-probe.xlsx that the user
//              brings in (File > Open; in Chromium also a drop from the desktop) is never the
//              document
//   language   the host's language (lang=ru) under the browser locale en-US: ready reports 'ru',
//              the app frame's navigator.language is 'ru', and the ribbon's tab row is the one a
//              start under the browser locale ru-RU shows, not the one of an English start
//   ui (@ui)   with the pointer, on an opened data.csv: File > Save (its Save As page, Download)
//              saves the document 'data.xlsx'; File > Export > Create PDF arrives as a new file
//              'data.pdf', and File > Export > CSV as a new file under the opened name 'data.csv'
//
// A daily canary runs this file against every new GridCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see (section
// "Contract"). The steps use GridCraft's keyboard shortcuts (crates/ui-egui/src/ribbon.rs,
// shortcut()) and cell editing with F2. Export as PDF and as CSV are only in the File view (PDF
// also in Search Commands), which only the pointer opens, so they are in the test tagged @ui: a
// moved button fails that test without the translator being at fault.
//
// The fixtures in fixtures/gridcraft/: craftsuite-probe.xlsx (MARKER in A1, 42 in B1, sheet
// 'Sheet1') was saved by GridCraft 0.5.0, sales-sample.xlsx by GridCraft 0.6.1; make-fixtures.mjs
// writes the files of other programs (sheet 'Data', MARKER in A1).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { appFrames, press, settle, waitForTextEditing } from '../lib/craft-ui.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/gridcraft/${name}`, import.meta.url));
const PROBE = fixture('craftsuite-probe.xlsx');
const FROM_EXCEL = fixture('from-excel.xlsx');
const MARKER = 'CRAFTSUITE-PROBE-gc01';
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/gridcraft/`;
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

// Pinned: the @ui click positions depend on the layout, and GridCraft's labels on the language.
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
// UI: drive GridCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets, and the region the language test compares (the tab row measured on GridCraft
// 0.5.0, the rest on 0.6.1), relative to the app frame at the pinned viewport. This is the only
// layout knowledge in this file; when a release moves something, fix it here.
const AT = {
  // The ribbon's tab row (File, Home, Insert, ...), with the line under the active tab.
  tabRow: (b: Box) => ({ x: b.x, y: b.y + 40, width: b.width, height: 26 }),
  // The ribbon's tab row: File, before Home. It opens the File view (Backstage).
  fileTab: (b: Box) => ({ x: b.x + 40, y: b.y + 53 }),
  // The File view's list on the left: Save (after Back, Home, New, Open and Info), and Export.
  fileSave: (b: Box) => ({ x: b.x + 60, y: b.y + 284 }),
  fileExport: (b: Box) => ({ x: b.x + 60, y: b.y + 398 }),
  // The Save As page: the button Download (.xlsx), under Save as type.
  saveAsDownload: (b: Box) => ({ x: b.x + 288, y: b.y + 233 }),
  // The Export page: Create PDF, then under Change File Type CSV (Comma delimited).
  exportPdf: (b: Box) => ({ x: b.x + 326, y: b.y + 145 }),
  exportCsv: (b: Box) => ({ x: b.x + 362, y: b.y + 255 }),
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

// GridCraft sets the window title to the active workbook's title, with ' — Edited' once it has
// changed (ui-egui/src/lib.rs:652-659), through an egui viewport command that eframe's web backend
// does not implement and reports on the console. That is the one sign outside the canvas that a
// file opened or an edit reached the workbook. Collect the titles of a page; call before loading.
function watchTitles(page: Page) {
  const titles: string[] = [];
  page.on('console', (m) => {
    const title = /Unhandled egui viewport command: Title\("(.*)"\)/.exec(m.text());
    if (title) titles.push(title[1].replace(/\\(.)/g, '$1'));
  });
  return titles;
}

// Waits until the window title `title` was set after the first `from` titles. Should a release
// stop reporting titles, fall back to waiting some frames; the contract checks still decide.
async function waitForTitle(app: Frame, titles: string[], title: string, from: number) {
  const deadline = Date.now() + 15_000;
  while (!titles.slice(from).includes(title)) {
    if (Date.now() > deadline) {
      test.info().annotations.push({ type: 'warning', description: `no window title "${title}" (has: ${titles.join(' | ')})` });
      return;
    }
    await appFrames(app, 5);
  }
}

// The title GridCraft gives an opened file (engine/src/cmd/file.rs:50-56): its name, or
// '<stem> (imported).xlsx' for ODS and XLSB.
const titleOf = (name: string) => (/\.(ods|xlsb)$/i.test(name) ? `${name.replace(/\.[^.]*$/, '')} (imported).xlsx` : name);

// GridCraft shows import warnings (dropped macros, an ODS import) in a message box that takes the
// keys until it is closed with OK, Enter or Escape (ui-egui/src/widgets.rs:176-200). Escape does
// nothing else here. Call once the file's title is up: the box comes with it.
async function closeMessageBox(page: Page, app: Frame) {
  await test.step('ui: close the import message box, if any (Escape)', async () => {
    await settle(page.locator('#app'), app); // the box, if any, is drawn
    await press(page, app, 'Escape');
    await settle(page.locator('#app'), app); // and gone: the next keys reach the grid
  });
}

// Types `text` into column A of `row` (from 1) of the active sheet: F2 opens the cell editor
// (eframe's hidden text <input> takes the focus), the text arrives as one insertion (no key events:
// stray letters could be shortcuts), Enter commits it. The first change of a workbook adds
// ' — Edited' to its window title: waited for, so the edit has reached the workbook.
async function editCell(page: Page, app: Frame, titles: string[], row: number, text: string) {
  const current = titles.at(-1) ?? '';
  const from = titles.length;

  await test.step(`ui: type ${text} into A${row}`, async () => {
    await press(page, app, 'Control+Home');
    for (let i = 1; i < row; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('F2');
    await waitForTextEditing(app, true, 'F2 did not open the cell editor');
    await page.keyboard.insertText(text);
    await appFrames(app, 2);
    await page.keyboard.press('Enter');
    await waitForTextEditing(app, false, 'Enter did not close the cell editor');
  });

  if (!current.endsWith(' — Edited')) await waitForTitle(app, titles, `${current} — Edited`, from);
}

// A new workbook (Ctrl+N): 'Book1', unless another unsaved Book1 is open.
async function newWorkbook(page: Page, app: Frame, titles: string[]) {
  await test.step('ui: a new workbook (Ctrl+N)', async () => {
    const from = titles.length;
    await press(page, app, 'Control+n');
    await waitForTitle(app, titles, 'Book1', from);
    await settle(page.locator('#app'), app);
  });
}

// File > Open… (Ctrl+O) with a file from the user's disk, through the browser's file picker. It
// opens as a further workbook window with a clean title.
async function openFromDisk(page: Page, app: Frame, titles: string[], name: string, bytes: Buffer) {
  await test.step(`ui: File > Open (Ctrl+O) of another ${name} from the disk`, async () => {
    const from = titles.length;
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await press(page, app, 'Control+o');
    await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
    await waitForTitle(app, titles, name, from);
    await settle(page.locator('#app'), app);
  });
}

// A user's drag and drop of a file from the desktop onto the middle of the app. Only Chromium can
// send such a trusted drop (DevTools protocol), see chromiumOnly().
async function dropFromDesktop(page: Page, app: Frame, titles: string[], file: string) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await test.step(`ui: drop another ${path.basename(file)} from the desktop`, async () => {
    const from = titles.length;
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, ...at, data });
    await cdp.detach();
    await waitForTitle(app, titles, path.basename(file), from);
    await settle(page.locator('#app'), app);
  });
}

// Loads the test host with a fixture and waits until GridCraft shows it, with no message box in
// front. `bytes` serves those bytes under `name` instead of a file in fixtures/gridcraft/. A name
// under blanks/ is a blank of the "+ New" entries in Files (craftsuite_layer/assets/).
async function openInHost(page: Page, name: string, query = '', bytes?: Buffer) {
  const titles = watchTitles(page);
  if (bytes) {
    await page.route(`${HOST}files/gridcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  }
  const file = name.startsWith('blanks/') ? name : `gridcraft/${name}`;
  await page.goto(`${HOST}?target=gridcraft&name=${encodeURIComponent(file)}${query}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  await waitForTitle(app, titles, titleOf(path.basename(name)), 0);
  await closeMessageBox(page, app);
  return { app, titles };
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
// than the opened one, store them next to it and replace that file on later saves). With
// `follows`, a copy (docs/protocol.md#copies): the first follows its own id, which names no file
// the host has, so the host stores it as a new file; a later one follows the first and replaces
// that file.
function expectDocument(save: HostSave, name: string, follows: number | null = null) {
  expect(save).toMatchObject({ kind: 'document', openId: 1, follows, name });
}

// Anything else (exports, other workbooks): the host stores it as a new file.
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, follows: null, name });
}

// A workbook as GridCraft saves it: its parts (and the text of each), whether GridCraft wrote it,
// its sheets and the text of its cells.
function workbook(bytes: Buffer) {
  const parts = unzipSync(bytes);
  const text = (name: string) => (parts[name] ? strFromU8(parts[name]) : '');
  return {
    parts: Object.keys(parts),
    text,
    gridcraft: text('docProps/app.xml').includes('<Application>GridCraft</Application>'),
    sheets: [...text('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => m[1]),
    cells: Object.keys(parts).filter((n) => /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(n)).map(text).join('\n'),
  };
}

// A GridCraft save of an opened fixture (MARKER in A1) with `edits` typed in.
function expectSavedWorkbook(bytes: Buffer, edits: string[] = []) {
  const saved = workbook(bytes);
  expect(saved.gridcraft, 'GridCraft wrote it (docProps/app.xml)').toBe(true);
  expect(saved.cells, 'the opened workbook\'s cells').toContain(MARKER);
  for (const edit of edits) expect(saved.cells, `the edit ${edit}`).toContain(edit);
  return saved;
}

// PROBE as a program that keeps docProps/app.xml writes it after a change: a customXml item more,
// which no relationship reaches, so that GridCraft drops it (0.6.1 keeps only what the workbook's
// relationships reach, xlsx/src/passthrough.rs).
function changedElsewhere() {
  const parts: Zippable = { ...unzipSync(PROBE) };
  parts['customXml/item1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<probe xmlns="urn:craftsuite-probe">keep me</probe>');
  return Buffer.from(zipSync(parts, { level: 6 }));
}

// A scenario that needs a trusted drop (dropFromDesktop) runs in Chromium only; elsewhere the
// test notes that it did not run.
async function chromiumOnly(browserName: string, run: () => Promise<void>) {
  if (browserName === 'chromium') return run();
  test.info().annotations.push({ type: 'skipped scenario', description: 'a drop from the desktop needs Chromium (DevTools protocol)' });
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// The ribbon's tab row as the page shows it (PNG). GridCraft draws its labels into the canvas, so
// the language it shows is only in the picture.
async function tabRow(page: Page) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  return page.screenshot({ clip: AT.tabRow(box), caret: 'initial', scale: 'css' });
}

// Whether the tab row of a start is, byte for byte, the one of `other` (same: true) or not. When
// not as expected, both pictures are attached to the report.
async function compareTabRows(shown: Buffer, other: Buffer, otherStart: string, same: boolean) {
  const equal = shown.equals(other);
  if (equal !== same) {
    await test.info().attach('tab row of this start', { body: shown, contentType: 'image/png' });
    await test.info().attach(`tab row of ${otherStart}`, { body: other, contentType: 'image/png' });
  }
  expect.soft(equal, `the tab row ${same ? 'equals' : 'differs from'} the one of ${otherStart}`).toBe(same);
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const { app, titles } = await openInHost(page, 'craftsuite-probe.xlsx', `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'gridcraft'), 'messages from another app than gridcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.gridcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.gridcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('Ctrl+S saves the edit as the document, under the opened name', async () => {
    await editCell(page, app, titles, 3, 'EDIT-1');
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.xlsx');
    expectSavedWorkbook(bytes, ['EDIT-1']);
  });

  await test.step('Save As (Ctrl+Shift+S) after another edit is the document again', async () => {
    await editCell(page, app, titles, 4, 'EDIT-2');
    await press(page, app, 'Control+Shift+S');
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, 'craftsuite-probe.xlsx');
    expectSavedWorkbook(bytes, ['EDIT-1', 'EDIT-2']);
  });

  await test.step('the save of a new workbook (Ctrl+N), Book1.xlsx, arrives as a new file', async () => {
    await newWorkbook(page, app, titles);
    await editCell(page, app, titles, 1, 'NEW-BOOK');
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'Book1.xlsx');
    expect(workbook(bytes).cells, 'the new workbook, not the opened one').toContain('NEW-BOOK');
    expect(workbook(bytes).cells, 'the new workbook, not the opened one').not.toContain(MARKER);
  });

  await test.step('nothing becomes a download, also not after both deadlines', async () => {
    // Every save was stored, so nothing may fall back to a download, also not once the deadlines
    // for the confirmation and for the result have passed for the last save. Short deadlines,
    // real time: eframe cannot run under a fake clock.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- nothing may happen in this time
    await page.waitForTimeout(Math.max(SHORT_ACK, SHORT_RESULT) + 1000);
    expect.soft((await hostRecord(page)).errors, 'errors the host got').toEqual([]);
    expect.soft((await hostRecord(page)).saves, 'saves the host got').toHaveLength(3);
    expectNoDownloads(downloads);
  });
});

test('saved-as: interchange files, copies, new workbooks and files the user brings in', async ({ context, browserName }) => {
  // Eleven pages, each loading GridCraft: more than the default timeout allows on a busy machine.
  test.slow();

  // GridCraft rewrites every save from its own model and drops what it does not model (from Excel's
  // file the creation time in docProps/core.xml; before 0.6.1 also the custom properties and the
  // customXml item, which 0.6.1 keeps; from the changed GridCraft file the customXml item): such a
  // save must not replace the opened file. The changed GridCraft file has an upper-case name, which
  // GridCraft saves as '<stem>.xlsx': a host that ignores letter case would take that for the
  // opened file. The copy is GridCraft's own file and, opened again, saves back into itself: with
  // GridCraft 0.6.1 it has the parts of Excel's file that GridCraft keeps, and so does its save.
  const foreign: [opened: string, bytes: Buffer, saved: string, lost: [part: string, text: string]][] = [
    ['from-excel.xlsx', FROM_EXCEL, 'from-excel.xlsx', ['docProps/core.xml', '<dcterms:created']],
    ['CHANGED-ELSEWHERE.XLSX', changedElsewhere(), 'CHANGED-ELSEWHERE.xlsx', ['customXml/item1.xml', 'keep me']],
  ];
  for (const [opened, bytes, name, [part, lost]] of foreign) {
    await scenario(context, `${opened} is never replaced: the first save is a new file ${name}, the next one replaces that file`, async (page, downloads) => {
      const { app, titles } = await openInHost(page, opened, '', bytes);
      await editCell(page, app, titles, 3, 'EDIT-1');
      await press(page, app, 'Control+s');
      const first = await hostSave(page, 1);
      expectDocument(first.save, name, first.save.id);
      const saved = expectSavedWorkbook(first.bytes, ['EDIT-1']);
      expect(saved.text(part), `what GridCraft drops (${part})`).not.toContain(lost);

      await editCell(page, app, titles, 4, 'EDIT-2');
      await press(page, app, 'Control+s');
      const second = await hostSave(page, 2);
      expectDocument(second.save, name, first.save.id);
      expectSavedWorkbook(second.bytes, ['EDIT-1', 'EDIT-2']);

      const copy = name.replace(/\.xlsx$/, '-2.xlsx'); // a name the host could give it

      await test.step(`the copy, opened again as ${copy}, saves back into itself`, async () => {
        const again = await openInHost(page, copy, '', second.bytes);
        await press(page, again.app, 'Control+s');
        const third = await hostSave(page, 1);
        expectDocument(third.save, copy);
        expect(workbook(third.bytes).parts, 'the parts of the copy').toEqual(expect.arrayContaining(workbook(second.bytes).parts));
      });

      expectNoDownloads(downloads);
    });
  }

  // Imports save as '<stem>.xlsx' or '<stem> (imported).xlsx': the host stores the first save next
  // to the original, which stays as it is, and replaces it with the next.
  const imports: [opened: string, saved: string][] = [
    ['macros.xlsm', 'macros.xlsx'],
    ['data.ods', 'data (imported).xlsx'],
    ['data.csv', 'data.xlsx'],
  ];
  for (const [opened, saved] of imports) {
    await scenario(context, `${opened} saves as '${saved}', the document, and so does the next save`, async (page, downloads) => {
      const { app, titles } = await openInHost(page, opened);
      await editCell(page, app, titles, 3, 'EDIT-1');
      await press(page, app, 'Control+s');
      const first = await hostSave(page, 1);
      expectDocument(first.save, saved);
      expectSavedWorkbook(first.bytes, ['EDIT-1']);

      await press(page, app, 'Control+s');
      const second = await hostSave(page, 2);
      expectDocument(second.save, saved);
      expectSavedWorkbook(second.bytes, ['EDIT-1']);
      expectNoDownloads(downloads);
    });
  }

  await scenario(context, 'GridCraft\'s sales sample (charts, a table, notes) saves back unchanged as the document', async (page, downloads) => {
    // Every part of it is one GridCraft's writer produces, and the writer is deterministic. The
    // bytes are 0.6.1's (0.5.0 wrote the sample's icon set without its thresholds); 0.5.0 saves
    // them back unchanged too.
    const { app } = await openInHost(page, 'sales-sample.xlsx');
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'sales-sample.xlsx');
    expect(bytes.equals(fixture('sales-sample.xlsx')), 'the same bytes as the opened file').toBe(true);
    expectNoDownloads(downloads);
  });

  // A new workbook is 'Book1' in every session and saves as 'Book1.xlsx': with the opened file
  // named so, nothing in the bytes tells the two apart.
  await scenario(context, 'an opened Book1.xlsx is never saved back, and a new workbook saved under that name is a new file', async (page, downloads) => {
    const { app, titles } = await openInHost(page, 'Book1.xlsx', '', PROBE);
    await press(page, app, 'Control+s');
    const own = await hostSave(page, 1);
    expectExport(own.save, 'Book1.xlsx');
    expectSavedWorkbook(own.bytes);

    await newWorkbook(page, app, titles); // 'Book1' too: the opened window is titled 'Book1.xlsx'
    await editCell(page, app, titles, 1, 'NEW-BOOK');
    await press(page, app, 'Control+s');
    const other = await hostSave(page, 2);
    expectExport(other.save, 'Book1.xlsx');
    expect(workbook(other.bytes).cells, 'the new workbook, not the opened one').not.toContain(MARKER);
    expectNoDownloads(downloads);
  });

  // The blank of the "+ New" entry in Files (craftsuite_layer/blanks.mjs): GridCraft's own new
  // workbook on A4, so its save is the document, not a copy.
  for (const name of ['blank.xlsx', 'blank-letter.xlsx']) {
    await scenario(context, `the + New blank ${name} opens, and its first save is the document`, async (page, downloads) => {
      const { app } = await openInHost(page, `blanks/${name}`);
      await press(page, app, 'Control+s');
      expectDocument((await hostSave(page, 1)).save, name);
      expectNoDownloads(downloads);
    });
  }

  // A file the user brings in opens as a further window titled with its own name and saves as
  // '<stem>.xlsx': with the opened file's name it would come back under the document's name, with
  // other content (here an Excel file, sheet 'Data', re-encoded with losses).
  await scenario(context, 'a different craftsuite-probe.xlsx opened with File > Open is never the document', async (page, downloads) => {
    const { app, titles } = await openInHost(page, 'craftsuite-probe.xlsx');
    await editCell(page, app, titles, 3, 'EDIT-1'); // the window title changes, so the next file's shows
    await press(page, app, 'Control+s');
    expectDocument((await hostSave(page, 1)).save, 'craftsuite-probe.xlsx'); // before the other file arrived
    await openFromDisk(page, app, titles, 'craftsuite-probe.xlsx', FROM_EXCEL);
    await press(page, app, 'Control+s'); // saves the active window: the file from the disk
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'craftsuite-probe.xlsx');
    expect(workbook(bytes).sheets, 'the file from the disk').toEqual(['Data']);
    expectNoDownloads(downloads);
  });

  await chromiumOnly(browserName, () => scenario(context, 'a different craftsuite-probe.xlsx dropped from the desktop is never the document', async (page, downloads) => {
    const file = test.info().outputPath('elsewhere', 'craftsuite-probe.xlsx');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, FROM_EXCEL);
    const { app, titles } = await openInHost(page, 'craftsuite-probe.xlsx');
    await editCell(page, app, titles, 3, 'EDIT-1');
    await press(page, app, 'Control+s');
    expectDocument((await hostSave(page, 1)).save, 'craftsuite-probe.xlsx');
    await dropFromDesktop(page, app, titles, file);
    await press(page, app, 'Control+s'); // saves the active window: the dropped file
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'craftsuite-probe.xlsx');
    expect(workbook(bytes).sheets, 'the dropped file').toEqual(['Data']);
    expectNoDownloads(downloads);
  }));
});

// GridCraft takes the host's language through navigator.language, which it reads once as it
// starts (the adapter's language member overrides it), and shows it only in the picture. Under the
// pinned locale en-US, a start with lang=ru must look like a start under the browser locale ru-RU
// and not like an English one: the second comparison fails when a release stops following
// navigator.language.
test('language: the host\'s lang=ru starts GridCraft in Russian, as the browser locale ru-RU does', { tag: '@language' }, async ({ page, context, browser }) => {
  // Three starts of GridCraft, which on a busy machine can take longer than the default timeout.
  test.slow();
  const { app } = await openInHost(page, 'craftsuite-probe.xlsx', '&lang=ru');
  const shown = await tabRow(page);

  await test.step('ready reports ru, and the app frame sees ru as the browser language', async () => {
    expect.soft((await hostRecord(page)).readies[0]?.language, 'language of the ready message').toBe('ru');
    expect.soft(await app.evaluate(() => navigator.language), 'navigator.language in the app frame').toBe('ru');
  });

  await test.step('the tab row is the one of a start under the browser locale ru-RU', async () => {
    // The locale belongs to a context; this one has the spec's other options (viewport, device).
    const russian = await browser.newContext({ locale: 'ru-RU' });
    try {
      const other = await russian.newPage();
      await openInHost(other, 'craftsuite-probe.xlsx');
      await compareTabRows(shown, await tabRow(other), 'a start under the locale ru-RU', true);
    } finally {
      await russian.close();
    }
  });

  await test.step('and not the one of an English start', async () => {
    const other = await context.newPage();
    await openInHost(other, 'craftsuite-probe.xlsx');
    await compareTabRows(shown, await tabRow(other), 'a start without lang (locale en-US)', false);
  });
});

// The exports of the File view: the CSV of an opened data.csv has the opened name, and must not
// pass as the document (its save name is data.xlsx).
test('ui: File > Save, File > Export as PDF and as CSV with the pointer', { tag: '@ui' }, async ({ page }) => {
  const downloads = trackDownloads(page);
  const { app, titles } = await openInHost(page, 'data.csv');
  // The File tab, then an entry of the File view's list, then a button on the page it shows.
  const inFileView = async (entry: string, at: (b: Box) => { x: number; y: number }, button: string, on: (b: Box) => { x: number; y: number }) => {
    await clickApp(page, app, 'the File tab', AT.fileTab);
    await settle(page.locator('#app'), app); // the File view
    await clickApp(page, app, `${entry} in the File view`, at);
    await settle(page.locator('#app'), app); // its page
    await clickApp(page, app, button, on);
  };

  await test.step('File > Save, then Download on its Save As page, saves the document, like Ctrl+S', async () => {
    await editCell(page, app, titles, 3, 'EDIT-1');
    await inFileView('Save', AT.fileSave, 'Download (.xlsx) on the Save As page', AT.saveAsDownload);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'data.xlsx');
    expectSavedWorkbook(bytes, ['EDIT-1']);
  });

  await test.step('File > Export > Create PDF: a PDF under the title, a new file', async () => {
    await inFileView('Export', AT.fileExport, 'Create PDF on the Export page', AT.exportPdf);
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'data.pdf');
    expect(bytes.subarray(0, 5).toString('latin1'), 'a PDF').toBe('%PDF-');
  });

  await test.step('File > Export > CSV: under the opened name data.csv, a new file', async () => {
    await inFileView('Export', AT.fileExport, 'CSV (Comma delimited) on the Export page', AT.exportCsv);
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'data.csv');
    expect(bytes.toString('utf8'), 'the sheet with the edit, as CSV').toMatch(new RegExp(`^${MARKER},42\\r?\\n[^]*EDIT-1`));
    expectNoDownloads(downloads);
  });
});
