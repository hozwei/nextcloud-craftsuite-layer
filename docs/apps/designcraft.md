<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# DesignCraft

| | |
|---|---|
| Upstream | [github.com/storytold/designcraft](https://github.com/storytold/designcraft) |
| Adapter | [`translators/designcraft.js`](../../translators/designcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.5.0 when this page was written) |
| Tests | [`tests/e2e/specs/designcraft.spec.ts`](../../tests/e2e/specs/designcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the DesignCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.5.0
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source
references are to the 0.5.0 tag; `web.rs` is `apps/designcraft-web/src/web.rs`, the other paths
are under `crates/`.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#designcraft_canvas`, `web.rs:29`), where eframe
  registers its drop listener. The drop handler does not check `isTrusted`, so the translator's
  simulated drop works like a user's drop. The core's default drop target fits; the adapter needs
  no `dropTarget`.
- Each dropped file is read asynchronously and keeps its `File.name` (`web.rs:87-104`). Then the
  name decides, in any letter case (`ui-egui/src/lib.rs:556-574`, `drain_inbox`):
  - `.designcraft` or `.idml`: opens as a new document tab;
  - `.ase`: loads the swatches into the open document;
  - anything else: placed into the open document, like File > Place.

  So a file of any other type opens nothing on the start screen: DesignCraft reports in its
  status bar that `file.place` is not available with no document open, and the host has only
  seen `delivered`.
- An IDML package is recognised by its content, a zip whose first, stored entry `mimetype`
  holds `application/vnd.adobe.indesign-idml-package` (`engine/src/cmd/file.rs:201-214`,
  `idml/src/lib.rs:71-76`); its name only routes the drop.
- **The document's title comes from the file name**, never from the file: the name up to its
  last dot (`ui-egui/src/lib.rs:565-566`), which replaces the title stored in a `.designcraft`
  (`engine/src/cmd/file.rs:209-211`) or the `Name` in an IDML's `designmap.xml`
  (`engine/src/cmd/interchange.rs:115-117`). For an IDML package DesignCraft also cuts every
  `.idml` left at the end of that (`interchange.rs:103`, `trim_end_matches`), so
  `x.idml.idml` gets the title `x`. The tests open fixtures whose stored titles differ from
  their names.
- There is no `?file=` and no embedding API. The only query flags are `webgl` and `sample`
  (see [Hosting notes](#hosting-notes)).
- There is no JavaScript-visible signal that a file was opened, could not be opened, or has
  unsaved changes. The host only gets `delivered`.

**Saving and downloads**

- Every download goes through one helper (`web.rs:151-175`): a `Blob` typed by the extension
  (`web.rs:177-186`), `URL.createObjectURL`, an `<a download>` with `display: none` appended to
  `<body>`, `click()`, then the element is removed at once and the URL revoked after 10 s. The
  type is wrong for `.designcraft` (`application/json` for a zip), so the `save` message carries
  no MIME type, as for every app. There is no File System Access API.
- Save (Cmd+S) and Save As… (Cmd+Shift+S) (`ui-egui/src/menus.rs:12-13`) both run
  `download_document` when there is a download service, which is always the case on the web
  (`menus.rs:719`, `menus.rs:1383-1392`). Neither asks for a name: the file is
  `<title>.designcraft`, the whole document written as a new zip package (`format/src/lib.rs:46-74`:
  the stored `mimetype` entry with `application/vnd.designcraft+zip` first, then `meta.json`,
  `document.json` and `assets/`), not an update of the opened bytes. DesignCraft then marks the
  document saved, without knowing whether the host stored it.
- File > New Document… titles a document `Untitled-N`, counting from 1 in each session; opening
  a file does not count (`engine/src/cmd/file.rs:142-143`). So with `Untitled-1.designcraft` open
  (the name every document made in the web build gets on its first Save), a new document saves
  under the opened name.
- `document.json` stores the creation time (`created`, Unix seconds, `doc/src/lib.rs:527-531`),
  set when a document is created (`doc/src/build.rs:158`) or imported from IDML
  (`idml/src/import.rs:2243`) and kept by every load and save. The desktop app sets it; the web
  build has no clock and stores 0 (`doc/src/vars.rs:104-114`).
- On Windows and Linux the shortcuts are Ctrl+S and Ctrl+Shift+S (`Cmd` is Ctrl there). The
  tests press Ctrl, also in WebKit with Safari's user agent.
- Every other download has its own name. The names below were checked in Chromium through the
  File menu; `<title>` is the document's title, see above.

| Download | Name | Kind |
|---|---|---|
| Save (Ctrl+S), Save As… (Ctrl+Shift+S) of the opened document | `<title>.designcraft`, the whole package | `document` |
| Save of another document (File > New Document…, or a file opened from the user's disk with File > Open…) | `<its title>.designcraft` | `export`; with the opened document's title see [How the adapter classifies](#how-the-adapter-classifies) and [known gaps](#known-gaps) |
| Export Page as PNG… (Ctrl+E) | `<title>-p<n>.png`, n the page in view (`menus.rs:1413`) | `export` |
| Export IDML… | `<title>.idml` (`menus.rs:1431`); for an opened `<title>.idml` that is the opened name | `export` |
| Export PDF…, Export PDF (Interactive)…, Print Booklet… | `<title>.pdf` (`menus.rs:1479`, `menus.rs:1451`) | `export` |
| Export EPUB…, Export EPUB (Fixed Layout)… | `<title>.epub` | `export` |
| Export HTML…, Export XML… | `<title>.html`, `<title>.xml` | `export` |
| Export Text… (needs a story being edited) | `<title>.rtf` (`menus.rs:804`) | `export` |
| Save Swatches for Exchange… | `Swatches.ase` (`menus.rs:860`) | `export` |
| Save a Copy…, Package… | nothing: no download on the web (`engine/src/cmd/file.rs:26-32` writes only outside the browser) | |

**Links**

- The contributor links in Help > About DesignCraft are egui hyperlinks
  (`ui-egui/src/credits.rs:259`, `credits.rs:282`), which eframe opens with `window.open` and
  target `_self`. In a frame that would replace the editor; the translator opens them in a new
  window instead. Links in the Help menu and on the start screen open a new tab anyway
  (`ui-egui/src/lib.rs:784-786`).

## How the adapter classifies

The adapter tells the core the name DesignCraft gives a save of the opened file (`savedName`):
the title as above, plus `.designcraft`. For `report.designcraft` that is the opened name; for
`report.idml` or `Report.DESIGNCRAFT` it is `report.designcraft` or `Report.designcraft`. The
core calls the adapter for a download whose sanitised name equals a file opened in the frame, or
the saved name of one.

The adapter's `identity` is the creation time in a package's `document.json` (none for 0 or an
IDML package). It reads only that entry, found through the zip's central directory as
DesignCraft does, and unpacks it with `DecompressionStream('deflate-raw')` (at most 256 MB). The
core keeps it with the opened file (and takes it from each stored save of the document), and
sends a save whose creation time differs from the document's as an `export` without asking the
adapter (see [protocol.md](../protocol.md#saves)).

The adapter returns `document` if the download has the saved name, is a DesignCraft package (a
zip whose first entry is the stored `mimetype` with `application/vnd.designcraft+zip`), and can
be told from a new document's save: if the opened document has a creation time, the save has it
too; if it has none, the saved name is not `Untitled-<n>.designcraft`. Otherwise `export`.

- Save rewrites the whole file, so the prefix check of PdfCraft does not apply: the name a save
  of the opened file gets, the package type and the creation time decide.
- A new document is `Untitled-1` in every session, so its save has the name of an opened
  `Untitled-1.designcraft`. A package from the desktop app has a creation time that every save
  keeps and a new document of the web build lacks, so the two are told apart. Without one (a
  package made in the browser, or an IDML import) a save named `Untitled-<n>.designcraft` cannot
  be told from a new document's and is never the document: a new file, nothing overwritten.
- Export IDML… of an opened `x.idml` downloads under the opened name, but it is DesignCraft's own
  rewrite of the file, not a save: its name is not the saved name `x.designcraft`, so it is an
  `export`, and the IDML is never replaced.
- An opened `x.idml` or `X.DESIGNCRAFT` saves under another name than it was opened with. The
  first such save arrives as `document` with the open's `openId`; the Nextcloud editor page stores
  it as a new file next to the original, and later saves replace that file (see
  [protocol.md](../protocol.md#saves) and `craftsuite_layer/src/editor.ts`). The editor page sends
  names with a lower-case extension, so in Nextcloud `X.DESIGNCRAFT` arrives as `X.designcraft`
  and its saves replace it in place; only an `.idml` gets a new file next to it. Once the host has
  stored a save, the core takes it as the reference for the next one.
- The package check is a guard: in 0.5.0 nothing but Save writes `<title>.designcraft`.

## Known gaps

- **Packages named like a new document.** A package made in the browser (creation time 0) and
  saved as `Untitled-<n>.designcraft`, the name DesignCraft gives it, is never saved back: every
  save of it is a new file (`Untitled-1 (2).designcraft`, then `(3)`, ...), because a new
  document's save looks the same. Renaming the file in Nextcloud before opening it avoids that.
- **Another document with the same title.** A document the user opens in DesignCraft from their
  own disk (File > Open…), or creates, saves under the opened document's name if it has the same
  title, and passes as `document` when the creation times cannot tell them apart:
  both have none (made in the browser) or the same (copies of one file). The host may replace the
  opened file with it. Nextcloud's file versions (where enabled) keep the previous state.
- **No unsaved-changes signal.** DesignCraft shows unsaved changes only as `*` in the document
  tab (`ui-egui/src/chrome.rs:464`), asks nothing before the page unloads, and has no crash
  recovery in the browser (`ui-egui/src/lib.rs:610-619` runs only outside it). The host cannot
  tell whether the user has unsaved edits and must warn on close. Close is Ctrl+W, as in
  InDesign, but in a browser Ctrl+W closes the tab.
- **`delivered` is not "opened".** The host cannot tell whether DesignCraft could read the file;
  a file it cannot open shows an error in its status bar only.
- **Saved means downloaded.** DesignCraft marks the document saved when the download starts
  (`menus.rs:1390-1391`). If the host cannot store the file, the translator's fallback browser
  download is the copy the user keeps. The Nextcloud editor page relies on that download and
  offers no retry of its own; it says in its status line why the file was not stored.
- **Memory.** DesignCraft passes every opened and saved file through base64
  (`ui-egui/src/lib.rs:560`, `menus.rs:1385-1386`) and needs about ten times the file size in
  wasm memory (a 20 MB document: about 170 MB on open, 220 MB after a save, in Chromium). Very
  large documents may fail inside the app, while the host only sees `delivered`.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so
  DesignCraft cannot start there.

## Hosting notes

- DesignCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no
  special headers (no COOP/COEP). It asks not to send `X-Frame-Options: DENY` or a
  `frame-ancestors` that excludes the embedding page. For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`.
- The 0.5.0 web build renders with wgpu: WebGPU where the browser has it, else WebGL2. With
  neither, it shows `DesignCraft failed to start` in place of the canvas (`web.rs:66-71`) and
  registers no drop target, and the host gets `the app registered no drop target`. The tests
  run on WebGL2 (Chromium with SwiftShader, which offers no WebGPU adapter here, and WebKit).
- Query flags are matched as substrings of the whole query string: `webgl` forces WebGL2
  (`web.rs:44`), and `sample` opens a sample document at startup (`web.rs:59`). The configured
  app URL must not contain either by accident. `HOSTING.md` also lists `?cpu`; the 0.5.0 build
  does not read it.
- The `.wasm` file is 41.8 MB, 17.5 MB with gzip (`HOSTING.md` says about 13 MB and 5 MB).
  Serve it compressed, preferably precompressed with Brotli.
- The loader is Trunk's inline module script in `index.html`. It imports
  `designcraft-web-<hash>.js`, awaits the `.wasm` module and then dispatches
  `TrunkApplicationStarted`. A `.wasm` file that is missing or cannot be compiled makes the
  loader fail, and the host gets `the app failed to load: ...`; a Content-Security-Policy that
  blocks the inline script leads to `the app did not start in time` (see
  [protocol.md](../protocol.md#errors)).
- `HOSTING.md` says preferences are kept in the frame's `localStorage`; the 0.5.0 build stores
  nothing there (eframe's persistence is not enabled).
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `designcraft` | the document; Save replaces the file (one named `Untitled-<n>` and made in the browser gets a new file per save, see [Known gaps](#known-gaps)) | yes | yes: no other app opens it |
| `idml` | a new document; Save creates `<stem>.designcraft` next to the IDML, which stays as it is; Export IDML… writes a new IDML | yes | yes: no common Nextcloud app opens IDML |

Match the extension in any letter case, as DesignCraft does. Nextcloud 34 and 35 know neither
type (`resources/config/mimetypemapping.dist.json` has no `designcraft`, `idml` or `indd`), so
both arrive as `application/octet-stream` and the app must pick DesignCraft by extension.

Do not offer anything else: DesignCraft only places other files into an open document, and on
the start screen nothing opens. That includes `.indd` (binary InDesign is not supported), `.ase`
(swatches only), images, PDF, SVG, text and Word files.

## Tests

`designcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`designcraft-chromium` and `designcraft-webkit`. The behaviour the core shares with every app
(fallback downloads, a foreign host, startup errors) is tested in `translator.spec.ts` and
`pdfcraft.spec.ts`; this spec checks what depends on DesignCraft.

The spec has three tests, and its header lists them with their scenarios. The first two are the
contract tests; the canary runs them apart from the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open of a `.designcraft` whose stored title differs from its name. An inserted page saved with Ctrl+S arrives as the document under the opened name, a DesignCraft package with the edit; Save As (Ctrl+Shift+S) after another edit is the document again. Export Page as PNG (Ctrl+E) and the save of a new document (Ctrl+N) arrive as new files. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | Saves under another name or type: an opened `.idml` saves as `<stem>.designcraft` (not under the name stored in the IDML), as the document, and so does the next save, with the edit. `Probe.DESIGNCRAFT` saves as `Probe.designcraft` and an IDML named `from-indesign.idml.idml` as `from-indesign.designcraft`, both as the document. `Untitled-1.designcraft` as the desktop app writes it (the fixture with a creation time, made in the spec) saves as the document, keeping its creation time, and a new document (Ctrl+N), which saves under the same name, arrives as an export. |
| `ui` (`@ui`) | The File menu with the pointer, on an opened `.idml`: Save saves the document; Export IDML…, under the opened name, arrives as a new file. |

A test with several scenarios (`saved-as`) runs each in a page of its own and reports every
scenario that fails as `scenario failed: <title>`, not only the first.

DesignCraft has no command palette: Ctrl+K opens Preferences (`menus.rs:55`), and Quick Apply
(Ctrl+Enter, `menus.rs:54`) runs its first entry, which creates a new document, in the same
frame that opens it. So
the tests use DesignCraft's keyboard shortcuts from `menus.rs` (`UI_COMMANDS`) and
`engine/src/cmd/layout.rs` (Insert Pages…, Ctrl+Shift+P), and confirm dialogs with Enter
(`ui-egui/src/dialogs.rs:1373-1381`). Only the `ui` test also clicks with the pointer; its click
positions are in the `AT` table of the spec, measured on 0.5.0 at a 1400x900 viewport with the
locale `en-US`. When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing (`web.rs:7`, `ui-egui/src/lib.rs:556-574`), the title rule, the download helper
  (`web.rs:151-186`), Save going through `download_document` (`menus.rs:719`, `menus.rs:1383`) or
  the package format (`format/src/lib.rs`). The rules fail towards new files, not towards
  overwriting: a save under a name the adapter does not expect arrives as an `export`. Sites that host the app
  should hold the release back until the adapter is fixed.
- **Only the `@ui` test fails.** A menu item moved. Re-measure the positions in `AT`; the
  translator is not at fault.
- **A shortcut changed upstream.** The tests that press it fail: Ctrl+S, Ctrl+Shift+S, Ctrl+E,
  Ctrl+N and Ctrl+Shift+P are used by the contract tests. Check them against `menus.rs` and
  `layout.rs` before holding a release back.

The fixtures in `tests/e2e/fixtures/designcraft/` were made with DesignCraft 0.5.0, because
both formats need a complete document model that a script cannot write without the app: a new
document (Ctrl+N, Enter), a text file with the marker `CRAFTSUITE-PROBE-dc01` and a 64x48 PNG
dropped onto it, then Save (`craftsuite-probe.designcraft`, stored title `Untitled-1`) and,
after opening that file, File > Export IDML… (saved as `from-indesign.idml`, stored name
`craftsuite-probe.indd`). The tests derive the other names they open from these two files, and
the package with a creation time that the desktop app would store (the web build stores 0).

## Upstream

DesignCraft has no embedding API. With one, as requested for PdfCraft in
[storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422), the open and save
paths would no longer depend on drops and downloads; see
[architecture.md](../architecture.md#native-embedding-apis). Worth reporting upstream as well:
the `application/json` type of a `.designcraft` download, Save a Copy… doing nothing on the web,
the creation time 0 in documents of the web build (`js_sys::Date` would give it a clock, and a
new document could then be told from the opened one), and the `?cpu` flag and sizes in
`HOSTING.md`.
