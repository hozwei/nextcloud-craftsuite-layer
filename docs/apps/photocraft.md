<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# PhotoCraft

| | |
|---|---|
| Upstream | [github.com/storytold/photocraft](https://github.com/storytold/photocraft) |
| Adapter | [`translators/photocraft.js`](../../translators/photocraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.6.0 when this page was written) |
| Tests | [`tests/e2e/specs/photocraft.spec.ts`](../../tests/e2e/specs/photocraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the PhotoCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.6.0
source and web build; source references are to the `v0.6.0` tag. Upstream may change any of
them; the daily canary run (see [development.md](../development.md#continuous-integration)) is
there to notice.

## What the web build does

**Startup**

- The loader is Trunk's inline module script in `index.html`. It imports
  `photocraft-web-<hash>.js`, awaits the `.wasm` module and then dispatches
  `TrunkApplicationStarted` (`index.html:16` of the web build).
- Only then does the app start: it first loads its brush presets from IndexedDB
  (`photocraft.presets`) and waits up to 10 s for them (`apps/photocraft-web/src/web.rs:63-72`,
  `indexed_presets.rs:13`). After that, eframe starts and registers its drop listener on
  `canvas#photocraft_canvas` (`web.rs:24`, `74-102`). Normally the gap is 0.1 to 0.2 s; with a
  storage that never answers it was 10.2 s.
- It renders with WebGPU and falls back to WebGL2 on its own (`HOSTING.md` of the web build). In
  headless Chromium and in WebKit the tests run on WebGL2.

**Opening**

- It takes dropped files on its canvas through eframe. The drop handler does not check
  `isTrusted`, so the translator's simulated drop works like a user's drop; the core's default
  drop target fits.
- On the web, every dropped file opens as a new document tab, also while a document is open: the
  web shell takes the dropped files, reads them asynchronously and opens each one
  (`web.rs:286-299`, `crates/ui-egui/src/lib.rs:1211-1217`). It never places a dropped file into
  the open document.
- The document's name is the file name, unchanged. The file has no path on the web
  (`lib.rs:910`: "a bare name isn't a location to save back to").
- The decoder is chosen by content, with routes by name only for `.pcraft`, Affinity, `.pdn` and
  `.svg` (`crates/io/src/lib.rs:187-219`, `crates/codecs/src/format.rs:216-263`). The MIME type
  the host sends does not matter. Brush, gradient and swatch files go to the preset libraries and
  open no document (`crates/ui-egui/src/preset_files_ui.rs:16`); see [File types](#file-types).
- Files also reach the app from the user: a drop from the desktop, and File > Open (Ctrl+O), a
  file picker (`<input type=file>` through rfd, `web.rs:354-366`). Each opens as another tab.
- There is no JavaScript-visible signal that a file was opened or could not be opened. Two
  prompts can appear on open: the embedded-profile mismatch prompt (on by default, for images
  with an ICC profile other than the working space) and the Camera Raw dialog for raw files
  (`lib.rs:918-930`). The host only gets `delivered`.

**Saving and downloads**

- Every download goes through one helper: a `Blob` typed by the extension
  (`image/vnd.adobe.photoshop` for `.psd`, `image/png`, ... else `application/octet-stream`),
  `URL.createObjectURL`, an `<a download>` (hidden, appended to the body), `click()`, removal; the
  object URL is revoked after 10 s (`web.rs:393-429`). No File System Access API.
- Save and Save As show no dialog on the web: the suggested name becomes the download name
  (`web.rs:367-371`). Because the document has no path, Save goes through Save As, which suggests
  the document's name with the extension replaced by `.psd`, or `.pcraft` for a `.pdn`
  (`lib.rs:985-999`), and lowercases the extension (`crates/ui-egui/src/file_dialog.rs:107-135`,
  preference on by default, `crates/engine/src/prefs.rs:377`). So `photo.png` and `Photo.PSD`
  save as `photo.psd` and `Photo.psd`; only a PSD opened under a lowercase `.psd` name comes back
  under its own name.
- A save writes the whole file (PSD version 1; PSB version 2 under the `.psd` name above
  30000 px or 2 GB, `crates/io/src/psd_export.rs:1145-1147`). There is no incremental update.
- After a save, the document takes the saved name (`crates/engine/src/file_cmds.rs:137-145`),
  and later saves write that name again.
- PhotoCraft then marks the document saved and shows "Saved <name>", without knowing whether the
  host stored it.
- Other downloads keep the stem, so a flat export can have the opened file's own name:

| Download | Name | Kind |
|---|---|---|
| Save (Ctrl+S), Save As (Ctrl+Shift+S) | `<stem>.psd` (`<stem>.pcraft` for a `.pdn`), full rewrite | `document` when the adapter's rules hold, see below |
| File > Export > Quick Export as PNG | `<stem>.png`, flattened | `export` |
| File > Export > Export As (Ctrl+Alt+Shift+W) | `<stem>.png`, `.jpg`, `.webp`, `.tif` or `.tga` | `export` |
| Layer > Quick Export as PNG | `<layer name>.png` | `export` |
| Save for Web (Legacy) | `<stem with _ for other characters>.gif`, `.png`, `.jpg`, `.wbmp`, or `.html` with images | `export` |
| Swatch, preset, measurement exports | `Swatches.<ext>`, `Presets.pcpresets`, `Measurements.csv` | `export` |

`<stem>` is the document's name without its extension. Save a Copy, Print, Revert, Place and
Package are disabled on the web and download nothing.

**Links**

- Help items and the About dialog's link row open in a new tab (`crates/ui-egui/src/links.rs:24-31`).
- The names on About > Contributors are egui hyperlinks (`crates/ui-egui/src/credits.rs:326`),
  which eframe opens with `window.open` and target `_self`. In a frame that would replace the
  editor; the translator opens them in a new window instead.

**Unsaved changes**

- The app registers a `beforeunload` handler that asks before the page is left while a document
  has unsaved changes (`web.rs:145-158`, refreshed every frame at `web.rs:248`). A host could use
  it as a signal; the protocol has none yet. There is no autosave or recovery on the web.

## How the adapter classifies

The adapter tells the core the name PhotoCraft saves an opened file under (`savedName`): the
opened name with its last extension replaced by `.psd`, or `.pcraft` for a `.pdn`, the extension
lower case. The core then passes downloads under the opened name or under that saved name to the
adapter. The adapter returns `document` only if all of these hold:

- the download's name is the saved name, and it ends in `.psd` or `.psb`;
- its stem is not a name PhotoCraft gives new documents (see below);
- the bytes are a Photoshop file: `8BPS`, version 1 or 2;
- no file that PhotoCraft would save under the same name reached the app from elsewhere in this
  frame (a user's own drop, a trusted `drop` event, or File > Open), and no `.pcraft` or template
  did.

Otherwise `export`.

Why:

- **The saved name, not the opened name.** PhotoCraft saves a `photo.png` as `photo.psd`. That
  save is the document, with the `openId` of the open; the Nextcloud editor stores the first one
  as a new file next to `photo.png` and replaces that file with every later save (see
  [protocol.md](../protocol.md#what-the-host-must-do)). The PNG itself is never replaced, which is
  also PhotoCraft's own rule: a flat file is never flattened over the original
  (`file_cmds.rs:152-153`).
- **The PSD check.** A save is a full rewrite, so PdfCraft's prefix check does not apply. Under
  the opened name or the saved name, PhotoCraft also downloads flat exports: Quick Export as PNG
  of an opened `photo.png` downloads `photo.png`, a flattened copy. Only a Photoshop file can be
  a save.
- **New documents.** File > New names a document `Untitled-1` (the New dialog's default,
  `crates/ui-egui/src/state.rs:1085-1088`, `new_doc_ui.rs:416`), New from Clipboard `Untitled`
  (`crates/engine/src/edit_cmds.rs:231`), a template the first free `Untitled-N` with the
  translated base (`Unbenannt-1` in German, `crates/ui-egui/src/file_open.rs:77-84`), Photomerge
  and Merge to HDR `Untitled_Panorama<n>` and `Untitled_HDR<n>`
  (`crates/engine/src/photo_cmds.rs:407`, `705`). Each saves as `<name>.psd` without a dialog.
  With a file of the same stem open (`Untitled-1.png`, or `Untitled-1.psd`, also Photoshop's
  default name), that is the opened file's saved name, and a PSD carries nothing that tells two
  documents apart. So a save whose stem is one of these names, in English or in one of the 16
  translations of "Untitled" in PhotoCraft's catalogs (`crates/ui-egui/src/i18n/*.tsv`), is never
  the document: a new document never replaces the opened file, at the price that a file named
  like one is never saved back (see [Known gaps](#known-gaps)).
- **Files from elsewhere.** PhotoCraft saves most documents as `<stem>.psd`, also a file the user
  dropped from the desktop or opened with File > Open. One with the opened file's stem would come
  back under the saved name, as a valid PSD, with other content. The adapter watches the `files`
  getters of `DataTransfer` (only during a trusted `drop`) and of `<input type=file>`, which is
  how PhotoCraft 0.6.0 reads such files, and records the stems of the names PhotoCraft would save
  them under, cleaned up as the core cleans every save name (`.photo.png` saves as `.photo.psd`,
  which arrives as `photo.psd`). A `.pcraft` saves under the name stored inside it and a template
  (`.psdt`) opens as `Untitled-N`, so their save names do not follow from their file names: after
  one of them (a `.pcraft` also by its content, a zip), no save is the document any more. Preset
  files (`.abr`, `.grd`, `.aco`, `.ase`, `.kys`, `.psp`, `.pcpresets`), which the same file picker
  loads and which open no document, do not count, and neither does the translator's own drop,
  which is synthetic (`isTrusted` false).
- **A later drop target.** The adapter sets `dropTargetTimeout` to 15 s: PhotoCraft registers its
  drop target only after its preset storage answered or 10 s passed. With the core's default of
  3 s, a slow storage would first report `the app registered no drop target` to the host, and
  then the file would open anyway. A `data-drop-target-timeout` on the script tag still wins.

## File types

What PhotoCraft opens from a drop, by the routing above:

| Files | What happens |
|---|---|
| `psd`, `psb` | Opens with layers. Saves back under a lowercase `.psd` name (a `.psb` as `<stem>.psd`). |
| `png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp`, `tif`, `tiff`, `tga`, `ico` | Opens flat. Save writes `<stem>.psd` next to it; Export As replaces nothing. |
| `heic`, `heif`, `hif` | Opens flat (the web build has the `heif` feature, `apps/photocraft-web/index.html:7`). Saves as `<stem>.psd`. |
| `qoi`, `exr`, `hdr`, `pbm`, `pgm`, `ppm`, `pam`, `pfm` | Open flat. Rarely edited in Nextcloud. |
| `dng`, `cr2`, `cr3`, `nef`, `nrw`, `arw`, `pef`, `orf`, `rw2`, `raf` | Opens the Camera Raw dialog first. |
| `pcraft` | PhotoCraft's own format. It keeps the document name stored inside it (`crates/format/src/convert.rs:222`), so Save writes `<stored name's stem>.psd`; the web build cannot write `.pcraft` back except from a `.pdn`. |
| `pdn` (Paint.NET) | Opens with layers. Save writes `<stem>.pcraft`, which the adapter never takes for the document: every save is a new file. |
| `afphoto`, `afdesign`, `afpub`, `af` (Affinity) | Opens read-only as a source; Save writes `<stem>.psd`. |
| `svg`, `svgz` | Opens as shape layers. VectorCraft's type. |
| `psdt` | A template: opens as `Untitled-N`, so its save is never the document; one opened from the user's disk makes every later save an export. |
| `abr`, `grd`, `aco`, `ase`, `kys`, `psp` | Brushes, gradients, swatches: go to the preset libraries, no document. |

The full list of what File > Open offers is `OPEN_EXTS` in `web.rs:19-23`. Only `psd` and `png`
are opened by the spec; `jpg` and `webp` were checked with the same build in an earlier probe.
The rest follows from the source.

The Nextcloud app (`CraftApps::APPS` in `craftsuite_layer/lib/Service/CraftApps.php`) offers
PhotoCraft for `psd`, `psb`, `pcraft`, `tga`, `png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp`, `tif`,
`tiff`, `ico`, `heic` and `heif`, and makes it the default action in Files only for `psd`, `psb`,
`pcraft` and `tga`, which no common Nextcloud app opens; the Viewer opens `png`, `jpeg`, `gif`,
`bmp`, `webp` and `ico`, and `heic`, `heif` and `tiff` when their preview providers are enabled.
The app matches by extension, so types without a Nextcloud MIME type of their own (`psb`,
`pcraft`: `application/octet-stream`) need no mapping. Left out on purpose: `pdn` (every save
becomes another new `.pcraft` file, see [Known gaps](#known-gaps)), the Affinity types (read-only
import, untested), `svg` (VectorCraft), the raw types (the Camera Raw dialog needs the pointer,
untested), the templates and the preset files.

## Known gaps

- **Files named like a new document are never saved back.** An opened `Untitled-1.png` or
  `Untitled-1.psd` (also `Untitled.psd`, `Unbenannt-2.psd` and the like) saves as a new file every
  time: `Untitled-1.psd` next to the original, then `Untitled-1 (2).psd`, and so on. A new
  document's save has the same name and nothing in the PSD tells the two apart, so this is the
  price of never replacing the opened file with a new document. Renaming the file in Nextcloud
  before opening it avoids it.
- **Copies made from the opened document replace it when saved.** Image > Duplicate names the
  copy `<name> copy` (`engine/src/image_cmds.rs:473`), Split Channels `<name>_<channel>`
  (`channel_cmds.rs:1279`, `:1282`) and Crop and Straighten Photos `<name> copy <k>`
  (`photo_cmds.rs:772`). Save replaces everything after the last dot with `psd`
  (`ui-egui/src/lib.rs:992-997`), so the copy of an opened `photo.psd` saves as `photo.psd`, is a
  Photoshop file and passes as the document: in Nextcloud it replaces the opened file (or the
  `<stem>.psd` created next to an opened PNG), and both tabs then save into it. Nextcloud's file
  versions (where enabled) keep the previous state. A PSD carries nothing that tells the copy from
  the original; a document id that PhotoCraft keeps across saves and gives new documents fresh
  (for example an XMP `xmpMM:DocumentID`) would let the adapter tell them apart, as it does for
  VectorCraft and DesignCraft; the [Upstream](../../README.md#upstream) section lists the
  requests to the Craft projects.
- **A new document the user names like the opened file.** A new document given the opened file's
  stem (typed into the New dialog's name field) saves as `<stem>.psd` and passes as the document.
  Nextcloud's file versions (where enabled) keep the previous state.
- **The guard depends on how PhotoCraft reads files.** Should a release read dropped or picked
  files another way (`DataTransfer.items`, the File System Access API), files from elsewhere go
  unnoticed again. The `another type` test fails then.
- **After a file from elsewhere with the same save name**, every later save under the saved name
  is an export, also a save of the opened document, until the frame is reloaded. After a
  `.pcraft` (or any zip) or a template from elsewhere, every later save is.
- **Upper-case extensions.** `Photo.PSD` opened as is saves as `Photo.psd`, a document under
  another name, which a host would store next to `Photo.PSD`; two names that differ only in case
  clash on Windows sync clients. The Nextcloud editor page therefore sends the name with a
  lower-case extension (`Photo.psd`), and saves replace `Photo.PSD` in place. Other hosts should
  do the same.
- **`.pdn` saves** are always exports, so each one is a new `.pcraft` file. Recognising
  PhotoCraft's own format as a save needs a check of its bytes and a real `.pdn` to test with.
- **`.pcraft` documents** come back under their stored name. When that differs from the file's
  stem, every save is an export.
- **No unsaved-changes signal** in the protocol (PhotoCraft's `beforeunload` handler could be
  one). The host must warn on close.
- **`delivered` is not "opened".** The host cannot tell whether PhotoCraft could read the file or
  is waiting in a prompt.
- **Saved means downloaded.** PhotoCraft marks the document saved when the download starts. If
  the host cannot store the file, the translator's fallback browser download is the copy the user
  keeps.

## Hosting notes

- PhotoCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no
  isolation headers (no COOP/COEP). It asks not to send `X-Frame-Options: DENY` or a
  `frame-ancestors` that excludes the embedding page. For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`.
- The app reads `cpu` and `webgl` anywhere in its query string as renderer flags
  (`web.rs:54-62`): the app URL must not contain those letters in its query by accident.
- The `.wasm` file of 0.6.0 has 25,145,515 bytes. Serve it compressed and with a long cache time,
  as `HOSTING.md` says.
- A `.wasm` file that is missing or cannot be compiled makes the loader fail, and the host gets
  `the app failed to load: ...` (see [protocol.md](../protocol.md#errors)).
- Preferences live in the frame's `localStorage` (`photocraft.preferences`), brush presets in its
  IndexedDB. Browsers that partition or block third-party storage may forget them between visits.
- Keyboard shortcuts reach the app after the user clicks into the frame.

## Tests

`photocraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`photocraft-chromium` and `photocraft-webkit`. Like the other `<app>-webkit` projects,
`photocraft-webkit` does not decide CI or canary runs until it has passed on a GitHub runner
(see [development.md](../development.md#continuous-integration)). The core's fallbacks and the
inactive cases are tested with PdfCraft and the stub app, not here.

The spec has four tests, and its header lists them with their scenarios. The first three are the
contract tests; the canary runs them apart from the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host, `probe.psd` opened: the handshake with the served app version, then the open. An edit (Invert) saved with Ctrl+S arrives as the document `probe.psd`, a PSD with the edit; a second edit (Desaturate) saved with Save As is the document again. Quick Export as PNG arrives as an export `probe.png`. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `another type` | `probe.png` opened: Ctrl+S arrives as the document `probe.psd` with the open's `openId`, and so does the second Ctrl+S; Quick Export as PNG, under the opened file's own name, is an export. A different `probe.psd` opened with File > Open, and in Chromium one dropped from the desktop, saves as an export. `Untitled-1.png` opened (the PNG fixture under that name): its own save and that of a new document (File > New, Enter), both `Untitled-1.psd`, arrive as exports. |
| `startup` | An IndexedDB that never answers: PhotoCraft takes drops only after 10 s, and the host gets no error, then `ready` and `delivered`. |
| `ui` (`@ui`) | The paths that need pointer clicks: File > Save in the menu bar saves the document; the Export button of the Export As dialog exports `probe.png`; the first name on About > Contributors (a link with target `_self`) opens a new window and the editor stays. |

A test with several scenarios (`another type`, `ui`) runs each in a page of its own and reports
every scenario that fails as `scenario failed: <title>`, not only the first. The drop from the
desktop needs the DevTools protocol, so WebKit notes it as a skipped scenario.

The fixtures are written by
[`tests/e2e/fixtures/photocraft/make-fixtures.mjs`](../../tests/e2e/fixtures/photocraft/make-fixtures.mjs):
a 64x48 PSD and the same picture as a PNG, and a different 40x40 PSD under the same name.

The tests drive PhotoCraft with the keyboard and the command palette (Ctrl+F), with the
shortcuts and English command labels from PhotoCraft's `crates/ui-egui/src/menu_catalog.rs`. They
check the saved picture in the PSD's merged image. Only the `ui` test also clicks with the
pointer; its click positions are in the `AT` table of the spec, measured on 0.6.0 at a 1400x900
viewport with the locale `en-US`. Two things differ in WebKit:

- Playwright's Desktop Safari has a macOS user agent, and egui takes the platform from it. So
  PhotoCraft orders dialog buttons the macOS way (Cancel, then Export;
  `crates/ui-egui/src/widgets.rs:681-688`), and `AT` has both positions.
- The spec sets the device scale factor to 1. At Desktop Safari's 2, software rendering made
  PhotoCraft's frames 6 to 10 times slower, and a click on a contributor's link mostly selected
  its text instead of following it: egui takes a press it sees for longer than 0.8 s for a drag
  (`input_state/mod.rs` in egui 0.36). Even at 1, that happened in 1 of 12 WebKit runs on a busy
  machine, so a click on the link that opens nothing and leaves the editor in the frame is tried
  once more, with a warning and a screenshot in the report.

When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on (see
  [architecture.md](../architecture.md#upstream-coupling-points)): for PhotoCraft also the save
  name, the drop target's delay or the way it reads user files. Sites that host the app should hold the release
  back until the adapter or the core is fixed.
- **Only the `@ui` test fails.** A menu, dialog or button moved. Re-measure the positions in `AT`
  for the paths it reports; the translator is not at fault.
- **A command label or shortcut changed upstream.** The palette then runs another command or
  none, and the tests that use it fail: `Quick Export as PNG File` and the shortcuts for Invert,
  Desaturate, Save As, File > Open and File > New in the contract tests, `About PhotoCraft` and
  Export As (Ctrl+Alt+Shift+W) in the `@ui` test. Check them against `menu_catalog.rs` and update
  the spec before holding a release back.

## Upstream

An embedding API for the web build is requested in
[storytold/photocraft#1614](https://github.com/storytold/photocraft/issues/1614), and
[pull request #2263](https://github.com/storytold/photocraft/pull/2263) proposes
`window.photocraft` and a `postMessage` API enabled with `?embed=<origin>` (open, not merged as of
2026-10-10). The host must not enable it while it relies on the translator; see
[architecture.md](../architecture.md#native-embedding-apis).
