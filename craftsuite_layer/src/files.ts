// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Open in <app>" in Files, one entry per Craft app the administrator configured (the listener
// lib/Listener/LoadFilesScripts.php provides them, with the extensions each app opens). Files keeps
// its actions in a registry shared by every copy of @nextcloud/files 4.x on the page, so the
// bundled copy registers into the one Files reads.
//
// Matching is by extension: Nextcloud has no MIME type for .designcraft, .vectorcraft or .idml,
// except where lib/Service/FileTypes.php could add one.
// For the extensions a click opens in the app (its own types, which no other app opens, and all
// its types where the administrator made it the default app: CraftApps::clickApp()), the entry is
// also what a click on the file does; for the others (a PDF opens in the viewer) it is an entry in
// the menu.

import {
  DefaultType, FileType, getFileActions, Permission, registerFileAction, type ActionContext, type ActionContextSingle, type IFileAction, type INode,
} from '@nextcloud/files';
import { generateUrl } from '@nextcloud/router';
import { t } from './l10n.ts';

interface CraftApp {
  id: string;
  name: string;
  extensions: string[];
  default: string[];
}

// Files runs the first default action by this order (lowest first). The click entry comes before
// the Viewer's (0, which also opens Office files for Nextcloud Office) and the default actions of
// ONLYOFFICE (-2) and Euro-Office (-1), so that a type the administrator gave a Craft app opens
// there; and after Files' own open-in-files (-1000), which in Recent and Search first goes to the
// file's folder.
const CLICK_ORDER = -20;
const PREFIX = 'craftsuite_layer-';

// The layer's own icon (the app icon), the same for every Craft app: the entry names the app.
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

interface FilesRouter {
  params: Record<string, string>;
  query: Record<string, unknown>;
  goToRoute(name: string | null, params: Record<string, string>, query: Record<string, unknown>, replace: boolean): void;
}

// Files leaves ?openfile=true in its address once it opened a file by itself (a link to the file,
// a new file from "+ New"), so Back from the editor page would run the entry again and land on its
// question. The entry takes it out of the current history entry first, as Files itself does when
// a file has no default action.
function forgetOpenfile(): void {
  const router = (window as unknown as { OCP?: { Files?: { Router?: FilesRouter } } }).OCP?.Files?.Router;
  if (!router?.query || !('openfile' in router.query)) return;
  const query = { ...router.query };
  delete query.openfile;
  router.goToRoute(null, router.params, query, true);
}

// Whether Nextcloud's Viewer shows a file. The Viewer writes ?openfile=true into Files' address when
// it opens or pages to a file, and Files then runs the default action, which for a type a Craft
// app took over as the default app is the layer's: it must leave the Viewer alone then.
function viewerOpen(): boolean {
  return Boolean((window as unknown as { OCA?: { Viewer?: { file?: string } } }).OCA?.Viewer?.file);
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
    id: `${PREFIX}${app.id}${asDefault ? '-default' : ''}`,
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
      if (viewerOpen()) return null; // the user chose the Viewer's View
      // The editor page hands the file to the Craft app at once only for an open the user started
      // here, which the session's request token proves to the server. Files also runs this action
      // by itself, for a link to the file (/f/<id>, ?openfile=true) that any site can open: then
      // there is no user activation, no token, and the editor page asks first. The editor page
      // removes the token from the address; it sends no referrer.
      const params = { fileId: fileIdOf(nodes[0])!, app: app.id };
      const token = document.head.dataset.requesttoken ?? '';
      const activated = navigator.userActivation?.isActive === true;
      try {
        forgetOpenfile();
      } catch { /* Back opens the file once more */ }
      window.location.assign(activated && token !== ''
        ? generateUrl('/apps/craftsuite_layer/edit/{fileId}?app={app}&requesttoken={token}', { ...params, token })
        : generateUrl('/apps/craftsuite_layer/edit/{fileId}?app={app}', params));
      return null;
    },
    // Files sorts its menu by order too: the click entry comes before the Viewer's View and Rename;
    // the others after View and Rename, before Move or copy.
    order: asDefault ? CLICK_ORDER : 10,
    ...(asDefault ? { default: DefaultType.DEFAULT } : {}),
  });
}

function enabledFor(action: IFileAction, context: ActionContext): boolean {
  try {
    return action.enabled === undefined || action.enabled(context);
  } catch {
    return false;
  }
}

// What a click on the file would open without the layer's click entry: the next default action,
// when the layer's is the one Files runs. Only a hidden one (DefaultType.HIDDEN, as Euro-Office's
// and ONLYOFFICE's) counts: Files never shows it in the menu once another default runs instead,
// while one that is shown (the Viewer's View) stays in the menu anyway.
function displaced(context: ActionContext): IFileAction | null {
  const defaults = getFileActions()
    .filter((action) => action.default !== undefined && enabledFor(action, context))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!defaults[0]?.id.startsWith(PREFIX)) return null;
  const next = defaults.find((action) => !action.id.startsWith(PREFIX));
  return next?.default === DefaultType.HIDDEN ? next : null;
}

const apps = readState();
for (const app of apps) {
  register(app, true);
  register(app, false);
}

// The app a click opened before a Craft app took it over, as an entry in the file's menu under its
// own name and icon (Euro-Office's "Open in …" for a .docx once WordCraft is the default app).
if (apps.some((app) => app.default.length > 0)) {
  registerFileAction({
    id: `${PREFIX}displaced`,
    displayName: (context) => displaced(context)?.displayName(context) ?? '',
    iconSvgInline: (context) => displaced(context)?.iconSvgInline(context) ?? '',
    enabled: (context) => context.nodes.length === 1 && displaced(context) !== null,
    // As the connectors' own menu entries call it: not as the default action. As a default, they
    // write ?openfile=true into Files' address, and Files would then run the layer's click entry.
    exec: async (context) => {
      const action = displaced(context);
      return action ? action.exec({ ...context, isDefault: false } as ActionContextSingle) : null;
    },
    order: CLICK_ORDER + 1,
  });
}
