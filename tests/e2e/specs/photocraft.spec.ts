// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real PhotoCraft web build. See docs/apps/photocraft.md. Five tests; a
// test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract      allowed host, an opened PSD: handshake with the served app version, open; an
//                 edit saved with Ctrl+S arrives as the document under its own name, with the edit;
//                 a second edit saved with Save As (no dialog on the web) is the document again;
//                 Quick Export as PNG arrives as a new file; nothing becomes a download, also not
//                 after the deadlines for the host's confirmation and result have passed
//   another type  an opened PNG: Ctrl+S saves it as '<stem>.psd', which arrives as the document
//                 (the host stores it next to the PNG), and so does the second Ctrl+S; a flat PNG
//                 export under the opened name is a new file. A different PSD with the same name
//                 that the user brings in (File > Open; in Chromium also a drop from the desktop)
//                 is never the document. An opened Untitled-1.png, named like a new document, is
//                 never saved back: its save and that of a new document (File > New), both
//                 'Untitled-1.psd', are new files. The blank of the "+ New" entry in Files opens,
//                 and its first Ctrl+S (no edit) arrives as the document 'blank.psd'
//   startup      a preset storage (IndexedDB) that never answers delays PhotoCraft's drop target
//                 by 10 s: the host gets no error, and the file opens once the app takes drops
//   language      the host's de: ready reports de, PhotoCraft's stored preference and the
//                 adapter's mark are de, and PhotoCraft shows German (its command palette runs
//                 'Öffnen', File > Open, which opens the file picker). A language the user picked
//                 in PhotoCraft (fr, stored while no PhotoCraft runs) stays at the next start with
//                 the host's de: ready reports none, and PhotoCraft shows French ('Ouvrir')
//   ui (@ui)      the paths that need pointer clicks: File > Save in the menu bar saves the
//                 document; the Export button of the Export As dialog exports a new file;
//                 PhotoCraft's own link (About > Contributors) opens a new window, the editor stays
//
// A daily canary runs this file against every new PhotoCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see
// (section "Contract"). Steps use the keyboard and the command palette (Ctrl+F), with shortcuts
// and command labels from PhotoCraft's crates/ui-egui/src/menu_catalog.rs. Only the test tagged
// @ui also clicks with the pointer: a moved button fails it without the translator being at fault.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { appFrames, PALETTE_KEYS, press, runCommand, settle } from '../lib/craft-ui.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures/photocraft/', import.meta.url));
// Written by fixtures/photocraft/make-fixtures.mjs: 64x48, the pixel at (0, 0) is (0, 0, 64).
const PROBE_PSD = 'photocraft/probe.psd';
const PROBE_PNG = 'photocraft/probe.png';
const PROBE = { width: 64, height: 48 };
const PROBE_CORNER = [0, 0, 64];
// A different PSD (40x40) under the same name, as if from the user's own disk.
const ELSEWHERE = path.join(FIXTURES, 'elsewhere', 'probe.psd');
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/photocraft/`;
// Translator timeouts (host knobs app-ack, app-result) where a test waits for them, in ms.
const SHORT_ACK = 3000;
const SHORT_RESULT = 3000;
// Where `npm run craft:fetch` records the selected builds, as in server/serve.mjs.
const SELECTED = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)),
  process.env.CRAFT_BUILDS_DIR || '.craft-builds', 'selected.json');
// In the app frame's localStorage: PhotoCraft's preferences (its interface language in
// interface.language), and the code the adapter wrote there last (translators/photocraft.js).
const PREFS_KEY = 'photocraft.preferences';
const LANGUAGE_MARK = 'craftsuite-layer:photocraft:language';

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
  readies: { layerVersion: string; language: string | null }[]; // language 'absent' without the field
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

// Pinned: the @ui click positions depend on the layout, and PhotoCraft's labels on the language.
// Scale factor 1 also in WebKit (Desktop Safari has 2): at 2, software rendering made PhotoCraft's
// frames 6 to 10 times slower, and a click on a link mostly selected its text instead, as egui does
// for a press it takes for a drag (one held longer than 0.8 s, egui input_state/mod.rs).
test.use({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' });

// The browser downloads of a page, from now on.
function trackDownloads(page: Page) {
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  return downloads;
}

// For a test with several independent scenarios: each runs as a step in a page of its own, and a
// failure is reported (as a soft error) without stopping the scenarios after it, so one run lists
// every scenario that broke. The app starts without the preferences an earlier page stored, as
// in a fresh browser. The page of a passed scenario is closed; a failed one stays open for the
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
// UI: drive PhotoCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// The File menu from its top down to Save, in the order PhotoCraft draws it: the File rows of
// crates/ui-egui/src/menu_catalog.rs, with New from Clipboard after New and the Open Recent
// submenu after Open As (menus.rs menu_items); '---' is a separator. A release that adds a row
// above Save moves Save down: add the row here (0.7.0 added Open EXR Parts…).
const FILE_MENU = {
  rows: ['New…', 'New from Clipboard', 'Open…', 'Open As…', 'Open Recent', 'Open EXR Parts…', '---',
    'Close', 'Close All', 'Close Others', '---', 'Save'],
  // The top of the first row in the frame: below the menu bar, the menu's margin and the
  // scroll-up arrow (16 px and 6 px spacing, menu_nav.rs level) that a menu taller than the frame
  // gets, as the File menu has been since 0.7.0 (in 0.6.0 it fit, and its first row began at 35).
  top: 57,
};

// The middle of a menu row, from the rows above it: 24 px per row (interact_size, theme.rs) and
// 9 px per separator (MENU_SEPARATOR, menus.rs).
function menuRowY(menu: { rows: string[]; top: number }, label: string) {
  const at = menu.rows.indexOf(label);
  if (at < 0) throw new Error(`no row ${label} in the menu's rows`);
  const separators = menu.rows.slice(0, at).filter((row) => row === '---').length;
  return menu.top + (at - separators) * 24 + separators * 9 + 12;
}

// Pointer targets (PhotoCraft 0.7.0), relative to the app frame at the pinned viewport. This and
// FILE_MENU are the only layout knowledge in this file; when a release moves something, fix it
// here.
const AT = {
  // Menu bar: File, the first menu right of the app icon.
  fileMenu: (b: Box) => ({ x: b.x + 57, y: b.y + 15 }),
  // The File menu: Save, by its rows.
  fileSave: (b: Box) => ({ x: b.x + 73, y: b.y + menuRowY(FILE_MENU, 'Save') }),
  // Export As, a modal centred in the frame: Export, the default button, first of the two in the
  // Windows and Linux order, last in the macOS order (Cancel Export; see platformIsMac()). 0.10.0
  // added the Color Profile rows, which moved the buttons down from +188, and 0.12.0 the Embed
  // Color Profile row, from +229.
  exportButton: (b: Box, mac: boolean) => ({ x: b.x + b.width / 2 + (mac ? 258 : 164), y: b.y + b.height / 2 + 245 }),
  // About PhotoCraft, a modal centred in the frame and sized to its tab. On the About tab: the
  // Contributors tab, second in its tab row.
  aboutContributorsTab: (b: Box) => ({ x: b.x + b.width / 2 - 239, y: b.y + b.height / 2 - 77 }),
  // On the Contributors tab (a taller modal): the first name in the list, a link to a profile.
  firstContributor: (b: Box) => ({ x: b.x + b.width / 2 - 320, y: b.y + b.height / 2 - 20 }),
};

// Shortcuts, from menu_catalog.rs. Its Cmd is Ctrl or Meta in the browser (eframe web input.rs).
const KEY = {
  save: 'Control+s',
  saveAs: 'Control+Shift+s', // no dialog on the web: saves under the suggested name
  open: 'Control+o', // the browser's file picker
  new: 'Control+n', // the New dialog, its name field 'Untitled-1'
  exportAs: 'Control+Alt+Shift+w',
  invert: 'Control+i',
  desaturate: 'Control+Shift+u',
};
const PALETTE = PALETTE_KEYS.photocraft;

function appFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url().startsWith(APP));
  if (!frame) throw new Error(`no frame shows ${APP}`);
  return frame;
}

// egui takes the platform from the user agent (egui src/os.rs), and PhotoCraft orders dialog
// buttons by it (ui-egui widgets.rs dialog_buttons). Playwright's Desktop Safari is a Mac.
function platformIsMac(app: Frame) {
  return app.evaluate(() => navigator.userAgent.includes('Mac') && !navigator.userAgent.includes('like Mac'));
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

// An edit, then a save, by keyboard; the app applies the edit on its next frames.
async function editAndSave(page: Page, app: Frame, edit: string, save: string) {
  await test.step(`ui: ${edit}, then ${save}`, async () => {
    await press(page, app, edit);
    await settle(page.locator('#app'), app);
    await press(page, app, save);
  });
}

// File > New (Ctrl+N), confirmed with Enter: a new document tab, 'Untitled-1', 1920x1080
// (crates/ui-egui/src/new_doc_ui.rs, state.rs new_document_fields).
async function newDocument(page: Page, app: Frame) {
  await test.step(`ui: File > New (${KEY.new}), Enter`, async () => {
    await press(page, app, KEY.new);
    await settle(page.locator('#app'), app); // the New dialog
    await page.keyboard.press('Enter');
    await settle(page.locator('#app'), app);
  });
}

// Loads the test host with PhotoCraft and a fixture, and waits until the translator has handed
// the file to the app.
async function openInHost(page: Page, fixture: string, query = '') {
  await page.goto(`${HOST}?target=photocraft&name=${fixture}${query}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  await settle(page.locator('#app'), app); // the app opens the file a few frames after the drop
  return app;
}

// File > Open with a file from the user's disk, through the browser's file picker.
async function openFromDisk(page: Page, app: Frame, file: string) {
  await test.step(`ui: File > Open (${KEY.open}) of ${path.basename(file)} from the disk`, async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await press(page, app, KEY.open);
    await (await chooser).setFiles(file);
    await settle(page.locator('#app'), app); // a new document tab
  });
}

// Runs File > Open from the command palette by its label in one language and tells whether the
// browser's file picker opened. The palette matches the shown and the English labels, and puts a
// command whose shown label is exactly what was typed first (palette.rs menu_hits, exact_bonus):
// 'Öffnen' runs File > Open only in German, 'Ouvrir' only in French (ui-egui i18n/de.tsv, fr.tsv);
// in another language it runs another command or none, and no file picker opens.
async function filePickerFrom(page: Page, app: Frame, label: string) {
  const chooser = page.waitForEvent('filechooser', { timeout: 10_000 }).then(() => true, () => false);
  await runCommand(page, app, label, PALETTE);
  return chooser;
}

// A user's drag and drop of a file from the desktop onto the middle of the app's top edge, the
// title in the menu bar, where it opens as a new document tab: since 0.10.0 a drop on the open
// document's canvas places the file as a layer instead (file_open.rs drop_target). Only Chromium
// can send such a trusted drop (DevTools protocol), see chromiumOnly().
async function dropFromDesktop(page: Page, app: Frame, file: string) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const at = { x: box.x + box.width / 2, y: box.y + 15 };

  await test.step(`ui: drop ${path.basename(file)} from the desktop`, async () => {
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, ...at, data });
    await cdp.detach();
    await settle(page.locator('#app'), app); // a new document tab
  });
}

// ---------------------------------------------------------------------------------------------
// Contract: what the host and the browser see.
// ---------------------------------------------------------------------------------------------

const hostRecord = (page: Page): Promise<HostRecord> => page.evaluate(() => (window as HostWindow).__host!);

// The interface language in PhotoCraft's stored preferences, which it reads once as it starts,
// and the adapter's mark, as the app frame sees them.
function storedLanguage(app: Frame) {
  return app.evaluate(({ prefsKey, markKey }) => {
    const prefs = JSON.parse(localStorage.getItem(prefsKey) ?? 'null') as { interface?: { language?: unknown } } | null;
    return { language: prefs?.interface?.language ?? null, mark: localStorage.getItem(markKey) };
  }, { prefsKey: PREFS_KEY, markKey: LANGUAGE_MARK });
}

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

// For the @ui test: click a link and return the window it opened. Without one, tell a link that
// did nothing (a click that missed, see AT) from a link that replaced the editor (translator).
// egui takes a press it sees for longer than 0.8 s for a drag, which on a link selects text: under
// load, WebKit's frames can be that slow. So a click that did nothing is tried once more, with a
// warning and a screenshot of what the first one left.
async function followLink(page: Page, app: Frame, what: string, at: (b: Box) => { x: number; y: number }) {
  for (let attempt = 1; ; attempt++) {
    const popup = page.waitForEvent('popup', { timeout: 10_000 });
    await clickApp(page, app, what, at);
    try {
      return await popup;
    } catch {
      const url = app.isDetached() ? 'nothing' : app.url();
      if (!url.startsWith(APP)) throw new Error(`no new window: the link replaced the editor in the frame, which now shows ${url}`);
      if (attempt >= 2) throw new Error('no new window, and the editor is still in the frame: the click missed the link (check AT)');
      test.info().annotations.push({ type: 'warning', description: `no new window after the first click on ${what}; clicked again` });
      await test.info().attach(`after the first click on ${what}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
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

// The opened document: the host may replace its file (or, under another name, store it next to
// the opened file and replace that from then on).
function expectDocument(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'document', openId: 1, name });
}

// Anything else: the host stores it as a new file.
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, name });
}

// A Photoshop file (version 1, RGB) of the given size. Returns the RGB of its merged image at
// (0, 0), which PhotoCraft writes RLE-compressed (PackBits) or raw.
function expectPsd(bytes: Buffer, size: { width: number; height: number }) {
  expect(bytes.subarray(0, 4).toString('latin1'), 'the PSD signature').toBe('8BPS');
  expect(bytes.readUInt16BE(4), 'PSD version').toBe(1);
  expect({ width: bytes.readUInt32BE(18), height: bytes.readUInt32BE(14) }, 'PSD size').toEqual(size);
  const channels = bytes.readUInt16BE(12);
  let at = 26;
  for (let section = 0; section < 3; section++) at += 4 + bytes.readUInt32BE(at); // mode data, resources, layers
  const compression = bytes.readUInt16BE(at);
  at += 2;
  if (compression === 0) return [0, 1, 2].map((c) => bytes[at + c * size.width * size.height]);
  expect(compression, 'merged image compression: raw or RLE').toBe(1);
  // RLE: the byte count of every row of every channel, then the rows, channel after channel. A
  // row starts with a run header, literal (n >= 0) or repeat (n < 0); either way, the first
  // pixel's value is the byte after it.
  const data = at + 2 * channels * size.height;
  const rowStart = (index: number) => {
    let start = data;
    for (let r = 0; r < index; r++) start += bytes.readUInt16BE(at + 2 * r);
    return start;
  };
  return [0, 1, 2].map((c) => bytes[rowStart(c * size.height) + 1]);
}

// A PNG of the given size.
function expectPng(bytes: Buffer, size: { width: number; height: number }) {
  expect(bytes.subarray(0, 8).toString('latin1'), 'the PNG signature').toBe('\x89PNG\r\n\x1a\n');
  expect({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }, 'PNG size').toEqual(size);
}

const inverted = (rgb: number[]) => rgb.map((v) => 255 - v);

// A scenario that needs a trusted drop (dropFromDesktop) runs in Chromium only; elsewhere the
// test notes that it did not run.
async function chromiumOnly(browserName: string, run: () => Promise<void>) {
  if (browserName === 'chromium') return run();
  test.info().annotations.push({ type: 'skipped scenario', description: 'a drop from the desktop needs Chromium (DevTools protocol)' });
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// ---------------------------------------------------------------------------------------------

test('contract: an opened PSD is saved back as the document, an export is a new file, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, PROBE_PSD, `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'photocraft'), 'messages from another app than photocraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.photocraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.photocraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('Ctrl+S saves the edit as the document, under its own name', async () => {
    await editAndSave(page, app, KEY.invert, KEY.save);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'probe.psd');
    expect(expectPsd(bytes, PROBE), 'the saved picture is inverted').toEqual(inverted(PROBE_CORNER));
  });

  await test.step('Save As (no dialog on the web) saves the next edit as the document again', async () => {
    await editAndSave(page, app, KEY.desaturate, KEY.saveAs);
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, 'probe.psd');
    const [r, g, b] = expectPsd(bytes, PROBE);
    expect([g, b], 'the saved picture is grey').toEqual([r, r]);
  });

  await test.step('Quick Export as PNG arrives as a new file next to the document', async () => {
    await runCommand(page, app, 'Quick Export as PNG File', PALETTE); // not Layer > Quick Export as PNG
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'probe.png');
    expectPng(bytes, PROBE);
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

test('another type: an opened PNG is saved as <stem>.psd, the document; a same-named file from elsewhere never is', async ({ context, browserName }) => {
  await scenario(context, 'Ctrl+S saves an opened PNG as probe.psd, the document, and so does the next Ctrl+S; a PNG export under the opened name is a new file', async (page, downloads) => {
    const app = await openInHost(page, PROBE_PNG);
    await editAndSave(page, app, KEY.invert, KEY.save);
    const first = await hostSave(page, 1);
    expectDocument(first.save, 'probe.psd');
    expect(expectPsd(first.bytes, PROBE), 'the saved picture is inverted').toEqual(inverted(PROBE_CORNER));

    await editAndSave(page, app, KEY.desaturate, KEY.save);
    const second = await hostSave(page, 2);
    expectDocument(second.save, 'probe.psd');
    const [r, g, b] = expectPsd(second.bytes, PROBE);
    expect([g, b], 'the saved picture is grey').toEqual([r, r]);

    // The opened file's own name, but a flattened copy: it must never replace the PNG.
    await runCommand(page, app, 'Quick Export as PNG File', PALETTE);
    const flat = await hostSave(page, 3);
    expectExport(flat.save, 'probe.png');
    expectPng(flat.bytes, PROBE);
    expectNoDownloads(downloads);
  });

  // A file the user brings in is saved as '<stem>.psd' too: with the opened file's stem it would
  // come back under the document's name, with other content.
  await scenario(context, 'a different probe.psd opened with File > Open is never the document', async (page, downloads) => {
    const app = await openInHost(page, PROBE_PNG);
    await press(page, app, KEY.save);
    expectDocument((await hostSave(page, 1)).save, 'probe.psd'); // before the other file arrived
    await openFromDisk(page, app, ELSEWHERE);
    await press(page, app, KEY.save); // saves the active tab: the file from the disk
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'probe.psd');
    expectPsd(bytes, { width: 40, height: 40 });
    expectNoDownloads(downloads);
  });

  // File > New names a document 'Untitled-1', and it saves as 'Untitled-1.psd' without asking:
  // with the opened file named so, nothing in the PSD tells the two apart.
  await scenario(context, 'a file named like a new document (Untitled-1.png) is never saved back, and a new document never replaces it', async (page, downloads) => {
    const png = await readFile(path.join(FIXTURES, 'probe.png'));
    await page.route(`${HOST}files/photocraft/Untitled-1.png`, (route) => route.fulfill({ body: png, contentType: 'image/png' }));
    const app = await openInHost(page, 'photocraft/Untitled-1.png');
    await editAndSave(page, app, KEY.invert, KEY.save);
    const own = await hostSave(page, 1);
    expectExport(own.save, 'Untitled-1.psd');
    expect(expectPsd(own.bytes, PROBE), 'the opened picture, inverted').toEqual(inverted(PROBE_CORNER));

    await newDocument(page, app);
    await press(page, app, KEY.save); // saves the active tab: the new document
    const other = await hostSave(page, 2);
    expectExport(other.save, 'Untitled-1.psd');
    expectPsd(other.bytes, { width: 1920, height: 1080 });
    expectNoDownloads(downloads);
  });

  await chromiumOnly(browserName, () => scenario(context, 'a different probe.psd dropped from the desktop is never the document', async (page, downloads) => {
    const app = await openInHost(page, PROBE_PNG);
    await press(page, app, KEY.save);
    expectDocument((await hostSave(page, 1)).save, 'probe.psd'); // before the other file arrived
    await dropFromDesktop(page, app, ELSEWHERE);
    await press(page, app, KEY.save); // saves the active tab: the dropped file
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'probe.psd');
    expectPsd(bytes, { width: 40, height: 40 });
    expectNoDownloads(downloads);
  }));

  // craftsuite_layer/assets/blank.psd, made by blanks.mjs: PhotoCraft's own new document, so only
  // its name tells its save from a new document's.
  await scenario(context, 'the + New blank opens and its first save replaces it', async (page, downloads) => {
    const app = await openInHost(page, 'blanks/blank.psd');
    await press(page, app, KEY.save); // no edit needed: a dropped file has no path, so Save always saves
    expect((await hostSave(page, 1)).save).toMatchObject({ kind: 'document', openId: 1, follows: null, name: 'blank.psd' });
    expectNoDownloads(downloads);
  });
});

test('startup: a preset storage that never answers delays the drop target, the host gets no error', async ({ page }) => {
  // PhotoCraft waits up to 10 s for its brush presets (IndexedDB) before it registers its drop
  // target (photocraft-web web.rs, indexed_presets.rs). Here the storage never answers.
  await page.addInitScript((appOrigin) => {
    if (location.origin !== appOrigin) return;
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<IDBFactory['open']>) {
      const request = open.apply(this, args);
      for (const handler of ['onsuccess', 'onerror', 'onupgradeneeded', 'onblocked']) {
        Object.defineProperty(request, handler, { configurable: true, get: () => null, set() { /* never called back */ } });
      }
      request.addEventListener = () => undefined;
      return request;
    };
  }, APP_ORIGIN);
  const loaded = Date.now();
  await page.goto(`${HOST}?target=photocraft&name=${PROBE_PSD}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 60_000);
  expect(Date.now() - loaded, 'the storage never answered, so PhotoCraft waited for it').toBeGreaterThanOrEqual(9_000);
  expect.soft((await hostRecord(page)).errors, 'errors the host got (the drop target came after the core\'s default 3 s)').toEqual([]);
  expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
});

test('language: the host\'s de starts PhotoCraft in German, a language the user picked in it stays', { tag: '@language' }, async ({ page, context }) => {
  // PhotoCraft never takes its language from the browser (en-US here, see test.use), only from its
  // stored preferences, which the adapter writes before PhotoCraft reads them. The second start
  // builds on what the first one stored, so both run in this test, one after the other.
  await test.step('lang=de: ready reports de, the stored preference is de, PhotoCraft shows German', async () => {
    const app = await openInHost(page, PROBE_PSD, '&lang=de');
    expect.soft((await hostRecord(page)).readies[0]?.language, 'the language ready reported').toBe('de');
    expect.soft(await storedLanguage(app), 'PhotoCraft\'s stored language and the adapter\'s mark').toEqual({ language: 'de', mark: 'de' });
    expect(await filePickerFrom(page, app, 'Öffnen'), 'the palette ran \'Öffnen\' (File > Open in German): the file picker opened').toBe(true);
  });

  // No PhotoCraft runs from here until the next start, which finds the user's choice stored.
  await page.close();

  await test.step('a language the user picked (fr) stays: ready reports none, PhotoCraft shows French', async () => {
    const next = await context.newPage();
    // The choice as Edit > Preferences > Interface stores it, from an earlier visit: written into
    // the frame's storage before anything runs there.
    await next.addInitScript(({ appOrigin, prefsKey }) => {
      if (location.origin !== appOrigin) return;
      const prefs = JSON.parse(localStorage.getItem(prefsKey) ?? '{}') as { interface?: object };
      localStorage.setItem(prefsKey, JSON.stringify({ ...prefs, interface: { ...prefs.interface, language: 'fr' } }));
    }, { appOrigin: APP_ORIGIN, prefsKey: PREFS_KEY });
    const app = await openInHost(next, PROBE_PSD, '&lang=de');
    expect.soft((await hostRecord(next)).readies[0]?.language, 'the language ready reported').toBeNull();
    expect.soft(await storedLanguage(app), 'the user\'s fr stays, and the adapter\'s mark still has de').toEqual({ language: 'fr', mark: 'de' });
    expect(await filePickerFrom(next, app, 'Ouvrir'), 'the palette ran \'Ouvrir\' (File > Open in French): the file picker opened').toBe(true);
  });
});

test('ui: File > Save, the Export As dialog and About > Contributors with the pointer', { tag: '@ui' }, async ({ context }) => {
  // Three paths in a page each; a path that misses its button runs into its waits on its own.
  test.slow();

  await scenario(context, 'File > Save in the menu bar saves the document like Ctrl+S', async (page, downloads) => {
    const app = await openInHost(page, PROBE_PSD);
    await press(page, app, KEY.invert);
    await settle(page.locator('#app'), app);
    await clickApp(page, app, 'the File menu', AT.fileMenu);
    await settle(page.locator('#app'), app);
    await clickApp(page, app, 'Save in the File menu', AT.fileSave);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'probe.psd');
    expect(expectPsd(bytes, PROBE), 'the saved picture is inverted').toEqual(inverted(PROBE_CORNER));
    expectNoDownloads(downloads);
  });

  await scenario(context, 'the Export button of the Export As dialog exports a new file', async (page, downloads) => {
    const app = await openInHost(page, PROBE_PSD);
    await press(page, app, KEY.exportAs);
    await settle(page.locator('#app'), app); // the dialog, PNG preselected
    const mac = await platformIsMac(app);
    await clickApp(page, app, 'Export in the Export As dialog', (b) => AT.exportButton(b, mac));
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'probe.png');
    expectPng(bytes, PROBE);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'PhotoCraft\'s own link (About > Contributors) opens a new window, the editor stays', async (page, downloads) => {
    // Up to 0.6.0 the names were egui hyperlinks, opened with target _self, which the translator
    // turns into a new window; since 0.7.0 they open a new tab themselves (credits.rs, links.rs).
    // Either way the editor must stay in the frame. The link leads to an https page: answer it
    // here, so the test needs no network. The test origins are all http.
    await context.route((url) => url.protocol === 'https:', (route) => route.fulfill({ contentType: 'text/html', body: '' }));
    const app = await openInHost(page, PROBE_PSD);
    await runCommand(page, app, 'About PhotoCraft', PALETTE);
    await settle(page.locator('#app'), app); // the About dialog
    await clickApp(page, app, 'the Contributors tab of About', AT.aboutContributorsTab);
    await settle(page.locator('#app'), app);
    const opened = await followLink(page, app, 'the first contributor\'s link', AT.firstContributor);
    await expect(opened, 'the link opened in the new window').toHaveURL(/^https:\/\//);
    await opened.close();
    expect(app.isDetached(), 'the app frame is still there').toBe(false);
    const href = await app.evaluate(() => location.href);
    expect(href.startsWith(APP), `the app frame still shows ${APP}, not ${href}`).toBe(true);
    expectNoDownloads(downloads);
  });
});
