<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# CADCraft

| | |
|---|---|
| Upstream | [github.com/storytold/cadcraft](https://github.com/storytold/cadcraft) |
| Adapter | [`translators/cadcraft.js`](../../translators/cadcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.5.0 when this page was written) |
| Tests | [`tests/e2e/specs/cadcraft.spec.ts`](../../tests/e2e/specs/cadcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the CADCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.5.0
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source references
are to the `v0.5.0` tag; `main.rs`, `upload.rs` and `download.rs` are in `apps/cadcraft-web/src/`,
the other paths are under `crates/`.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#cadcraft_canvas`, `main.rs:18`), where eframe
  registers the page's only drop listener once the graphics and the app exist (`main.rs:65-105`).
  The drop handler does not check `isTrusted`, so the translator's simulated drop works like a
  user's drop. The core's default drop target fits, and `ready` cannot come before the app can
  take the file; the adapter needs no `dropTarget` and no `started` check for that.
- Each dropped file is read in the background (`upload.rs:70-97`) and opened on the app's next
  frame with `OPEN {data, name}` (`ui-egui/src/lib.rs:322-332`). The content decides
  (`io/src/lib.rs:32-42`): an ASCII or binary DXF, or a file of any other name whose bytes parse as
  DXF. A DWG does not open on the web: CADCraft reports `DWG files can't be opened in the web build
  yet; save as DXF` on its command line and in its status bar (`dwg/src/lib.rs:166-169`). Files over
  256 MB are refused before they are read (`ui-egui/src/lib.rs:309-320`).
- **Every file opens as a new drawing tab titled with its file name** (`engine/src/cmd/file.rs:85-88`,
  `engine/src/lib.rs:505-517`), also while a tab with that name is open. The page starts with the
  drawing `Drawing1` (`engine/src/lib.rs:466-470`), which stays open next to the opened file.
- File > Open… (Ctrl+O) shows the browser's file picker: a hidden
  `<input type="file" id="cadcraft_open_input" accept=".dxf,.dwg">` appended to `<body>` and
  clicked (`upload.rs:41-67`). The chosen file opens like a dropped one.
- There is no `?file=` and no embedding API. The only query flags are `webgl` and `sample` (see
  [Hosting notes](#hosting-notes)).
- There is no JavaScript-visible signal that a file was opened, could not be opened, or has
  unsaved changes. The host only gets `delivered`.

**Saving and downloads**

- Every download goes through one helper (`download.rs:16-55`): a `Blob` typed
  `application/octet-stream` for every file (`engine/src/cmd/file.rs:151-156`),
  `URL.createObjectURL`, an `<a download>` with `display: none` appended to `<body>`, `click()`,
  then the element is removed at once and the URL revoked after 60 s. There is no File System
  Access API.
- Save (Ctrl+S) and Save As… (Ctrl+Shift+S) (`engine/src/cmd/file.rs:65-70`) ask for nothing on
  the web. A drawing opened from a file has no path, so Save runs Save As
  (`ui-egui/src/menus.rs:95`), which suggests the drawing's title, the file's name trimmed of white
  space (Rust's `trim`: unlike JavaScript's, it removes U+0085 and keeps U+FEFF), plus `.dxf` if
  that has no extension (`ui-egui/src/lib.rs:104-112`), and the web's picker takes the suggestion
  as it is (`main.rs:50-54`, `ui-egui/src/menus.rs:87-93`). The drawing then keeps that name, and
  every later Save writes it again (`engine/src/cmd/file.rs:164-175`). So both download under the
  opened name at once. The Save button of the question before closing a drawing with unsaved
  changes runs Save too (`ui-egui/src/closing.rs:103-108`).
- On Windows and Linux the shortcuts are Ctrl+S and Ctrl+Shift+S; in WebKit, with Safari's user
  agent, the menus show ⌘, and the tests press Ctrl there as well.
- Every save is a full rewrite (`io/src/dxf_write.rs`), never an update of the opened bytes: an
  R2000 ASCII DXF (`$ACADVER` `AC1015`, `$DWGCODEPAGE` `ANSI_1252`, CRLF line ends), with non-ASCII
  text as `\U+XXXX` escapes (`dxf/src/lib.rs:374-410`). The writer is deterministic, and it
  renumbers the handles on every save.
- **The writer keeps only what CADCraft models.** Entities of types CADCraft reads but does not
  model (MLINE, 3DSOLID, MULTILEADER, ...) stay in the drawing and are not written
  (`io/src/dxf_write.rs:896-897`); CADCraft says so only on its command line, as
  `Not saved (CADCraft can't write these object types yet): 1 MLINE`
  (`engine/src/cmd/file.rs:223-270`). Header variables outside its list of about 40
  (`dxf_write.rs:185-222`, `1329-1352`; not `$TDCREATE`, `$FINGERPRINTGUID`, `$VERSIONGUID` or
  `$ACADMAINTVER`), other programs' xdata and their objects (XRECORDs) are dropped without a word.
  A DXF from another program (`foreign.dxf` of the tests: R2018 with those four header variables,
  another application's xdata on a LINE, an MLINE and that application's XRECORD) comes back with
  its LINE, its TEXT and the edit, and without the rest.
- A DXF that CADCraft wrote comes back with the edits, new extents and new handles, apart from
  dimensions. The reader keeps the anonymous blocks `*D<n>` that draw dimensions as ordinary blocks
  (`io/src/dxf_read.rs:1379-1383` drops only table blocks and unused arrowheads), and the writer
  writes a new one for every dimension under the next free name (`io/src/dxf_write.rs:1215-1234`).
  So every open and save adds a set of blocks: upstream's `examples/apartment.dxf` (7 dimensions)
  grew from 48,769 to 59,982 and 69,937 bytes in two cycles, with the blocks `*D1` to `*D7`, then
  to `*D14`, then to `*D21`. Nothing visible changes. See [Upstream](#upstream).
- New drawings: File > New Drawing… (Ctrl+N) names a drawing `Drawing<N>`, counting from 1 in each
  session (`engine/src/lib.rs:496-503`); with the startup `Drawing1`, the first new one is
  `Drawing2`. Help > Open Sample Drawing opens `Bracket` (`ui-egui/src/menus.rs:111-117`). Their
  saves are `Drawing<N>.dxf` and `Bracket.dxf`; the names are not translated. CADCraft writes no
  document identity into a DXF and keeps none it reads (`$FINGERPRINTGUID` is dropped).
- File > Default Save Format can be set to DWG (kept in the frame's `localStorage`, see
  [Hosting notes](#hosting-notes)). New drawings then save as `Drawing<N>.dwg`, which fails on the
  web (`DWG files can't be written in the web build yet`, `dwg/src/lib.rs:174-177`): no download.
  Drawings opened from a file keep their name.
- No menu item exports a file on the web. `saveas` with JSON parameters, typed on the command line,
  writes SVG, PNG (2400x1600) or PDF by the extension of its `path` (`io/src/lib.rs:54-68`), and the
  drawing keeps its name and its unsaved changes (`engine/src/cmd/file.rs:159-175`, `:247-251`).
  A typed Space ends the command name (`ui-egui/src/cmdline.rs:175-181`), so such a line has to
  arrive in one piece (pasted, or through an input method); the tests enter it through eframe's
  text field. With a `.dxf` path of another name, the drawing takes that name, and later saves
  write it.
- Print… (Ctrl+P) and Export to PDF… download nothing: CADCraft reports `paths are not available
  on the web` (`ui-egui/src/menus.rs:96-110`, `engine/src/cmd/layout.rs:790-801`). WBLOCK writes
  nothing on the web (`engine/src/cmd/blocks.rs:293-296`).

The downloads, checked in Chromium and WebKit:

| Download | Name | Kind |
|---|---|---|
| Save (Ctrl+S), Save As… (Ctrl+Shift+S) of an opened DXF that CADCraft 0.5.0 wrote | the opened name | `document` |
| Save, Save As… of any other opened DXF | the opened name | `copy`: the first a new file next to the original, the later ones replace it |
| Save of the startup drawing or a new one (Ctrl+N) | `Drawing<N>.dxf` | `export` |
| Save of the sample (Help > Open Sample Drawing) | `Bracket.dxf` | `export` |
| Save of a drawing the user dropped or picked with File > Open… | its file name, trimmed, plus `.dxf` if it has no extension | `export`; with the opened name see [How the adapter classifies](#how-the-adapter-classifies) |
| `saveas {"path": "<name>.svg"}`, `.png`, `.pdf` | as typed | `export` |
| `saveas {"path": "<other>.dxf"}`, and the later saves of that drawing | as typed | `export` |
| Print…, Export to PDF…, WBLOCK | nothing: no download on the web | |

**Links and clipboard**

- The links in Help > About CADCraft (`ui-egui/src/dialogs.rs:248-249`) and in its credits
  (`ui-egui/src/credits.rs:267`, `:294`) are egui hyperlinks, which eframe opens with
  `window.open` and target `_self`. In a frame that would replace the editor; the translator opens
  them in a new window instead.
- Copy puts the copied entities on the system clipboard as DXF text, and Paste reads paste events
  (`ui-egui/src/clipboard.rs`). The editor frame's delegated `clipboard-write` covers Copy.

## How the adapter classifies

The adapter has no `savedName` (CADCraft saves under the opened name), no `dropTarget` and no
`dropTargetTimeout`.

Its `identity` is not a document identity (CADCraft writes none) but a mark of provenance:
`cadcraft-0.5.0-dxf` for a DXF as CADCraft 0.5.0 writes it, and would write again without losing
anything; otherwise none. That means the exact start of its header (`$ACADVER` `AC1015`,
`$DWGCODEPAGE` `ANSI_1252`, CRLF), its own `CADCRAFT` APPID record, `0 EOF` as the last pair, and
nothing outside the writer's vocabulary: only object types (group 0) that `dxf_write.rs` and
`dxf_image.rs` write, header variables (group 9) from its list, xdata applications (group 1001)
`ACAD`, `CADCRAFT`, `AcadAnnotative`, `AcCmTransparency` and `AcAecLayerStandard`, and keys of the
named object dictionary that the writer uses (`dxf_write.rs:1731-1753`). CADCraft writes no
version number into a DXF, so the vocabulary is what tells 0.5.0's output from a newer CADCraft's
or from a CADCraft file that another tool changed. Every file of CADCraft 0.5.0 or older that the
research tested passes (the tests' fixture, upstream's `examples/apartment.dxf` with dimensions,
hatches, a table and a leader, the sample, every save); a DXF from another program, a CADCraft
DXF with an MLINE, `$FINGERPRINTGUID` or another application's xdata added, and a CADCraft DXF
whose line ends were changed to LF do not. The core keeps the mark with the opened file and takes
it from every stored `document` save.

The core calls the adapter for a download under the opened file's name. The adapter returns:

- `export` unless the name ends in `.dxf` (any letter case);
- `export` for `Drawing<N>.dxf` and `Bracket.dxf`, the names of CADCraft's own drawings: nothing
  in the DXF tells the startup drawing, a new drawing or the sample from an opened file of that
  name;
- `export` if another file with that save name has entered the app in this frame (below);
- `export` if the download is not a DXF as CADCraft 0.5.0 writes it (Save always writes one; this
  is a guard);
- `document` if the opened file has the mark;
- `copy` otherwise: a DXF from another program, or one in CADCraft's layout with data that 0.5.0
  drops. The save is the opened document, but it lost what CADCraft does not keep, without a
  signal the translator could see.

A `copy` never replaces the opened file. The core sends every `copy` save of an open as
`document` with `follows`. The first one follows its own id, which names no file the host has,
so the host stores it next to the original (in Nextcloud `plan (2).dxf` next to `plan.dxf`);
every later one follows that first save, and the host stores it over that copy (see
[protocol.md](../protocol.md#copies)). The original stays as it is. Opening it again and saving
makes another copy; opening the copy, which CADCraft wrote, saves in place.

Files the user brings in: every drop and every File > Open… pick opens a new tab whose saves use
its file name, so a second file with the opened file's name would save as the opened document.
The adapter adds two capturing listeners in `started()`: `drop` on `window` and `change` on
`document` for `<input type="file">`. `started()` runs after the app registered its drop listener,
which the core takes as the app's drop target, so the core's detection is not affected. Each file
counts under the name CADCraft saves it under (its name trimmed as Rust trims, plus `.dxf` without
an extension, after the core's name rules, see [protocol.md](../protocol.md#names)): a file named
`plan.dxf` followed by U+0085 counts as `plan.dxf`, as CADCraft saves it. The core's own drop counts
once; once a second file counts under the opened file's name, every save under that name is an
`export`, also those of the opened drawing: new files, nothing overwritten. Every drop counts
(trusted or not, also one that misses the canvas), and so does every pick, also of a file CADCraft
then cannot open.

## Known gaps

- **JSON commands with the opened name.** A drawing saved with `saveas {"path": "<opened name>"}`
  from another tab, or opened with `open {"data": "<base64>", "name": "<opened name>"}` and then
  saved, passes as the document (or the copy) when it is a DXF as CADCraft writes it, which every
  save is. Both are explicit and hard to type (a typed Space ends the command name), and the
  second needs the file as base64.
- **Files named like CADCraft's own drawings.** An opened `Drawing<N>.dxf` or `Bracket.dxf` is never
  saved back: every save is a new file (`Drawing1 (2).dxf`, then `(3)`, ...). Files the web build
  saved are often named `Drawing1.dxf`, the startup drawing's name. Renaming the file in Nextcloud
  before opening it avoids that.
- **Files of other programs are not edited in place.** A DXF from AutoCAD, LibreCAD, ezdxf or the
  like is never replaced: its first save is a new file next to it, which the later saves of that
  editor session replace. So is a CADCraft DXF with data that 0.5.0 drops.
- **Dimension blocks grow.** Saves of a drawing with dimensions replace the file in place, and each
  open and save makes it larger by a block per dimension (about 1.5 KB per dimension in
  `apartment.dxf`). Nothing visible is lost. This is an upstream bug, see [Upstream](#upstream).
- **After a file the user brings in.** Once a dropped or picked file saves under the opened name,
  every save under that name is a new file, also the opened drawing's, until the editor is opened
  again.
- **What the vocabulary does not cover.** The provenance check covers object types, header
  variables, xdata applications and the keys of the named object dictionary, not the group codes
  inside known objects, the keys inside CADCraft's own xdata, or extension dictionaries. A file of
  a newer CADCraft that adds data only there passes and loses it on save. Nextcloud's file versions
  (where enabled) keep the previous state. The lists in the adapter follow 0.5.0's writer and must
  be checked with every release.
- **No unsaved-changes signal.** CADCraft shows unsaved changes only as `*` after the drawing's name
  in its tab (`ui-egui/src/chrome.rs:182`), asks only on its own Close and Close All
  (`ui-egui/src/closing.rs`), nothing before the page unloads, and has no autosave or recovery on
  the web. The host cannot tell whether the user has unsaved edits and must warn on close.
- **Saved means downloaded.** CADCraft marks the drawing saved when the download starts
  (`engine/src/cmd/file.rs:159-175`). If the host cannot store the file, the translator's fallback
  browser download is the copy the user keeps.
- **The startup drawing.** The tab `Drawing1` sits next to the opened file. A user who draws there
  saves `Drawing1.dxf` as a new file each time.
- **`delivered` is not "opened".** A file CADCraft cannot read is reported on its command line and in
  its status bar only.
- **Browser shortcuts.** In a browser window, Ctrl+N and Ctrl+W go to the browser (new window, close
  tab) before the frame sees them; File > New Drawing… and File > Close work. The headless browsers
  of the tests pass Ctrl+N to the app.
- **Memory.** An opened file passes through base64 (`ui-egui/src/lib.rs:329-330`) and is held several
  times while it opens. Large drawings may fail inside the app while the host only sees `delivered`.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so CADCraft cannot
  start there.

## Hosting notes

- CADCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no special
  headers (no COOP/COEP). It asks not to send `X-Frame-Options: DENY` or a `frame-ancestors` that
  excludes the embedding page. For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`. Its iframe example is titled
  `CADCraft image editor`.
- The web build renders with wgpu: WebGPU where the browser has it, else WebGL2. With neither, it
  writes `CADCraft failed to start: ...` and `A browser with WebGPU or WebGL2 is required.` into
  `#cadcraft_loading` (`main.rs:106-113`) and registers no drop target, and the host gets `the app
  registered no drop target`. The tests run on WebGL2 (Chromium with SwiftShader, which offers no
  WebGPU adapter here, and WebKit).
- The drop listener comes once the graphics have started: in the tests 0.1 to 0.4 s after
  `TrunkApplicationStarted`. A graphics start slower than the default drop target timeout of 3 s
  gives a provisional `the app registered no drop target`, followed by `ready` (see
  [protocol.md](../protocol.md#errors)); `data-drop-target-timeout` raises the limit.
- Query flags are substrings of the whole query string (`main.rs:72`, `:91`): `webgl` forces
  WebGL2, `sample` opens the sample drawing in a tab of its own. The configured app URL must not
  contain either word anywhere in its query. `HOSTING.md` also lists `?cpu`; the build does not
  read it.
- The `.wasm` file of 0.5.0 is 15.1 MB, 5.7 MB with gzip (`HOSTING.md` says about 13 MB and 5 MB).
  Serve it compressed, preferably precompressed with Brotli.
- The loader is Trunk's inline module script in `index.html`. It imports
  `cadcraft-web-<hash>.js`, awaits the `.wasm` module and then dispatches
  `TrunkApplicationStarted`. A `.wasm` file that is missing or cannot be compiled makes the loader
  fail, and the host gets `the app failed to load: ...`; a Content-Security-Policy that blocks the
  inline script leads to `the app did not start in time` (see [protocol.md](../protocol.md#errors)).
- Preferences (theme, interface language, default save format) are kept in the frame's
  `localStorage` under `cadcraft.prefs` (`main.rs:34-37`, `ui-egui/src/lib.rs:273-281`). Browsers
  that partition third-party storage may forget them, which is harmless. A stored default save
  format of DWG makes saves of new drawings fail (see above).
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `dxf` | the drawing; Save replaces a DXF that CADCraft wrote, and writes a copy next to any other DXF, which later saves of the session replace (`Drawing<N>.dxf` and `Bracket.dxf` get a new file per save, see [Known gaps](#known-gaps)) | yes | yes, when CADCraft is configured: it keeps layers, blocks, dimensions and layouts, while VectorCraft imports DXF into a drawing of its own; without CADCraft, VectorCraft keeps the default |

Match the extension in any letter case; CADCraft decides by the content. Nextcloud 34 and 35 have
no MIME type for `dxf` (`resources/config/mimetypemapping.dist.json`), so it arrives as
`application/octet-stream`, and no Viewer or Office app claims it.

Do not offer anything else: `dwg` (the web build can neither read nor write DWG, although its
file picker lists it), and `svg`, `png` and `pdf`, which CADCraft only writes.

## Tests

`cadcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`cadcraft-chromium` and `cadcraft-webkit`. The behaviour the core shares with every app (fallback
downloads, a foreign host, startup errors, how copies follow each other) is tested in
`translator.spec.ts` and `pdfcraft.spec.ts`; this spec checks what depends on CADCraft.

The spec has three tests, and its header lists them with their scenarios. The first two are the
contract tests; the canary runs them apart from the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open of a DXF that CADCraft wrote. A text added on the command line and saved with Ctrl+S arrives as the document under the opened name, a CADCraft DXF with the fixture's marker and the edit; Save As (Ctrl+Shift+S) after another edit is the document again. An SVG export (`saveas` with a typed path) and the save of a new drawing (Ctrl+N, `Drawing2.dxf`) arrive as new files. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | Saves that must not replace the opened file. `foreign.dxf` (another program's) and `newer-cadcraft.dxf` (CADCraft's layout with an MLINE, `$FINGERPRINTGUID` and another application's xdata) are copies: the first save arrives as the document following its own id (a new file), the second as the document following the first, both with the edit and without what CADCraft drops. An opened `Drawing2.dxf` and `Bracket.dxf` are never saved back, and the new drawing (Ctrl+N) or the sample (`ui.sample`) saved under that name arrives as a new file. A drawing dropped as `craftsuite-probe.dxf`, or picked with File > Open… as `craftsuite-probe` followed by U+0085 (which CADCraft trims and saves as `craftsuite-probe.dxf`), next to the opened `craftsuite-probe.dxf` arrives as a new file, where the same Ctrl+S was the document before. |
| `ui` (`@ui`) | Menus with the pointer, on the opened fixture: File > Save saves the document; Help > Open Sample Drawing, then File > Save, arrives as a new file `Bracket.dxf`. |

A test with several scenarios (`saved-as`) runs each in a page of its own and reports every
scenario that fails as `scenario failed: <title>`, not only the first.

The steps use CADCraft's shortcuts (`engine/src/cmd/file.rs`) and its command line, where typed
words run commands and a Space ends a word (`text 2,6 0.5 0`, then the text, then an empty line;
`ui.sample`). A line with JSON parameters goes in as one text input through eframe's hidden text
field. A drop from the desktop is simulated with a drop event on the canvas, as the translator's
own drop; the adapter counts every drop. Only the `ui` test clicks with the pointer; its click
positions are in the `AT` table of the spec, measured on 0.5.0 at a 1400x900 viewport with the
locale `en-US` (the same in Chromium and WebKit). When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing (`upload.rs`, `ui-egui/src/lib.rs:322-332`), the title and save name
  (`ui-egui/src/lib.rs:104-112`, `menus.rs:87-95`), the download helper (`download.rs`), or the
  writer (`io/src/dxf_write.rs`). A writer that emits an object type, header variable, xdata
  application or dictionary key the adapter does not list makes saves of CADCraft's own files
  copies instead of documents: update the lists in `translators/cadcraft.js` after checking that
  0.5.0's reader keeps what the new writer adds. The rules fail towards new files, not towards
  overwriting. Sites that host the app should hold the release back until the adapter is fixed.
- **Only the `@ui` test fails.** A menu item moved. Re-measure the positions in `AT`; the
  translator is not at fault.
- **A shortcut changed upstream.** The tests that press it fail: Ctrl+S, Ctrl+Shift+S, Ctrl+N and
  Ctrl+O are used by the contract tests. Check them against `engine/src/cmd/file.rs` before
  holding a release back.

The fixtures are in `tests/e2e/fixtures/cadcraft/`. `craftsuite-probe.dxf` was made with CADCraft
0.5.0 from this project's input: in the startup drawing a circle (`circle 4,4 1`) and a single
line text with the marker `CRAFTSUITE-PROBE-cc01` (`text 1,1 0.5 0`), then Ctrl+S (downloaded as
`Drawing1.dxf`, stored under the fixture's name). `make-fixtures.mjs` writes `foreign.dxf` and
`newer-cadcraft.dxf` (see its header). DXF files are CRLF text and must stay byte for byte as
written, also in a Git checkout. The tests derive the other names they open (`Drawing2.dxf`,
`Bracket.dxf`) from these files.

## Upstream

CADCraft has no embedding API. With one, as requested for PdfCraft in
[storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422), the open and save
paths would no longer depend on drops and downloads; see
[architecture.md](../architecture.md#native-embedding-apis).

The growth of dimension blocks is worth an issue upstream. Proposed text:

> **Every open and save of a DXF with dimensions adds a new set of `*D` blocks**
>
> CADCraft 0.5.0 (seen in the web build; the code is shared). Open a DXF with dimensions that
> CADCraft wrote, for example `examples/apartment.dxf` (7 dimensions), save it without changes,
> open the result and save it again. The file grows with every cycle: 48,769, then 59,982, then
> 69,937 bytes, with the blocks `*D1` to `*D7`, then `*D1` to `*D14`, then `*D1` to `*D21`. Nothing
> visible changes, and the old blocks are no longer referenced.
>
> The reader keeps the anonymous blocks that DIMENSION entities reference (group 2) as ordinary
> blocks; it drops only the blocks of tables and unused arrowheads (`crates/io/src/dxf_read.rs`,
> lines 1379-1383). The writer generates a new block for every dimension under the next free
> `*D<n>` name (`crates/io/src/dxf_write.rs`, lines 1215-1234), so the old blocks stay.
>
> Expected: the drawing keeps its size when it is saved without changes. The reader could skip the
> blocks that DIMENSION entities reference, as it does for those of ACAD_TABLE entities
> (`table_blocks`, `dxf_read.rs` lines 814-818), or the writer could reuse a dimension's block name.

Worth reporting as well: a writer version mark or a document id in the DXF (for example keeping
`$FINGERPRINTGUID`), so that a host could tell CADCraft's own files and drawings apart without a
vocabulary list; keeping what CADCraft does not model (unknown entities, other programs' xdata and
objects, header variables), or a JavaScript-visible signal that a save lost data; Print and Export
to PDF on the web; and the `?cpu` flag, the iframe title and the sizes in `HOSTING.md`. DWG on the
web would need the extension list and these rules revisited: DWG saves would go through a
conversion with losses.
