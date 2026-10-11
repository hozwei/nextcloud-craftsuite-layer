// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Nextcloud app's editor page with the real PdfCraft build: the file goes from Nextcloud into
// the app and every save comes back into Nextcloud, checked through WebDAV. Two tests:
//
//   save and export   Ctrl+S after an edit replaces the opened file and Nextcloud keeps a version;
//                     two saves right after each other both replace it; a reload of the app frame
//                     while saves are stored still ends with the last save in the file, and the
//                     reloaded app gets it; exports become new files next to it, a second export
//                     of the same name gets ' (2)'; after Sanitize, Save rewrites the file and it
//                     becomes a new file, which the next Save replaces (follows); nothing is
//                     downloaded; Close asks, and right after a save it waits for the save before
//                     it goes back to Files
//   conflict          a file changed elsewhere after it was opened is not overwritten: the save
//                     becomes '<name> (conflict <time>).pdf' and later saves follow it; leaving
//                     the page asks first; the page explains files it cannot open; a page that
//                     another site opened asks before it opens the file; without a usable ETag a
//                     save becomes a copy too
//
// Needs a Nextcloud with the app enabled and its pdfcraft_url set to the test server's /pdfcraft/,
// and NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_PASSWORD (docs/development.md). Each test works in a
// folder of its own.

import { readFileSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Frame, type Page } from '@playwright/test';
import { appFrames, press, runCommand, settle } from '../lib/craft-ui.ts';
import {
  appOpened, appView, editor, editUrl, login, nameLabel, newFolder, openEditor, status, trackDialogs, trackDownloads, trackWrites,
  type Folder,
} from '../lib/nextcloud.ts';

const PROBE = readFileSync(new URL('../fixtures/craftsuite-probe.pdf', import.meta.url));
const NAME = 'craftsuite-probe.pdf';
// The test server's app origin (tests/e2e/server/serve.mjs): another site than Nextcloud.
const CRAFT = `http://127.0.0.2:${Number(process.env.CRAFTSUITE_PORT_BASE || 8701) + 1}`;

test.setTimeout(300_000);

const folderWithProbe = (request: APIRequestContext): Promise<Folder> => newFolder(request, { [NAME]: PROBE });

async function editAndSave(page: Page, app: Frame) {
  await runCommand(page, app, 'Rotate pages clockwise');
  await press(page, app, 'Control+s');
}

// PdfCraft's Sanitize document… (pdfcraft.spec.ts has the source of the keys): Tab moves the
// focus to the dialog's first button, Sanitize. Its next Save rewrites the whole file.
async function sanitize(page: Page, app: Frame) {
  await runCommand(page, app, 'Sanitize document');
  await settle(appView(page), app);
  await page.keyboard.press('Tab');
  await appFrames(app, 3);
  await page.keyboard.press('Enter');
  await settle(appView(page), app);
}

// Writes of a file take a few seconds from now on (until unroute), as on a slow uplink.
const SLOW = `**/${encodeURIComponent(NAME)}`;
async function slowWrites(page: Page, name = NAME) {
  await page.route(`**/${encodeURIComponent(name)}`, async (route) => {
    if (route.request().method() === 'PUT') await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
}

// The saves the translator announces to the editor page from now on: how many started, and the
// sizes of those that arrived.
async function recordSaves(page: Page): Promise<() => Promise<{ started: number; sizes: number[] }>> {
  await page.evaluate(() => {
    const record = { started: 0, sizes: [] as number[] };
    (window as unknown as { saveRecord: typeof record }).saveRecord = record;
    window.addEventListener('message', (e: MessageEvent<{ type?: string; size?: number }>) => {
      if (e.data?.type === 'save-started') record.started++;
      if (e.data?.type === 'save') record.sizes.push(Number(e.data.size));
    });
  });
  return () => page.evaluate(() => (window as unknown as { saveRecord: { started: number; sizes: number[] } }).saveRecord);
}

// Whether `bytes` start with `prefix` and are longer: a later incremental save.
const extendsBytes = (bytes: Buffer, prefix: Buffer) => bytes.length > prefix.length && bytes.subarray(0, prefix.length).equals(prefix);

test('save and export: saves replace the opened file, exports become new files', async ({ page, request }) => {
  const folder = await folderWithProbe(request);
  const fileId = await folder.fileId(NAME);
  await login(page);
  const downloads = trackDownloads(page);
  let app = await openEditor(page, fileId);

  let stored: Buffer = PROBE;

  await test.step('Ctrl+S after an edit replaces the file, and Nextcloud keeps the old version', async () => {
    const versions = await folder.versions(fileId);
    await editAndSave(page, app);
    await expect.poll(async () => (await folder.get(NAME)).includes('/Rotate 90'), { message: 'the rotation reached Nextcloud', timeout: 30_000 }).toBe(true);
    const saved = await folder.get(NAME);
    expect(saved.subarray(0, PROBE.length).equals(PROBE), 'the save extends the opened file').toBe(true);
    await expect(status(page)).toHaveText(`Saved ${NAME}`);
    expect(await folder.versions(fileId), 'older versions of the file').toBeGreaterThan(versions);
    stored = saved;
  });

  await test.step('the next saves replace it again, also two right after each other', async () => {
    const saves = await recordSaves(page);
    const writes = trackWrites(page, NAME);
    await editAndSave(page, app);
    // At once, but in a later frame of the app (two presses in one frame make one save): the page
    // must not treat its own first write as a change elsewhere.
    await expect.poll(async () => (await saves()).started, { message: 'the first save started' }).toBe(1);
    await press(page, app, 'Control+s');
    await expect.poll(() => writes.length, { message: 'both saves were written', timeout: 30_000 }).toBe(2);
    expect(writes.every((s) => s >= 200 && s < 300), `no 412: the second save used the ETag of the first (${writes.join(', ')})`).toBe(true);
    await expect(status(page)).toHaveText(`Saved ${NAME}`, { timeout: 30_000 });
    const saved = await folder.get(NAME);
    expect(saved.includes('/Rotate 180'), 'the second rotation reached Nextcloud').toBe(true);
    expect(saved.subarray(0, stored.length).equals(stored), 'the later saves extend the first').toBe(true);
    expect((await folder.names()).filter((n) => n.includes('(conflict ')), 'conflict copies').toEqual([]);
    stored = saved;
  });

  await test.step('a reload of the app frame while saves are stored: the file holds the last one, and the app gets it', async () => {
    const saves = await recordSaves(page);
    await slowWrites(page);
    await editAndSave(page, app);
    await editAndSave(page, app);
    await expect.poll(async () => (await saves()).sizes.length, { message: 'both saves reached the editor page', timeout: 30_000 }).toBe(2);
    await app.evaluate(() => location.reload());
    const [, last] = (await saves()).sizes;
    await expect.poll(async () => (await folder.get(NAME)).length, { message: 'the file holds the last save', timeout: 60_000 }).toBe(last);
    app = await appOpened(page);
    await page.unroute(SLOW);
    const saved = await folder.get(NAME);
    expect(extendsBytes(saved, stored), 'the saves extend the earlier ones').toBe(true);
    expect(await folder.names(), 'no new file: both saves replaced the opened one').toEqual([NAME]);
    stored = saved;

    // The reloaded app got the last save: its next save extends it, so it replaces the file too.
    await editAndSave(page, app);
    await expect.poll(async () => extendsBytes(await folder.get(NAME), stored), { message: 'the next save extends the last one', timeout: 30_000 }).toBe(true);
    await expect(status(page)).toHaveText(`Saved ${NAME}`);
    expect(await folder.names()).toEqual([NAME]);
    stored = await folder.get(NAME);
  });

  await test.step('exports become new files next to it and never overwrite', async () => {
    await runCommand(page, app, 'Export to Word');
    await expect.poll(() => folder.names(), { timeout: 30_000 }).toContain('craftsuite-probe.docx');
    await runCommand(page, app, 'Export to Word');
    await expect.poll(() => folder.names(), { timeout: 30_000 }).toEqual(['craftsuite-probe (2).docx', 'craftsuite-probe.docx', NAME].sort());
    expect((await folder.get('craftsuite-probe.docx')).subarray(0, 2).toString('latin1'), 'a Word file').toBe('PK');
    expect((await folder.get(NAME)).equals(stored), 'the document unchanged').toBe(true);
  });

  const REWRITTEN = 'craftsuite-probe (2).pdf';

  await test.step('after Sanitize, Save rewrites the file: a new file, which the next Save replaces', async () => {
    await sanitize(page, app);
    await press(page, app, 'Control+s');
    await expect(status(page)).toHaveText(`Saved as a new file: ${REWRITTEN}`, { timeout: 30_000 });
    const rewritten = await folder.get(REWRITTEN);
    await editAndSave(page, app);
    await expect(status(page)).toHaveText(`Saved ${REWRITTEN}, where your previous save went. Later saves go there.`, { timeout: 30_000 });
    await expect(nameLabel(page), 'the name label shows the file saves go to').toHaveText(REWRITTEN);
    expect(extendsBytes(await folder.get(REWRITTEN), rewritten), 'the save continues the rewritten file').toBe(true);
    expect((await folder.get(NAME)).equals(stored), 'the opened file keeps its last save').toBe(true);
    expect(await folder.names()).toEqual(['craftsuite-probe (2).docx', REWRITTEN, 'craftsuite-probe.docx', NAME].sort());
    stored = await folder.get(REWRITTEN);
  });

  await test.step('Close asks; right after a save it waits for the save, then goes back to Files', async () => {
    const close = page.locator('.craftsuite-editor__close');
    page.once('dialog', (d) => void d.dismiss());
    await close.click();
    await expect(appView(page), 'Cancel in the question keeps the page and the app').toBeVisible();

    await slowWrites(page, REWRITTEN);
    const dialogs = trackDialogs(page);
    await editAndSave(page, app);
    await expect(status(page)).toHaveText(`Saving ${NAME} …`);
    await close.click();
    await expect(status(page)).toHaveText('Waiting for the save …');
    await page.waitForURL(/\/apps\/files\//);
    expect(dialogs, 'dialogs on Close').toEqual(['confirm']);
    expect(extendsBytes(await folder.get(REWRITTEN), stored), 'the save reached Nextcloud before the page was left').toBe(true);
  });

  expect(downloads, 'browser downloads').toEqual([]);
});

test('conflict: a file changed elsewhere is not overwritten, later saves follow the copy', async ({ page, request }) => {
  const folder = await folderWithProbe(request);
  const fileId = await folder.fileId(NAME);
  await login(page);
  const downloads = trackDownloads(page);
  let app = await openEditor(page, fileId);

  const elsewhere = Buffer.concat([PROBE, Buffer.from('% changed elsewhere\n')]);
  let copy = '';

  await test.step('a save after a change elsewhere becomes a conflict copy', async () => {
    await folder.put(NAME, elsewhere);
    await editAndSave(page, app);
    await expect.poll(async () => (await folder.names()).filter((n) => n.includes('(conflict ')), { timeout: 30_000 }).toHaveLength(1);
    copy = (await folder.names()).find((n) => n.includes('(conflict '))!;
    expect(copy).toMatch(/^craftsuite-probe \(conflict \d{4}-\d{2}-\d{2} \d{2}-\d{2}\)\.pdf$/);
    expect((await folder.get(NAME)).equals(elsewhere), 'the other change stays in the file').toBe(true);
    expect((await folder.get(copy)).includes('/Rotate 90'), 'the edit is in the copy').toBe(true);
    await expect(status(page)).toContainText('changed elsewhere');
  });

  await test.step('later saves go to the copy', async () => {
    await editAndSave(page, app);
    await expect.poll(async () => (await folder.get(copy)).includes('/Rotate 180'), { timeout: 30_000 }).toBe(true);
    expect(await folder.names()).toEqual([copy, NAME].sort());
    expect((await folder.get(NAME)).equals(elsewhere)).toBe(true);
  });

  const dialogs = trackDialogs(page);

  await test.step('leaving asks first; the page explains what it cannot open', async () => {
    await folder.put('notes.txt', Buffer.from('not a PDF\n'));
    let res = await page.goto(editUrl(await folder.fileId('notes.txt')));
    expect(res?.status()).toBe(400);
    await expect(page.locator('.craftsuite-editor__message')).toHaveText('No Craft app opens this type of file.');
    expect(dialogs, 'dialogs when the editor is left').toEqual(['beforeunload']);
    res = await page.goto(editUrl(999999999));
    expect(res?.status()).toBe(404);
    await expect(page.locator('.craftsuite-editor__message')).toHaveText('The file does not exist or you cannot read it.');
    // No window the app opens gets a handle on the page, error pages included.
    expect(res?.headers()['cross-origin-opener-policy'], 'Cross-Origin-Opener-Policy').toBe('same-origin');
  });

  await test.step('a page that another site opened asks before it opens the file', async () => {
    // The Craft origin (or any other site) opening the editor page itself, with the user's session.
    await page.goto(`${CRAFT}/`);
    await page.evaluate((url) => location.assign(url), editUrl(fileId));
    await expect(editor(page), 'a question instead of the editor').toHaveAttribute('data-state', 'confirm');
    await expect(page.locator('.craftsuite-editor__message')).toContainText(`Open ${NAME} in PdfCraft?`);
    await expect(appView(page), 'no app frame before the user confirms').toHaveCount(0);
    await page.locator('.craftsuite-editor__open').click();
    app = await appOpened(page);
    expect(page.url(), 'the button\'s request token is gone from the address').not.toContain('requesttoken');
  });

  await test.step('without a usable ETag a save does not replace the file: it becomes a copy', async () => {
    // A proxy that drops ETag and OC-ETag, and a server that does not report getetag.
    await page.route(`**/${encodeURIComponent(NAME)}`, async (route) => {
      const request = route.request();
      if (request.method() === 'PROPFIND' && request.headers().depth === '0') return route.fulfill({ status: 404 });
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers.etag;
      delete headers['oc-etag'];
      await route.fulfill({ response, headers });
    });
    app = await openEditor(page, fileId);
    await editAndSave(page, app);
    await expect(status(page)).toHaveText(/^Could not check whether the file changed meanwhile, so your version is in craftsuite-probe \(conflict [\d -]+\)( \(2\))?\.pdf\. Later saves go there\.$/, { timeout: 30_000 });
    await page.unroute(`**/${encodeURIComponent(NAME)}`);
    const copies = (await folder.names()).filter((n) => n.includes('(conflict '));
    expect(copies, 'a second copy').toHaveLength(2);
    expect((await folder.get(NAME)).equals(elsewhere), 'the file unchanged').toBe(true);
  });

  expect(downloads, 'browser downloads').toEqual([]);
});
