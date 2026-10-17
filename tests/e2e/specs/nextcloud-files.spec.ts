// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Nextcloud app around the editor page, in a real Nextcloud:
//
//   files entry   Files offers "Open in PdfCraft" for a PDF (not for a text file) and the entry
//                 opens the editor, which gets the file into PdfCraft; a PNG has "Open in
//                 PhotoCraft" in its menu only (a click opens the Viewer), while a click on a PSD,
//                 which no other app opens, opens PhotoCraft; both open the editor at once, and
//                 it removes the request token from the address; a PSD and a .pcraft (stored with
//                 the type the app registered) show PhotoCraft's icon, a PNG and a PDF Nextcloud's
//   link          a link to a PSD that another site opens in a popup (/f/<id>: Files then opens
//                 the file by itself, without a click of the user) gets the question first
//   default       with DesignCraft configured, a click on a .designcraft file opens DesignCraft
//                 (Nextcloud knows no MIME type for it: matching is by extension); a click on a
//                 .dxf, which VectorCraft and CADCraft both open by default, opens CADCraft while
//                 both are configured and VectorCraft once CADCraft's address is empty
//   settings      the admin page refuses unusable addresses (http, a Nextcloud host, a host a
//                 Content-Security-Policy cannot name, an address with a ?query, also as the address
//                 for all apps) with a reason per field and saves nothing; usable ones are saved, also
//                 after Nextcloud's password dialog; an app without an address of its own is under
//                 the address for all apps, and an app switched off has no entry and no editor; the apps that can start in a chosen language have a choice of it ('user'
//                 or one of theirs), the others none; a language an app does not have is refused,
//                 and the editor frames the app with the user's language ('user' and
//                 ?forceLanguage=de: '#craftsuite-layer:lang=de'); a .dxf shows the icon of the
//                 app that opens it on a click
//   default app   with WordCraft and PdfCraft made the default app, a click on a .docx opens
//                 WordCraft instead of an office app's hidden default action (as Euro-Office and
//                 ONLYOFFICE register theirs; this one is the test's own, and like them writes
//                 ?openfile=true when it runs as the default), which then has an entry in the
//                 file's menu that opens it without leaving Files; a click on a PDF opens PdfCraft
//                 instead of the Viewer, while the Viewer's View still shows the PDF; a PNG still
//                 opens in the Viewer; the settings page says per app what a click opens
//   new files     the "+ New" menu of Files has an entry for each Craft app's own format, and for
//                 WordCraft's .docx only once it is the default app; an entry makes the file from
//                 the app's blank (assets/; WordCraft's with the time it was made) and Files opens
//                 it in the app: a PSD in PhotoCraft, a .designcraft in DesignCraft (with the time
//                 it was made), a .deckcraft in DeckCraft (the same), a .fcproj named otherwise in
//                 FilmCraft (with that name), a .scraftz in SoundCraft (typed and with SoundCraft's
//                 icon), a .docx in WordCraft (with the time it was made);
//                 Back from the editor returns to the folder
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
import { strFromU8, unzipSync } from 'fflate';
import { press, runCommand } from '../lib/craft-ui.ts';
import {
  ADMIN, appView, editor, editUrl, Folder, login, NC, newFolder, openEditor, shareWith, status, trackDialogs, USER2,
} from '../lib/nextcloud.ts';

const PROBE = readFileSync(new URL('../fixtures/craftsuite-probe.pdf', import.meta.url));
const PNG = readFileSync(new URL('../fixtures/photocraft/probe.png', import.meta.url));
const PSD = readFileSync(new URL('../fixtures/photocraft/probe.psd', import.meta.url));
const DXF = readFileSync(new URL('../fixtures/cadcraft/craftsuite-probe.dxf', import.meta.url));
const DOCX = readFileSync(new URL('../fixtures/wordcraft/craftsuite-probe.docx', import.meta.url));
// The blank documents of the "+ New" entries (craftsuite_layer/blanks.mjs).
const BLANK = (name: string) => readFileSync(new URL(`../../../craftsuite_layer/assets/${name}`, import.meta.url));
// The test server's app origin (tests/e2e/server/serve.mjs): 127.0.0.2:<base+1>.
const CRAFT = `http://127.0.0.2:${Number(process.env.CRAFTSUITE_PORT_BASE || 8701) + 1}`;
// Every app on the settings page, in its order (apps.json, which npm run apps:check compares with
// CraftApps::APPS): the settings test restores them all.
const APPS = Object.keys((JSON.parse(readFileSync(new URL('../../../apps.json', import.meta.url), 'utf8')) as { apps: object }).apps);
// The apps the settings let start in a chosen language (CraftApps::APPS 'languages').
const LANGUAGE_APPS = ['pdfcraft', 'photocraft', 'vectorcraft', 'gridcraft', 'cadcraft', 'lightcraft', 'filmcraft', 'effectcraft'];
// The apps that can be made the default app for all their types (CraftApps::sharedExtensions()).
const DEFAULT_APPS = ['pdfcraft', 'photocraft', 'vectorcraft', 'wordcraft', 'gridcraft', 'deckcraft', 'lightcraft'];
const SETTINGS = `${NC}/index.php/settings/admin/craftsuite_layer`;

test.setTimeout(180_000);

const openFolder = (page: Page, folder: Folder) => page.goto(`${NC}/index.php/apps/files/files?dir=${encodeURIComponent('/' + folder.name)}`);

const row = (page: Page, name: string) => page.locator(`[data-cy-files-list-row-name="${name}"]`);

// Where Nextcloud's icon of a MIME type is for the page's user: Files shows a file without a
// preview with /core/mimeicon, which redirects to the icon (lib/Service/MimeIcons.php).
async function iconOf(page: Page, mime: string): Promise<string> {
  const res = await page.request.get(`${NC}/index.php/core/mimeicon?mime=${encodeURIComponent(mime)}`, { maxRedirects: 0 });
  expect(res.status(), `the icon of ${mime}`).toBe(303);
  return res.headers().location ?? '';
}
const CRAFT_ICON = (app: string) => new RegExp(`/craftsuite_layer/img/types/${app}\\.(svg|png)\\?v=`);

// The entries of a file's action menu. Read in the page: Playwright's own queries over the whole
// Files page ran into "Maximum call stack size exceeded" in Nextcloud 34.
async function menu(page: Page, name: string): Promise<string[]> {
  await row(page, name).locator('[data-cy-files-list-row-actions] button.action-item__menutoggle').click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('[role="menuitem"]').length)).toBeGreaterThan(0);
  const items = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim()).filter(Boolean));
  return items;
}

// The entries of the "+ New" menu of Files, read in the page like menu().
async function newMenu(page: Page): Promise<string[]> {
  // The folder's header has it, and an empty folder a second one: the first is the header's.
  await page.locator('[data-cy-upload-picker] button.action-item__menutoggle').first().click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('[role="menuitem"]').length)).toBeGreaterThan(0);
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim()).filter(Boolean));
}

// "+ New" > entry, with the name Files proposes (or another one typed instead), and the editor
// page Files then opens. True if the editor page asked first (see below): its Open button then
// added an entry to the tab's history.
async function createNew(page: Page, entry: string, name: string, app: string, typed?: string): Promise<boolean> {
  await clickMenuItem(page, entry);
  const input = page.locator('[data-cy-files-new-node-dialog-input]');
  await expect(input, 'the name Files proposes').toHaveValue(name);
  if (typed) await input.fill(typed);
  await page.locator('[data-cy-files-new-node-dialog-submit]').click();
  await page.waitForURL(new RegExp(`/apps/craftsuite_layer/edit/\\d+\\?app=${app}$`));
  // Files opens the new file with the user activation of the click on Create, which lasts a few
  // seconds: when making the file took longer (a busy test server), the editor page asks first, as
  // it does for a link, and opens the file once the user confirms.
  const root = page.locator('.craftsuite-editor');
  await root.waitFor();
  const asked = await root.getAttribute('data-state') === 'confirm';
  if (asked) {
    test.info().annotations.push({ type: 'note', description: `${app}: the editor page asked first, the click's user activation had run out` });
    await page.locator('.craftsuite-editor__open').click();
  }
  await expect(root, `${app} has the new file`).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
  return asked;
}

// Back from an editor page that createNew() opened, to the folder: where the editor page asked
// first (createNew() returned true), its question is a step of the tab's history before it.
async function backToFolder(page: Page, asked: boolean) {
  if (asked) await page.goBack();
  await page.goBack();
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

// Saves the settings form: addresses, languages the apps start in, which apps are the default app,
// and the address for all apps and which apps are used (ticked). With a password: Nextcloud's own
// password dialog asks for it first.
async function saveSettings(
  page: Page, values: Record<string, string>, password?: string, languages: Record<string, string> = {}, defaults: Record<string, boolean> = {},
  { base, uses = {} }: { base?: string; uses?: Record<string, boolean> } = {},
): Promise<number> {
  if (base !== undefined) await page.locator('#craftsuite-layer-base').fill(base);
  for (const [app, on] of Object.entries(uses)) await page.locator(`#craftsuite-layer-${app}-use`).setChecked(on);
  for (const [app, url] of Object.entries(values)) await page.locator(`#craftsuite-layer-${app}`).fill(url);
  for (const [app, language] of Object.entries(languages)) await page.locator(`#craftsuite-layer-${app}-language`).selectOption(language);
  for (const [app, on] of Object.entries(defaults)) await page.locator(`#craftsuite-layer-${app}-default`).setChecked(on);
  const response = page.waitForResponse((r) => r.url().endsWith('/apps/craftsuite_layer/settings'));
  await page.locator('#craftsuite-layer-admin button[type=submit]').click();
  if (password !== undefined) {
    const field = page.locator('input[type=password]').last();
    await field.fill(password);
    await field.press('Enter');
  }
  return (await response).status();
}

// The addresses, languages and default apps as a settings test found them. Saved again after it in a
// context of its own, so that also a test that timed out (and lost its page) leaves them as the
// other specs need them.
let found: Record<string, string> | null = null;
let foundLanguages: Record<string, string> = {};
let foundDefaults: Record<string, boolean> = {};
let foundBase = '';
let foundUses: Record<string, boolean> = {};

// Notes the settings as found, for the afterEach hook.
async function noteSettings(page: Page): Promise<Record<string, string>> {
  expect(found, 'the settings an earlier test changed were restored').toBeNull();
  const fields = await page.locator('#craftsuite-layer-admin input[name]').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).name));
  expect(fields, 'the apps on the settings page (APPS restores them all)').toEqual(APPS);
  const values: Record<string, string> = {};
  for (const app of APPS) values[app] = await page.locator(`#craftsuite-layer-${app}`).inputValue();
  found = values;
  foundBase = await page.locator('#craftsuite-layer-base').inputValue();
  for (const app of APPS) foundUses[app] = await page.locator(`#craftsuite-layer-${app}-use`).isChecked();
  const languageFields = await page.locator('#craftsuite-layer-admin select[data-app]').evaluateAll((selects) => selects.map((s) => (s as HTMLSelectElement).dataset.app));
  expect(languageFields, 'the apps with a choice of the language they start in').toEqual(LANGUAGE_APPS);
  for (const app of LANGUAGE_APPS) foundLanguages[app] = await page.locator(`#craftsuite-layer-${app}-language`).inputValue();
  const defaultFields = await page.locator('#craftsuite-layer-admin input[type=checkbox][data-app]').evaluateAll((checks) => checks.map((c) => (c as HTMLInputElement).dataset.app));
  expect(defaultFields, 'the apps that can be made the default app').toEqual(DEFAULT_APPS);
  for (const app of DEFAULT_APPS) foundDefaults[app] = await page.locator(`#craftsuite-layer-${app}-default`).isChecked();
  return values;
}

test.afterEach(async ({ browser }) => {
  if (!found) return;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await login(page);
    await page.goto(SETTINGS);
    expect(await saveSettings(page, found, undefined, foundLanguages, foundDefaults, { base: foundBase, uses: foundUses }), 'the settings found saved again').toBe(200);
    for (const app of APPS) await expect(page.locator(`#craftsuite-layer-${app}`)).toHaveValue(found[app]);
    found = null;
    foundLanguages = {};
    foundDefaults = {};
    foundBase = '';
    foundUses = {};
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

  await test.step('icons: a PSD and a .pcraft show PhotoCraft\'s icon, a PNG and a PDF keep Nextcloud\'s', async () => {
    // The row of a file without a preview asks /core/mimeicon for its type.
    await expect(row(page, 'picture.psd').locator('img').first()).toHaveAttribute('src', /\/core\/mimeicon\?mime=application%2Fx-photoshop/);
    expect(await iconOf(page, 'application/x-photoshop')).toMatch(CRAFT_ICON('photocraft'));
    // Nextcloud has no type for .pcraft: the app registered one (lib/Service/FileTypes.php).
    await folder.put('layers.pcraft', Buffer.from('PK'));
    expect(await folder.contentType('layers.pcraft')).toBe('application/x-photocraft');
    expect(await iconOf(page, 'application/x-photocraft')).toMatch(CRAFT_ICON('photocraft'));
    expect(await iconOf(page, 'image/png')).toMatch(/\/core\/img\/filetypes\/image\.svg$/);
    expect(await iconOf(page, 'application/pdf')).toMatch(/\/core\/img\/filetypes\/application-pdf\.svg$/);
  });

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
  const folder = await newFolder(request, { 'layout.designcraft': Buffer.from('{}'), 'drawing.dxf': DXF, 'probe.pdf': PROBE });
  await login(page);
  trackDialogs(page); // nothing may keep the page from going to the folder at the end
  await page.goto(SETTINGS);
  const hint = (app: string) => page.locator(`#craftsuite-layer-${app}-hint`);
  const values = await noteSettings(page);
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
  }, undefined, {}, {}, { base: 'https://craft.example.com/?x' }), 'refused').toBe(400);
  await expect(hint('base')).toHaveText('Use an https:// address without user name, password, ?query or #fragment (http:// only on localhost).');
  await expect(hint('designcraft')).toHaveText(/https:\/\//);
  await expect(hint('vectorcraft')).toHaveText(/another host name than Nextcloud/);
  await expect(hint('photocraft')).toHaveText(/host name is not valid/);
  await expect(hint('pdfcraft')).toHaveText('Use an https:// address without user name, password, ?query or #fragment (http:// only on localhost).');
  await expect(page.locator('.craftsuite-admin__status')).toHaveText(/Nothing was saved/);

  await test.step('with CADCraft\'s address empty, VectorCraft takes the click on a .dxf, and gives it its icon', async () => {
    expect(await saveSettings(page, { pdfcraft: values.pdfcraft, photocraft: values.photocraft, designcraft: at('designcraft'), vectorcraft: at('vectorcraft'), cadcraft: '' },
      undefined, {}, {}, { base: foundBase }), 'saved').toBe(200);
    await expect(page.locator('.craftsuite-admin__status')).toHaveText('Saved');
    expect(await folder.contentType('drawing.dxf')).toBe('image/vnd.dxf');
    expect(await iconOf(page, 'image/vnd.dxf')).toMatch(CRAFT_ICON('vectorcraft'));
    await click('drawing.dxf', 'vectorcraft');
  });

  await test.step('a confirmation that is due: Nextcloud\'s password dialog asks first', async () => {
    await page.goto(SETTINGS);
    // As if the last login or confirmation were long ago (Nextcloud's own client-side record).
    await page.evaluate(() => { (window as unknown as { nc_lastLogin: number }).nc_lastLogin = 0; });
    expect(await saveSettings(page, { cadcraft: at('cadcraft') }, ADMIN.password), 'saved').toBe(200);
    await expect(page.locator('.craftsuite-admin__status')).toHaveText('Saved');
  });

  // CADCraft is preferred for a .dxf when both are configured (CraftApps::PREFERRED), also for its icon.
  await click('drawing.dxf', 'cadcraft');
  expect(await iconOf(page, 'image/vnd.dxf')).toMatch(CRAFT_ICON('cadcraft'));
  await click('layout.designcraft', 'designcraft');

  await test.step('the address for all apps: DesignCraft without one of its own is under it; switched off, it has no entry', async () => {
    await page.goto(SETTINGS);
    expect(await saveSettings(page, { designcraft: '' }, undefined, {}, {}, { base: `${CRAFT}/` }), 'saved').toBe(200);
    await expect(hint('designcraft')).toHaveText(new RegExp(`^Address: ${CRAFT.replace(/\./g, '\\.')}/designcraft/ \\(from the address for all apps\\)\\. Opens: `));
    await expect(page.locator('#craftsuite-layer-designcraft')).toHaveAttribute('placeholder', `${CRAFT}/designcraft/`);
    await click('layout.designcraft', 'designcraft');
    await expect(appView(page)).toHaveAttribute('src', `${CRAFT}/designcraft/`);

    await page.goto(SETTINGS);
    expect(await saveSettings(page, {}, undefined, {}, {}, { uses: { designcraft: false } }), 'saved').toBe(200);
    await expect(hint('designcraft')).toHaveText('Switched off: Files offers no entries for it.');
    await openFolder(page, folder);
    await row(page, 'layout.designcraft').waitFor();
    expect(await menu(page, 'layout.designcraft'), 'no entry for an app switched off').not.toContain('Open in DesignCraft');
    await page.keyboard.press('Escape');
    await page.goto(editUrl(await folder.fileId('layout.designcraft'), 'designcraft'));
    await expect(page.locator('.craftsuite-editor')).toContainText('DesignCraft is switched off.');
  });

  await test.step('the language an app starts in: the user\'s, or one the app has; the editor hands it over in the frame\'s address', async () => {
    await page.goto(SETTINGS);
    await expect(page.locator('#craftsuite-layer-wordcraft-language')).toHaveCount(0);
    // Each language by its own name, the choices of the app first.
    expect(await page.locator('#craftsuite-layer-gridcraft-language option').evaluateAll((options) => options.map((o) => [(o as HTMLOptionElement).value, o.textContent])))
      .toEqual([['', "App's default"], ['user', "User's Nextcloud language"], ['en', 'English'], ['es', 'Español'], ['pt-BR', 'Português (Brasil)'], ['ru', 'Русский']]);
    expect(await saveSettings(page, {}, undefined, { pdfcraft: 'user', gridcraft: 'ru' }), 'saved').toBe(200);
    // A language the app does not have is refused (also through the endpoint), and nothing is saved.
    const refused = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', requesttoken: document.head.dataset.requesttoken ?? '' },
        body: JSON.stringify({ languages: { pdfcraft: 'de', gridcraft: 'de', wordcraft: 'user' } }),
      });
      return { status: res.status, body: await res.json() as { languageErrors?: Record<string, string> } };
    }, `${NC}/index.php/apps/craftsuite_layer/settings`);
    expect(refused.status).toBe(400);
    expect(Object.keys(refused.body.languageErrors ?? {}).sort()).toEqual(['gridcraft', 'wordcraft']);
    await page.goto(SETTINGS);
    await expect(page.locator('#craftsuite-layer-pdfcraft-language')).toHaveValue('user');
    await expect(page.locator('#craftsuite-layer-gridcraft-language')).toHaveValue('ru');
    // 'user' is the language Nextcloud shows the user its pages in, here forced to German.
    await page.goto(`${editUrl(await folder.fileId('probe.pdf'), 'pdfcraft')}&forceLanguage=de`);
    await expect(appView(page)).toHaveAttribute('src', `${values.pdfcraft}#craftsuite-layer:lang=de`);
    await page.goto(SETTINGS);
    expect(await saveSettings(page, {}, undefined, { pdfcraft: '', gridcraft: '' }), 'saved').toBe(200);
    await page.goto(editUrl(await folder.fileId('probe.pdf'), 'pdfcraft'));
    await expect(appView(page)).toHaveAttribute('src', values.pdfcraft);
  });
});

// A default action as Euro-Office (order -1) and ONLYOFFICE (-2) register one for the types they
// are the default app for: hidden from the menu, before the Viewer. Put straight into the registry
// Files reads (window._nc_files_scope.v4_0 of @nextcloud/files 4.x) before Files starts; what it
// opened is in window.e2eOffice. Like those connectors in their same-tab mode it then writes
// ?openfile=true into Files' address when it runs as the default (isDefault not false), and takes it
// out when a menu entry runs it; and it opens one file at a time.
async function addOfficeApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Node = { basename: string; fileid?: number };
    interface Router { query: Record<string, unknown>; goToRoute(name: null, params: Record<string, string>, query: Record<string, unknown>): void }
    const w = window as unknown as {
      _nc_files_scope?: { v4_0?: { fileActions?: Map<string, unknown> } }; e2eOffice?: string[]; e2eOfficeShowing?: boolean;
      OCP?: { Files?: { Router?: Router } };
    };
    w._nc_files_scope ??= {};
    w._nc_files_scope.v4_0 ??= {};
    w._nc_files_scope.v4_0.fileActions ??= new Map();
    w._nc_files_scope.v4_0.fileActions.set('e2e-office-open-def', {
      id: 'e2e-office-open-def',
      displayName: () => 'Open in E2E Office',
      iconSvgInline: () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
      enabled: ({ nodes }: { nodes: Node[] }) => nodes.length === 1 && nodes[0].basename.endsWith('.docx'),
      exec: async ({ nodes, isDefault = true }: { nodes: Node[]; isDefault?: boolean }) => {
        if (w.e2eOfficeShowing) return null;
        w.e2eOfficeShowing = true;
        (w.e2eOffice ??= []).push(nodes[0].basename);
        const router = w.OCP?.Files?.Router;
        if (router) {
          const query = { ...router.query };
          if (isDefault) query.openfile = 'true';
          else delete query.openfile;
          router.goToRoute(null, { view: 'files', fileid: String(nodes[0].fileid) }, query);
        }
        return null;
      },
      default: 'hidden',
      order: -1,
    });
  });
}

test('default app: WordCraft and PdfCraft take the click on their types, the office app they replace stays in the menu', async ({ page, request }) => {
  const folder = await newFolder(request, { 'letter.docx': DOCX, 'probe.pdf': PROBE, 'picture.png': PNG });
  await login(page);
  trackDialogs(page); // leaving an editor page asks once the app has the file
  await addOfficeApp(page);
  const opened = () => page.evaluate(() => (window as unknown as { e2eOffice?: string[] }).e2eOffice ?? []);
  const hint = (app: string) => page.locator(`#craftsuite-layer-${app}-hint`);
  await page.goto(SETTINGS);
  await noteSettings(page);
  // CADCraft with an address: it takes the .dxf from VectorCraft (see below). No default apps.
  const none = Object.fromEntries(DEFAULT_APPS.map((app) => [app, false]));
  expect(await saveSettings(page, { cadcraft: `${CRAFT}/cadcraft/` }, undefined, {}, none), 'saved').toBe(200);
  await expect(hint('wordcraft')).toHaveText(/On a click: none\.$/);

  await test.step('as before: a click on the .docx opens the office app, WordCraft is in the menu', async () => {
    await openFolder(page, folder);
    await row(page, 'letter.docx').waitFor();
    const items = await menu(page, 'letter.docx');
    expect(items).toContain('Open in WordCraft');
    expect(items, 'the hidden default is not in the menu').not.toContain('Open in E2E Office');
    await page.keyboard.press('Escape');
    await row(page, 'letter.docx').locator('[data-cy-files-list-row-name-link]').click();
    await expect.poll(opened).toEqual(['letter.docx']);
  });

  await test.step('made the default app: the settings page says what a click opens', async () => {
    await page.goto(SETTINGS);
    expect(await saveSettings(page, {}, undefined, {}, { wordcraft: true, pdfcraft: true }), 'saved').toBe(200);
    await expect(hint('wordcraft')).toHaveText('Opens: .docx, .docm, .dotx, .dotm, .doc, .dot, .odt, .rtf. On a click: all.');
    await expect(hint('pdfcraft')).toHaveText('Opens: .pdf. On a click: all.');
    // VectorCraft opens PDFs too but keeps its own types only: the PDF goes to PdfCraft, and the
    // .dxf to CADCraft.
    await expect(hint('vectorcraft')).toHaveText(/On a click: \.vectorcraft, \.drawcraft, \.eps, \.svgz\.$/);
    await expect(hint('photocraft')).toHaveText(/On a click: \.psd, \.psb, \.pcraft, \.tga\.$/);
    await expect(page.locator('#craftsuite-layer-designcraft-default'), 'only Craft apps open DesignCraft\'s types').toHaveCount(0);
    await page.reload();
    await expect(page.locator('#craftsuite-layer-wordcraft-default')).toBeChecked();
    await expect(hint('wordcraft')).toHaveText(/On a click: all\.$/);
  });

  await test.step('a click on the .docx opens WordCraft; the office app has an entry in the menu now', async () => {
    await openFolder(page, folder);
    await row(page, 'letter.docx').waitFor();
    const items = await menu(page, 'letter.docx');
    expect(items).toContain('Open in WordCraft');
    expect(items, 'the replaced default, under its own name').toContain('Open in E2E Office');
    await clickMenuItem(page, 'Open in E2E Office');
    await expect.poll(opened).toEqual(['letter.docx']);
    // Run from the menu, not as the default, the office app writes no ?openfile=true, which would
    // make Files run WordCraft's click entry after all.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- nothing may happen in this time
    await page.waitForTimeout(2000);
    await expect(page, 'still in Files, not in WordCraft').not.toHaveURL(/\/apps\/craftsuite_layer\/edit\//);
    await openFolder(page, folder);
    await row(page, 'letter.docx').locator('[data-cy-files-list-row-name-link]').click();
    await page.waitForURL(/\/apps\/craftsuite_layer\/edit\/\d+\?app=wordcraft$/);
  });

  await test.step('a click on the PDF opens PdfCraft, the Viewer\'s View still the Viewer; a PNG opens in the Viewer', async () => {
    await openFolder(page, folder);
    await row(page, 'picture.png').locator('[data-cy-files-list-row-name-link]').click();
    await expect(page, 'a click on the PNG opens the Viewer').toHaveURL(/\/apps\/files\/[^#]*[?&]openfile=true/);
    await page.keyboard.press('Escape');
    // The Viewer writes ?openfile=true too, and Files then runs the first default action, which for
    // the PDF is PdfCraft's now: it must leave the Viewer open.
    await menu(page, 'probe.pdf');
    await clickMenuItem(page, 'View');
    await expect(page.locator('#viewer'), 'the Viewer shows the PDF').toBeVisible();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- nothing may happen in this time
    await page.waitForTimeout(2000);
    await expect(page, 'still the Viewer, not PdfCraft').not.toHaveURL(/\/apps\/craftsuite_layer\/edit\//);
    await page.keyboard.press('Escape');
    await openFolder(page, folder);
    await row(page, 'probe.pdf').locator('[data-cy-files-list-row-name-link]').click();
    await page.waitForURL(/\/apps\/craftsuite_layer\/edit\/\d+\?app=pdfcraft$/);
  });
});

test('new files: + New makes a file from a Craft app\'s blank and opens it in the app', async ({ page, request }) => {
  // Eight Craft apps open in turn: more than the other tests' time on a slow test server.
  test.setTimeout(300_000);
  const folder = await newFolder(request, {});
  await login(page);
  trackDialogs(page); // leaving an editor page asks once the app has the file
  await page.goto(SETTINGS);
  await noteSettings(page);
  expect(await saveSettings(page, {}, undefined, {}, Object.fromEntries(DEFAULT_APPS.map((app) => [app, false]))), 'no default apps').toBe(200);

  await test.step('an entry for each Craft app\'s own format, none for WordCraft\'s .docx', async () => {
    await openFolder(page, folder);
    const items = await newMenu(page);
    for (const entry of ['New PhotoCraft image', 'New VectorCraft drawing', 'New DesignCraft document', 'New DeckCraft presentation', 'New CADCraft drawing', 'New FilmCraft project', 'New EffectCraft project', 'New SoundCraft session']) {
      expect(items, `the entry ${entry}`).toContain(entry);
    }
    expect(items, 'no entry while WordCraft is not the default app').not.toContain('New WordCraft document');
  });

  await test.step('New PhotoCraft image: the blank PSD, opened in PhotoCraft; Back returns to the folder', async () => {
    const asked = await createNew(page, 'New PhotoCraft image', 'New PhotoCraft image.psd', 'photocraft');
    expect((await folder.get('New PhotoCraft image.psd')).equals(BLANK('blank.psd')), 'the blank PSD').toBe(true);
    // Files opened the new file by itself (?openfile=true); the entry took that out of the folder's
    // history entry, so Back does not open the file again.
    await backToFolder(page, asked);
    await row(page, 'New PhotoCraft image.psd').waitFor();
    await expect(page, 'the folder, without openfile').not.toHaveURL(/openfile=true/);
    await expect(page.locator('.craftsuite-editor'), 'no editor again').toHaveCount(0);
  });

  await test.step('New DesignCraft document: the blank with the time it was made, opened in DesignCraft', async () => {
    await openFolder(page, folder);
    await newMenu(page);
    await createNew(page, 'New DesignCraft document', 'New DesignCraft document.designcraft', 'designcraft');
    const made = unzipSync(await folder.get('New DesignCraft document.designcraft'));
    expect(Object.keys(made), 'the package').toEqual(['mimetype', 'meta.json', 'document.json']);
    const created = (JSON.parse(strFromU8(made['document.json'])) as { created: number }).created;
    expect(Math.abs(created - Date.now() / 1000), 'the creation time: now').toBeLessThan(600);
  });

  await test.step('New DeckCraft presentation: the time it was made; New FilmCraft project: the name it was given', async () => {
    await openFolder(page, folder);
    await newMenu(page);
    await createNew(page, 'New DeckCraft presentation', 'New DeckCraft presentation.deckcraft', 'deckcraft');
    const deck = JSON.parse(strFromU8(unzipSync(await folder.get('New DeckCraft presentation.deckcraft'))['presentation.json'])) as {
      presentation: { props: { created: string } };
    };
    expect(Math.abs(Date.parse(deck.presentation.props.created) - Date.now()), 'the creation time: now').toBeLessThan(600_000);
    await openFolder(page, folder);
    await newMenu(page);
    await createNew(page, 'New FilmCraft project', 'New FilmCraft project.fcproj', 'filmcraft', 'Mein Film.fcproj');
    const film = JSON.parse((await folder.get('Mein Film.fcproj')).toString('utf8')) as { project: { name: string; root: { name: string } } };
    expect([film.project.name, film.project.root.name], 'the project named like the file').toEqual(['Mein Film', 'Mein Film']);
  });

  await test.step('New SoundCraft session: the blank session, typed as a SoundCraft session, with SoundCraft\'s icon', async () => {
    await openFolder(page, folder);
    await newMenu(page);
    await createNew(page, 'New SoundCraft session', 'New SoundCraft session.scraftz', 'soundcraft');
    expect((await folder.get('New SoundCraft session.scraftz')).equals(BLANK('blank.scraftz')), 'the blank session').toBe(true);
    expect(await folder.contentType('New SoundCraft session.scraftz')).toBe('application/x-soundcraft-session');
    expect(await iconOf(page, 'application/x-soundcraft-session')).toMatch(CRAFT_ICON('soundcraft'));
  });

  await test.step('as the default app, WordCraft has an entry; its .docx carries the time it was made', async () => {
    await page.goto(SETTINGS);
    expect(await saveSettings(page, {}, undefined, {}, { wordcraft: true }), 'saved').toBe(200);
    await openFolder(page, folder);
    expect(await newMenu(page)).toContain('New WordCraft document');
    await createNew(page, 'New WordCraft document', 'New WordCraft document.docx', 'wordcraft');
    const made = unzipSync(await folder.get('New WordCraft document.docx'));
    expect(strFromU8(made['docProps/app.xml']), 'WordCraft\'s own').toContain('<Application>WordCraft</Application>');
    const created = /<dcterms:created[^>]*>([^<]+)</.exec(strFromU8(made['docProps/core.xml']))?.[1] ?? '';
    expect(Math.abs(Date.parse(created) - Date.now()), 'the creation time: now').toBeLessThan(600_000);
  });
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
  await expect(page.locator('.craftsuite-admin__head')).toContainText('Startsprache');
});
