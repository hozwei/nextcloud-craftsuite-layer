<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# DeckCraft

| | |
|---|---|
| Upstream | [github.com/storytold/deckcraft](https://github.com/storytold/deckcraft) |
| Adapter | [`translators/deckcraft.js`](../../translators/deckcraft.js) |
| Tested version | `tested` in [`apps.json`](../../apps.json) (0.5.0 when this page was written) |
| Tests | [`tests/e2e/specs/deckcraft.spec.ts`](../../tests/e2e/specs/deckcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the DeckCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.5.0
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source
references are to the `v0.5.0` tag; `web.rs` is `apps/deckcraft-web/src/web.rs`, the other paths
are under `crates/`.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#deckcraft_canvas`), where eframe registers its
  only `drop` listener. eframe does that after it has created the graphics and the app, which
  builds the sample deck first (`web.rs:31-55`), so the first `drop` listener is the one that
  reads files: the core's default drop target fits, and the adapter needs no `started` check. The
  listener came 0.5 to 1.1 s after `TrunkApplicationStarted` in Chromium with SwiftShader; the
  adapter allows 10 s (`dropTargetTimeout`). The drop handler does not check `isTrusted`, so the
  translator's simulated drop works like a user's drop.
- **A document is always open.** Every session starts with the sample deck, titled `Northern
  Lights` (with `?blank` an empty `Presentation1`, `web.rs:41-48`). The file the host sends opens
  as a second document, and the sample stays open behind it. There is no tab bar; the command Next
  Window switches between the documents (its shortcut Cmd+\` does nothing in the web build).
- Each dropped file is read asynchronously and keeps its `File.name` (`web.rs:77-92`). Then the
  name decides, in any letter case (`ui-egui/src/lib.rs:499-529`):
  - `.deckcraft`, `.slidecraft`, `.pptx`, `.potx`, `.ppsx`: opens as a new document;
  - a picture, audio or video file: inserted into the active document (the sample deck, unless
    the user switched);
  - `.txt`, `.md`: its lines become slides of the active document;
  - anything else: `<name>: DeckCraft can't open this kind of file` in the status bar.
- DeckCraft tells its own files from PowerPoint packages by content
  (`engine/src/cmd/file.rs:57-66`): a zip with its MIME type in the first 200 bytes is a native
  file (`format/src/lib.rs:84-88`), a zip with `[Content_Types].xml` a PowerPoint package. The
  name only routes the drop, so a PowerPoint package named `talk.deckcraft` opens as PowerPoint.
  A `.slidecraft` from before the rename opens only if its manifest says `deckcraft`; real old
  files say `slidecraft` and fail with `not a DeckCraft file: slidecraft`
  (`format/src/lib.rs:103-106`). With two `presentation.json` entries in a native file,
  DeckCraft's zip reader takes the last one (checked in Chromium).
- **The document's title comes from the file name**, never from the file: the name up to its last
  dot (`engine/src/cmd/file.rs:80-82`, Rust's `file_stem`). The title stored in a file (`dc:title`
  of a PowerPoint package, `props.title` of a native file) stays in the document properties. The
  tests open fixtures whose stored titles differ from their names.
- Files also reach the app from the user: a drop from the desktop, and Open (Ctrl+O, or Open… on the
  Home screen), a file picker (`<input type=file>` through rfd, `web.rs:107-127`).
  Each such presentation opens as another document.
- There is no `?file=` and no embedding API. The query flags are `webgl`, `blank` and `show` (see
  [Hosting notes](#hosting-notes)).
- There is no JavaScript-visible signal that a file was opened, could not be opened, or has
  unsaved changes. The host only gets `delivered`.

**Saving and downloads**

- Every download goes through one helper (`web.rs:139-164`): a `Blob` typed by the extension
  (`web.rs:166-176`; `application/zip` for `.deckcraft`), `URL.createObjectURL`, an
  `<a download>` with `display: none` appended to `<body>`, `click()`, then the element is
  removed at once and the URL revoked after 10 s. There is no File System Access API.
- Save (Ctrl+S, the Save button in the title bar), Save As… (Ctrl+Shift+S) and Save as
  Template… all end in `save_as_dialog("deckcraft")` (`ui-egui/src/lib.rs:413-461`,
  `menus.rs:27-31`, `engine/src/cmd/file.rs:182-201`). A document opened from bytes has no path,
  so none of them asks for a name: each downloads `<title>.deckcraft`, the whole document written
  as a new zip (`format/src/lib.rs:43-73`: the stored `mimetype` entry with
  `application/vnd.storyteller.deckcraft+zip` first, then `presentation.json`, deflated, and
  `media/<id>`), not an update of the opened bytes. Two saves of the same state are the same
  bytes.
- The web save does not mark the document saved (`engine/src/cmd/file.rs:156-168` runs only with
  a path): the title bar keeps `— Edited`, and every later save writes the same name again.
- `presentation.json` names its writer (`generator`, `DeckCraft 0.5.0`) and the format version
  (`version`, 1). Readers ignore unknown fields (`format/src/lib.rs:1-3`), so a file written by a
  newer DeckCraft opens, and Save writes it without what 0.5.0 does not know: the fields are gone
  and the generator says 0.5.0.
- New Presentation (Ctrl+N) titles a document `Presentation<N>`, counting in each session
  (`engine/src/lib.rs:388-391`). The sample deck took 1 and was retitled `Northern Lights`
  (`engine/src/sample.rs:130-136`), so the first new presentation is `Presentation2`. Their saves
  are `Presentation<N>.deckcraft` and `Northern Lights.deckcraft`.
- The only identity a file carries is the creation time in its document properties
  (`props.created`, a string, `model/src/lib.rs:727-741`). Only the PowerPoint reader sets it,
  from `dcterms:created` of the core properties part (`pptx/src/read/mod.rs:378-382, 651-667`).
  Every save keeps it, and the PowerPoint export writes it back. DeckCraft never sets one itself,
  neither the desktop app nor the web build: new presentations, the sample deck and files made
  from them have none.
- On Windows and Linux the shortcuts are Ctrl+S and Ctrl+Shift+S (`Cmd` is Ctrl there). The
  tests press Ctrl, also in WebKit with Safari's user agent.
- Exports come from the Export dialog (`ui-egui/src/dialogs.rs:370-474`), drawn in the canvas;
  each is named after the title. The names below were checked in Chromium.

| Download | Name | Kind |
|---|---|---|
| Save (Ctrl+S, title bar), Save As… (Ctrl+Shift+S), Save as Template… of the opened document | `<title>.deckcraft`, the whole file | `document`; `copy` for a file of a newer DeckCraft and for a PowerPoint file named `.deckcraft` (see [How the adapter classifies](#how-the-adapter-classifies)) |
| Save of another document (a new presentation, the sample deck, a presentation the user opened from their disk) | `<its title>.deckcraft` | `export`; with the opened document's title see [How the adapter classifies](#how-the-adapter-classifies) |
| Export > PDF document | `<title>.pdf` | `export` |
| Export > PNG images (current slide), PNG images (all slides) | `<title>.png`; on the web both write only the current slide (`dialogs.rs:458-466`) | `export` |
| Export > JPEG image | `<title>.jpg` | `export` |
| Export > PowerPoint Presentation | `<title>.pptx`; for an opened `<title>.pptx` that is the opened name | `export` |
| Export > Outline | `<title>.txt` | `export` |

Nothing else downloads. The web build also wires `Services::write` to the download helper
(`web.rs:128`), but only the control channel calls it (`ui-egui/src/control.rs`), and only the
desktop app connects one (`apps/deckcraft/src/main.rs:214`).

**PowerPoint files**

- DeckCraft reads a PowerPoint package into its own model and leaves out what it does not model
  (`pptx/src/lib.rs:4-6`): unknown parts are skipped, SmartArt becomes a group of its drawn
  shapes, other unknown graphic frames (OLE objects, for example) become shapes holding their XML
  and a preview (`pptx/src/read/shapes.rs:338-363`). The test fixture's `customXml` part is
  missing from DeckCraft's PowerPoint export. So Save never writes a `.pptx` (it writes
  `<title>.deckcraft`), and Export > PowerPoint of an opened `x.pptx`, under the opened name, is
  DeckCraft's re-encoding, never a save of the file. A PowerPoint package named `x.deckcraft`
  saves under the opened name too, as DeckCraft's own file of what it read: a copy, not a save
  that may replace it.

**Links**

- The links in the About dialog and the credits are egui hyperlinks (`ui-egui/src/dialogs.rs:800-802`,
  `credits.rs:259`, `credits.rs:282`), which eframe opens with `window.open` and target `_self`.
  In a frame that would replace the editor; the translator opens them in a new window instead.
  Links on the ribbon and in a slide show open a new tab anyway (`ui-egui/src/lib.rs:735-737`,
  `show.rs:306`).

## How the adapter classifies

The adapter tells the core the name DeckCraft gives a save of the opened file (`savedName`): the
title as above, plus `.deckcraft`. For `talk.deckcraft` that is the opened name; for `talk.pptx`,
`talk.potx` or `Deck.v2.PPSX` it is `talk.deckcraft` or `Deck.v2.deckcraft`. The core calls the
adapter for a download whose sanitised name equals a file opened in the frame, or the saved name
of one.

The adapter's `identity` is the creation time DeckCraft reads from a file: `props.created` in
`presentation.json` of a native file, or, for a PowerPoint package, the last `created` element
of the core properties part that the first core-properties relationship of `_rels/.rels` names,
with part names compared in any letter case and XML references resolved as DeckCraft does
(`pptx/src/opc.rs`, `pptx/src/xml.rs`). It unpacks the entries it needs with
`DecompressionStream('deflate-raw')` (at most 256 MB each), taking the last of entries with the
same name as DeckCraft's zip readers do. The core keeps the identity with the opened file and
sends a save whose creation time differs from the document's as an `export` without asking the
adapter (see [protocol.md](../protocol.md#saves)).

The adapter also watches the `files` getters of `DataTransfer` (only during a trusted `drop`)
and of `<input type=file>`, which is how DeckCraft 0.5.0 reads presentations the user brings in,
and records the name each such presentation saves under (`<stem>.deckcraft`, cleaned up as the
core cleans every save name). The translator's own drop is synthetic (`isTrusted` false) and
does not count. PhotoCraft's adapter does the same ([photocraft.md](photocraft.md#known-gaps)).

For a download under the saved name it returns, in this order:

1. `export` unless it is a native file as Save writes it (a zip whose first entry is the stored
   `mimetype` with `application/vnd.storyteller.deckcraft+zip`): Export > PowerPoint under an
   opened `.pptx`'s name never gets further.
2. `export` if a presentation the user brought in saves under this name.
3. `export` if the adapter cannot read the save's `presentation.json` (over 256 MB): its creation
   time is unknown.
4. `export` if the save cannot be told from another document's: the opened document has a
   creation time and the save has none (every save keeps it); the opened document has none and
   the save has one (DeckCraft never sets one, so it came from another file); or neither has one
   and the title is `Presentation<N>` or `Northern Lights`, the titles of a new presentation and
   of the sample deck.
5. `copy` if Save loses something of the opened file: a native file whose writer is newer than
   the running build (its `generator` names a higher DeckCraft version than the save's, or
   another program) or whose format `version` is higher, so Save drops what this build does not
   know; a native file whose `presentation.json` the adapter cannot read, so its writer is
   unknown; or a PowerPoint package opened under a `.deckcraft` name, which Save would replace
   with DeckCraft's re-encoding. The first such save becomes a new file next to the original and
   the later ones replace that file; the original stays as it is (see
   [protocol.md](../protocol.md#copies)).
6. `document` otherwise.

- Save rewrites the whole file, so the prefix check of PdfCraft does not apply: the saved name,
  the native file, the creation time and the files the user brought in decide.
- An opened `x.pptx` saves as `x.deckcraft`, another name than it was opened with. The first such
  save arrives as `document` with the open's `openId`; the Nextcloud editor page stores it as a
  new file next to the PowerPoint file (with a free name, so an existing `x.deckcraft` is not
  touched), and later saves replace that file (see [protocol.md](../protocol.md#saves) and
  `craftsuite_layer/src/editor.ts`). The PowerPoint file stays as it is. The editor page sends
  names with a lower-case extension, so in Nextcloud `Deck.v2.PPSX` arrives as `Deck.v2.ppsx`.
- A new presentation is `Presentation2` in nearly every session, so its save has the name of an
  opened `Presentation2.deckcraft`. A file that came from PowerPoint has a creation time that
  every save keeps and a new presentation lacks, so the two are told apart. A file made in
  DeckCraft has none, and its saves under these names are never the document: new files, nothing
  overwritten.
- Save As… and Save as Template… replace the opened file like Save: on the web there is no dialog
  for another name, and the bytes are the same document.
- The rules fail towards new files: a save the adapter does not recognise arrives as an `export`.

## Known gaps

- **Presentations named like a new one.** A file made in DeckCraft (no creation time) and named
  `Presentation<N>.deckcraft` or `Northern Lights.deckcraft` is never saved back: every save of it
  is a new file (`Presentation2 (2).deckcraft`, then `(3)`, ...), because the save of a new
  presentation or of the sample deck looks the same. Renaming the file in Nextcloud before opening
  it avoids that.
- **After a same-named file from the user, no save is the document.** Once the user has opened or
  dropped a presentation that saves under the opened file's saved name, every later save under
  that name is a new file, also a save of the opened document: the adapter cannot tell which
  document a save comes from.
- **A presentation that arrives unseen.** A presentation with the opened document's title and
  without a creation time (or with the opened file's, such as another copy of the same PowerPoint
  file) that reaches DeckCraft in a way the watched getters miss passes as `document`: for
  example, if a release reads the user's files another way. The host may replace the opened
  file with it; Nextcloud's file versions (where enabled) keep the previous state. The test
  `saved-as` notices a release that reads files another way only for Open (Ctrl+O) and the desktop
  drop it performs.
- **Creation times read differently.** A PowerPoint package whose creation time the adapter reads
  differently from DeckCraft (a nested element, a part name DeckCraft resolves otherwise) gets
  new files instead of saves.
- **Writers that claim to be DeckCraft 0.5.0.** The copy rule goes by the writer a native file
  names. A file another program wrote with `generator` `DeckCraft 0.5.0` and fields or zip
  entries DeckCraft 0.5.0 does not read saves as `document` and loses them.
- **No unsaved-changes signal.** DeckCraft shows `— Edited` in the title bar, also after a save
  on the web, and keeps no recovery data in the browser (AutoRecover needs a folder that only the
  desktop app sets, `apps/deckcraft/src/main.rs:202-204`). The host cannot tell whether the user
  has unsaved edits and must warn on close. Close is Ctrl+W, but in a browser Ctrl+W closes the
  tab.
- **`delivered` is not "opened".** The host cannot tell whether DeckCraft could read the file; a
  file it cannot open shows an error in its status bar only.
- **The sample deck.** It is open behind every opened file. A picture or text file that reached
  the app would go into it; the Nextcloud app offers none (see [File types](#file-types)).
- **Older browsers save new files only.** Without `DecompressionStream('deflate-raw')` (Safari
  before 16.4, Chrome before 103, Firefox before 113) the adapter cannot read DeckCraft's files,
  so every save becomes a new file, and an opened `.deckcraft` is kept as it is.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so DeckCraft
  cannot start there.

## Hosting notes

- DeckCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no special
  headers (no COOP/COEP). For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`.
- The web build renders with wgpu: WebGPU where the browser has it, else WebGL2. With neither it
  shows `DeckCraft failed to start` in place of the canvas (`web.rs:56-61`) and registers no drop
  target, and the host gets `the app registered no drop target` after the adapter's 10 s. The
  tests run on WebGL2 (Chromium with SwiftShader, and WebKit).
- Query flags are substrings of the whole query string (`web.rs:26`, `42`, `49`): `webgl` forces
  WebGL2, `blank` starts with an empty presentation instead of the sample deck, and `show` starts
  the slide show. Any query that contains one of them by accident turns it on. The Nextcloud app
  refuses app addresses with a query.
- The slide show asks for fullscreen (`show.rs:238`), which eframe's web runner ignores: the show
  runs inside the frame.
- The `.wasm` file of 0.5.0 is 29.7 MB, 12.4 MB with gzip. Serve it compressed, preferably
  precompressed with Brotli.
- The loader is Trunk's inline module script in `index.html`. It imports
  `deckcraft-web-<hash>.js`, awaits the `.wasm` module and then dispatches
  `TrunkApplicationStarted`. A `.wasm` file that is missing or cannot be compiled makes the
  loader fail, and the host gets `the app failed to load: ...`; a Content-Security-Policy that
  blocks the inline script leads to `the app did not start in time` (see
  [protocol.md](../protocol.md#errors)).
- DeckCraft stores nothing in the browser: no `localStorage` (eframe's persistence is not
  enabled, `apps/deckcraft-web/src/main.rs:13`), no AutoRecover.
- The interface is English only in 0.5.0 (no translations yet; upstream issue #15 asks to follow
  the system language), so the Nextcloud app offers no start language for DeckCraft. Review >
  Language marks the proofing language of text, not the interface language.
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `deckcraft` | the document; Save replaces the file (one named `Presentation<N>` or `Northern Lights` gets a new file per save, see [Known gaps](#known-gaps)); a file of a newer DeckCraft, or a PowerPoint package with this extension, gets one copy next to it | yes | yes: no other app opens it |
| `pptx`, `potx`, `ppsx` | a new document; Save creates `<stem>.deckcraft` next to the file, which stays as it is; Export > PowerPoint writes a new `.pptx` | yes | no: Nextcloud Office, ONLYOFFICE and Euro-Office open them on a click where installed, and a click that ends in a new `.deckcraft` file would surprise |

An administrator can make DeckCraft the default app ([nextcloud-app.md](../nextcloud-app.md#configuring));
then a click opens PowerPoint files in DeckCraft too, and their first save creates a `.deckcraft`
next to them.

Match the extension in any letter case, as DeckCraft does. Nextcloud 34 and 35 map `pptx`,
`potx` and `ppsx` to their Office MIME types (`resources/config/mimetypemapping.dist.json`) and do
not know `deckcraft`, which arrives as `application/octet-stream`; the app must pick DeckCraft by
extension. For the DeckCraft icon in Files the Nextcloud app registers `application/x-deckcraft`
for it ([nextcloud-app.md](../nextcloud-app.md#file-type-icons)).

Do not offer anything else: `.slidecraft` (old files fail to load), `.pptm`, `.ppt` and `.odp`
(DeckCraft does not read them), text and outline files and media (they go into the sample deck,
not into a document of their own).

## Tests

`deckcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`deckcraft-chromium` and `deckcraft-webkit`. The behaviour the core shares with every app
(fallback downloads, a foreign host, startup errors, copies) is tested in `translator.spec.ts`
and `pdfcraft.spec.ts`; this spec checks what depends on DeckCraft.

The spec has three tests, and its header lists them with their scenarios. The first two are the
contract tests; the canary runs them apart from the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open of a `.deckcraft` whose stored title differs from its name. A new slide saved with Ctrl+S arrives as the document under the opened name, a DeckCraft file with the opened text and the new slide; Save As (Ctrl+Shift+S) after another new slide is the document again. Export (PDF) and the save of a new presentation (Ctrl+N, `Presentation2.deckcraft`) arrive as new files. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | Ten scenarios (nine outside Chromium), each in a page of its own. An opened `.pptx` saves as `<stem>.deckcraft`, as the document, keeping its creation time, and so does the next save; `Deck.v2.PPSX` saves as `Deck.v2.deckcraft`. A `.deckcraft` from a newer DeckCraft (made in the spec) and the PowerPoint fixture under a `.deckcraft` name save as copies: the first save is a `document` that `follows` its own id (for the newer file without the fields 0.5.0 does not know), the next one a `document` that `follows` the first. The blank of the Nextcloud app's "+ New" entry (`craftsuite_layer/assets/blank.deckcraft`, opened as `blank.deckcraft`) opens, and its first save, without an edit, is the document. `Presentation2.deckcraft` with a creation time saves as the document, while a new presentation (Ctrl+N) and the sample deck (Next Window) saved meanwhile are new files, and after another Next Window the opened document saves as the document again. `Presentation2.deckcraft` and `Northern Lights.deckcraft` without a creation time are never saved back. A PowerPoint file that reaches the app unseen (a synthetic drop) saves as a new file because of its creation time, and a presentation with the opened name opened with Open (Ctrl+O), or dropped from the desktop (Chromium only: DevTools protocol), saves as a new file. |
| `ui` (`@ui`) | With the pointer, on an opened `.pptx`, each path in a page of its own: Title Only from the New Slide menu, then the Save button in the title bar saves the document; PowerPoint Presentation in the Export dialog, then Export, arrives as a new file under the opened name. |

A test with several scenarios runs each in a page of its own and reports every scenario that
fails as `scenario failed: <title>`, not only the first.

The steps use the keyboard: Ctrl+S, Ctrl+Shift+S, Ctrl+N and Ctrl+O (`ui-egui/src/menus.rs:11-53`
and the command shortcuts in `engine/src/cmd/`), and the command palette (Ctrl+Shift+P,
`menus.rs:55-125`) for New Slide, Next Window and the Export dialog. The palette matches labels
and command ids by substring and runs the first match; the Export dialog is reached by its id
`app.exportDialog`, because its label `Export…` first finds `file.export`, which needs a path.
Enter confirms a dialog (`ui-egui/src/dialogs.rs:82-98`). A key pressed in the frames right after
the palette closed can get lost, so the steps wait until the picture settles before the next key.
Only the `ui` test also clicks with the pointer; its click positions are in the `AT` table of the
spec, measured on 0.5.0 at a 1400x900 viewport with the locale `en-US`. When a new release fails
the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing (`ui-egui/src/lib.rs:499-529`), the title rule, the download helper
  (`web.rs:139-176`), Save going through `save_as_dialog` (`ui-egui/src/lib.rs:413-461`), the
  native format or its manifest (`format/src/lib.rs`), the names of new presentations and of the
  sample deck, or the way the user's files are read. The rules fail towards new files, not
  towards overwriting. Sites that host the app should hold the release back until the adapter is
  fixed.
- **Only the `@ui` test fails.** A button or menu item moved. Re-measure the positions in `AT`;
  the translator is not at fault.
- **A shortcut or palette label changed upstream.** The tests that use it fail. Check them
  against `menus.rs`, `lib.rs` (`UI_COMMANDS`) and `engine/src/cmd/` before holding a release
  back.

The fixtures are in `tests/e2e/fixtures/deckcraft/`. `make-fixtures.mjs` writes
`craftsuite-probe.pptx`, a small PowerPoint package: one slide with a text box holding the marker
`CRAFTSUITE-PROBE-dk01`, the stored title `Stored title differs`, the creation time
`2025-01-02T03:04:05Z` and a `customXml` part DeckCraft does not model.
`craftsuite-probe.deckcraft` was saved by DeckCraft 0.5.0 (Ctrl+S in the test host) from the same
package without its creation time, so it is DeckCraft's own file of that slide, like any file
made in DeckCraft. The tests derive the other files they open from these two: the native file
with a creation time, as DeckCraft keeps it from PowerPoint; one written by a "DeckCraft 9.0.0"
with fields 0.5.0 does not know; and another presentation with other text.

## Upstream

DeckCraft has no embedding API. With one, as requested for PdfCraft in
[storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422), the open and save
paths would no longer depend on drops and downloads; see
[architecture.md](../architecture.md#native-embedding-apis). Worth reporting upstream as well:
the web save never marks the document saved; the web build sets no creation time (with one, a
new presentation could be told from the opened one); Save of a file from a newer DeckCraft drops
its unknown fields without a word; the PowerPoint export drops parts it does not model; old
`.slidecraft` files fail to load; Next Window's Cmd+\` does nothing in the web build; and the
query flags are substrings of the whole query.
