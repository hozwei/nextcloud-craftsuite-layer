// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The translator (translators/core.js with the PdfCraft adapter) against the stub app, which
// behaves in the browser like PdfCraft 0.5.0 (see stub-app/stub.js). Some tests use a test adapter
// instead (stub-app/stub-adapter.js: PdfCraft's classify plus other optional members). Each test
// is a scenario whose steps (test.step) check one behaviour after another; a failure names the
// step that broke.
//
// Every engine (tagged @cross-browser: what depends on how a browser drops, downloads and posts):
//   1 allowed host: hello, init, ready with versions; the open arrives as a drop onto the canvas
//     with the exact bytes; saves (toolbar, Ctrl+S, a burst) reach the host as the document or as
//     exports, never as a browser download; only download links to the app's object URLs are
//     taken; messages from another window of the allowed origin are ignored; saves reach the host
//     in the order the app started them (also a large one before a small one), each announced
//     by save-started
//   2 fallback: a save the host does not confirm, or reports as failed, is downloaded with its
//     name (also an export's) and bytes, once; a failed save does not move the stored version
//   3 inactive: at top level and under a foreign host (forged init and open) Save stays an
//     ordinary download and nothing reaches the host
//   4 load failures: each way the app can fail to load is reported to the host
//   5 host settings: the language in the frame's fragment reaches the adapter, matched to the
//     languages the app shows, before the app runs; the app's address loses the fragment, the
//     frame's name keeps the setting for a reload, and ready reports the language; anything but a
//     language tag clears it; at top level the fragment stays where it is
// Chromium only:
//   6 names: opens (also several sent together) and downloads get plain, short basenames without
//     direction overrides or invisible format characters; an opened file is the document under
//     its cleaned name; reopening a name replaces the document; a save whose identity differs
//     from the stored one is an export
//   7 app frame: the addEventListener hook is gone, the layer API is sealed, links that would
//     replace the editor open a new window, which gets no opener; javascript: and data: links
//     open nothing; a reloaded frame starts over
//   8 host answers: a stored save is done; a late result does not replace a reopened file; any
//     result but ok: true, or none in time, falls back once; a confirmation replaces the
//     confirmation deadline with the result deadline, and every confirmation restarts it; after a
//     rewritten save the host was sent, the saves after it follow it as the document (continuesExports),
//     after one it did not store, not
//   9 protocol (bare host): before the handshake Save and window.open are left alone and only an
//     init of this protocol and version counts; hello stops after 30 tries, an init still counts
//     after that; ready comes once; only well-formed opens of this version are delivered
//  10 startup: a missing drop target (also for each open), a hang and a failure before init are
//     reported; a late drop target clears the failure; an open waits for the drop target
//  11 hosting attributes: the allowlist takes origins in any case and with a trailing slash and
//     skips invalid entries; with none valid the translator stays inactive; without an app
//     version ready says appVersion null
//  12 hosting attributes: anything but a positive, finite timeout means the default (for the
//     drop target, the adapter's dropTargetTimeout if it has one); a valid one wins
//
// Two hosts frame the stub on the allowed origin:
//  - the test host (host/index.html), which answers like the Nextcloud app: init on hello, open
//    after ready, save-received and save-result for each save;
//  - a bare page on the same origin, for protocol cases where the test sends every message itself.
// Every protocol message a top-level page receives is recorded in window.__raw. The stub records
// the messages that reached the app. The translator's listener was added before the stub's, so
// once the stub has seen a message the translator has handled it: a deterministic fence for
// checking that something did not happen. fence() is the same in the other direction: the app
// frame posts a marker, and whatever the translator posted before it has reached the page.
//
// Deadline steps fake time with Playwright's clock, which belongs to the browser context and
// reaches every frame. The stub and the translator measure time only with timers and animation
// frames, so a stopped clock makes a deadline exact: nothing just before it, the fallback just
// after. A scenario with several clocks gives each a context of its own. (Not for the real app in
// pdfcraft.spec.ts: it animates.)

import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Download, type Frame, type Page } from '@playwright/test';

const base = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const HOST = `http://127.0.0.1:${base}`;
const APP = `http://127.0.0.2:${base + 1}`;
const FOREIGN = `http://127.0.0.1:${base + 2}`;
const PROBE = readFileSync(new URL('../fixtures/craftsuite-probe.pdf', import.meta.url));
const PROBE_NAME = 'craftsuite-probe.pdf';
const b64 = (text: string) => Buffer.from(text).toString('base64');

type Raw = {
  type: string; app?: string; version?: unknown; id?: number | null; kind?: string; openId?: number | null;
  follows?: number | null; name?: string; size?: number; of?: string; message?: string; appVersion?: string | null;
  layerVersion?: string; origin: string; base64: string | null;
};
type HostSave = {
  id: number; kind: string; openId: number | null; follows?: number | null; name: string; size: number;
  base64?: string; unconfirmed?: boolean;
};
type Opened = { name: string; type: string; size: number; base64: string };

// What the pages expose. A cast rather than a global declaration, which other specs may declare
// differently. Simple reads and waits use string expressions instead.
type TestWindow = Window & typeof globalThis & {
  __raw: Raw[];
  __host: { saves: HostSave[] };
  __stub: Record<string, (...args: unknown[]) => unknown> & { messages: Record<string, unknown>[] };
  post(msg: object, transfer?: Transferable[]): void; // test host
  send(msg: object, text?: string): void; // bare host
};

/** Evaluates a JavaScript expression in a page or frame. */
const value = <T>(where: Page | Frame, expr: string) => where.evaluate(expr) as Promise<T>;
/** Waits until a JavaScript expression is truthy in a page or frame. */
const until = (where: Page | Frame, expr: string, timeout = 15_000) => where.waitForFunction(expr, undefined, { timeout });

// --- Hosts ------------------------------------------------------------------------------------------

/** Records every protocol message the window receives in window.__raw (runs in the page). */
function recordProtocolMessages() {
  if (window.top !== window) return;
  const raw: Raw[] = ((window as TestWindow).__raw = []);
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.protocol !== 'craftsuite-layer') return;
    const { data, ...rest } = msg;
    let base64 = null;
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      base64 = btoa(bin);
    }
    raw.push({ ...rest, origin: event.origin, base64 });
  });
}

/** The frame on the app origin, once the stub runs in it. */
async function appFrame(page: Page): Promise<Frame> {
  const find = () => page.frame({ url: (url) => url.origin === APP });
  await expect.poll(() => find() !== null, { message: 'the app frame', timeout: 15_000 }).toBe(true);
  const frame = find()!;
  await until(frame, 'window.__stub');
  return frame;
}

/** The test host with the stub; params are the host's query parameters (app-<knob> for the translator). */
async function openHost(page: Page, params: Record<string, string> = {}, origin = HOST): Promise<Frame> {
  await page.addInitScript(recordProtocolMessages);
  await page.goto(`${origin}/?${new URLSearchParams({ target: 'stub', ...params })}`);
  return appFrame(page);
}

/** The test host after it delivered the probe and the app opened it. */
async function openDelivered(page: Page, params: Record<string, string> = {}): Promise<Frame> {
  const frame = await openHost(page, params);
  await waitForMessage(page, { type: 'delivered', id: 1 });
  await until(frame, '__stub.docs.length === 1');
  return frame;
}

/** A page on the allowed origin that frames the stub and does nothing on its own: tests call send(). */
async function openBareHost(page: Page, appParams: Record<string, string> = {}): Promise<Frame> {
  // Rewrites a document the host origin served: Chromium does not let a page fulfilled by a route
  // frame the app on its loopback address. setContent() erases the window's listeners, so the
  // page installs the recorder itself, before the app can send anything.
  await page.goto(`${HOST}/config.js`);
  await page.setContent(`<!doctype html><meta charset="utf-8"><title>bare host</title>
<style>html, body { margin: 0; height: 100%; } iframe { width: 100%; height: 100%; border: 0; display: block; }</style>
<script>
  (${recordProtocolMessages})();
  window.send = (msg, text) => {
    const data = typeof text === 'string' ? new TextEncoder().encode(text).buffer : undefined;
    document.getElementById('app').contentWindow.postMessage(
      { protocol: 'craftsuite-layer', version: 1, ...msg, ...(data ? { data } : {}) }, ${JSON.stringify(APP)}, data ? [data] : []);
  };
</script>
<iframe id="app" src="${APP}/stub/?${new URLSearchParams(appParams)}"></iframe>`);
  return appFrame(page);
}

/** The protocol messages the page received, without fence() markers. */
const messages = (page: Page) => value<Raw[]>(page, "__raw.filter((m) => m.type !== 'fence')");
const errors = (page: Page) => value<Raw[]>(page, "__raw.filter((m) => m.type === 'error')");
const hostSaves = async (page: Page) => (await value<HostSave[]>(page, '__host.saves')).sort((a, b) => a.id - b.id);

async function waitForMessage(page: Page, match: Record<string, unknown>, timeout = 15_000): Promise<Raw> {
  const handle = await page.waitForFunction((m) => (window as TestWindow).__raw
    .find((x) => Object.entries(m).every(([k, v]) => (x as Record<string, unknown>)[k] === v)) ?? false, match, { timeout });
  return (await handle.jsonValue()) as Raw;
}

/** Sends a message from the test host, e.g. another open as the probe's after ready. */
async function hostPost(page: Page, msg: Record<string, unknown>, text?: string) {
  await page.evaluate(([msg, text]) => {
    const data = typeof text === 'string' ? new TextEncoder().encode(text).buffer : undefined;
    (window as TestWindow).post(data ? { ...msg, data } : msg, data ? [data] : []);
  }, [msg, text] as const);
}

let fences = 0;
/**
 * Posts a marker from the app frame to the page and waits for it. Messages from one window to
 * another arrive in order, so whatever the translator posted before (e.g. from a timer that ran
 * in page.clock.runFor()) has reached the page by then.
 */
async function fence(page: Page, frame: Frame) {
  const id = ++fences;
  await frame.evaluate((id) => window.parent.postMessage({ protocol: 'craftsuite-layer', type: 'fence', id }, '*'), id);
  await waitForMessage(page, { type: 'fence', id });
}

// --- Clock -----------------------------------------------------------------------------------------

/**
 * Stops the clock that page.clock.install() faked, in every frame: from now on timers fire only
 * in page.clock.runFor(). Called before the page loads, the app's timers start stopped too.
 */
const stopClock = (page: Page) => page.clock.pauseAt(Date.now() + 1000);

/** A page in a browser context of its own, so that it gets a fake clock of its own. */
async function pageOfItsOwn(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

// --- App -------------------------------------------------------------------------------------------

/** Calls one of the stub's hooks in the app frame. */
async function stub<T = unknown>(frame: Frame, method: string, ...args: unknown[]) {
  return frame.evaluate(([method, args]) => (window as TestWindow).__stub[method](...args), [method, args] as const) as Promise<T>;
}

/** Waits until the app has seen `count` protocol messages matching `match` (so the translator has handled them). */
async function appSaw(frame: Frame, match: Record<string, unknown>, count = 1) {
  await frame.waitForFunction(([m, n]) => (window as TestWindow).__stub.messages
    .filter((x) => Object.entries(m).every(([k, v]) => x[k] === v)).length >= n, [match, count] as const);
}

/** Runs a stub hook that downloads once, and returns the save as the test host stored it. */
async function hostSave(page: Page, frame: Frame, method: string, ...args: unknown[]) {
  const n = await value<number>(page, '__host.saves.length');
  await stub(frame, method, ...args);
  await until(page, `__host.saves.length > ${n}`);
  // In the order the host got them: ids start at 1 again after a reload of the app frame.
  const save = await value<HostSave>(page, `__host.saves[${n}]`);
  // The translator has applied the result once the app's own listener has seen it.
  await appSaw(frame, { type: 'save-result', id: save.id });
  expect(save.base64, 'the host got the bytes the app downloaded').toBe(await value(frame, '__stub.downloads.at(-1).base64'));
  const bytes = Buffer.from(save.base64 ?? '', 'base64');
  expect(save.size).toBe(bytes.length);
  return { ...save, bytes };
}

/**
 * Runs a stub hook that downloads once, with a host that confirms each save but leaves the result
 * to the test (host parameter result=0); returns the save once the translator has the confirmation.
 */
async function confirmedSave(page: Page, frame: Frame, method: string, ...args: unknown[]) {
  const n = await value<number>(page, '__host.saves.length');
  await stub(frame, method, ...args);
  await until(page, `__host.saves.length > ${n}`);
  const save = await value<HostSave>(page, `__host.saves[${n}]`);
  await appSaw(frame, { type: 'save-received', id: save.id });
  return save;
}

/** Has the app download each of `names` in one task; returns what the host stored for them, in order. */
async function downloadAll(page: Page, frame: Frame, names: string[]): Promise<HostSave[]> {
  const n = await value<number>(page, '__host.saves.length');
  await frame.evaluate((names) => names.forEach((name) => (window as TestWindow).__stub.download(name)), names);
  await until(page, `__host.saves.length === ${n + names.length}`);
  return (await hostSaves(page)).slice(n);
}

const opened = (frame: Frame) => stub<Opened[]>(frame, 'opened');

function collectDownloads(page: Page): Download[] {
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  return downloads;
}

async function downloadBase64(download: Download): Promise<string> {
  return readFileSync(await download.path()).toString('base64');
}

const downloadNames = (downloads: Download[]) => downloads.map((d) => d.suggestedFilename());

const hookRemoved = (frame: Frame) =>
  value<boolean>(frame, '/\\[native code\\]/.test(Function.prototype.toString.call(EventTarget.prototype.addEventListener))');

// === Every engine ====================================================================================

test('allowed host: handshake, open by drop, every download of the app a save for the host', { tag: '@cross-browser' }, async ({ page }) => {
  const downloads = collectDownloads(page);
  const frame = await openDelivered(page);

  await test.step('hello, init and ready name the app and both versions; the open is delivered after ready', async () => {
    const layerVersion = await value<string>(frame, 'craftsuiteLayer.version');
    expect(layerVersion).toMatch(/^\d+\.\d+\.\d+$/);
    const msgs = await messages(page);
    expect(msgs[0]).toMatchObject({ type: 'hello', app: 'pdfcraft', version: 1, layerVersion, origin: APP });
    const ready = msgs.filter((m) => m.type === 'ready');
    expect(ready).toEqual([expect.objectContaining({ app: 'pdfcraft', appVersion: 'stub', layerVersion, origin: APP })]);
    const delivered = msgs.filter((m) => m.type === 'delivered');
    expect(delivered).toEqual([expect.objectContaining({ id: 1, name: PROBE_NAME, size: PROBE.length, origin: APP })]);
    expect(msgs.indexOf(ready[0])).toBeLessThan(msgs.indexOf(delivered[0]));
  });

  await test.step('the open reaches the app as a drop onto the canvas, with the exact bytes', async () => {
    expect(await opened(frame)).toEqual([{ name: PROBE_NAME, type: 'application/pdf', size: PROBE.length, base64: PROBE.toString('base64') }]);
    // eframe needs a dragover with the item before the drop, then reads dataTransfer.files.
    expect(await value(frame, '__stub.dragovers')).toEqual([1]);
    expect(await value(frame, '__stub.drops')).toEqual([expect.objectContaining({ files: 1, inside: true })]);
  });

  await test.step('Ctrl+S and a click on the toolbar reach the host as the document', async () => {
    const box = (await page.locator('#app').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // focuses the canvas
    await page.keyboard.press('ControlOrMeta+s');
    await until(page, '__host.saves.length === 1');
    await appSaw(frame, { type: 'save-result', id: 1 });
    await page.mouse.click(box.x + box.width - 60, box.y + 20); // the toolbar's Save button
    await until(page, '__host.saves.length === 2');
    await appSaw(frame, { type: 'save-result', id: 2 });
    expect((await hostSaves(page)).map((s) => [s.kind, s.openId, s.name])).toEqual([
      ['document', 1, PROBE_NAME], ['document', 1, PROBE_NAME],
    ]);
  });

  await test.step('a burst of downloads arrives completely, each with its own id', async () => {
    const n = (await hostSaves(page)).length;
    const parts = [1, 2, 3, 4, 5].map((i) => `probe-part-${i}.pdf`);
    await frame.evaluate((parts) => {
      const app = (window as TestWindow).__stub;
      app.save();
      app.burst(parts);
      app.exportAs();
    }, parts);
    await until(page, `__host.saves.length === ${n + 7}`);
    await appSaw(frame, { type: 'save-result' }, n + 7); // all stored: the next save extends this one
    const saves = (await hostSaves(page)).slice(n);
    const appDownloads = (await value<{ name: string; base64: string }[]>(frame, '__stub.downloads')).slice(-7);
    expect(saves.map((s) => [s.name, s.kind, s.base64])).toEqual([
      [PROBE_NAME, 'document', appDownloads[0].base64],
      ...parts.map((name, i) => [name, 'export', appDownloads[i + 1].base64]),
      ['craftsuite-probe.docx', 'export', appDownloads[6].base64],
    ]);
  });

  await test.step('incremental saves are the document; rewrites, other names and stale bases are exports', async () => {
    const first = await hostSave(page, frame, 'save'); // the toolbar button: synchronously in pointerup
    expect(first).toMatchObject({ kind: 'document', openId: 1, name: PROBE_NAME });
    expect(first.bytes.length).toBeGreaterThan(PROBE.length);
    expect(first.bytes.subarray(0, PROBE.length).equals(PROBE)).toBe(true);

    const second = await hostSave(page, frame, 'save', { timing: 'raf' }); // Ctrl+S: in the next frame
    expect(second).toMatchObject({ kind: 'document', openId: 1, name: PROBE_NAME });
    expect(second.bytes.subarray(0, first.bytes.length).equals(first.bytes)).toBe(true);

    const unchanged = await hostSave(page, frame, 'save', { change: false });
    expect(unchanged).toMatchObject({ kind: 'document', openId: 1, name: PROBE_NAME });
    expect(unchanged.bytes.equals(second.bytes)).toBe(true);

    const rewritten = await hostSave(page, frame, 'rewrite'); // Action Wizard: same name, new file
    expect(rewritten).toMatchObject({ kind: 'export', openId: null, name: PROBE_NAME });

    const exported = await hostSave(page, frame, 'exportAs'); // Export to Word
    expect(exported).toMatchObject({ kind: 'export', openId: null, name: 'craftsuite-probe.docx' });

    const third = await hostSave(page, frame, 'save'); // exports do not move the stored version
    expect(third).toMatchObject({ kind: 'document', openId: 1 });

    // Appending to the bytes as opened would drop what the host stored since: a new file.
    const stale = await hostSave(page, frame, 'save', { base: 'original' });
    expect(stale).toMatchObject({ kind: 'export', openId: null, name: PROBE_NAME });
    expect(stale.bytes.subarray(0, PROBE.length).equals(PROBE)).toBe(true);
  });

  await test.step('only a download link to an object URL of the app becomes a save', async () => {
    const n = (await hostSaves(page)).length;
    // [href, download attribute]: these clicks reach the link as without the translator.
    const passed: [string, string | null][] = [
      ['blob', null],
      ['revoked', 'revoked.pdf'],
      ['data', 'data.pdf'],
      [`${APP}/files/${PROBE_NAME}`, 'plain.pdf'],
      ['#section', null],
    ];
    for (const [href, download] of passed) {
      expect.soft(await stub(frame, 'clickAnchor', href, download), `link to ${href}, download ${download}`).toBe(true);
    }
    expect(await stub(frame, 'clickAnchor', 'blob', 'taken.pdf')).toBe(false);
    await until(page, `__host.saves.length > ${n}`);
    // Every taken click gets the next save id: id n + 1 means none of the clicks above was taken.
    expect((await hostSaves(page)).slice(n).map((s) => [s.id, s.kind, s.name])).toEqual([[n + 1, 'export', 'taken.pdf']]);
  });

  await test.step('messages from another window of the allowed origin are ignored', async () => {
    await page.evaluate((app) => {
      const sibling = document.createElement('iframe');
      sibling.style.display = 'none';
      sibling.srcdoc = `<script>
        const data = new TextEncoder().encode('%PDF-1.7 sibling').buffer;
        parent.document.getElementById('app').contentWindow.postMessage(
          { protocol: 'craftsuite-layer', version: 1, type: 'open', id: 50, name: 'sibling.pdf', data }, ${JSON.stringify(app)}, [data]);
      </script>`;
      document.body.append(sibling);
    }, APP);
    await appSaw(frame, { type: 'open', id: 50, fromParent: false, origin: HOST });
    await hostPost(page, { type: 'open', id: 51, name: 'parent.pdf' }, '%PDF-1.7 parent');
    await waitForMessage(page, { type: 'delivered', id: 51 });
    await until(frame, "__stub.docs.some((d) => d.name === 'parent.pdf')");
    expect((await opened(frame)).map((d) => d.name)).toEqual([PROBE_NAME, 'parent.pdf']);
    expect((await messages(page)).filter((m) => m.id === 50)).toEqual([]);
  });

  await test.step('a large save and a small one started together reach the host in that order, each announced by save-started', async () => {
    const n = await value<number>(page, '__host.saves.length'); // the last id so far
    // Reading and hashing the large save takes longer than the small export after it.
    await frame.evaluate(() => {
      const app = (window as TestWindow).__stub;
      app.save({ pad: 8 << 20 }); // the active document, parent.pdf
      app.download('small.pdf');
    });
    await until(page, `__host.saves.length === ${n + 2}`);
    await appSaw(frame, { type: 'save-result', id: n + 2 });
    // In the order the page received them (__raw; the test host records a save only after hashing
    // it). save-started goes out as the app starts the download, before the file is read.
    expect(await value(page, `__raw.filter((m) => m.type === 'save-started' || m.type === 'save').slice(-4)
      .map((m) => [m.type, m.id, m.name, m.kind ?? null, m.openId ?? null, m.size > 8 << 20])`)).toEqual([
      ['save-started', n + 1, 'parent.pdf', null, null, false], ['save-started', n + 2, 'small.pdf', null, null, false],
      ['save', n + 1, 'parent.pdf', 'document', 51, true], ['save', n + 2, 'small.pdf', 'export', null, false],
    ]);
  });

  // The saves and save-started messages in the order the page received them.
  const flow = await value<[string, number, string][]>(page,
    "__raw.filter((m) => m.type === 'save-started' || m.type === 'save').map((m) => [m.type, m.id, m.name])");
  const of = (type: string) => flow.filter((m) => m[0] === type).map(([, id, name]) => [id, name]);
  const saveIds = of('save').map(([id]) => id);
  expect(saveIds, 'every save has an id of its own, and they arrived in that order').toEqual(saveIds.map((_, i) => i + 1));
  expect(of('save-started'), 'a save-started with the id and name of each save').toEqual(of('save'));
  const unannounced = flow.filter(([type, id], i) => type === 'save' && !flow.slice(0, i).some((m) => m[0] === 'save-started' && m[1] === id));
  expect(unannounced, 'saves without an earlier save-started').toEqual([]);
  expect(await errors(page)).toEqual([]);
  expect(downloadNames(downloads), 'browser downloads').toEqual([]);
});

test('fallback: a save the host does not store is downloaded once, with its name and bytes', { tag: '@cross-browser' }, async ({ page, context }) => {
  await test.step('a host that does not confirm in time: downloaded after the deadline; late answers change nothing', async () => {
    const downloads = collectDownloads(page);
    const frame = await openDelivered(page, { ack: '0', 'app-ack': '400' });
    const download = page.waitForEvent('download');
    await stub(frame, 'save');
    const d = await download;
    expect(d.suggestedFilename()).toBe(PROBE_NAME);
    expect(await downloadBase64(d)).toBe(await value(frame, '__stub.downloads[0].base64'));
    expect(await waitForMessage(page, { type: 'error', of: 'save' })).toMatchObject({ id: 1, message: 'no confirmation from the host' });
    expect(await hostSaves(page)).toEqual([expect.objectContaining({ id: 1, kind: 'document', unconfirmed: true })]);

    await hostPost(page, { type: 'save-received', id: 1 });
    await hostPost(page, { type: 'save-result', id: 1, ok: false, error: 'late failure' });
    await hostPost(page, { type: 'save-result', id: 1, ok: true });
    await appSaw(frame, { type: 'save-result', id: 1 }, 2);
    // A second failing save as a fence: a duplicate of the first would have been reported before it.
    const fenceDownload = page.waitForEvent('download', { predicate: (d) => d.suggestedFilename() === 'fence.pdf' });
    await stub(frame, 'exportAs', 'fence.pdf');
    await fenceDownload;
    await waitForMessage(page, { type: 'error', of: 'save', id: 2 });
    expect(downloadNames(downloads)).toEqual([PROBE_NAME, 'fence.pdf']);
    expect((await errors(page)).map((m) => m.id)).toEqual([1, 2]);
  });

  await test.step('a host that reports a failed store: downloaded at once, also a stale save and an export', async () => {
    const failing = await context.newPage();
    // Default deadlines (10 s, 5 min): only the failure report can cause the download in time.
    const frame = await openDelivered(failing, { fail: '1' });
    const cases: { what: string; method: string; args: unknown[]; name: string }[] = [
      { what: 'a save', method: 'save', args: [], name: PROBE_NAME },
      // The host did not store the first save, so appending to the bytes as opened is still the document.
      { what: 'a save appended to the bytes as opened', method: 'save', args: [{ base: 'original' }], name: PROBE_NAME },
      // PdfCraft types every download application/pdf; for a Blob of that type Firefox would
      // replace the extension '.docx' with '.pdf'.
      { what: 'an export', method: 'exportAs', args: [], name: 'craftsuite-probe.docx' },
    ];
    for (const [i, { what, method, args, name }] of cases.entries()) {
      const download = failing.waitForEvent('download', { timeout: 8000 });
      await stub(frame, method, ...args);
      const d = await download;
      expect.soft(d.suggestedFilename(), `the name of ${what}`).toBe(name);
      expect.soft(await downloadBase64(d), `the bytes of ${what}`).toBe(await value(frame, `__stub.downloads[${i}].base64`));
      expect.soft(await waitForMessage(failing, { type: 'error', of: 'save', id: i + 1 }), `the error for ${what}`)
        .toMatchObject({ message: 'test: 507 Insufficient Storage' });
    }
    expect((await hostSaves(failing)).map((s) => [s.id, s.kind, s.openId])).toEqual([[1, 'document', 1], [2, 'document', 1], [3, 'export', null]]);
  });
});

test('inactive: at top level and under a foreign host Save stays an ordinary download', { tag: '@cross-browser' }, async ({ page, context }) => {
  await test.step('at top level the app is untouched', async () => {
    await page.goto(`${APP}/stub/?file=/files/${PROBE_NAME}`);
    await until(page, 'window.__stub && __stub.docs.length === 1');
    expect(await value(page, `({
      layer: 'craftsuiteLayer' in window,
      native: [EventTarget.prototype.addEventListener, URL.createObjectURL, URL.revokeObjectURL, window.open, HTMLElement.prototype.click]
        .every((f) => /\\[native code\\]/.test(Function.prototype.toString.call(f))),
      anchorClick: Object.hasOwn(HTMLAnchorElement.prototype, 'click'),
    })`)).toEqual({ layer: false, native: true, anchorClick: false });
    const download = page.waitForEvent('download');
    await stub(page.mainFrame(), 'save');
    const d = await download;
    expect(d.suggestedFilename()).toBe(PROBE_NAME);
    const bytes = Buffer.from(await downloadBase64(d), 'base64');
    expect(bytes.subarray(0, PROBE.length).equals(PROBE)).toBe(true);
    expect(bytes.toString('base64')).toBe(await value(page, '__stub.downloads[0].base64'));
  });

  await test.step('under a foreign host forged init and open do not reach the app, and nothing reaches the host', async () => {
    const foreign = await context.newPage();
    const frame = await openHost(foreign, { 'app-ack': '60000' }, FOREIGN);
    await until(frame, '__stub.started');
    await hostPost(foreign, { type: 'init' });
    await hostPost(foreign, { type: 'open', id: 9, name: 'forged.pdf' }, '%PDF-1.7 forged');
    await appSaw(frame, { type: 'open', id: 9, origin: FOREIGN });
    // A save the translator held back would come out only after the confirmation deadline of a
    // minute, so the download has to come within seconds.
    const download = foreign.waitForEvent('download', { timeout: 5000 });
    await stub(frame, 'download', 'report.pdf');
    const d = await download;
    expect(d.suggestedFilename()).toBe('report.pdf');
    expect(await downloadBase64(d)).toBe(await value(frame, '__stub.downloads[0].base64'));
    expect(await value(frame, '__stub.docs.length')).toBe(0);
    expect(await messages(foreign)).toEqual([]);
    expect(await hostSaves(foreign)).toEqual([]);
  });
});

test('load failures: each way the app can fail to load is reported to the host', { tag: '@cross-browser' }, async ({ context }) => {
  const failures: [string, RegExp][] = [
    ['noload', /^the app failed to load: .*stub could not load its wasm module$/],
    ['noload-import', /^the app failed to load: /],
    ['noload-script', /^the app failed to load: .*\/stub\/missing-loader\.js$/],
    ['noload-rejection', /^the app failed to load: .*stub could not instantiate its wasm module$/],
    ['noload-preload', /^the app failed to load: .*\/stub\/missing_bg\.wasm$/],
  ];
  const soft = expect.configure({ soft: true }); // each mode is reported, also after one failed
  for (const [mode, message] of failures) {
    await test.step(`mode ${mode}`, async () => {
      const page = await context.newPage();
      // The wasm download fails (Chromium and WebKit report a failed preload only for a network failure).
      await page.route(`${APP}/stub/missing_bg.wasm`, (route) => route.abort());
      await openHost(page, { 'app-mode': mode });
      await soft.poll(async () => (await errors(page)).map((m) => [m.of, m.message]), { message: `one error of startup (${mode})`, timeout: 15_000 })
        .toEqual([['startup', expect.stringMatching(message)]]);
      expect.soft((await messages(page)).map((m) => m.type), `no ready (${mode})`).not.toContain('ready');
      await page.close();
    });
  }
});

test('host settings: the language in the frame\'s fragment reaches the adapter before the app, and a reload keeps it', { tag: '@cross-browser' }, async ({ page, context }) => {
  // The test adapter 'shows' these languages and also makes the page report the one it applies as
  // the browser's (util.preferLanguages), which the stub notes as it starts, after the translator.
  const shows = { 'app-adapter': 'stub', 'app-language': 'en,pt-BR,zh-Hant', 'app-prefer': '1' };
  const calls = (frame: Frame) => value<{ tag: string | null; key: string | null; href: string; name: string }[]>(frame, 'window.__stubLanguage ?? []');
  const readies = () => value<{ language: string | null }[]>(page, '__host.readies');
  const frame = await openDelivered(page, { lang: 'pt-PT', ...shows });

  await test.step('pt-PT reaches the adapter as the app\'s pt-BR before the app runs; the address loses the fragment, the name keeps it', async () => {
    expect(await calls(frame)).toEqual([{ tag: 'pt-PT', key: 'pt-BR', href: expect.not.stringContaining('#'), name: 'craftsuite-layer:lang=pt-PT' }]);
    expect(await value(frame, '__stub.startHref')).not.toContain('#');
    expect(await value(frame, '__stub.startLanguages.slice(0, 2)')).toEqual(['pt-BR', 'pt-BR']);
    expect(await readies()).toEqual([expect.objectContaining({ language: 'pt-BR' })]);
  });

  await test.step('a reloaded frame has the language again, from its name', async () => {
    const token = await value<string>(frame, '__stub.token');
    await frame.evaluate(() => { setTimeout(() => location.reload()); });
    await until(frame, `window.__stub && __stub.token !== ${JSON.stringify(token)} && __stub.docs.length === 1`);
    expect(await calls(frame)).toEqual([expect.objectContaining({ tag: 'pt-PT', key: 'pt-BR' })]);
    await expect.poll(readies).toEqual([expect.objectContaining({ language: 'pt-BR' }), expect.objectContaining({ language: 'pt-BR' })]);
  });

  await test.step('only a language tag gets through; anything else clears the setting', async () => {
    const cases: [string, string | null, string | null][] = [
      ['zh-TW', 'zh-TW', 'zh-Hant'], // the same language and script
      ['de-AT', 'de-AT', null], // a language the app does not show: the app decides
      ['de"><img src=x>', null, null],
      ['de_DE', null, null],
      ['und', null, null],
      ['x'.repeat(36), null, null],
      ['', null, null],
    ];
    for (const [i, [lang, tag, key]] of cases.entries()) {
      const token = await value<string>(frame, '__stub.token');
      const src = `${APP}/stub/?${new URLSearchParams({ adapter: 'stub', language: 'en,pt-BR,zh-Hant', n: String(i) })}#craftsuite-layer:lang=${encodeURIComponent(lang)}`;
      await page.evaluate((url) => { (document.getElementById('app') as HTMLIFrameElement).src = url; }, src);
      await until(frame, `window.__stub && __stub.token !== ${JSON.stringify(token)} && window.__stubLanguage`);
      expect.soft(await calls(frame), JSON.stringify(lang)).toEqual([{ tag, key, href: expect.not.stringContaining('#'), name: tag ? `craftsuite-layer:lang=${tag}` : '' }]);
    }
  });

  await test.step('at top level the translator is inactive and the fragment stays', async () => {
    const top = await context.newPage();
    await top.goto(`${APP}/stub/?adapter=stub&language=en,de#craftsuite-layer:lang=de`);
    await until(top, 'window.__stub && __stub.started');
    expect(await value(top, '({ hash: location.hash, calls: window.__stubLanguage ?? null })')).toEqual({ hash: '#craftsuite-layer:lang=de', calls: null });
    await top.close();
  });

  expect(await errors(page)).toEqual([]);
});

// === Chromium only ===================================================================================

test('names: opens and downloads get plain, short basenames; an opened file stays the document', async ({ page }) => {
  // The test adapter: PdfCraft's rule, plus an identity read from the bytes ('/StubId (...)'), and
  // saves of a file opened as foreign.pdf are copies.
  const frame = await openDelivered(page, { 'app-adapter': 'stub', 'app-identity': '1', 'app-copy': 'foreign.pdf' });

  await test.step('opens sent together are each delivered under a plain basename, with the type the host sent', async () => {
    const text = (id: number) => `%PDF-1.7 open #${id}`;
    const opens: { id: number; name: string; mime?: string; clean: string }[] = [
      { id: 2, name: '../../Team/Budget 2026.pdf', mime: 'application/pdf', clean: 'Budget 2026.pdf' },
      { id: 3, name: 'C:\\Users\\someone\\scan.pdf', clean: 'scan.pdf' }, // no type
      { id: 4, name: '..', mime: 'application/pdf', clean: 'download' },
    ];
    for (const { id, name, mime } of opens) await hostPost(page, { type: 'open', id, name, ...(mime ? { mime } : {}) }, text(id));
    for (const { id, name, clean } of opens) {
      expect.soft(await waitForMessage(page, { type: 'delivered', id }), `delivered ${JSON.stringify(name)}`).toMatchObject({ name: clean, size: text(id).length });
    }
    await until(frame, '__stub.docs.length === 4');
    // The app reads dropped files asynchronously: in any order.
    const byName = (a: Opened, b: Opened) => a.name.localeCompare(b.name);
    expect((await opened(frame)).slice(1).sort(byName)).toEqual(opens.map(({ id, mime, clean }) => ({
      name: clean, type: mime ?? '', size: text(id).length, base64: b64(text(id)),
    })).sort(byName));
  });

  await test.step('a file opened under a cleaned name is the document under that name; each opened file is its own', async () => {
    const opens = [
      { id: 5, name: ' .hidden.pdf', clean: 'hidden.pdf' },
      { id: 6, name: 'dir/name.pdf', clean: 'name.pdf' },
      { id: 7, name: 'second.pdf', clean: 'second.pdf' },
    ];
    for (const { id, name, clean } of opens) {
      await hostPost(page, { type: 'open', id, name, mime: 'application/pdf' }, `%PDF-1.7 open #${id}`);
      expect.soft(await waitForMessage(page, { type: 'delivered', id }), `delivered ${JSON.stringify(name)}`).toMatchObject({ name: clean });
      await until(frame, `__stub.docs.length === ${id}`);
      // The app saves under the name it was given, the cleaned one.
      expect.soft(await hostSave(page, frame, 'save'), `saved ${JSON.stringify(name)}`).toMatchObject({ kind: 'document', openId: id, name: clean });
    }
  });

  await test.step('reopening a name replaces the document', async () => {
    const id = (await value<number>(frame, '__stub.docs.length')) + 1;
    await hostPost(page, { type: 'open', id, name: PROBE_NAME, mime: 'application/pdf' }, '%PDF-1.7 a newer probe');
    await until(frame, `__stub.docs.length === ${id}`);
    const save = await hostSave(page, frame, 'save');
    expect(save).toMatchObject({ kind: 'document', openId: id, name: PROBE_NAME });
    expect(save.bytes.toString('latin1')).toMatch(/^%PDF-1\.7 a newer probe\n/);
  });

  await test.step('a save under the opened name whose identity differs from the stored one is an export', async () => {
    const id = (await value<number>(frame, '__stub.docs.length')) + 1;
    await hostPost(page, { type: 'open', id, name: 'Untitled-1.pdf', mime: 'application/pdf' }, '%PDF-1.7 /StubId (first)\n');
    await until(frame, `__stub.docs.length === ${id}`);
    expect(await hostSave(page, frame, 'save')).toMatchObject({ kind: 'document', openId: id, name: 'Untitled-1.pdf' });
    // It extends the stored bytes, so the adapter's classify alone would take it for the document.
    expect(await hostSave(page, frame, 'save', { stubId: 'second' })).toMatchObject({ kind: 'export', openId: null, name: 'Untitled-1.pdf' });
    expect(await hostSave(page, frame, 'save', { base: 'original', stubId: 'first' }), 'the same identity, but a stale base')
      .toMatchObject({ kind: 'export', openId: null });
  });

  await test.step('copies: every save of a file that must stay as it is follows the first, which starts the lineage', async () => {
    const id = (await value<number>(frame, '__stub.docs.length')) + 1;
    await hostPost(page, { type: 'open', id, name: 'foreign.pdf', mime: 'application/pdf' }, '%PDF-1.7 from another program\n');
    await until(frame, `__stub.docs.length === ${id}`);
    const first = await hostSave(page, frame, 'save');
    // It follows its own id: no export the host stored, so the host makes it a new file.
    expect(first).toMatchObject({ kind: 'document', openId: id, follows: first.id, name: 'foreign.pdf' });
    // Also a full rewrite: the adapter, not the bytes, says it is the document.
    for (const args of [[], [{ full: true }]]) {
      expect(await hostSave(page, frame, 'save', ...args)).toMatchObject({ kind: 'document', openId: id, follows: first.id, name: 'foreign.pdf' });
    }
    // Another download under the name is still not the document.
    expect(await hostSave(page, frame, 'download', 'foreign.pdf')).toMatchObject({ kind: 'export', follows: null });
    // A new open of the name starts a new copy.
    await hostPost(page, { type: 'open', id: id + 1, name: 'foreign.pdf', mime: 'application/pdf' }, '%PDF-1.7 from another program, again\n');
    await until(frame, `__stub.docs.length === ${id + 1}`);
    const again = await hostSave(page, frame, 'save');
    expect(again).toMatchObject({ kind: 'document', openId: id + 1, follows: again.id });
    expect(await hostSave(page, frame, 'save')).toMatchObject({ kind: 'document', openId: id + 1, follows: again.id });
  });

  await test.step('download names are reduced to a plain basename', async () => {
    const cases: [string, string][] = [
      ['../../Team/Budget 2026.pdf', 'Budget 2026.pdf'],
      ['..\\..\\Windows\\System32\\evil.pdf', 'evil.pdf'],
      ['/etc/passwd', 'passwd'],
      ['mixed/sep\\arators.pdf', 'arators.pdf'],
      ['tab\there\u0000nul\u001fus\u007fdel\nline.pdf', 'tabherenulusdelline.pdf'],
      ['  . .hidden.pdf . . ', 'hidden.pdf'],
      ['...', 'download'],
      ['', 'download'],
      ['folder/', 'download'],
      [' .\u0007. ', 'download'],
      ['Naïve résumé – 2026 (draft).pdf', 'Naïve résumé – 2026 (draft).pdf'],
      // Direction overrides and invisible format characters, which could hide the real extension.
      ['invoice‮fdp.exe', 'invoice_fdp.exe'],
      ['a؜b​c‎d‏e‪f‫g‬h‭i⁠j⁤k⁦l⁩m﻿n.pdf', 'a_b_c_d_e_f_g_h_i_j_k_l_m_n.pdf'],
      ['zero‌width‍joiners.pdf', 'zero‌width‍joiners.pdf'], // needed by some scripts: kept
    ];
    const saves = await downloadAll(page, frame, cases.map(([raw]) => raw));
    for (const [i, [raw, name]] of cases.entries()) {
      expect.soft(saves[i], `the save of ${JSON.stringify(raw)}`).toMatchObject({ name, kind: 'export' });
    }
  });

  await test.step('long names keep a short extension and whole characters, and end in neither a dot nor a space', async () => {
    const emoji = '\u{1F600}'; // two UTF-16 units
    const cases: [string, string][] = [
      ['k'.repeat(196) + '.pdf', 'k'.repeat(196) + '.pdf'], // 200 units: unchanged
      ['x'.repeat(250) + '.pdf', 'x'.repeat(196) + '.pdf'],
      ['g'.repeat(200) + '.' + 'e'.repeat(15), 'g'.repeat(184) + '.' + 'e'.repeat(15)], // 16 units: an extension
      ['h'.repeat(200) + '.' + 'e'.repeat(16), 'h'.repeat(200)], // 17: not one
      ['a'.repeat(199) + '. ' + 'z'.repeat(20), 'a'.repeat(199)], // the cut ends in a dot
      ['b'.repeat(198) + '  ' + 'z'.repeat(20), 'b'.repeat(198)], // ... in spaces
      ['c'.repeat(199) + emoji + 'z'.repeat(20), 'c'.repeat(199)], // ... inside a character
      ['d'.repeat(195) + emoji + 'z'.repeat(10) + '.pdf', 'd'.repeat(195) + '.pdf'],
      [' . ' + 'm'.repeat(250), 'm'.repeat(197)], // leading dots and spaces go after the cut
    ];
    const names = (await downloadAll(page, frame, cases.map(([raw]) => raw))).map((s) => s.name);
    for (const [i, [raw, name]] of cases.entries()) {
      const what = `the name for ${raw.length} units starting ${JSON.stringify(raw.slice(0, 4))}`;
      expect.soft(names[i], what).toBe(name);
      expect.soft(names[i].length, what).toBeLessThanOrEqual(200);
      expect.soft(names[i], what).not.toMatch(/[\s.]$/);
      expect.soft(names[i], what).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/); // lone surrogate
    }
  });
});

test('app frame: hook gone, API sealed, links in new windows, a reload starts over', async ({ page, context }) => {
  const frame = await openDelivered(page);

  await test.step('the addEventListener hook is gone once the app registered its drop target', async () => {
    expect(await hookRemoved(frame)).toBe(true);
  });

  await test.step('the layer API takes one adapter only and cannot be replaced', async () => {
    expect(await value(frame, `(() => {
      const layer = window.craftsuiteLayer;
      const second = layer.register({ app: 'other', classify: () => 'document' });
      try { window.craftsuiteLayer = null; } catch { /* read-only: throws in strict mode */ }
      return { second, frozen: Object.isFrozen(layer), same: window.craftsuiteLayer === layer };
    })()`)).toEqual({ second: false, frozen: true, same: true });
  });

  await test.step('window.open into the frame or above it opens a new window without a handle on the frame; javascript: and data: open nothing', async () => {
    const token = await value(frame, '__stub.token');
    const popups: Page[] = [];
    const onPopup = (p: Page) => popups.push(p);
    context.on('page', onPopup);
    for (const [i, target] of ['_self', '_top', '_parent', '_SELF', '_blank'].entries()) {
      const url = `${FOREIGN}/config.js?link=${i}`;
      const popup = context.waitForEvent('page');
      await stub(frame, 'openWindow', url, target);
      const win = await popup;
      await win.waitForLoadState();
      expect(win.url(), target).toBe(url);
      // A page of another origin gets no opener, so it cannot reach the frame or navigate the host's page.
      expect(await value(win, 'window.opener === null'), `${target}: no opener`).toBe(true);
      await win.close();
    }
    // Links can come from documents: script and data URLs must not open on the app's origin.
    for (const url of ['javascript:opener.__stub.reached = true', 'data:text/html,<script>opener.__stub.reached = true</script>']) {
      expect(await stub(frame, 'openWindow', url, '_blank'), url.slice(0, 11)).toBe('none');
    }
    const last = context.waitForEvent('page'); // a window opened above would come before this one
    await stub(frame, 'openWindow', `${FOREIGN}/config.js?link=last`, '_blank');
    await (await last).close();
    context.off('page', onPopup);
    expect(popups, 'the windows that opened').toHaveLength(6);
    expect(await value(frame, '__stub.reached')).toBeUndefined();
    expect(frame.isDetached()).toBe(false);
    expect(frame.url().startsWith(`${APP}/stub/`)).toBe(true);
    expect(await value(frame, '__stub.token')).toBe(token);
    expect(page.url().startsWith(`${HOST}/`)).toBe(true);
  });

  await test.step('a reloaded app frame says hello again, gets its file again and saves it as the document', async () => {
    const token = await value<string>(frame, '__stub.token');
    const before = (await messages(page)).length;
    // From a task of its own, so that the evaluation returns before the document goes away.
    await frame.evaluate(() => { setTimeout(() => location.reload()); });
    await until(frame, `window.__stub && __stub.token !== ${JSON.stringify(token)} && __stub.docs.length === 1`);
    await until(page, "__raw.filter((m) => m.type === 'delivered').length === 2");
    const after = (await messages(page)).slice(before);
    expect(after[0]).toMatchObject({ type: 'hello' });
    expect(after.filter((m) => m.type !== 'hello').map((m) => [m.type, m.id ?? null])).toEqual([['ready', null], ['delivered', 1]]);
    expect(await opened(frame)).toEqual([expect.objectContaining({ name: PROBE_NAME, base64: PROBE.toString('base64') })]);
    expect(await hostSave(page, frame, 'save')).toMatchObject({ id: 1, kind: 'document', openId: 1 });
  });

  expect(await errors(page)).toEqual([]);
});

test('host answers: a stored save is done, a stored export can be continued; any other result, or none in time, falls back once', async ({ page }) => {
  const downloads = collectDownloads(page);
  await page.clock.install();
  // The host confirms each save and leaves the results to the test. The result deadline is the
  // shorter one, so a confirmation that did not replace the confirmation deadline shows.
  const frame = await openDelivered(page, { result: '0', 'app-ack': '15000', 'app-result': '10000' });
  await stopClock(page);

  await test.step('a result that arrives after the host reopened the name does not replace the newer file', async () => {
    const earlier = await confirmedSave(page, frame, 'save');
    await hostPost(page, { type: 'open', id: 2, name: PROBE_NAME, mime: 'application/pdf' }, '%PDF-1.7 reopened');
    await waitForMessage(page, { type: 'delivered', id: 2 });
    await page.clock.runFor(100); // the app reads a dropped file in an animation frame
    await until(frame, '__stub.docs.length === 2');
    await hostPost(page, { type: 'save-result', id: earlier.id, ok: true }); // the save of the earlier file, stored late
    await appSaw(frame, { type: 'save-result', id: earlier.id });
    const reopened = await confirmedSave(page, frame, 'save'); // the reopened file, edited
    expect([earlier, reopened].map((s) => [s.id, s.kind, s.openId, s.name])).toEqual([[1, 'document', 1, PROBE_NAME], [2, 'document', 2, PROBE_NAME]]);
    expect(Buffer.from(reopened.base64 ?? '', 'base64').toString('latin1')).toMatch(/^%PDF-1\.7 reopened\n/);
    await hostPost(page, { type: 'save-result', id: reopened.id, ok: true });
    await appSaw(frame, { type: 'save-result', id: reopened.id });
  });

  await test.step('a stored save is done: nothing falls back after the deadlines', async () => {
    await page.clock.runFor(20_000); // past the confirmation and the result deadline of both saves
    await fence(page, frame);
    expect(await errors(page)).toEqual([]);
    expect(downloadNames(downloads)).toEqual([]);
  });

  await test.step('a result that is anything but ok: true falls back at once', async () => {
    const results: Record<string, unknown>[] = [{ ok: false }, { ok: 1 }, { ok: 'true' }, {}];
    for (const [i, result] of results.entries()) {
      const save = await confirmedSave(page, frame, 'download', `result-${i + 1}.pdf`);
      await hostPost(page, { type: 'save-result', id: save.id, ...result });
      await appSaw(frame, { type: 'save-result', id: save.id });
      await fence(page, frame);
      expect.soft((await errors(page)).filter((m) => m.id === save.id), JSON.stringify(result))
        .toEqual([expect.objectContaining({ of: 'save', message: 'the host could not store it' })]);
    }
    await expect.poll(() => downloadNames(downloads), { message: 'a download for each', timeout: 10_000 })
      .toEqual(results.map((_, i) => `result-${i + 1}.pdf`));
  });

  await test.step('a confirmation replaces the confirmation deadline: without a result the save falls back at the result deadline', async () => {
    const n = downloads.length;
    const save = await confirmedSave(page, frame, 'save');
    await page.clock.runFor(11_000); // past the result deadline (10 s), before the confirmation deadline (15 s)
    await fence(page, frame);
    expect((await errors(page)).filter((m) => m.id === save.id)).toEqual([expect.objectContaining({ message: 'no result from the host' })]);
    await expect.poll(() => downloadNames(downloads.slice(n)), 'the fallback download').toEqual([PROBE_NAME]);
  });

  await test.step('every confirmation restarts the result deadline', async () => {
    const before = (await errors(page)).length;
    const save = await confirmedSave(page, frame, 'save');
    await page.clock.runFor(8000);
    await hostPost(page, { type: 'save-received', id: save.id }); // the host is still busy
    await appSaw(frame, { type: 'save-received', id: save.id }, 2);
    await page.clock.runFor(8000); // 16 s after the first confirmation (past both its deadlines), 8 s after the second
    await fence(page, frame);
    expect((await errors(page)).slice(before)).toEqual([]);
    const n = downloads.length;
    await page.clock.runFor(3000); // 11 s after the second confirmation
    await fence(page, frame);
    expect((await errors(page)).slice(before)).toEqual([expect.objectContaining({ id: save.id, message: 'no result from the host' })]);
    await expect.poll(() => downloadNames(downloads.slice(n)), 'the fallback download').toEqual([PROBE_NAME]);
  });

  await test.step('a failure report falls back once, also past the result deadline', async () => {
    const before = { errors: (await errors(page)).length, downloads: downloads.length };
    const failed = await confirmedSave(page, frame, 'save');
    const download = page.waitForEvent('download');
    await hostPost(page, { type: 'save-result', id: failed.id, ok: false, error: 'disk full' });
    await download;
    await waitForMessage(page, { type: 'error', of: 'save', id: failed.id });
    await page.clock.runFor(11_000); // past the result deadline of the failed save
    // A second failing save as a fence: a duplicate of the first would have been reported before it.
    const fenceDownload = page.waitForEvent('download', { predicate: (d) => d.suggestedFilename() === 'fence.pdf' });
    const fenceSave = await confirmedSave(page, frame, 'exportAs', 'fence.pdf');
    await hostPost(page, { type: 'save-result', id: fenceSave.id, ok: false, error: 'disk full' });
    await fenceDownload;
    await waitForMessage(page, { type: 'error', of: 'save', id: fenceSave.id });
    expect(downloadNames(downloads.slice(before.downloads))).toEqual([PROBE_NAME, 'fence.pdf']);
    expect((await errors(page)).slice(before.errors).map((m) => [m.id, m.message])).toEqual([[failed.id, 'disk full'], [fenceSave.id, 'disk full']]);
  });

  await test.step('after a rewritten save the host stored, the next save follows it as the document; after one it did not store, not', async () => {
    const before = { errors: (await errors(page)).length, downloads: downloads.length };
    const result = async (save: HostSave, ok: boolean) => {
      await hostPost(page, { type: 'save-result', id: save.id, ok });
      await appSaw(frame, { type: 'save-result', id: save.id });
    };
    // Save writes the file anew (as PdfCraft does after redaction): it does not extend the stored
    // bytes. The PdfCraft adapter has continuesExports.
    const anew = await confirmedSave(page, frame, 'save', { full: true });
    expect(anew).toMatchObject({ kind: 'export', openId: null, follows: null, name: PROBE_NAME });
    await result(anew, true);
    // The app goes on from the bytes it wrote: the document of the open, in the file that export went to.
    const next = await confirmedSave(page, frame, 'save');
    expect(next).toMatchObject({ kind: 'document', openId: 2, follows: anew.id, name: PROBE_NAME });
    await result(next, true);
    // One lineage: every later save that extends the export continues it, so the opened file's
    // own reference stays what it was.
    const after = await confirmedSave(page, frame, 'save');
    expect(after).toMatchObject({ kind: 'document', openId: 2, follows: anew.id });
    await result(after, true);

    const lost = await confirmedSave(page, frame, 'save', { full: true });
    expect(lost).toMatchObject({ kind: 'export', follows: null });
    const download = page.waitForEvent('download');
    await result(lost, false);
    await download;
    expect(await confirmedSave(page, frame, 'save'), 'a save that extends the export the host did not store')
      .toMatchObject({ kind: 'export', openId: null, follows: null, name: PROBE_NAME });
    expect((await errors(page)).slice(before.errors).map((m) => m.id)).toEqual([lost.id]);
    expect(downloadNames(downloads.slice(before.downloads))).toEqual([PROBE_NAME]);
  });
});

test('protocol: before the handshake only init counts; hello stops after 30 tries; one ready; only valid opens', async ({ page, context }) => {
  await page.clock.install();
  await stopClock(page); // before the page loads: hellos and the app's start come only in runFor()
  const frame = await openBareHost(page);
  await waitForMessage(page, { type: 'hello' });
  await page.clock.runFor(100); // the stub's simulated wasm load (50 ms), then the start event
  await until(frame, '__stub.started');
  const hellos = async () => (await messages(page)).filter((m) => m.type === 'hello').length;
  const others = async () => (await messages(page)).filter((m) => m.type !== 'hello').map((m) => [m.type, m.id ?? null]);

  await test.step('before the handshake Save is an ordinary download at once', async () => {
    // A save the translator held back would never come out: the clock stands still.
    const download = page.waitForEvent('download', { timeout: 5000 });
    await stub(frame, 'download', 'report.pdf');
    const d = await download;
    expect(d.suggestedFilename()).toBe('report.pdf');
    expect(await downloadBase64(d)).toBe(await value(frame, '__stub.downloads[0].base64'));
    await fence(page, frame);
    expect(await others()).toEqual([]);
  });

  await test.step('before the handshake window.open is left alone', async () => {
    // A link to a fragment: in this frame it changes nothing but the location's hash.
    expect(await stub(frame, 'openWindow', '#before', '_self')).toBe('same');
    expect(await value(frame, 'location.hash')).toBe('#before');
  });

  await test.step('before the handshake an open and an init of another protocol or version are ignored; hello goes on', async () => {
    await page.evaluate(() => {
      const w = window as TestWindow;
      w.send({ type: 'open', id: 7, name: 'early.pdf' }, '%PDF-1.7 early');
      for (const version of [2, 0, '1', undefined]) w.send({ type: 'init', version });
      w.send({ type: 'init', protocol: 'craftsuite-layer-next' });
    });
    await appSaw(frame, { type: 'init' }, 5);
    await fence(page, frame);
    expect(await others()).toEqual([]);
    const said = await hellos();
    await page.clock.runFor(1000);
    await fence(page, frame);
    expect(await hellos(), 'hello again, as no init was accepted').toBe(said + 1);
  });

  await test.step('hello stops after 30 tries', async () => {
    await page.clock.runFor(40_000); // one hello at the start, then one per second
    await fence(page, frame);
    expect(await hellos()).toBe(30);
    await page.clock.runFor(60_000);
    await fence(page, frame);
    expect(await hellos()).toBe(30);
  });

  await test.step('an init after that is still taken; ready comes once, also when init comes again', async () => {
    await page.evaluate(() => (window as TestWindow).send({ type: 'init' }));
    await appSaw(frame, { type: 'init' }, 6);
    await fence(page, frame); // the drop target is there, so ready went out as the init was handled
    expect(await others(), 'ready for an init after the last hello').toEqual([['ready', null]]);
    await page.evaluate(() => {
      const w = window as TestWindow;
      w.send({ type: 'init' });
      w.send({ type: 'init' });
    });
    await appSaw(frame, { type: 'init' }, 8);
    await fence(page, frame);
    expect(await others(), 'no second ready').toEqual([['ready', null]]);
  });

  await test.step('only well-formed opens of this protocol version are delivered', async () => {
    await page.evaluate(() => {
      const w = window as TestWindow;
      w.send({ type: 'open', id: 5, name: 'v2.pdf', version: 2 }, '%PDF-1.7 v2');
      w.send({ type: 'open', id: 8, name: 'no-data.pdf' });
      w.send({ type: 'open', id: 9, name: 'string-data.pdf', data: '%PDF-1.7 as a string' });
      w.send({ type: 'open', id: 10 }, '%PDF-1.7 without a name');
      w.send({ type: 'open', id: 11, name: 'valid.pdf' }, '%PDF-1.7 valid');
    });
    await waitForMessage(page, { type: 'delivered', id: 11 });
    await page.clock.runFor(100); // the app reads a dropped file in an animation frame
    await until(frame, '__stub.docs.length === 1');
    expect((await opened(frame)).map((d) => d.name)).toEqual(['valid.pdf']);
    expect(await others()).toEqual([['ready', null], ['delivered', 11]]);
  });

  await test.step('after the handshake window.open into the frame opens a new window and the frame stays', async () => {
    const popup = context.waitForEvent('page');
    expect(await stub(frame, 'openWindow', '#after', '_self')).toBe('new');
    await (await popup).close();
    expect(await value(frame, 'location.hash')).toBe('#before');
  });
});

test('startup: a missing drop target, a hang and an early failure are reported; a late drop target recovers', async ({ page, context }) => {
  await test.step('no drop target in time is reported, and so is every open; one registered later clears the failure', async () => {
    const frame = await openHost(page, { 'app-mode': 'late', 'app-late': '600000', 'app-drop': '300' });
    expect((await waitForMessage(page, { type: 'error', of: 'startup' })).message).toBe('the app registered no drop target');
    expect(await hookRemoved(frame)).toBe(false); // still waiting for a drop target
    await hostPost(page, { type: 'open', id: 9, name: 'late.pdf' }, '%PDF-1.7 late');
    expect(await waitForMessage(page, { type: 'error', of: 'open', id: 9 })).toMatchObject({ message: 'the app registered no drop target' });
    expect((await messages(page)).map((m) => m.type)).not.toContain('ready');
    await stub(frame, 'attach');
    await waitForMessage(page, { type: 'ready' });
    await waitForMessage(page, { type: 'delivered', id: 1 });
    await until(frame, '__stub.docs.length === 1');
    expect(await opened(frame)).toEqual([expect.objectContaining({ name: PROBE_NAME, base64: PROBE.toString('base64') })]);
    expect(await hookRemoved(frame)).toBe(true);
    expect((await errors(page)).map((m) => [m.of, m.id ?? null])).toEqual([['startup', null], ['open', 9]]);
  });

  const fine: [string, string][] = [
    ['gap', 'a drop target registered shortly after the start event is fine'],
    ['docdrop', 'an app that takes drops on the document gets them through the canvas'],
  ];
  for (const [mode, title] of fine) {
    await test.step(title, async () => {
      const other = await context.newPage();
      const frame = await openDelivered(other, { 'app-mode': mode });
      expect((await opened(frame))[0].base64).toBe(PROBE.toString('base64'));
      expect(await value(frame, '__stub.drops')).toEqual([expect.objectContaining({ files: 1, inside: true })]);
      expect(await errors(other)).toEqual([]);
      await other.close();
    });
  }

  await test.step('an app that never starts is reported after the startup timeout', async () => {
    const other = await context.newPage();
    await openHost(other, { 'app-mode': 'hang', 'app-startup': '800' });
    expect((await waitForMessage(other, { type: 'error', of: 'startup' })).message).toBe('the app did not start in time');
    await other.close();
  });

  await test.step('a failure before init is reported when init comes', async () => {
    const other = await context.newPage();
    const frame = await openBareHost(other, { mode: 'noload' });
    await waitForMessage(other, { type: 'hello' });
    await until(frame, '__stub.failures.length > 0');
    await other.evaluate(() => (window as TestWindow).send({ type: 'init' }));
    expect((await waitForMessage(other, { type: 'error', of: 'startup' })).message).toMatch(/stub could not load its wasm module$/);
    expect((await messages(other)).map((m) => m.type)).not.toContain('ready');
    await other.close();
  });

  await test.step('an open sent before the app started waits for its drop target', async () => {
    const other = await context.newPage();
    const frame = await openBareHost(other, { mode: 'manual' });
    await waitForMessage(other, { type: 'hello' });
    await other.evaluate(() => {
      const w = window as TestWindow;
      w.send({ type: 'init' });
      w.send({ type: 'open', id: 1, name: 'early.pdf' }, '%PDF-1.7 sent early');
    });
    await appSaw(frame, { type: 'open', id: 1 });
    expect(await value(frame, '__stub.started')).toBe(false);
    await stub(frame, 'start');
    await waitForMessage(other, { type: 'delivered', id: 1 });
    expect((await messages(other)).filter((m) => m.type !== 'hello').map((m) => m.type)).toEqual(['ready', 'delivered']);
    await until(frame, '__stub.docs.length === 1');
    expect(await opened(frame)).toEqual([expect.objectContaining({ name: 'early.pdf', base64: b64('%PDF-1.7 sent early') })]);
    await other.close();
  });
});

test('hosting attributes: allowed origins and the app version', async ({ page, context }) => {
  await test.step('the allowlist takes origins in any case and with a trailing slash; an invalid entry does not stop valid ones', async () => {
    const rejected = [
      'null', '*', `${HOST}/path`, `${HOST}/?x=1`, `${HOST}/#top`, 'http://example.org', 'http://127.0.0.1.example.org',
      'http://localhost.example.org', 'https://user:pass@example.org', 'ftp://example.org', 'file:///tmp/', 'not-a-url',
    ];
    const accepted = ['HTTPS://EXAMPLE.ORG/', `http://LOCALHOST:${base + 9}`, `http://[::1]:${base + 9}`, `HTTP://127.0.0.1:${base}/`];
    // Valid entries between and after invalid ones; an invalid one last, so its warning means all were read.
    const list = [...rejected.slice(0, 6), accepted[0], ...rejected.slice(6, 9), ...accepted.slice(1), ...rejected.slice(9)];
    const prefix = '[craftsuite-layer] ignoring allowed origin ';
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.text().startsWith(prefix)) warnings.push(m.text().slice(prefix.length)); });
    // Also without data-app-version: the test server leaves the attribute out for an empty version.
    await openDelivered(page, { 'app-allowed': list.join(', '), 'app-version': '' });
    await expect.poll(() => warnings.at(-1)).toBe(rejected.at(-1));
    expect(warnings).toEqual(list.filter((entry) => rejected.includes(entry)));
  });

  await test.step('ready has appVersion null when the hosting names no version', async () => {
    const ready = (await messages(page)).filter((m) => m.type === 'ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ appVersion: null });
  });

  const inactive: [string, string][] = [['an empty allowlist', ''], ['only invalid allowlist entries', 'null * http://example.org']];
  for (const [title, allowed] of inactive) {
    await test.step(`with ${title} the translator stays inactive: Save is an ordinary download`, async () => {
      const other = await context.newPage();
      const frame = await openHost(other, { 'app-allowed': allowed, 'app-ack': '60000' });
      await until(frame, '__stub.started');
      await appSaw(frame, { type: 'init', fromParent: true });
      // A save the translator held back would come out only after a minute.
      const download = other.waitForEvent('download', { timeout: 5000 });
      await stub(frame, 'download', 'report.pdf');
      expect((await download).suggestedFilename()).toBe('report.pdf');
      expect(await messages(other)).toEqual([]);
      await other.close();
    });
  }
});

test('hosting attributes: anything but a positive, finite timeout means the default; a valid one wins', async ({ browser }) => {
  // The clock stands still, so each deadline is exact: no fallback 1 s before it (checked behind a
  // fence), the fallback 1 s after it. Each case gets a context, and so a clock, of its own.
  type Case = {
    attribute: string; deadline: number; error: Partial<Raw>;
    open: (page: Page) => Promise<Frame>; // with the clock stopped once it returns
    start: (page: Page, frame: Frame) => Promise<unknown>; // until the deadline runs
  };
  const delivered = (params: Record<string, string>) => async (page: Page) => {
    const frame = await openDelivered(page, params);
    await stopClock(page);
    return frame;
  };
  const stoppedBeforeLoad = (params: Record<string, string>) => async (page: Page) => {
    await stopClock(page); // the deadline runs from the app's load event or start
    return openHost(page, params);
  };
  const cases: Case[] = [
    ...['0', '-5', 'soon', ''].map((timeout): Case => ({
      attribute: `data-save-ack-timeout="${timeout}" means the default of 10 s`,
      deadline: 10_000,
      error: { of: 'save', id: 1, message: 'no confirmation from the host' },
      open: delivered({ ack: '0', 'app-ack': timeout }),
      start: async (page, frame) => {
        await stub(frame, 'save');
        await until(page, '__host.saves.length === 1'); // sent, so its deadline runs
      },
    })),
    {
      attribute: 'data-save-result-timeout="Infinity" means the default of 5 minutes',
      deadline: 300_000,
      error: { of: 'save', id: 1, message: 'no result from the host' },
      open: delivered({ result: '0', 'app-result': 'Infinity' }),
      start: async (_page, frame) => {
        await stub(frame, 'save');
        await appSaw(frame, { type: 'save-received', id: 1 });
      },
    },
    {
      attribute: 'data-startup-timeout="0" means the default of 60 s',
      deadline: 60_000,
      error: { of: 'startup', message: 'the app did not start in time' },
      open: stoppedBeforeLoad({ 'app-mode': 'hang', 'app-startup': '0' }),
      start: async (_page, frame) => {
        await until(frame, "document.readyState === 'complete'");
        await appSaw(frame, { type: 'init' });
      },
    },
    // The default is the adapter's dropTargetTimeout if it has one (the test adapter's adapter-drop);
    // a valid attribute wins over it.
    ...([
      ['-1', null, 3000, 'means the default of 3 s'],
      ['', '5000', 5000, "keeps the adapter's 5 s"],
      ['2000', '5000', 2000, "wins over the adapter's 5 s"],
    ] as const).map(([timeout, adapterDrop, deadline, meaning]): Case => ({
      attribute: `data-drop-target-timeout="${timeout}" ${meaning}`,
      deadline,
      error: { of: 'startup', message: 'the app registered no drop target' },
      open: stoppedBeforeLoad({
        'app-mode': 'nostart', 'app-drop': timeout, ...(adapterDrop ? { 'app-adapter': 'stub', 'app-adapter-drop': adapterDrop } : {}),
      }),
      start: async (page, frame) => {
        await appSaw(frame, { type: 'init' });
        await page.clock.runFor(100); // the stub's simulated wasm load (50 ms), then the start event
        await until(frame, '__stub.started');
      },
    })),
  ];
  for (const { attribute, deadline, error, open, start } of cases) {
    await test.step(attribute, async () => {
      const page = await pageOfItsOwn(browser);
      await page.clock.install();
      const frame = await open(page);
      await start(page, frame);
      await page.clock.runFor(deadline - 1000);
      await fence(page, frame);
      expect.soft(await errors(page), `${attribute}: nothing 1 s before the deadline`).toEqual([]);
      await page.clock.runFor(2000);
      await fence(page, frame);
      expect.soft(await errors(page), `${attribute}: the fallback 1 s after it`).toEqual([expect.objectContaining(error)]);
      await page.context().close();
    });
  }
});
