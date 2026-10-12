// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real PdfCraft web build. See docs/apps/pdfcraft.md. Seven tests; a
// test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract   allowed host: handshake with the served app version, open; edits saved with Ctrl+S
//              arrive as the document (a second save extends the stored bytes), an export as a new
//              file; a link with target _self opens a new window and the editor stays in the
//              frame; after Sanitize document, Save rewrites the file and arrives as an export
//              under the opened name, and the next Save, which extends it, as the document that
//              follows that export; nothing becomes a download, also not after the deadlines for
//              the host's confirmation and result have passed
//   fallbacks  silent host: an unconfirmed save becomes a download after the timeout
//              failing host: a save the host could not store is downloaded at once, with the edit
//   inactive   top level: the translator stays inactive, Save is a download
//              foreign host: no handshake, forged init/open ignored, Save is a download
//   startup    the app cannot load: the translator notices and tells the host instead of leaving
//              it waiting
//   blank      the blanks of the "+ New" entry in Files (A4 and Letter) open, and their first
//              save (Ctrl+S, no edit) arrives as the document; nothing becomes a download
//   language   the host's language de: ready names it, PdfCraft's preferences hold it with the
//              adapter's mark, and the palette finds the German 'Öffnen…' (Open…), which opens the
//              file chooser; a language the user picked in the app (fr, stored while no PdfCraft
//              runs) stays: the next start with de leaves it, and ready names no language
//   ui (@ui)   the paths that need pointer clicks: the toolbar Save button saves the document; an
//              Action Wizard result under the document's own name arrives as an export; an
//              attachment named '../../Team/Budget 2026.pdf' arrives as 'Budget 2026.pdf';
//              PdfCraft's own link with target _self (About > Contributors) opens a new window
//
// A daily canary runs this file against every new PdfCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see
// (section "Contract"). Steps use the keyboard and the command palette, with command labels from
// PdfCraft's crates/engine/src/commands.rs (the language test types a German one, from
// crates/ui-egui/src/i18n/de.tsv). Only the test tagged @ui also clicks with the pointer: a moved
// button fails it without the translator being at fault.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { appFrames, press, runCommand, settle } from '../lib/craft-ui.ts';

const PROBE = readFileSync(new URL('../fixtures/craftsuite-probe.pdf', import.meta.url));
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const FOREIGN = `http://127.0.0.1:${portBase + 2}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/pdfcraft/`;
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

// Pinned: the @ui click positions depend on the layout, and PdfCraft's labels on the language.
test.use({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });

// The browser downloads of a page, from now on.
function trackDownloads(page: Page) {
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  return downloads;
}

// For a test with several independent scenarios: each runs as a step in a page of its own, and a
// failure is reported (as a soft error) without stopping the scenarios after it, so one run lists
// every scenario that broke (a release that moves one button tends to move others). The app
// starts without the preferences an earlier page stored, as in a fresh browser. The page of a
// passed scenario is closed; a failed one stays open for the diagnostics.
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
// UI: drive PdfCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on PdfCraft 0.5.0, still right in 0.6.0), relative to the app frame at
// the pinned viewport. This is the only layout knowledge in this file; when a release moves
// something, fix it here.
const AT = {
  // Mode bar, right end: Print, Save (floppy icon), Document properties.
  toolbarSave: (b: Box) => ({ x: b.x + b.width - 64, y: b.y + 62 }),
  // Right rail: the paperclip, sixth icon after Comments, Bookmarks, Pages, Fields, Layers.
  attachmentsRail: (b: Box) => ({ x: b.x + b.width - 23, y: b.y + 302 }),
  // Attachments panel, first row: "Open in a new tab", left of "Save attachment".
  openAttachment: (b: Box) => ({ x: b.x + b.width - 114, y: b.y + 161 }),
  // Action Wizard, a modal centred in the frame: Start, its bottom-right button.
  wizardStart: (b: Box) => ({ x: b.x + b.width / 2 + 282, y: b.y + b.height / 2 + 162 }),
  // About PdfCraft, a modal centred in the frame and sized to its tab. On the About tab: the
  // Contributors tab, second in its tab row.
  aboutContributorsTab: (b: Box) => ({ x: b.x + b.width / 2 - 269, y: b.y + b.height / 2 - 118 }),
  // On the Contributors tab (a taller modal): the first name in the list, a link to a profile.
  firstContributor: (b: Box) => ({ x: b.x + b.width / 2 - 370, y: b.y + b.height / 2 - 36 }),
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

// Sanitize document… from the palette, confirmed by keyboard: its dialog has no Enter shortcut,
// but Tab moves the focus to its first button, Sanitize (crates/ui-egui/src/redact_ui.rs,
// sanitize_body), and Enter presses the focused button.
async function sanitizeDocument(page: Page, app: Frame) {
  await runCommand(page, app, 'Sanitize document');

  await test.step('ui: Tab, Enter in the Sanitize document dialog', async () => {
    await settle(page.locator('#app'), app); // the dialog
    await page.keyboard.press('Tab');
    await appFrames(app, 3);
    await page.keyboard.press('Enter');
    await settle(page.locator('#app'), app);
  });
}

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

// For the inactive translator: the app loads the fixture itself (?file=).
function fixtureLoaded(page: Page) {
  return page.waitForResponse((r) => r.url() === `${APP_ORIGIN}/files/craftsuite-probe.pdf` && r.ok());
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

// The window that a link opened. Without one, tell a link that did nothing (for a click: one that
// missed, see AT) from a link that replaced the editor (translator).
async function linkWindow(popup: Promise<Page>, app: Frame, nothing = 'the click missed the link (check AT)') {
  try {
    return await popup;
  } catch {
    const url = app.isDetached() ? 'nothing' : app.url();
    throw new Error(url.startsWith(APP)
      ? `no new window, and the editor is still in the frame: ${nothing}`
      : `no new window: the link replaced the editor in the frame, which now shows ${url}`);
  }
}

// The app frame still shows the editor, not a page the app linked to.
async function expectEditorInFrame(app: Frame) {
  expect(app.isDetached(), 'the app frame is still there').toBe(false);
  const href = await app.evaluate(() => location.href);
  expect(href.startsWith(APP), `the app frame still shows ${APP}, not ${href}`).toBe(true);
}

async function untilHost(page: Page, what: string, done: (h: HostRecord) => boolean, timeout = 30_000) {
  await expect.poll(async () => done(await hostRecord(page)), { message: what, timeout }).toBe(true);
}

// The first occurrence of each message type the host received, in order.
async function messageTypes(page: Page) {
  return [...new Set((await hostRecord(page)).messages.map((m) => m.type))];
}

// The language of each ready message the host received (null: the app picks its own).
async function readyLanguages(page: Page) {
  return (await hostRecord(page)).readies.map((r) => r.language);
}

// PdfCraft's stored interface language (field language of its preferences, localStorage
// 'pdfcraft') and the codes the adapter wrote (its mark, a JSON list), as the app frame sees them.
function storedLanguage(app: Frame) {
  return app.evaluate(() => ({
    language: (JSON.parse(localStorage.getItem('pdfcraft') ?? 'null') as { language?: unknown } | null)?.language ?? null,
    mark: localStorage.getItem('craftsuite-layer:pdfcraft:language'),
  }));
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
  expect(save).toMatchObject({ kind: 'document', openId: 1, name });
}

// Anything else (exports, rewritten copies, attachments): the host stores it as a new file.
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, name });
}

// PdfCraft saves incrementally: the bytes stored last, then an update section.
function expectAppended(bytes: Buffer, stored: Buffer, update?: string) {
  expect(bytes.length, 'longer than the stored bytes').toBeGreaterThan(stored.length);
  expect(bytes.subarray(0, stored.length).equals(stored), 'starts with the stored bytes').toBe(true);
  if (update) expect(bytes.subarray(stored.length).includes(update), `the update contains ${update}`).toBe(true);
  expect(bytes.subarray(-8).toString('latin1').trimEnd().endsWith('%%EOF'), 'ends like a complete PDF').toBe(true);
}

async function expectDownload(download: Download, name: string) {
  expect(download.suggestedFilename()).toBe(name);
  return readFile(await download.path());
}

function expectNoDownloads(downloads: Download[]) {
  expect(downloads.map((d) => d.suggestedFilename()), 'browser downloads').toEqual([]);
}

// ---------------------------------------------------------------------------------------------

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, `?app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'pdfcraft'), 'messages from another app than pdfcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.pdfcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.pdfcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  const first = await test.step('Ctrl+S saves the edit as the document', async () => {
    await runCommand(page, app, 'Rotate pages clockwise');
    await press(page, app, 'Control+s');
    const saved = await hostSave(page, 1);
    expectDocument(saved.save, 'craftsuite-probe.pdf');
    expectAppended(saved.bytes, PROBE, '/Rotate 90');
    return saved;
  });

  await test.step('once the host stored a save, the next one extends those bytes and is still the document', async () => {
    await runCommand(page, app, 'Rotate pages clockwise');
    await press(page, app, 'Control+s');
    const second = await hostSave(page, 2);
    expectDocument(second.save, 'craftsuite-probe.pdf');
    expectAppended(second.bytes, first.bytes, '/Rotate 180');
  });

  await test.step('a link with target _self opens a new window, the editor stays in the frame', async () => {
    // PdfCraft's own such link needs pointer clicks; see the @ui test.
    const popup = page.waitForEvent('popup', { timeout: 10_000 });
    await app.evaluate(() => { window.open('about:blank', '_self'); });
    await (await linkWindow(popup, app, 'window.open() opened nothing')).close();
    await expectEditorInFrame(app);
  });

  await test.step('the editor still works, and an export arrives as a new file next to the document', async () => {
    await runCommand(page, app, 'Export to Word');
    const word = await hostSave(page, 3);
    expectExport(word.save, 'craftsuite-probe.docx');
    expect(word.bytes.subarray(0, 2).toString('latin1'), 'a zip (docx)').toBe('PK');
  });

  await test.step('after Sanitize, Save rewrites the file: a new file, which the next Save continues as the document', async () => {
    const stored = (await hostSave(page, 2)).bytes;
    await sanitizeDocument(page, app);
    await press(page, app, 'Control+s');
    const rewritten = await hostSave(page, 4);
    // Under the opened name, but it must not replace the opened file: a new file.
    expectExport(rewritten.save, 'craftsuite-probe.pdf');
    expect(rewritten.bytes.subarray(0, stored.length).equals(stored), 'a rewrite, not an update of the stored bytes').toBe(false);
    // PdfCraft goes on from the bytes it wrote: the host stores this save in that new file.
    await runCommand(page, app, 'Rotate pages clockwise');
    await press(page, app, 'Control+s');
    const continued = await hostSave(page, 5);
    expect(continued.save).toMatchObject({ kind: 'document', openId: 1, follows: rewritten.save.id, name: 'craftsuite-probe.pdf' });
    expectAppended(continued.bytes, rewritten.bytes, '/Rotate 270');
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

test('fallbacks: a save the host does not store becomes a download', async ({ context }) => {
  await scenario(context, 'silent host: a save the host never confirms becomes a download after the timeout', async (page) => {
    const app = await openInHost(page, `?ack=0&app-ack=${SHORT_ACK}`);
    const download = page.waitForEvent('download', { timeout: SHORT_ACK + 15_000 });
    const pressed = Date.now();
    await press(page, app, 'Control+s');
    const bytes = await expectDownload(await download, 'craftsuite-probe.pdf');
    expect(Date.now() - pressed, 'waited for the confirmation timeout').toBeGreaterThanOrEqual(SHORT_ACK - 500);
    expect(bytes.subarray(0, PROBE.length).equals(PROBE), 'starts with the opened bytes').toBe(true);
    const { save } = await hostSave(page, 1);
    expect(save).toMatchObject({ kind: 'document', name: 'craftsuite-probe.pdf', unconfirmed: true });
    await untilHost(page, 'the host was told the save failed', (h) => h.errors.length > 0);
    expect((await hostRecord(page)).errors).toEqual([expect.objectContaining({ of: 'save', id: save.id })]);
  });

  await scenario(context, 'failing host: a save the host reports as failed is downloaded at once, with the edit', async (page) => {
    // A long confirmation timeout: a download within the wait below can only come from the report.
    const app = await openInHost(page, '?fail=1&app-ack=60000');
    await runCommand(page, app, 'Rotate pages clockwise');
    const download = page.waitForEvent('download', { timeout: 20_000 });
    await press(page, app, 'Control+s');
    expectAppended(await expectDownload(await download, 'craftsuite-probe.pdf'), PROBE, '/Rotate 90');
    const { save } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.pdf');
    await untilHost(page, 'the host was told the save failed', (h) => h.errors.length > 0);
    expect((await hostRecord(page)).errors).toEqual([expect.objectContaining({ of: 'save', id: save.id })]);
  });
});

test('inactive: at top level and under a foreign host, Save is an ordinary download', async ({ context }) => {
  await scenario(context, 'top level: the translator stays inactive and Save is a download', async (page) => {
    const loaded = fixtureLoaded(page);
    await page.goto(`${APP}?file=/files/craftsuite-probe.pdf`);
    await loaded;
    const app = page.mainFrame();
    await settle(page, app);
    const download = page.waitForEvent('download', { timeout: 20_000 });
    await press(page, app, 'Control+s');
    const bytes = await expectDownload(await download, 'craftsuite-probe.pdf');
    expect(bytes.subarray(0, PROBE.length).equals(PROBE), 'starts with the opened bytes').toBe(true);
  });

  await scenario(context, 'foreign host: no handshake, forged init and open are ignored, Save is a download', async (page) => {
    const loaded = fixtureLoaded(page);
    // A long confirmation timeout: a save the translator held would not come down in time below.
    await page.goto(`${FOREIGN}?appfile=1&app-ack=60000`);
    await loaded;
    const app = appFrame(page);
    await settle(page.locator('#app'), app);
    // The foreign page does what the real host would (its init on the frame's load came first).
    await page.evaluate(() => {
      const w = (document.getElementById('app') as HTMLIFrameElement).contentWindow!;
      w.postMessage({ protocol: 'craftsuite-layer', version: 1, type: 'init' }, '*');
      const data = new TextEncoder().encode('%PDF-1.7 forged').buffer;
      w.postMessage({ protocol: 'craftsuite-layer', version: 1, type: 'open', id: 9, name: 'forged.pdf', data }, '*', [data]);
    });
    await settle(page.locator('#app'), app); // a forged file would open here
    expect((await hostRecord(page)).messages, 'messages to the foreign host').toEqual([]);

    const download = page.waitForEvent('download', { timeout: 20_000 });
    await press(page, app, 'Control+s');
    const bytes = await expectDownload(await download, 'craftsuite-probe.pdf');
    expect(bytes.subarray(0, PROBE.length).equals(PROBE), 'the fixture, not the forged file').toBe(true);
    const record = await hostRecord(page);
    expect(record.messages, 'messages to the foreign host').toEqual([]);
    expect(record.saves, 'saves the foreign host got').toEqual([]);
  });
});

test('startup: an app that cannot load reports it to the host', async ({ page }) => {
  await page.route((url) => url.origin === APP_ORIGIN && url.pathname.endsWith('.wasm'), (route) => route.abort());
  // A short startup timeout as a backstop: should the translator miss the load error, the test
  // gets 'the app did not start in time' within the wait below and fails on it, instead of
  // timing out without a message.
  await page.goto(`${HOST}?app-startup=15000`);
  await untilHost(page, 'the host got an error of startup', (h) => h.errors.some((e) => e.of === 'startup'));
  const { errors } = await hostRecord(page);
  expect.soft(errors.map((e) => e.of), 'errors the host got').toEqual(['startup']);
  expect.soft(errors.find((e) => e.of === 'startup')?.message,
    'the translator noticed the failed load itself, not only through the startup timeout').toMatch(/^the app failed to load: /);
  const types = await messageTypes(page);
  expect.soft(types, 'message types the host got').not.toContain('ready');
  expect.soft(types, 'message types the host got').not.toContain('delivered');
});

test('blank: the + New blanks open and their first save replaces them', async ({ page }) => {
  // craftsuite_layer/assets/blank.pdf (A4) and blank-letter.pdf, made by blanks.mjs. PdfCraft
  // saves without an edit, and an update of the blank (not a rewrite) is the document.
  const downloads = trackDownloads(page);
  for (const name of ['blank.pdf', 'blank-letter.pdf']) {
    await test.step(name, async () => {
      const app = await openInHost(page, `?name=blanks/${name}`);
      await press(page, app, 'Control+s');
      expect((await hostSave(page, 1)).save).toMatchObject({ kind: 'document', openId: 1, follows: null, name });
    });
  }
  expectNoDownloads(downloads);
});

test('language: the host\'s language starts PdfCraft in it, a language picked in the app stays', { tag: '@language' }, async ({ page, context }) => {
  // Its own context: no scenario() here, which would clear the preferences the second step needs.
  await test.step('lang=de: ready names de, the preferences hold it, and the interface is German', async () => {
    const app = await openInHost(page, '?lang=de');
    expect.soft(await readyLanguages(page), 'language of each ready').toEqual(['de']);
    expect.soft(await storedLanguage(app), 'PdfCraft\'s stored language and the adapter\'s mark').toEqual({ language: 'de', mark: '["de"]' });
    // Only the German interface has a command 'Öffnen…' (Open…, crates/ui-egui/src/i18n/de.tsv). The
    // palette also matches English labels and command ids, none of which has an 'ö'.
    const chooser = page.waitForEvent('filechooser', { timeout: 15_000 }).then(() => true, () => false);
    await runCommand(page, app, 'Öffnen');
    expect.soft(await chooser, 'the palette ran Öffnen… (Open… in German), which opens the file chooser').toBe(true);
  });

  await test.step('a language the user picked in the app (fr) stays: lang=de leaves it, ready names none', async () => {
    // PdfCraft writes its preferences back as it loses the focus, also when its page closes: store
    // the user's choice only while no PdfCraft runs, from a page of the app's origin without the
    // app (Playwright shares that storage with the app's frame).
    await page.close();
    const plain = await context.newPage();
    await plain.goto(`${APP_ORIGIN}/`); // 'not found', on the app's origin
    await plain.evaluate(() => localStorage.setItem('pdfcraft', JSON.stringify({ language: 'fr' })));
    await plain.close();
    const again = await context.newPage();
    const app = await openInHost(again, '?lang=de');
    expect.soft(await readyLanguages(again), 'language of each ready').toEqual([null]);
    expect.soft(await storedLanguage(app), 'PdfCraft\'s stored language and the adapter\'s mark').toEqual({ language: 'fr', mark: '["de"]' });
  });
});

test('ui: toolbar Save, Action Wizard, attachments and About > Contributors with the pointer', { tag: '@ui' }, async ({ context }) => {
  // Four paths in a page each; a path that misses its button runs into its waits on its own.
  test.slow();

  await scenario(context, 'the toolbar Save button saves the document like Ctrl+S', async (page, downloads) => {
    const app = await openInHost(page);
    await clickApp(page, app, 'the toolbar Save button', AT.toolbarSave);
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.pdf');
    expect(bytes.subarray(0, PROBE.length).equals(PROBE), 'starts with the opened bytes').toBe(true);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'an Action Wizard result under the document\'s name arrives as an export', async (page, downloads) => {
    const app = await openInHost(page);
    await runCommand(page, app, 'Prepare for distribution');
    await settle(page.locator('#app'), app); // the wizard dialog
    await clickApp(page, app, 'Start in the Action Wizard', AT.wizardStart);
    // Same name as the document, but a rewritten file: it must not replace the document. Should a
    // release append to the document instead, the first check fails: then 'document' is right.
    const { save, bytes } = await hostSave(page, 1);
    expect(bytes.subarray(0, PROBE.length).equals(PROBE), 'the wizard rewrote the file, not appended to it').toBe(false);
    expectExport(save, 'craftsuite-probe.pdf');
    expectNoDownloads(downloads);
  });

  await scenario(context, 'an attachment\'s document-controlled name arrives as a plain basename', async (page, downloads) => {
    const app = await openInHost(page, '?name=attach-traversal.pdf');
    await clickApp(page, app, 'the Attachments panel in the right rail', AT.attachmentsRail);
    await settle(page.locator('#app'), app);
    await clickApp(page, app, '"Open in a new tab" for the first attachment', AT.openAttachment);
    await settle(page.locator('#app'), app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'Budget 2026.pdf');
    expect(bytes.includes('ATTACHED CONTENT'), 'the attachment, not the document around it').toBe(true);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'PdfCraft\'s own link with target _self (About > Contributors) opens a new window', async (page, downloads) => {
    // The link leads to an https page: answer it here, so the test needs no network. The test
    // origins are all http.
    await context.route((url) => url.protocol === 'https:', (route) => route.fulfill({ contentType: 'text/html', body: '' }));
    const app = await openInHost(page);
    await runCommand(page, app, 'About PdfCraft');
    await settle(page.locator('#app'), app); // the About dialog
    await clickApp(page, app, 'the Contributors tab of About', AT.aboutContributorsTab);
    await settle(page.locator('#app'), app);
    const popup = page.waitForEvent('popup', { timeout: 10_000 });
    await clickApp(page, app, 'the first contributor\'s link', AT.firstContributor);
    const opened = await linkWindow(popup, app);
    await expect(opened, 'the link opened in the new window').toHaveURL(/^https:\/\//);
    await opened.close();
    await expectEditorInFrame(app);
    expectNoDownloads(downloads);
  });
});
