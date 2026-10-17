<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# WordCraft

| | |
|---|---|
| Upstream | [github.com/storytold/wordcraft](https://github.com/storytold/wordcraft) |
| Adapter | [`translators/wordcraft.js`](../../translators/wordcraft.js) |
| Tested version | `tested` in [`apps.json`](../../apps.json) (0.5.0 when this page was written, checked again with 0.6.1 and 0.7.0) |
| Tests | [`tests/e2e/specs/wordcraft.spec.ts`](../../tests/e2e/specs/wordcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the WordCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.5.0
source and web build, and again against 0.6.1; where the two differ, the page says so. 0.7.0
changed none of the paths the adapter relies on (the web shell only takes WMF and EMF pictures
too, the save name and the save stamp are as in 0.6.1; checked against the `v0.7.0` tag), but
it handles keys differently, see [Tests](#tests). Upstream may change any of them; the daily
canary run (see [development.md](../development.md#continuous-integration)) is there to notice.
Source references are to the `v0.6.1` tag; `web.rs` is `apps/wordcraft-web/src/web.rs`, the other paths are under
`crates/`.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#wordcraft_canvas`), where eframe registers its
  drop listener once the graphics and the app run (`web.rs:40-74`). The drop handler does not
  check `isTrusted`, so the translator's simulated drop works like a user's drop. The core's
  default drop target and its `ready` fit; the adapter needs no `dropTarget` or `started`. The
  listener comes 0.2-0.5 s after `TrunkApplicationStarted` with 0.5.0 and 0.3-0.6 s with 0.6.1
  (Chromium with SwiftShader), but once took more than the core's default 3 s on a busy CI
  machine, so the adapter's `dropTargetTimeout` is 10 s.
- Each dropped file is read asynchronously and keeps its `File.name` (`web.rs:124-140`), and so
  does a file chosen in any of WordCraft's pickers (document, picture, recipient list and, from
  0.6.1 on, font, `web.rs:203-223`). Then the name decides, whatever the picker, in any letter
  case (`ui-egui/src/lib.rs:1552-1578`, `drain_inbox`):
  - `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, and from 0.7.0 on `.wmf` and `.emf`: a
    picture inserted into the document;
  - `.ttf`, `.otf`, `.ttc`, `.otc`, `.woff`, `.woff2` (0.6.1): a font added to WordCraft and kept
    in the frame's IndexedDB (see [Hosting notes](#hosting-notes));
  - `.csv`, `.tsv` and, from 0.6.1 on, the workbooks `.xlsx`, `.xlsm` and `.ods`: mail-merge
    recipients (a workbook with several sheets asks for one first, `lib.rs:1246-1266`); a `.txt`
    too while WordCraft waits for a list, that is from Select Recipients > Use an Existing List…
    until the next command or file, also when the picker was cancelled and the `.txt` is dropped
    instead (`lib.rs:640-642`, `1237-1241`, `1559-1562`);
  - anything else: File > Open of that file (`engine/src/cmd/file.rs:137-163`), which picks the
    reader by extension (`engine/src/io.rs:106-127`): `docx`, `docm`, `dotx`, `dotm`, `doc`,
    `dot`, `odt`, `rtf`, `txt`, `md`, `html`, `htm`, `tex`, `json` (WordCraft's document model)
    and, from 0.6.1 on, `xml` (Word XML: Flat OPC or Word 2003 XML) open. 0.5.0 refuses other
    extensions; 0.6.1 opens them by their content (`io.rs:170-193`): a zip as a Word package, a
    compound file as a Word 97-2003 document, RTF, any text. Anything else fails with a message
    in the status bar.

  WordCraft holds one document. An opened file replaces it, after a question whether to save the
  changes if it has unsaved ones (`lib.rs:585-601`). 0.6.1 starts on File > Home (the start
  screen with the templates and the recent documents) over the empty `Document1`
  (`web.rs:56-69`, `lib.rs:520-532`); 0.5.0 starts in that document. The host's file arrives in
  the untouched `Document1` and closes the start screen (`lib.rs:1574-1576`). A recent document
  does not open on the web: WordCraft knows only its name, not its bytes (`backstage.rs:252-273`,
  `engine/src/io.rs:393-396`).
- A password-protected Word document opens after WordCraft asks for the password
  (`lib.rs:790-804`); its saves are encrypted with it again (`file.rs:157-160`).
- An opened `.dotx` or `.dotm` is edited and saved as that template, not used to start a new
  document as Word does.
- There is no `?file=` and no embedding API. The only query flags are `webgl` and `sample` (see
  [Hosting notes](#hosting-notes)).
- There is no JavaScript-visible signal that a file was opened or could not be opened. The host
  only gets `delivered`.

**Saving and downloads**

- Every save and export goes through one helper (`web.rs:265-284`). Where the page has
  `showSaveFilePicker` (Chromium), 0.6.1 shows the browser's save picker with the suggested name
  and writes the file through the File System Access API (`web.rs:286-390`); without it, and
  always in 0.5.0, it downloads: a `Blob` typed by the extension (`web.rs:484-499`),
  `URL.createObjectURL`, an `<a download>` with `display: none` appended to `<body>`, `click()`,
  then the element is removed at once and the URL revoked after 10 s (`web.rs:392-415`).
- **In a frame of another origin, 0.6.1 loses every save in Chromium.** Chromium refuses the
  picker there with a `SecurityError`. The call has already returned its promise, so WordCraft
  does not fall back to the download: it logs the error, marks the document unsaved again and
  shows "Couldn't download …" in the status bar (`web.rs:323-363`, `92-121`). The adapter hides
  `showSaveFilePicker` from the app (see [How the adapter classifies](#how-the-adapter-classifies)),
  so every save is the download, as in 0.5.0, also in a frame of the host's origin, where the
  picker would write past the host.
- Save (Ctrl+S, Shift+F12 in 0.6.1, the save button in the title bar, File > Save, Save in the
  question about unsaved changes) and Save As (F12, File > Save As, in 0.6.1 its Browse… button)
  ask for no name on the web: the file picker hook returns the suggested name (`web.rs:226`), and
  both download at once (`lib.rs:659-694`). Ctrl+Shift+S is not Save As in WordCraft but Apply
  Styles (`engine/src/cmd/para.rs:225-228`).
- The name is `default_save_name` (`lib.rs:1268-1274`, `title_stem` `1297-1308`): for a document
  opened from a Word package (`.docx`, `.docm`, `.dotx`, `.dotm`) the opened name, its extension
  in the opened letter case; for any other opened file `<stem>.docx` (an opened `report.odt` saves
  as `report.docx`); for a new document `<title>.docx`, or `Document1.docx` without a title. The
  web build never changes the document's file name on a save, so every later save has the same
  name.
- Every save writes the whole Word package anew from WordCraft's document model
  (`engine/src/io.rs:198-224`), never an update of the opened bytes. Each save stamps
  `docProps/core.xml` (`engine/src/session.rs:841-852`): the modified time, the revision, the
  user name, and the creation time (`dcterms:created`) only where there is none, from the
  browser's clock. `docProps/app.xml` names `WordCraft` as the application
  (`docx/src/write/mod.rs:1079`).
- **A save loses what WordCraft does not model.** Upstream's own table
  (`docs/file-format-parity.md`) gives `.docx` about 65% fidelity, in 0.6.1 as in 0.5.0. A 0.5.0
  save of the fixture `from-word.docx` (as Word writes it) drops its content control (the text
  stays), its legacy form field (the field code stays) and its custom XML part; a 0.6.1 save keeps
  the content control and the custom XML part and still drops the form field's data
  (`w:ffData`). Upstream also lists Word ink, the glossary, `altChunk`, embedded fonts and others.
  WordCraft says so itself (`ui-egui/src/lib.rs:418-422`). ODT, RTF and DOC are read with less
  fidelity still, but their saves go to a new `<stem>.docx` anyway.
- WordCraft marks the document saved as soon as a save's download starts (`lib.rs:689-692`),
  without knowing whether the host stored it. AutoSave is off and cannot be turned on in the
  browser (`web.rs:63`, `lib.rs:1435-1438`).
- New documents come from File > New (Ctrl+N), the templates (File > Home, File > New), Mailings
  > Envelopes and Labels: no file name, an empty title (`engine/src/cmd/file.rs:116-135`), so they
  save as `Document1.docx`, every time (no counter). `Document1` is translated with the interface
  language: `Documento1` (es, it, pt-BR), `Dokument1` (cs, et, pl, sr-Latn), `Dokumentum1` (hu),
  `Belge1` (tr), `文書 1` (ja), `Документ1` (bg, ru, sr, uk), `文档1` (zh-Hans), `文件1`
  (zh-Hant); de and fr keep `Document1` (`ui-egui/src/i18n/*.tsv`; bg, cs, de, fr, hu, it, pl, ru
  and tr are new in 0.6.1). 0.6.1 starts in the browser's language (see
  [Hosting notes](#hosting-notes)), so these names come without the user picking a language. The
  sample document keeps its title `The Open Studio Handbook` (`engine/src/sample.rs:32`). Each
  gets a creation time of its own on its first save. 0.6.1's Envelopes can also add the envelope
  to the open document instead of making a new one (`mailings.rs:766-818`).
- **Mailings > Finish & Merge** makes its new document as a copy of the open one
  (`engine/src/cmd/mailings.rs:566-666`: `s.doc.clone()` at 574, then `path = None` at 662), so it
  keeps the open document's title and creation time. It saves as `<title>.docx`, which is the
  saved name of an opened `.docx`, `.odt`, `.rtf`, `.doc` or `.dot` whose title equals the file's
  stem: a new document the user gave a title, which WordCraft saved under it, and every
  `Document1.docx` WordCraft saved (no title). It keeps the opened creation time. It needs a
  recipient list (`mailings.rs:24-26`): dropped or chosen as a file (see Opening), or typed in
  Select Recipients > Type a New List… and Edit Recipient List. It copies the body once per record
  and replaces every field it can evaluate with the record's text (`mailings.rs:458-497`, `act`
  and `placeholder`, and `699-736`): a code that starts with `MERGEFIELD` (in capitals), or whose
  first word is `ADDRESSBLOCK`, `GREETINGLINE`, `NEXT`, `MERGEREC` or `SKIPIF` (any letter case),
  `IF` (0.5.0 every `IF`, 0.6.1 one with `MERGEFIELD` in its code) and, in 0.6.1, `NEXTIF`. Other
  fields (`MERGESEQ`, `PAGE`) stay fields, and so does every field in notes and text boxes, which
  it does not touch. 0.5.0 leaves headers and footers alone too; 0.6.1 merges them (with merge
  fields in one, each letter becomes a section with copies of its own, `mailings.rs:500-506`,
  `571-660`). WordCraft reads a field of a nest as text of the outermost one, the inner field's
  result going into the outer one's code (`docx/src/read/story.rs:746-830`), so an `IF` that Word
  writes around a nested `MERGEFIELD` has no `MERGEFIELD` in its code, and 0.6.1 leaves it a
  field. Save writes each field it keeps as a complex field with one `w:instrText`
  (`docx/src/write/story.rs:763-813`, `862-884`), so a save of the open document keeps its merge
  fields.
- The names below were checked in Chromium through the File menu (the backstage), with 0.5.0 and
  again with 0.6.1; `<title>` is the opened file's stem, or for a new document its title or
  `Document1`.

| Download | Name | Kind |
|---|---|---|
| Save, Save As of the opened document | an opened Word package: its name; another opened type: `<stem>.docx` | `document`; for a Word package another program wrote, `copy` (see [How the adapter classifies](#how-the-adapter-classifies)) |
| Save of a new document (File > New, templates, Envelopes, Labels) | `<title>.docx`, mostly `Document1.docx` | `export` |
| Save of the document Finish & Merge made | `<title>.docx` with the opened document's title (`Document1.docx` without one) | `export` once a recipient list may have reached the app as a file, and when the version of the document it follows had merge fields; see [Known gaps](#known-gaps) |
| Save of a file the user opened from their disk (File > Open, a drop) | its own save name | `export` |
| File > Export > Word document | `<title>.docx`: what Save writes, also stamped (`ui-egui/src/file_dialogs.rs:216-223`); for an opened `.docm`, `.dotx` or `.dotm` not the saved name | like Save; otherwise `export` |
| File > Export > PDF document, Word XML Document (0.6.1), OpenDocument Text, Rich Text Format, Web page, Markdown, LaTeX, Plain text | `<title>.<ext>` (`file_dialogs.rs:274-277`); for an opened `.odt` or `.rtf` that is the opened name | `export` |
| File > Export > Page image | `<title>.png`, the first page | `export` |
| Export PDF from the command search (in 0.6.1 also Alt+Q) | `<save name>.pdf`, such as `report.docx.pdf` (`lib.rs:660-662`) | `export` |
| Export Page as PNG from the command search | the save name, a Word package without the save stamp: the format follows the name (`lib.rs:659-694`) | like Save |
| File > Print > Save these pages as PDF… (0.6.1) | nothing: no download on the web (`engine/src/print.rs:159-168` writes the PDF only outside the browser) | |
| Save as Template | nothing: no download on the web (`engine/src/cmd/tools.rs:428-434` writes a file, which fails in the browser, `engine/src/io.rs:410-413`) | |
| Print (Ctrl+P, then Print) | nothing: the PDF goes into a hidden iframe and the browser's print dialog (`web.rs:417-482`) | |

Every export but Page image runs Save As with its name (`file_dialogs.rs:216-223`), so it stamps
the document (a new revision, and a creation time if it had none); Word document, Word XML
Document, OpenDocument Text and Rich Text Format also mark it saved (`lib.rs:689-692`,
`keeps_everything` `1686-1693`).

**Links and other browser couplings**

- The links of Help > About and of the contributor credits are egui hyperlinks, which eframe opens
  with `window.open` and target `_self`; the translator opens them in a new window instead.
  Document hyperlinks (Ctrl+click) and the Discord button open a new tab anyway.
- A `beforeunload` listener asks before the page is left while the document has unsaved changes,
  in 0.6.1 also while a save picker is open (`web.rs:246-262`). Removing the frame does not ask.
- A `paste` listener on the document reads pasted pictures (`web.rs:161-197`); text paste goes
  through eframe. Pasting needs no `clipboard-read`.

## How the adapter classifies

**Saves are downloads.** Where the frame has `showSaveFilePicker`, the adapter replaces it with
`undefined` before WordCraft's module runs. WordCraft 0.6.1 then downloads every save through an
`<a download>`, which the core turns into a `save` message, instead of the save picker, which the
host cannot see and which Chromium refuses in a frame of another origin (see Saving and
downloads). 0.5.0 never used the picker. [security.md](../security.md#what-the-translator-changes-in-the-apps-page)
lists the change.

The adapter tells the core the name WordCraft gives a save of the opened file (`savedName`): the
opened name for a Word package, otherwise `<stem>.docx`. Its `identity` is the creation time in
`docProps/core.xml`, read as WordCraft reads it: the core properties part that `_rels/.rels`
names (relationship types matched by their last segment, `docx/src/package.rs:133-136`), the
last `dcterms:created` among its elements, trimmed (`docx/src/read/mod.rs:244-245`,
`1311-1330`). Encrypted packages, ODT, RTF and DOC have none that the adapter reads. The core
keeps the creation time with the opened file (and takes it from each stored save of the
document), and sends a save whose creation time differs from the document's as an `export`
without asking the adapter (see [protocol.md](../protocol.md#saves)).

The adapter returns, for a download under the saved name:

- `export` if it is not a Word package (a zip whose `[Content_Types].xml` types the main part as
  one of WordCraft's four flavours, or a compound file with an encrypted package);
- `export` once a recipient list may have reached the app as a file (a `.csv`, `.tsv`, `.txt`,
  `.xlsx`, `.xlsm` or `.ods`), or once the user has opened a file of their own that saves under
  that name (see below);
- `export` if the opened document has a creation time and the save has none (an encrypted save
  has none that can be read), or if the opened document has none and the saved name is a new
  document's (`Document1` and its translations, `The Open Studio Handbook`);
- `export` if the version of the document the save follows had merge fields in its main part and
  the save has none there, or had some in its headers and footers and the save has none there, or
  the save's main part cannot be read (see Mail merge below);
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
  never the document. The adapter knows the names of the 0.5.0 and 0.6.1 catalogs.
- **Mail merge.** The document Finish & Merge makes keeps the opened document's title and
  creation time, so it can save under the opened name and pass every check above. The adapter
  watches the `files` getters of `DataTransfer` (in any `drop`) and of `<input type=file>`,
  through which WordCraft reads dropped files and its pickers' choice. Once a `.csv`, `.tsv`,
  `.txt`, `.xlsx`, `.xlsm` or `.ods` came in that way (WordCraft loads a `.txt` as recipients
  while it waits for a list, from a drop as well as from the picker; the workbooks from 0.6.1 on),
  every later save under the saved name is an `export`, also a save of the opened document, until
  the page in the frame is reloaded. A list typed into WordCraft brings in no file; the merge
  fields tell the merged document apart instead. The adapter reads the main part (the target of
  the package's `officeDocument` relationship, else `word/document.xml`, as
  `docx/src/read/mod.rs:121-124` does; at most 8 MiB unpacked) and the parts of the main part's
  header and footer relationships (at most 200), and looks in each for a field that Finish &
  Merge turns into text in both releases, where WordCraft reads one: `MERGEFIELD`,
  `ADDRESSBLOCK`, `GREETINGLINE`, `NEXT`, `MERGEREC`, `SKIPIF`, and `IF` with `MERGEFIELD` in its
  code (not `NEXTIF`, which 0.5.0 keeps, and not another `IF`, which 0.6.1 keeps: a field either
  release keeps would hide a merge); the outermost field of a nest, simple (`w:fldSimple`) or
  complex (`w:fldChar`, `w:instrText`, `w:delInstrText`), outside text boxes (`w:txbxContent`).
  It does so for each version of the document a save can follow, which is the version the core
  keeps for the opened file: the opened bytes (passed to `savedName`), then each save that comes
  out as `document` and that the host stores. A save without such a field in its main part that
  follows a version with one there is what Finish & Merge makes, and is an `export`, whatever the
  recipient list came from; so is a save without one in its headers and footers that follows a
  version with one there (only 0.6.1 merges those; 0.5.0's merged document keeps them and passes
  that check), and a save whose main part cannot be read then. A version whose main part cannot
  be read (ODT, RTF, DOC, an encrypted package, a main part over the limit) counts as one without
  merge fields.
- **Files from elsewhere.** A document the user drops from the desktop (a trusted `drop`) or
  opens with File > Open saves under its own save name, which can be the opened one: an earlier
  download of the same file has the same name and creation time. The adapter records the save
  names of such files (pictures, fonts and recipient lists aside), cleaned up as the core cleans
  every save name, and every later save under one of them is an `export`. The translator's own
  drop is synthetic (`isTrusted` false) and does not count.
- **Upper-case extensions.** WordCraft keeps the opened letter case (`Report.DOCX` saves as
  `Report.DOCX`). The Nextcloud editor page sends names with a lower-case extension, so
  `Report.DOCX` arrives as `Report.docx`, and its saves replace `Report.DOCX` in place (by its
  open, not by name).

## Known gaps

- **A merge the merge fields do not show.** With a recipient list typed in Select Recipients >
  Type a New List… or Edit Recipient List, no file comes in, and only the merge fields tell the
  document Finish & Merge makes from the open one. A merge of a document whose fields Finish &
  Merge leaves alone (none in the body, headers or footers, or only in notes or text boxes, or
  only `MERGESEQ`, a lower-case `mergefield`, an `IF` without `MERGEFIELD` in its code or a
  `NEXTIF`; with 0.5.0 also only in headers or footers), and a merge of an opened `.odt`, `.rtf`,
  `.doc` or `.dot` before its first stored save (the adapter reads only Word packages), pass as
  the document when they save under the opened name: in Nextcloud the merged document replaces
  the opened file (for a file of another program the copy next to it; for another type it
  becomes the `<stem>.docx` of that open). That happens for a `Document1.docx` WordCraft saved
  and for any document whose title equals its file's stem. Nextcloud's file versions (where
  enabled) keep the previous state. Only fresh document properties for the merged document would
  tell every merge apart (see [Upstream](#upstream)). The spec pins the guarded cases in its
  `@ui` test (a `.txt` dropped after Use an Existing List…, and a letter with a merge field after
  a typed list); the `saved-as` test drops a `.csv`. A letter with a merge field only in its
  header was checked by hand with 0.6.1 (its merged document arrived as a new file); the spec
  does not pin it.
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
- **The guards depend on how WordCraft reads and saves files.** Should a release read dropped or
  picked files another way (`DataTransfer.items`, the File System Access API), recipient lists
  and files from elsewhere go unnoticed. The `saved-as` test fails then. Should a release write
  merge fields another way, or leave some in the merged document, a merge from a typed list goes
  unnoticed; the `@ui` test fails then. Should a release save through another API than an
  `<a download>` or `showSaveFilePicker`, no save reaches the host; the contract tests fail then.
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
  and saves keep it. (0.5.0; 0.6.1 drew it at once in the tests.)
- **Memory.** WordCraft passes every opened file through base64 (`lib.rs:1572`) and builds
  saves in memory. Very large documents may fail inside the app, while the host only sees
  `delivered`.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so WordCraft
  cannot start there.

## Hosting notes

- WordCraft's `HOSTING.md` (in the web build, the same in 0.5.0 and 0.6.1) allows cross-origin
  iframes and asks for no special headers (no COOP/COEP), and not to send
  `X-Frame-Options: DENY` or a `frame-ancestors` that excludes the embedding page. For a
  sandboxed iframe it needs at least `allow-scripts allow-same-origin allow-downloads
  allow-popups`; Print and the question before leaving need `allow-modals` as well. Without the
  translator, 0.6.1 in a cross-origin iframe cannot save in Chromium (see Saving and downloads).
- The web build renders with wgpu: WebGPU where the browser has it, else WebGL2. With neither,
  it writes `WordCraft failed to start` into `#wordcraft_loading` (`web.rs:72-77`) and registers
  no drop target, and the host gets `the app registered no drop target` (after the adapter's
  10 s). The tests run on WebGL2
  (Chromium with SwiftShader, and WebKit).
- Query flags are substrings of the whole query string (`web.rs:35`, `web.rs:57`): `webgl`
  forces WebGL2, and `sample` opens the sample document at startup, also inside another word or
  value (`?x=resample`). The Nextcloud app accepts app addresses without a query only, so neither
  can come in that way; a hosting that adds a query must avoid both.
- The `.wasm` file is 36.3 MB, 15.3 MB with gzip, in 0.5.0, and 39.3 MB, 14.8 MB with gzip, in
  0.6.1 (`HOSTING.md` says about 13 MB and 5 MB). Serve it compressed, preferably precompressed
  with Brotli.
- The loader is Trunk's inline module script in `index.html`. It imports
  `wordcraft-web-<hash>.js`, awaits the `.wasm` module and then dispatches
  `TrunkApplicationStarted`. `index.html` preloads both with `integrity` attributes (0.6.1 also
  its icon); the translator's injection does not touch them. A `.wasm` file that is missing or
  cannot be compiled makes the loader fail, and the host gets `the app failed to load: ...`; a
  Content-Security-Policy that blocks the inline script leads to `the app did not start in time`
  (see [protocol.md](../protocol.md#errors)).
- `HOSTING.md` says preferences are kept in the frame's `localStorage`; the build stores nothing
  there (eframe's persistence is not enabled). 0.6.1 keeps the fonts the user adds in the frame's
  IndexedDB (database `wordcraft`, store `fonts`, `web/font_store.rs`) and loads them at every
  start (`web.rs:48-49`). It uses no service worker.
- The interface language: 0.5.0 always starts in English, whatever the browser's language (it
  builds `sys-locale` without its `js` feature). 0.6.1 builds it with that feature
  (`ui-egui/Cargo.toml`) and starts in the first of the browser's languages it has
  (`navigator.languages`, `ui-egui/src/i18n/mod.rs:259-278`), else in English; the browser's first
  language also picks a new document's paper, the units and the decimal separator
  (`i18n/mod.rs:280-297`). It reads no `?lang` and stores no choice: File > Options > Interface
  language switches it until the page is reloaded. The Nextcloud app offers no start language for
  WordCraft yet; the adapter could set one through the layer's `util.preferLanguages()`, as for
  GridCraft.
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `docx`, `docm`, `dotx`, `dotm` | the document; Save replaces a file WordCraft wrote, and saves a file of another program as a copy next to it | yes | no |
| `doc`, `dot`, `odt`, `rtf` | the document; Save creates `<stem>.docx` next to the original, which stays as it is | yes | no |

No default action: Nextcloud Office, ONLYOFFICE and Euro-Office open these types on a click where
they are installed, and a lossy editor should not take that click unasked. WordCraft stays in the
action menu, as PdfCraft does for PDF. An administrator can make WordCraft the default app
([nextcloud-app.md](../nextcloud-app.md#configuring)); then a click opens all these types in
WordCraft, and every Word file of another program opened that way is saved as a copy next to it. Nextcloud knows MIME types for all of them but `dotm`, for which the
Nextcloud app registers its Office type (`application/vnd.ms-word.template.macroEnabled.12`, see
[nextcloud-app.md](../nextcloud-app.md#file-type-icons)), so that it shows Nextcloud's document
icon like the others; the app matches by extension anyway, in any letter case.

Do not offer anything else: `txt`, `md` (Nextcloud Text opens them), `html`, `htm`, `tex` and
(0.6.1) `xml` open but save as a new `.docx`, `json` is WordCraft's document model for agents,
`csv`, `tsv` and (0.6.1) `xlsx`, `xlsm` and `ods` only load recipients, pictures are only
inserted into the open document, and font files only add fonts.

## Tests

`wordcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`wordcraft-chromium` and `wordcraft-webkit`. The behaviour the core shares with every app
(fallback downloads, a foreign host, startup errors) is tested in `translator.spec.ts` and
`pdfcraft.spec.ts`; this spec checks what depends on WordCraft.

The spec has three tests, and its header lists them with their scenarios. The first two are the
contract tests; the canary runs them apart from the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open of a `.docx` WordCraft wrote. The app sees no `showSaveFilePicker`. An edit saved with Ctrl+S arrives as the document under the opened name, with the edit and the opened creation time; Save As (F12) after another edit is the document again. A file opened from the disk (File > Open, Ctrl+O, of an RTF: `probe.docx`) and the save of a new document (Ctrl+N, `Document1.docx`) arrive as new files. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | An opened `.odt` and `.rtf` save as `probe.docx`, the document, twice. A `.docx` Word wrote: the first save is a new file under the opened name, the second replaces it (`follows` the first). `Document1.docx` with a creation time saves as the document, and a new document saved under the same name is a new file; `Document1.docx` without one is a new file. The blanks of the "+ New" entry in Files (`blank.docx` on A4 and `blank-letter.docx`, from `craftsuite_layer/assets/`, served by the test server) open, and their first saves are the document. After a dropped recipient list, the opened document's save is a new file. A copy of the opened file (same name and creation time, other text) opened with File > Open, and in Chromium dropped from the desktop, saves as a new file. |
| `ui` (`@ui`) | File > Export with the pointer on an opened `.odt`: PDF and OpenDocument Text (under the opened name) arrive as new files, Word document as the document `probe.docx`. Mailings > Finish & Merge on an opened `Document1.docx` after Select Recipients > Use an Existing List…, whose picker is cancelled, and a dropped `people.txt`, which WordCraft loads as recipients: the merged document, saved as `Document1.docx` with the opened creation time, arrives as a new file. Mailings > Finish & Merge on an opened letter `invitation.docx` (titled `invitation`, with a simple `MERGEFIELD` field) after a recipient typed into Select Recipients > Type a New List…, so that no file comes in: the letter saved before the merge keeps its field and is the document, and the merged document, saved as `invitation.docx` with the opened creation time and the typed name in place of the field, arrives as a new file. |

A test with several scenarios runs each in a page of its own and reports every scenario that
fails as `scenario failed: <title>`, not only the first.

The spec reaches File > Export with the pointer only. 0.5.0's File tab has no KeyTip, Tab does
not move the focus to the backstage's buttons, and the command search opens only with the
pointer. 0.6.1 opens the File tab with Alt, F (`ui-egui/src/keytips.rs:68-71`) and the command
search with Alt+Q (`ui-egui/src/keys.rs:107-116`), but the backstage has no KeyTips, Tab still
moves no focus there, and the command search's exports have other names (see the table above).
The Mailings tab has KeyTips (Alt, M), but the KeyTip of Select Recipients opens Type a New
List…, not Use an Existing List…. So the contract tests use the shortcuts of
`engine/src/cmd/file.rs:31-40` (Ctrl+S, F12, Ctrl+N, Ctrl+O), and only the `ui` test clicks with
the pointer; its click positions are in the `AT` table of the spec, measured on 0.5.0 at a
1400x900 viewport with the locale `en-US`, and checked again on 0.6.1 (only OpenDocument Text
moved, to the fourth button of the Export page, below the new Word XML Document) and on 0.7.0
(OpenDocument Text is the fifth button, below the new Word 2003 XML Document; the backstage's
new Close comes after Export and moves nothing the test clicks). The locale
matters from 0.6.1 on, which starts in the browser's language. WordCraft blinks its caret while
its page has the focus, so before the spec waits for a still picture it moves the focus to the
host page. Since 0.7.0 WordCraft handles a frame's keys with the page focus of the frame before
(`ui-egui/src/canvas.rs`, `show()`, from storytold/wordcraft#1107), and the shortcuts outside the
page only while it is not focused: a key that arrives in the frame in which the page gets the
focus back is lost, a letter as well as Ctrl+S. A user's click comes frames before their first
key; the spec's steps focus the canvas and then wait some frames before the first key
(`focusCanvas()` in `tests/e2e/lib/craft-ui.ts`). Without that wait, saves of the canary run of
2026-10-15 never reached the host and typed text lost its first letter. When a new release
fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing (`ui-egui/src/lib.rs:1552-1578`), the save name (`lib.rs:1268-1274`), the download
  helper (`web.rs:265-284`, `392-415`), the save stamp (`engine/src/session.rs:841-852`),
  `app.xml` (`docx/src/write/mod.rs:1079`), or how dropped and picked files are read. The rules
  fail towards new files, not towards overwriting, except a release whose new documents took over
  the opened creation time. A save that never reaches the host (as with 0.6.1 before the adapter
  hid `showSaveFilePicker`) points at the download helper. Sites that host the app should hold
  the release back until the adapter is fixed.
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
Worth reporting upstream, the first two because they lose or overwrite files:

- **Saves in a cross-origin iframe are lost in Chromium (0.6.1).** Proposed issue text:

  > **Web: Save fails silently in a cross-origin iframe in Chromium**
  >
  > Since the web build saves through `showSaveFilePicker` where it exists
  > (`apps/wordcraft-web/src/web.rs`, `download` and `trigger_save_file_picker`), Save and
  > Export do nothing in Chromium when WordCraft runs in an iframe of another origin, which
  > `HOSTING.md` says works: Chromium rejects the picker's promise with `SecurityError: Cross
  > origin sub frames aren't allowed to show a file picker.` The fallback to the `<a download>`
  > only runs when the call throws, not when its promise rejects, so the document is marked
  > unsaved and the status bar says "Couldn't download …", with no way to save. Expected: fall
  > back to the download when the picker's promise rejects with anything but `AbortError` (or
  > use the download in a cross-origin frame, `window.top !== window` with a cross-origin
  > parent), and document it in `HOSTING.md`. Seen in 0.6.1, Chromium.

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
  > first save. Seen in 0.5.0 and 0.6.1, web build, Chromium and WebKit.

- `HOSTING.md`: the `.wasm` size (39.3 MB, 14.8 MB with gzip in 0.6.1, not about 13 MB and 5 MB),
  `localStorage` (nothing is stored there; 0.6.1 keeps added fonts in IndexedDB), and the
  cross-origin saves above.
- The query flags `webgl` and `sample` match anywhere in the query string (`?x=resample` opens
  the sample).
- From the command search, Export PDF downloads `<name>.docx.pdf`, and Export Page as PNG
  downloads the document as a `.docx` under the save name.
- Save as Template and (0.6.1) File > Print > Save these pages as PDF… do nothing on the web.
- An opened `.docx` shows its text only after the next repaint (0.5.0).
