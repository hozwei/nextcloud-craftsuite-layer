<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# CADCraft

| | |
|---|---|
| Upstream | [github.com/storytold/cadcraft](https://github.com/storytold/cadcraft) |
| Adapter | [`translators/cadcraft.js`](../../translators/cadcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.5.0 when this page was written, checked again with 0.6.2) |
| Tests | [`tests/e2e/specs/cadcraft.spec.ts`](../../tests/e2e/specs/cadcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the CADCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.5.0
source and web build, and again against 0.6.2. Upstream may change any of them; the daily canary
run (see [development.md](../development.md#continuous-integration)) is there to notice. Source
references are to the `v0.6.2` tag unless they name another; `main.rs`, `upload.rs`,
`download.rs` and `host.rs` are in `apps/cadcraft-web/src/`, the other paths are under `crates/`.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#cadcraft_canvas`, `main.rs:23`), where eframe
  registers the page's only drop listener once the graphics and the app exist (`main.rs:95-148`).
  The drop handler does not check `isTrusted`, so the translator's simulated drop works like a
  user's drop. The core's default drop target fits, and `ready` cannot come before the app can
  take the file; the adapter needs no `dropTarget` and no `started` check for that.
- Each dropped file is read in the background (`upload.rs:70-97`) and opened on the app's next
  frame with `OPEN {data, name}` (`ui-egui/src/lib.rs:385-394`). The reader decides
  (`io/src/lib.rs:60-71`): a DWG by its content, an SVG or SVGZ by its name (imported into a
  drawing, new in 0.6), anything else as an ASCII or binary DXF, whatever its name. A DWG does
  not open on the web: CADCraft reports `DWG files can't be opened in the web build yet; save as
  DXF` on its command line and in its status bar (`dwg/src/lib.rs:258-264`). Files over 256 MB
  are refused before they are read (`ui-egui/src/lib.rs:369-380`).
- **Every file opens as a new drawing tab titled with its file name** (`engine/src/cmd/file.rs:231-243`,
  `engine/src/lib.rs:645-657`), also while a tab with that name is open. The page starts with the
  drawing `Drawing1` (`engine/src/lib.rs:599-603`), which stays open next to the opened file.
- File > Open… (Ctrl+O) shows the browser's file picker: a hidden
  `<input type="file" id="cadcraft_open_input" accept=".dxf,.dwg">` appended to `<body>` and
  clicked (`upload.rs:41-68`). The chosen file opens like a dropped one. Every other command that
  asks for a file on the web uses the same picker and opens the file the same way, as a drawing of
  its own: File > Drawing Utilities > Recover…, New from Template… and Import…
  (`ui-egui/src/menus.rs:132-147`, `ui-egui/src/exchange.rs:26-32`).
- There is no `?file=`. The query flags are `webgl`, `cpu`, `sample` and, new in 0.6, `host=parent`,
  an embedding bridge for a same-origin parent page that the layer does not use (see
  [Hosting notes](#hosting-notes) and [Upstream](#upstream)).
- There is no JavaScript-visible signal that a file was opened, could not be opened, or has
  unsaved changes, except through that bridge. The host only gets `delivered`.

**Saving and downloads**

- Every download goes through one helper (`download.rs:16-55`): a `Blob`,
  `URL.createObjectURL`, an `<a download>` with `display: none` appended to `<body>`, `click()`,
  then the element is removed at once and the URL revoked after 60 s. Drawings and image exports
  are typed `application/octet-stream` (`engine/src/cmd/file.rs:316-331`), a table exported with
  TABLEEXPORT `text/csv` (`engine/src/cmd/table/cells.rs:513-525`). There is no File System
  Access API.
- Save (Ctrl+S) and Save As… (Ctrl+Shift+S) (`engine/src/cmd/file.rs:146-151`) ask for nothing on
  the web. A drawing opened from a file has no path, so Save runs Save As
  (`ui-egui/src/menus.rs:156`), which suggests the drawing's title, the file's name trimmed of white
  space (Rust's `trim`: unlike JavaScript's, it removes U+0085 and keeps U+FEFF), plus `.dxf` if
  that has no extension (`ui-egui/src/lib.rs:130-136`), and the web's picker takes the suggestion
  as it is (`main.rs:67-71`, `ui-egui/src/menus.rs:148-155`). The drawing then keeps that name, and
  every later Save writes it again (`engine/src/cmd/file.rs:337-351`). So both download under the
  opened name at once. The Save button of the question before closing a drawing with unsaved
  changes runs Save too (`ui-egui/src/closing.rs:109-114`).
- On Windows and Linux the shortcuts are Ctrl+S and Ctrl+Shift+S; in WebKit, with Safari's user
  agent, the menus show ⌘, and the tests press Ctrl there as well.
- Every save is a full rewrite (`io/src/dxf_write.rs`), never an update of the opened bytes: an
  ASCII DXF with CRLF line ends (`dxf/src/lib.rs:411-426`). 0.5.0 wrote only R2000 (`$ACADVER`
  `AC1015`, `$DWGCODEPAGE` `ANSI_1252`). **0.6 writes R2000 to R2018** (`io/src/lib.rs:82-103`): a
  drawing in the version of the file it was read from, a new one in 2018. On the web, though, the
  first save of an opened file writes the version set as `saveVersion` in OPTIONS (2018 unless the
  user changed it), because Save As treats a drawing without a path as one with no file yet
  (`ui-egui/src/menus.rs:368-374`, `ui-egui/src/options/mod.rs:14`); the drawing then keeps that
  version, and every later save writes it (`engine/src/cmd/file.rs:298-312`). An R2000 file
  CADCraft 0.5.0 wrote comes back as R2018. From 2007 the text is UTF-8; before, non-ASCII text is
  written as `\U+XXXX` escapes and `$DWGCODEPAGE` keeps the code page the file was read in
  (`dxf/src/lib.rs:511-524`, `io/src/dxf_write.rs:1035-1039`). The writer is deterministic: a file
  0.6.2 saved and saves again unchanged comes back byte for byte (the tests' fixture, the blank
  and the sample), or with new handles only (upstream's `examples/apartment.dxf`).
- **What the writer keeps.** 0.5.0 kept only what CADCraft models: entities of types it did not
  model (MLINE, 3DSOLID, MULTILEADER, ...) stayed in the drawing and were not written
  (`v0.5.0 io/src/dxf_write.rs:896-897`), other programs' xdata and objects (XRECORDs) were
  dropped. 0.6 keeps them as read (`io/src/dxf_raw.rs`, upstream #545): entities and objects of
  other types, other applications' xdata, extension dictionaries, reactors. It still drops header
  variables outside its list of about 45 (`io/src/dxf_write.rs:219-261`, `:1648-1666`; not
  `$TDCREATE`, `$FINGERPRINTGUID`, `$VERSIONGUID` or `$ACADMAINTVER`) without a word. A DXF from
  another program (`foreign.dxf` of the tests: R2018 with those four header variables, another
  application's xdata on a LINE, an MLINE and that application's XRECORD) comes back from 0.6.2
  with all of it but the four header variables. An older DXF version holds less: before 2007 a
  multileader is written as a LEADER with its MTEXT or block (`io/src/dxf_write.rs:845`,
  `:1043-1059`), and reads back as such.
- Dimension blocks: 0.5.0 added a new set of `*D<n>` blocks with every open and save (upstream's
  `examples/apartment.dxf` grew from 48,769 to 59,982 and 69,937 bytes). 0.6 writes one block per
  dimension and drops the stale ones (upstream #508): that file, saved by 0.5.0 with `*D1` to
  `*D14`, comes back from 0.6.2 with `*D8` to `*D14` and 51,454 bytes. Nothing visible changes.
- New drawings: File > New Drawing… (Ctrl+N) names a drawing `Drawing<N>`, counting from 1 in each
  session (`engine/src/lib.rs:636-644`); with the startup `Drawing1`, the first new one is
  `Drawing2`. Help > Open Sample Drawing opens `Bracket` (`ui-egui/src/menus.rs:172-178`). Their
  saves are `Drawing<N>.dxf` and `Bracket.dxf`; the names are not translated. CADCraft writes no
  document identity into a DXF and keeps none it reads (`$FINGERPRINTGUID` is dropped).
- File > Default Save Format can be set to DWG (kept in the frame's `localStorage`, see
  [Hosting notes](#hosting-notes)). New drawings then save as `Drawing<N>.dwg`, which fails on the
  web (`DWG files can't be written in the web build yet`, `dwg/src/lib.rs:266-268`): no download.
  Drawings opened from a file keep their name.
- `saveas` with JSON parameters, typed on the command line, writes SVG, PNG (2400x1600) or PDF by
  the extension of its `path` (`io/src/lib.rs:109-126`), and the drawing keeps its name and its
  unsaved changes (`engine/src/cmd/file.rs:337-351`). With a `.dxf` path it writes a DXF, in the
  `version` it names if any (2000 to 2018, `engine/src/cmd/file.rs:84-104`); with another name the
  drawing takes that name, and later saves write it. A typed Space ends the command name
  (`ui-egui/src/cmdline.rs:294-297`), so such a line has to arrive in one piece (pasted, or through
  an input method); the tests enter it through eframe's text field. TABLEEXPORT, typed, downloads
  a table as CSV under the name typed at its prompt (`table.csv`, or the drawing's name with
  `.csv`, `engine/src/cmd/table/cells.rs:536-563`).
- Print… (Ctrl+P) opens a Plot dialog (new in 0.6); its OK, Export to PDF…, Export…, Batch
  Publish… and Plot Preview download nothing: CADCraft reports that paths are not available on the
  web (`ui-egui/src/managers.rs:969-990`, `engine/src/cmd/layout.rs:795-806`,
  `engine/src/cmd/exchange.rs:74-87`). WBLOCK writes nothing on the web
  (`engine/src/cmd/blocks.rs:311-312`), and neither does DATAEXTRACTION
  (`engine/src/cmd/blocks/extract.rs:204-212`).
- Autosave and Drawing Recovery (new in 0.6) do not run on the web (`ui-egui/src/autosave.rs:1-4`,
  `engine/src/cmd/audit.rs:65-68`): no autosave or recovery file is downloaded.

The downloads, checked in Chromium and WebKit:

| Download | Name | Kind |
|---|---|---|
| Save (Ctrl+S), Save As… (Ctrl+Shift+S) of an opened DXF that CADCraft wrote (0.5.0, or 0.6.2 in the same or an older DXF version than the save) | the opened name | `document` |
| Save, Save As… of any other opened DXF, also one that CADCraft 0.6.2 wrote in a newer DXF version than the save's | the opened name | `copy`: the first a new file next to the original, the later ones replace it |
| Save of the startup drawing or a new one (Ctrl+N) | `Drawing<N>.dxf` | `export` |
| Save of the sample (Help > Open Sample Drawing) | `Bracket.dxf` | `export` |
| Save of a drawing the user dropped or picked with File > Open… | its file name, trimmed, plus `.dxf` if it has no extension | `export`; with the opened name see [How the adapter classifies](#how-the-adapter-classifies) |
| `saveas {"path": "<name>.svg"}`, `.png`, `.pdf` | as typed | `export` |
| `saveas {"path": "<other>.dxf"}`, and the later saves of that drawing | as typed | `export` |
| `saveas {"path": "<opened name>", "version": 2000}` of an opened DXF in a newer version | the opened name | `copy` |
| TABLEEXPORT | as typed (`.csv`) | `export` |
| Print…, Export to PDF…, Export…, Batch Publish…, WBLOCK, autosave | nothing: no download on the web | |

**Links and clipboard**

- The links in Help > About CADCraft (`ui-egui/src/dialogs.rs:325-326`) and in its credits
  (`ui-egui/src/credits.rs:267`, `:294`) are egui hyperlinks, which eframe opens with
  `window.open` and target `_self`. In a frame that would replace the editor; the translator opens
  them in a new window instead.
- Copy puts the copied entities on the system clipboard as DXF text, and Paste reads paste events
  (`ui-egui/src/clipboard.rs`). The editor frame's delegated `clipboard-write` covers Copy.

## How the adapter classifies

The adapter has no `savedName` (CADCraft saves under the opened name), no `dropTarget` and no
`dropTargetTimeout`.

It knows what each CADCraft release it was checked with writes, in its `RELEASES` list, oldest
first: the DXF versions (`$ACADVER`) and code pages, and the vocabulary, that is the object types
(group 0) that `dxf_write.rs` and its helpers write, the header variables (group 9) from the
writer's list, the xdata applications (group 1001: `ACAD`, `CADCRAFT`, `AcadAnnotative`,
`AcCmTransparency` and `AcAecLayerStandard`) and the keys of the named object dictionary
(`io/src/dxf_write.rs:2066-2096`, `io/src/dxf_ext.rs:22-37`). 0.5.0: R2000 and `ANSI_1252` only.
0.6.2: R2000 to R2018, any code page, the 0.5.0 vocabulary without `$CMLEADERSTYLE` (now kept in
the XRECORD `CADCRAFT_MLEADERSTYLE`) plus MLINE, HELIX, MULTILEADER, TOLERANCE, MLINESTYLE,
ACDBDICTIONARYWDFLT, ACDBPLACEHOLDER and SCALE, `$SNAPUNIT`, `$GRIDUNIT`, `$CMLSTYLE`,
`$CMLJUST` and `$CMLSCALE`, and the keys `ACAD_MLINESTYLE`, `ACAD_PLOTSTYLENAME`, `ACAD_SCALELIST`
and `CADCRAFT_HANDSEED`, `_MLEADERSTYLE`, `_PLOTSTYLES` and `_ANNOTATION`. CADCraft writes no
version number into a DXF, so the vocabulary is what tells the releases apart (0.6.2 always
writes `CADCRAFT_HANDSEED`) and what tells their files from a CADCraft file that another tool
changed.

For a DXF in CADCraft's layout (the start of its header, `$ACADVER` then `$DWGCODEPAGE`, CRLF, its
own `CADCRAFT` APPID record, `0 EOF` as the last pair) the adapter reads:

- **the release it fits**: the oldest release whose lists hold its version, code page and every
  value in it. That release, and every later one, writes it again without losing anything: 0.6.2
  reads what 0.5.0 wrote and writes all of it (checked with the tests' fixture, the blank, the
  sample, a metric drawing and upstream's `examples/apartment.dxf` with dimensions, hatches, a
  table and a leader; 0.6.2 regenerates the dimension blocks and drops the stale ones). A DXF
  that fits no release (from a newer CADCraft, changed by another tool, or holding another
  program's data that 0.6 keeps, such as a copy CADCraft saved of `foreign.dxf`) is not taken for
  one CADCraft writes again without losses. So are `newer-cadcraft.dxf` of the tests (CADCraft's
  layout with an MLINE, `$FINGERPRINTGUID` and another application's xdata) and a CADCraft DXF
  whose line ends were changed to LF.
- **the release that wrote it**: the oldest release whose lists hold every value in it that some
  release writes (what CADCraft 0.6 keeps of other programs is in no list). For a save, that is
  the CADCraft that runs.

Its `identity` is not a document identity (CADCraft writes none) but one mark, `cadcraft-dxf`, for
every DXF in CADCraft's layout, so that the core never takes two of them for different documents
and leaves the decision to `classify`. What the adapter read is kept by the SHA-256 of the bytes:
the core keeps that hash with the opened file and with every save of it that the host stored (see
[protocol.md](../protocol.md#open)), so `classify` finds what the file a save would replace
holds, also after an earlier save replaced it.

The core calls the adapter for a download under the opened file's name. The adapter returns:

- `export` unless the name ends in `.dxf` (any letter case);
- `export` for `Drawing<N>.dxf` and `Bracket.dxf`, the names of CADCraft's own drawings: nothing
  in the DXF tells the startup drawing, a new drawing or the sample from an opened file of that
  name;
- `export` if another file with that save name has entered the app in this frame (below);
- `export` if the download is not a DXF in CADCraft's layout (Save always writes one; this is a
  guard against a binary DXF, a CSV or an image under that name);
- `document` if the opened file fits a release no newer than the one that wrote the save, in the
  same or an older DXF version than the save's: the CADCraft that runs writes it again without
  losses;
- `copy` otherwise: a DXF from another program, one in CADCraft's layout with data CADCraft drops
  or that the adapter cannot vouch for, a file of 0.6.2 that 0.5.0 saves (it would drop what
  0.5.0 does not model), or a save in an older DXF version than the file's (a user who set
  `saveVersion` to 2000 or 2004, or a typed `saveas` with a `version`). The save is the opened
  document, but it may have lost something, without a signal the translator could see.

A `copy` never replaces the opened file. The core sends every `copy` save of an open as
`document` with `follows`. The first one follows its own id, which names no file the host has,
so the host stores it next to the original (in Nextcloud `plan (2).dxf` next to `plan.dxf`);
every later one follows that first save, and the host stores it over that copy (see
[protocol.md](../protocol.md#copies)). The original stays as it is. Opening it again and saving
makes another copy; opening the copy saves in place if it fits a release, that is, if the
original held nothing that CADCraft 0.6 keeps from other programs.

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
then cannot open, and those of Recover…, New from Template… and Import….

## Interface language

The Nextcloud app can name the language an app starts in (its setting *Starts in*). The editor
page passes it in the frame's address, and the core hands it to the adapter's `language` member
before the app's module runs (see [protocol.md](../protocol.md#host-settings)).

- **How CADCraft picks it.** Once, as the app is created (`main.rs:115-122`): it copies
  `navigator.languages`, then reads its stored profile (`cadcraft.profile`) and preferences
  (`cadcraft.prefs`) in the frame's `localStorage` (`ui-egui/src/lib.rs:338-355`). A stored
  `interfaceLanguage` of `en`, `uk`, `pt-BR`, `de`, `es`, `cs`, `ru`, `fr` or `zh` is the language;
  `auto`, any other value, a missing field and missing or unreadable preferences mean Auto, the
  default (`ui-egui/src/i18n/mod.rs:11-35`, `:88-96`). Auto takes the first entry of
  `navigator.languages` whose primary subtag (before `-`, `_`, `.` or `@`, in any letter case) is
  one CADCraft has (any `pt-*` gives `pt-BR`), else English (`i18n/mod.rs:98-110`, `:152-158`):
  `uk-UA` gives Ukrainian, so does `nl-NL` followed by `uk-UA`, and `nl-NL` gives English.
  Chinese needs an installed CJK font, which the web build never finds, so it shows English
  instead, also when Chinese is stored (`ui-egui/src/lib.rs:256-259`, `theme.rs:387-394`).
  `navigator.language` is not read, and neither is the address: there is no URL switch. Every
  frame is drawn in that language, but the browser's languages are read only that once, until
  the frame reloads.
- **What the adapter does.** Its `language` member finds the host's language in its `LANGUAGES`
  table (`uk-UA` finds `uk`, `pt-PT` finds `pt-BR`, `en-GB` finds `en`) and makes the frame report
  that code as the browser's language: `navigator.languages` starts with it, followed by the
  browser's own, and `navigator.language` returns it (getters on `Navigator.prototype`).
  CADCraft's Auto then picks it. `ready` reports the tag, or `null` when `cadcraft.prefs` holds a
  choice of another language (Chinese included), which CADCraft shows instead. The adapter writes
  nothing into CADCraft's preferences. For any other language, and without one, it changes nothing
  and reports `null`: CADCraft follows the browser's languages (or a stored choice), as without
  the layer.
- **The languages offered** are `en`, `cs`, `de`, `es`, `fr`, `pt-BR`, `ru` and `uk`, the keys of
  `LANGUAGES`: all that CADCraft 0.6.2 can show on the web (`i18n/mod.rs:125-150`). Left out is
  Chinese (`zh`), which the web build cannot draw (above). 0.5.0 had English and Ukrainian only;
  with it, another language of the table starts the app in English while `ready` reports that
  language. The fonts egui bundles draw these languages, so no font of the browser is needed;
  German and Brazilian Portuguese were checked in Chromium, Ukrainian in Chromium and WebKit.
- **Partial translations.** Each language covers what CADCraft marks for translation, as far as
  its catalog goes (`ui-egui/src/i18n/*.tsv`, about 1,000 to 1,230 entries each; Ukrainian is the
  one upstream keeps complete): the menus, commands, tool groups and tooltips, the Start page, the
  tabs, the status bar's controls, object snaps, drafting prompts, property labels and dialogs. A
  text without an entry stays English. Not translated (upstream's `docs/localization.md`,
  *Translation coverage*): the command line's keywords and input, the command history and the
  engine's messages, which stay English, and names, which stay as they are: `Drawing<N>`,
  `Bracket`, layers, blocks and styles. So the shortcuts, the typed commands, the save names and
  the DXF writer that the adapter and the tests rely on are the same in every language.
- **A language the user picks in the app** (Edit > Interface Language, `ui-egui/src/menus.rs:61`,
  `dialogs.rs:500-510`, the command `ui.language`, `menus.rs:112-125`) applies at once. eframe
  stores it with the other preferences in `cadcraft.prefs` when the app loses the focus or its
  page is hidden, and every 30 s (eframe 0.36.2 `src/web/app_runner.rs:194-199`, `:237-249`; its
  save on close listens for an event named `onbeforeunload`, which never fires,
  `src/web/events.rs:423`). A chosen language then wins over the host's language at every later
  start; `ready` reports `null` when the two differ. Auto counts as no choice, also when eframe
  stored it by itself: the next start has the host's language again. A browser that blocks or
  clears the frame's storage loses the choice, and the next start has the host's language.

## Known gaps

- **JSON commands with the opened name.** A drawing saved with `saveas {"path": "<opened name>"}`
  from another tab, or opened with `open {"data": "<base64>", "name": "<opened name>"}` (or
  `recover` with the same parameters) and then saved, passes as the document (or the copy) when
  it is a DXF in CADCraft's layout, which every save is. All are explicit and hard to type (a
  typed Space ends the command name), and the second needs the file as base64.
- **Files named like CADCraft's own drawings.** An opened `Drawing<N>.dxf` or `Bracket.dxf` is never
  saved back: every save is a new file (`Drawing1 (2).dxf`, then `(3)`, ...). Files the web build
  saved are often named `Drawing1.dxf`, the startup drawing's name. Renaming the file in Nextcloud
  before opening it avoids that.
- **Files of other programs are not edited in place.** A DXF from AutoCAD, LibreCAD, ezdxf or the
  like is never replaced: its first save is a new file next to it, which the later saves of that
  editor session replace. So is a CADCraft DXF with data that CADCraft drops. Since 0.6 CADCraft
  keeps other programs' entities, objects and xdata, so the copy keeps them too, and the adapter
  cannot tell them from data CADCraft does not write: opening the copy and saving makes another
  copy.
- **The DXF version changes.** On the web, the first save of an opened file writes the version set
  in OPTIONS (2018 by default), not the file's own: an R2000 DXF becomes R2018 (that save replaces
  the file), and with `saveVersion` set to an older version than the file's, every save of a newer
  file is a copy. See [Upstream](#upstream).
- **After a file the user brings in.** Once a dropped or picked file saves under the opened name,
  every save under that name is a new file, also the opened drawing's, until the editor is opened
  again.
- **What the release lists do not cover.** The adapter checks object types, header variables, xdata
  applications and the keys of the named object dictionary, not the group codes inside known
  objects, the keys inside CADCraft's own xdata, or extension dictionaries. A file of a newer
  CADCraft that adds data only there passes and may lose it when an older one saves it. Nextcloud's
  file versions (where enabled) keep the previous state. The lists follow the releases in
  `RELEASES` and must be extended with every release (the canary notices a writer they do not
  know, see [Tests](#tests)).
- **No unsaved-changes signal.** CADCraft shows unsaved changes only as `*` after the drawing's name
  in its tab (`ui-egui/src/chrome.rs:214`), asks only on its own Close and Close All
  (`ui-egui/src/closing.rs`), nothing before the page unloads, and has no autosave or recovery on
  the web. The host cannot tell whether the user has unsaved edits and must warn on close.
- **Saved means downloaded.** CADCraft marks the drawing saved when the download starts
  (`engine/src/cmd/file.rs:337-351`). If the host cannot store the file, the translator's fallback
  browser download is the copy the user keeps.
- **The startup drawing.** The tab `Drawing1` sits next to the opened file. A user who draws there
  saves `Drawing1.dxf` as a new file each time.
- **`delivered` is not "opened".** A file CADCraft cannot read is reported on its command line and in
  its status bar only.
- **Browser shortcuts.** In a browser window, Ctrl+N and Ctrl+W go to the browser (new window, close
  tab) before the frame sees them; File > New Drawing… and File > Close work. The headless browsers
  of the tests pass Ctrl+N to the app.
- **Memory.** An opened file passes through base64 (`ui-egui/src/lib.rs:389-390`) and is held several
  times while it opens. Large drawings may fail inside the app while the host only sees `delivered`.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so CADCraft cannot
  start there.

## Hosting notes

- CADCraft's `HOSTING.md` (in the web build, unchanged in 0.6.2) allows cross-origin iframes and
  asks for no special headers (no COOP/COEP). It asks not to send `X-Frame-Options: DENY` or a
  `frame-ancestors` that excludes the embedding page. For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`. Its iframe example is titled
  `CADCraft image editor`.
- The web build renders with wgpu: WebGPU where the browser has it, else WebGL2. With neither, it
  writes `CADCraft failed to start: ...` and `A browser with WebGPU or WebGL2 is required.` into
  `#cadcraft_loading` (`main.rs:152-159`) and registers no drop target, and the host gets `the app
  registered no drop target`. The tests run on WebGL2 (Chromium with SwiftShader, which offers no
  WebGPU adapter here, and WebKit).
- The drop listener comes once the graphics have started: in the tests 0.1 to 0.4 s after
  `TrunkApplicationStarted`. A graphics start slower than the default drop target timeout of 3 s
  gives a provisional `the app registered no drop target`, followed by `ready` (see
  [protocol.md](../protocol.md#errors)); `data-drop-target-timeout` raises the limit.
- Query flags: `webgl` and `sample` are substrings of the whole query string (`main.rs:102`,
  `:129`): `webgl` forces WebGL2, `sample` opens the sample drawing in a tab of its own. `cpu` (a
  parameter of its own, `main.rs:124-128`, `:164-168`, new in 0.6) draws the drawing with egui
  shapes instead of the GPU canvas. `host=parent` (`main.rs:86-93`) switches the downloads off
  and talks to a same-origin parent page instead (`host.rs`); the layer must never set it. The
  configured app URL must not contain `webgl` or `sample` anywhere in its query, nor a `cpu` or
  `host` parameter.
- The `.wasm` file of 0.6.2 is 20.8 MB, 7.8 MB with gzip (0.5.0: 15.1 and 5.7 MB; `HOSTING.md`
  still says about 13 MB and 5 MB). Serve it compressed, preferably precompressed with Brotli.
- The loader is Trunk's inline module script in `index.html`. It imports
  `cadcraft-web-<hash>.js`, awaits the `.wasm` module and then dispatches
  `TrunkApplicationStarted`. A `.wasm` file that is missing or cannot be compiled makes the loader
  fail, and the host gets `the app failed to load: ...`; a Content-Security-Policy that blocks the
  inline script leads to `the app did not start in time` (see [protocol.md](../protocol.md#errors)).
- Preferences (theme, interface language, default save format and, new in 0.6, default save
  version) are kept in the frame's `localStorage` under `cadcraft.prefs`, the OPTIONS profile
  under `cadcraft.profile` (`main.rs:44-47`, `ui-egui/src/lib.rs:324-355`,
  `ui-egui/src/options/mod.rs:41`), written whenever the app loses the focus and every 30 s (see
  [Interface language](#interface-language)). A browser that blocks or clears the frame's storage
  forgets them, which is harmless: the interface language then follows the host's setting or the
  browser again. A stored default save format of DWG makes saves of new drawings fail, and a
  stored default save version older than a file's makes its saves copies (see above).
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `dxf` | the drawing; Save replaces a DXF that CADCraft wrote, and writes a copy next to any other DXF, which later saves of the session replace (`Drawing<N>.dxf` and `Bracket.dxf` get a new file per save, see [Known gaps](#known-gaps)) | yes | yes, when CADCraft is configured: it keeps layers, blocks, dimensions and layouts, while VectorCraft imports DXF into a drawing of its own; without CADCraft, VectorCraft keeps the default |

Match the extension in any letter case; CADCraft decides by the content. Nextcloud 34 and 35 have
no MIME type for `dxf` (`resources/config/mimetypemapping.dist.json`), so it arrives as
`application/octet-stream`, and no Viewer or Office app claims it. The Nextcloud app registers
`image/vnd.dxf` for it, for the CADCraft icon in Files
([nextcloud-app.md](../nextcloud-app.md#file-type-icons)); it still picks the app by extension.

Do not offer anything else: `dwg` (the web build can neither read nor write DWG, although its
file picker lists it), `svg` (0.6 imports an SVG into a drawing, but saves that drawing as a DXF
or an SVG export of its own, not the SVG it read), and `png` and `pdf`, which CADCraft only
writes.

## Tests

`cadcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`cadcraft-chromium` and `cadcraft-webkit`. The behaviour the core shares with every app (fallback
downloads, a foreign host, startup errors, how copies follow each other) is tested in
`translator.spec.ts` and `pdfcraft.spec.ts`; this spec checks what depends on CADCraft.

The spec has four tests, and its header lists them with their scenarios. The first two are the
contract tests; the canary runs them apart from the `language` test (tagged `@language`) and the
`@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open of a DXF that CADCraft 0.5.0 wrote. A text added on the command line and saved with Ctrl+S arrives as the document under the opened name, a CADCraft DXF with the fixture's marker and the edit; Save As (Ctrl+Shift+S) after another edit is the document again. An SVG export (`saveas` with a typed path) and the save of a new drawing (Ctrl+N, `Drawing2.dxf`) arrive as new files. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. Then the DXF the release saved is opened again: an edit saved with Ctrl+S is the document, and `saveas` with the opened name and `"version": 2000` is a copy when that is older than the file's version (0.6.2 saved R2018) and the document otherwise (0.5.0 writes only R2000). |
| `saved-as` | Saves that must not replace the opened file. `foreign.dxf` (another program's) and `newer-cadcraft.dxf` (CADCraft's layout with an MLINE, `$FINGERPRINTGUID` and another application's xdata) are copies: the first save arrives as the document following its own id (a new file), the second as the document following the first, both with the edit and without `$FINGERPRINTGUID`, which CADCraft drops. An opened `Drawing2.dxf` and `Bracket.dxf` are never saved back, and the new drawing (Ctrl+N) or the sample (`ui.sample`) saved under that name arrives as a new file. A drawing dropped as `craftsuite-probe.dxf`, or picked with File > Open… as `craftsuite-probe` followed by U+0085 (which CADCraft trims and saves as `craftsuite-probe.dxf`), next to the opened `craftsuite-probe.dxf` arrives as a new file, where the same Ctrl+S was the document before. The blank of the Nextcloud app's "+ New" entry (`craftsuite_layer/assets/blank.dxf`, opened as `blank.dxf`), a new drawing as CADCraft 0.5.0 writes it, opens, and its first save, without an edit, is the document. |
| `language` | The host's language under the browser locale `en-US`: with `lang=uk`, `ready` reports `uk` and the app frame's `navigator.languages` starts with `uk`. CADCraft draws its labels into the canvas, so the rest is a picture: the menu bar is, byte for byte, the one a start without `lang` under the browser locale `uk-UA` shows (in a browser context of its own), and not the one of a start without `lang` under `en-US`, where `ready` reports `null` and the frame sees the browser's own languages. With English stored as the user's choice in `cadcraft.prefs` (written from another page of the app's origin in the frame, while no CADCraft runs), `lang=uk` gives `ready` with `null` and that English menu bar. |
| `ui` (`@ui`) | Menus with the pointer, on the opened fixture: File > Save saves the document; Help > Open Sample Drawing, then File > Save, arrives as a new file `Bracket.dxf`. |

A test with several scenarios (`saved-as`) runs each in a page of its own and reports every
scenario that fails as `scenario failed: <title>`, not only the first.

The steps use CADCraft's shortcuts (`engine/src/cmd/file.rs`) and its command line, where typed
words run commands and a Space ends a word (`text 2,6 0.5 0`, then the text, then an empty line;
`ui.sample`). A line with JSON parameters goes in as one text input through eframe's hidden text
field. A drop from the desktop is simulated with a drop event on the canvas, as the translator's
own drop; the adapter counts every drop. Only the `ui` test clicks with the pointer; its click
positions are in the `AT` table of the spec, with the menu bar the `language` test compares,
measured on 0.5.0 at a 1400x900 viewport with the locale `en-US` (the same in Chromium and
WebKit, and unchanged in 0.6.2: File at x 17, Help at x 465, the menu bar at y 43, Save the fifth
row of the File menu at y 166, Open Sample Drawing the first of the Help menu at y 70). When a new
release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing (`upload.rs`, `ui-egui/src/lib.rs:385-394`), the title and save name
  (`ui-egui/src/lib.rs:130-136`, `menus.rs:148-156`), the download helper (`download.rs`), or the
  writer (`io/src/dxf_write.rs`). A writer that emits an object type, header variable, xdata
  application, dictionary key, DXF version or code page that no release in `RELEASES` lists makes
  the file the release saved fit no release: opened again, its saves are copies instead of the
  document (the last step of `contract`). Add the release to `RELEASES` in
  `translators/cadcraft.js`, after checking that it writes again, without losses, what the earlier
  releases wrote (save their files with it and compare), and that it always writes something
  that the earlier ones do not (or the adapter cannot tell its saves from theirs). A writer that
  no longer writes CADCraft's layout (header start, APPID, CRLF) makes every save an `export`.
  The rules fail towards new files, not towards overwriting. Sites that host the app should hold
  the release back until the adapter is fixed.
- **The `language` test fails.** The report has the menu bars that did not compare as expected.
  If the `uk-UA` start is Ukrainian and the `lang=uk` start is not, the override no longer reaches
  the app; if both are English, the release no longer takes its language from
  `navigator.languages` (`main.rs:115-122`, `ui-egui/src/i18n/mod.rs:98-110`, `:152-158`). Either
  way the adapter needs another way in. If the start with English stored is Ukrainian, the release
  keeps the user's choice elsewhere (`ui-egui/src/lib.rs:55`, `:324-355`), and the adapter's check
  for a stored choice must follow. If the pictures show something other than the menu labels, the
  menu bar moved: re-measure `AT.menuBar`. Check the release's languages
  (`ui-egui/src/i18n/mod.rs`) against `LANGUAGES` in the adapter and the Nextcloud app's list.
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
`Bracket.dxf`) from these files, and the DXF the release saved from the `contract` test's own
saves.

## Upstream

CADCraft 0.6 has an embedding API: with `?host=parent`, a parent page on the app's own origin
sends the drawing (`cadcraft:open`) and receives every file CADCraft would download
(`cadcraft:save`), with `cadcraft:ready`, `cadcraft:dirty` and `cadcraft:failed` (`host.rs:1-14`).
The layer does not use it: the Nextcloud page frames the Craft hosting on another origin, and the
bridge answers only its own origin. A bridge for a configured cross-origin parent would let the
translator drop the simulated drop and the download interception, and its `cadcraft:dirty` is
the unsaved-changes signal the host lacks; see
[architecture.md](../architecture.md#native-embedding-apis) and the request for PdfCraft in
[storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422).

The growth of dimension blocks that this page proposed to report was fixed in 0.6 (upstream #508).

Worth reporting: on the web a drawing opened from a file is saved in the default save version,
not in its own, because Save As treats a drawing without a path as one with no file yet
(`ui-egui/src/menus.rs:368-374`; `ui-egui/src/lib.rs:94-95` says a drawing opened from a file keeps
that file's version, as it does on the desktop). Proposed text:

> **Web: saving a drawing opened from a file converts it to the default DXF version**
>
> CADCraft 0.6.2, web build. Open an R2000 DXF (drop it on the page or use File › Open), then
> File › Save: the downloaded file is R2018 (`$ACADVER` `AC1032`). On the desktop the same drawing
> is saved as R2000. With the default save version set to 2000 in OPTIONS, an R2018 file is saved
> as R2000, and its multileaders become leaders with text.
>
> On the web a drawing opened from a file has no path, so `saveas_params`
> (`crates/ui-egui/src/menus.rs`, lines 368-374) treats it as untitled and passes the default save
> version, while `UiState::save_version` (`crates/ui-egui/src/lib.rs`, lines 94-95) says a drawing
> opened from a file keeps that file's version.
>
> Expected: a drawing opened from a file keeps its version on the web too, for example by passing
> the default only for drawings that were not read from a file.

Also worth reporting: a writer version mark or a document id in the DXF (for example keeping
`$FINGERPRINTGUID`), so that a host could tell CADCraft's own files and drawings apart without
the release lists; keeping the header variables CADCraft does not model, or a JavaScript-visible
signal that a save lost data; Print and Export to PDF on the web; and the iframe title and the
sizes in `HOSTING.md`. DWG on the web would need the extension list and these rules revisited:
DWG saves would go through a conversion with losses.
