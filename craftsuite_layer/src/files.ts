// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Open in <app>" in Files, one entry per Craft app the administrator configured (the listener
// lib/Listener/LoadFilesScripts.php provides them, with the extensions each app opens). Files keeps
// its actions in a registry shared by every copy of @nextcloud/files 4.x on the page, so the
// bundled copy registers into the one Files reads.
//
// Matching is by extension: Nextcloud has no MIME type for .designcraft, .vectorcraft or .idml.
// For the extensions an app opens by default (no other app does), the entry is also what a click
// on the file does; for the others (a PDF opens in the viewer) it is an entry in the menu.

import { DefaultType, FileType, Permission, registerFileAction, type INode } from '@nextcloud/files';
import { generateUrl } from '@nextcloud/router';
import { t } from './l10n.ts';

interface CraftApp {
  id: string;
  name: string;
  extensions: string[];
  default: string[];
}

// Our own icon (the app icon), not the Craft apps' logos: those are trademarks of their authors.
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M4.5 3h15A2.5 2.5 0 0 1 22 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-13A2.5 2.5 0 0 1 4.5 3ZM4 7v11.5a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V7Z"/><path fill="currentColor" d="M6.5 9.75H14v-1.5l3.5 2.25-3.5 2.25v-1.5H6.5Zm11 5H10v-1.5L6.5 15.5l3.5 2.25v-1.5h7.5Z"/></svg>';

function readState(): CraftApp[] {
  const input = document.querySelector<HTMLInputElement>('#initial-state-craftsuite_layer-files');
  if (!input) return [];
  try {
    const apps = JSON.parse(atob(input.value)) as unknown;
    return Array.isArray(apps) ? (apps as CraftApp[]) : [];
  } catch {
    return [];
  }
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// What Files itself requires before it offers a download: read permission, and neither a share
// that hides downloads nor one whose download permission is off. Opening sends the bytes to the
// Craft app, which is a download in all but name.
function downloadable(node: INode): boolean {
  if ((node.permissions & Permission.READ) === 0) return false;
  const hide = node.attributes['hide-download'];
  if (hide === true || hide === 'true') return false;
  try {
    const attributes = JSON.parse(String(node.attributes['share-attributes'] ?? '[]')) as { scope?: string; key?: string; value?: unknown }[];
    const download = attributes.find((a) => a.scope === 'permissions' && a.key === 'download');
    if (download && download.value !== true) return false;
  } catch {
    return false;
  }
  return true;
}

// The file id for the editor page. Node.id, a string: Nextcloud is moving to 64-bit (snowflake)
// ids, which Node.fileid (a number) no longer carries. The editor route takes digits only.
function fileIdOf(node: INode): string | null {
  const id = node.id;
  return id !== undefined && /^\d+$/.test(id) ? id : null;
}

function register(app: CraftApp, asDefault: boolean): void {
  const extensions = asDefault ? app.default : app.extensions.filter((ext) => !app.default.includes(ext));
  if (extensions.length === 0) return;
  registerFileAction({
    id: `craftsuite_layer-${app.id}${asDefault ? '-default' : ''}`,
    displayName: () => t('craftsuite_layer', 'Open in {app}', { app: app.name }),
    iconSvgInline: () => ICON,
    // Not in the trash (Files' own actions skip it too): a deleted file has no place to save to.
    enabled: ({ nodes, view }) => view.id !== 'trashbin'
      && nodes.length === 1
      && nodes[0].type === FileType.File
      && nodes[0].isDavResource
      && fileIdOf(nodes[0]) !== null
      && extensions.includes(extension(nodes[0].basename))
      && downloadable(nodes[0]),
    exec: async ({ nodes }) => {
      // The editor page hands the file to the Craft app at once only for an open the user started
      // here, which the session's request token proves to the server. Files also runs this action
      // by itself, for a link to the file (/f/<id>, ?openfile=true) that any site can open: then
      // there is no user activation, no token, and the editor page asks first. The editor page
      // removes the token from the address; it sends no referrer.
      const params = { fileId: fileIdOf(nodes[0])!, app: app.id };
      const token = document.head.dataset.requesttoken ?? '';
      window.location.assign(navigator.userActivation?.isActive && token !== ''
        ? generateUrl('/apps/craftsuite_layer/edit/{fileId}?app={app}&requesttoken={token}', { ...params, token })
        : generateUrl('/apps/craftsuite_layer/edit/{fileId}?app={app}', params));
      return null;
    },
    // Files sorts its menu by order: on Nextcloud 34 this puts the entry after View and Rename,
    // before Move or copy.
    order: 10,
    ...(asDefault ? { default: DefaultType.DEFAULT } : {}),
  });
}

for (const app of readState()) {
  register(app, true);
  register(app, false);
}
