// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator inside the real WordCraft web build. See docs/apps/wordcraft.md. Three tests; a
// test with several scenarios runs each in its own page and reports every scenario that fails.
//
//   contract   allowed host: handshake with the served app version, open of a .docx WordCraft
//              wrote; the app sees no save picker (showSaveFilePicker, hidden by the adapter);
//              an edit saved with Ctrl+S arrives as the document under the opened name,
//              with the edit and the opened creation time, and Save As (F12) after another edit is
//              the document again; a file the user opens from their disk (File > Open, Ctrl+O)
//              and the save of a new document (Ctrl+N) arrive as new files; nothing becomes a
//              download, also not after the deadlines for the host's confirmation and result
//   saved-as   an opened .odt and .rtf save as 'probe.docx', the document (a new file next to
//              the original), and so does the next save, with the edit; a .docx Word wrote is
//              saved as a copy: the first save is a new file, the next one replaces that file;
//              Document1.docx with a creation time saves as the document, and a new document
//              saved under the same name is a new file; Document1.docx without one is never saved
//              back; the blanks of the "+ New" entry in Files (blanks/blank.docx on A4, and
//              blank-letter.docx) open, and their first saves are the document; after a recipient
//              list arrives (a .csv drop), a save
//              under the opened name is a new file; so is the save of a copy of the opened file
//              that the user opens with File > Open, and (Chromium) drops from the desktop
//   ui (@ui)   File > Export with the pointer, on an opened .odt: PDF and OpenDocument Text (under
//              the opened name) arrive as new files, Word document as the document; Mailings >
//              Finish & Merge on an opened Document1.docx, with recipients from a .txt dropped
//              after Use an Existing List… was cancelled: the merged document, saved under the
//              opened name with the opened creation time, arrives as a new file; on an opened
//              letter with a merge field, after a recipient typed into Type a New List… (no file
//              comes in): the letter's save keeps the field and is the document, and the merged
//              document's save, under the same name and creation time, is a new file
//
// A daily canary runs this file against every new WordCraft release, so the steps that drive the
// app (section "UI") are kept apart from the checks of what the host and the browser see
// (section "Contract"). Steps use WordCraft's shortcuts from crates/engine/src/cmd/file.rs
// (Ctrl+S, F12, Ctrl+N, Ctrl+O). WordCraft has no shortcut for File > Export (the File tab has
// no KeyTip) or for Select Recipients > Use an Existing List… (its KeyTip opens Type a New
// List…), and its command search opens only with the pointer, so only the test tagged @ui reaches
// them, with the pointer: a moved button fails it without the translator being at fault.
//
// Fixtures in fixtures/wordcraft/: craftsuite-probe.docx was saved by WordCraft 0.5.0 (a new
// document with MARKER typed, no title, a creation time); make-fixtures.mjs writes from-word.docx
// (as Word writes it), probe.odt and probe.rtf. The spec derives the files it opens under other
// names or with other content from craftsuite-probe.docx.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { appFrames, focusCanvas, press, settle, waitForTextEditing } from '../lib/craft-ui.ts';

const PROBE = readFileSync(new URL('../fixtures/wordcraft/craftsuite-probe.docx', import.meta.url));
const PROBE_CREATED = '2026-10-11T21:25:10Z'; // the creation time WordCraft stored in PROBE
const MARKER = 'CRAFTSUITE-PROBE-wc01';
const ELSEWHERE = 'CRAFTSUITE-ELSEWHERE-wc01'; // the text of elsewhereCopy()
const TYPED = 'Ada-wc01'; // the first name typed into a new recipient list
const portBase = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${portBase}/`;
const APP_ORIGIN = `http://127.0.0.2:${portBase + 1}`;
const APP = `${APP_ORIGIN}/wordcraft/`;
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

// Pinned: the @ui click positions depend on the layout. WordCraft 0.6.1 starts in the browser's
// language (0.5.0 in English whatever it was), which translates its labels and the name of a new
// document ('Document1').
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
// UI: drive WordCraft. egui draws everything into one canvas, so the DOM tells little: which
// element has the focus, and the picture.
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

// Pointer targets (measured on WordCraft 0.5.0, checked again on 0.6.1 and 0.7.0), relative to the
// app frame at the pinned viewport. This is the only layout knowledge in this file; when a release
// moves something, fix it here.
const AT = {
  // Ribbon tabs: File (opens the backstage) and Mailings.
  fileTab: (b: Box) => ({ x: b.x + 27, y: b.y + 53 }),
  mailingsTab: (b: Box) => ({ x: b.x + 452, y: b.y + 53 }),
  // Backstage: Export in the list on the left, then the first, second and fifth button of the
  // Export page: PDF document, Word document, OpenDocument Text (0.6.1 added Word XML Document as
  // the third, 0.7.0 Word 2003 XML Document as the fourth).
  backstageExport: (b: Box) => ({ x: b.x + 44, y: b.y + 375 }),
  exportPdf: (b: Box) => ({ x: b.x + 400, y: b.y + 128 }),
  exportWord: (b: Box) => ({ x: b.x + 400, y: b.y + 170 }),
  exportOdt: (b: Box) => ({ x: b.x + 400, y: b.y + 296 }),
  // Mailings: Select Recipients and, in its menu, Type a New List… and Use an Existing List…; in
  // the list Type a New List… shows, the first field (First Name) of the first recipient; Finish
  // & Merge, the last button of the ribbon; then Don't Save in the question about the open
  // document's unsaved changes (loading recipients marks it changed).
  selectRecipients: (b: Box) => ({ x: b.x + 252, y: b.y + 103 }),
  typeNewList: (b: Box) => ({ x: b.x + 285, y: b.y + 161 }),
  useExistingList: (b: Box) => ({ x: b.x + 285, y: b.y + 183 }),
  firstRecipient: (b: Box) => ({ x: b.x + 400, y: b.y + 350 }),
  finishMerge: (b: Box) => ({ x: b.x + 1000, y: b.y + 108 }),
  dontSave: (b: Box) => ({ x: b.x + 766, y: b.y + 372 }),
};

// After something that changes the picture, until the app shows the same picture twice (see
// settle()). WordCraft blinks its caret while its page has the focus, so the focus goes to the
// host page, but only after some frames: a key or click the app has not handled yet would be
// lost with the focus. The steps that type focus the canvas again.
async function settleApp(page: Page, app: Frame) {
  await appFrames(app, 3);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page.locator('#app'), app);
}

function appFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url().startsWith(APP));
  if (!frame) throw new Error(`no frame shows ${APP}`);
  return frame;
}

// For the @ui test: a click at a point from AT, after a hover frame so egui sees the target, and
// then until the picture settles.
async function clickApp(page: Page, app: Frame, what: string, at: (b: Box) => { x: number; y: number }) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const { x, y } = at(box);

  await test.step(`ui: click ${what}`, async () => {
    await page.mouse.move(x, y);
    await appFrames(app, 2);
    await page.mouse.click(x, y);
    await settleApp(page, app);
  });
}

// For the @ui test: File > Export > <format>. The backstage stays open after an export.
async function exportAs(page: Page, app: Frame, what: string, button: (b: Box) => { x: number; y: number }) {
  await clickApp(page, app, 'the File tab', AT.fileTab);
  await clickApp(page, app, 'Export in the backstage', AT.backstageExport);
  await clickApp(page, app, `${what} on the Export page`, button);
}

// Typing into the document at the caret (the start of the text after an open).
async function typeText(page: Page, app: Frame, text: string) {
  await test.step(`ui: type "${text}"`, async () => {
    await focusCanvas(app);
    await page.keyboard.type(text, { delay: 10 });
    await appFrames(app, 3);
  });
}

// A key that changes the picture (a new document, another file).
async function pressAndSettle(page: Page, app: Frame, what: string, key: string) {
  await test.step(`ui: ${what} (${key})`, async () => {
    await press(page, app, key);
    await settleApp(page, app);
  });
}

// File > Open (Ctrl+O) through the browser's file picker, with a file from the user's disk.
async function openFromDisk(page: Page, app: Frame, file: { name: string; buffer: Buffer }) {
  await test.step(`ui: File > Open (Control+o) of ${file.name} from the disk`, async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await press(page, app, 'Control+o');
    await (await chooser).setFiles({ name: file.name, mimeType: 'application/octet-stream', buffer: file.buffer });
    await settleApp(page, app); // the file replaces the open document
  });
}

// A user's drag and drop of a file from the desktop onto the middle of the app. Only Chromium
// can send such a trusted drop (DevTools protocol), see chromiumOnly().
async function dropFromDesktop(page: Page, app: Frame, file: string) {
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await test.step(`ui: drop ${path.basename(file)} from the desktop`, async () => {
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, ...at, data });
    await cdp.detach();
    await settleApp(page, app); // the file replaces the open document
  });
}

// A recipient list for mail merge with two entries, dropped onto the app: WordCraft loads a
// dropped .csv as recipients, and a .txt while it waits for a list (after Use an Existing List…).
// The drop is synthetic, like the core's; the adapter counts a recipient list from any drop.
async function dropRecipientList(page: Page, app: Frame, name = 'recipients.csv') {
  await test.step(`ui: drop a recipient list (${name})`, async () => {
    await app.evaluate((name) => {
      const text = name.endsWith('.csv') ? 'Name,City\nAda,London\nBob,Paris\n' : 'Name\tCity\nAda\tLondon\nBob\tParis\n';
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], name, { type: 'text/plain' }));
      const canvas = document.querySelector('canvas')!;
      const box = canvas.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
      for (const type of ['dragover', 'drop']) canvas.dispatchEvent(new DragEvent(type, init));
    }, name);
    await settleApp(page, app); // 'Recipients: 2' in the status bar
  });
}

// For the @ui test: Mailings > Select Recipients > Use an Existing List…, and the user cancels the
// file picker. rfd opens the browser's picker at once while the click still counts as the
// user's, else it first shows a box of its own with Ok and Cancel (rfd 0.17, wasm backend).
// WordCraft still waits for a list until the next command.
async function cancelExistingList(page: Page, app: Frame) {
  await clickApp(page, app, 'the Mailings tab', AT.mailingsTab);
  await clickApp(page, app, 'Select Recipients', AT.selectRecipients);
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 }).catch(() => null);
  await clickApp(page, app, 'Use an Existing List… in the menu', AT.useExistingList);
  const box = app.locator('#rfd-overlay:not(.hidden) button', { hasText: 'Cancel' });
  const shown = await Promise.race([chooser, box.waitFor({ timeout: 15_000 }).then(() => box, () => null)]);
  if (!shown) throw new Error('Use an Existing List… showed no file picker');
  const cancel = () => ('setFiles' in shown ? shown.setFiles([]) : shown.click());

  await test.step('ui: cancel the file picker', async () => {
    await cancel();
    await settleApp(page, app);
  });
}

// For the @ui test: Mailings > Select Recipients > Type a New List…, one recipient's first name
// typed into the list, then OK (Enter). No file comes in.
async function typeNewList(page: Page, app: Frame, firstName: string) {
  await clickApp(page, app, 'the Mailings tab', AT.mailingsTab);
  await clickApp(page, app, 'Select Recipients', AT.selectRecipients);
  await clickApp(page, app, 'Type a New List… in the menu', AT.typeNewList);
  const box = await page.locator('#app').boundingBox();
  if (!box) throw new Error('the app frame is not visible');
  const { x, y } = AT.firstRecipient(box);

  await test.step(`ui: type "${firstName}" as the first recipient's first name, then OK (Enter)`, async () => {
    // Not clickApp: settling moves the focus away, and with it the text field's.
    await page.mouse.move(x, y);
    await appFrames(app, 2);
    await page.mouse.click(x, y);
    await waitForTextEditing(app, true, 'the first recipient\'s first name took no text');
    await page.keyboard.insertText(firstName); // no key events: stray letters could be shortcuts
    await appFrames(app, 3);
    await page.keyboard.press('Enter');
    await settleApp(page, app); // 'Recipients: 1' in the status bar
  });
}

// Loads the test host with a fixture and waits until the translator has handed it to the app.
// `bytes` serves those bytes under `name` instead of a file in fixtures/wordcraft/. A name under
// blanks/ is a blank of the "+ New" entries in Files (craftsuite_layer/assets/).
async function openInHost(page: Page, name: string, query = '', bytes?: Buffer) {
  if (bytes) {
    await page.route(`${HOST}files/wordcraft/${encodeURIComponent(name)}`,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  }
  const file = name.startsWith('blanks/') ? name : `wordcraft/${name}`;
  await page.goto(`${HOST}?target=wordcraft&name=${encodeURIComponent(file)}${query}`);
  await untilHost(page, 'the translator delivered the file (or reported an error)',
    (h) => h.state === 'delivered' || h.errors.length > 0, 90_000);
  expect((await hostRecord(page)).errors, 'translator errors while opening').toEqual([]);
  const app = appFrame(page);
  await settleApp(page, app); // the app reads the file and opens it some frames after the drop
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

// A copy of the opened document (docs/protocol.md#copies). The first follows its own id, which
// names no file the host has, so the host stores it as a new file; a later one follows the first
// and replaces that file.
function expectCopy(save: HostSave, name: string, first: HostSave = save) {
  expect(save).toMatchObject({ kind: 'document', openId: 1, follows: first.id, name });
}

// Anything else (exports, other documents): the host stores it as a new file.
function expectExport(save: HostSave, name: string) {
  expect(save).toMatchObject({ kind: 'export', openId: null, follows: null, name });
}

// A Word document as WordCraft saves it: the text of its body, its creation time and the
// program named in docProps/app.xml.
function wordDocument(bytes: Buffer) {
  expect(bytes.subarray(0, 4).toString('latin1'), 'a zip package').toBe('PK\x03\x04');
  const files = unzipSync(bytes);
  const part = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  expect(part('[Content_Types].xml'), 'a Word document').toContain('wordprocessingml.document.main+xml');
  return {
    text: part('word/document.xml').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    created: /<dcterms:created[^>]*>([^<]*)</.exec(part('docProps/core.xml'))?.[1] ?? null,
    application: /<Application>([^<]*)</.exec(part('docProps/app.xml'))?.[1] ?? null,
  };
}

// The opened document saved by WordCraft, with the texts typed into it.
function expectSaved(bytes: Buffer, ...typed: string[]) {
  const doc = wordDocument(bytes);
  expect(doc.text, 'the opened document\'s text').toContain(MARKER);
  for (const text of typed) expect(doc.text, 'the edit').toContain(text);
  expect(doc.application, 'written by WordCraft').toBe('WordCraft');
  return doc;
}

// PROBE rewritten, with the same entries in the same order: `core` and `body` change
// docProps/core.xml and word/document.xml.
function rewrite(core: (xml: string) => string, body: (xml: string) => string) {
  const files = unzipSync(PROBE);
  const out: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    const text = name === 'docProps/core.xml' ? core(strFromU8(data)) : name === 'word/document.xml' ? body(strFromU8(data)) : null;
    out[name] = [text === null ? data : strToU8(text), { level: 6 }];
  }
  return Buffer.from(zipSync(out));
}
const same = (xml: string) => xml;

// PROBE without its creation time, as some programs write a .docx.
const withoutCreated = () => rewrite((xml) => xml.replace(/<dcterms:created[^>]*>[^<]*<\/dcterms:created>/, ''), same);

// Another document with PROBE's name and creation time, as if from the user's own disk (an
// earlier download of the same file, edited elsewhere).
const elsewhereCopy = () => rewrite(same, (xml) => xml.replace(MARKER, ELSEWHERE));

// A letter for mail merge: PROBE with the title 'invitation', so that the document Finish & Merge
// makes from 'invitation.docx' saves under that name, and a paragraph 'Dear «First Name»' with a
// merge field for the first field of the list Type a New List… starts with. The field is a simple
// one (w:fldSimple), as other programs write it; WordCraft saves it as a complex one.
const mergeTemplate = () => rewrite(
  (xml) => xml.replace('<cp:lastModifiedBy>', '<dc:title>invitation</dc:title><cp:lastModifiedBy>'),
  (xml) => xml.replace('</w:p>', '</w:p><w:p><w:r><w:t xml:space="preserve">Dear </w:t></w:r>' +
    '<w:fldSimple w:instr=" MERGEFIELD &quot;First Name&quot; "><w:r><w:t>«First Name»</w:t></w:r></w:fldSimple></w:p>'));

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

test('contract: an allowed host opens the file and stores every save, nothing is downloaded', async ({ page }) => {
  const downloads = trackDownloads(page);
  await recordAppVersions(page);
  const app = await openInHost(page, 'craftsuite-probe.docx', `&app-ack=${SHORT_ACK}&app-result=${SHORT_RESULT}`);

  await test.step('handshake: hello, ready with the served app version, delivered', async () => {
    expect.soft(await messageTypes(page), 'message types the host got, in order').toEqual(['hello', 'ready', 'delivered']);
    const { messages } = await hostRecord(page);
    expect.soft(messages.filter((m) => m.app !== 'wordcraft'), 'messages from another app than wordcraft').toEqual([]);
    expect.soft(messages.find((m) => m.type === 'delivered')?.id, 'id of delivered').toBe(1);
    // The frame runs the build the run selected. A test server started before a later
    // `npm run craft:fetch` (Playwright reuses one outside CI) could serve another.
    const selected = JSON.parse(await readFile(SELECTED, 'utf8')) as Record<string, string>;
    const served = await page.evaluate(() => (window as HostWindow).CRAFTSUITE_TEST?.versions?.wordcraft);
    expect.soft(served, `the version the test server serves is the one in ${SELECTED}; restart the server`).toBe(selected.wordcraft);
    expect.soft(await page.evaluate(() => (window as HostWindow).__appVersions), 'appVersion of the one ready').toEqual([served]);
  });

  await test.step('Ctrl+S saves the edit as the document, under the opened name, with its creation time', async () => {
    // WordCraft 0.6.1 saves through the browser's save picker where it finds one, past the core,
    // and Chromium refuses that in a frame of another origin: the adapter hides it.
    expect.soft(await app.evaluate(() => typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker), 'the save picker the app sees').toBe('undefined');
    await typeText(page, app, 'EDIT1 ');
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectDocument(save, 'craftsuite-probe.docx');
    expect(expectSaved(bytes, 'EDIT1').created, 'the opened creation time, kept by Save').toBe(PROBE_CREATED);
  });

  await test.step('Save As (F12) after another edit is the document again', async () => {
    await typeText(page, app, 'EDIT2 ');
    await press(page, app, 'F12');
    const { save, bytes } = await hostSave(page, 2);
    expectDocument(save, 'craftsuite-probe.docx');
    expectSaved(bytes, 'EDIT1', 'EDIT2');
  });

  await test.step('a file opened from the disk (File > Open) saves under its own name, as a new file', async () => {
    await openFromDisk(page, app, { name: 'probe.rtf', buffer: readFileSync(new URL('../fixtures/wordcraft/probe.rtf', import.meta.url)) });
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 3);
    expectExport(save, 'probe.docx');
    expect(wordDocument(bytes).text, 'the file from the disk').toContain('RTF fixture');
  });

  await test.step('the save of a new document (Ctrl+N) arrives as a new file', async () => {
    await pressAndSettle(page, app, 'create a new document', 'Control+n');
    await typeText(page, app, 'NEWDOC ');
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 4);
    expectExport(save, 'Document1.docx');
    const doc = wordDocument(bytes);
    expect(doc.text, 'the new document').toContain('NEWDOC');
    expect(doc.text, 'not the opened document').not.toContain(MARKER);
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

test('saved-as: interchange formats, copies, new documents and files from elsewhere', async ({ context, browserName }) => {
  test.slow(); // ten scenarios, each loading the 36 MB app

  // WordCraft saves every opened file that is not a Word package as '<stem>.docx' and keeps that
  // name for later saves (ui-egui/src/lib.rs default_save_name).
  for (const opened of ['probe.odt', 'probe.rtf']) {
    await scenario(context, `an opened ${path.extname(opened)} saves as probe.docx, the document, and so does the next save`, async (page, downloads) => {
      const app = await openInHost(page, opened);
      await press(page, app, 'Control+s');
      const first = await hostSave(page, 1);
      expectDocument(first.save, 'probe.docx');
      expectSaved(first.bytes);

      await typeText(page, app, 'EDIT2 ');
      await press(page, app, 'Control+s');
      const second = await hostSave(page, 2);
      expectDocument(second.save, 'probe.docx');
      expectSaved(second.bytes, 'EDIT2');
      expectNoDownloads(downloads);
    });
  }

  await scenario(context, 'a .docx Word wrote is saved as a copy: the first save is a new file, the next replaces that file', async (page, downloads) => {
    const app = await openInHost(page, 'from-word.docx');
    await typeText(page, app, 'EDIT1 ');
    await press(page, app, 'Control+s');
    const first = await hostSave(page, 1);
    // Under the opened name, but WordCraft's re-encoding: it must not replace the original.
    expectCopy(first.save, 'from-word.docx');
    expect(expectSaved(first.bytes, 'EDIT1').created, 'the opened creation time').toBe('2025-03-04T05:06:07Z');

    await typeText(page, app, 'EDIT2 ');
    await press(page, app, 'Control+s');
    const second = await hostSave(page, 2);
    expectCopy(second.save, 'from-word.docx', first.save);
    expectSaved(second.bytes, 'EDIT1', 'EDIT2');
    expectNoDownloads(downloads);
  });

  await scenario(context, 'Document1.docx with a creation time saves as the document; a new document saved under the same name is a new file', async (page, downloads) => {
    // Both save as 'Document1.docx'; only the creation time tells them apart.
    const app = await openInHost(page, 'Document1.docx', '', PROBE);
    await typeText(page, app, 'EDIT1 ');
    await press(page, app, 'Control+s');
    const own = await hostSave(page, 1);
    expectDocument(own.save, 'Document1.docx');
    expectSaved(own.bytes, 'EDIT1');

    await pressAndSettle(page, app, 'create a new document', 'Control+n');
    await typeText(page, app, 'NEWDOC ');
    await press(page, app, 'Control+s');
    const other = await hostSave(page, 2);
    expectExport(other.save, 'Document1.docx');
    expect(wordDocument(other.bytes).text, 'the new document, not the opened one').not.toContain(MARKER);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'Document1.docx without a creation time is never saved back', async (page, downloads) => {
    // A new document's save looks the same: a new file each time, nothing overwritten.
    const app = await openInHost(page, 'Document1.docx', '', withoutCreated());
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'Document1.docx');
    expectSaved(bytes);
    expectNoDownloads(downloads);
  });

  // The blank of the "+ New" entry in Files (craftsuite_layer/blanks.mjs): WordCraft's own .docx
  // with a creation time and no title, so it saves under the opened name, as the document.
  for (const name of ['blank.docx', 'blank-letter.docx']) {
    await scenario(context, `the + New blank ${name} opens, and its first save is the document`, async (page, downloads) => {
      const app = await openInHost(page, `blanks/${name}`);
      await press(page, app, 'Control+s');
      expectDocument((await hostSave(page, 1)).save, name);
      expectNoDownloads(downloads);
    });
  }

  await scenario(context, 'after a recipient list arrives, a save under the opened name is a new file', async (page, downloads) => {
    // From then on Finish & Merge can make a document that saves under the opened name with the
    // opened creation time (the @ui test merges): every save under that name is a new file.
    const app = await openInHost(page, 'craftsuite-probe.docx');
    await dropRecipientList(page, app);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'craftsuite-probe.docx');
    expectSaved(bytes);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'a copy of the opened file opened with File > Open is never the document', async (page, downloads) => {
    // Same name, same creation time, other text: only the file's way in tells it apart.
    const app = await openInHost(page, 'craftsuite-probe.docx');
    await openFromDisk(page, app, { name: 'craftsuite-probe.docx', buffer: elsewhereCopy() });
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'craftsuite-probe.docx');
    expect(wordDocument(bytes).text, 'the file from the disk').toContain(ELSEWHERE);
    expectNoDownloads(downloads);
  });

  await chromiumOnly(browserName, () => scenario(context, 'a copy of the opened file dropped from the desktop is never the document', async (page, downloads) => {
    const file = test.info().outputPath('desktop', 'craftsuite-probe.docx');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, elsewhereCopy());
    const app = await openInHost(page, 'craftsuite-probe.docx');
    await dropFromDesktop(page, app, file);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'craftsuite-probe.docx');
    expect(wordDocument(bytes).text, 'the dropped file').toContain(ELSEWHERE);
    expectNoDownloads(downloads);
  }));
});

test('ui: File > Export and Mailings > Finish & Merge with the pointer', { tag: '@ui' }, async ({ context }) => {
  test.slow(); // three scenarios, each loading the 36 MB app, and some twenty steps that wait for the picture

  await scenario(context, 'File > Export on an opened .odt: PDF and ODT are new files, Word document is the document', async (page, downloads) => {
    const app = await openInHost(page, 'probe.odt');

    await exportAs(page, app, 'PDF document', AT.exportPdf);
    const pdf = await hostSave(page, 1);
    expectExport(pdf.save, 'probe.pdf');
    expect(pdf.bytes.subarray(0, 5).toString('latin1'), 'a PDF').toBe('%PDF-');

    // WordCraft's rewrite of the ODT, under the opened name: it must not replace the opened file.
    await clickApp(page, app, 'OpenDocument Text on the Export page', AT.exportOdt);
    const odt = await hostSave(page, 2);
    expectExport(odt.save, 'probe.odt');
    expect(odt.bytes.subarray(0, 2).toString('latin1'), 'a zip package').toBe('PK');

    // Export > Word document writes what Save writes.
    await clickApp(page, app, 'Word document on the Export page', AT.exportWord);
    const word = await hostSave(page, 3);
    expectDocument(word.save, 'probe.docx');
    expectSaved(word.bytes);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'Mailings > Finish & Merge on an opened Document1.docx: the merged document is a new file', async (page, downloads) => {
    // The merged document is a copy of the opened one with its title (none) and creation time,
    // so it saves as 'Document1.docx' (engine/src/cmd/mailings.rs finish). The recipients come
    // from a .txt dropped after the picker of Use an Existing List… was cancelled, which WordCraft
    // loads as a list (ui-egui/src/lib.rs drain_inbox, recipient_list_pending).
    const app = await openInHost(page, 'Document1.docx', '', PROBE);
    await cancelExistingList(page, app);
    await dropRecipientList(page, app, 'people.txt');
    await clickApp(page, app, 'Finish & Merge', AT.finishMerge);
    await clickApp(page, app, 'Don\'t Save in the question', AT.dontSave);
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 1);
    expectExport(save, 'Document1.docx');
    const merged = expectSaved(bytes);
    expect(merged.text.split(MARKER).length - 1, 'the opened text once per recipient').toBe(2);
    expect(merged.created, 'the opened creation time').toBe(PROBE_CREATED);
    expectNoDownloads(downloads);
  });

  await scenario(context, 'Mailings > Finish & Merge with a typed recipient list: the letter is the document, the merged document a new file', async (page, downloads) => {
    // No file comes in, so only the merge fields tell them apart: the letter keeps its field, and
    // Finish & Merge turns it into text. Both save as 'invitation.docx' with the opened creation
    // time (engine/src/cmd/mailings.rs finish).
    const app = await openInHost(page, 'invitation.docx', '', mergeTemplate());
    await typeNewList(page, app, TYPED);
    await press(page, app, 'Control+s');
    const letter = await hostSave(page, 1);
    expectDocument(letter.save, 'invitation.docx');
    expect(expectSaved(letter.bytes).text, 'the merge field, kept').toContain('MERGEFIELD');

    await clickApp(page, app, 'Finish & Merge', AT.finishMerge); // saved: no question
    await press(page, app, 'Control+s');
    const { save, bytes } = await hostSave(page, 2);
    expectExport(save, 'invitation.docx');
    const merged = expectSaved(bytes);
    expect(merged.text, 'the typed recipient in place of the field').toContain(`Dear ${TYPED}`);
    expect(merged.text, 'no merge field left').not.toContain('MERGEFIELD');
    expect(merged.created, 'the opened creation time').toBe(PROBE_CREATED);
    expectNoDownloads(downloads);
  });
});
