// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real DesignCraft web build. See docs/apps/designcraft.md. Three
// tests; a test with several scenarios runs each in its own page and reports every scenario that
// fails.
//
//   contract   allowed host: handshake with the served app version, open of a .designcraft
//              whose stored title differs from its name; an edit saved with Ctrl+S arrives as the
//              document under the opened name, a DesignCraft package with the edit, and Save As
//              (Ctrl+Shift+S) after another edit is the document again; Export Page as PNG
//              (Ctrl+E) and the save of a new document (Ctrl+N) arrive as new files; nothing
//              becomes a download, also not after the deadlines for the host's confirmation and
//              result
//   saved-as   saves under another name or type: an opened .idml saves as '<stem>.designcraft'
//              (named after the file, not the title stored in it), as the document, and so does
//              the next save, with the edit; 'X.DESIGNCRAFT' saves as 'X.designcraft' and an IDML
//              named 'x.idml.idml' as 'x.designcraft', both as the document. Untitled-1.designcraft
//              from the desktop app (a creation time) saves as the document, and a new document
//              (Ctrl+N), which saves under the same name, as a new file. The blank of the "+ New"
//              entry in Files (blanks/blank.designcraft) opens, and its first save is the document
//   ui (@ui)  the File menu with the pointer, on an opened .idml: Save saves the document; Export
//              IDML…, under the opened name, arrives as a new file
//
// A daily canary runs this file against every new DesignCraft release, so the steps that drive
// the app (section "UI") are kept apart from the checks of what the host and the browser see
// (section "Contract"). DesignCraft has no command palette (Ctrl+K is Preferences, and Quick
// Apply on Ctrl+Enter lists matching styles before commands; before 0.6.0 it ran its first entry
// at once), so the steps use its keyboard shortcuts, from crates/ui-egui/src/menus.rs
// (UI_COMMANDS) and crates/engine/src/cmd/layout.rs. Only the test tagged @ui also clicks with
// the pointer: a moved menu item fails it without the translator being at fault.
//
// The fixtures in fixtures/designcraft/ were made with DesignCraft 0.5.0 (see the docs page):
// craftsuite-probe.designcraft stores the title 'Untitled-1', from-indesign.idml the name
// 'craftsuite-probe.indd'; both hold one page and a text frame with MARKER.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { appFrames, press, settle } from '../lib/craft-ui.ts';

const PROBE = readFileSync(new URL('../fixtures/designcraft/craftsuite-probe.designcraft', import.meta.url));
const IDML = readFileSync(new URL('../fixtures/designcraft/from-indesign.idml', import.meta.url));
const CREATED = 1767225600; // the creation time of desktopPackage(), 2026-01-01
const MARKER = 'CRAFTSUITE-PROBE-dc01';
const PACKAGE_TYPE = 'application/vnd.designcraft+zip';
const IDML_TYPE = 'application/vnd.adobe.indesign-idml-package';
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/designcraft/`;
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

// Pinned: the @ui click positions depend on the layout, and DesignCraft's labels on the language.
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
// UI: drive DesignCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on DesignCraft 0.5.0, checked again on 0.6.0 and 0.9.0), relative to
// the app frame at the pinned viewport. This is the only layout knowledge in this file; when a
// release moves something, fix it here.
const AT = {
  // Menu bar, after the home button: File.
  fileMenu: (b: Box) => ({ x: b.x + 59, y: b.y + 17 }),
  // File menu: Save, the sixth row (after New Document…, Open…, Open Recent, which 0.9.0 added, a
  // separator and Close).
  fileSave: (b: Box) => ({ x: b.x + 84, y: b.y + 154 }),
  // File menu: Export IDML…, the row below Export Page as PNG….
  fileExportIdml: (b: Box) => ({ x: b.x + 84, y: b.y + 424 }),
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

// For the @ui test: File > <item>. The menu opens on the click and closes after the item ran.
async function fileMenu(page: Page, app: Frame, what: string, item: (b: Box) => { x: number; y: number }) {
  await clickApp(page, app, 'the File menu', AT.fileMenu);
  await settle(page.locator('#app'), app); // the menu
  await clickApp(page, app, `${what} in the File menu`, item);
}

// A dialog that one key opens and Enter confirms (ui-egui/src/dialogs.rs: OK or Enter).
async function keyAndConfirm(page: Page, app: Frame, what: string, key: string) {
  await test.step(`ui: ${what} (${key}, then Enter)`, async () => {
    await press(page, app, key);
    await settle(page.locator('#app'), app); // the dialog
    await page.keyboard.press('Enter'); // where the dialog put the focus
    await settle(page.locator('#app'), app);
  });
}

// Layout > Pages > Insert Pages… (Cmd+Shift+P, engine/src/cmd/layout.rs), confirmed with its
// default of one page: the edit the tests save.
const insertPage = (page: Page, app: Frame) => keyAndConfirm(page, app, 'insert a page', 'Control+Shift+P');

// File > New Document… (Cmd+N), confirmed with its defaults: a second document, 'Untitled-1'.
const newDocument = (page: Page, app: Frame) => keyAndConfirm(page, app, 'create a new document', 'Control+n');

// Loads the test host with a fixture and waits until the translator has handed it to the app.
// `bytes` serves those bytes under `name` instead of a file in fixtures/designcraft/. A name
// under blanks/ is a blank of the "+ New" entries in Files (craftsuite_layer/assets/).
async function openInHost(page: Page, name: string, query = '', bytes?: Buffer) {
  if (bytes) {
    await page.route(`${HOST}files/designcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  }
  const file = name.startsWith('blanks/') ? name : `designcraft/${name}`;
  await page.goto(`${HOST}?target=designcraft&name=${encodeURIComponent(file)}${query}`);
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
function expectExport(save: HostSave, name: string | RegExp) {
  expect(save).toMatchObject({ kind: 'export', openId: null, name: typeof name === 'string' ? name : expect.stringMatching(name) });
}

// The content of a zip's first entry if it is a stored 'mimetype', as DesignCraft writes both its
// own packages and IDML (format/src/lib.rs, idml/src/export.rs).
function zipMimetype(bytes: Buffer) {
  if (bytes.length < 30 || bytes.readUInt32LE(0) !== 0x04034b50) return null;
  const size = bytes.readUInt32LE(18);
  const nameLength = bytes.readUInt16LE(26);
  const start = 30 + nameLength + bytes.readUInt16LE(28);
  if (bytes.readUInt16LE(8) !== 0 || bytes.toString('latin1', 30, 30 + nameLength) !== 'mimetype') return null;
  return bytes.toString('latin1', start, start + size);
}

// A DesignCraft package: its pages and the text of its stories (format/src/lib.rs, doc/src/lib.rs).
function designcraftPackage(bytes: Buffer) {
  expect(zipMimetype(bytes), 'a DesignCraft package (first zip entry mimetype)').toBe(PACKAGE_TYPE);
  const doc = JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as {
    spreads: { pages: unknown[] }[];
    stories: Record<string, { text?: string }>;
    created?: number;
  };
  return {
    pages: doc.spreads.reduce((n, s) => n + s.pages.length, 0),
    text: Object.values(doc.stories).map((s) => s.text ?? '').join('\n'),
    created: doc.created,
  };
}

// PROBE as DesignCraft's desktop app writes it: document.json with a creation time, which the
// web build cannot set (0, no clock) and every save keeps (doc/src/build.rs, vars.rs now()).
function desktopPackage() {
  const files = unzipSync(PROBE);
  const doc = JSON.parse(strFromU8(files['document.json'])) as { created: number };
  doc.created = CREATED;
  // The same entries in the same order, 'mimetype' first; it and the images stored, as DesignCraft does.
  const out: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    out[name] = [name === 'document.json' ? strToU8(JSON.stringify(doc, null, 2)) : data,
      { level: name === 'mimetype' || name.startsWith('assets/') ? 0 : 6 }];
  }
  return Buffer.from(zipSync(out));
}

// The opened document, saved with `added` pages more than the fixture has.
function expectSavedDocument(bytes: Buffer, added: number) {
  const saved = designcraftPackage(bytes);
  expect(saved.text, 'the opened document\'s text').toContain(MARKER);
  expect(saved.pages, `the fixture's page and ${added} inserted`).toBe(1 + added);
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, 'craftsuite-probe.designcraft', `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'designcraft'), 'messages from another app than designcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.designcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.designcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('Ctrl+S saves the edit as the document, under the opened name, not the stored title', async () => {
    await insertPage(page, app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.designcraft');
    expectSavedDocument(bytes, 1);
  });

  await test.step('Save As (Ctrl+Shift+S) after another edit is the document again', async () => {
    await insertPage(page, app);
    await press(page, app, 'Control+Shift+S');
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, 'craftsuite-probe.designcraft');
    expectSavedDocument(bytes, 2);
  });

  await test.step('Export Page as PNG (Ctrl+E) arrives as a new file', async () => {
    await press(page, app, 'Control+e');
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, /^craftsuite-probe-p\d+\.png$/);
    expect(bytes.subarray(0, 8).toString('latin1'), 'a PNG').toBe('\x89PNG\r\n\x1a\n');
  });

  await test.step('the save of another document in the app arrives as a new file', async () => {
    await newDocument(page, app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 4);
    expectExport(save, 'Untitled-1.designcraft');
    expect(designcraftPackage(bytes).text, 'not the opened document').not.toContain(MARKER);
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

test('saved-as: a save under another name or type than the opened file is the document', async ({ context }) => {
  await scenario(context, 'an opened .idml saves as <stem>.designcraft, the document, and so does the next save', async (page, downloads) => {
    const app = await openInHost(page, 'from-indesign.idml');
    await press(page, app, 'Control+s');
    const first = await hostSave(page, 1);
    // Named after the file, not after the name stored in the IDML (craftsuite-probe.indd), and
    // a DesignCraft package: the host stores it next to the IDML, which stays as it is.
    expectDocument(first.save, 'from-indesign.designcraft');
    expect(zipMimetype(first.bytes), 'a DesignCraft package, not an IDML').toBe(PACKAGE_TYPE);
    expectSavedDocument(first.bytes, 0);

    await insertPage(page, app);
    await press(page, app, 'Control+s');
    const second = await hostSave(page, 2);
    expectDocument(second.save, 'from-indesign.designcraft');
    expectSavedDocument(second.bytes, 1);
    expectNoDownloads(downloads);
  });

  // Names DesignCraft turns into another title than the name up to the last dot would suggest
  // (ui-egui/src/lib.rs drain_inbox; engine/src/cmd/interchange.rs open_idml).
  const renamed: [opened: string, bytes: Buffer, saved: string][] = [
    ['Probe.DESIGNCRAFT', PROBE, 'Probe.designcraft'],
    ['from-indesign.idml.idml', IDML, 'from-indesign.designcraft'],
  ];
  for (const [opened, bytes, saved] of renamed) {
    await scenario(context, `'${opened}' saves as '${saved}', the document`, async (page, downloads) => {
      const app = await openInHost(page, opened, '', bytes);
      await press(page, app, 'Control+s');
      const { save, bytes: stored } = await hostSave(page, 1);
      expectDocument(save, saved);
      expectSavedDocument(stored, 0);
      expectNoDownloads(downloads);
    });
  }

  await scenario(context, 'Untitled-1.designcraft saves as the document; a new document saved under the same name is a new file', async (page, downloads) => {
    // Both are titled 'Untitled-1' and save as 'Untitled-1.designcraft'; only the creation time
    // stored in the opened file tells them apart.
    const app = await openInHost(page, 'Untitled-1.designcraft', '', desktopPackage());
    await press(page, app, 'Control+s');
    const own = await hostSave(page, 1);
    expectDocument(own.save, 'Untitled-1.designcraft');
    expectSavedDocument(own.bytes, 0);
    expect(designcraftPackage(own.bytes).created, 'the creation time, kept by Save').toBe(CREATED);

    await newDocument(page, app);
    await press(page, app, 'Control+s');
    const other = await hostSave(page, 2);
    expectExport(other.save, 'Untitled-1.designcraft');
    expect(designcraftPackage(other.bytes).text, 'the new document, not the opened one').not.toContain(MARKER);
    expectNoDownloads(downloads);
  });

  // The blank of the "+ New" entry in Files (craftsuite_layer/blanks.mjs): it saves under the
  // opened name and keeps its creation time, by which the adapter tells it from a new document.
  await scenario(context, 'the + New blank (blank.designcraft) opens, and its first save is the document', async (page, downloads) => {
    const app = await openInHost(page, 'blanks/blank.designcraft');
    await press(page, app, 'Control+s');
    expectDocument((await hostSave(page, 1)).save, 'blank.designcraft');
    expectNoDownloads(downloads);
  });
});

test('ui: File > Save and File > Export IDML… with the pointer', { tag: '@ui' }, async ({ page }) => {
  const downloads = trackDownloads(page);
  const app = await openInHost(page, 'from-indesign.idml');

  await test.step('File > Save saves the document, like Ctrl+S', async () => {
    await fileMenu(page, app, 'Save', AT.fileSave);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'from-indesign.designcraft');
    expectSavedDocument(bytes, 0);
  });

  await test.step('File > Export IDML…, under the opened name, arrives as a new file', async () => {
    // DesignCraft's own rewrite of the IDML: it must not replace the opened file.
    await fileMenu(page, app, 'Export IDML…', AT.fileExportIdml);
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'from-indesign.idml');
    expect(zipMimetype(bytes), 'an IDML package').toBe(IDML_TYPE);
    expectNoDownloads(downloads);
  });
});
