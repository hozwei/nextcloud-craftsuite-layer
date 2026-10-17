<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Architecture

## Goal and constraints

Open files from Nextcloud in storytold's Craft web apps (PdfCraft, PhotoCraft, VectorCraft,
DesignCraft, WordCraft, GridCraft, DeckCraft, CADCraft, LightCraft, FilmCraft, EffectCraft and
SoundCraft, as listed in `apps.json`) and save the results back to Nextcloud. FigCraft is left
out until its web build can open and save files.

- The apps stay unmodified. Sites that host them take new upstream releases daily, so a patched fork
  would have to be rebuilt every day.
- The web builds have no embedding API yet (see [Native embedding APIs](#native-embedding-apis)).
  In the browser they take files by drag and drop, and every save or export is a browser
  download.
- Whatever goes wrong, the user's work must not be lost and no file must be overwritten by
  mistake.

## Components

| Component | Folder | Runs in | Status |
|---|---|---|---|
| Nextcloud app `craftsuite_layer` | `craftsuite_layer/` | Nextcloud, and in the browser in Files and the editor page | Files entries (also as the default app for all of an app's types), "+ New" entries with a blank document per app (`assets/`, made by `blanks.mjs`), file type icons, editor page, settings page, German; Nextcloud 34 and 35 ([nextcloud-app.md](nextcloud-app.md)) |
| Translator core | `translators/core.js` | the Craft app's page | done, protocol version 1 |
| Adapters, one per app | `translators/<app>.js` | the Craft app's page | one for each app in `apps.json` ([translators/README.md](../translators/README.md)) |
| Craft hosting | `hosting/` (template) | a static web server on its own origin, plus an updater | translator injector, nginx template, Compose example; no updater yet ([hosting.md](hosting.md)) |
| End-to-end tests | `tests/e2e/` | Playwright | the translator in Chromium, Firefox and WebKit; the apps in Chromium and WebKit; the Nextcloud app in Nextcloud 34 and 35 ([development.md](development.md)) |

## How it fits together

```text
 Nextcloud server                          Craft hosting, own origin
 (files, versions, permissions)            (static files: the app's release,
        ^                                   translator injected in index.html)
        | WebDAV GET and PUT                         |
        | as the logged-in user                      | HTTPS
        v                                            v
+-------------------------------------------------------------------+
| Browser                                                           |
|  Nextcloud editor page      https://cloud.example.com             |
|                                                                   |
|      | open (bytes)                  ^ save (bytes, kind)         |
|      v            postMessage        |                            |
|  +-------------------------------------------------------------+  |
|  | iframe                  https://craft.example.com/pdfcraft/ |  |
|  |   unmodified Craft app + translator (core.js, pdfcraft.js)  |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

The file does not pass through the Craft hosting, which serves static files only. The host page
reads it from Nextcloud, hands the bytes to the framed app with `postMessage`, and writes what
comes back to Nextcloud. The Craft origin never sees the user's Nextcloud session. The code it
serves does see the file it edits (see [security.md](security.md#trust-model)).

## Opening a file

1. In Files, the user chooses "Open in PdfCraft" (or another Craft app), or clicks a file of a
   type that only a Craft app opens, or of any type of a Craft app the administrator made the
   default app (see [Files integration](#files-integration)); a file made with "+ New" opens the
   same way. This opens the editor page `/apps/craftsuite_layer/edit/<fileId>?app=<app>`, with
   the session's request token when the user clicked. The server checks that the user may read
   and download the file and that the app opens its type. Without a valid token (and unless the
   browser reports a typed address, `Sec-Fetch-Site: none`), for example for a link another site
   opened, it only asks whether to open the file, and goes on from step 2 when the user confirms.
2. The editor page frames the Craft URL from the server-side admin configuration. The URL is
   never taken from the page URL, or a crafted link could send the user's file anywhere. The
   page's Content-Security-Policy allows framing only that origin
   (`addAllowedFrameDomain`, on the editor page only). If the administrator chose a language for
   the app, the page adds it as a fragment (`#craftsuite-layer:lang=de`); the translator takes it
   out and has the adapter apply it before the app starts
   ([protocol.md](protocol.md#host-settings)).
3. The page reads the file with WebDAV as the logged-in user and keeps its ETag.
4. Handshake: the translator sends `hello` to the allowed origins, the page answers `init`, the
   translator answers `ready` once the app can take files: the app has registered its drop
   target and, for an adapter with a `started` check, that check has passed (VectorCraft
   registers a first `drop` listener before the one that reads files).
5. The page sends `open` with the bytes, under the file's name with the extension in lower case.
   The translator records the name, the length and SHA-256 hash of the bytes, and the name the
   app will save the file under: the adapter's `savedName`, such as `<stem>.psd` for an image in
   PhotoCraft, `<title>.vectorcraft` in VectorCraft and `<title>.designcraft` in DesignCraft, or
   the opened name without one. It hands the bytes to the app as a dropped file and confirms
   with `delivered` and the name. The page notes that name as the name of the opened file.

## Saving

1. The app starts a download (Save, Export, ...). The translator intercepts it and tells the page
   at once with `save-started`, so the page knows a save is coming while a large file is still
   being read. It looks up the opened file whose name, or whose saved name, the download has. If
   there is one, the adapter classifies the bytes; where the format carries a document identity
   (the adapter's `identity`), a save with another identity is never the document. The
   translator sends `save` with the bytes and a kind: `document` with the open's `openId` if
   the adapter recognises a save of the opened file, otherwise `export`. When PdfCraft rewrites
   the whole file on Save (after redaction, for example), that save is an `export`, and the
   saves after it extend it: they are `document` with `follows`, the id of that export (one
   lineage per export, as long as the translator has not given up on storing that export). Saves
   are read and classified in parallel but sent in the order the app started them.
2. The page counts announced saves as pending, confirms receipt with `save-received` (and again
   while the requests it waits for make progress, at most once a minute), and stores the saves one
   after the other; a request that stalls is given up, and the save fails. For this it keeps,
   per open, a map from the names the app saves the document under to the Nextcloud files that
   hold it; at first its only entry is the name the app got, for the opened file. A save belongs
   to the open that was current when it arrived, also if the app frame reloads before it is
   stored.
   - `document` under a name in the map: replaces that file with a WebDAV `PUT` with `If-Match`
     and its ETag. `412 Precondition Failed` means someone else changed the file: the save
     becomes a conflict copy next to it, and the map sends later saves there. The same happens
     when the file has no usable ETag; a file the user may not change gets a new file.
   - `document` under a name not in the map, the app's own format (an opened PNG saved as
     `<stem>.psd`): a new file next to the original, which the map takes for that name, so later
     saves replace the new file.
   - `document` with `follows`: the app continues a save that came out as an export (PdfCraft
     after a full rewrite). It replaces the new file that export became, conditionally, and so
     do the later saves with the same `follows` (the export's lineage, kept per export id, not
     in the map: saves without `follows` still go to the opened file). On a conflict the copy
     becomes the lineage's file; for an export the page did not store, the first such save
     becomes a new file that the lineage then keeps.
   - `export`, a `document` of an earlier open, or an older `document` that arrives after a
     newer one was stored: a new file next to the original, every time.

   Every new file gets a free name, checked against the folder in any letter case and written
   with `If-None-Match: *`; nothing is overwritten.
3. The page reports `save-result`. If the page does not confirm in time or reports a failure,
   the translator downloads the file in the browser, as the app would without it. After a stored
   `document` without `follows`, the translator takes the stored bytes as the reference for the
   next save. An `export` under the opened file's name (PdfCraft) is remembered from the moment it
   is sent, for saves that continue it, and forgotten if the page does not store it (`ok: false`,
   or no answer in time).
4. The page warns before the user leaves once the app has the file, and while saves are pending,
   since the app does not expose unsaved changes. Close waits for pending saves before it removes
   the frame, which holds their fallback downloads. A save that fails after the frame's page was
   replaced is offered for download by the page itself.

The message details are in [protocol.md](protocol.md), the page's rules in
[nextcloud-app.md](nextcloud-app.md#what-it-stores).

## Files integration

- `lib/Listener/LoadFilesScripts.php` listens to Files' `LoadAdditionalScriptsEvent`, which Files
  dispatches only on its own page for a logged-in user. If at least one Craft app has a usable
  address, it puts those apps with their extension lists into the page's initial state and adds
  `js/files.mjs` as an init script, which runs before Files renders its list.
- `src/files.ts` registers two file actions per app with `registerFileAction` from
  `@nextcloud/files`: one for the extensions the app opens on a click (`DefaultType.DEFAULT`,
  order −20, so that it comes before the Viewer's, ONLYOFFICE's and Euro-Office's default actions
  where the administrator made the app the default app), one for the rest (action menu only,
  order 10). The click entry does nothing while Nextcloud's Viewer shows a file
  (`OCA.Viewer.file`): the Viewer writes `openfile=true` into Files' address when it opens a
  file, and Files then runs the default action, which for a type a Craft app took over as the
  default app is the click entry; so the Viewer's View keeps working. Where a click entry takes
  the place of another app's hidden default action (`DefaultType.HIDDEN`, as ONLYOFFICE and
  Euro-Office register theirs), one more action shows that one in the menu with its own name and
  icon, and runs its `exec` with `isDefault: false`, as the connectors' own menu entries do: run
  as the default, it would write `openfile=true` too, and Files would run the click entry. Files
  keeps its actions in a registry per major of `@nextcloud/files`
  (`window._nc_files_scope.v4_0` for 4.x), shared by every copy of that major on the page, so the
  copy bundled into `js/files.mjs` registers where Files reads. Nextcloud 34 and 35 ship 4.x.
- An action is offered for one file (not a folder), outside the trash, whose extension, in any
  letter case, is in the app's list and which may be downloaded: read permission, downloads not
  hidden, and no share attribute that turns downloads off. It opens the editor page with `?app=`.
- The extension lists exist only in `lib/Service/CraftApps.php`. The Files entries, the settings
  page and the config lexicon take them from there.
- The "+ New" entries: `lib/Listener/RegisterNewFileCreators.php` hands Nextcloud's
  `RegisterTemplateCreatorEvent` (its template API) to `lib/Service/NewFiles.php`, which
  registers a `TemplateFileCreator` per Craft app for the app's own format, and for the default
  app's Office or PDF format, only where a click opens that format in the app. The entry's icon
  is the app's 48 px PNG from `img/new/`, as a `data:` URI in an SVG. Nextcloud creates the file
  empty; `lib/Listener/FillNewFile.php`, the app's listener of `FileCreatedFromTemplateEvent`,
  registered to run after other apps' (priority −100), writes the blank document from `assets/`
  (made by `blanks.mjs`; WordCraft's, GridCraft's and PdfCraft's on A4 or, by the user's locale,
  on Letter), with the creation time or project name of the new file where the app keeps one.
  Files then opens the file with `?openfile=true`, which runs the click entry; the entry takes
  `openfile` out of the history entry before it leaves for the editor page.
- The Craft icons for file types: `lib/Service/MimeIcons.php` takes the place of the server's
  `IMimeIconProvider` (registered in `Application::register()`), which answers Files' requests for
  the icon of a file without a preview, and returns the icon in `img/types/` of the Craft app that
  opens the type, for users the app is enabled for; everything else goes to Nextcloud's provider.
  `lib/Service/FileTypes.php` gives the extensions Nextcloud does not know MIME types of their own
  in `config/mimetypemapping.json` (with aliases in `config/mimetypealiases.json`), from the app's
  install and post-migration repair steps, and takes them back in its uninstall step, which runs on
  every disable. `src/aliases.ts` hands those aliases to pages that pick icons in the browser.
  See [nextcloud-app.md](nextcloud-app.md#file-type-icons).

## Design decisions

| Decision | Why |
|---|---|
| A translator injected into `index.html` instead of changes to the apps | The apps update daily from upstream; the translator relies only on a few browser-facing behaviours, which the tests watch. |
| Bytes over `postMessage` instead of the apps' `?file=<url>` | `?file=` would need Nextcloud to serve the file to another origin, with the user's session or a token in a URL. With `postMessage` the file stays in the browser. |
| Open by simulating a drop | Dropping a file is how the web builds take files. |
| Save by intercepting downloads | Every save and export is a download in the web builds. The `Blob` is kept until the host confirms, so a failure ends in the download the user would have got anyway. |
| Two kinds, `document` and `export` | Only a recognised save of the opened file may replace it. Everything else is a new file. When in doubt, `export`. |
| Copies for saves with losses | WordCraft, GridCraft and CADCraft rewrite a file of another program from their own model and may drop what they do not model; DeckCraft and EffectCraft do the same with a file of a newer version of themselves. Such a save is the document but must not replace the original: the adapter says `copy`, the first save becomes a new file next to it and the later ones replace that file ([protocol.md](protocol.md#copies)). No message type of its own, so hosts that know continued exports store copies correctly. |
| Adapters set the apps' own switches | LightCraft keeps photos in the browser and EffectCraft restores old sessions unless their URL says otherwise. The adapter adds the switches (such as `store=memory`) to the frame's address before the app reads it, and the Nextcloud app refuses an app address with a query, so that no address turns them off or on by accident. |
| A save in another file type is a new file next to the original | The apps save in their own format (PhotoCraft writes a PSD for an opened PNG). Writing it over the original would change the original's type. Later saves of the same open replace the new file, so one document stays one file. |
| Inactive unless framed by an allowed origin over https | Outside the integration, the app behaves exactly as without the translator. |
| Hashes of opened files, not copies | Large scans would otherwise be held in memory two or three times. |
| Files matched by extension, not MIME type | Nextcloud has no MIME type for `.designcraft`, `.vectorcraft` or `.idml`. The app adds them for its icons, but only where `config/` can be written and nothing else defines them, and files keep their old type until they are retyped; the extension is always there. |
| Free names compared in any letter case; characters Windows forbids replaced | Sync clients on Windows and macOS cannot hold two names that differ only in case, and Windows clients cannot hold `<>:"\|?*`. |

## Upstream coupling points

What the layer relies on, and what happens if an upstream release changes it:

| Relies on | Used for | If it changes |
|---|---|---|
| The page dispatches `TrunkApplicationStarted` when the app has started | startup errors | A working app is not affected. An app that starts but cannot take files may be reported only after `data-startup-timeout`, as `the app did not start in time`. |
| FilmCraft, LightCraft and EffectCraft never dispatch `TrunkApplicationStarted` | their adapters' `started` checks: FilmCraft's waits until `#loading` is gone and reports `#status.err`, LightCraft's re-raises `LightCraft failed to load` / `failed to start` from `#lightcraft_loading` / `#lightcraft_status` | Without the check, a failed graphics start would give `ready` and `delivered` and no error; with a renamed element, `the app did not start in time` after the adapter's own deadline. For these apps only `data-startup-timeout` after `load` applies from the core, and the drop-target timer never runs. |
| The apps' own URL switches, which their adapters set: LightCraft `store=memory` and `workers=0`, EffectCraft `empty`, `nosw` and `storage=memory`, FilmCraft `fresh` | nothing kept in the browser, no restored session that a failed open would leave to be saved under the opened name, no service worker in the frame | LightCraft's and EffectCraft's `started` checks read what the app reports (`lightcraft.command('web.stats')`, `effectcraft.info()`) and stop every open with a startup error if a switch no longer takes effect. FilmCraft's `fresh` is checked by its `saved-as` test. |
| EffectCraft's `window.effectcraft` (`info()`, `execute('project.summary')`) and its Save writing `savedBy` first (Collect Files writes none) | the newer-version rule, telling a Save from other downloads under the opened name | If `info()` changes, every open stops with a startup error; if `project.summary` or `savedBy` change, saves under the opened name arrive as `export`: new files, nothing overwritten. The `contract` test fails. |
| A build's service worker is `sw.js` at its root (EffectCraft) | `inject-translator.sh` replaces it with one that unregisters itself | A worker under another name is not replaced. On the same site, browsers that hold it keep a cached page and translator until the app's next release. |
| A failed start shows as an error event before `TrunkApplicationStarted` (the loader awaits the `.wasm` module at its top level) | `the app failed to load` | The failure is reported only after `data-startup-timeout`, as `the app did not start in time`. |
| The app registers a `drop` listener with `addEventListener` | drop target, `ready` | No `ready`; the host gets `the app registered no drop target`. |
| VectorCraft removes its loading text (`#vectorcraft_loading`) once it can take files | the adapter's `started` check, `ready` | No `ready`; the host gets `the app did not get ready in time`. |
| The drop handler accepts synthetic events | opening files | `delivered` arrives, but the file does not open. |
| Downloads are a `Blob` from `URL.createObjectURL` behind a clicked `<a download>` | saves | The translator no longer sees them; the app's own behaviour (a browser download) applies. |
| PdfCraft's Save keeps the name and writes an incremental update | kind `document` | Saves arrive as `export`: new files, nothing overwritten. |
| The name PhotoCraft, VectorCraft, DesignCraft, WordCraft, GridCraft and DeckCraft give a save of the opened file, and the format they write it in | the adapters' `savedName` and `classify`, kind `document` | Saves arrive as `export`: new files, nothing overwritten. |
| What tells who wrote a file: `<Application>` in `docProps/app.xml` (WordCraft, GridCraft, with the parts GridCraft's writer produces), the generator in a `.deckcraft`, the DXF vocabulary of each CADCraft release (header start, APPID, object types, header variables, xdata applications, dictionary keys) | the adapters' choice between `document` and `copy` | A file of the app's own is taken for another program's: its saves arrive as copies, new files, nothing overwritten. Update the lists in the adapter. |
| The names the apps give new documents: `Document1` and its translations (WordCraft), `Book<N>` and the sample titles (GridCraft), `Presentation<N>` and `Northern Lights` (DeckCraft), `Drawing<N>` and `Bracket` (CADCraft), `Untitled` and `FilmCraft Demo` (FilmCraft), `Untitled Project` (EffectCraft); WordCraft's and DeckCraft's creation times | telling the opened document from a new one saved under its name | With other names, a new document's save under the opened name could pass as the document. The contract tests check these names and fail first. |
| PhotoCraft, WordCraft, GridCraft, DeckCraft, CADCraft and FilmCraft read the user's own files through the `files` getters of `DataTransfer` and `<input type=file>` (or `drop` and `change` events), and WordCraft's Finish & Merge copies the opened document's title and creation time | telling a save of the opened file from that of a same-named file from elsewhere, or from merged letters | Such files go unnoticed again; one saved under the opened name could pass as the document (see each app's known gaps). |
| Links use `window.open` (with `_self`) | keeping the editor in the frame; no `javascript:` or `data:` windows; no opener for pages of other origins | A link may replace the editor in the frame, or open with a handle on it. |
| Files keeps its actions in the registry of `@nextcloud/files` 4.x | the Files entries | The entries are missing. The canary's `nextcloud-next` job warns before a Nextcloud release with another major ships. |
| Files runs the first enabled default action by `order`, lowest first; the Viewer's has none (0), ONLYOFFICE's is −2, Euro-Office's −1 (11.0.6), Files' own open-in-files in Recent and Search −1000 | the default app setting: the click entry has −20 | An app whose default comes before −20 keeps the click; the test `default app` in `nextcloud-files.spec.ts` covers the Viewer and a hidden default at −1. |
| Other apps' actions are `IFileAction` objects in the same registry, and Files never shows a `DefaultType.HIDDEN` default in the menu; ONLYOFFICE's and Euro-Office's `exec` opens their editor when called with `isDefault: false`, as their own menu entries call it | the menu entry for the app whose click a Craft app took over | Without it, ONLYOFFICE or Euro-Office is not in the menu of their types while a Craft app is the default app, or their entry there does not open them; the test `default app` checks the entry with an office app of its own. |
| Nextcloud's Viewer sets `OCA.Viewer.file` while it shows a file, and writes `openfile=true` into Files' address when it opens one | the Viewer's View for a type a Craft app took over as the default app: the click entry does nothing while the Viewer shows a file | View on such a file opens the Craft app instead; the test `default app` (a PDF while PdfCraft is the default app) fails. |
| Nextcloud's template API: `RegisterTemplateCreatorEvent`, `TemplateFileCreator` with a non-empty inline SVG icon (Files stops starting without one; Nextcloud 35's Office app shows it as a CSS background, so the PNG inside is a `data:` URI), `FileCreatedFromTemplateEvent` with the new file and no template for a blank one, and Files opening the new file with `?openfile=true` | the "+ New" entries | No entries, or empty new files the Craft app cannot open; the test `new files` in `nextcloud-files.spec.ts` fails. |
| Euro-Office (11.0.6), ONLYOFFICE and Nextcloud Office write their own blank into every new file of their formats in `FileCreatedFromTemplateEvent`, at the default priority | a default app's new Office file | The Craft app's blank comes before theirs and is replaced: the file opens in the Craft app as another program's, and its first save is a copy. |
| What each Craft app accepts as its own new document: the formats, defaults and markers in `blanks.mjs` (WordCraft's and GridCraft's `<Application>`, DeckCraft's generator, CADCraft's DXF, FilmCraft's schema 15, EffectCraft's `savedBy`) | the blank documents | A new file opens, but its saves become copies or new files, or it does not open; the spec of each app with a "+ New" entry opens its blank (WordCraft's, GridCraft's and PdfCraft's both the A4 and the Letter one) and fails first (also in the canary). |
| A Files node's `id` is the file id as a string of digits (`fileid`, a number, is deprecated for 64-bit ids) | the editor URL of the Files entries | Without digits the entries are missing; the Files test fails. |
| Received shares are mounted as `ISharedStorage` with `IShare::canDownload()` (Nextcloud 34), and Files reads the `share-attributes` WebDAV property | refusing files shared without permission to download, on the server and in Files | A file shared that way could reach the Craft app. The test `shares` in `nextcloud-files.spec.ts` checks both and fails. |
| `window.OC.PasswordConfirmation`, Nextcloud's password dialog (deprecated since Nextcloud 28) | the password confirmation on the settings page | Saves skip the dialog; once the last confirmation is older than 30 minutes, the server answers 403 and the page asks to confirm the password. The settings test forces the dialog and fails. |
| Files runs a file action's `exec` within the user's click, and its own opening of a `/f/<id>` or `?openfile=true` link without one; `navigator.userActivation` tells them apart | the request token that lets the editor page open at once | Without user activation (or without `navigator.userActivation`) every open asks first; nothing is handed over unasked. |
| Nextcloud's server container still has `registerService` (deprecated since Nextcloud 20, internal in 36), and its `OCP\Preview\IMimeIconProvider` is `OC\Preview\MimeIconProvider` | the Craft icons in Files: `lib/Service/MimeIcons.php` takes the provider's place and passes everything but the Craft types to Nextcloud's | Without them the app does not replace anything, and Files shows Nextcloud's icons; nothing else changes. Re-test with every Nextcloud major. |
| Files shows a file without a preview with `/core/mimeicon`, or `/core/preview` with `mimeFallback`, both answered by the server's `IMimeIconProvider` (`usePreviewImage` in Files 34 and 35) | the Craft icons in Files | Files shows Nextcloud's icons again; the icon checks in `nextcloud-files.spec.ts` fail. |
| How each app takes its interface language at start: the preferences in `localStorage` of PdfCraft (`pdfcraft`, `language`) and PhotoCraft (`photocraft.preferences`, `interface.language`), VectorCraft's `?lang`, the browser's language as GridCraft, CADCraft and FilmCraft read it, LightCraft's `app.language.<name>` commands and EffectCraft's preference `general.language`, each with its own language codes | the language the administrator chose for the app | The app starts in its own language; the adapters never fail the start for it. `ready` still names the language where the adapter sets it before the app runs (PdfCraft, PhotoCraft, VectorCraft, GridCraft, CADCraft, FilmCraft); only LightCraft's and EffectCraft's adapters, which check the app's answer, then report `null`. Each app's `language` test fails, also in the canary (where it does not decide the run). A new language in a release is offered only once it is added to the adapter's table and to `CraftApps::APPS`. |

Most changes fail towards a download or a new file, not towards overwriting. The tests run
against the tested version of each app on every change and against the newest releases every
day (see [development.md](development.md#continuous-integration)), so a change is noticed before
a site that hosts it takes the new release. What each app does, and what its adapter relies on in detail,
is on its page in [`apps/`](apps/).

## Native embedding APIs

Upstream status as of 2026-10-17:

| App | Request or API | State |
|---|---|---|
| PdfCraft | [storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422) | open. PdfCraft 0.6.0 ships a `postMessage` bridge turned on by `?host=parent`, for a parent on the app's own origin only: under a Nextcloud on another origin it would drop every save, which is one reason the Nextcloud app refuses app addresses with a query ([apps/pdfcraft.md](apps/pdfcraft.md)). |
| PhotoCraft | [storytold/photocraft#1614](https://github.com/storytold/photocraft/issues/1614), [pull request #2263](https://github.com/storytold/photocraft/pull/2263) | open, not merged. Two hosts built a `postMessage` bridge on a fork (`?host=<origin>`), as the comments there describe. |
| FigCraft | [storytold/figcraft#759](https://github.com/storytold/figcraft/issues/759) (opening files in the browser) | open. The web build cannot get a file in or out yet: 0.6.0 opens nothing from a drop or File ▸ Open and saves nothing; `main` (after 0.6.0) hands saves to the browser as downloads, while a drop still imports into the open document instead of opening it. Not supported until a release does both. |
| FilmCraft, EffectCraft, LightCraft | `window.filmcraft`, `window.effectcraft`, `lightcraft.command` | JavaScript APIs on the app's own page, without `postMessage` or an origin check: the host cannot reach them. The LightCraft adapter uses `lightcraft.command('web.stats')` and the EffectCraft adapter `effectcraft.info()` and `effectcraft.execute('project.summary')` ([apps/lightcraft.md](apps/lightcraft.md), [apps/effectcraft.md](apps/effectcraft.md)). |

Pull request #2263 proposes `window.photocraft` and a `postMessage` API enabled with
`?embed=<origin>` in the app URL. When an app ships a native API:

- The host must not enable it (for example with `?embed=`) while it still relies on the
  translator: the frame would then answer two protocols.
- The translator should stand down when it detects a native API, and an adapter or the host
  should use the native API instead (planned).
- The native API's origin check comes from the URL, so `frame-ancestors` on the hosting stays
  necessary (see [security.md](security.md)).

## Versions

| What | Where | Current |
|---|---|---|
| Protocol | `version` in every message | 1 |
| Translator | `LAYER_VERSION` in `translators/core.js`, reported as `layerVersion` in `hello` and `ready` | 0.5.1 |
| Nextcloud app | `<version>` in `craftsuite_layer/appinfo/info.xml` | 0.5.1, Nextcloud 34 and 35 |
| Release | the tag `v<version>` | v0.5.1 |
| Supported apps, their oldest and tested versions | `apps.json` ([hosting.md](hosting.md#the-app-list)) | PdfCraft 0.8.0, PhotoCraft 0.9.0, VectorCraft 0.12.0, DesignCraft 0.8.0, WordCraft 0.7.0, GridCraft 0.7.0, DeckCraft 0.7.0, CADCraft 0.7.0, LightCraft 0.8.0, FilmCraft 0.8.0, EffectCraft 0.10.0, SoundCraft 0.7.0 (tested) |

The translator and the Nextcloud app share one version number, and a release carries both: the
app, and the translators with the injector for the hosting
([development.md](development.md#releasing)).
