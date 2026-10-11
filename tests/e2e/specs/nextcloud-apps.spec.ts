// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Nextcloud app's editor page with the real builds of PhotoCraft, VectorCraft and DesignCraft,
// which save the opened file under another name or type: the first save of the document creates
// a new file next to the original and the name label shows it, later saves replace that file
// (and Nextcloud keeps a version), the original stays as it was, and nothing is downloaded.
// Checked through WebDAV. One test per app:
//
//   photocraft    an opened probe.png, next to an unrelated 'Probe.PSD': Ctrl+S after an edit
//                 creates 'probe (2).psd' ('probe.psd' would clash with 'Probe.PSD' on Windows
//                 and macOS sync clients), a second save replaces it; Quick Export as PNG becomes
//                 a new file
//   vectorcraft   an opened probe.svg: Ctrl+S and Enter in the Save As dialog create
//                 probe.vectorcraft next to it, a second Ctrl+S replaces it
//   designcraft   an opened from-indesign.idml: Ctrl+S creates from-indesign.designcraft next to
//                 it, a save after an edit replaces it; Export Page as PNG (Ctrl+E) becomes a new
//                 file
//
// The steps that drive each app use the keyboard, as in <app>.spec.ts (which has the sources of
// the shortcuts and command labels). Needs a Nextcloud with the app enabled and photocraft_url,
// vectorcraft_url and designcraft_url set to the test server's /<app>/, and NEXTCLOUD_URL,
// NEXTCLOUD_USER, NEXTCLOUD_PASSWORD (docs/development.md). Each test works in a folder of its own.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { appFrames, PALETTE_KEYS, press, runCommand, settle } from '../lib/craft-ui.ts';
import { appView, login, nameLabel, newFolder, openEditor, status, trackDownloads, type Folder } from '../lib/nextcloud.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

test.setTimeout(240_000);
// The apps' command labels depend on the language.
test.use({ locale: 'en-US' });

// A save takes a moment in software rendering; the page reports it once Nextcloud has the file.
const SAVE_TIMEOUT = 60_000;

// The first save of the document under the name the app gives it: a new file next to the
// original, which the name label shows from then on. Returns its file id.
async function expectCreated(page: Page, folder: Folder, name: string, files: string[]): Promise<number> {
  await expect(status(page)).toHaveText(`Saved as ${name} next to the original. Later saves go there.`, { timeout: SAVE_TIMEOUT });
  await expect(nameLabel(page), 'the name label shows the file saves go to').toHaveText(name);
  expect(await folder.names(), 'files in the folder').toEqual([...files, name].sort());
  return folder.fileId(name);
}

// A later save of the document: it replaces that file in place (the same file id), Nextcloud
// keeps the version before, and no further file appears.
async function expectReplaced(page: Page, folder: Folder, name: string, id: number, before: Buffer, files: string[]): Promise<Buffer> {
  await expect(status(page)).toHaveText(`Saved ${name}`, { timeout: SAVE_TIMEOUT });
  const saved = await folder.get(name);
  expect(saved.equals(before), `${name} holds the new save`).toBe(false);
  expect(await folder.fileId(name), `${name} replaced in place, not deleted and created again`).toBe(id);
  expect(await folder.versions(id), `older versions of ${name}`).toBeGreaterThanOrEqual(1);
  expect(await folder.names(), 'files in the folder').toEqual([...files].sort());
  return saved;
}

// The originals the test put there, byte for byte.
async function expectUnchanged(folder: Folder, files: Record<string, Buffer>) {
  for (const [name, data] of Object.entries(files)) expect((await folder.get(name)).equals(data), `${name} unchanged`).toBe(true);
}

// An export: a new file, under the first free name, which the name label does not follow.
async function expectExported(page: Page, folder: Folder, before: string[], document: string): Promise<string> {
  await expect(status(page)).toHaveText(/^Saved as a new file: /, { timeout: SAVE_TIMEOUT });
  const added = (await folder.names()).filter((n) => !before.includes(n));
  expect(added, 'one new file').toHaveLength(1);
  await expect(status(page)).toHaveText(`Saved as a new file: ${added[0]}`);
  await expect(nameLabel(page), 'the name label still shows the document').toHaveText(document);
  return added[0];
}

const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';

test('photocraft: an opened PNG is saved as a PSD next to it, under a name free in any letter case', async ({ page, request }) => {
  const PNG = fixture('photocraft/probe.png');
  const OTHER = fixture('photocraft/probe.psd'); // another picture, as if from elsewhere
  const originals = { 'probe.png': PNG, 'Probe.PSD': OTHER };
  const folder = await newFolder(request, originals);
  await login(page);
  const downloads = trackDownloads(page);
  const app = await openEditor(page, await folder.fileId('probe.png'), 'photocraft');
  const SAVED = 'probe (2).psd';

  // PhotoCraft's shortcuts (photocraft.spec.ts): Ctrl+I inverts, Ctrl+Shift+U desaturates.
  const editAndSave = async (edit: string) => {
    await test.step(`ui: ${edit}, then Control+s`, async () => {
      await press(page, app, edit);
      await settle(appView(page), app);
      await press(page, app, 'Control+s');
    });
  };

  let first: Buffer = Buffer.alloc(0);
  let id = 0;

  await test.step('Ctrl+S after an edit creates probe (2).psd: probe.psd would clash with Probe.PSD', async () => {
    await editAndSave('Control+i');
    id = await expectCreated(page, folder, SAVED, Object.keys(originals));
    first = await folder.get(SAVED);
    expect(first.subarray(0, 4).toString('latin1'), 'a PSD').toBe('8BPS');
    await expectUnchanged(folder, originals);
  });

  await test.step('a second save replaces probe (2).psd, and Nextcloud keeps a version', async () => {
    await editAndSave('Control+Shift+u');
    await expectReplaced(page, folder, SAVED, id, first, [...Object.keys(originals), SAVED]);
    await expectUnchanged(folder, originals);
  });

  await test.step('Quick Export as PNG becomes a new file and never replaces the PNG', async () => {
    const before = await folder.names();
    await runCommand(page, app, 'Quick Export as PNG File', PALETTE_KEYS.photocraft);
    const exported = await expectExported(page, folder, before, SAVED);
    expect(exported).toBe('probe (2).png');
    expect((await folder.get(exported)).subarray(0, 8).toString('latin1'), 'a PNG').toBe(PNG_SIGNATURE);
    await expectUnchanged(folder, originals);
  });

  expect(downloads, 'browser downloads').toEqual([]);
});

// A native VectorCraft file (vectorcraft.spec.ts): JSON, gzip-compressed if the user chose so,
// possibly followed by binary data after a NUL byte. Whether it holds a group (Ctrl+G).
const MARKER = 'CRAFTSUITE-PROBE-7f3a';
function vectorcraftHasGroup(bytes: Buffer): boolean {
  const unpacked = bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ? gunzipSync(bytes) : bytes;
  const end = unpacked.indexOf(0);
  const json = unpacked.subarray(0, end < 0 ? unpacked.length : end).toString('utf8');
  expect((JSON.parse(json) as { format?: string }).format, 'the native format').toBe('vectorcraft');
  expect(json.includes(MARKER), 'the opened drawing (marker)').toBe(true);
  return /"type": ?"group"/.test(json);
}

test('vectorcraft: an opened SVG is saved as probe.vectorcraft next to it, later saves replace that file', async ({ page, request }) => {
  const originals = { 'probe.svg': fixture('vectorcraft/probe.svg') };
  const folder = await newFolder(request, originals);
  await login(page);
  const downloads = trackDownloads(page);
  const app = await openEditor(page, await folder.fileId('probe.svg'), 'vectorcraft');
  const SAVED = 'probe.vectorcraft';

  // Select all, then Group (Ctrl+G) or Ungroup (Ctrl+Shift+G): an edit that shows in the file.
  const edit = async (shortcut: string) => {
    await test.step(`ui: select all, ${shortcut}`, async () => {
      await press(page, app, 'Control+a');
      await appFrames(app, 3);
      await press(page, app, shortcut);
      await settle(appView(page), app);
    });
  };

  // The first Ctrl+S asks with VectorCraft's Save As dialog, which suggests probe.vectorcraft and
  // has the focus in its name field (eframe's hidden <input> in the app frame); Enter confirms.
  const firstSave = async () => {
    await test.step('ui: Ctrl+S, Enter in the Save As dialog', async () => {
      await press(page, app, 'Control+s');
      await expect.poll(() => app.evaluate(() => document.activeElement?.tagName === 'INPUT'),
        { message: 'Ctrl+S opened the Save As dialog', timeout: 10_000 }).toBe(true);
      await settle(appView(page), app);
      await page.keyboard.press('Enter');
    });
  };

  let first: Buffer = Buffer.alloc(0);
  let id = 0;

  await test.step('Ctrl+S and Enter in the Save As dialog create probe.vectorcraft next to the SVG', async () => {
    await edit('Control+g');
    await firstSave();
    id = await expectCreated(page, folder, SAVED, Object.keys(originals));
    first = await folder.get(SAVED);
    expect(vectorcraftHasGroup(first), 'the edit (a group)').toBe(true);
    await expectUnchanged(folder, originals);
  });

  await test.step('a second Ctrl+S, without a dialog, replaces probe.vectorcraft', async () => {
    await edit('Control+Shift+g');
    await press(page, app, 'Control+s');
    const second = await expectReplaced(page, folder, SAVED, id, first, [...Object.keys(originals), SAVED]);
    expect(vectorcraftHasGroup(second), 'the edit (ungrouped)').toBe(false);
    await expectUnchanged(folder, originals);
  });

  expect(downloads, 'browser downloads').toEqual([]);
});

// The pages of a DesignCraft package (designcraft.spec.ts): a zip whose first entry, stored, is
// 'mimetype', and whose document.json lists the spreads with their pages.
function designcraftPages(bytes: Buffer): number {
  const nameLength = bytes.readUInt16LE(26);
  expect(bytes.toString('latin1', 30, 30 + nameLength), 'a zip starting with mimetype').toBe('mimetype');
  const start = 30 + nameLength + bytes.readUInt16LE(28);
  expect(bytes.toString('latin1', start, start + bytes.readUInt32LE(18)), 'a DesignCraft package').toBe('application/vnd.designcraft+zip');
  const doc = JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as { spreads: { pages: unknown[] }[] };
  return doc.spreads.reduce((n, s) => n + s.pages.length, 0);
}

test('designcraft: an opened IDML is saved as from-indesign.designcraft next to it, later saves replace that file', async ({ page, request }) => {
  const originals = { 'from-indesign.idml': fixture('designcraft/from-indesign.idml') };
  const folder = await newFolder(request, originals);
  await login(page);
  const downloads = trackDownloads(page);
  const app = await openEditor(page, await folder.fileId('from-indesign.idml'), 'designcraft');
  const SAVED = 'from-indesign.designcraft';

  // Layout > Pages > Insert Pages… (Ctrl+Shift+P), confirmed with its default of one page.
  const insertPage = async () => {
    await test.step('ui: insert a page (Control+Shift+P, then Enter)', async () => {
      await press(page, app, 'Control+Shift+P');
      await settle(appView(page), app);
      await page.keyboard.press('Enter');
      await settle(appView(page), app);
    });
  };

  let first: Buffer = Buffer.alloc(0);
  let id = 0;

  await test.step('Ctrl+S creates from-indesign.designcraft next to the IDML', async () => {
    await press(page, app, 'Control+s');
    id = await expectCreated(page, folder, SAVED, Object.keys(originals));
    first = await folder.get(SAVED);
    expect(designcraftPages(first), 'the IDML\'s one page').toBe(1);
    await expectUnchanged(folder, originals);
  });

  await test.step('a save after an edit replaces from-indesign.designcraft', async () => {
    await insertPage();
    await press(page, app, 'Control+s');
    const second = await expectReplaced(page, folder, SAVED, id, first, [...Object.keys(originals), SAVED]);
    expect(designcraftPages(second), 'the inserted page').toBe(2);
    await expectUnchanged(folder, originals);
  });

  await test.step('Export Page as PNG (Ctrl+E) becomes a new file', async () => {
    const before = await folder.names();
    await press(page, app, 'Control+e');
    const exported = await expectExported(page, folder, before, SAVED);
    expect(exported).toMatch(/^from-indesign-p\d+\.png$/);
    expect((await folder.get(exported)).subarray(0, 8).toString('latin1'), 'a PNG').toBe(PNG_SIGNATURE);
    await expectUnchanged(folder, originals);
  });

  expect(downloads, 'browser downloads').toEqual([]);
});
