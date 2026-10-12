<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# WordCraft

| | |
|---|---|
| Upstream | [github.com/storytold/wordcraft](https://github.com/storytold/wordcraft) |
| Adapter | [`translators/wordcraft.js`](../../translators/wordcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.5.0 when this page was written) |
| Tests | [`tests/e2e/specs/wordcraft.spec.ts`](../../tests/e2e/specs/wordcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the WordCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.5.0
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source references
are to the `v0.5.0` tag; `web.rs` is `apps/wordcraft-web/src/web.rs`, the other paths are under
`crates/`.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#wordcraft_canvas`), where eframe registers its
  drop listener once the graphics and the app run (`web.rs:38-56`). The drop handler does not
  check `isTrusted`, so the translator's simulated drop works like a user's drop. The core's
  default drop target and its `ready` fit; the adapter needs no `dropTarget` or `started`.
- Each dropped file is read asynchronously and keeps its `File.name` (`web.rs:77-95`), and so
  does a file chosen in any of WordCraft's three pickers (document, picture, recipient list,
  `web.rs:156-174`). Then the name decides, whatever the picker, in any letter case
  (`ui-egui/src/lib.rs:941-961`, `drain_inbox`):
  - `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`: a picture inserted into the document;
  - `.csv`, `.tsv`: mail-merge recipients; a `.txt` too while WordCraft waits for a list, that
    is from Select Recipients > Use an Existing List… until the next command, also when the
    picker was cancelled and the `.txt` is dropped instead (`lib.rs:166-168`, `356-358`, `948`);
  - anything else: File > Open of that file (`engine/src/cmd/file.rs:121-140`), which picks the
    reader by extension (`engine/src/io.rs:89-106`): `docx`, `docm`, `dotx`, `dotm`, `doc`,
    `dot`, `odt`, `rtf`, `txt`, `md`, `html`, `htm`, `tex` and `json` (WordCraft's document
    model) open; others fail with a message in the status bar.

  WordCraft holds one document. An opened file replaces it, after a question whether to save the
  changes if it has unsaved ones (`lib.rs:326-330`). The host's file arrives in the untouched
  `Document1` the app starts with.
- A password-protected Word document opens after WordCraft asks for the password
  (`lib.rs:466-479`); its saves are encrypted with it again (`file.rs:135-138`).
- An opened `.dotx` or `.dotm` is edited and saved as that template, not used to start a new
  document as Word does.
- There is no `?file=` and no embedding API. The only query flags are `webgl` and `sample` (see
  [Hosting notes](#hosting-notes)).
- There is no JavaScript-visible signal that a file was opened or could not be opened. The host
  only gets `delivered`.

**Saving and downloads**

- Every download goes through one helper (`web.rs:203-227`): a `Blob` typed by the extension
  (`web.rs:297-311`), `URL.createObjectURL`, an `<a download>` with `display: none` appended to
  `<body>`, `click()`, then the element is removed at once and the URL revoked after 10 s. There
  is no File System Access API.
- Save (Ctrl+S, the save button in the title bar, File > Save, Save in the question about unsaved
  changes) and Save As (F12, File > Save As) ask for no name on the web: the file picker hook
  returns the suggested name (`web.rs:176`), and both download at once (`lib.rs:375-410`).
  Ctrl+Shift+S is not Save As in WordCraft but Apply Styles (`engine/src/cmd/para.rs:182-185`).
- The name is `default_save_name` (`lib.rs:741-762`): for a document opened from a Word package
  (`.docx`, `.docm`, `.dotx`, `.dotm`) the opened name, its extension in the opened letter case;
  for any other opened file `<stem>.docx` (an opened `report.odt` saves as `report.docx`); for a
  new document `<title>.docx`, or `Document1.docx` without a title. The web build never changes
  the document's file name on a save, so every later save has the same name.
- Every save writes the whole Word package anew from WordCraft's document model
  (`engine/src/io.rs:108-129`), never an update of the opened bytes. Each save stamps
  `docProps/core.xml` (`engine/src/session.rs:447-458`): the modified time, the revision, the
  user name, and the creation time (`dcterms:created`) only where there is none, from the
  browser's clock. `docProps/app.xml` names `WordCraft` as the application
  (`docx/src/write/mod.rs:931-945`).
- **A save loses what WordCraft does not model.** Upstream's own table
  (`docs/file-format-parity.md`) gives `.docx` about 65% fidelity. A save of a `.docx` from
  Word drops content controls (their text stays), legacy form fields (their field code stays) and
  custom XML parts, as seen with the fixture `from-word.docx`; upstream also lists Word ink,
  drawing canvases, the glossary, `altChunk`, embedded fonts and others. WordCraft says so itself
  (`ui-egui/src/lib.rs:205-207`). ODT, RTF and DOC are read with less fidelity still, but their
  saves go to a new `<stem>.docx` anyway.
- WordCraft marks the document saved as soon as a save's download starts
  (`lib.rs:406-408`), without knowing whether the host stored it. AutoSave is off and cannot be
  turned on in the browser (`web.rs:52`, `lib.rs:833-836`).
- New documents come from File > New (Ctrl+N), the templates, Mailings > Envelopes and Labels:
  no file name, an empty title (`engine/src/cmd/file.rs:108-119`), so they save as
  `Document1.docx`, every time (no counter). `Document1` is translated with the interface
  language, which follows the browser's: `Documento1` (es, pt-BR), `Dokument1` (et, sr-Latn),
  `文書 1` (ja), `Документ1` (sr, uk), `文档1` (zh-Hans), `文件1` (zh-Hant)
  (`ui-egui/src/i18n/*.tsv`). The sample document keeps its title
  `The Open Studio Handbook` (`engine/src/sample.rs:32`). Each gets a creation time of its own on
  its first save.
- **Mailings > Finish & Merge** makes its new document as a copy of the open one
  (`engine/src/cmd/mailings.rs:421-460`: `s.doc.clone()`, then `path = None`), so it keeps the
  open document's title and creation time. It saves as `<title>.docx`, which is the saved name
  of an opened `.docx`, `.odt`, `.rtf`, `.doc` or `.dot` whose title equals the file's stem: a new
  document the user gave a title, which WordCraft saved under it, and every `Document1.docx`
  WordCraft saved (no title). It keeps the opened creation time. It needs a recipient list
  (`mailings.rs:130-132`): dropped or chosen as a file (see Opening), or typed in Select
  Recipients > Type a New List… and Edit Recipient List. It copies the body once per record and
  replaces every field it can evaluate with the record's text (`mailings.rs:351-378`, `eval`,
  and `488-512`): a code that starts with `MERGEFIELD` (in capitals), or whose first word is
  `ADDRESSBLOCK`, `GREETINGLINE`, `NEXT`, `MERGEREC`, `SKIPIF` or `IF` (any letter case). Other
  fields (`NEXTIF`, `MERGESEQ`, `PAGE`) stay fields, and so does every field in headers,
  footers, notes and text boxes, which it does not touch. WordCraft reads a field of a nest as
  text of the outermost one (`docx/src/read/story.rs:555-620`), and Save writes each field it
  keeps as a complex field with one `w:instrText` (`docx/src/write/story.rs:606-624`), so a
  save of the open document keeps its merge fields in `word/document.xml`.
- The names below were checked in Chromium through the File menu (the backstage); `<title>` is
  the opened file's stem, or for a new document its title or `Document1`.

| Download | Name | Kind |
|---|---|---|
| Save, Save As of the opened document | an opened Word package: its name; another opened type: `<stem>.docx` | `document`; for a Word package another program wrote, `copy` (see [How the adapter classifies](#how-the-adapter-classifies)) |
| Save of a new document (File > New, templates, Envelopes, Labels) | `<title>.docx`, mostly `Document1.docx` | `export` |
| Save of the document Finish & Merge made | `<title>.docx` with the opened document's title (`Document1.docx` without one) | `export` once a recipient list may have reached the app as a file, and when the version of the document it follows had merge fields; see [Known gaps](#known-gaps) |
| Save of a file the user opened from their disk (File > Open, a drop) | its own save name | `export` |
| File > Export > Word document | `<title>.docx`: what Save writes, also stamped (`ui-egui/src/file_dialogs.rs:130-137`); for an opened `.docm`, `.dotx` or `.dotm` not the saved name | like Save; otherwise `export` |
| File > Export > PDF document, OpenDocument Text, Rich Text Format, Web page, Markdown, LaTeX, Plain text | `<title>.<ext>` (`file_dialogs.rs:173-176`); for an opened `.odt` or `.rtf` that is the opened name | `export` |
| File > Export > Page image | `<title>.png`, the first page | `export` |
| Export PDF from the command search | `<save name>.pdf`, such as `report.docx.pdf` (`lib.rs:377-378`) | `export` |
| Export Page as PNG from the command search | the save name, a Word package without the save stamp: the format follows the name (`lib.rs:376-395`) | like Save |
| Save as Template | nothing: no download on the web (`engine/src/cmd/tools.rs:143` writes a file, which fails in the browser, `engine/src/io.rs:276-279`) | |
| Print (Ctrl+P, then Print) | nothing: the PDF goes into a hidden iframe and the browser's print dialog (`web.rs:238-295`) | |

Every export but Page image runs Save As with its name (`file_dialogs.rs:130-137`), so it stamps
the document (a new revision, and a creation time if it had none); Word document, OpenDocument
Text and Rich Text Format also mark it saved (`lib.rs:1072-1075`).

**Links and other browser couplings**

- The links of Help > About and of the contributor credits are egui hyperlinks, which eframe opens
  with `window.open` and target `_self`; the translator opens them in a new window instead.
  Document hyperlinks (Ctrl+click) and the Discord button open a new tab anyway.
- A `beforeunload` listener asks before the page is left while the document has unsaved changes
  (`web.rs:185-200`). Removing the frame does not ask.
- A `paste` listener on the document reads pasted pictures (`web.rs:114-150`); text paste goes
  through eframe. Pasting needs no `clipboard-read`.

## How the adapter classifies

The adapter tells the core the name WordCraft gives a save of the opened file (`savedName`): the
opened name for a Word package, otherwise `<stem>.docx`. Its `identity` is the creation time in
`docProps/core.xml`, read as WordCraft reads it: the core properties part that `_rels/.rels`
names (relationship types matched by their last segment, `docx/src/package.rs:123-126`), the
last `dcterms:created` among its elements, trimmed. Encrypted packages, ODT, RTF and DOC have
none that the adapter reads. The core keeps the creation time with the opened file (and takes
it from each stored save of the document), and sends a save whose creation time differs from the
document's as an `export` without asking the adapter (see [protocol.md](../protocol.md#saves)).

The adapter returns, for a download under the saved name:

- `export` if it is not a Word package (a zip whose `[Content_Types].xml` types the main part as
  one of WordCraft's four flavours, or a compound file with an encrypted package);
- `export` once a recipient list may have reached the app as a file (a `.csv`, `.tsv` or
  `.txt`), or once the user has opened a file of their own that saves under that name (see
  below);
- `export` if the opened document has a creation time and the save has none (an encrypted save
  has none that can be read), or if the opened document has none and the saved name is a new
  document's (`Document1` and its translations, `The Open Studio Handbook`);
- `export` if the version of the document the save follows had merge fields in its main part
  and the save has none, or its main part cannot be read (see Mail merge below);
- otherwise `copy` if the opened file is a Word package that WordCraft did not write: its
  `docProps/app.xml` does not name `WordCraft` as the application, or cannot be read (an
  encrypted package);
- otherwise `document`.

Everything else is `export`. In detail:

- **Saves rewrite the whole file**, so there is no prefix to compare: the saved name, the package
  type, the creation time and who wrote the opened file decide.
- **Files of other programs are saved as copies.** A save of a `.docx` from Word, LibreOffice or
  Nextcloud Office is WordCraft's re-encoding, which drops what it does not model. The core sends
  every such save of an open as `document` with `follows`: the first one's is its own id, which
  names no file the host has, so it becomes a new file next to the original; the later ones carry
  the first one's id and replace that new file (see [protocol.md](../protocol.md#copies)). The
  original is never replaced. Once WordCraft has saved a file, its `app.xml` names WordCraft, and
  when that file is opened again its saves replace it.
- **Other types become a new `.docx`.** An opened `report.odt`, `.rtf`, `.doc` or `.dot` saves
  as `report.docx`, the `document` of that open: the Nextcloud editor page stores it as a new
  file next to the original (under a free name, never over an existing `report.docx`), and later
  saves replace that file (see [protocol.md](../protocol.md#saves)). Export > OpenDocument Text of
  an opened `report.odt` downloads under the opened name, but it is not the saved name, so it is
  an `export`, and the ODT is never replaced.
- **New documents** save as `Document1.docx`, also when `Document1.docx` is open, and as
  `<title>.docx` when the user gave one a title. Their creation time is their own, so with an
  opened file that has one they are told apart. An opened file without one (some programs write
  none) cannot be told from a new document saved under a new document's name: such a save is
  never the document.
- **Mail merge.** The document Finish & Merge makes keeps the opened document's title and
  creation time, so it can save under the opened name and pass every check above. The adapter
  watches the `files` getters of `DataTransfer` (in any `drop`) and of `<input type=file>`,
  through which WordCraft reads dropped files and its pickers' choice. Once a `.csv`, `.tsv` or
  `.txt` came in that way (WordCraft loads a `.txt` as recipients while it waits for a list,
  from a drop as well as from the picker), every later save under the saved name is an
  `export`, also a save of the opened document, until the page in the frame is reloaded. A list
  typed into WordCraft brings in no file; the merge fields tell the merged document apart
  instead. The adapter reads the main part (the target of the package's `officeDocument`
  relationship, else `word/document.xml`, as `docx/src/read/mod.rs:86` does; at most 8 MiB
  unpacked) and looks for a field that Finish & Merge turns into text, where WordCraft reads one:
  the outermost field of a nest, simple (`w:fldSimple`) or complex (`w:fldChar`, `w:instrText`,
  `w:delInstrText`), outside text boxes (`w:txbxContent`). It does so for each version of the
  document a save can follow, which is the version the core keeps for the opened file: the
  opened bytes (passed to `savedName`), then each save that comes out as `document` and that the
  host stores. A save without such a field that follows a version with one is what Finish &
  Merge makes, and is an `export`, whatever the recipient list came from; so is a save whose
  main part cannot be read then. A version whose main part cannot be read (ODT, RTF, DOC, an
  encrypted package, a main part over the limit) counts as one without merge fields.
- **Files from elsewhere.** A document the user drops from the desktop (a trusted `drop`) or
  opens with File > Open saves under its own save name, which can be the opened one: an earlier
  download of the same file has the same name and creation time. The adapter records the save
  names of such files (pictures, `.csv` and `.tsv` aside), cleaned up as the core cleans every
  save name, and every later save under one of them is an `export`. The translator's own drop is
  synthetic (`isTrusted` false) and does not count.
- **Upper-case extensions.** WordCraft keeps the opened letter case (`Report.DOCX` saves as
  `Report.DOCX`). The Nextcloud editor page sends names with a lower-case extension, so
  `Report.DOCX` arrives as `Report.docx`, and its saves replace `Report.DOCX` in place (by its
  open, not by name).

## Known gaps

- **A merge the merge fields do not show.** With a recipient list typed in Select Recipients >
  Type a New List… or Edit Recipient List, no file comes in, and only the merge fields tell the
  document Finish & Merge makes from the open one. A merge of a document whose fields Finish &
  Merge leaves alone (none in the body, or only in headers, footers, notes or text boxes, or only
  `NEXTIF`, `MERGESEQ` or a lower-case `mergefield`), and a merge of an opened `.odt`, `.rtf`,
  `.doc` or `.dot` before its first stored save (the adapter reads only Word packages), pass as
  the document when they save under the opened name: in Nextcloud the merged document replaces
  the opened file (for a file of another program the copy next to it; for another type it
  becomes the `<stem>.docx` of that open). That happens for a `Document1.docx` WordCraft saved
  and for any document whose title equals its file's stem. Nextcloud's file versions (where
  enabled) keep the previous state. Only fresh document properties for the merged document would
  tell every merge apart (see [Upstream](#upstream)). The spec pins the guarded cases in its
  `@ui` test (a `.txt` dropped after Use an Existing List…, and a letter with a merge field after
  a typed list); the `saved-as` test drops a `.csv`.
- **Who wrote a file.** `docProps/app.xml` names the program that last rewrote it. A file
  WordCraft saved and another tool changed without rewriting `app.xml` (some libraries keep it)
  passes as WordCraft's and its saves replace it, with the losses above. So does a file from
  another WordCraft release (the desktop app, a newer web build): `app.xml` names no version,
  and what a newer release models, the hosted one may drop.
- **An opened file without a creation time.** Before its first stored save (for a file of
  another program: for the whole session, since copies never become the reference), a new
  document the user titled like the opened file's stem saves under the saved name and passes:
  for a WordCraft file as the document, for a file of another program as the copy.
- **Files named like a new document.** An opened `Document1.docx` (or `Documento1.docx` and the
  like) without a creation time saves as a new file every time: a new document's save looks the
  same. Renaming the file in Nextcloud before opening it avoids that.
- **Saves that become new files.** After a recipient list or a file of the user's own with the
  same save name came in, every save under that name is an `export` until the frame is reloaded;
  any `.txt` from a drop or a picker counts as a recipient list. Removing the document properties
  (File > Info > Inspect Document) or adding a password gives the document another or no readable
  creation time: every later save is a new file as well. So is every save without merge fields
  after a stored version with some, for the rest of that open, since such a save never becomes
  the version the next one is compared with: further saves of a merged document, and the saves of
  a letter whose merge fields the user deleted. Opening one of those new files starts afresh.
- **The guards depend on how WordCraft reads files.** Should a release read dropped or picked
  files another way (`DataTransfer.items`, the File System Access API), recipient lists and files
  from elsewhere go unnoticed. The `saved-as` test fails then. Should a release write merge
  fields another way, or leave some in the merged document, a merge from a typed list goes
  unnoticed; the `@ui` test fails then.
- **Copies of Word files.** Every open of a file from another program starts a new copy with its
  first save (`report (2).docx` next to `report.docx` in Nextcloud). Editing on in the copy
  avoids that.
- **No unsaved-changes signal.** WordCraft asks before the page unloads with unsaved changes, but
  the host cannot read that state and must warn on close.
- **`delivered` is not "opened".** The host cannot tell whether WordCraft could read the file or
  is waiting for a password.
- **Saved means downloaded.** WordCraft marks the document saved when the download starts. If
  the host cannot store the file, the translator's fallback browser download is the copy the user
  keeps.
- **Text drawn late.** In the tests, a `.docx` WordCraft wrote shows its text only after the next
  repaint (the pointer moving over the frame, a key); the status bar counts its words at once,
  and saves keep it.
- **Memory.** WordCraft passes every opened file through base64 (`lib.rs:954`) and builds
  saves in memory. Very large documents may fail inside the app, while the host only sees
  `delivered`.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so WordCraft
  cannot start there.

## Hosting notes

- WordCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no
  special headers (no COOP/COEP), and not to send `X-Frame-Options: DENY` or a
  `frame-ancestors` that excludes the embedding page. For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`; Print and the question before
  leaving need `allow-modals` as well.
- The web build renders with wgpu: WebGPU where the browser has it, else WebGL2. With neither,
  it writes `WordCraft failed to start` into `#wordcraft_loading` (`web.rs:57-62`) and registers
  no drop target, and the host gets `the app registered no drop target`. The tests run on WebGL2
  (Chromium with SwiftShader, and WebKit).
- Query flags are substrings of the whole query string (`web.rs:33`, `web.rs:50`): `webgl`
  forces WebGL2, and `sample` opens the sample document at startup, also inside another word or
  value (`?x=resample`). The Nextcloud app accepts app addresses without a query only, so neither
  can come in that way; a hosting that adds a query must avoid both.
- The `.wasm` file of 0.5.0 is 36.3 MB, 15.3 MB with gzip (`HOSTING.md` says about 13 MB and
  5 MB). Serve it compressed, preferably precompressed with Brotli.
- The loader is Trunk's inline module script in `index.html`. It imports
  `wordcraft-web-<hash>.js`, awaits the `.wasm` module and then dispatches
  `TrunkApplicationStarted`. `index.html` preloads both with `integrity` attributes; the
  translator's injection does not touch them. A `.wasm` file that is missing or cannot be
  compiled makes the loader fail, and the host gets `the app failed to load: ...`; a
  Content-Security-Policy that blocks the inline script leads to `the app did not start in time`
  (see [protocol.md](../protocol.md#errors)).
- `HOSTING.md` says preferences are kept in the frame's `localStorage`; the build stores nothing
  there (eframe's persistence is not enabled). It uses no service worker.
- The interface language follows the browser's, and with it the name of new documents.
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `docx`, `docm`, `dotx`, `dotm` | the document; Save replaces a file WordCraft wrote, and saves a file of another program as a copy next to it | yes | no |
| `doc`, `dot`, `odt`, `rtf` | the document; Save creates `<stem>.docx` next to the original, which stays as it is | yes | no |

No default action: Nextcloud Office and ONLYOFFICE open these types on a click where they are
installed, and a lossy editor should not take that click. WordCraft stays in the action menu, as
PdfCraft does for PDF. Nextcloud knows MIME types for all of them; the app matches by extension
anyway, in any letter case.

Do not offer anything else: `txt`, `md` (Nextcloud Text opens them), `html`, `htm` and `tex`
open but save as a new `.docx`, `json` is WordCraft's document model for agents, `csv` and `tsv`
only load recipients, and pictures are only inserted into the open document.

## Tests

`wordcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`wordcraft-chromium` and `wordcraft-webkit`. The behaviour the core shares with every app
(fallback downloads, a foreign host, startup errors) is tested in `translator.spec.ts` and
`pdfcraft.spec.ts`; this spec checks what depends on WordCraft.

The spec has three tests, and its header lists them with their scenarios. The first two are the
contract tests; the canary runs them apart from the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open of a `.docx` WordCraft wrote. An edit saved with Ctrl+S arrives as the document under the opened name, with the edit and the opened creation time; Save As (F12) after another edit is the document again. A file opened from the disk (File > Open, Ctrl+O, of an RTF: `probe.docx`) and the save of a new document (Ctrl+N, `Document1.docx`) arrive as new files. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | An opened `.odt` and `.rtf` save as `probe.docx`, the document, twice. A `.docx` Word wrote: the first save is a new file under the opened name, the second replaces it (`follows` the first). `Document1.docx` with a creation time saves as the document, and a new document saved under the same name is a new file; `Document1.docx` without one is a new file. After a dropped recipient list, the opened document's save is a new file. A copy of the opened file (same name and creation time, other text) opened with File > Open, and in Chromium dropped from the desktop, saves as a new file. |
| `ui` (`@ui`) | File > Export with the pointer on an opened `.odt`: PDF and OpenDocument Text (under the opened name) arrive as new files, Word document as the document `probe.docx`. Mailings > Finish & Merge on an opened `Document1.docx` after Select Recipients > Use an Existing List…, whose picker is cancelled, and a dropped `people.txt`, which WordCraft loads as recipients: the merged document, saved as `Document1.docx` with the opened creation time, arrives as a new file. Mailings > Finish & Merge on an opened letter `invitation.docx` (titled `invitation`, with a simple `MERGEFIELD` field) after a recipient typed into Select Recipients > Type a New List…, so that no file comes in: the letter saved before the merge keeps its field and is the document, and the merged document, saved as `invitation.docx` with the opened creation time and the typed name in place of the field, arrives as a new file. |

A test with several scenarios runs each in a page of its own and reports every scenario that
fails as `scenario failed: <title>`, not only the first.

WordCraft has no shortcut for File > Export: the File tab has no KeyTip
(`ui-egui/src/keytips.rs:67-80`), Tab does not move the focus to the backstage's buttons, and the
command search (`ui-egui/src/chrome.rs:138-162`) opens only with the pointer. The Mailings tab has
KeyTips (Alt, M), but the KeyTip of Select Recipients opens Type a New List…, not Use an Existing
List…. So the contract tests use the shortcuts of `engine/src/cmd/file.rs` (Ctrl+S, F12, Ctrl+N,
Ctrl+O), and only the `ui` test clicks with the pointer; its click positions are in the `AT`
table of the spec, measured on 0.5.0 at a 1400x900 viewport with the locale `en-US`. WordCraft
blinks its caret while its page has the focus, so before the spec waits for a still picture it
moves the focus to the host page. When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing (`ui-egui/src/lib.rs:941-961`), the save name (`lib.rs:741-762`), the download helper
  (`web.rs:203-227`), the save stamp (`engine/src/session.rs:447-458`), `app.xml`
  (`docx/src/write/mod.rs:940`), or how dropped and picked files are read. The rules fail towards
  new files, not towards overwriting, except a release whose new documents took over the opened
  creation time. Sites that host the app should hold the release back until the adapter is
  fixed.
- **Only the `@ui` test fails.** A tab or button moved. Re-measure the positions in `AT`; the
  translator is not at fault, unless a merge scenario fails on the kind of its save (the merged
  document arrived as `document`), or the letter in the typed-list scenario kept its field and
  still arrived as a new file.
- **A shortcut changed upstream.** The tests that press it fail. Check them against
  `engine/src/cmd/file.rs` before holding a release back.

The fixtures are in `tests/e2e/fixtures/wordcraft/`. `craftsuite-probe.docx` was saved by
WordCraft 0.5.0: on the start screen (the new `Document1`), the line
`CRAFTSUITE-PROBE-wc01 WordCraft fixture` typed, then Ctrl+S, outside a frame (no translator), so
the browser downloaded `Document1.docx`; it has no title, `WordCraft` in `app.xml` and the
creation time `2026-10-11T21:25:10Z`. `make-fixtures.mjs` writes `from-word.docx` (as Word writes
it, with a content control, a form field and a custom XML part), `probe.odt` and `probe.rtf`. The
spec derives the rest from `craftsuite-probe.docx`: the same bytes opened as `Document1.docx`,
a copy without its creation time, a copy with other text for the files from elsewhere, and the
letter for mail merge (a title and a merge field added).

## Upstream

WordCraft has no embedding API (see [architecture.md](../architecture.md#native-embedding-apis)).
Worth reporting upstream, the first because it can overwrite files in hosts that save in place:

- **Finish & Merge keeps the source document's properties.** Proposed issue text:

  > **Finish & Merge: the merged document should get fresh document properties**
  >
  > Mailings > Finish & Merge builds the merged document as a clone of the open one
  > (`crates/engine/src/cmd/mailings.rs`, `finish`: `let mut out = s.doc.clone()`, then
  > `s.set_document(out)` and `s.path = None`). The clone keeps `doc.core`: the title, the
  > creation time (`dcterms:created`) and the revision. WordCraft names an untitled document after
  > its title (`title_stem`), so the merged document of `Letter.docx` (title `Letter`) or of a
  > `Document1.docx` WordCraft saved suggests the source's own file name, and `stamp_save` keeps
  > the cloned creation time. On the desktop, Save As then offers to overwrite the template; in
  > the web build, where Save downloads at once, nothing tells the merged letters from the
  > template, and a host that saves downloads back in place (for example
  > nextcloud-craftsuite-layer) cannot keep them apart either. Expected: the merged document
  > starts with an empty title and creation time (and revision 0), like `file.new`, so it saves
  > as `Document1.docx` (Word calls its result `Letters1`) and gets its own creation time on its
  > first save. Seen in 0.5.0, web build, Chromium and WebKit.

- `HOSTING.md`: the `.wasm` size (36.3 MB, 15.3 MB with gzip, not about 13 MB and 5 MB) and
  `localStorage` (nothing is stored there).
- The query flags `webgl` and `sample` match anywhere in the query string (`?x=resample` opens
  the sample).
- From the command search, Export PDF downloads `<name>.docx.pdf`, and Export Page as PNG
  downloads the document as a `.docx` under the save name.
- Save as Template does nothing on the web.
- An opened `.docx` shows its text only after the next repaint.
