// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real MaterialCraft web build. See docs/apps/materialcraft.md. Four
// tests; a test with several scenarios runs each in its own page and reports every scenario that
// fails.
//
//   contract   allowed host: handshake with the served app version, open of
//              craftsuite-probe.mcraft; an edit saved with Ctrl+S arrives as the document under the
//              opened name, a MaterialCraft project with the edit, and so does the next; a package
//              from the user's disk (File > Open) saves under its own name as a new file; nothing
//              becomes a download, also not after the deadlines for the host's confirmation and
//              result
//   saved-as   names: an opened .sbs saves as '<stem>_sbs.zip', the document, and so does the next
//              save; 'Untitled package.mcraft' cannot be told from a new package and saves as a new
//              file; the blank of the "+ New" entry in Files opens, and its first save is the
//              document
//   language   (@language) the host's ar reaches MaterialCraft as the browser's language and is
//              what it stores; at the next start the host's en replaces it; a language the user
//              picked in MaterialCraft stays
//   ui (@ui)   Save as (Ctrl+Shift+S) and the pointer in the 'Save package' window: Download as a
//              MaterialCraft Project is the document; as an SBS XML Package a new file
//
// A daily canary runs this file against every new MaterialCraft release, so the steps that drive
// the app (section "UI") are kept apart from the checks of what the host and the browser see
// (section "Contract"). The steps use MaterialCraft's keyboard shortcuts (crates/ui-egui/src/
// menus.rs); only the test tagged @ui clicks with the pointer: a moved button fails it without
// the translator being at fault.
//
// fixtures/materialcraft/craftsuite-probe.mcraft is written by its make-fixtures.mjs: a package
// 'craftsuite-probe' with one material graph, MARKER, holding one Blur node.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { appFrames, press, settle } from '../lib/craft-ui.ts';

const PROBE = readFileSync(new URL('../fixtures/materialcraft/craftsuite-probe.mcraft', import.meta.url));
const MARKER = 'CRAFTSUITE_PROBE_mc01';
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/materialcraft/`;
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

// Pinned: the @ui click positions depend on the layout, and MaterialCraft's labels on the language.
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
// UI: drive MaterialCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on MaterialCraft 0.3.0), relative to the app frame at the pinned
// viewport. This is the only layout knowledge in this file; when a release moves something, fix
// it here.
const AT = {
  // The 'Save package' window, at the top left: the type 'SBS XML Package (*.sbs)', the first.
  sbsType: (b: Box) => ({ x: b.x + 33, y: b.y + 117 }),
  // Its Download button, below the types; one line lower with the SBS type, which adds a hint.
  download: (b: Box) => ({ x: b.x + 58, y: b.y + 175 }),
  downloadSbs: (b: Box) => ({ x: b.x + 58, y: b.y + 194 }),
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

// A MaterialCraft shortcut such as 'S' or 'Shift+S' with its command key: egui reads the platform
// from the user agent, and under a Mac one (WebKit's) the command key is Cmd, the Meta key.
async function shortcut(page: Page, app: Frame, key: string) {
  const command = (await app.evaluate(() => navigator.userAgent.includes('Mac'))) ? 'Meta' : 'Control';
  await press(page, app, `${command}+${key}`);
}

// After a step that opens another package: wait until the picture is no longer `before`, then
// until it settles. On a slow machine the app can take the next key before it shows the package.
async function untilChanged(page: Page, app: Frame, before: Buffer, what: string) {
  const view = page.locator('#app');
  await expect.poll(async () => !(await view.screenshot({ caret: 'initial', scale: 'css' })).equals(before),
    { message: what, timeout: 30_000 }).toBe(true);
  await settle(view, app);
}

// Select all (Ctrl+A) and Duplicate (Ctrl+D) in the open graph: the edit the tests save, one more
// copy of each node every time (the first time of the fixture's Blur node).
async function duplicateAll(page: Page, app: Frame) {
  await test.step('ui: select all and duplicate (Ctrl+A, Ctrl+D)', async () => {
    await shortcut(page, app, 'a');
    await appFrames(app, 3);
    await shortcut(page, app, 'd');
    await settle(page.locator('#app'), app);
  });
}

// File > Open... (Ctrl+O) with a file from the user's disk, through the browser's file picker: it
// opens as a package of its own and becomes the active one.
async function openFromDisk(page: Page, app: Frame, file: { name: string; buffer: Buffer }) {
  await test.step(`ui: File > Open... (Ctrl+O) of ${file.name} from the disk`, async () => {
    const before = await page.locator('#app').screenshot({ caret: 'initial', scale: 'css' });
    const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
    await shortcut(page, app, 'o');
    await (await chooser).setFiles({ ...file, mimeType: 'application/octet-stream' });
    await untilChanged(page, app, before, 'the opened package shows');
  });
}

// Loads the test host with a fixture and waits until the translator has handed it to the app.
// `bytes` serves those bytes under `name` instead of a file in fixtures/materialcraft/. A name
// under blanks/ is a blank of the "+ New" entries in Files (craftsuite_layer/assets/).
async function openInHost(page: Page, name: string, query = '', bytes?: Buffer) {
  if (bytes) {
    await page.route(`${HOST}files/materialcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  }
  const file = name.startsWith('blanks/') ? name : `materialcraft/${name}`;
  await page.goto(`${HOST}?target=materialcraft&name=${encodeURIComponent(file)}${query}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  await untilExplorerShows(page, app);
  return app;
}

// MaterialCraft reads a dropped file on a later frame and opens it as a package of its own: the
// explorer at the top left then lists it below 'Untitled package'. A key before that reaches the
// new package it starts with. So wait until the explorer changes; if it does not within 10 s, the
// package was there already (or a release moved the explorer): carry on.
async function untilExplorerShows(page: Page, app: Frame) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const explorer = () => page.screenshot({ clip: { x: box.x, y: box.y + 60, width: 200, height: 220 }, caret: 'initial', scale: 'css' });
  const first = await explorer();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await explorer()).equals(first)) break;
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

// Anything else (exports, other packages): the host stores it as a new file.
function expectExport(save: HostSave, name: string | RegExp) {
  expect(save).toMatchObject({ kind: 'export', openId: null, name: typeof name === 'string' ? name : expect.stringMatching(name) });
}

// A MaterialCraft save: a zip whose SBS file at the root (`sbs`) holds the package
// (crates/formats/src/project.rs): its identifier, whether it has the MARKER graph and its nodes.
function materialPackage(bytes: Buffer, sbs = 'package.sbs') {
  const files = unzipSync(bytes);
  expect(Object.keys(files), `a MaterialCraft save: a zip with ${sbs}`).toContain(sbs);
  const xml = strFromU8(files[sbs]);
  return {
    identifier: /<package><identifier v="([^"]*)"/.exec(xml)?.[1],
    marker: xml.includes(`<identifier v="${MARKER}"/>`),
    nodes: xml.split('<compNode>').length - 1,
  };
}

// The opened package, saved with `copies` copies of its node.
function expectSavedPackage(bytes: Buffer, copies: number, sbs = 'package.sbs') {
  const pkg = materialPackage(bytes, sbs);
  expect(pkg.marker, 'the fixture\'s graph').toBe(true);
  expect(pkg.nodes, `the fixture's node and ${copies} copies`).toBe(2 ** copies);
}

// The SBS XML of PROBE with its package's identifier replaced by `identifier`.
function probeSbs(identifier = 'craftsuite-probe') {
  return strFromU8(unzipSync(PROBE)['package.sbs']).replace('<identifier v="craftsuite-probe"/>', `<identifier v="${identifier}"/>`);
}

// PROBE as another MaterialCraft project: its package named `identifier`, its graph renamed.
function probeNamed(identifier: string, graph = MARKER) {
  const sbs = probeSbs(identifier).replace(`<identifier v="${MARKER}"/>`, `<identifier v="${graph}"/>`);
  return Buffer.from(zipSync({ 'resources/': new Uint8Array(0), 'package.sbs': [strToU8(sbs), { level: 6 }] }));
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// prefs.language in MaterialCraft's settings, which it keeps in localStorage 'ui' as RON.
const LANGUAGE_RON = /\bprefs:\(\s*language:\s*"([^"]*)"/;

// The interface language MaterialCraft stored in the frame's origin, once it has stored one that
// is not `not`. It writes its settings on its own schedule.
async function storedLanguage(app: Frame, not: string | null = null) {
  let language: string | null = null;
  await expect.poll(async () => (language = await app.evaluate((pattern) =>
    new RegExp(pattern).exec(localStorage.getItem('ui') || '')?.[1] ?? null, LANGUAGE_RON.source)) !== null && language !== not,
  { message: 'MaterialCraft stored its settings', timeout: 60_000 }).toBe(true);
  return language;
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, 'craftsuite-probe.mcraft', `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'materialcraft'), 'messages from another app than materialcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.materialcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.materialcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('Ctrl+S saves the edit as the document, under the opened name', async () => {
    await duplicateAll(page, app);
    await shortcut(page, app, 's');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.mcraft');
    expectSavedPackage(bytes, 1);
  });

  await test.step('the next edit, saved with Ctrl+S, is the document again', async () => {
    await duplicateAll(page, app);
    await shortcut(page, app, 's');
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, 'craftsuite-probe.mcraft');
    expectSavedPackage(bytes, 2);
  });

  await test.step('a package from the disk (File > Open) saves under its own name, as a new file', async () => {
    await openFromDisk(page, app, { name: 'from-disk.mcraft', buffer: probeNamed('from-disk', 'FROM_DISK') });
    await shortcut(page, app, 's');
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'from-disk.mcraft');
    expect(materialPackage(bytes).marker, 'the package from the disk, not the opened one').toBe(false);
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

test('saved-as: saves go under the package\'s path; one MaterialCraft cannot tell apart is a new file', async ({ context }) => {
  await scenario(context, 'an opened .sbs saves as <stem>_sbs.zip, the document, and so does the next save', async (page, downloads) => {
    // The host keeps craftsuite-probe.sbs and stores the saves next to it.
    const app = await openInHost(page, 'craftsuite-probe.sbs', '', Buffer.from(probeSbs(), 'utf8'));
    await shortcut(page, app, 's');
    const first = await hostSave(page, 1);
    expectDocument(first.save, 'craftsuite-probe_sbs.zip');
    expectSavedPackage(first.bytes, 0, 'craftsuite-probe.sbs');

    await duplicateAll(page, app);
    await shortcut(page, app, 's');
    const second = await hostSave(page, 2);
    expectDocument(second.save, 'craftsuite-probe_sbs.zip');
    expectSavedPackage(second.bytes, 1, 'craftsuite-probe.sbs');
    expectNoDownloads(downloads);
  });

  await scenario(context, '\'Untitled package.mcraft\' saves as a new file: a new package saves under the same name', async (page, downloads) => {
    const app = await openInHost(page, 'Untitled package.mcraft', '', probeNamed('Untitled package'));
    await shortcut(page, app, 's');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'Untitled package.mcraft');
    expectSavedPackage(bytes, 0);
    expectNoDownloads(downloads);
  });

  // The blank of the "+ New" entry in Files (craftsuite_layer/blanks.mjs): MaterialCraft saves an
  // opened .mcraft under the file's name, whatever its package is called.
  await scenario(context, 'the + New blank (blank.mcraft) opens, and its first save is the document', async (page, downloads) => {
    const app = await openInHost(page, 'blanks/blank.mcraft');
    await shortcut(page, app, 's');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'blank.mcraft');
    expect(materialPackage(bytes).identifier, 'the blank\'s package').toBe('Untitled package');
    expectNoDownloads(downloads);
  });
});

test('language: the host\'s language reaches MaterialCraft and replaces the one it stored, not the user\'s', { tag: '@language' }, async ({ context }) => {
  // Four starts of MaterialCraft, and its settings are written on its own schedule.
  test.slow();

  // The browser stays en-US (see test.use), so Arabic can only come from the host.
  await test.step('first start: ar, through the browser\'s language, and stored', async () => {
    const page = await context.newPage();
    const app = await openInHost(page, 'craftsuite-probe.mcraft', '&lang=ar');
    expect.soft((await hostRecord(page)).readies[0]?.language, 'the language ready reported').toBe('ar');
    expect.soft(await app.evaluate(() => navigator.language), 'the frame\'s navigator.language').toBe('ar');
    expect(await storedLanguage(app), 'the language MaterialCraft stored').toBe('ar');
    await page.close();
  });

  await test.step('next start: the host\'s en replaces the ar it stored', async () => {
    const page = await context.newPage();
    const app = await openInHost(page, 'craftsuite-probe.mcraft', '&lang=en');
    expect.soft((await hostRecord(page)).readies[0]?.language, 'the language ready reported').toBe('en');
    expect(await storedLanguage(app, 'ar'), 'the language MaterialCraft stored').toBe('en');
    await page.close();
  });

  await test.step('the user picks Arabic in MaterialCraft (Edit > Preferences)', async () => {
    // What MaterialCraft stores then, and the adapter's own key gone, as the adapter drops it when
    // MaterialCraft writes another language than the host's. Written from a page of the app's
    // origin without the app, which would write its settings again as it closes.
    const page = await context.newPage();
    await page.goto(`${APP_ORIGIN}/materialcraft/craftsuite-layer/core.js`);
    await page.evaluate((pattern) => {
      localStorage.setItem('ui', localStorage.getItem('ui')!.replace(new RegExp(pattern), (match, code: string) => match.replace(`"${code}"`, '"ar"')));
      localStorage.removeItem('craftsuite-layer:materialcraft:language');
    }, LANGUAGE_RON.source);
    await page.close();
  });

  await test.step('a language the user picked stays: the host\'s en does not replace it', async () => {
    const page = await context.newPage();
    const app = await openInHost(page, 'craftsuite-probe.mcraft', '&lang=en');
    expect.soft((await hostRecord(page)).readies[0]?.language, 'ready reports no language: the app keeps its own').toBeNull();
    expect(await app.evaluate((pattern) => new RegExp(pattern).exec(localStorage.getItem('ui') || '')?.[1], LANGUAGE_RON.source),
      'the language MaterialCraft reads').toBe('ar');
    await page.close();
  });
});

test('ui: Save as and the \'Save package\' window with the pointer', { tag: '@ui' }, async ({ page }) => {
  const downloads = trackDownloads(page);
  const app = await openInHost(page, 'craftsuite-probe.mcraft');

  await test.step('Save as > Download as a MaterialCraft Project saves the document', async () => {
    await shortcut(page, app, 'Shift+S');
    await settle(page.locator('#app'), app); // the 'Save package' window
    await clickApp(page, app, 'Download in the \'Save package\' window', AT.download);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.mcraft');
    expectSavedPackage(bytes, 0);
    expect(materialPackage(bytes).identifier, 'the package the window saved').toBe('craftsuite-probe');
  });

  await test.step('Save as > SBS XML Package > Download arrives as a new file', async () => {
    await shortcut(page, app, 'Shift+S');
    await settle(page.locator('#app'), app);
    await clickApp(page, app, 'SBS XML Package (*.sbs)', AT.sbsType);
    await settle(page.locator('#app'), app); // the hint below the types
    await clickApp(page, app, 'Download in the \'Save package\' window', AT.downloadSbs);
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'craftsuite-probe_sbs.zip');
    expectSavedPackage(bytes, 0, 'craftsuite-probe.sbs');
    expectNoDownloads(downloads);
  });
});
