// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Nextcloud app around the editor page, in a real Nextcloud:
//
//   files entry   Files offers "Open in PdfCraft" for a PDF (not for a text file) and the entry
//                 opens the editor, which gets the file into PdfCraft; a PNG has "Open in
//                 PhotoCraft" in its menu only (a click opens the Viewer), while a click on a PSD,
//                 which no other app opens, opens PhotoCraft; both open the editor at once, and
//                 it removes the request token from the address
//   link          a link to a PSD that another site opens in a popup (/f/<id>: Files then opens
//                 the file by itself, without a click of the user) gets the question first
//   default       with DesignCraft configured, a click on a .designcraft file opens DesignCraft
//                 (Nextcloud knows no MIME type for it: matching is by extension); a click on a
//                 .dxf, which VectorCraft and CADCraft both open by default, opens CADCraft while
//                 both are configured and VectorCraft once CADCraft's address is empty
//   settings      the admin page refuses unusable addresses (http, a Nextcloud host, a host a
//                 Content-Security-Policy cannot name, an address with a ?query) with a reason per
//                 field and saves nothing; usable ones are saved, also after Nextcloud's password
//                 dialog
//   shares        for a second user, no administrator: a file shared without permission to
//                 download has no entry and the editor page refuses it; a read-only share opens,
//                 and a save becomes a new file in the user's folder, the original unchanged; the
//                 settings cannot be saved
//   german        with ?forceLanguage=de the entry, the editor and the settings page are German
//
// Same environment as nextcloud.spec.ts (NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_PASSWORD: an
// administrator; pdfcraft_url and photocraft_url point to the test server), and NEXTCLOUD_USER2,
// NEXTCLOUD_PASSWORD2 for the second user. The settings test changes designcraft_url,
// vectorcraft_url and cadcraft_url and then saves the addresses of all apps as it found them again,
// which the other specs need.

import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { press, runCommand } from '../lib/craft-ui.ts';
import {
  ADMIN, appView, editor, editUrl, Folder, login, NC, newFolder, openEditor, shareWith, status, trackDialogs, USER2,
} from '../lib/nextcloud.ts';

const PROBE = readFileSync(new URL('../fixtures/craftsuite-probe.pdf', import.meta.url));
const PNG = readFileSync(new URL('../fixtures/photocraft/probe.png', import.meta.url));
const PSD = readFileSync(new URL('../fixtures/photocraft/probe.psd', import.meta.url));
const DXF = readFileSync(new URL('../fixtures/cadcraft/craftsuite-probe.dxf', import.meta.url));
// The test server's app origin (tests/e2e/server/serve.mjs): 127.0.0.2:<base+1>.
const CRAFT = `http://127.0.0.2:${Number(process.env.CRAFTSUITE_PORT_BASE || 8701) + 1}`;
// Every app on the settings page, in its order (CraftApps::APPS): the settings test restores them all.
const APPS = ['pdfcraft', 'photocraft', 'vectorcraft', 'designcraft', 'wordcraft', 'gridcraft', 'deckcraft', 'cadcraft', 'lightcraft', 'filmcraft', 'effectcraft'];
const SETTINGS = `${NC}/index.php/settings/admin/craftsuite_layer`;

test.setTimeout(180_000);

const openFolder = (page: Page, folder: Folder) => page.goto(`${NC}/index.php/apps/files/files?dir=${encodeURIComponent('/' + folder.name)}`);

const row = (page: Page, name: string) => page.locator(`[data-cy-files-list-row-name="${name}"]`);

// The entries of a file's action menu. Read in the page: Playwright's own queries over the whole
// Files page ran into "Maximum call stack size exceeded" in Nextcloud 34.
async function menu(page: Page, name: string): Promise<string[]> {
  await row(page, name).locator('[data-cy-files-list-row-actions] button.action-item__menutoggle').click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('[role="menuitem"]').length)).toBeGreaterThan(0);
  const items = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim()).filter(Boolean));
  return items;
}

// A click of the user (trusted, with user activation), as the entry needs to open the editor at once.
async function clickMenuItem(page: Page, text: string) {
  const at = await page.evaluate((t) => {
    const box = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((e) => e.offsetParent !== null && e.innerText.trim() === t)?.getBoundingClientRect();
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  }, text);
  expect(at, `the menu entry ${text}`).not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
}

// Runs action with the trace stopped (what it recorded so far is dropped). Files' entry adds the
// request token only with user activation, and Playwright gives a page user activation whenever
// it runs a script there: its trace snapshots do so in new pages too, until tracing stops.
async function untraced<T>(page: Page, action: () => Promise<T>): Promise<T> {
  const tracing = page.context().tracing;
  const stopped = await tracing.stop().then(() => true, () => false);
  try {
    return await action();
  } finally {
    if (stopped) await tracing.start({ screenshots: true, snapshots: true });
  }
}

// Saves the settings form. With a password: Nextcloud's own password dialog asks for it first.
async function saveSettings(page: Page, values: Record<string, string>, password?: string): Promise<number> {
  for (const [app, url] of Object.entries(values)) await page.locator(`#craftsuite-layer-${app}`).fill(url);
  const response = page.waitForResponse((r) => r.url().endsWith('/apps/craftsuite_layer/settings'));
  await page.locator('#craftsuite-layer-admin button[type=submit]').click();
  if (password !== undefined) {
    const field = page.locator('input[type=password]').last();
    await field.fill(password);
    await field.press('Enter');
  }
  return (await response).status();
}

// The addresses as the settings test found them. Saved again after it in a context of its own,
// so that also a test that timed out (and lost its page) leaves them as the other specs need them.
let found: Record<string, string> | null = null;

test.afterEach(async ({ browser }) => {
  if (!found) return;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await login(page);
    await page.goto(SETTINGS);
    expect(await saveSettings(page, found), 'the addresses found saved again').toBe(200);
    for (const app of APPS) await expect(page.locator(`#craftsuite-layer-${app}`)).toHaveValue(found[app]);
    found = null;
  } finally {
    await context.close();
  }
});

test('files entry: Open in PdfCraft opens the editor; a click opens PhotoCraft for a PSD, not for a PNG', async ({ page, request }) => {
  const folder = await newFolder(request, { 'probe.pdf': PROBE, 'notes.txt': Buffer.from('hello'), 'picture.png': PNG, 'picture.psd': PSD });
  await login(page);
  trackDialogs(page); // leaving an editor page asks once the app has the file
  await openFolder(page, folder);
  await row(page, 'probe.pdf').waitFor();

  expect(await menu(page, 'probe.pdf'), 'the PDF has the entry').toContain('Open in PdfCraft');
  await page.keyboard.press('Escape');
  expect(await menu(page, 'notes.txt'), 'a text file has none').not.toContain('Open in PdfCraft');
  await page.keyboard.press('Escape');

  // A PNG opens in the Viewer as before: PhotoCraft only in the menu. A PSD, which no other app
  // opens, opens in PhotoCraft on a click (the default action).
  expect(await menu(page, 'picture.png'), 'the PNG has the entry').toContain('Open in PhotoCraft');
  await page.keyboard.press('Escape');
  await row(page, 'picture.png').locator('[data-cy-files-list-row-name-link]').click();
  // Files writes the address in more than one form (/apps/files/files/<id>?...&openfile=true or
  // /apps/files/?dir=...&openfile=true); what counts is that Files opened the file itself.
  await expect(page, 'a click on the PNG opens the Viewer').toHaveURL(/\/apps\/files\/[^#]*[?&]openfile=true/);
  await page.keyboard.press('Escape');
  await row(page, 'picture.psd').locator('[data-cy-files-list-row-name-link]').click();
  // The request token Files added (a click of the user) opens the editor at once; the page then
  // removes it from the address.
  await page.waitForURL(/\/apps\/craftsuite_layer\/edit\/\d+\?app=photocraft$/);
  await expect(appView(page), 'the editor at once, no question').toHaveCount(1);

  await openFolder(page, folder);
  await row(page, 'probe.pdf').waitFor();
  await menu(page, 'probe.pdf');
  await clickMenuItem(page, 'Open in PdfCraft');
  await page.waitForURL(/\/apps\/craftsuite_layer\/edit\/\d+\?app=pdfcraft$/);
  await expect(page.locator('.craftsuite-editor'), 'PdfCraft has the file').toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
});

test('link: a PSD that another site opens with a link asks before it opens', async ({ page, request }) => {
  const folder = await newFolder(request, { 'picture.psd': PSD });
  await login(page);
  // /f/<id> redirects to Files with ?openfile=true, and Files runs the click action itself.
  const link = `${NC}/index.php/f/${await folder.fileId('picture.psd')}`;
  await page.goto(`${CRAFT}/`);
  await page.evaluate((url) => {
    const button = document.createElement('button');
    button.id = 'craftsuite-e2e-open';
    button.textContent = 'Open';
    button.addEventListener('click', () => window.open(url));
    document.body.prepend(button);
  }, link);
  // Nothing is done in the popup until the editor page has answered (see untraced).
  const { popup, editorUrl } = await untraced(page, async () => {
    const answered = page.context().waitForEvent('response', { predicate: (r) => r.url().includes('/apps/craftsuite_layer/edit/'), timeout: 60_000 });
    const opened = page.waitForEvent('popup');
    await page.locator('#craftsuite-e2e-open').click();
    return { popup: await opened, editorUrl: (await answered).url() };
  });
  expect(editorUrl, 'Files opened the editor page without the request token').not.toContain('requesttoken');
  await expect(editor(popup), 'a question instead of the editor').toHaveAttribute('data-state', 'confirm');
  await expect(appView(popup), 'no app frame').toHaveCount(0);
});

test('default and settings: unusable addresses are refused, a .designcraft and a .dxf open on a click', async ({ page, request }) => {
  const folder = await newFolder(request, { 'layout.designcraft': Buffer.from('{}'), 'drawing.dxf': DXF });
  await login(page);
  trackDialogs(page); // nothing may keep the page from going to the folder at the end
  await page.goto(SETTINGS);
  const hint = (app: string) => page.locator(`#craftsuite-layer-${app}-hint`);
  const fields = await page.locator('#craftsuite-layer-admin input[name]').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).name));
  expect(fields, 'the apps on the settings page (APPS restores them all)').toEqual(APPS);
  const values: Record<string, string> = {};
  for (const app of APPS) values[app] = await page.locator(`#craftsuite-layer-${app}`).inputValue();
  found = values;
  const at = (app: string) => `${CRAFT}/${app}/`;

  // A click on a file in Files, and the editor page it opens.
  const click = async (name: string, app: string) => {
    await test.step(`a click on ${name} opens ${app}`, async () => {
      await openFolder(page, folder);
      await row(page, name).locator('[data-cy-files-list-row-name-link]').click();
      await page.waitForURL(new RegExp(`/apps/craftsuite_layer/edit/\\d+\\?app=${app}$`));
    });
  };

  // A host with characters a Content-Security-Policy cannot carry is refused too, and so is a
  // query: Craft apps read it as switches (PdfCraft's ?host=parent drops saves under another origin).
  const vectorcraft = `${new URL(NC).protocol}//${new URL(NC).hostname}:1/vectorcraft/`;
  expect(await saveSettings(page, {
    designcraft: 'http://craft.example.com/designcraft/', vectorcraft, photocraft: 'https://craft.example.com;x/photocraft/',
    pdfcraft: 'https://craft.example.com/pdfcraft/?host=parent',
  }), 'refused').toBe(400);
  await expect(hint('designcraft')).toHaveText(/https:\/\//);
  await expect(hint('vectorcraft')).toHaveText(/another host name than Nextcloud/);
  await expect(hint('photocraft')).toHaveText(/host name is not valid/);
  await expect(hint('pdfcraft')).toHaveText('Use an https:// address without user name, password, ?query or #fragment (http:// only on localhost).');
  await expect(page.locator('.craftsuite-admin__status')).toHaveText(/Nothing was saved/);

  await test.step('with CADCraft\'s address empty, VectorCraft takes the click on a .dxf', async () => {
    expect(await saveSettings(page, { pdfcraft: values.pdfcraft, photocraft: values.photocraft, designcraft: at('designcraft'), vectorcraft: at('vectorcraft'), cadcraft: '' }), 'saved').toBe(200);
    await expect(page.locator('.craftsuite-admin__status')).toHaveText('Saved');
    await click('drawing.dxf', 'vectorcraft');
  });

  await test.step('a confirmation that is due: Nextcloud\'s password dialog asks first', async () => {
    await page.goto(SETTINGS);
    // As if the last login or confirmation were long ago (Nextcloud's own client-side record).
    await page.evaluate(() => { (window as unknown as { nc_lastLogin: number }).nc_lastLogin = 0; });
    expect(await saveSettings(page, { cadcraft: at('cadcraft') }, ADMIN.password), 'saved').toBe(200);
    await expect(page.locator('.craftsuite-admin__status')).toHaveText('Saved');
  });

  // CADCraft is preferred for a .dxf when both are configured (CraftApps::PREFERRED).
  await click('drawing.dxf', 'cadcraft');
  await click('layout.designcraft', 'designcraft');
});

test('shares: no download permission, no Craft app; a read-only file is saved as a new one', async ({ page, request, playwright }) => {
  expect(USER2.user, 'NEXTCLOUD_USER2 and NEXTCLOUD_PASSWORD2: a second user, no administrator').not.toBe('');
  // As the administrator: a folder shared without permission to download (its recipient may
  // move a shared folder, not a file shared that way), and a file shared read-only. Both go into
  // a folder of the second user's own, where saves can create files.
  const stamp = Date.now();
  const hidden = new Folder(request, `craftsuite-e2e no-download ${stamp}`);
  await hidden.create();
  await hidden.put('probe.pdf', PROBE);
  const owner = await newFolder(request, { 'read-only.pdf': PROBE });
  // WebDAV as the second user, without the administrator's session cookies.
  const asUser2 = await playwright.request.newContext();
  const mine = new Folder(asUser2, `craftsuite-e2e shares ${stamp}`, USER2);
  await mine.create();
  await mine.moveIn(await shareWith(request, `/${hidden.name}`, USER2, false), 'no-download');
  await mine.moveIn(await shareWith(request, `/${owner.name}/read-only.pdf`, USER2, true), 'read-only.pdf');
  const shared = new Folder(asUser2, `${mine.name}/no-download`, USER2);
  await login(page, USER2);
  trackDialogs(page);

  await test.step('without download permission: no entry in Files, and the editor page refuses it', async () => {
    await openFolder(page, mine);
    await row(page, 'read-only.pdf').waitFor();
    expect(await menu(page, 'read-only.pdf'), 'the read-only file (download allowed)').toContain('Open in PdfCraft');
    await page.keyboard.press('Escape');
    await openFolder(page, shared);
    await row(page, 'probe.pdf').waitFor();
    expect(await menu(page, 'probe.pdf'), 'a file shared without download').not.toContain('Open in PdfCraft');
    await page.keyboard.press('Escape');
    const res = await page.goto(editUrl(await shared.fileId('probe.pdf'), 'pdfcraft'));
    expect(res?.status()).toBe(403);
    await expect(page.locator('.craftsuite-editor__message')).toHaveText('This file is shared without permission to download it, so it cannot be opened in a Craft app.');
    await expect(appView(page)).toHaveCount(0);
  });

  await test.step('read-only: a save becomes a new file next to it, the original stays', async () => {
    const app = await openEditor(page, await mine.fileId('read-only.pdf'), 'pdfcraft');
    await runCommand(page, app, 'Rotate pages clockwise');
    await press(page, app, 'Control+s');
    await expect(status(page)).toHaveText('You may not change the original, so your version is in read-only (2).pdf. Later saves go there.', { timeout: 60_000 });
    expect(await mine.names(), 'files in the user\'s folder').toEqual(['read-only (2).pdf', 'read-only.pdf']);
    expect((await mine.get('read-only (2).pdf')).includes('/Rotate 90'), 'the edit is in the new file').toBe(true);
    expect((await owner.get('read-only.pdf')).equals(PROBE), 'the original unchanged').toBe(true);
  });

  await test.step('only administrators save the addresses', async () => {
    const answer = await page.evaluate(async (url) => (await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', requesttoken: document.head.dataset.requesttoken ?? '' },
      body: JSON.stringify({ urls: { pdfcraft: 'https://craft.example.org/pdfcraft/' } }),
    })).status, `${NC}/index.php/apps/craftsuite_layer/settings`);
    expect(answer, 'POST /apps/craftsuite_layer/settings as a user').toBe(403);
  });

  await asUser2.dispose();
});

test('german: the entry, the editor and the settings page are translated', async ({ page, request }) => {
  const folder = await newFolder(request, { 'probe.pdf': PROBE });
  await login(page);
  await page.goto(`${NC}/index.php/apps/files/files?dir=${encodeURIComponent('/' + folder.name)}&forceLanguage=de`);
  await row(page, 'probe.pdf').waitFor();
  expect(await menu(page, 'probe.pdf')).toContain('In PdfCraft öffnen');
  await page.keyboard.press('Escape');

  await page.goto(`${editUrl(await folder.fileId('probe.pdf'))}?forceLanguage=de`);
  await expect(page.locator('.craftsuite-editor__close')).toHaveText('Schließen');
  await expect(page.locator('.craftsuite-editor__status')).toHaveText(/In PdfCraft geöffnet/, { timeout: 120_000 });

  await page.goto(`${SETTINGS}?forceLanguage=de`);
  await expect(page.locator('#craftsuite-layer-admin h2')).toHaveText('Adressen der Craft-Apps');
});
