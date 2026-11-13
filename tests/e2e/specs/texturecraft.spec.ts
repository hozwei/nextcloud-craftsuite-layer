// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real TextureCraft web build. See docs/apps/texturecraft.md. Four
// tests; a test with several scenarios runs each in its own page and reports every scenario that
// fails.
//
//   contract   allowed host: handshake with the served app version, open of craftsuite-probe.tcraft
//              (its project has the file's name); an edit saved with Ctrl+S arrives as the
//              document under the opened name, a TextureCraft project with the edit, and Save as
//              (Ctrl+Shift+S) after another edit is the document again; the save of the new
//              project File > Close leaves ('Untitled') arrives as a new file; nothing becomes a
//              download, also not after the deadlines for the host's confirmation and result
//   saved-as   names: a file whose project has another name saves under that name, made
//              file-safe, as the document, and so does the next save; Untitled.tcraft cannot be
//              told from a new project and saves as a new file; a project from the user's disk
//              (File > Open) that saves under the opened name is a new file; the blank of the
//              "+ New" entry in Files opens, and its first save is the document
//   language   (@language) the host's de reaches TextureCraft as the browser's language and is
//              what it stores; at the next start the host's fr replaces it; a language the user
//              picked in TextureCraft stays
//   ui (@ui)   the menu bar with the pointer: File > Save saves the document; File > Export
//              Mesh... > Wavefront OBJ arrives as a new file
//
// A daily canary runs this file against every new TextureCraft release, so the steps that drive
// the app (section "UI") are kept apart from the checks of what the host and the browser see
// (section "Contract"). The steps use TextureCraft's keyboard shortcuts (crates/ui-egui/src/
// menus.rs, crates/engine/src/layer_ops.rs); only the test tagged @ui clicks with the pointer: a
// moved menu item fails it without the translator being at fault.
//
// fixtures/texturecraft/craftsuite-probe.tcraft is written by its make-fixtures.mjs: a project
// named 'craftsuite-probe' whose first texture set has one paint layer named MARKER.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { appFrames, press, settle } from '../lib/craft-ui.ts';

const PROBE = readFileSync(new URL('../fixtures/texturecraft/craftsuite-probe.tcraft', import.meta.url));
const MARKER = 'CRAFTSUITE-PROBE-tx01';
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/texturecraft/`;
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

// Pinned: the @ui click positions depend on the layout, and TextureCraft's labels on the language.
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
// UI: drive TextureCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on TextureCraft 0.5.0), relative to the app frame at the pinned
// viewport. This is the only layout knowledge in this file; when a release moves something, fix
// it here.
const AT = {
  // The menu bar: File, after the app's mark.
  file: (b: Box) => ({ x: b.x + 44, y: b.y + 13 }),
  // File menu: Save, after New project..., Open..., Open sample project..., Close and a separator.
  fileSave: (b: Box) => ({ x: b.x + 60, y: b.y + 166 }),
  // File menu: Export Mesh..., the last row before the separator above Quit.
  fileExportMesh: (b: Box) => ({ x: b.x + 82, y: b.y + 400 }),
  // The Export mesh window: Wavefront OBJ (.obj), the third of its buttons.
  exportObj: (b: Box) => ({ x: b.x + 652, y: b.y + 419 }),
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

// A TextureCraft shortcut such as 'S' or 'Shift+S' with its command key: egui reads the platform
// from the user agent, and under a Mac one (WebKit's) the command key is Cmd, the Meta key.
async function shortcut(page: Page, app: Frame, key: string) {
  const command = (await app.evaluate(() => navigator.userAgent.includes('Mac'))) ? 'Meta' : 'Control';
  await press(page, app, `${command}+${key}`);
}

// After a step that replaces the project: wait until the picture is no longer `before`, then
// until it settles. On a slow machine the app can take the next key before it shows the project.
// On CI runners (software rendering) one screenshot of the app can take over 30 s, hence 90 s.
async function untilChanged(page: Page, app: Frame, before: Buffer, what: string) {
  const view = page.locator('#app');
  await expect.poll(async () => !(await view.screenshot({ caret: 'initial', scale: 'css' })).equals(before),
    { message: what, timeout: 90_000 }).toBe(true);
  await settle(view, app);
}

// Layers > Instantiate across texture sets (Ctrl+Shift+D): the edit the tests save. The selected
// layer, MARKER in the first texture set, gets one more linked instance in the second each time.
async function instantiateMarker(page: Page, app: Frame) {
  await test.step('ui: instantiate the layer across texture sets (Ctrl+Shift+D)', async () => {
    await shortcut(page, app, 'Shift+D');
    await settle(page.locator('#app'), app);
  });
}

// File > Close (Ctrl+F4): the project is closed and a new one, 'Untitled', takes its place.
async function closeProject(page: Page, app: Frame) {
  await test.step('ui: File > Close (Ctrl+F4)', async () => {
    const before = await page.locator('#app').screenshot({ caret: 'initial', scale: 'css' });
    await shortcut(page, app, 'F4');
    await untilChanged(page, app, before, 'the new project shows');
  });
}

// File > Open... (Ctrl+O) with a file from the user's disk, through the browser's file picker: it
// replaces the project.
async function openFromDisk(page: Page, app: Frame, file: { name: string; buffer: Buffer }) {
  await test.step(`ui: File > Open... (Ctrl+O) of ${file.name} from the disk`, async () => {
    const before = await page.locator('#app').screenshot({ caret: 'initial', scale: 'css' });
    const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
    await shortcut(page, app, 'o');
    await (await chooser).setFiles({ ...file, mimeType: 'application/octet-stream' });
    await untilChanged(page, app, before, 'the opened project shows');
  });
}

// Loads the test host with a fixture and waits until the translator has handed it to the app.
// `bytes` serves those bytes under `name` instead of a file in fixtures/texturecraft/. A name
// under blanks/ is a blank of the "+ New" entries in Files (craftsuite_layer/assets/).
async function openInHost(page: Page, name: string, query = '', bytes?: Buffer) {
  if (bytes) {
    await page.route(`${HOST}files/texturecraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  }
  const file = name.startsWith('blanks/') ? name : `texturecraft/${name}`;
  await page.goto(`${HOST}?target=texturecraft&name=${encodeURIComponent(file)}${query}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 120_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  await untilLayersShow(page, app);
  return app;
}

// TextureCraft reads a dropped file on a later frame and replaces the sample project with it: the
// Layers panel then lists the fixture's layer instead of the sample's six. A key before that
// reaches the sample. So wait until the right panel changes; if it does not within 15 s, the
// project was there already (or a release moved the panel): carry on.
async function untilLayersShow(page: Page, app: Frame) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const panel = () => page.screenshot({ clip: { x: box.x + box.width - 300, y: box.y + 60, width: 250, height: 400 }, caret: 'initial', scale: 'css' });
  const first = await panel();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!(await panel()).equals(first)) break;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
  }
  await settle(page.locator('#app'), app);
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

// Anything else (exports, other projects): the host stores it as a new file.
function expectExport(save: HostSave, name: string | RegExp) {
  expect(save).toMatchObject({ kind: 'export', openId: null, name: typeof name === 'string' ? name : expect.stringMatching(name) });
}

interface Project { name: string; layers: Record<string, { name: string }> }

// A TextureCraft project: its project.json (crates/formats/src/project_file/mod.rs).
function textureProject(bytes: Buffer) {
  const files = unzipSync(bytes);
  expect(Object.keys(files), 'a TextureCraft project: a zip with project.json').toContain('project.json');
  const project = JSON.parse(strFromU8(files['project.json'])) as Project;
  return { name: project.name, markers: Object.values(project.layers).filter((l) => l.name === MARKER).length };
}

// The opened project, saved with `instances` more instances of its MARKER layer.
function expectSavedProject(bytes: Buffer, instances: number) {
  expect(textureProject(bytes).markers, `the fixture's layer and ${instances} instances`).toBe(1 + instances);
}

// PROBE with its project renamed (`name`), and with its layer renamed too when `layer` is given:
// the same zip as make-fixtures.mjs writes.
function probeNamed(name: string, layer = MARKER) {
  const project = JSON.parse(strFromU8(unzipSync(PROBE)['project.json'])) as Project;
  project.name = name;
  project.layers['1'].name = layer;
  return Buffer.from(zipSync({ 'project.json': [strToU8(JSON.stringify(project)), { level: 6 }] }));
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// The interface language TextureCraft stored in the frame's origin (its settings in localStorage
// 'ui.json'), once it has stored one that is not `not`. It writes them on its own schedule.
async function storedLanguage(app: Frame, not: string | null = null) {
  let language: string | null = null;
  await expect.poll(async () => (language = await app.evaluate(() => {
    try {
      const ui = JSON.parse(localStorage.getItem('ui.json') || 'null') as { prefs?: { language?: unknown } } | null;
      return typeof ui?.prefs?.language === 'string' ? ui.prefs.language : null;
    } catch {
      return null;
    }
  })) !== null && language !== not, { message: 'TextureCraft stored its settings', timeout: 60_000 }).toBe(true);
  return language;
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  // TextureCraft draws slowly on a CI runner's software renderer: a test takes over 2 minutes there.
  test.slow();

  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, 'craftsuite-probe.tcraft', `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'texturecraft'), 'messages from another app than texturecraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.texturecraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.texturecraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('Ctrl+S saves the edit as the document, under the opened name', async () => {
    await instantiateMarker(page, app);
    await shortcut(page, app, 's');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.tcraft');
    expectSavedProject(bytes, 1);
  });

  await test.step('Save as (Ctrl+Shift+S) after another edit is the document again', async () => {
    await instantiateMarker(page, app);
    await shortcut(page, app, 'Shift+S');
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, 'craftsuite-probe.tcraft');
    expectSavedProject(bytes, 2);
  });

  await test.step('the save of the new project File > Close leaves, Untitled.tcraft, arrives as a new file', async () => {
    await closeProject(page, app);
    await shortcut(page, app, 's');
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'Untitled.tcraft');
    expect(textureProject(bytes).markers, 'not the opened project').toBe(0);
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

test('saved-as: saves go under the project\'s name; one TextureCraft cannot tell apart is a new file', async ({ context }) => {
  // Four pages, each starting TextureCraft, which bakes its sample project first.
  test.slow();
  await scenario(context, 'a file whose project has another name saves under that name, file-safe, the document, and so does the next save', async (page, downloads) => {
    // The host keeps renamed.tcraft and stores the saves next to it.
    const app = await openInHost(page, 'renamed.tcraft', '', probeNamed('Probe crate'));
    await shortcut(page, app, 's');
    const first = await hostSave(page, 1);
    expectDocument(first.save, 'Probe_crate.tcraft');
    expectSavedProject(first.bytes, 0);

    await instantiateMarker(page, app);
    await shortcut(page, app, 's');
    const second = await hostSave(page, 2);
    expectDocument(second.save, 'Probe_crate.tcraft');
    expectSavedProject(second.bytes, 1);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'Untitled.tcraft saves as a new file: a new project saves under the same name', async (page, downloads) => {
    const app = await openInHost(page, 'Untitled.tcraft', '', probeNamed('Untitled'));
    await shortcut(page, app, 's');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'Untitled.tcraft');
    expectSavedProject(bytes, 0);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'a project from the disk (File > Open) that saves under the opened name is a new file', async (page, downloads) => {
    const app = await openInHost(page, 'craftsuite-probe.tcraft');
    await openFromDisk(page, app, { name: 'from-disk.tcraft', buffer: probeNamed('craftsuite-probe', 'FROM-DISK') });
    await shortcut(page, app, 's');
    const other = await hostSave(page, 1);
    expectExport(other.save, 'craftsuite-probe.tcraft');
    expect(textureProject(other.bytes).markers, 'the project from the disk, not the opened one').toBe(0);
    expectNoDownloads(downloads);
  });

  // The blank of the "+ New" entry in Files (craftsuite_layer/blanks.mjs), as the server stamps it
  // for a new file named blank.tcraft: its project named 'blank' (NewFiles::stamped()).
  await scenario(context, 'the + New blank (blank.tcraft) opens, and its first save is the document', async (page, downloads) => {
    const blank = unzipSync(readFileSync(new URL('../../../craftsuite_layer/assets/blank.tcraft', import.meta.url)));
    const json = strFromU8(blank['project.json']);
    expect(json, 'the stand-in NewFiles::stamped() replaces').toContain('"name":"New TextureCraft project"');
    const stamped = Buffer.from(zipSync({ 'project.json': strToU8(json.replace('"name":"New TextureCraft project"', '"name":"blank"')) }));
    const app = await openInHost(page, 'blank.tcraft', '', stamped);
    await shortcut(page, app, 's');
    expectDocument((await hostSave(page, 1)).save, 'blank.tcraft');
    expectNoDownloads(downloads);
  });
});

test('language: the host\'s language reaches TextureCraft and replaces the one it stored, not the user\'s', { tag: '@language' }, async ({ context }) => {
  // Three starts of TextureCraft, and its settings are written on its own schedule.
  test.slow();

  // The browser stays en-US (see test.use), so German and French can only come from the host.
  await test.step('first start: de, through the browser\'s language, and stored', async () => {
    const page = await context.newPage();
    const app = await openInHost(page, 'craftsuite-probe.tcraft', '&lang=de');
    expect.soft((await hostRecord(page)).readies[0]?.language, 'the language ready reported').toBe('de');
    expect.soft(await app.evaluate(() => navigator.language), 'the frame\'s navigator.language').toBe('de');
    expect(await storedLanguage(app), 'the language TextureCraft stored').toBe('de');
    await page.close();
  });

  await test.step('next start: the host\'s fr replaces the de it stored', async () => {
    const page = await context.newPage();
    const app = await openInHost(page, 'craftsuite-probe.tcraft', '&lang=fr');
    expect.soft((await hostRecord(page)).readies[0]?.language, 'the language ready reported').toBe('fr');
    expect(await storedLanguage(app, 'de'), 'the language TextureCraft stored').toBe('fr');
    await page.close();
  });

  await test.step('the user picks Italian in TextureCraft (Edit > Settings...)', async () => {
    // What TextureCraft stores then, and the adapter's own key gone, as the adapter drops it when
    // TextureCraft writes another language than the host's. Written from a page of the app's
    // origin without the app, which would write its settings again as it closes.
    const page = await context.newPage();
    await page.goto(`${APP_ORIGIN}/texturecraft/craftsuite-layer/core.js`);
    await page.evaluate(() => {
      const ui = JSON.parse(localStorage.getItem('ui.json')!) as { prefs: { language: string } };
      ui.prefs.language = 'it';
      localStorage.setItem('ui.json', JSON.stringify(ui, null, 2));
      localStorage.removeItem('craftsuite-layer:texturecraft:language');
    });
    await page.close();
  });

  await test.step('a language the user picked stays: the host\'s de does not replace it', async () => {
    const page = await context.newPage();
    const app = await openInHost(page, 'craftsuite-probe.tcraft', '&lang=de');
    expect.soft((await hostRecord(page)).readies[0]?.language, 'ready reports no language: the app keeps its own').toBeNull();
    expect(await app.evaluate(() => (JSON.parse(localStorage.getItem('ui.json')!) as { prefs: { language: string } }).prefs.language),
      'the language TextureCraft reads').toBe('it');
    await page.close();
  });
});

test('ui: File > Save and File > Export Mesh... with the pointer', { tag: '@ui' }, async ({ page }) => {
  // TextureCraft draws slowly on a CI runner's software renderer: a test takes over 2 minutes there.
  test.slow();

  const downloads = trackDownloads(page);
  const app = await openInHost(page, 'craftsuite-probe.tcraft');

  await test.step('File > Save saves the document, like Ctrl+S', async () => {
    await clickApp(page, app, 'File in the menu bar', AT.file);
    await settle(page.locator('#app'), app); // the menu
    await clickApp(page, app, 'Save in the File menu', AT.fileSave);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.tcraft');
    expectSavedProject(bytes, 0);
  });

  await test.step('File > Export Mesh... > Wavefront OBJ arrives as a new file', async () => {
    await clickApp(page, app, 'File in the menu bar', AT.file);
    await settle(page.locator('#app'), app);
    await clickApp(page, app, 'Export Mesh... in the File menu', AT.fileExportMesh);
    await settle(page.locator('#app'), app); // the Export mesh window
    await clickApp(page, app, 'Wavefront OBJ (.obj)', AT.exportObj);
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'craftsuite-probe.obj');
    expect(bytes.toString('latin1'), 'an OBJ mesh').toMatch(/^v /m);
    expectNoDownloads(downloads);
  });
});
