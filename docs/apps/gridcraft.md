<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# GridCraft

| | |
|---|---|
| Upstream | [github.com/storytold/gridcraft](https://github.com/storytold/gridcraft) |
| Adapter | [`translators/gridcraft.js`](../../translators/gridcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.5.0 when this page was written) |
| Tests | [`tests/e2e/specs/gridcraft.spec.ts`](../../tests/e2e/specs/gridcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the GridCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.5.0
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source
references are to the `v0.5.0` tag; `web.rs` is `apps/gridcraft-web/src/web.rs`, the other paths
are under `crates/`.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#gridcraft_canvas`, `web.rs:7`), where eframe
  registers its only drop listener once the app exists (`web.rs:27-54`). The drop handler does
  not check `isTrusted`, so the translator's simulated drop works like a user's drop. The core's
  default drop target and timing fit: the listener came 0.1 to 0.2 s after
  `TrunkApplicationStarted` in Chromium.
- Every dropped file goes to `file.open` with its name and bytes (`web.rs:74-90`,
  `ui-egui/src/lib.rs:571-584`) and opens as a new workbook window; nothing is ever placed into
  the open workbook. An untouched blank `Book1` is replaced, as in Excel
  (`engine/src/cmd/file.rs:59-64`), and there is always a workbook (`ui-egui/src/lib.rs:586-588`).
- The content decides the format before the name (`engine/src/io.rs:40-91`): XLSX (also `.xlsm`,
  `.xltx`, `.xltm`); ODS and XLSB as data imports; JSON and TSV (`.tsv`, `.tab`, `.txt`) by name;
  CSV for anything else, even a PNG. Legacy `.xls` and encrypted workbooks show an error message.
- **The window title is the file name** (`engine/src/cmd/file.rs:50-56`); an ODS or XLSB, by
  extension in any letter case or by content, is titled `<stem> (imported).xlsx` instead.
- Import warnings show in a message box (`file.rs:66-72`, `ui-egui/src/widgets.rs:176-200`): for
  example `macros (VBA project) are not supported and were dropped` for an `.xlsm`. The box takes
  the keys until it is closed with OK, Enter or Escape.
- Files also reach the app from the user: a drop from the desktop, and File > Open… (Ctrl+O), a
  file picker (`<input type=file>` through rfd, accepting
  `.xlsx,.xlsm,.xlsb,.ods,.csv,.tsv,.txt,.json`, `web.rs:107-122`). Each file opens as a further
  window titled with its own name. Insert > Picture has a picker of its own (PNG and JPEG,
  `web.rs:123-133`), whose file goes into the workbook.
- There is no `?file=` and no embedding API. The only query flags are `webgl` and `sample` (see
  [Hosting notes](#hosting-notes)).
- There is no JavaScript-visible signal that a file was opened, could not be opened, or has
  unsaved changes. The host only gets `delivered`. (GridCraft sets the window title with an egui
  command that eframe's web backend does not implement and reports on the console, `Unhandled
  egui viewport command: Title("…")`; the tests use that, a host should not.)

**Saving and downloads**

- Every download goes through one helper (`web.rs:182-205`): a `Blob` typed `text/csv` for a
  `.csv` name and as XLSX otherwise, `URL.createObjectURL`, an `<a download>` with
  `display: none` appended to `<body>`, `click()`, then the element is removed at once and the URL
  revoked after 10 s. There is no File System Access API.
- Save (Ctrl+S) and Save As… (Ctrl+Shift+S) (`ui-egui/src/ribbon.rs:1848-1849`) are also the Save
  icon in the title bar (`ribbon.rs:47-49`), File > Save and Save As… (`ribbon.rs:210-233`) and
  More (…) > Save As… (`ribbon.rs:73-79`). A dropped or picked file has no path, so `file.save`
  asks the UI for a save dialog (`engine/src/cmd/file.rs:80-86`); the web has no save picker, so
  it encodes the workbook as XLSX and downloads it at once (`ui-egui/src/lib.rs:395-408`), named
  `<stem of the title>.xlsx` (`file.rs:107-113`). Neither asks for a name.
- So an opened `x.xlsx` saves as `x.xlsx`, `x.xlsm` and `x.csv` save as `x.xlsx`, and `x.ods` as
  `x (imported).xlsx`. The path stays unset and the saved state is only updated for a save to a
  path (`file.rs:91-95`): every Save downloads again under the same name, the title bar keeps the
  unsaved marker `•` (`ribbon.rs:90-95`), and Close asks again whether to save.
- **Save rewrites the whole package** from GridCraft's model (`xlsx/src/write.rs:138-358`), never
  an update of the opened bytes. The writer is deterministic: the zip times are fixed at
  1980-01-01 (`xlsx/src/package.rs:164-174`), `docProps/app.xml` holds
  `<Application>GridCraft</Application>` (and a company, if set), and `docProps/core.xml` only
  title, subject, author, keywords and description, no creation or change time
  (`write.rs:303-327`). An unchanged save of a file GridCraft wrote equals the opened bytes; the
  tests check this with GridCraft's sales sample (charts, a table, notes).
- **What GridCraft does not model is lost** on the first save of another program's file. Some
  losses come with an import warning: a VBA project, links to external workbooks
  (`xlsx/src/read.rs:308-313`), embedded objects and form controls (`sheet_read.rs:186`), sheet
  protection passwords (`sheet_read.rs:146-150`), what-if data tables (their values are kept,
  `sheet_read.rs:428`), unsupported conditional formats and Excel 2010 extensions
  (`sheet_read.rs:580`, `:849`), date filters (`sheet_read.rs:706`). Others are silent: custom
  document properties, customXml items, the creation and change times (checked with
  `from-excel.xlsx`). ODS is a data import: formulas become their values
  (`xlsx/src/ods.rs:46-48`).
- There is no document identity: no creation time, no id, nothing that survives saves. New
  workbooks are titled `Book<N>`, the lowest number no other unsaved `Book<N>` window uses
  (`engine/src/lib.rs:245-254`); opened files are titled with their extension, so with
  `Book1.xlsx` open Ctrl+N still makes `Book1`, which saves as `Book1.xlsx`. The Start dialog
  (Home icon) makes the samples `Household Budget`, `Quarterly Sales Dashboard` and `Gradebook`
  (`engine/src/sample.rs:11-15`). None of these names is translated. (`sample.rs` falls back to
  the title `Sample`, but `file.new` fails for an unknown sample before it gets there,
  `engine/src/cmd/file.rs:23-29`.)
- View > New Window makes a copy of the active workbook titled `<title>:2`
  (`engine/src/cmd/extra.rs:609-614`). The save name cuts the title at its last dot, so the copy
  of `x.xlsx` saves under the same name as the original window, and the copy of `Book1` (no dot)
  as `Book1:2.xlsx`.
- AutoSave (the toggle in the title bar, off by default) never fires on the web: it needs a path
  ending in `.xlsx` and a clock, and the web build's clock always reads 0
  (`ui-egui/src/lib.rs:642-651`, `:734-744`).
- On Windows and Linux the shortcuts are Ctrl+S and Ctrl+Shift+S (`Cmd` is Ctrl there). In a real
  browser Ctrl+N and Ctrl+W belong to the browser; the File menu has New Workbook and Close.

| Download | Name | Kind |
|---|---|---|
| Save, Save As… of the opened workbook, a file GridCraft wrote | `<stem>.xlsx`, the opened name (for `X.XLSX`: `X.xlsx`) | `document` |
| Save, Save As… of the opened workbook, an `.xlsx` another program wrote | `<stem>.xlsx`, the opened name (for `X.XLSX`: `X.xlsx`) | `copy`: the first a new file, later ones replace it |
| Save, Save As… of an opened `.xlsm` or `.csv` | `<stem>.xlsx` | `document`, stored next to the original |
| Save, Save As… of an opened `.ods` | `<stem> (imported).xlsx` | `document`, stored next to the original |
| Save of another workbook: a new one (`Book<N>`), a sample, a New Window copy of one of them (`Book<N>:2`), a file the user opened or dropped | `<its stem>.xlsx` | `export`; with the opened file's name see [How the adapter classifies](#how-the-adapter-classifies) |
| Save of the window View > New Window opened on the opened workbook | the opened workbook's save name | as the opened workbook ([known gaps](#known-gaps)) |
| Export as PDF (only in Search Commands, `file.exportPdf`) | the title with `.pdf` (`ui-egui/src/lib.rs:266-275`): `x.pdf`, `x (imported).pdf` | `export` |
| Share > Save a Copy as Excel Workbook…, Export as CSV…, Export as Web Page… | nothing: the dialog asks for a path, and the command then fails with `<path>: no file system in the browser` (`engine/src/io.rs:284-287`) | |
| More (…) > Print… | nothing: the PDF is built and discarded | |

**Links**

- GridCraft opens links with `window.open(url, '_blank')` (`web.rs:139-143`): links in dialogs
  (About > Contributors, rerouted from egui in `ui-egui/src/dialogs.rs:852-868`) and cell
  hyperlinks whose target contains `://` or starts with `mailto:` (`ui-egui/src/grid.rs:1297-1304`,
  `:1610-1620`). A cell link such as `javascript://…` passes GridCraft's own check; the
  translator's `window.open` opens only `http:`, `https:`, `mailto:` and `blob:` URLs and adds
  `noopener` for other origins (see [protocol.md](../protocol.md#links)).

## How the adapter classifies

The adapter tells the core the name GridCraft gives a save of the opened file (`savedName`):
`<stem>.xlsx`, or `<stem> (imported).xlsx` for a name ending in `.ods` or `.xlsb` (any letter
case) or an ODS package (a zip whose `mimetype` entry is exactly
`application/vnd.oasis.opendocument.spreadsheet`, as GridCraft checks it). For `report.xlsx`
that is the opened name; for `report.xlsm` or `report.csv` it is `report.xlsx`. The core calls the
adapter for a download whose sanitised name equals a file opened in the frame, or the saved name
of one.

The adapter returns `export` unless all of these hold: the download has the saved name and ends
in `.xlsx`; its stem is not a new workbook's or a sample's title (`Book<N>`, `Household Budget`,
`Quarterly Sales Dashboard`, `Gradebook`, also with the `:2` of a New Window copy); it is not the
save name of a file the user brought in; and its `docProps/app.xml` says GridCraft. Then:

- **A file saved under its own name** (an opened `.xlsx`; also `X.XLSX`, saved as `X.xlsx`,
  because a host that compares names without letter case, or a file system that ignores it, takes
  that for the opened file) is `document` only if GridCraft wrote it: its `docProps/app.xml` says
  GridCraft, and every part of the package is one GridCraft's writer produces (the list in the
  adapter is taken from `xlsx/src/write.rs`, `sheet_write.rs`, `pivot.rs` and `richdata.rs`). Any
  other part (`customXml/`, `docProps/custom.xml`,
  `xl/vbaProject.bin`, `xl/externalLinks/`, `xl/embeddings/`, `xl/activeX/`, `xl/ctrlProps/`,
  `xl/calcChain.xml`, `xl/printerSettings/`, ...) means another program wrote or changed the file
  since. Such a save loses what GridCraft does not model, so it is `copy`: the first save of the
  open becomes a new file next to the original, and later saves replace that file (see
  [protocol.md](../protocol.md#copies)). The original is never replaced. Once the user opens the
  copy, which GridCraft wrote, saves go back into it.
- **A file saved under another name** (`.xlsm`, `.ods`, `.csv`) is `document`. The first save
  arrives with the open's `openId`; the Nextcloud editor page stores it as a new file next to the
  original, and later saves replace that file (see [protocol.md](../protocol.md#saves) and
  `craftsuite_layer/src/editor.ts`). The original stays as it is, also when it is an `.xlsm` whose
  macros GridCraft dropped. (The editor page sends names with a lower-case extension, so in
  Nextcloud `X.XLSX` arrives as `X.xlsx` anyway.)

The adapter reads only the zip's central directory, `docProps/app.xml` and `mimetype` (each at
most 1 MB, unpacked with `DecompressionStream('deflate-raw')`), once per file.

- Save rewrites the whole file, so the prefix check of PdfCraft does not apply, and GridCraft
  stores no identity: the name, the writer and the parts decide.
- A new workbook is `Book1` in every session and saves as `Book1.xlsx`, the name of an opened
  `Book1.xlsx`; the samples save under their titles, and their New Window copies as
  `Book1:2.xlsx` and the like. Nothing in the bytes tells them from the opened file, so a file
  with such a name is never saved back: every save of it is a new file.
- **Files the user brings in.** GridCraft saves a file the user drops from the desktop or opens
  with File > Open… as `<stem>.xlsx` too, so one with the opened file's stem would come back under
  the document's name with other content, possibly an Excel file re-encoded with losses. The
  adapter notes the names of such files where GridCraft reads them: the `files` getter of a
  `DataTransfer` during a trusted `drop` (the core's own drop is synthetic) and of an
  `<input type=file>` (the core uses none), except a picker that accepts only images (Insert >
  Picture). A save under `<stem>.xlsx` or `<stem> (imported).xlsx` of such a file is an `export`.
- The `docProps/app.xml` check of the save is a guard: in 0.5.0 nothing but Save writes
  `<stem>.xlsx`.

## Interface language

- **How GridCraft picks it.** Once, as the app is created (`web.rs:43`), from
  `navigator.language` (`ui-egui/src/i18n.rs:79-88`): only the browser's first language, not
  `navigator.languages`, and only its primary subtag (`i18n.rs:64-75`). So `ru-RU` gives Russian,
  `pt-PT` and `pt-BR` both give Brazilian Portuguese, and a language GridCraft lacks (German,
  French, ...) gives English, the default (`ui-egui/src/lib.rs:52-57`). The web build then drops
  Chinese, Japanese and Korean, for which it has no font: they start in English too
  (`web.rs:41-49`). There is no URL switch and nothing is stored: the web build uses no storage
  and eframe's persistence is not enabled; only the desktop app keeps the choice, in `ui.json`
  (`main.rs:81-95` of `apps/gridcraft`).
- **What the adapter does.** Its `language` member gets the host's language
  ([protocol.md](../protocol.md#host-settings)) before the app's module runs, finds it in its
  `LANGUAGES` table (`pt-PT` finds `pt-BR`, `en-GB` finds `en`) and makes the frame report
  GridCraft's code as the browser's language (`pt` for `pt-BR`): `navigator.language` returns it
  and `navigator.languages` starts with it (getters on `Navigator.prototype`). `ready` reports
  the tag it found. For any other language, and without one, it changes nothing and reports
  `null`, so GridCraft follows the browser's language: an override to a language GridCraft lacks
  would force English, also on a user whose browser is in Russian.
- **The languages offered** are `en`, `es`, `pt-BR` and `ru`, the keys of `LANGUAGES` (GridCraft's
  list in the Nextcloud app's settings too). Chinese, Japanese and Korean are left out: the web
  build drops them itself, so an override would give English.
- **Partial translations.** Russian and Brazilian Portuguese translate the ribbon and the status
  bar, from a table of 266 labels each (`ui-egui/src/i18n/ru.rs`, `pt.rs`). A label without an
  entry stays English (`i18n.rs:98-108`), and so does what is drawn without the table: the File
  tab (`ui-egui/src/ribbon.rs:212`), AutoSave (`ribbon.rs:33`) and the dialogs. Names the engine
  gives (`Book1`, `Sheet1`) are never translated. The Russian labels are longer: in a frame
  1400 px wide, the last groups of the Home tab (Sort & Filter, Find & Select) no longer fit.
  Spanish translates no label at all (`i18n.rs:100`); it switches formula entry to Spanish: ten
  function names (`SUMA`, `PROMEDIO`, `SI`, ...), `;` between arguments and `,` as the decimal
  separator (`formula/src/input.rs:14-36`, `i18n.rs:90-92`). Saved files keep the English syntax.
- **A language the user picks in the app** (View > Interface language,
  `ui-egui/src/ribbon.rs:1694-1708`, the command `app.language.set`, `ui-egui/src/lib.rs:323-333`)
  applies at once and lasts until the frame reloads. Nothing is stored, so every start is in the
  host's language again, or without one in the browser's. The list also offers Chinese, Japanese
  and Korean, which the web build cannot draw: their names already show as boxes.

## Known gaps

- **Files named like a new workbook are never saved back.** An opened `Book1.xlsx` (also
  `Book7.xlsx`, `Gradebook.xlsx` and the other sample titles) saves as a new file every time:
  `Book1 (2).xlsx`, then `Book1 (3).xlsx`, and so on, because a new workbook's save has the same
  name and nothing in the file tells the two apart. So does an import such as `Book2.csv`, whose
  saves are `Book2.xlsx`. Renaming the file in Nextcloud before opening it avoids it.
- **View > New Window.** The second window is a copy of the opened workbook and saves under its
  name, so its save passes as the document (or as the next copy of a file of another program).
  When both windows are edited and saved in turn, the file holds the edits of the window saved
  last. GridCraft's desktop app writes both windows to the same file too, and nothing in the
  bytes tells the windows apart.
- **A program that keeps `docProps/app.xml`.** A GridCraft file that another program changed
  without touching `docProps/app.xml` or adding a part (for example by adding content inside a
  sheet that GridCraft drops) passes as written by GridCraft, and its save replaces it with
  losses. So does a file a newer GridCraft wrote with something 0.5.0 does not read inside the
  parts it knows: `docProps/app.xml` carries no version. Nextcloud's file versions (where
  enabled) keep the previous state.
- **The guard depends on how GridCraft reads files.** Should a release read dropped or picked
  files another way (`DataTransfer.items`, the File System Access API), files from elsewhere go
  unnoticed again. The `saved-as` test fails then.
- **After a file from elsewhere with the same save name**, every later save under that name is an
  export, also a save of the opened workbook, until the frame is reloaded.
- **XLSB by content.** An XLSB package under another name than `.xlsb` is an import for GridCraft
  (`<stem> (imported).xlsx`) but not for the adapter; its saves miss the saved name and are
  exports.
- **One copy per open.** Each time the user opens an `.xlsx` of another program again, its first
  save makes another copy (`x (2).xlsx`, `x (3).xlsx`, ...).
- **No unsaved-changes signal.** GridCraft shows unsaved changes only as `•` in the title bar,
  never clears it after a save on the web, asks nothing before the page unloads and keeps no
  recovery copy (eframe's persistence is not enabled; `localStorage` stays empty). The host must
  warn on close.
- **`delivered` is not "opened".** Any dropped file opens (a PNG as text in a sheet); a file
  GridCraft cannot read (legacy `.xls`, an encrypted workbook) shows an error in its message box
  only.
- **Saved means downloaded.** If the host cannot store the file, the translator's fallback browser
  download is the copy the user keeps.
- **Memory.** GridCraft passes the opened file and every save through base64 strings
  (`ui-egui/src/lib.rs:579`, `:404`, `engine/src/cmd/file.rs:112`), several times the file
  size in wasm memory. Very large workbooks may fail inside the app, while the host only sees
  `delivered`.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so GridCraft
  cannot start there.

## Hosting notes

- GridCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no special
  headers (no COOP/COEP). It asks not to send `X-Frame-Options: DENY` or a `frame-ancestors` that
  excludes the embedding page. For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`.
- The web build renders with wgpu: WebGPU where the browser has it, else WebGL2. With neither, it
  writes `GridCraft failed to start: …` and `A browser with WebGPU or WebGL2 is required.` into
  `#gridcraft_loading` (`web.rs:55-60`) and registers no drop target, and the host gets `the app
  registered no drop target`. The tests run on WebGL2 (Chromium with SwiftShader, and WebKit).
- Query flags are substrings of the whole query string (`location.search`, `web.rs:22`,
  `:34-39`): `webgl` forces WebGL2; `sample=budget`, `sample=sales` or `sample=grades` opens that
  sample at startup (another name opens none), and `sample` anywhere else in the query the sales
  sample. The query of the configured app URL must contain neither (the Nextcloud app accepts no
  query at all).
- The `.wasm` file of 0.5.0 is 16.6 MB, 6.2 MB with gzip. Serve it compressed, preferably
  precompressed with Brotli.
- The loader is Trunk's inline module script in `index.html`. It imports
  `gridcraft-web-<hash>.js`, awaits the `.wasm` module and then dispatches
  `TrunkApplicationStarted`. A `.wasm` file that is missing or cannot be compiled makes the loader
  fail, and the host gets `the app failed to load: ...`; a Content-Security-Policy that blocks the
  inline script leads to `the app did not start in time` (see
  [protocol.md](../protocol.md#errors)).
- Copying writes HTML and text with `navigator.clipboard.write`, falling back to `writeText`
  (`web.rs:149-180`): the frame needs `clipboard-write`, which the Nextcloud editor page
  delegates.
- `HOSTING.md` says preferences are kept in the frame's `localStorage`; the 0.5.0 build stores
  nothing there.
- The interface follows the host's language where GridCraft has it, else the browser's first
  language (`navigator.language`, by its primary subtag); Chinese, Japanese and Korean, for which
  the build has no fonts, start in English (`web.rs:41-49`). See
  [Interface language](#interface-language).
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `xlsx` | the workbook; Save replaces the file if GridCraft wrote it, otherwise the first save creates a copy next to it, which later saves replace | yes | no |
| `xlsm` | the workbook without its macros (GridCraft warns); Save creates `<stem>.xlsx` next to it, which later saves replace | yes | no |
| `ods` | a data import (formulas become values); Save creates `<stem> (imported).xlsx` next to it | yes | no |
| `csv` | a sheet named after the file; Save creates `<stem>.xlsx` next to it (the web build cannot write CSV) | yes | no |

Match the extension in any letter case. Nextcloud 34 and 35 know MIME types for all four, but
the app matches by extension anyway. No default: Nextcloud Office, ONLYOFFICE and Euro-Office open
these types on a click where they are installed, and without them Nextcloud Text opens `.csv`. An
administrator can make GridCraft the default app ([nextcloud-app.md](../nextcloud-app.md#configuring));
then a click opens all four in GridCraft, with the saves as in the table.

Not offered: `xlsb` (a data import like ODS; it could be added the same way), the templates
`xltx` and `xltm`, `tsv`, `txt` and `json` (too generic), and `xls` (GridCraft cannot open it).

## Tests

`gridcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`gridcraft-chromium` and `gridcraft-webkit`. The behaviour the core shares with every app
(fallback downloads, a foreign host, startup errors) is tested in `translator.spec.ts` and
`pdfcraft.spec.ts`; this spec checks what depends on GridCraft.

The spec has four tests, and its header lists them with their scenarios. The first two are the
contract tests; the canary runs them apart from the `language` test (tagged `@language`) and the
`@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open of an `.xlsx` GridCraft wrote. An edit saved with Ctrl+S arrives as the document under the opened name, with the edit; Save As (Ctrl+Shift+S) after another edit is the document again. The save of a new workbook (Ctrl+N, `Book1.xlsx`) arrives as a new file. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | `from-excel.xlsx`, and a GridCraft file with a customXml part added under an upper-case name (`CHANGED-ELSEWHERE.XLSX`, saved as `CHANGED-ELSEWHERE.xlsx`), are never replaced: the first save is a `document` that follows its own id, the next a `document` that follows the first (a copy). `macros.xlsm`, `data.ods` and `data.csv` save as `macros.xlsx`, `data (imported).xlsx` and `data.xlsx`, the document, twice. GridCraft's sales sample saves back unchanged as the document. An opened `Book1.xlsx` is never saved back, and neither is a new workbook's save under that name. The blanks of the "+ New" entry in Files (`blank.xlsx` on A4 and `blank-letter.xlsx`, from `craftsuite_layer/assets/`, served by the test server) open, and their first saves are the document. A different `craftsuite-probe.xlsx` the user opens with File > Open (in Chromium also one dropped from the desktop) is never the document. |
| `language` | The host's language under the browser locale `en-US`: with `lang=ru`, `ready` reports `ru` and the app frame's `navigator.language` is `ru`. GridCraft draws its labels into the canvas, so the rest is a picture: the ribbon's tab row is, byte for byte, the one a start without `lang` under the browser locale `ru-RU` shows (in a browser context of its own), and not the one of an English start. |
| `ui` (`@ui`) | With the pointer: File > Save saves the document; Search Commands (the magnifier in the title bar), `file.exportPdf`, downloads `craftsuite-probe.pdf`, a new file. |

A test with several scenarios (`saved-as`) runs each in a page of its own and reports every
scenario that fails as `scenario failed: <title>`, not only the first.

The steps use GridCraft's keyboard shortcuts (`ui-egui/src/ribbon.rs`, `shortcut()`) and edit
cells with F2, the text and Enter. They wait for what the app shows: the window title reported on
the console when a file opens and when a workbook first changes (see [Opening](#what-the-web-build-does)),
and a settled picture after Escape closed the import message box, which would otherwise take the
next keys. Export as PDF is only in Search Commands, which only the pointer opens, so it is in the
`ui` test; its click positions are in the `AT` table of the spec, with the tab row the `language`
test compares, measured on 0.5.0 at a 1400x900 viewport with the locale `en-US`. When a new
release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  handling (`web.rs:74-90`, `ui-egui/src/lib.rs:571-584`), the title and save name rules
  (`engine/src/cmd/file.rs`), the download helper (`web.rs:182-205`), the writer's parts or
  `docProps/app.xml` (`xlsx/src/write.rs`), or how the user's own files are read. The rules fail
  towards new files, not towards overwriting: a save under a name the adapter does not expect, or
  of a file with a part the adapter does not know, arrives as an `export` or a copy. Sites that
  host the app should hold the release back until the adapter is fixed.
- **The `language` test fails.** The report has the tab rows that did not compare as expected.
  If the `ru-RU` start is Russian and the `lang=ru` start is not, the override no longer reaches
  the app; if both are English, the release no longer takes its language from
  `navigator.language` (`web.rs:41-50`, `ui-egui/src/i18n.rs:79-88`). Either way the adapter
  needs another way in. If the pictures show something other than the tabs, the tab row moved:
  re-measure `AT.tabRow`.
- **Only the `@ui` test fails.** A menu item or the magnifier moved. Re-measure the positions in
  `AT`; the translator is not at fault.
- **A shortcut changed upstream.** The tests that press it fail: Ctrl+S, Ctrl+Shift+S, Ctrl+N,
  Ctrl+O, Ctrl+Home and F2 are used by the contract tests. Check them against `ribbon.rs` and
  `grid.rs` before holding a release back.

The fixtures in `tests/e2e/fixtures/gridcraft/`: `craftsuite-probe.xlsx` was saved by GridCraft
0.5.0 (a new workbook, the marker `CRAFTSUITE-PROBE-gc01` in A1 and 42 in B1, Ctrl+S), and
`sales-sample.xlsx` is the Start dialog's `Quarterly Sales Dashboard` sample saved with Ctrl+S
(GridCraft's own sample content, `engine/src/sample.rs`, under GridCraft's license, MIT or
Apache-2.0).
`make-fixtures.mjs` writes the files of other programs: `from-excel.xlsx` and `macros.xlsm` as
Excel writes them (with custom properties and a customXml item, and a VBA project), `data.ods`
and `data.csv`. The tests derive the other files they open from these (`Book1.xlsx`, the changed
GridCraft file, the file from the user's disk).

## Upstream

GridCraft has no embedding API. With one, as requested for PdfCraft in
[storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422), the open and save
paths would no longer depend on drops and downloads; see
[architecture.md](../architecture.md#native-embedding-apis). Worth reporting upstream as well: no
document identity in saved files (a new workbook cannot be told from the opened one); no clock in
the web build (AutoSave never fires, and messages that should disappear stay); the unsaved marker
not cleared after a save on the web; Share > Save a Copy, Export as CSV and Export as Web Page
doing nothing on the web, and Print discarding its PDF; Export as PDF only in Search Commands;
the `localStorage` claim in `HOSTING.md`.
