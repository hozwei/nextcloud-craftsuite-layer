// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real EffectCraft web build. See docs/apps/effectcraft.md. Four
// tests; a test with several scenarios runs each in its own page and reports every scenario that
// fails.
//
//   contract   allowed host: handshake with the served app version, the frame running with the
//              app's flags the adapter sets (a blank start, no session restored, no service
//              worker, memory storage), open of a .ecproj; an edit saved with Ctrl+S arrives as the
//              document under the opened name, a project file with the edit, and so does a second
//              one; Collect Files (a copy under the opened name, without savedBy), Save Frame As
//              (Frame.png), a project file under the opened name written while the project has
//              unsaved changes or saved to another folder (all three through window.effectcraft
//              but Collect Files, which runs from the command palette), Save As
//              (Ctrl+Shift+S) and the Save after it, and the save of a new project (Ctrl+Alt+N)
//              arrive as new files; nothing becomes a download, also not after the deadlines for
//              the host's confirmation and result
//   saved-as   an opened 'Untitled Project.ecproj' saves as a new file (every new project saves
//              under that name); the blank of the Nextcloud app's + New entry (EffectCraft's New
//              Project, savedBy 0.8.0) opens, and its first save, without an edit, is the
//              document; a project a newer EffectCraft wrote (savedBy not its first member)
//              saves as a copy: a new file, which the next save, after an edit, replaces; so does
//              its XML form under a .ecproj name (the first save), written as only the app's own
//              lenient reader takes it; the XML form of this version saves as the document, as
//              JSON; a different project with the opened name brought in by the user, through
//              File > Open Project (Ctrl+O) and in Chromium a drop from the desktop, saves as a
//              new file; when the flags do not take effect (the adapter's replaceState blocked),
//              the host gets a startup error and nothing is opened
//   language   the host names Spanish (lang=es in the frame's fragment): ready reports es,
//              EffectCraft's preference general.language is es (set by the adapter through
//              window.effectcraft), File > Save reads 'Guardar', and the project opens as without
//              a language; a language EffectCraft lacks (lang=de): no startup error, ready reports
//              none, and the app stays in its own (general.language 'system', English)
//   ui (@ui)  the File menu with the pointer: Save saves the document; Save As > Save a Copy…
//              arrives as a new file
//
// A daily canary runs this file against every new EffectCraft release, so the steps that drive
// the app (section "UI") are kept apart from the checks of what the host and the browser see
// (section "Contract"). The steps use EffectCraft's shortcuts and its command palette (Quick
// Apply…, Ctrl+Shift+Space), with the labels and shortcuts of crates/engine/src/commands and
// crates/engine/src/menus.rs. The palette matches the labels in the app's language, so only the
// language test has the host name a language. Only the test tagged @ui also clicks with the
// pointer: a moved menu item fails it without the translator being at fault.
//
// The fixtures in fixtures/effectcraft/ were made with EffectCraft 0.8.0 (see the docs page):
// craftsuite-probe.ecproj holds 'Comp 1' with a solid, craftsuite-probe.ecprojx is its XML copy
// (Save a Copy As XML). The other files the tests open are derived from them below.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { appFrames, press, runCommand, settle } from '../lib/craft-ui.ts';

const PROBE = readFileSync(new URL('../fixtures/effectcraft/craftsuite-probe.ecproj', import.meta.url));
const PROBE_XML = readFileSync(new URL('../fixtures/effectcraft/craftsuite-probe.ecprojx', import.meta.url));
const PROBE_NAME = 'craftsuite-probe.ecproj';
const UNTITLED = 'Untitled Project.ecproj'; // every new project, Save As and Save a Copy
const NEWER = '99.0.0'; // savedBy of a project from an EffectCraft newer than any tested one
const PALETTE = 'Control+Shift+Space'; // Edit > Quick Apply… (crates/engine/src/commands/frontend.rs)
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/effectcraft/`;
// Translator timeouts (host knobs app-ack, app-result) where a test waits for them, in ms. The
// result timeout also limits classifying a save, which waits for the app's next frame
// (project.summary), so it leaves room for a slow frame on a busy machine.
const SHORT_ACK = 3000;
const SHORT_RESULT = 5000;
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
// What the app's page reports about itself (window.effectcraft in its index.html).
type AppWindow = Window & {
  effectcraft: {
    info(): { version: string; restored: boolean; storage: { backend: string } };
    execute(command: string, params?: Record<string, unknown>): Promise<unknown>;
    request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  };
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

// Pinned: the @ui click positions depend on the layout and on the language of EffectCraft's labels.
// EffectCraft 0.8.0 ignores the browser's language (it starts in English unless the host names one,
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

// A scenario that needs a trusted drop (dropFromDesktop) runs in Chromium only; elsewhere the
// test notes that it did not run.
async function chromiumOnly(browserName: string, run: () => Promise<void>) {
  if (browserName === 'chromium') return run();
  test.info().annotations.push({ type: 'skipped scenario', description: 'a drop from the desktop needs Chromium (DevTools protocol)' });
}

// ---------------------------------------------------------------------------------------------
// UI: drive EffectCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };
type Point = (b: Box) => { x: number; y: number };

// Pointer targets (measured on EffectCraft 0.8.0), relative to the app frame at the pinned
// viewport. This is the only layout knowledge in this file; when a release moves something, fix
// it here. The File menu's rows are 26 px apart (crates/engine/src/menus.rs gives their order).
const AT = {
  // Menu bar: File, the first entry.
  fileMenu: (b: Box) => ({ x: b.x + 17, y: b.y + 12 }),
  // File menu: Save, the sixth row (after New, Open Project…, Open Recent, a separator, Close and
  // Close Project).
  fileSave: (b: Box) => ({ x: b.x + 46, y: b.y + 180 }),
  // File menu: Save As, the row below Save; its submenu opens on hover, to the right of the menu.
  fileSaveAs: (b: Box) => ({ x: b.x + 54, y: b.y + 206 }),
  // Save As submenu: its first row (Save As…), reached along the Save As row, then Save a Copy…
  // below it.
  saveAsFirst: (b: Box) => ({ x: b.x + 356, y: b.y + 206 }),
  saveAsCopy: (b: Box) => ({ x: b.x + 356, y: b.y + 232 }),
};

function appFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url().startsWith(APP));
  if (!frame) throw new Error(`no frame shows ${APP}`);
  return frame;
}

// For the @ui test: the pointer along `points` (a hover frame at each point, so egui sees it, and
// opens a submenu), then a click at the last point.
async function pointTo(page: Page, app: Frame, what: string, points: Point[]) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');

  await test.step(`ui: click ${what}`, async () => {
    for (const at of points) {
      const { x, y } = at(box);
      await page.mouse.move(x, y, { steps: 4 });
      await appFrames(app, 3);
    }
    const { x, y } = points[points.length - 1](box);
    await page.mouse.click(x, y);
  });
}

// For the @ui test: File > ... The menu opens on the click and closes after the item ran.
async function fileMenu(page: Page, app: Frame, what: string, points: Point[]) {
  await pointTo(page, app, 'the File menu', [AT.fileMenu]);
  await settle(page.locator('#app'), app); // the menu
  await pointTo(page, app, `${what} in the File menu`, points);
}

// Composition > New Composition… (Ctrl+N), confirmed with its defaults (Enter): one more comp in
// the project, the edit the tests save.
async function newComp(page: Page, app: Frame) {
  await test.step('ui: a new composition (Ctrl+N, then Enter)', async () => {
    await press(page, app, 'Control+n');
    await settle(page.locator('#app'), app); // the dialog
    await page.keyboard.press('Enter');
    await settle(page.locator('#app'), app);
  });
}

// An engine command with a path of the test's choosing, which no menu of the web build gives it,
// run through the app's own API (window.effectcraft), as a script on the app's page could.
async function runThroughApi(app: Frame, command: string, params: Record<string, unknown>) {
  await test.step(`ui: ${command} ${JSON.stringify(params)} through window.effectcraft`, async () => {
    await app.evaluate(({ command, params }) => (window as unknown as AppWindow).effectcraft.execute(command, params), { command, params });
  });
}

// File > Open Project… (Ctrl+O) with a file from the user's disk, through the browser's file
// picker (the app's own <input type=file>).
async function openFromDisk(page: Page, app: Frame, name: string, bytes: Buffer) {
  await test.step(`ui: File > Open Project (Ctrl+O) of another ${name} from the disk`, async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await press(page, app, 'Control+o');
    await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
    await settle(page.locator('#app'), app); // the project replaced
  });
}

// A user's drag and drop of a file from the desktop onto the middle of the app. Only Chromium
// can send such a trusted drop (DevTools protocol), see chromiumOnly().
async function dropFromDesktop(page: Page, app: Frame, file: string) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await test.step(`ui: drop another ${path.basename(file)} from the desktop`, async () => {
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, ...at, data });
    await cdp.detach();
    await settle(page.locator('#app'), app); // the project replaced
  });
}

// Loads the test host with a fixture and waits until the translator has handed it to the app.
// `bytes` serves those bytes under `name` instead of a file in fixtures/effectcraft/. A name with a
// folder (blanks/<name>: the Nextcloud app's blank documents) opens that file of the test server,
// which the host sends under its base name.
async function openInHost(page: Page, name: string, query = '', bytes?: Buffer) {
  if (bytes) {
    await page.route(`${HOST}files/effectcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  }
  await page.goto(`${HOST}?target=effectcraft&name=${encodeURIComponent(name.includes('/') ? name : `effectcraft/${name}`)}${query}`);
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

// The opened document: the host may replace its file with these bytes.
function expectDocument(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'document', openId: 1, follows: null, name });
}

// Anything else (exports, other projects): the host stores it as a new file.
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, follows: null, name });
}

// A copy of the opened file (docs/protocol.md#copies). The first follows its own id, which names
// no file the host has, so the host stores it as a new file; a later one follows the first and
// replaces that file.
function expectCopyFollowing(save: HostSave, name: string, follows: number) {
  expect(save).toMatchObject({ kind: 'document', openId: 1, follows, name });
}

// A project file: who wrote it (savedBy, missing in Collect Files' copy), whether it starts the
// way Save writes it, and the names of its compositions (crates/project/src/lib.rs).
function project(bytes: Buffer) {
  const text = bytes.toString('utf8');
  const doc = JSON.parse(text) as { savedBy?: string; items: Record<string, { name: string; kind?: { type?: string } }> };
  return {
    savedBy: doc.savedBy,
    savedHead: /^\{\n {2}"savedBy": "[^"]+",\n {2}"schema": \d+,\n/.test(text),
    comps: Object.values(doc.items).filter((i) => i.kind?.type === 'Comp').map((i) => i.name),
  };
}

// The opened project as Save writes it, with `added` compositions more than the fixture's
// 'Comp 1'.
function expectSavedProject(bytes: Buffer, added: number) {
  const saved = project(bytes);
  expect(saved.savedHead, 'a project file as Save writes it: savedBy, then schema').toBe(true);
  expect(saved.comps, 'the opened project\'s composition').toContain('Comp 1');
  expect(saved.comps, `the fixture's composition and ${added} new`).toHaveLength(1 + added);
  return saved;
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// The probe as a newer EffectCraft would write it, with savedBy after schema: only a reader of
// the whole file finds it (the app warns that saving it loses what this version does not know).
function newerProject() {
  const text = PROBE.toString('utf8');
  const out = text.replace(/^\{\n {2}"savedBy": "[^"]+",\n {2}"schema": (\d+),\n/, `{\n  "schema": $1,\n  "savedBy": "${NEWER}",\n`);
  if (out === text) throw new Error('the fixture does not start with savedBy and schema');
  return Buffer.from(out);
}

// The XML copy as a newer EffectCraft might write it, in a way the app's own lenient reader
// (engine/src/xml_project.rs) still takes: another attribute before n="savedBy", a comment
// before the value, and an entity in it. The app reads savedBy 99.0.0 and warns.
function newerXml() {
  const text = PROBE_XML.toString('utf8');
  const out = text.replace(/<m n="savedBy">(\s*)<str>[^<]*<\/str>/, `<m t="s" n="savedBy">$1<!-- newer --><str>${NEWER.replace('.', '&#46;')}</str>`);
  if (out === text) throw new Error('the XML fixture has no savedBy');
  return Buffer.from(out);
}

// Another project under the probe's name, from the user's disk: its composition is named
// 'Elsewhere 1'.
function otherProject() {
  const text = PROBE.toString('utf8');
  const out = text.replace('"name": "Comp 1"', '"name": "Elsewhere 1"');
  if (out === text) throw new Error('the fixture has no Comp 1');
  return Buffer.from(out);
}

// The version the test server serves (config.js), which writes savedBy.
const servedVersion = (page: Page) => page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.effectcraft);

// The language of each ready message the host received (null: the app picks its own).
async function readyLanguages(page: Page) {
  return (await hostRecord(page)).readies.map((r) => r.language);
}

// EffectCraft's interface language as the app reports it: the preference general.language
// (crates/engine/src/prefs.rs) and the label of File > Save in its menus (ui.menu.list), which
// crates/ui-egui/src/i18n.rs translates.
function appLanguage(app: Frame) {
  return app.evaluate(async () => {
    const effectcraft = (window as unknown as AppWindow).effectcraft;
    const menus = (await effectcraft.request('ui.menu.list')) as { id: string; label: string }[];
    return {
      language: await effectcraft.execute('prefs.get', { key: 'general.language' }),
      save: menus.find((m) => m.id === 'file.save')?.label,
    };
  });
}

// The project EffectCraft has open (project.summary): its path and the names of its compositions.
function openProject(app: Frame) {
  return app.evaluate(async () => {
    const summary = (await (window as unknown as AppWindow).effectcraft.execute('project.summary')) as
      { path: string | null; items: { name: string; type: string }[] };
    return { path: summary.path, comps: summary.items.filter((i) => i.type === 'Composition').map((i) => i.name) };
  });
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, PROBE_NAME, `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'effectcraft'), 'messages from another app than effectcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await servedVersion(page);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.effectcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('the frame runs with the app\'s flags: a blank start, no service worker, memory storage', async () => {
    // Set by the adapter (the configured app address has no query). If upstream renames them, the
    // app restores the last session and registers its service worker again.
    const state = await app.evaluate(async () => {
      const info = (window as unknown as AppWindow).effectcraft.info();
      const query = new URLSearchParams(location.search);
      return {
        flags: { empty: query.get('empty'), nosw: query.get('nosw'), storage: query.get('storage') },
        restored: info.restored,
        storage: info.storage.backend,
        workers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
      };
    });
    expect.soft(state.flags, 'the flags in the frame\'s URL').toEqual({ empty: '', nosw: '', storage: 'memory' });
    expect.soft(state.restored, 'a session restored from browser storage').toBe(false);
    expect.soft(state.storage, 'the app\'s storage').toBe('memory');
    expect.soft(state.workers, 'service workers registered').toBe(0);
  });

  await test.step('an edit saved with Ctrl+S arrives as the document, a project file with the edit', async () => {
    await newComp(page, app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, PROBE_NAME);
    expect(expectSavedProject(bytes, 1).savedBy, 'savedBy: the served version').toBe(await servedVersion(page));
  });

  await test.step('a second edit saved with Ctrl+S is the document again', async () => {
    await newComp(page, app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, PROBE_NAME);
    expectSavedProject(bytes, 2);
  });

  await test.step('Collect Files, a copy under the opened name without savedBy, arrives as a new file', async () => {
    // File > Dependencies > Collect Files… downloads '<stem>.ecproj' with the footage paths
    // rewritten. Only the missing savedBy tells it from a Save.
    await runCommand(page, app, 'Collect Files...', PALETTE);
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, PROBE_NAME);
    const copy = project(bytes);
    expect(copy.savedBy, 'savedBy in Collect Files\' copy').toBeUndefined();
    expect(copy.comps, 'the opened project').toHaveLength(3);
  });

  await test.step('Save Frame As arrives as a new file', async () => {
    // Composition > Save Frame As > File… (Ctrl+Alt+S) asks for a path, which the web build makes a
    // download of Frame.png: here the command with that path, through window.effectcraft. Pressed
    // right after the command palette of the step before, the shortcut opened the palette again on
    // GitHub's runner, in a run and its retry, and the frame was never saved.
    await runThroughApi(app, 'comp.saveFrameAs', { path: '/Frame.png' });
    const { save, bytes } = await hostSave(page, 4);
    expectExport(save, 'Frame.png');
    expect(bytes.subarray(0, 8).toString('latin1'), 'a PNG').toBe('\x89PNG\r\n\x1a\n');
  });

  await test.step('project files under the opened name that are not a Save of it arrive as new files', async () => {
    // Only the app's state right after the download (project.summary) tells these from a Save:
    // a copy written while the project has unsaved changes, and a save to another folder.
    await newComp(page, app);
    await runThroughApi(app, 'file.saveCopy', { path: `/Copies/${PROBE_NAME}` });
    const dirty = await hostSave(page, 5);
    expectExport(dirty.save, PROBE_NAME);
    expectSavedProject(dirty.bytes, 3);
    await runThroughApi(app, 'file.save', { path: `/Elsewhere/${PROBE_NAME}` });
    const elsewhere = await hostSave(page, 6);
    expectExport(elsewhere.save, PROBE_NAME);
    expectSavedProject(elsewhere.bytes, 3);
  });

  await test.step('Save As (Ctrl+Shift+S) and the Save after it arrive as new files, Untitled Project.ecproj', async () => {
    await press(page, app, 'Control+Shift+S');
    const first = await hostSave(page, 7);
    expectExport(first.save, UNTITLED);
    expectSavedProject(first.bytes, 3);
    await press(page, app, 'Control+s'); // the project's path is now /Untitled Project.ecproj
    const second = await hostSave(page, 8);
    expectExport(second.save, UNTITLED);
    expectSavedProject(second.bytes, 3);
  });

  await test.step('the save of a new project (Ctrl+Alt+N) arrives as a new file', async () => {
    await press(page, app, 'Control+Alt+n');
    await settle(page.locator('#app'), app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 9);
    expectExport(save, UNTITLED);
    expect(project(bytes).comps, 'a new, empty project').toEqual([]);
  });

  await test.step('nothing becomes a download, also not after both deadlines', async () => {
    // Every save was stored, so nothing may fall back to a download, also not once the deadlines
    // for the confirmation and for the result have passed for the last save. Short deadlines,
    // real time: eframe cannot run under a fake clock.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- nothing may happen in this time
    await page.waitForTimeout(Math.max(SHORT_ACK, SHORT_RESULT) + 1000);
    expect.soft((await hostRecord(page)).errors, 'errors the host got').toEqual([]);
    expect.soft((await hostRecord(page)).saves, 'saves the host got').toHaveLength(9);
    expectNoDownloads(downloads);
  });
});

test('saved-as: new-project names, copies of other versions, files the user brings in', async ({ context, browserName }) => {
  test.slow(); // eight scenarios, each loading the 60 MB app

  // Every new project saves as 'Untitled Project.ecproj' without asking, and the format has no
  // document identity: the opened file's save cannot be told from a new project's.
  await scenario(context, `an opened ${UNTITLED} is never saved back`, async (page, downloads) => {
    const app = await openInHost(page, UNTITLED, '', PROBE);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, UNTITLED);
    expectSavedProject(bytes, 0);
    expectNoDownloads(downloads);
  });

  // The blank of the Nextcloud app's + New entry as it is in craftsuite_layer/assets: EffectCraft's
  // New Project with savedBy 0.8.0, which the host opens as 'blank.ecproj'.
  await scenario(context, 'the + New blank opens and its first save replaces it', async (page, downloads) => {
    const app = await openInHost(page, 'blanks/blank.ecproj');
    await expect.poll(() => openProject(app), { message: 'the project EffectCraft has open' }).toEqual({ path: '/blank.ecproj', comps: [] });
    await press(page, app, 'Control+s'); // EffectCraft saves without an edit
    expectDocument((await hostSave(page, 1)).save, 'blank.ecproj');
    expectNoDownloads(downloads);
  });

  // A project from another version or in the XML form, opened under a .ecproj name. A newer
  // version's file loses what this version does not know when saved: its saves are a copy, a new
  // file that the later saves replace (an edit, then the second save). The XML form of this
  // version is saved back losslessly, as JSON (engine/src/commands/file.rs file_text picks the
  // format by the name).
  const others: [title: string, bytes: Buffer, saves: 'copy, then its update' | 'copy' | 'document'][] = [
    ['a project a newer EffectCraft wrote, savedBy not its first member, saves as a copy', newerProject(), 'copy, then its update'],
    ['the XML form of a newer EffectCraft\'s project, as the app\'s reader takes it, saves as a copy', newerXml(), 'copy'],
    ['the XML form of this version saves as the document, as JSON', PROBE_XML, 'document'],
  ];
  for (const [title, bytes, saves] of others) {
    await scenario(context, title, async (page, downloads) => {
      const app = await openInHost(page, PROBE_NAME, '', bytes);
      await press(page, app, 'Control+s');
      const first = await hostSave(page, 1);
      if (saves === 'document') expectDocument(first.save, PROBE_NAME);
      else expectCopyFollowing(first.save, PROBE_NAME, first.save.id); // the first copy: a new file next to the opened one
      expect(expectSavedProject(first.bytes, 0).savedBy, 'written by this version').toBe(await servedVersion(page));
      if (saves === 'copy, then its update') {
        await newComp(page, app);
        await press(page, app, 'Control+s');
        const second = await hostSave(page, 2);
        expectCopyFollowing(second.save, PROBE_NAME, first.save.id);
        expectSavedProject(second.bytes, 1);
      }
      expectNoDownloads(downloads);
    });
  }

  // A file the user brings in with the opened name replaces the opened project under the same
  // path, and Save writes it under the opened name.
  await scenario(context, `a different ${PROBE_NAME} opened with File > Open Project is never the document`, async (page, downloads) => {
    const app = await openInHost(page, PROBE_NAME);
    await press(page, app, 'Control+s');
    expectDocument((await hostSave(page, 1)).save, PROBE_NAME); // before the other file arrived
    await openFromDisk(page, app, PROBE_NAME, otherProject());
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, PROBE_NAME);
    expect(project(bytes).comps, 'the project from the disk').toEqual(['Elsewhere 1']);
    expectNoDownloads(downloads);
  });

  await chromiumOnly(browserName, () => scenario(context, `a different ${PROBE_NAME} dropped from the desktop is never the document`, async (page, downloads) => {
    const file = test.info().outputPath('elsewhere', PROBE_NAME);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, otherProject());
    const app = await openInHost(page, PROBE_NAME);
    await press(page, app, 'Control+s');
    expectDocument((await hostSave(page, 1)).save, PROBE_NAME); // before the other file arrived
    await dropFromDesktop(page, app, file);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, PROBE_NAME);
    expect(project(bytes).comps, 'the dropped project').toEqual(['Elsewhere 1']);
    expectNoDownloads(downloads);
  }));

  // Last: without its flags, EffectCraft registers its service worker and writes to the
  // browser's storage of this context.
  await scenario(context, 'when the flags do not take effect, the host gets a startup error and the file is never handed over', async (page, downloads) => {
    await page.addInitScript((appOrigin) => {
      if (location.origin !== appOrigin) return;
      History.prototype.replaceState = () => { throw new Error('blocked by the test'); };
    }, APP_ORIGIN);
    await page.goto(`${HOST}?target=effectcraft&name=${encodeURIComponent(`effectcraft/${PROBE_NAME}`)}`);
    await untilHost(page, 'the host got an error', (h) => h.errors.length > 0, 90_000);
    const host = await hostRecord(page);
    expect(host.errors).toEqual([
      { of: 'startup', id: null, message: expect.stringMatching(/^the app would keep the opened project in browser storage \(storage: (opfs|indexeddb)\)$/) as unknown as string },
    ]);
    expect(await messageTypes(page), 'no ready, so no open and no delivered').toEqual(['hello', 'error']);
    expect(host.saves, 'saves').toEqual([]);
    expectNoDownloads(downloads);
  });
});

test('language: the host\'s language (es) reaches EffectCraft\'s preferences, one it lacks (de) changes nothing', { tag: '@language' }, async ({ context }) => {
  // The host frames the app with '#craftsuite-layer:lang=<tag>'. The web build reads no language as
  // it starts (always English); the adapter's started() sets the preference general.language
  // through window.effectcraft, before ready.
  await scenario(context, 'es: ready reports es, EffectCraft shows its Spanish menus, the project opens', async (page) => {
    const app = await openInHost(page, PROBE_NAME, '&lang=es');
    expect(await readyLanguages(page), 'language of each ready the host got').toEqual(['es']);
    await expect.poll(() => appLanguage(app), { message: 'EffectCraft\'s general.language and the label of File > Save' })
      .toEqual({ language: 'es', save: 'Guardar' });
    await expect.poll(() => openProject(app), { message: 'the project EffectCraft has open' })
      .toEqual({ path: `/${PROBE_NAME}`, comps: ['Comp 1'] });
  });

  // EffectCraft 0.8.0 has no German: the adapter sends nothing, and the app starts as without a
  // language (openInHost checks that the host got no error).
  await scenario(context, 'de, which EffectCraft lacks: no startup error, ready reports none, EffectCraft stays in English', async (page) => {
    const app = await openInHost(page, PROBE_NAME, '&lang=de');
    expect(await readyLanguages(page), 'language of each ready the host got').toEqual([null]);
    expect(await appLanguage(app), 'EffectCraft\'s general.language and the label of File > Save').toEqual({ language: 'system', save: 'Save' });
  });
});

test('ui: File > Save and File > Save As > Save a Copy… with the pointer', { tag: '@ui' }, async ({ page }) => {
  const downloads = trackDownloads(page);
  const app = await openInHost(page, PROBE_NAME);

  await test.step('File > Save saves the document, like Ctrl+S', async () => {
    await fileMenu(page, app, 'Save', [AT.fileSave]);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, PROBE_NAME);
    expectSavedProject(bytes, 0);
  });

  await test.step('File > Save As > Save a Copy… arrives as a new file', async () => {
    await fileMenu(page, app, 'Save As > Save a Copy…', [AT.fileSaveAs, AT.saveAsFirst, AT.saveAsCopy]);
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, UNTITLED);
    expect(expectSavedProject(bytes, 0).comps, 'a copy of the opened project').toEqual(['Comp 1']);
    expectNoDownloads(downloads);
  });
});
