// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A test Nextcloud with the app, shared by the specs nextcloud*.spec.ts: WebDAV as a test user
// in a folder of each test's own, shares, the login, and the editor page.
//
// Environment: NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_PASSWORD (an administrator), and
// NEXTCLOUD_USER2, NEXTCLOUD_PASSWORD2 (a second user, no administrator; docs/development.md).

import { test, expect, type APIRequestContext, type Frame, type Page } from '@playwright/test';
import { settle } from './craft-ui.ts';

export const NC = (process.env.NEXTCLOUD_URL ?? '').replace(/\/+$/, '');

export interface Account { user: string; password: string }
export const ADMIN: Account = { user: process.env.NEXTCLOUD_USER ?? 'admin', password: process.env.NEXTCLOUD_PASSWORD ?? '' };
export const USER2: Account = { user: process.env.NEXTCLOUD_USER2 ?? '', password: process.env.NEXTCLOUD_PASSWORD2 ?? '' };

const auth = (account: Account) => ({ Authorization: 'Basic ' + Buffer.from(`${account.user}:${account.password}`).toString('base64') });

const davPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

// WebDAV with a test user's password, in a folder for one test. The name is the folder's path
// from the user's root ('a' or 'a/b').
export class Folder {
  readonly url: string;
  constructor(private request: APIRequestContext, readonly name: string, readonly account: Account = ADMIN) {
    this.url = `${NC}/remote.php/dav/files/${encodeURIComponent(account.user)}/${davPath(name)}`;
  }

  private get auth() {
    return auth(this.account);
  }

  async create() {
    const res = await this.request.fetch(this.url, { method: 'MKCOL', headers: this.auth });
    expect(res.status(), 'MKCOL of the test folder').toBe(201);
  }

  async put(name: string, data: Buffer) {
    const res = await this.request.fetch(`${this.url}/${encodeURIComponent(name)}`, { method: 'PUT', headers: this.auth, data });
    expect(res.ok(), `PUT ${name}`).toBe(true);
  }

  // Nextcloud locks a file while it is written (423): read again a moment later.
  async get(name: string): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.request.fetch(`${this.url}/${encodeURIComponent(name)}`, { headers: this.auth });
      if (res.status() === 423 && attempt < 10) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      expect(res.ok(), `GET ${name}`).toBe(true);
      return res.body();
    }
  }

  // Moves a file or folder of the account's own tree (a path from its root, such as a received
  // share) into this folder.
  async moveIn(from: string, name: string) {
    const res = await this.request.fetch(`${NC}/remote.php/dav/files/${encodeURIComponent(this.account.user)}${davPath(from)}`, {
      method: 'MOVE', headers: { ...this.auth, Destination: `${this.url}/${encodeURIComponent(name)}` },
    });
    expect(res.status(), `MOVE ${from}`).toBe(201);
  }

  private async propfind(url: string, depth: '0' | '1', prop: string): Promise<string> {
    const res = await this.request.fetch(url, {
      method: 'PROPFIND',
      headers: { ...this.auth, Depth: depth, 'Content-Type': 'application/xml' },
      data: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop>${prop}</d:prop></d:propfind>`,
    });
    expect(res.status(), `PROPFIND ${url}`).toBe(207);
    return res.text();
  }

  // The MIME type Nextcloud stored for a file.
  async contentType(name: string): Promise<string> {
    const xml = await this.propfind(`${this.url}/${encodeURIComponent(name)}`, '0', '<d:getcontenttype/>');
    return /<d:getcontenttype>([^<]*)</.exec(xml)?.[1] ?? '';
  }

  async fileId(name: string): Promise<number> {
    const xml = await this.propfind(`${this.url}/${encodeURIComponent(name)}`, '0', '<oc:fileid/>');
    return Number(/<oc:fileid>(\d+)</.exec(xml)?.[1]);
  }

  // The names of the files in the folder, sorted.
  async names(): Promise<string[]> {
    const xml = await this.propfind(this.url, '1', '<d:resourcetype/>');
    const hrefs = [...xml.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => decodeURIComponent(m[1]));
    return hrefs.filter((h) => !h.endsWith('/')).map((h) => h.split('/').pop()!).sort();
  }

  // The older versions Nextcloud keeps of a file (the versions app). Its collection lists the
  // current version too, which does not count. Writes within the same second may share a version.
  async versions(fileId: number): Promise<number> {
    const xml = await this.propfind(`${NC}/remote.php/dav/versions/${encodeURIComponent(this.account.user)}/versions/${fileId}`, '1', '<d:getcontentlength/>');
    return Math.max(0, (xml.match(/<d:response>/g) ?? []).length - 2);
  }
}

// A new folder for the running test, named after the project and the test, with these files.
export async function newFolder(request: APIRequestContext, files: Record<string, Buffer>, account: Account = ADMIN): Promise<Folder> {
  const info = test.info();
  const folder = new Folder(request, `craftsuite-e2e ${info.project.name} ${info.title.split(':')[0]} ${Date.now()}`, account);
  await folder.create();
  for (const [name, data] of Object.entries(files)) await folder.put(name, data);
  return folder;
}

// Shares a file or folder of the administrator's (its path from the root) with another user
// (OCS, as the Files sidebar does): read-only, optionally without permission to download.
// Returns where it appears for them.
export async function shareWith(request: APIRequestContext, path: string, account: Account, download: boolean): Promise<string> {
  const res = await request.fetch(`${NC}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`, {
    method: 'POST',
    headers: { ...auth(ADMIN), 'OCS-APIRequest': 'true' },
    form: {
      path,
      shareType: '0',
      shareWith: account.user,
      permissions: '1',
      ...(download ? {} : { attributes: JSON.stringify([{ scope: 'permissions', key: 'download', value: false }]) }),
    },
  });
  expect(res.status(), `share ${path}`).toBe(200);
  const target = ((await res.json()) as { ocs: { data: { file_target?: string } } }).ocs.data.file_target;
  expect(target, `where ${path} appears for ${account.user}`).toBeTruthy();
  return target!;
}

export async function login(page: Page, account: Account = ADMIN) {
  await page.goto(`${NC}/index.php/login`);
  await page.locator('#user').fill(account.user);
  await page.locator('#password').fill(account.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/apps\//);
}

export const editor = (page: Page) => page.locator('.craftsuite-editor');
export const status = (page: Page) => page.locator('.craftsuite-editor__status');
// The name of the file saves of the document go to.
export const nameLabel = (page: Page) => page.locator('.craftsuite-editor__name');
export const appView = (page: Page) => page.locator('.craftsuite-editor__frame');

// The URL of the editor page for a file (with ?app=, as the Files entry has it).
export const editUrl = (fileId: number, app?: string) => `${NC}/index.php/apps/craftsuite_layer/edit/${fileId}${app ? `?app=${app}` : ''}`;

// Waits until the editor page reports the file opened in the app, and returns the app's frame.
export async function appOpened(page: Page, app?: string): Promise<Frame> {
  await expect(editor(page), `the editor reports the file opened in ${app ?? 'the app'}`).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
  const handle = await appView(page).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('the editor page has no app frame');
  await settle(appView(page), frame);
  return frame;
}

// Opens the editor page (with ?app=, as the Files entry does, or else the app for the file type)
// and waits until the app has the file.
export async function openEditor(page: Page, fileId: number, app?: string): Promise<Frame> {
  await page.goto(editUrl(fileId, app));
  return appOpened(page, app);
}

// Accepts every dialog and records its type: the page asks before it is left (Close: confirm;
// any other way: the browser's beforeunload).
export function trackDialogs(page: Page): string[] {
  const types: string[] = [];
  page.on('dialog', (d) => {
    types.push(d.type());
    void d.accept();
  });
  return types;
}

// The names of the browser downloads of a page, from now on.
export function trackDownloads(page: Page): string[] {
  const names: string[] = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  return names;
}

// The statuses of the page's WebDAV writes (PUT) to a file of that name, from now on.
export function trackWrites(page: Page, name: string): number[] {
  const statuses: number[] = [];
  page.on('response', (r) => {
    if (r.request().method() === 'PUT' && decodeURIComponent(new URL(r.url()).pathname).endsWith(`/${name}`)) statuses.push(r.status());
  });
  return statuses;
}
