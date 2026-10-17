<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# GridCraft

| | |
|---|---|
| Upstream | [github.com/storytold/gridcraft](https://github.com/storytold/gridcraft) |
| Adapter | [`translators/gridcraft.js`](../../translators/gridcraft.js) |
| Tested version | `tested` in [`apps.json`](../../apps.json) (0.5.0 when this page was written, checked again with 0.6.1 and 0.7.0) |
| Tests | [`tests/e2e/specs/gridcraft.spec.ts`](../../tests/e2e/specs/gridcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the GridCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.6.1
source and web build (first written for 0.5.0; where 0.5.0 differs, the page says so); what
0.7.0 changed in the web shell, the save path and the writer was checked against the `v0.7.0`
tag, and the page says so where it matters. Upstream may change any of them; the daily canary
run (see [development.md](../development.md#continuous-integration)) is there to notice. Source
references are to the `v0.6.1` tag; `web.rs` is `apps/gridcraft-web/src/web.rs`, the other paths
are under `crates/`.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#gridcraft_canvas`, `web.rs:8`), where eframe
  registers its only drop listener once the app exists (`web.rs:28-56`). The drop handler does
  not check `isTrusted`, so the translator's simulated drop works like a user's drop. The core's
  default drop target fits. The listener came 0.1 to 0.2 s after `TrunkApplicationStarted` in
  Chromium with 0.6.1, but more than 3 s with 0.7.0 on the first start in a fresh browser
  (Chromium with SwiftShader): the adapter gives it 10 s (`dropTargetTimeout`) before the core
  reports a startup error.
- Every dropped file goes to `file.open` with its name and bytes (`web.rs:76-92`,
  `ui-egui/src/lib.rs:948-970`) and opens as a new workbook window; nothing is ever placed into
  the open workbook. An untouched blank `Book1` is replaced, as in Excel
  (`engine/src/cmd/file.rs:72-77`), and there is always a workbook
  (`ui-egui/src/lib.rs:971-973`). A file that arrives while the File view is open closes it.
- The content decides the format before the name (`engine/src/io.rs:87-140`,
  `xlsx/src/lib.rs:174-209`): XLSX (also `.xlsm`, `.xltx`, `.xltm`); ODS, XLSB and, since 0.6.1,
  legacy XLS (also `.xlt`) as data imports; JSON and TSV (`.tsv`, `.tab`, `.txt`) by name; CSV for
  anything else, even a PNG. 0.5.0 showed an error for `.xls`.
- **Password-protected workbooks** (Agile and Standard encryption) open since 0.6.1: GridCraft
  asks for the password in a dialog and opens the decrypted workbook, titled with its name
  (`engine/src/io.rs:55-77`, `ui-egui/src/lib.rs:962-965`). It saves it without the password and,
  on the desktop, never into the encrypted file (`file.rs:68-71`). 0.5.0 showed an error.
- **The window title is the file name** (`engine/src/cmd/file.rs:60-67`); an ODS, XLSB or XLS,
  by extension in any letter case or by content, is titled `<stem> (imported).xlsx` instead.
- Import warnings show in a message box (`file.rs:79-87`, `ui-egui/src/widgets.rs:273-299`): for
  example `macros (VBA project) were kept but not executed` for an `.xlsm`
  (`xlsx/src/read.rs:323`; 0.5.0 said they were dropped). The box takes the keys until it is
  closed with OK, Enter or Escape. Since 0.6.1 an info bar repeats the most important warning;
  for macros it says that GridCraft keeps them when you save, which on the web is not so: the web
  saves an `.xlsx`, without them (see Saving and downloads).
- Files also reach the app from the user: a drop from the desktop, and File > Open (Ctrl+O, the
  File view's Open page, Browse), a file picker (`<input type=file>` through rfd, accepting
  `.xlsx,.xlsm,.xls,.xlsb,.ods,.csv,.tsv,.txt,.json`, `web.rs:109-124`). Each file opens as a
  further window titled with its own name. Insert > Picture has a picker of its own (PNG and
  JPEG, `web.rs:125-136`), whose file goes into the workbook.
- There is no `?file=`. The query flags are `webgl` and `sample` (see
  [Hosting notes](#hosting-notes)) and, since 0.7.0, `host=parent` (with `author=`): an opt-in
  embedding bridge for a page that frames GridCraft **on its own origin**
  (`apps/gridcraft-web/src/host.rs`, storytold/gridcraft#237). It takes `gridcraft:open` from
  the parent, sends every download to it as `gridcraft:save` instead, and reports
  `gridcraft:ready`, `gridcraft:failed` and `gridcraft:dirty`; no sample opens meanwhile. Only the
  same-origin parent is heard or answered, and without the flag nothing changes. The translator
  does not set it: it serves GridCraft to a host on another origin, so the bridge stays off (see
  [Upstream](#upstream)).
- There is no JavaScript-visible signal that a file was opened, could not be opened, or has
  unsaved changes. The host only gets `delivered`. (GridCraft sets the window title with an egui
  command that eframe's web backend does not implement and reports on the console, `Unhandled
  egui viewport command: Title("…")`, `ui-egui/src/lib.rs:1047-1054`; the tests use that, a host
  should not.)

**Saving and downloads**

- Every download goes through one helper (`web.rs:250-334`). Since 0.6.1 it first tries the
  browser's save picker (`window.showSaveFilePicker`, Chromium-based browsers); where there is
  none, or the browser refuses it (any refusal but the user's cancel), it falls back to the
  download of 0.5.0 (`web.rs:358-379`): a `Blob` typed by the extension (`web.rs:231-247`),
  `URL.createObjectURL`, an `<a download>` with `display: none` appended to `<body>`, `click()`,
  then the element is removed at once and the URL revoked after 10 s. Chromium refuses the picker
  in a cross-origin frame (`SecurityError`), so in the Nextcloud editor page GridCraft would
  download anyway; the adapter removes `window.showSaveFilePicker` from the frame, so that
  GridCraft downloads at once and a save never goes to the user's disk instead of the host.
- Save (Ctrl+S) and Save As… (Ctrl+Shift+S) (`ui-egui/src/ribbon.rs:2403-2404`) are also the
  Save icon in the title bar (`ribbon.rs:71-76`) and More (…) > Save As… (`ribbon.rs:97-114`). A
  dropped or picked file has no path, so `file.save` asks the UI for a save dialog
  (`engine/src/cmd/file.rs:94-101`); the web has no save dialog, so it encodes the workbook as
  XLSX and downloads it at once (`ui-egui/src/lib.rs:615-630`), named `<stem of the title>.xlsx`
  (`file.rs:127-133`). Neither asks for a name.
- **The File view.** Since 0.6.1 the File tab opens a full-window view (Backstage,
  `ribbon.rs:256-262`, `ui-egui/src/backstage.rs`) in place of the 0.5.0 menu. Its Save goes to
  its Save As page for a workbook without a file, which on the web is every workbook
  (`backstage.rs:221-233`); that page's Download (.xlsx) is the same download as Ctrl+S, and with
  Save as type CSV, Web Page or PDF it exports instead (`backstage.rs:517-551`). Its Export page
  has Create PDF, CSV and Web Page (`backstage.rs:713-791`).
- So an opened `x.xlsx` saves as `x.xlsx`, `x.xlsm` and `x.csv` save as `x.xlsx`, and `x.ods`
  (and `x.xls`) as `x (imported).xlsx`. The `.xlsx` of an `.xlsm` has no VBA project: only a
  macro-enabled name carries it (`engine/src/io.rs:155-161`), and the web never saves under one.
  The path stays unset and the saved state is only updated for a save to a path
  (`file.rs:107-115`): every Save downloads again under the same name, the title bar keeps the
  unsaved marker `•` (`ribbon.rs:115-123`), and Close asks again whether to save.
- **Save rewrites the whole package** from GridCraft's model (`xlsx/src/write.rs:164-420`), never
  an update of the opened bytes. The writer is deterministic: the zip times are fixed at
  1980-01-01 (`xlsx/src/package.rs:164-175`), `docProps/app.xml` holds
  `<Application>GridCraft</Application>` (and a company, if set), and `docProps/core.xml` only
  title, subject, author, keywords and description, no creation or change time
  (`write.rs:360-386`). An unchanged save of a file the same release wrote equals the opened
  bytes; the tests check this with GridCraft's sales sample (charts, a table, notes), saved and
  then opened and saved again. Another release may write the same workbook a little differently:
  0.5.0 wrote the sample's icon set without its thresholds, which 0.6.1 writes, and 0.7.0 adds
  `<scheme val="minor"/>` to the default font in `xl/styles.xml` of 0.6.1's file (it keeps the
  workbook's default font). The parts stay the same.
- **Parts GridCraft does not model.** 0.5.0 dropped every part its writer does not produce.
  Since 0.6.1 GridCraft keeps such parts unread and writes them back under their names
  (`xlsx/src/passthrough.rs`): custom document properties (`docProps/custom.xml`), customXml
  items, ribbon customisation, add-in task panes, links to external workbooks, data connections
  and query tables, form and ActiveX controls, embedded objects, sheet backgrounds and printer
  settings. Not kept: anything whose relationships reach a part GridCraft rewrites (sheets,
  drawings, charts, tables, comments, ...), parts no relationship reaches, Strict Open XML
  files, and more than 64 MB per part or 256 MB per workbook (`passthrough.rs:1-22`, `:41-46`).
  Since 0.7.0 it also keeps XML maps (`xl/xmlMaps.xml`), the workbook's `<fileVersion>` and
  calcFeatures extension, and chart sheets with their drawing and chart, unless a series refers
  to a sheet that is gone (`passthrough.rs` at `v0.7.0`, `:1-24`, `:142-161`, `:393-410`). Kept
  parts keep their names only in the folders GridCraft never writes itself (`customXml/`,
  `xl/externalLinks/`, `xl/xmlMaps.xml`, `xl/embeddings/`, ...); a kept chart sheet and its
  drawing and chart get new names (`kept<N>.xml` in their folders, `passthrough.rs:844-866`).
- **What is still lost** on the first save of another program's file: the creation and change
  times and the other properties GridCraft does not write (checked with `from-excel.xlsx`), the
  VBA project of an `.xlsm` (on the web, see above), and what the model lacks inside the parts it
  rewrites. Some losses come with an import warning: what-if data tables (their values are kept,
  `xlsx/src/sheet_read.rs:496`), unsupported conditional formats and Excel 2010 extensions
  (`sheet_read.rs:648`, `:956`), date filters (`sheet_read.rs:774`). (0.5.0 also dropped, with a
  warning, external links, embedded objects, form controls and sheet protection passwords, which
  0.6.1 keeps.) ODS is a data import: formulas become their values (`xlsx/src/ods.rs:47-48`).
- There is no document identity: no creation time, no id, nothing that survives saves. New
  workbooks are titled `Book<N>`, the lowest number no other unsaved `Book<N>` window uses
  (`engine/src/lib.rs:296-305`); opened files are titled with their extension, so with
  `Book1.xlsx` open Ctrl+N still makes `Book1`, which saves as `Book1.xlsx`. The Start dialog
  (Home icon) and the File view's Home and New pages make the samples `Household Budget`,
  `Quarterly Sales Dashboard` and `Gradebook` (`engine/src/sample.rs:11-15`,
  `backstage.rs:311-325`). None of these names is translated. (`sample.rs` falls back to the
  title `Sample`, but `file.new` fails for an unknown sample before it gets there,
  `engine/src/cmd/file.rs:32-42`.)
- View > New Window makes a copy of the active workbook titled `<title>:2`
  (`engine/src/cmd/extra.rs:764-770`). The save name cuts the title at its last dot, so the copy
  of `x.xlsx` saves under the same name as the original window, and the copy of `Book1` (no dot)
  as `Book1:2.xlsx`.
- AutoSave (the toggle in the title bar, off by default) never fires on the web: it needs a path
  ending in `.xlsx` and a clock, and the web build's clock always reads 0
  (`ui-egui/src/lib.rs:1037-1046`, `:1134-1144`).
- On Windows and Linux the shortcuts are Ctrl+S and Ctrl+Shift+S (`Cmd` is Ctrl there). In a real
  browser Ctrl+N and Ctrl+W belong to the browser; the File view has New and Close.

| Download | Name | Kind |
|---|---|---|
| Save, Save As… of the opened workbook (also the File view's Save As page, Download (.xlsx)), a file GridCraft wrote | `<stem>.xlsx`, the opened name (for `X.XLSX`: `X.xlsx`) | `document`, if the save still has every part of the file that GridCraft does not rebuild (see [How the adapter classifies](#how-the-adapter-classifies)); otherwise `copy` |
| Save, Save As… of the opened workbook, an `.xlsx` another program wrote (also a password-protected one) | `<stem>.xlsx`, the opened name (for `X.XLSX`: `X.xlsx`) | `copy`: the first a new file, later ones replace it |
| Save, Save As… of an opened `.xlsm` or `.csv` | `<stem>.xlsx` | `document`, stored next to the original |
| Save, Save As… of an opened `.ods` (or `.xls`) | `<stem> (imported).xlsx` | `document`, stored next to the original |
| Save of another workbook: a new one (`Book<N>`), a sample, a New Window copy of one of them (`Book<N>:2`), a file the user opened or dropped | `<its stem>.xlsx` | `export`; with the opened file's name see [How the adapter classifies](#how-the-adapter-classifies) |
| Save of the window View > New Window opened on the opened workbook | the opened workbook's save name | as the opened workbook ([known gaps](#known-gaps)) |
| Export as PDF: the File view's Export page (Create PDF) or Save As page (type PDF), Search Commands (`file.exportPdf`) | the title with `.pdf` (`ui-egui/src/lib.rs:395-406`): `x.pdf`, `x (imported).pdf` | `export` |
| Since 0.6.1, the File view's Export page (CSV, Web Page) or Save As page (type CSV, Web Page) | `<stem>.csv`, `<stem>.html` (`backstage.rs:732-791`, `file.rs:127-133`); for an opened `x.csv` the CSV has the opened name | `export` |
| Share > Save a Copy as Excel Workbook…, Export as CSV…, Export as Web Page… | nothing: the dialog asks for a path, and the command then fails with `<path>: no file system in the browser` (`ui-egui/src/dialogs.rs:1020-1037`, `engine/src/io.rs:357-360`) | |
| Print (Ctrl+P, More (…) > Print…, the File view's Print page) | since 0.6.1 the PDF opens in a hidden frame for the browser's print dialog (`web.rs:189-229`, `ui-egui/src/lib.rs:437-464`); a browser without a PDF viewer (headless Chromium, Chrome set to download PDFs) downloads it to the user's disk as `<uuid>.pdf`, past the translator. 0.5.0 discarded the PDF. | |

**Links**

- GridCraft opens links with `window.open(url, '_blank')` (`web.rs:146-150`): links in dialogs
  (About > Contributors, rerouted from egui in `ui-egui/src/dialogs.rs:1089-1107`) and cell
  hyperlinks whose target contains `://` or starts with `mailto:` (`ui-egui/src/grid.rs:2284-2294`).
  A cell link such as `javascript://…` passes GridCraft's own check; the translator's
  `window.open` opens only `http:`, `https:`, `mailto:` and `blob:` URLs and adds `noopener` for
  other origins (see [protocol.md](../protocol.md#links)).

## How the adapter classifies

The adapter tells the core the name GridCraft gives a save of the opened file (`savedName`):
`<stem>.xlsx`, or `<stem> (imported).xlsx` for a name ending in `.ods`, `.xlsb`, `.xls` or `.xlt`
(any letter case) or an ODS package (a zip whose `mimetype` entry is exactly
`application/vnd.oasis.opendocument.spreadsheet`, as GridCraft checks it,
`xlsx/src/ods.rs:34-45`). For `report.xlsx` that is the opened name; for `report.xlsm` or
`report.csv` it is `report.xlsx`. The core calls the adapter for a download whose sanitised name
equals a file opened in the frame, or the saved name of one.

The adapter returns `export` unless all of these hold: the download has the saved name and ends
in `.xlsx`; its stem is not a new workbook's or a sample's title (`Book<N>`, `Household Budget`,
`Quarterly Sales Dashboard`, `Gradebook`, also with the `:2` of a New Window copy); it is not the
save name of a file the user brought in; and its `docProps/app.xml` says GridCraft. Then:

- **A file saved under its own name** (an opened `.xlsx`; also `X.XLSX`, saved as `X.xlsx`,
  because a host that compares names without letter case, or a file system that ignores it, takes
  that for the opened file) is `document` only if GridCraft wrote it (its `docProps/app.xml` says
  GridCraft) and the save loses no part of it that GridCraft does not rebuild. The adapter has
  the list of parts GridCraft rebuilds from its model on every save, as every release since 0.5.0
  writes them (`[Content_Types].xml`, the workbook, sheets, styles, drawings, charts, tables,
  comments, PivotTables, pictures, ...; from `xlsx/src/write.rs`, `sheet_write.rs`, `pivot.rs`
  and `richdata.rs`). Every other part of the opened file must still be in the save under its
  name: the parts 0.6.1 keeps unread (`customXml/`, `docProps/custom.xml`, `xl/externalLinks/`,
  `xl/embeddings/`, `xl/ctrlProps/`, ...), the parts only 0.6.1 writes (threaded comments in
  `xl/threadedComments/` and `xl/persons/`, the checkbox property bag in
  `xl/featurePropertyBag/`), and parts another program added (`xl/vbaProject.bin`,
  `xl/calcChain.xml`, a part no relationship reaches, ...); a part GridCraft keeps under a new
  name (a chart sheet since 0.7.0) counts as missing, the safe side. Otherwise the save is
  `copy`: the
  first save of the open becomes a new file next to the original, and later saves replace that
  file (see [protocol.md](../protocol.md#copies)). A file of another program (another
  `docProps/app.xml`, or no zip, such as a password-protected workbook) is always `copy`: GridCraft
  drops its creation time and whatever its model lacks. The original is never replaced. Once the
  user opens the copy, which GridCraft wrote, saves go back into it; with 0.6.1 it has the parts
  GridCraft kept, and its saves keep them. With 0.5.0 the same rule makes a copy of every
  GridCraft file with such a part, because 0.5.0 drops it.
- **A file saved under another name** (`.xlsm`, `.ods`, `.xls`, `.csv`) is `document`. The first
  save arrives with the open's `openId`; the Nextcloud editor page stores it as a new file next to
  the original, and later saves replace that file (see [protocol.md](../protocol.md#saves) and
  `craftsuite_layer/src/editor.ts`). The original stays as it is, also when it is an `.xlsm` whose
  macros the `.xlsx` lacks. (The editor page sends names with a lower-case extension, so in
  Nextcloud `X.XLSX` arrives as `X.xlsx` anyway.)

The adapter reads only the zip's central directory, `docProps/app.xml` and `mimetype` (each at
most 1 MB, unpacked with `DecompressionStream('deflate-raw')`), once per file and once per save.

- Save rewrites the whole file, so the prefix check of PdfCraft does not apply, and GridCraft
  stores no identity: the name, the writer and the parts decide.
- A new workbook is `Book1` in every session and saves as `Book1.xlsx`, the name of an opened
  `Book1.xlsx`; the samples save under their titles, and their New Window copies as
  `Book1:2.xlsx` and the like. Nothing in the bytes tells them from the opened file, so a file
  with such a name is never saved back: every save of it is a new file.
- **Files the user brings in.** GridCraft saves a file the user drops from the desktop or opens
  with File > Open as `<stem>.xlsx` too, so one with the opened file's stem would come back under
  the document's name with other content, possibly an Excel file re-encoded with losses. The
  adapter notes the names of such files where GridCraft reads them: the `files` getter of a
  `DataTransfer` during a trusted `drop` (the core's own drop is synthetic) and of an
  `<input type=file>` (the core uses none), except a picker that accepts only images (Insert >
  Picture). A save under `<stem>.xlsx` or `<stem> (imported).xlsx` of such a file is an `export`.
- **Exports under the opened name.** The CSV export of an opened `x.csv` is named `x.csv`, not
  the saved name `x.xlsx`, so it is an `export`: a new file, the original stays as it is.
- **The save picker.** The adapter deletes `window.showSaveFilePicker` in the frame before
  GridCraft starts: GridCraft then always takes its `<a download>` path, which the core catches,
  also in a browser that would show the picker in a frame.
- The `docProps/app.xml` check of the save is a guard: in 0.5.0 and 0.6.1 nothing but Save writes
  `<stem>.xlsx`.

## Interface language

- **How GridCraft picks it.** Once, as the app is created (`web.rs:45-51`), from
  `navigator.language` (`ui-egui/src/i18n.rs:95-104`): only the browser's first language, not
  `navigator.languages`, and only its primary subtag (`i18n.rs:76-92`). So `ru-RU` gives Russian,
  `pt-PT` and `pt-BR` both give Brazilian Portuguese, and a language GridCraft lacks (Italian,
  Polish, ...) gives English, the default (`ui-egui/src/lib.rs:92-104`). The web build then drops
  Chinese, Japanese and Korean, for which it has no font: they start in English too
  (`web.rs:43-51`). There is no URL switch and nothing is stored: the web build uses no storage
  and eframe's persistence is not enabled; only the desktop app keeps the choice, in `ui.json`
  (`apps/gridcraft/src/main.rs:104-115`).
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
  build drops them itself, so an override would give English. GridCraft 0.6.1 adds German,
  French and Czech (`i18n.rs:76-92`), which `LANGUAGES` and the Nextcloud app's list could offer
  as `de`, `fr` and `cs`; until then a German, French or Czech browser still gets them.
- **Translations.** Since 0.6.1 Spanish, Brazilian Portuguese, Russian, German, French and Czech
  each translate the ribbon, the status bar and the File view, from a table of 382 labels each
  (`ui-egui/src/i18n/*.rs`; 0.5.0 had 266 labels for Russian and Brazilian Portuguese, and none
  for Spanish). A label without an entry stays English (`i18n.rs:110-128`), and so does what is
  drawn without the table: AutoSave (`ui-egui/src/ribbon.rs:55`) and most dialogs. Names the
  engine gives (`Book1`, `Sheet1`) are never translated. The Russian labels are longer: in a frame
  1400 px wide, the Home tab's last group (AutoSum, Sort & Filter, Find & Select) no longer fits.
  Spanish also switches formula entry: ten function names (`SUMA`, `PROMEDIO`, `SI`, ...), `;`
  between arguments and `,` as the decimal separator (`formula/src/input.rs:14-36`,
  `i18n.rs:106-108`). Saved files keep the English syntax.
- **A language the user picks in the app** (View > Interface language,
  `ui-egui/src/ribbon.rs:2210-2225`, or the File view's Options, `backstage.rs:805-820`; the
  command `app.language.set`, `ui-egui/src/lib.rs:515-525`) applies at once and lasts until the
  frame reloads. Nothing is stored, so every start is in the host's language again, or without
  one in the browser's. The list also offers Chinese, Japanese and Korean, which the web build
  has no fonts for.

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
  without touching `docProps/app.xml` and without adding a part GridCraft drops (for example by
  adding content inside a sheet that GridCraft drops) passes as written by GridCraft, and its save
  replaces it with losses. So does a file a newer GridCraft wrote with something an older one
  does not read inside the parts it rebuilds: `docProps/app.xml` carries no version. Nextcloud's
  file versions (where enabled) keep the previous state.
- **Kept parts the user removes.** With 0.6.1, a save of a GridCraft file after the user deleted
  the sheet that held kept content (form controls, embedded objects, ...) or the last threaded
  comment lacks that part, so it is a copy, not the document.
- **The guard depends on how GridCraft reads files.** Should a release read dropped or picked
  files another way (`DataTransfer.items`, the File System Access API), files from elsewhere go
  unnoticed again. The `saved-as` test fails then.
- **After a file from elsewhere with the same save name**, every later save under that name is an
  export, also a save of the opened workbook, until the frame is reloaded.
- **XLSB and XLS by content.** An XLSB or XLS file under another name than `.xlsb`, `.xls` or
  `.xlt` is an import for GridCraft (`<stem> (imported).xlsx`) but not for the adapter; its saves
  miss the saved name and are exports.
- **One copy per open.** Each time the user opens an `.xlsx` of another program again, its first
  save makes another copy (`x (2).xlsx`, `x (3).xlsx`, ...).
- **Password-protected workbooks.** GridCraft saves the decrypted workbook without its password,
  so the copy next to the encrypted original is not protected. GridCraft says so in its info bar
  when it opens the file.
- **No unsaved-changes signal.** GridCraft shows unsaved changes only as `•` in the title bar,
  never clears it after a save on the web, asks nothing before the page unloads and keeps no
  recovery copy (eframe's persistence is not enabled; `localStorage` stays empty, also in 0.6.1).
  The host must warn on close.
- **`delivered` is not "opened".** Any dropped file opens (a PNG as text in a sheet); a file
  GridCraft cannot read (a damaged workbook, a password-protected one with an encryption it does
  not support, a wrong password) shows an error in its message box only.
- **Saved means downloaded.** If the host cannot store the file, the translator's fallback browser
  download is the copy the user keeps.
- **Print without a PDF viewer.** Where the browser downloads PDFs instead of showing them, Print
  saves a `<uuid>.pdf` to the user's disk; it never reaches the host.
- **Memory.** GridCraft passes the opened file and every save through base64 strings
  (`ui-egui/src/lib.rs:956`, `:622-627`, `engine/src/cmd/file.rs:132`), several times the file
  size in wasm memory. Very large workbooks may fail inside the app, while the host only sees
  `delivered`.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so GridCraft
  cannot start there.

## Hosting notes

- GridCraft's `HOSTING.md` (in the web build, unchanged in 0.6.1) allows cross-origin iframes and
  asks for no special headers (no COOP/COEP). It asks not to send `X-Frame-Options: DENY` or a
  `frame-ancestors` that excludes the embedding page. For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`.
- The web build renders with wgpu: WebGPU where the browser has it, else WebGL2. With neither, it
  writes `GridCraft failed to start: …` and `A browser with WebGPU or WebGL2 is required.` into
  `#gridcraft_loading` (`web.rs:57-61`) and registers no drop target, and the host gets `the app
  registered no drop target`. The tests run on WebGL2 (Chromium with SwiftShader, and WebKit).
- Query flags are substrings of the whole query string (`location.search`, `web.rs:23`,
  `:35-40`, `:66-68`): `webgl` forces WebGL2; `sample=budget`, `sample=sales` or `sample=grades`
  opens that sample at startup (another name opens none), and `sample` anywhere else in the query
  the sales sample. The query of the configured app URL must contain neither (the Nextcloud app
  accepts no query at all).
- The `.wasm` file of 0.6.1 is 18.5 MB, 6.9 MB with gzip (0.5.0: 16.6 MB and 6.2 MB). Serve it
  compressed, preferably precompressed with Brotli. Since 0.6.1 `index.html` also links a
  favicon, `gridcraft-<hash>.ico`.
- The loader is Trunk's inline module script in `index.html`. It imports
  `gridcraft-web-<hash>.js`, awaits the `.wasm` module and then dispatches
  `TrunkApplicationStarted`. A `.wasm` file that is missing or cannot be compiled makes the loader
  fail, and the host gets `the app failed to load: ...`; a Content-Security-Policy that blocks the
  inline script leads to `the app did not start in time` (see
  [protocol.md](../protocol.md#errors)).
- Copying writes HTML and text with `navigator.clipboard.write`, falling back to `writeText`
  (`web.rs:157-187`): the frame needs `clipboard-write`, which the Nextcloud editor page
  delegates.
- Since 0.6.1 the web build follows the browser's light or dark preference (`web.rs:42`); the
  title bar has a switch for the session.
- `HOSTING.md` says preferences are kept in the frame's `localStorage`; the 0.5.0 and 0.6.1
  builds store nothing there.
- The interface follows the host's language where GridCraft has it, else the browser's first
  language (`navigator.language`, by its primary subtag); Chinese, Japanese and Korean, for which
  the build has no fonts, start in English (`web.rs:43-51`). See
  [Interface language](#interface-language).
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `xlsx` | the workbook; Save replaces the file if GridCraft wrote it, otherwise the first save creates a copy next to it, which later saves replace | yes | no |
| `xlsm` | the workbook (GridCraft warns that it does not run the macros); Save creates `<stem>.xlsx`, without the macros, next to it, which later saves replace | yes | no |
| `ods` | a data import (formulas become values); Save creates `<stem> (imported).xlsx` next to it | yes | no |
| `csv` | a sheet named after the file; Save creates `<stem>.xlsx` next to it (the CSV export of the File view is a new file) | yes | no |

Match the extension in any letter case. Nextcloud 34 and 35 know MIME types for all four, but
the app matches by extension anyway. No default: Nextcloud Office, ONLYOFFICE and Euro-Office open
these types on a click where they are installed, and without them Nextcloud Text opens `.csv`. An
administrator can make GridCraft the default app ([nextcloud-app.md](../nextcloud-app.md#configuring));
then a click opens all four in GridCraft, with the saves as in the table.

Not offered: `xlsb` and, since 0.6.1, `xls` (data imports like ODS: Save creates
`<stem> (imported).xlsx` next to it; they could be added the same way, `xls` only once the
tested version is 0.6.1 or later, as 0.5.0 cannot open it), the templates `xltx`, `xltm` and
`xlt`, `tsv`, `txt` and `json` (too generic).

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
| `saved-as` | `from-excel.xlsx` (whose creation time GridCraft drops), and a GridCraft file with a customXml part no relationship reaches (which GridCraft drops) under an upper-case name (`CHANGED-ELSEWHERE.XLSX`, saved as `CHANGED-ELSEWHERE.xlsx`), are never replaced: the first save is a `document` that follows its own id, the next a `document` that follows the first (a copy). The copy, opened again, saves back as the document, with every part it had (with 0.6.1 the custom properties and the customXml item of Excel's file). `macros.xlsm`, `data.ods` and `data.csv` save as `macros.xlsx`, `data (imported).xlsx` and `data.xlsx`, the document, twice. GridCraft's sales sample saves as the document with the same parts, and that save, opened again, saves back unchanged. An opened `Book1.xlsx` is never saved back, and neither is a new workbook's save under that name. The blanks of the "+ New" entry in Files (`blank.xlsx` on A4 and `blank-letter.xlsx`, from `craftsuite_layer/assets/`, served by the test server) open, and their first saves are the document. A different `craftsuite-probe.xlsx` the user opens with File > Open (in Chromium also one dropped from the desktop) is never the document. |
| `language` | The host's language under the browser locale `en-US`: with `lang=ru`, `ready` reports `ru` and the app frame's `navigator.language` is `ru`. GridCraft draws its labels into the canvas, so the rest is a picture: the ribbon's tab row is, byte for byte, the one a start without `lang` under the browser locale `ru-RU` shows (in a browser context of its own), and not the one of an English start. |
| `ui` (`@ui`) | With the pointer, on an opened `data.csv`: File > Save, then Download (.xlsx) on the Save As page, saves the document `data.xlsx`; File > Export > Create PDF downloads `data.pdf`, a new file; File > Export > CSV downloads `data.csv`, under the opened name, a new file. |

A test with several scenarios (`saved-as`) runs each in a page of its own and reports every
scenario that fails as `scenario failed: <title>`, not only the first.

The steps use GridCraft's keyboard shortcuts (`ui-egui/src/ribbon.rs`, `shortcut()`) and edit
cells with F2, the text and Enter. They wait for what the app shows: the window title reported on
the console when a file opens and when a workbook first changes (see [Opening](#what-the-web-build-does)),
and a settled picture after Escape closed the import message box, which would otherwise take the
next keys. Export as PDF and as CSV are only in the File view (PDF also in Search Commands),
which only the pointer opens, so they are in the `ui` test; its click positions are in the `AT`
table of the spec, measured on 0.6.1 at a 1400x900 viewport with the locale `en-US`, with the tab
row the `language` test compares (measured on 0.5.0, unchanged in 0.6.1). When a new release
fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  handling (`web.rs:76-92`, `ui-egui/src/lib.rs:948-970`), the title and save name rules
  (`engine/src/cmd/file.rs`), the download helper (`web.rs:250-379`), the writer's parts, the
  parts it keeps or `docProps/app.xml` (`xlsx/src/write.rs`, `passthrough.rs`), or how the user's
  own files are read. The rules fail towards new files, not towards overwriting: a save under a
  name the adapter does not expect, or one that lost a part the adapter does not know, arrives as
  an `export` or a copy. Sites that host the app should hold the release back until the adapter
  is fixed. The sales sample's check does not depend on the release's bytes: the first save must
  have the fixture's parts, and that save, opened again, must come back byte for byte. A release
  whose writer adds or drops a part of the sample, or is no longer deterministic, fails it.
- **The `language` test fails.** The report has the tab rows that did not compare as expected.
  If the `ru-RU` start is Russian and the `lang=ru` start is not, the override no longer reaches
  the app; if both are English, the release no longer takes its language from
  `navigator.language` (`web.rs:45-51`, `ui-egui/src/i18n.rs:95-104`). Either way the adapter
  needs another way in. If the pictures show something other than the tabs, the tab row moved:
  re-measure `AT.tabRow`.
- **Only the `@ui` test fails.** A button of the File view moved. Re-measure the positions in
  `AT`; the translator is not at fault.
- **A shortcut changed upstream.** The tests that press it fail: Ctrl+S, Ctrl+Shift+S, Ctrl+N,
  Ctrl+O, Ctrl+Home and F2 are used by the contract tests. Check them against `ribbon.rs` and
  `grid.rs` before holding a release back.

The fixtures in `tests/e2e/fixtures/gridcraft/`: `craftsuite-probe.xlsx` was saved by GridCraft
0.5.0 (a new workbook, the marker `CRAFTSUITE-PROBE-gc01` in A1 and 42 in B1, Ctrl+S), and
`sales-sample.xlsx` is the Start dialog's `Quarterly Sales Dashboard` sample saved with Ctrl+S
by GridCraft 0.6.1 (GridCraft's own sample content, `engine/src/sample.rs`, under GridCraft's
license, MIT or Apache-2.0; the app opened with `?sample=sales`), which 0.5.0 saves back
unchanged too, and 0.7.0 with one more attribute (see Saving and downloads).
`make-fixtures.mjs` writes the files of other programs: `from-excel.xlsx` and `macros.xlsm` as
Excel writes them (with custom properties and a customXml item, and a VBA project), `data.ods`
and `data.csv`. The tests derive the other files they open from these (`Book1.xlsx`, the changed
GridCraft file, the file from the user's disk, the reopened copies).

## Upstream

Since 0.7.0 GridCraft has an embedding bridge (`?host=parent`, storytold/gridcraft#237, see
[Opening](#what-the-web-build-does)), but only for a parent page on GridCraft's own origin. The
translator serves a host on another origin (the Nextcloud editor page frames the app hosted
elsewhere), so the open and save paths still depend on drops and downloads. A version of the
bridge that a host on another origin could opt into (a list of allowed parent origins, like the
translator's), with the save's kind left to the host, would let the adapter's rules go; see
[architecture.md](../architecture.md#native-embedding-apis) and, for PdfCraft,
[storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422). Worth reporting
upstream as well: no
document identity in saved files (a new workbook cannot be told from the opened one); no clock in
the web build's interface (AutoSave never fires, and messages that should disappear stay; since
0.6.1 only `NOW()` and `TODAY()` read the browser's clock); the unsaved marker not cleared after
a save on the web; Share > Save a Copy, Export as CSV and Export as Web Page doing nothing on the
web (the File view's Export page works); the macros notice saying that GridCraft keeps them when
it saves, while the web saves `.xlsx` without them; Print downloading `<uuid>.pdf` in a browser
without a PDF viewer; the `localStorage` claim in `HOSTING.md`.
