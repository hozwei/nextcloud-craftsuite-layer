<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# VectorCraft

| | |
|---|---|
| Upstream | [github.com/storytold/vectorcraft](https://github.com/storytold/vectorcraft) |
| Adapter | [`translators/vectorcraft.js`](../../translators/vectorcraft.js) |
| Tested version | `tested` in [`apps.json`](../../apps.json) (0.10.0 when this page was last checked) |
| Tests | [`tests/e2e/specs/vectorcraft.spec.ts`](../../tests/e2e/specs/vectorcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the VectorCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.10.0
source (and the eframe 0.36.2 crate it uses) and web build. Source references are paths in the
upstream repository at tag `v0.10.0`. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice.

## What the web build does

**Startup**

- The page has `<canvas id="vectorcraft_canvas">` and `<div id="vectorcraft_loading">` with a
  loading text. Rendering goes through wgpu: WebGPU where the browser has it, else WebGL2
  (`apps/vectorcraft-web/src/web.rs:142-151`).
- Once the WebAssembly module is initialised (around Trunk's `TrunkApplicationStarted` event),
  the app takes its Web Locks for Data Recovery and loads its startup fonts (Noto Sans Arabic and
  Noto Sans Thai in 0.10.0, none in 0.8.0 and 0.9.0; see [Hosting notes](#hosting-notes)), then
  registers a `drop` listener of its own on the canvas, which only follows the pointer during
  file drags, and then starts the graphics (`web.rs:57-82`, `93-127`, `184-196`). eframe's `drop`
  listener, the one that reads the dropped files, comes only after the graphics and the app have
  been created (eframe `src/web/web_runner.rs:76-94`). A drop in between is lost: in Chromium
  the file did not open in 4 of 4 tries when the host sent it right after a `ready` that was
  based on the first listener (WebKit opened it; tried with 0.8.0, whose page code 0.9.0 and
  0.10.0 keep unchanged).
- When the graphics run, the page removes `#vectorcraft_loading` (`web.rs:129-133`). When they
  cannot start, it fills that element with `<p>` lines instead, `VectorCraft failed to start:
  <reason>` and `A browser with WebGPU or WebGL2 is required.` (`web.rs:134`, `286-308`). The
  pointer listener exists in that case too.
- If the graphics are lost later, the app starts them again on a new canvas element that
  replaces the old one, with the same documents (`web.rs:257-263`, `325-341`).
- The page reads `?webgl` (forces WebGL2) and `?lang=<code>` (`web.rs:142-175`, see
  [Interface language](#interface-language)). It does not read `?file=` or `?cpu` (the latter is
  listed in the build's `HOSTING.md`).

**Opening**

- eframe takes every file of a drop and does not check `isTrusted` (eframe
  `src/web/events.rs:976-1000`), so the translator's simulated drop works like a user's.
- For each dropped file VectorCraft decides: with no document open, the file opens as a new
  document; with a document open and the drop point on the canvas, the file is placed into that
  document (`crates/ui-egui/src/place.rs:301-316`, `web.rs:354-378`). A second `open` into the
  same frame therefore ends up inside the first document. Hosts open one file per frame.
- Some types are not documents: a `.wasm` file installs a plug-in, preset files
  (`.vcpdfpresets`, `.vcflattener`, `.vcprintpresets`, `.vcperspective`) are imported, and
  library files (`.vcswatches`, `.gpl`, `.ase`, `.acb`, `.vcstyles`, and `.vclibrary` for the
  Libraries panel) load into panels; since 0.10.0 also when they are dropped on the canvas of an
  open document (`crates/ui-egui/src/io.rs:80-101`). A PDF with several pages or a password, and
  a DXF drawing, first open an import dialog that the user answers (`io.rs:21-58`).
- The document's title: an import is named after the file, with its extension; a native file
  keeps the title stored in it (`document.title`), unless that is empty
  (`crates/engine/src/cmd/fileio/load.rs:192`, `256-260`). The tab shows the title. A
  template (`.vctemplate`, `.ait`, or a native file marked as template) opens untitled
  (`Untitled-1`, `load.rs:330-336`).
- A dropped file has no path in the app (`web.rs:360`: only the name), so Save cannot write it
  back without asking.
- There is no JavaScript-visible signal that a file was opened, could not be opened, or has
  unsaved changes. A file VectorCraft cannot read shows a message box `Can't open “<name>”.`,
  drawn in the canvas, and `Couldn't open ...` in its status bar
  (`crates/ui-egui/src/lib.rs:884-892`, `io.rs:151-155`; before 0.9.0 only the status bar); the
  host only gets `delivered`.

**Saving and downloads**

- Every download goes through one helper: a `Blob` typed after the name's extension
  (`.vectorcraft` as `application/json`), `URL.createObjectURL`, a hidden `<a download>`
  appended to `<body>`, `click()`, removed again, and the URL revoked after 10 seconds
  (`web.rs:500-530`). No File System Access API, no IndexedDB.
- The first Save (Ctrl+S) of a dropped file opens VectorCraft's Save As dialog, drawn in the
  canvas. It suggests `<title without extension>.vectorcraft`, with the name selected and
  focused, and the format VectorCraft; Enter confirms, Escape cancels
  (`crates/engine/src/cmd/fileio/save.rs:221-229`). The translator can neither see nor answer
  it. The name the user confirms becomes the document's path, and later Saves write it without
  asking (`save.rs:588-597`). Save is enabled for a document without a path even when it is
  unchanged, and afterwards only when there are changes (`crates/ui-egui/src/menus.rs:1938`).
- Saves rewrite the whole file: UTF-8 JSON, or gzip with Use Compression (off by default,
  `crates/engine/src/lib.rs:957`). Since format version 4 the JSON may be followed by binary data
  for large images, after the bytes `\n\0VCBLOBS\0` (`crates/format/src/lib.rs:1-31`, `56`,
  `166-192`). A dropped `.vectorcraft` that was compressed is saved uncompressed unless the user
  ticks Use Compression. Since 0.10.0 a compressed save is written as it is encoded (one gzip
  stream, already compressed images in stored blocks), and VectorCraft reads up to 1 GB of JSON
  from a compressed file (`MAX_JSON`, `lib.rs:66-77`), up from 512 MB.
- The other formats are re-encodings of what VectorCraft could read. Its own warning before
  overwriting a lossy import ("Replace ..., the file this document was opened from?") needs the
  document's path, so it never applies to dropped files (`load.rs:328`, `342`).
- File > New names a document `Untitled-N`, counting from 1 in each session; opening a file does
  not count (`crates/engine/src/lib.rs:1185-1191`, `crates/engine/src/cmd/newdoc.rs:569-573`). Its
  first Save suggests `Untitled-N.vectorcraft`. Save never changes the stored title (only File >
  File Info does, `crates/engine/src/cmd/fileinfo.rs:57`), so a drawing made with File > New keeps
  `Untitled-N` inside, whatever its file is called. With such a file open, the first new
  document's Save suggests the same name as the opened drawing's.
- A native file can store its creation time (`document.metadata.created`, Unix seconds, shown in
  File > File Info; `crates/doc/src/metadata.rs:59`). The desktop app sets it at File > New and,
  where it is missing, on the first save to a file (`save.rs:95-99`, `get_or_insert`); nothing
  changes it afterwards, and loading and saving keep it. The web build has no clock
  (`crates/doc/src/metadata.rs:85-94`, `save.rs:420-429`, `newdoc.rs:575`): it sets it neither
  for a new document nor on a save, so a drawing made in the browser has none.

| Download | Name | Kind |
|---|---|---|
| Save (Ctrl+S), Save As (Ctrl+Shift+S) with format VectorCraft | the name confirmed in the dialog; suggested `<stem>.vectorcraft` | `document` if it is the suggested name of the opened file or the opened name of a `.vectorcraft`, else `export` |
| Save As with another format (PDF, SVG, SVG Compressed, `.ai`) | `<stem>.<ext>`, possibly the opened name | `export` |
| Save a Copy (Ctrl+Alt+S) | `<stem> copy.vectorcraft` | `export` |
| Save as Template | `<stem> template.vctemplate` | `export` |
| Save as PDF | `<stem>.pdf` | `export` |
| Save for Office Documents | `<stem>.png` | `export` |
| Export As SVG, Export As PNG, Export As | `<stem>.svg`, `<stem>.png` (the opened name, for an opened SVG or PNG) | `export` |
| Export for Screens | `Artboard-1.png` and the like | `export` |
| Print | no download: the PDF goes into a hidden frame and the browser's print dialog (`web.rs:532-581`) | none |

`<stem>` is the document's path without its extension, or before the first Save its title
without its extension (`save.rs:223`, `crates/engine/src/cmd/fileio/mod.rs:707-709`). 0.10.0 adds
no download; its Links > Find in Folder… needs a folder picker and is disabled on the web
(`crates/ui-egui/src/menus.rs:1983`).

**Links**

- VectorCraft opens its links (the Help links, and since 0.9.0 the contributor names in About >
  Contributors) through its `open_url`, which in the web build hands the URL to egui as a new
  tab on the next frame; eframe then calls `window.open(url, '_blank')`
  (`crates/ui-egui/src/lib.rs:677-684`, `1054-1056`, `crates/ui-egui/src/credits.rs:283-290`;
  eframe `src/web/mod.rs:351-358`). So the window opens one frame after the click, outside the
  click's event handler. The tests' Chromium and WebKit open it; whether a browser's popup
  blocker lets it through was not checked (Playwright's browsers allow popups).
- Up to 0.8.0 the contributor names were egui hyperlinks, which eframe opens with target
  `_self`: in a frame they would have replaced the editor. 0.9.0 and 0.10.0 have no such link
  left. The translator's `window.open` still opens `_self` in a new window, and gives a page of
  another origin no `window.opener` (see [protocol.md](../protocol.md#links)).

## How the adapter works

**`started()`.** The core sends `ready` once the app registered its first `drop` listener, which
in VectorCraft is the pointer listener that comes before the graphics. The adapter's `started()`
holds `ready` back until `#vectorcraft_loading` is gone, which happens only after eframe
installed its own `drop` listener. When the element shows `<p>` lines instead, `started()`
rejects with `the app failed to start: <the lines>`, and the host gets that as an error of
`startup` (see [protocol.md](../protocol.md#errors)) instead of waiting. The lines are in the
language the app starts in (see [Interface language](#interface-language)). After 120 seconds
without either it rejects with `the app did not start in time`, but with the default
`data-startup-timeout` (60 seconds) the core has reported `the app did not get ready in time`
before.

**`dropTargetTimeout`.** 45 seconds instead of the core's 3. The core waits this long from
`TrunkApplicationStarted` for the app's first `drop` listener and otherwise reports `the app
registered no drop target` to the host (provisionally: `ready` still follows if the listener
comes later). In VectorCraft that first listener is the pointer listener, which the page adds
right before it starts the graphics (`web.rs:94`), so this wait does not include the graphics
start; `started()` covers that. It does include what the page does before: it takes its Web
Locks and fetches its startup fonts, one after the other, each with a limit of 20 seconds
(`web.rs:66-69`, `apps/vectorcraft-web/src/fonts.rs:16`, `28-36`). The 0.8.0 and 0.9.0 builds
fetch no fonts (they have no `fonts/` folder) and add the listener right after their start; the
0.10.0 build fetches Noto Sans Arabic and Noto Sans Thai from its `fonts/` folder (see
[Hosting notes](#hosting-notes)), which on a slow connection takes longer than 3 seconds and at
worst 40 seconds. The adapter had 30 seconds up to 0.9.0, enough for one font. Should a release
drop the pointer listener, eframe's, added after the graphics start, would be the first, and the
45 seconds would have to cover the graphics start as well. A `data-drop-target-timeout` on the
script tag still wins.

**`dropTarget()`.** The simulated drop goes to `canvas#vectorcraft_canvas`, looked up at each
open, because a graphics restart replaces the canvas element.

**`savedName()`.** The name VectorCraft's Save As dialog suggests: the stem of the title stored
in a native file (`.vectorcraft` or `.drawcraft` with native content), else the stem of the
opened name, plus `.vectorcraft`. Native content is JSON whose first 256 bytes name
`vectorcraft` or `drawcraft`, possibly gzip-compressed (`crates/format/src/lib.rs:558-572` sniffs
the same way). The adapter parses the JSON only up to the first NUL byte, so that the binary data
of a version 4 file does not hide the title (JSON text never contains a NUL byte). It unpacks a
gzip file as a stream with `DecompressionStream`, stops at the first NUL byte, and gives up
(falling back to the opened name) beyond 512 MB of JSON (`MAX_UNPACKED`, VectorCraft's own limit
up to 0.9.0) or when the first 256 unpacked bytes are not native. So a small file that unpacks to
gigabytes cannot exhaust the frame's memory, and the image data after the JSON is never unpacked.
VectorCraft 0.10.0 reads up to 1 GB of JSON (`crates/format/src/lib.rs:66-77`); the save of a
document whose JSON alone is larger than 512 MB (large images go after the JSON) becomes a new
file. With this, the core finds the opened file for a save under the suggested name.

**`identity()`.** The creation time stored in a native file, or none. The core keeps it with the
opened file (and takes it from each stored save of the document), and sends a save whose
creation time differs from the document's as an `export` without asking `classify()` (see
[protocol.md](../protocol.md#saves)).

**`classify()`.** `document` only if the save's name is the opened file's `savedName` or its
opened name, ends in `.vectorcraft`, the bytes are native, and the save can be told from a new
document's: if the opened document has a creation time, the save has it too (another one never
reaches `classify()`); if it has none, the save's name is not `Untitled-<n>.vectorcraft`.
Everything else is an `export`. The reasons:

- The native format is the only lossless save. An SVG, PDF or `.ai` written under the opened
  name is a re-encoding of what VectorCraft could import, and Export As in the opened file's own
  format also arrives under the opened name (an opened `probe.svg`, Export As SVG: `probe.svg`).
  A name rule alone would overwrite the original with an export.
- A save under the suggested name of an import (`probe.svg` saved as `probe.vectorcraft`) or of
  a renamed native file is still the opened document. The Nextcloud editor stores the first such
  save as a new file next to the original, and later saves under that name replace that file.
- A native save under the opened name is the opened document too: a user who types the file's
  own name over the suggestion in the first Save As dialog (a `.vectorcraft` renamed in
  Nextcloud, whose stored title is still the old name or `Untitled-1`) means that file, and the
  Nextcloud editor replaces it. This adds nothing for other files: an import's opened name does
  not end in `.vectorcraft`, so an SVG or `.ai` written under it stays an `export`, and for any
  other `.vectorcraft` the opened name is the suggested one already.
- After a stored `document` save, the core records the saved name, so the next Ctrl+S, which no
  longer asks, is the `document` again.
- A new document (File > New) is `Untitled-1` in every session and suggests
  `Untitled-1.vectorcraft`, which is also the name a drawing made with File > New suggests, and
  often its file name. A drawing from the desktop app carries a creation time that every save
  keeps and a new document of the web build lacks, so the two are told apart. A drawing without
  one (made in the browser, or an import before its first stored save) cannot be told from a new
  document under that name, so such a save is never the document: a new file, nothing
  overwritten.

Examples, all checked with 0.9.0 in Chromium and WebKit, and again with 0.10.0 by the spec:

| Opened file | First Ctrl+S, Enter | Kind |
|---|---|---|
| `craftsuite-probe.vectorcraft`, stored title the same | `craftsuite-probe.vectorcraft` | `document`, also every later save |
| `renamed-probe.vectorcraft`, gzip, stored title `craftsuite-probe.svg`, data after the JSON | `craftsuite-probe.vectorcraft` (plain JSON) | `document` (a new file next to the original) |
| the same | `renamed-probe.vectorcraft`, typed over the suggestion (plain JSON, stored title unchanged) | `document` (replaces the original), also every later save |
| `probe.svg` | `probe.vectorcraft` | `document` (a new file next to the original), also every later save |
| `probe.svg`, then Export As SVG | `probe.svg` | `export` |
| `Untitled-1.vectorcraft` from the desktop app (stored title `Untitled-1`, a creation time) | `Untitled-1.vectorcraft` | `document` (replaces the original) |
| the same, then File > New and its first Save | `Untitled-1.vectorcraft` (no creation time) | `export` |

## Interface language

**In the web build.** VectorCraft draws its interface in the language set in Edit > Preferences…
(Ctrl+K) > User Interface > Language: Auto by default, the system's language
(`crates/engine/src/lib.rs:690-692`, `913`, `crates/ui-egui/src/lib.rs:954-960`). The page works
that out once, as the module starts and before the first frame: the first of `?lang=<code>` in its
address, `navigator.languages` and `navigator.language` that names one of its languages, else
English (`apps/vectorcraft-web/src/web.rs:153-172`, `crates/ui-egui/src/i18n/mod.rs:250-317`).
A region is cut off (`de-AT` is German; Chinese without a script picks one by region), but
neither `pt` nor `pt-PT` finds `pt-br`. Only the first `lang=` counts, taken as written; an empty
or unknown one falls through to the browser's languages. A `lang` that arrives after the module
started (at `TrunkApplicationStarted`, for example) changes nothing. The same step writes the
loading text in that language, and the lines shown when the graphics cannot start are
translated too (`web.rs:163-165`, `303`), so the host's error of `startup` carries them in that
language (French: `Le démarrage de VectorCraft a échoué : ...`).

**`language()`.** The adapter puts the host's language into the frame's address as
`lang=<VectorCraft's code>` (`history.replaceState`) inside `register()`, so before the module
reads it, and returns the key it applied, which `ready` reports (see
[protocol.md](../protocol.md#host-settings)). It matches the host's tag against its `LANGUAGES`
table (`de-AT` finds `de`, `pt-PT` finds `pt-BR`) and passes VectorCraft's own code. With a tag
that has no match, or no host language, it leaves the address as it is, so VectorCraft starts as
without the setting: in the browser's languages, or in a `lang` the host put into the address
itself (the Nextcloud app's addresses have no query). A reloaded frame starts in the host's
language again (the translator keeps it in the frame's name). VectorCraft also
follows `navigator.languages`, so `util.preferLanguages()` would do should `?lang` go away.

**Languages.** The Nextcloud app offers the keys of `LANGUAGES`: `en`, `cs`, `de`, `es`, `fr`,
`it`, `ja`, `pt-BR`, `ru` and `uk`. Three of VectorCraft's others are left out because the web
build draws them with missing glyphs, seen again with 0.10.0 although its build carries a Chinese
face: Simplified Chinese (`zh-hans`) in many labels, menu titles included, Traditional Chinese
(`zh-hant`) in the title of the Help menu, and Korean (`ko`, new in 0.10.0) everywhere, as its
Hangul needs an installed font (`crates/ui-egui/src/i18n/mod.rs:91-94`), which the web does not
have. Hungarian (`hu`, new in 0.10.0, `i18n/mod.rs:150-153`) draws completely but is not offered
yet: that needs the Nextcloud app's list in `CraftApps.php` as well as the adapter's table, and
0.9.0 would start in the browser's language instead. Since 0.10.0 Czech and Brazilian
Portuguese translate the whole interface too, status and error messages and the loading text
included (`i18n/mod.rs:95-97`, `154-164`; up to 0.9.0 Czech translated only the menus, and
Brazilian Portuguese no messages). Japanese, Russian and Ukrainian draw without missing glyphs.

**A language picked in the app.** Preferences > User Interface > Language (Auto and VectorCraft's
fourteen languages, `crates/ui-egui/src/prefs_dialog.rs:336-342`) switches the interface at once.
The web build stores no preferences (see [Hosting notes](#hosting-notes)), so the choice lasts
until the frame reloads, and the next start is in the host's language again (or the browser's);
the host is not told. Should VectorCraft keep the choice one day, it would win over the host's
language, which only stands in for Auto.

The rest of the adapter does not depend on the language: the names the Save As dialog suggests
come from the document's title or file name, and new documents are `Untitled-<n>` in every
language (`crates/engine/src/lib.rs:1185-1191`).

## Known gaps

- **The first Save asks.** The dialog is VectorCraft's own and inside the canvas; the user has to
  confirm it. Any other name than the suggested one (or, for an opened `.vectorcraft`, its own
  name), or another format, makes that save and every later Save under that name an `export`: new
  files, nothing overwritten.
- **Renamed files suggest their stored title.** For a `.vectorcraft` renamed in Nextcloud, or one
  whose stored title is `Untitled-1`, the dialog suggests `<stored title>.vectorcraft`. Confirmed
  with Enter, that save is the document (for `Untitled-<n>` only with a creation time, see the
  next point), but the Nextcloud editor stores it next to the opened file instead of replacing
  it; to save back into the opened file, the user has to type its name over the suggestion.
  Saving under either name keeps the stored title (only File > File Info changes it,
  `crates/engine/src/cmd/fileinfo.rs:57`), so the next session suggests it again.
- **Drawings named like a new document.** A drawing without a creation time (made in the
  browser) is never saved under `Untitled-<n>.vectorcraft` as the document, because a new
  document's save looks the same: with the stored title `Untitled-1`, Enter on the suggestion
  makes that save and every later one a new file. Typing the opened file's own name in the first
  Save As dialog saves back, unless that name is `Untitled-<n>.vectorcraft` too; such a file has
  to be renamed in Nextcloud first.
- **Another document with the same name.** A document that is not the opened one but saves under
  the opened file's suggested or own name passes as `document` when the creation times cannot
  tell them apart: both have none (made in the browser) or the same (copies of one file). This
  can be a file the user opens from their own disk (File > Open, or a drop next to the canvas), a
  Data Recovery copy (see below), or a new document the user gives that name. Saves named
  `Untitled-<n>.vectorcraft` are covered above. Nextcloud's file versions (where enabled) keep
  the previous state.
- **Imports are never saved in place.** An opened SVG, PDF, `.ai`, EPS, DXF, EMF or WMF is never
  replaced; its edits go into `<stem>.vectorcraft` next to it (see
  [How the adapter works](#how-the-adapter-works)). The same holds for a `.drawcraft` (the
  format's former name): VectorCraft saves it under a `.vectorcraft` name (suggested:
  `<stored title>.vectorcraft`), never under the `.drawcraft` name
  (`crates/engine/src/tests_save.rs:211-224`), so the Nextcloud editor stores the first save as a
  new file next to it and later saves replace that file.
- **`delivered` is not "opened".** The host cannot tell whether VectorCraft could read the file,
  and the import dialogs of a multi-page or password PDF and of a DXF wait for the user.
- **No unsaved-changes signal.** The host must warn on close. VectorCraft writes Data Recovery
  copies of modified documents every 2 minutes into the frame's `localStorage`
  (`crates/engine/src/lib.rs:924-925`, `web.rs:449-498`). A copy left behind makes a later start
  show Recover Documents over the opened file; a restored copy saves under its own title, and if
  that is the opened file's suggested name, or the opened name of a `.vectorcraft`, it arrives as
  `document`. Nextcloud's file versions (where enabled) keep the previous state.
- **Print is not a save.** Print hands a PDF to the browser's print dialog. A browser without a
  PDF viewer (headless Chromium, for example) downloads it as `<uuid>.pdf` instead, which the
  translator does not see.
- **Close and New.** VectorCraft's Ctrl+W (Close) and Ctrl+N (New) are browser shortcuts in
  ordinary browser windows and may close the tab or open a window instead (not tested here); the
  File menu has both.

## File types

What VectorCraft 0.10.0 opens as a document from a drop (`OPEN_EXTS` in
`crates/engine/src/cmd/fileio/mod.rs:591-617`, unchanged since 0.9.0; the format is detected by
content first, `load.rs:62-101`), and what the Nextcloud app offers (`CraftApps::APPS` in
`craftsuite_layer/lib/Service/CraftApps.php`): "open with" is the entry "Open in VectorCraft" in
the action menu of Files. The MIME types are those of Nextcloud 34 and 35; types without one
arrive as `application/octet-stream`, so the app matches by extension. For the VectorCraft icon in
Files the Nextcloud app registers types for `vectorcraft` and `drawcraft`
(`application/x-vectorcraft`), `eps` (`image/x-eps`, instead of the `application/postscript` it
shares with `.ps`), `svgz` (`image/svg+xml-compressed`), `wmf` (`image/wmf`) and `dxf`
(`image/vnd.dxf`) ([nextcloud-app.md](../nextcloud-app.md#file-type-icons)).

| Extensions | Nextcloud MIME type | In VectorCraft | Offer |
|---|---|---|---|
| `vectorcraft` | none | native, saves back | open with, default |
| `drawcraft` (former name) | none | native; saves go to `<stored title>.vectorcraft`, a new file next to it, which later saves replace | open with, default |
| `ai` | `application/illustrator` | PDF-compatible or PostScript `.ai`; saves go to `.vectorcraft` | open with (not the default: Nextcloud's PDF viewer, shipped and enabled by default, registers `application/illustrator` and takes the click) |
| `eps` | `application/postscript` | imported | open with, default |
| `svgz` | none | imported | open with, default |
| `dxf` | none | DXF Import Options first | open with, default (CADCraft takes the click when it has an address too, see [nextcloud-app.md](../nextcloud-app.md#files)) |
| `emf`, `wmf` | `image/emf`, none | imported | open with |
| `svg` | `image/svg+xml` | imported | open with (Nextcloud's viewer shows SVG) |
| `pdf` | `application/pdf` | imported, pages picked in a dialog when there are several | open with (the PDF viewer stays the default; PdfCraft has an entry too) |
| `ps` | `application/postscript` | read as EPS (detected by content) | not offered: multi-page PostScript documents are not drawings |
| `af`, `afdesign`, `afpub` | none | Affinity import of a subset, sometimes only the embedded preview | not offered for now |
| `ait`, `vctemplate` | none, none | open untitled, so saves never come back as the document | not offered |
| `png`, `jpg`, `jpeg`, `gif`, `webp`, `tif`, `tiff`, `bmp` | `image/...` | a document with the picture embedded | not offered (PhotoCraft's) |
| `psd`, `psb` | `application/x-photoshop`, none | since 0.9.0: a document with the merged image embedded (`crates/engine/src/cmd/fileio/psdread.rs`) | not offered (PhotoCraft's) |
| `wasm`, preset and library files | not relevant | change the app's settings (see [Opening](#what-the-web-build-does)) | never |

"Default" means a click in Files opens VectorCraft; it is meant only for types that no common
Nextcloud app opens. `ai` stays a plain "open with": in Nextcloud 34 and 35 the PDF viewer
(`files_pdfviewer`) opens `application/illustrator` on a click, so VectorCraft takes `.ai` only
as the default app. `emf` and `wmf` stay a plain "open with": they are mostly pictures from
office documents, and whether an office integration claims them was not checked. An
administrator can make VectorCraft the default app
([nextcloud-app.md](../nextcloud-app.md#configuring)): then a click opens all the types offered in
VectorCraft, also `ai`, `svg`, `emf`, `wmf` and `pdf`; a PDF still goes to PdfCraft when that is
the default app too, and a `.dxf` to CADCraft while it has an address.

## Hosting notes

- VectorCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no
  special headers (no COOP/COEP), not to send `X-Frame-Options: DENY` or a `frame-ancestors` that
  excludes the embedding page, and for a sandboxed iframe at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`. Print also needs
  `allow-modals`; the Nextcloud editor's frame has it.
- WebGPU needs a secure context; elsewhere the app falls back to WebGL2. Without either it
  cannot run, and the host gets `the app failed to start: VectorCraft failed to start: ...`.
- The 0.10.0 `.wasm` is 61.7 MB (about 23 MB with gzip, 18 MB with Brotli at quality 6;
  `HOSTING.md` still says about 13 MB and 5 MB). Compression and long caching of the hashed files
  matter.
- The 0.10.0 build is the first with a `fonts/` folder: Noto Sans Arabic (845 KB) and Noto Sans
  Thai (219 KB), each in `fonts/<hash>/`, which the page fetches before the app starts, one after
  the other, each with a limit of 20 seconds and checked against its SHA-256
  (`apps/vectorcraft-web/src/fonts.rs`, `crates/text/web-fonts.txt`), and so before its first
  `drop` listener. The background families `HOSTING.md` mentions (about 8 MB of Arabic fonts) are
  not in the build. The folder has to be served with the rest of the build (`.ttf` as `font/ttf`,
  as the build's `_headers` and `.htaccess` do); without it the app still runs, logs `web font …`
  and shows Arabic and Thai text as boxes. On a slow connection, the core's default
  `data-drop-target-timeout` (3 seconds) would report `the app registered no drop target` before
  `ready` follows, so the adapter sets `dropTargetTimeout` to 45 seconds (see
  [How the adapter works](#how-the-adapter-works)). A site that sets `data-drop-target-timeout` on
  the script tag overrides that and should not go below it.
- Data Recovery copies live in the frame's `localStorage`
  (`apps/vectorcraft-web/src/web.rs:449-498`); browsers that partition or block third-party
  storage may forget them between visits. Preferences are not stored at all, although
  `HOSTING.md` says they are kept there: the web build has no store for them (`web.rs:395-447`;
  eframe's persistence is not enabled), so a choice made in Edit > Preferences, the interface
  language too, lasts until the frame reloads.
- Keyboard shortcuts reach the app after the user clicks into the frame.

## Tests

`vectorcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`vectorcraft-chromium` and `vectorcraft-webkit`. The fixtures in
[`tests/e2e/fixtures/vectorcraft/`](../../tests/e2e/fixtures/vectorcraft/) are written by its
`make-fixtures.mjs`: a native file, a renamed one (gzip, another stored title, an image after the
JSON) and an SVG. The spec has five tests, and its header lists them with their scenarios. The first
three are the contract tests; the canary runs them apart from the `language` test (tagged
`@language`) and the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open, which the host sends the moment `ready` arrives; that the file really opened shows in the save, which holds the opened drawing. An edit saved with Ctrl+S and Enter in the Save As dialog arrives as the document; a second Ctrl+S saves without asking, as the document again. Save as PDF arrives as an export. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `another name` | An SVG saves as `probe.vectorcraft`, the document, twice, while Export As SVG under the opened name stays an export. A renamed native file saves under its stored title, as the document; saved under its opened name instead (typed over the suggestion in the Save As dialog), it is the document too, also on the second Ctrl+S. `Untitled-1.vectorcraft` as the desktop app writes it (stored title `Untitled-1`, a creation time; made from the native fixture in the spec) saves as the document, keeping its creation time, and a new document (File > New) saved under the same name arrives as an export. The blank of the "+ New" entry in Files (`craftsuite_layer/assets/blank.vectorcraft`: an empty stored title, so the Save As dialog suggests the file's name, and a creation time) opens, and its first save (Ctrl+S and Enter, without an edit) arrives as the document `blank.vectorcraft` (no `follows`) and not as a browser download. |
| `startup` | Without WebGPU and WebGL2: the host gets one error, of `startup`, with VectorCraft's own message, and no `ready`. The startup fonts (0.10.0 and later) are held back 3.5 s each, longer than the core's default wait for a drop target, and bring no earlier error (`the app registered no drop target`); the step's title names the fonts held back, or says the build has none. |
| `language` | The host's `fr`, in the frame's fragment, with the browser at `en-US`: `ready` reports `fr`, the frame's address has `lang=fr` and no fragment, and the loading text, recorded in the frame as it changes, was `Chargement de VectorCraft…`. The other tests run without a host language: the `startup` test expects VectorCraft's English message, and the `@ui` positions were measured in English. |
| `ui` (`@ui`) | The paths that need pointer clicks: File > Save and OK in the Save As dialog save the document; File > Export > Export As SVG and OK in SVG Options give an export; the link to a contributor in About > Contributors opens a new window and the editor stays. |

The tests drive VectorCraft with the keyboard and the command palette (Ctrl+Shift+/); a name
typed into the Save As dialog replaces the suggestion through Ctrl+A in its field and arrives as
one text insertion, without key events. The palette runs the first command whose label or id
contains every typed word (`crates/ui-egui/src/palette.rs:76-117`), and some labels match other
commands first, so the tests type command ids (`file.newDialog`, `file.export.pdf`,
`file.export.svg`, `help.about`) from `crates/ui-egui/src/menus.rs`. Only the `ui` test also
clicks with the pointer; its click positions are in the `AT` table of the spec, measured on 0.9.0
(still right for 0.10.0) at a 1400x900 viewport with the locale `en-US`. The entries of the File
menu and its Export submenu are given from the File title (`FILE`), under which egui opens the
menu, and the dialog buttons from the frame's centre, where the modals are anchored: 0.9.0, which
dropped the app menu "VectorCraft" before File and made the menu bar lower, needed only `FILE`
re-measured. After the menu clicks the test checks that Save As or SVG Options opened, and after
OK that it closed (the focus is in their text field meanwhile), so a click that missed names the
`AT` entries to re-measure. When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on (see
  [architecture.md](../architecture.md#upstream-coupling-points)). Sites that host the app should hold the
  release back until the adapter or the core is fixed. Three failures point at this adapter:
  "Ctrl+S opened the Save As dialog" failing means the file was lost (check `#vectorcraft_loading`
  and `started()`); a save of the expected name arriving as `export` means `savedName()` no longer
  matches the suggested name (check the stored title and the native format) or, in the
  `Untitled-1.vectorcraft` scenario, that Save no longer keeps the creation time; and `the app
  registered no drop target` in the `startup` test means the startup fonts now take longer than
  `dropTargetTimeout` covers (check `crates/text/web-fonts.txt` and `fonts.rs`).
- **Only the `language` test fails.** The release no longer takes `?lang` before its module
  starts, or words its French loading text differently (then only the test needs the new text).
  Check `detect_language()` in `apps/vectorcraft-web/src/web.rs` and the adapter's `language()`;
  until then the host's language has no effect, while opening and saving are not affected.
- **Only the `@ui` test fails.** A menu entry or dialog button moved. Re-measure the positions in
  `AT` that its message names (for a moved File title, `FILE` alone); the translator is not at
  fault.
- **A command id or shortcut changed upstream.** The tests that use it fail. Check it against
  `menus.rs` and `crates/engine/src/cmd/` and update the spec.

## Upstream

No embedding API has been requested from VectorCraft yet. What would make the adapter simpler
and the saves exact:

- the dropped file's name as the document's name or path, so that Save suggests (or reuses) it
  and a renamed file saves back;
- a creation time (or another id that every save keeps) in documents of the web build too, so
  that a new document can be told from the opened one;
- eframe's `drop` listener installed together with the pointer listener, or an event once the app
  takes files (a user's drop during startup is lost today as well);
- an embedding API like the one proposed for PhotoCraft (open bytes, save callbacks, unsaved
  state; see [architecture.md](../architecture.md#native-embedding-apis));
- current size figures in `HOSTING.md`, and a fonts section that matches the build (0.10.0 ships
  two startup faces, not the 8 MB of Arabic families it describes).
