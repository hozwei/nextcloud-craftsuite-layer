<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# EffectCraft

| | |
|---|---|
| Upstream | [github.com/storytold/effectcraft](https://github.com/storytold/effectcraft) |
| Adapter | [`translators/effectcraft.js`](../../translators/effectcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.8.0 when this page was written, checked again with 0.9.2) |
| Tests | [`tests/e2e/specs/effectcraft.spec.ts`](../../tests/e2e/specs/effectcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the EffectCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.9.2 source
and web build (first written for 0.8.0). Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source references
are to the `v0.9.2` tag (the web app's own files, `apps/effectcraft-web/`, are the same as in
0.8.0); `index.html` and `sw.js` are in `apps/effectcraft-web/web/`, `host.js` in
`apps/effectcraft-web/js/`, `app.rs`, `files.rs`, `api.rs`, `persist.rs`, `store.rs` and
`diskcache.rs` in `apps/effectcraft-web/src/`, the other paths are under `crates/`.

## What the web build does

**Startup**

- `index.html` is not a Trunk loader. Its own inline module script (`index.html:45-109`) defines
  `window.effectcraft` (an API for agents and tests, see [Upstream](#upstream)), registers the
  service worker `sw.js` unless the URL has `nosw` (`index.html:86-88`), compiles
  `effectcraft_web_bg.wasm` (61,523,317 bytes in 0.9.2) and calls `start()`. It never dispatches
  `TrunkApplicationStarted`.
- `start()` (`app.rs:185-273`) reads its URL flags, loads browser storage (every stored entry,
  imported media included, before the app runs: `persist.rs:70-90`), starts eframe and creates the
  app, which restores the last session (its project, path and unsaved changes, `persist.rs:188-231`)
  or opens the demo project. eframe then registers the first `drop` listener, on
  `canvas#effectcraft_canvas`, and `start()` removes `#loading`. The drop handler does not check
  `isTrusted`, so the translator's simulated drop works like a user's drop. The core's default drop
  target fits, and its `ready` comes when the app can take files. By then `effectcraft.info()`
  reports the storage backend and whether a session was restored (`app.rs:201`, `239-243`), which
  the adapter's `started` check reads.
- Without `TrunkApplicationStarted` the core never starts its drop-target timer, so
  `data-drop-target-timeout` has no effect. A start that fails before the drop listener (no
  WebGL2 and no WebGPU) reaches the host at once: the module script writes `EffectCraft failed to
  start` into `#status` and rethrows, and the host gets `the app failed to load: Uncaught failed to
  create wgpu surface ...`. A start that hangs is reported only `data-startup-timeout` after the
  page's `load` event (60 s by default), see [Hosting notes](#hosting-notes).
- Measured in the test setup (software WebGL): `ready` 1 to 9 s after the frame started loading
  (9 s with nothing cached), and `delivered` up to 7 s after `ready`, while the app draws its first
  frames.

**URL flags**

- `start()` reads query keys (values ignored, except for `storage` and `frameworkers`): `empty` (a
  blank project; no session restored, none kept), `demo` (the demo project), `home` (the start
  screen), `storage=opfs|indexeddb|memory`, `noworkers`, `frameworkers=<n>`, `nogpuworkers`
  (`app.rs:150-152`, `189-194`, `239`, `256`), and `index.html` reads `nosw`. The build's
  `HOSTING.md` also lists `?webgl` and `?cpu`; 0.8.0 and 0.9.2 read neither. There is no `?file=`,
  and none for the interface language (see [Interface language](#interface-language)).
- The adapter sets `empty`, `nosw` and `storage=memory` itself, see
  [How the adapter classifies](#how-the-adapter-classifies). The address configured in Nextcloud
  carries no query. The host's language comes as a fragment, which the core takes out of the
  address before the adapter runs.

**Opening**

- A dropped file is read into the app's file table under `/<name>` (`files.rs:61-65`, `273-289`)
  and goes to `open_or_import` (`app.rs:61-79`, `98-102`): a name ending in `.ecproj`, in any
  letter case, opens as the project (`engine/src/commands/file.rs:40-73`), replacing the open one
  without asking; anything else is imported as footage into the open project. The project's path
  is its table path, `/<name>`. File > Open Project… (Ctrl+O) does the same through an
  `<input type=file>` (`files.rs:256-271`, `app.rs:171-176`).
- A `.ecproj` whose content is the XML form (Save a Copy As XML, `<EffectCraftProject
  encoding="json">`) opens like the JSON one (`engine/src/xml_project.rs`). Since 0.9 its reader
  refuses elements nested more than 128 levels deep (`xml_project.rs:21-24`, `166-169`); such a
  file did not open in 0.8.0 either, whose JSON reader stops at that depth. A `.ecprojx` file is
  routed to import and fails (`unsupported media`): the web build opens XML copies only under a
  `.ecproj` name.
- A project that a newer EffectCraft wrote (`savedBy`, read from the whole file, newer than the
  app's version, `project/src/lib.rs:42-50`, `88-95`) opens with the warning that settings this
  version does not know are lost if it is saved (`engine/src/commands/file.rs:59-65`). A newer
  schema is refused: the project that was open before stays.
- Since 0.9 a project with values outside the app's limits (a frame larger than 30,000 pixels, a
  frame rate of 0, and the like, `project/src/limits.rs`) opens with them corrected and a notice
  (`engine/src/commands/file.rs:46-58`); Save then writes the corrected values. The compositions
  that were open when the file was saved (`activeComp`, `openComps`, see Saving) open again
  (`engine/src/lib.rs:897-910`).
- Footage is referenced by path: `/<name>` for files imported in the browser, absolute paths from
  the desktop app. Only data footage (JSON, CSV, TSV) is part of the project file. A project opened
  from Nextcloud shows its footage as missing; a dropped media file is imported as a new item and
  does not relink it.
- There is no JavaScript-visible signal that a project was opened or could not be opened. The host
  only gets `delivered`.

**Saving and downloads**

- Every download goes through one helper (`files.rs:85-108`): a `Blob` typed by the extension
  (`application/json` for `.ecproj`), `URL.createObjectURL`, an `<a download>` with
  `display: none` appended to `<body>`, `click()`, then the element is removed at once and the URL
  revoked after 60 s. Every file the engine writes is downloaded under the last part of its path
  (`files.rs:110-132`). There is no File System Access API for saving.
- Save (Ctrl+S) writes the project to its path, so an opened project downloads under the opened
  name, in the same letter case (`engine/src/commands/file.rs:105-118`). It is a full rewrite as
  pretty-printed JSON whose first member is `savedBy` (the app's version); since 0.9 the open
  compositions follow, `activeComp` (an id) and `openComps` (a list of ids, one per line), each
  left out when there is none (editor state that does not make the project unsaved,
  `project/src/lib.rs:52-65`, `engine/src/lib.rs:892-895`); then `schema` and the project
  (`project/src/lib.rs:1426-1448`). Then the project is marked clean, before the host has stored
  anything. Within one version the rewrite keeps everything; an XML-form `.ecproj` comes back as
  JSON (the format follows the name, `engine/src/commands/file.rs:97-103`).
- The web build never asks for a name: the save hook takes the suggested one (`app.rs:178`). The
  suggestion is always `Untitled Project.ecproj`, for Save of a project without a path (a new
  project, the demo, a blank start), for Save As… (Ctrl+Shift+S) and for Save a Copy…
  (`ui-egui/src/menus.rs:1229-1231`). After Save As, the project's path is
  `/Untitled Project.ecproj`, and every later Save writes that name. There is no counter: every
  untitled project saves under the same name.
- New Project (Ctrl+Alt+N), templates and a blank start leave the project without a path. A
  project file has no document identity: no creation stamp, no id (`project/src/lib.rs:1297-1312`),
  only `savedBy`, which every save rewrites.
- Auto-saves and the session snapshot go to browser storage only (`store.rs:277-350`,
  `persist.rs:186-206`), never to a download; with `storage=memory` they are gone on reload.
  Save as Template… also writes to browser storage only.
- On Windows and Linux the shortcuts use Ctrl (`Cmd` in the command table,
  `engine/src/commands/file.rs:709-719`). eframe takes Ctrl or Cmd for `Cmd`, so the tests press
  Ctrl, also in WebKit with Safari's user agent.
- Every other download has its own name. The names below were checked in Chromium, unless the
  table says otherwise; `<stem>` is the opened name without `.ecproj`.

| Download | Name | Kind |
|---|---|---|
| Save (Ctrl+S) of the opened project | the opened name, the whole project | `document` (`copy` for a project a newer EffectCraft wrote) |
| Save of another project (New Project, a template, File > Open Project… of a file from the user's disk) | `Untitled Project.ecproj`, or the name of that file | `export`; with the opened name see [How the adapter classifies](#how-the-adapter-classifies) |
| Save As… (Ctrl+Shift+S), Save a Copy…, and every Save after Save As | `Untitled Project.ecproj` | `export` |
| Increment and Save (Ctrl+Alt+Shift+S), and every Save after it | `<stem> 2.ecproj`, `<stem> 3.ecproj`, ..., never a name in the file table (`engine/src/autosave.rs:249-264`) | `export` |
| File > Dependencies > Collect Files… | each footage file under its name (`2_<name>` for a second one with the same name), then `<stem>.ecproj`, the opened name: the project with its footage paths rewritten to `/Collected Files/(Footage)/...`, written without `savedBy` (`engine/src/commands/file_more.rs:374-421`) | `export` |
| Save a Copy As XML… | `Untitled Project.ecprojx` | `export` |
| Composition > Save Frame As > File… (Ctrl+Alt+S) | `Frame.png` | `export` |
| Save Frame As > Photoshop Layers…, ProEXR… | `Frame.psd`, `Frame.exr` (not run) | `export` |
| Render Queue outputs | `<comp name>.<ext>` (`Comp 1.mp4`); several files, such as an image sequence, as one stored `.zip` named after the first of them (`files.rs:181-201`; not run) | `export` |
| Export > Lottie JSON…, Composition > Save Current Preview…, Animation > Save Animation Preset…, View > Export Guides, Export > Essential Graphics Template… | `Animation.json`, `Preview.mp4`, `Preset.ecpreset`, `Guides.json`, `Template.ectemplate` (`menus.rs:1227-1252`; not run) | `export` |
| File > Import > Essential Graphics Template… | nothing: on the web the picker hands the file to the drop path (`ui-egui/src/menus.rs:1303-1306`, `app.rs:163-170`), which imports it as media and fails (`unsupported media`). Only `window.effectcraft.execute('essential.importTemplate', {path})` imports a template; it downloads each file in the template's `media/` folder under the name the template gives it (`engine/src/commands/essential.rs:900-917`). File > Import > Lottie… and File > Scripts > Run Script File… also only hand the file to the drop path. | `export` |
| A script in Window > Script Console that writes a file (ExtendScript's `File`: `write`, `append`, `copy`, since 0.9 `writeBinary`) | the last part of the path the script names, with any content; opening a file for writing (`open('w')`) writes it empty first. Only while the user's Edit > Preferences > Scripting & Expressions… > Allow Scripts to Write Files and Access Network is on: off by default, under `storage=memory` off at every start, and not a script's to change (`script/src/runtime.rs:346-361`, `399-418`, `engine/src/commands/settings.rs:14`). | `export` while the setting is on (see [How the adapter classifies](#how-the-adapter-classifies)) |

**Links**

- The contributor links in Help > About EffectCraft are egui hyperlinks
  (`ui-egui/src/credits.rs:299`, `credits.rs:325`), which eframe opens with `window.open` and
  target `_self`. In a frame that would replace the editor; the translator opens them in a new
  window instead. Links the engine opens (`OpenUrl`) open a new tab anyway
  (`ui-egui/src/lib.rs:1576`).

**Service worker and storage**

- `sw.js` precaches the page, the glue, the `.wasm`, the workers and the icons into
  `effectcraft-<build hash>` and answers every same-origin `GET` from that cache first; every
  navigation gets the cached page, whatever its query (`sw.js:29-44`). It changes only with an
  EffectCraft release (0.9.2's differs from 0.8.0's only in the build hash and the snippet path in
  its file list). Once a browser has it, a changed `index.html` (other allowed origins,
  another translator) and changed translator files do not reach that browser until the next
  release, and the cached responses keep their old headers (`frame-ancestors`). A frame with
  `nosw` registers nothing, and browsers that partition storage keep a worker that a direct visit
  registered away from cross-site frames; but on the same site (`craft.example.com` next to
  `cloud.example.com`), such a worker controls the frames too. The hosting therefore replaces
  `sw.js`, see [Hosting notes](#hosting-notes).
- Storage: the frame's Origin Private File System (`effectcraft`), else IndexedDB
  (`effectcraft`), else memory (`host.js:10-102`), chosen with `storage=`. With
  `storage=memory` nothing of the user's files stays in the browser, except rendered frames: the
  disk cache writes them to the OPFS folder `effectcraft-cache/v1` (up to 5 GB by default) also in
  memory mode (`app.rs:113-116`, `diskcache.rs`). The IndexedDB database `effectcraft-handles`
  (Media Browser folders) is created too, and the page asks for persistent storage. All of this
  belongs to the hosting's origin, which other Craft apps on it share.

## How the adapter classifies

**The flags.** The adapter is a classic script that runs before the app's module script, and only
where the core is active (framed, an allowed origin configured, a secure context). It sets the
app's own flags in the frame's URL with `history.replaceState`: `empty`, `nosw` and
`storage=memory` (`storage` with another value is overwritten). They are needed for these
reasons:

- Without `empty`, the app restores the last session before the drop arrives. If the dropped
  project then cannot be opened (a newer schema, a damaged file), the restored project stays, and
  when it once came from a file of the same name, Save writes it under the opened name: it would
  replace the file in Nextcloud. This was reproduced with the app's defaults.
- Without `nosw`, every frame registers the service worker, which then serves the page and the
  translator from its cache (see above).
- Without `storage=memory`, every file opened from Nextcloud, media included, is copied into the
  frame's browser storage and read back at every start (which can push a start past the startup
  timeout), and the next user of a shared browser could see it.

The flags stay in the URL, so a reload in the frame (also the Reload button that EffectCraft shows
when the GPU device is lost) keeps them. The adapter's `started` check asks `effectcraft.info()`
whether they took effect: the storage must be `memory` and no session restored. Otherwise, or if
`info()` cannot be read, the host gets a startup error (`the app would keep the opened project in
browser storage (storage: opfs)`) and no file is handed over. So if upstream renames `empty` or
`storage`, nothing opens instead of the app's defaults coming back. The `contract` test checks the
flags in the frame's URL, that the app reports memory storage and no restored session, and that no
service worker is registered; the `saved-as` test checks the startup error with the flags
blocked.

**The rules.** There is no `savedName`: Save keeps the opened name. The core calls the adapter for
a download whose sanitised name is the opened name, and the adapter returns `document` only if all
of these hold:

- the name ends in `.ecproj` (any case), and its stem is not `Untitled Project`;
- the bytes start the way Save writes a project: `{`, `"savedBy": "<version>"`, since 0.9
  `"activeComp": <id>` and `"openComps": [<ids>]` where they are written, `"schema": <n>` (looked
  for in the first 64 KiB, as `openComps` has an id per line);
- no file with the opened name came from the user in this frame (see below);
- the opened file's `savedBy` was read, and the app's version too;
- right after the download, the app's own state says that this was a Save: `project.summary`
  through `window.effectcraft` (`api.rs:45-61`, `engine/src/commands/query.rs:32-70`) reports the
  opened name as the project's path (`/<name>`) and the project clean, and the setting
  `scripting.allowScriptsWriteFiles` (`prefs.get`) is off.

If the opened file was written by a newer EffectCraft, such a save is a `copy` instead: the first
one becomes a new file next to the opened one, and the later saves of the same open replace that
new file (see [protocol.md](../protocol.md#copies)). Otherwise `export`.

Why:

- **No prefix, no identity.** Save rewrites the whole project, so PdfCraft's prefix check does not
  apply, and the format has no document identity to tell projects apart. The name, Save's own
  format, the files that came in and the app's state decide.
- **`Untitled Project`.** Every new project, every Save As and every Save a Copy downloads
  `Untitled Project.ecproj`. With a file of that name open, nothing in the bytes tells a save of it
  from a new project's, so such a save is never the document (see [Known gaps](#known-gaps)).
- **The `savedBy` head.** Collect Files downloads `<stem>.ecproj`, the opened name, with the
  footage paths rewritten to folders that exist only in the browser. It is written with
  `Project::to_json`, which has no `savedBy`, so only this rule keeps it from replacing the opened
  file. The `contract` test checks it, so that a release that writes it with `savedBy` is noticed.
  The rule also keeps other downloads under the opened name that are not projects out.
- **A newer EffectCraft's file.** The app warns that saving such a file loses what this version
  does not know. The adapter's `identity` is not a document identity (there is none) but a mark of
  the opened file: `saved by a newer EffectCraft` when its `savedBy` is newer than
  `effectcraft.info().version`, compared as the app does (major, minor, patch; anything after `-`
  or `+` ignored). It reads the file as the app does: the top-level `savedBy` of the JSON, wherever
  it stands, or that of the XML form, which the app converts with a lenient reader of its own
  (`engine/src/xml_project.rs`: any attribute order, comments between elements, entities). The
  adapter carries a port of that reader, so that a `savedBy` the app finds is found here too. A
  file whose `savedBy` cannot be read (not UTF-8, neither JSON nor an XML form the app's reader
  takes, a `savedBy` that is not text), or an app whose version cannot be read, gets another mark
  that makes every save an `export`. A file without `savedBy` counts as not newer, as for the
  app. Saves of this version name this version, so they get no mark, and the core asks the
  adapter.
- **Files the user brings in.** A file the user drops from the desktop, or picks with File > Open
  Project…, File > Import or the Media Browser's Add Files…, lands in the same file table under its
  name. One with the opened name takes the opened project's place there (a drop and File > Open
  Project… also open it), and Save writes it under the opened name, as a valid project. The
  adapter watches the `files` getters of `DataTransfer` (only during a trusted `drop`) and of
  `<input type=file>`, which is how eframe and the app read such files (`files.rs:264-266`, the
  Media Browser's `host.js:620-635`), and records their names, cleaned up as the core cleans every
  save name. After one with the opened name, every save under that name is an `export` until the
  frame is reloaded. The translator's own drop is synthetic (`isTrusted` false) and does not
  count.
- **The app's state.** Engine commands other than Save can write a file named like the opened
  project, with project content: importing an Essential Graphics template downloads the files in its
  `media/` folder under the names the template chooses, and `file.saveCopy` or `file.save` with a
  path in another folder write the project itself. In 0.8.0 and 0.9.2 no menu reaches these (see the
  table), only `window.effectcraft` (the `contract` test uses it) and scripts, but a release may
  wire them up. Right after such a download the project has unsaved changes or another path; right
  after a Save it is clean, with the saved name as its path. The check also turns away a project
  whose path is not `/<name>`, such as one with a name that the core cleans up to the opened name.
  The engine answers on its next frame (about 0.1 to 0.5 s in the tests); with no API, an error, or
  no answer within 10 s, the save is an `export`.
- **Scripts.** With Allow Scripts to Write Files and Access Network on, a script in the Script
  Console can write any bytes under any name, also a project under the opened name in another
  folder, and the project stays clean under its path: `project.summary` cannot tell that from a Save
  (reproduced with 0.9.2: without this check such a file arrived as the document). So while the
  setting is on, every save under the opened name, Ctrl+S too, is an `export`. The setting is the
  user's alone: a script cannot change it (`engine/src/commands/settings.rs:14`), and under
  `storage=memory` it is off at every start. The `contract` test turns it on, has a script write
  another project under the opened name while the project is clean, checks that it arrives as a new
  file, and turns it off again. Scripts that run engine commands (`file.saveCopy`, `file.save` with
  a path) are covered by the state check above.

## Interface language

**How EffectCraft picks it.** From its setting `general.language` (`engine/src/prefs.rs:25-39`),
which the web build keeps with its other settings in `config/prefs.json` in its browser storage
(`store.rs:12-16`, `293-300`) and loads before the app runs (`app.rs:194`, `235`). The default,
`system` (Match System), means English in the web build, which has no system-locale probe
(`ui-egui/src/i18n.rs:65-77`). The page reads neither the browser's language nor a URL option for
it (checked with the browser locales `es-ES` and `ja-JP`, with `navigator.languages` made Spanish,
and with `?lang=es`). Under the adapter's `storage=memory` the store is empty at every start (a
`Map` inside `host.js:81-89` that the page cannot fill), so without the host's language
EffectCraft starts in English in Nextcloud, whatever the browser's or the user's language. The app
reads the setting on every frame (`ui-egui/src/lib.rs:1844-1853`, `i18n.rs:18-28`): a change
applies on the next one.

**What the adapter does.** Nothing reaches EffectCraft's language before it runs, so the adapter
uses its automation call: `effectcraft.execute('prefs.set', {key: 'general.language', value})`
(`engine/src/commands/settings.rs:21-43`), which changes neither the project nor its undo
history. When the host names a language, the adapter's `language` member looks it up in its
`LANGUAGES` table (the same tag, else the same language and script: `es-ES` and `es-419` find
`es`, `pt-PT` finds `pt-BR`), and `started()` sends that call with EffectCraft's code (`pt-br` for
`pt-BR`) after its `info()` checks. `ready` waits for the answer and reports the tag only if
EffectCraft took it. The call goes out as the loading screen goes away, and EffectCraft takes it on
its next frame (about 0.1 s later in WebKit, 0.2 to 0.4 s in Chromium with software rendering on
the test machine), so the first frames can still show English. If EffectCraft refuses
the call (after a release renamed the setting or a code) or does not answer within 10 s, the start
goes on without it: the adapter logs a warning, `ready` has `language: null`, and there is no
startup error. Without a host language, or with one EffectCraft lacks, nothing is sent and `ready`
has `language: null`. A reloaded frame gets the language again: the core keeps it in the frame's
name, and the adapter sends the call at every start.

**Languages.** The Nextcloud app's settings offer the keys of `LANGUAGES`: `en`, `es`, `pt-BR` and
`uk`. EffectCraft 0.8.0 has seven languages, 0.9.2 eleven, and the setting takes only `system` and
their codes: `en`, `ja`, `zh-hans`, `zh-hant`, `uk`, `es`, `pt-br` and, since 0.9, `ru`, `fr`,
`de` and `cs` (anything else, such as `it` or `es-ES`, is refused, `prefs.rs:665-671`). Left out
are Japanese and both Chinese: the web build installs no font for their scripts
(`ui-egui/src/theme.rs:386-393`), so their labels draw as boxes. `LANGUAGES` does not have the four
languages 0.9 added either: an entry needs the Nextcloud app's list too, and 0.8.0 refuses their
codes (it then starts in English, see above). There is no Italian; with such a language
EffectCraft starts in English. A language a later release adds needs an entry in `LANGUAGES` and
in the Nextcloud app's list first.

**Partial translations.** Spanish, and since 0.9 Russian, French and German, translate only the menu
bar and its menus (`ui-egui/src/i18n.rs`). The panels, dialogs and tooltips stay English: their
catalogs exist only for Japanese, both Chinese, Ukrainian and, since 0.9, Brazilian Portuguese and
Czech (`ui-egui/src/i18n/ui.rs:42-58`); Ukrainian, Brazilian Portuguese (in 0.8.0 the menus only)
and Czech translate the menus and part of the panels. The name every new project saves under stays
`Untitled Project.ecproj` (`app.rs:178`, `ui-egui/src/menus.rs:1229-1231`), and nothing else the
adapter's rules read (`savedBy`, `project.summary`) depends on the language: they hold in every
language.

**A language the user picks.** Edit > Preferences > General… (Ctrl+Alt+;,
`engine/src/menus.rs:661-662`) > Language offers Match System and all of EffectCraft's languages; a
choice applies at once (Japanese and Chinese then draw as boxes). Under `storage=memory` it is kept
in the frame's memory only: it lasts until the editor is closed or the frame reloads, and the next
start is in the host's language again (in English without one). The host is not told; `ready`
reported the language the app started in. Outside the integration, with its default storage,
EffectCraft keeps the choice in the origin's browser storage and starts in it the next time; a frame
with `storage=memory` never sees that choice.

## Known gaps

- **Files named like a new project are never saved back.** An opened `Untitled Project.ecproj`
  saves as a new file every time (`Untitled Project (2).ecproj`, ...): a new project's save has the
  same name, and nothing in the file tells the two apart. Renaming the file in Nextcloud before
  opening it avoids that.
- **Save As always makes a new file.** Save As… names the file `Untitled Project.ecproj`, and every
  Save after it writes that name, each a new file. Save (Ctrl+S) is the way to save back.
- **A same-named project the adapter does not see.** Should a release read dropped or picked files
  another way (`DataTransfer.items`, the File System Access API) and store them under `/<name>`, a
  file with the opened name from the user's disk goes unnoticed and its saves pass as the
  document; the path check does not tell it from the opened file, which has the same path. (In
  0.8.0 and 0.9.2 the Media Browser's Open Folder… reads through the File System Access API, but it
  only imports media, and its files keep the path `/Folders/<folder>/<name>`.) The same holds for a
  file a script on the app's page adds with `window.effectcraft.addFile`, or writes into the opened
  file's place in the app's file table: a template imported through `window.effectcraft` with a
  `media/` entry named `media//<opened name>` (an absolute path) replaces the app's copy of the
  opened file (that download itself is an `export`: the project has unsaved changes), and after
  File > Revert or Open Recent its content saves as the document (reproduced). Should a release
  let the menus import templates, a crafted template could do this; telling it from a Save that
  the user edits right after would need more of the app's state than `project.summary` gives. The
  `saved-as` test fails in the first case. Nextcloud's file versions (where enabled) keep the
  previous state.
- **After a file from elsewhere with the opened name**, every later save under that name is an
  export, also a save of the opened project, until the frame is reloaded.
- **While scripts may write files** (Allow Scripts to Write Files and Access Network on), every
  save under the opened name is an export, Ctrl+S too, until the user turns the setting off again
  or the frame reloads.
- **The state check depends on `window.effectcraft`.** If a release removes or changes
  `effectcraft.execute('project.summary')` or the setting `scripting.allowScriptsWriteFiles`
  (`prefs.get`), every save is an export (the `contract` test fails). Nothing is overwritten.
- **The flags are a coupling.** If upstream renames `empty` or `storage`, or changes what
  `effectcraft.info()` reports, the `started` check stops every open with a startup error until the
  adapter is fixed. If it renames `nosw`, frames register the service worker again (which the
  hosting replaces with one that removes itself). The `contract` test checks all three.
- **Rendered frames stay in the browser.** The disk cache writes rendered frames to the origin's
  OPFS (`effectcraft-cache/v1`, up to 5 GB) also with `storage=memory`. On a shared computer the
  next user of the same browser profile could recover pictures of a project from them. The adapter
  does not turn the cache off (that would need more of `window.effectcraft`); upstream could make
  `storage=memory` cover it.
- **Copies of a newer EffectCraft's file.** Its saves go to a new file next to it, written by this
  version, which lacks what the newer version wrote. The opened file stays as it is.
- **Footage is missing** in projects opened from Nextcloud (browser or desktop paths), and a
  dropped media file does not relink it. Collect Files uploads each footage file as a new file.
- **No unsaved-changes signal.** The host cannot tell whether the user has unsaved edits and must
  warn on close. With `empty` and `storage=memory` there is no session or auto-save to come back to
  after a reload.
- **`delivered` is not "opened".** The host cannot tell whether EffectCraft could read the file; a
  project it cannot open shows an error in its status bar only, and the blank project stays.
- **Saved means downloaded.** EffectCraft marks the project saved when the download starts. If
  the host cannot store the file, the translator's fallback browser download is the copy the user
  keeps.
- **Memory.** Projects are small (kilobytes to a few megabytes), but an imported media file is
  copied into the 4 GiB wasm memory about twice; very large videos may fail inside the app while
  the host only sees `delivered`.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so EffectCraft
  cannot start there.

## Hosting notes

- EffectCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no
  isolation headers (no COOP/COEP). It asks not to send `X-Frame-Options: DENY` or a
  `frame-ancestors` that excludes the embedding page. For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`.
- The web build renders with wgpu: WebGPU where the browser has it, else WebGL2. With neither it
  fails at once, see [Startup](#what-the-web-build-does). The tests run on WebGL2 (Chromium with
  SwiftShader, WebKit).
- The `.wasm` file of 0.9.2 has 61,523,317 bytes, 18.4 MB with gzip at level 9 (0.8.0: 60,021,784
  and 17.9 MB; `HOSTING.md` says about 10 MB with Brotli for 0.3.1). Serve it compressed, preferably
  precompressed.
- Its file names carry no hash (`effectcraft_web.js`, `effectcraft_web_bg.wasm`, `worker.js`,
  `audio-worklet.js`), so they must be revalidated (`Cache-Control: no-cache`), as `HOSTING.md`
  says; a year-long `immutable` cache for `*.js` and `*.wasm` would keep browsers on the old
  version after an update in place.
- **Service worker.** `inject-translator.sh` replaces `sw.js` with a worker that serves nothing,
  deletes the `effectcraft-*` caches and unregisters itself, and keeps the original as
  `craftsuite-layer/sw.js.orig` (see [hosting.md](../hosting.md#service-workers)). The adapter's
  `nosw` keeps frames from registering it; the replacement removes a worker that a direct visit
  registered before. EffectCraft then no longer starts offline from the hosting.
- **Startup timeout.** The core's `data-startup-timeout` (60 s by default) runs from the page's
  `load` event, which comes before the 60 MB `.wasm` has been downloaded and compiled. On a slow
  connection the start can take longer: the host then gets `the app did not start in time` for an
  app that is still loading, and `ready` after it once the app has started (the error is
  provisional, see [protocol.md](../protocol.md#errors)). A `data-startup-timeout="180000"`
  (3 minutes) on the `core.js` tag avoids that: `inject-translator.sh --startup-timeout 180000`
  (see [hosting.md](../hosting.md#startup-timeout)).
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `ecproj` | the project; Save replaces the file (one named `Untitled Project.ecproj` gets a new file per save; one a newer EffectCraft wrote gets a copy next to it) | yes | yes: no other app opens it |

Match the extension in any letter case, as EffectCraft does. Nextcloud 34 and 35 do not know the
type (`application/octet-stream`), so the app must pick EffectCraft by extension. For the
EffectCraft icon in Files the Nextcloud app registers `application/x-effectcraft` for it
([nextcloud-app.md](../nextcloud-app.md#file-type-icons)).

Do not offer anything else:

- `ecprojx` and `xml`: a drop does not open them on the web (the XML form opens only under a
  `.ecproj` name), and `xml` is generic.
- Media (`mp4`, `mov`, `webm`, `gif`, `png`, `jpg`, `psd`, `svg`, `pdf`, `wav`, `mp3`, `glb`, ...)
  and data (`json`, `csv`): they are only imported into a blank project. Each save is then a new
  `Untitled Project.ecproj` that points at the file by a path that exists only in that browser.
  The Viewer, the PDF viewer and the office apps own these types.
- `aep` and `aepx`: EffectCraft reads neither.

## Tests

`effectcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`effectcraft-chromium` and `effectcraft-webkit`. The behaviour the core shares with every app
(fallback downloads, a foreign host, startup errors) is tested in `translator.spec.ts` and
`pdfcraft.spec.ts`; this spec checks what depends on EffectCraft.

The spec has four tests, and its header lists them with their scenarios. `contract` and `saved-as`
are the contract tests; the canary runs them apart from the `language` test (tagged `@language`) and
the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version; the frame's URL carries `empty`, `nosw` and `storage=memory`, the app reports memory storage and no restored session, and no service worker is registered. A new composition saved with Ctrl+S arrives as the document under the opened name, a project file as Save writes it with the edit (with 0.9.2 also the open compositions between `savedBy` and `schema`), and so does a second one. Collect Files (from the command palette), under the opened name and without `savedBy`, Save Frame As (`comp.saveFrameAs` with `Frame.png`, the path its shortcut Ctrl+Alt+S asks for, through `window.effectcraft`: right after the command palette the shortcut opened the palette again on GitHub's runner), another project under the opened name that a Script Console script (`script.run`) writes to another folder while Allow Scripts to Write Files is on (`prefs.set`, off again afterwards) and the project is clean under its path, a project file under the opened name written while the project has unsaved changes (`file.saveCopy`) or saved to another folder (`file.save` with a path), both through `window.effectcraft` because no menu of the web build gives them a path, Save As (Ctrl+Shift+S) and the Save after it, and the save of a new project (Ctrl+Alt+N) arrive as new files. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | An opened `Untitled Project.ecproj` saves as a new file. The blank of the Nextcloud app's "+ New" entry, `blank.ecproj` as in `craftsuite_layer/assets/` (EffectCraft's New Project with `savedBy` 0.8.0), opens (`project.summary`: its path, no composition), and its first Ctrl+S, without an edit, is the document. A project a newer EffectCraft wrote, with `savedBy` after `schema`, saves as a copy: the first save is a document that follows its own id, the next one, after an edit, a document that follows the first; the XML form of such a project under a `.ecproj` name, written as only the app's lenient reader takes it (another attribute, a comment, an entity), saves as a copy too. The XML form of this version saves as the document, as JSON. A different project named like the opened one, opened with File > Open Project (Ctrl+O) or, in Chromium, dropped from the desktop, saves as an export after a first save as the document. With the adapter's `history.replaceState` blocked, so that the flags do not take effect, the host gets a startup error and nothing is opened. |
| `language` | The host names Spanish (`lang=es`): `ready` reports `es`, EffectCraft's setting `general.language` is `es` (`prefs.get`), File > Save reads `Guardar` in its menus (`ui.menu.list`), and the probe opens as without a language (`project.summary`: its path, `Comp 1`). With `lang=it`, a language EffectCraft lacks (0.8.0 and 0.9.2), the host gets no error, `ready` reports no language, and EffectCraft stays in its own: `general.language` is `system`, File > Save reads `Save`. |
| `ui` (`@ui`) | The File menu with the pointer: Save saves the document; Save As > Save a Copy… arrives as a new file. |

A test with several scenarios (`saved-as`, `language`) runs each in a page of its own and reports
every scenario that fails as `scenario failed: <title>`, not only the first. The drop from the
desktop needs the DevTools protocol, so WebKit notes it as a skipped scenario. Each scenario loads
the 60 MB app, so `saved-as`, with eight, runs with a tripled timeout (`test.slow()`).

The tests drive EffectCraft with its shortcuts from the command table
(`engine/src/commands/file.rs`, `comp.rs`, `comp_more.rs`: Ctrl+N and Enter for a new composition,
Ctrl+S, Ctrl+Shift+S, Ctrl+Alt+S, Ctrl+Alt+N, Ctrl+O) and its command palette (Edit > Quick Apply…,
Ctrl+Shift+Space, `engine/src/commands/frontend.rs`, `ui-egui/src/panels/dialogs.rs:543-603`) for
Collect Files…, which has no shortcut. The palette matches the labels in the app's language
(`ui-egui/src/panels/dialogs.rs:560-565`), so only the `language` test has the host name a language,
and it reads EffectCraft's state through `window.effectcraft` instead of typing. Only the `ui` test
also clicks with the pointer; its click positions are in the `AT` table of the spec, measured on
0.8.0 (and still right in 0.9.2) at a 1400x900 viewport with the locale `en-US` and EffectCraft in
English (File menu rows 26 px apart, in the order of `engine/src/menus.rs`). When a new release
fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the flags, the
  drop routing (`app.rs:61-102`), the download helper (`files.rs:85-132`), Save's format
  (`project/src/lib.rs:1426-1448`; 0.9 added the open compositions to its head, which failed the
  canary until the adapter knew them), Collect Files' format, the untitled name, the newer-version
  rule, `project.summary` or the setting `scripting.allowScriptsWriteFiles`. The rules fail towards
  new files, not towards overwriting. Sites that host the app should hold the release back until the
  adapter is fixed.
- **Only the `@ui` test fails.** A menu item moved. Compare the File rows of
  `engine/src/menus.rs` with `AT` and re-measure; the translator is not at fault.
- **Only the `language` test fails.** The release changed the setting `general.language` or its
  codes (`engine/src/prefs.rs`), `prefs.set`, or the Spanish menu catalog (`ui-egui/src/i18n.rs`).
  Update `LANGUAGES` in the adapter; until then EffectCraft starts in English whatever the host's
  language, and opening and saving work as before (the adapter fails open for the language).
- **A shortcut or label changed upstream.** The tests that use it fail. Check them against the
  command table and `menus.rs` before holding a release back.

The fixtures in `tests/e2e/fixtures/effectcraft/` were made with EffectCraft 0.8.0, because the
project format needs the app's complete model: `craftsuite-probe.ecproj` is a blank project with
a new composition (Ctrl+N, Enter) and a solid (Ctrl+Y), saved with Ctrl+S and renamed;
`craftsuite-probe.ecprojx` is Save a Copy As XML of it. The tests derive the other files they
open from these two: the probe under the name `Untitled Project.ecproj`, the probe with
`savedBy` 99.0.0 after `schema`, the XML copy with `savedBy` 99.0.0 (`<m t="s" n="savedBy">`, a
comment, `99&#46;0.0`), and the probe with its composition renamed `Elsewhere 1` (the user's other
project).

## Upstream

EffectCraft has no embedding API for another origin. `window.effectcraft` (`index.html:50-84`,
`api.rs`) is a same-origin control API (engine commands, `addFile`, `readFile`, `saveToBrowser`,
`flush`) without `postMessage`, so the Nextcloud page cannot use it; the translator, which runs on
the app's origin, uses `info()`, `execute('project.summary')`, `execute('prefs.get')` (whether
scripts may write files) and, for the host's language, `execute('prefs.set')`. Worth reporting
upstream: a document identity in `.ecproj` (a creation stamp that every save keeps); Save As
suggesting the current name; a ready signal (EffectCraft dispatches no `TrunkApplicationStarted`);
the disk cache ignoring `storage=memory`; the service worker's update behaviour (cached pages with
their old headers until the next release); the `?webgl` and `?cpu` flags in `HOSTING.md`, which
0.8.0 and 0.9.2 do not read; and a way to start in a language, such as a URL option or the browser's
language for Match System (the web build has no system-locale probe, `ui-egui/src/i18n.rs:65-77`),
so that the first frames are not English.
