<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# FigCraft

| | |
|---|---|
| Upstream | [github.com/storytold/figcraft](https://github.com/storytold/figcraft) |
| Adapter | [`translators/figcraft.js`](../../translators/figcraft.js) |
| Tested version | `tested` in [`apps.json`](../../apps.json) (0.12.1 when this page was written) |
| Tests | [`tests/e2e/specs/figcraft.spec.ts`](../../tests/e2e/specs/figcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the FigCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.12.1
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source references
are to the `v0.12.1` tag; `web.rs` is `apps/figcraft-web/src/web.rs`, the other paths are under
`crates/`.

FigCraft joins the layer with 0.12.1, the first release whose web build saves at all: before it,
Save, Save As and Export did nothing in the browser
([storytold/figcraft#969](https://github.com/storytold/figcraft/issues/969), fixed in 0.12.x).
`minVersion` is therefore 0.12.1.

## What the web build does

**Starting**

- `index.html` is Trunk's loader: it preloads the `.wasm` (which holds back `load`), imports the
  glue, awaits the module and dispatches `TrunkApplicationStarted`. eframe registers its drop
  listener on `canvas#figcraft_canvas`; the core's defaults fit, the adapter needs neither
  `dropTarget` nor `started()`.
- The app starts with one new document, `Untitled`, in a tab of its own, next to the Home tab.
  It keeps nothing in the browser's storage (no `localStorage`, no IndexedDB), ships no service
  worker and has no autosave in the browser (`ui-egui/src/app/files.rs` `auto_save_tick`: off on
  `wasm32`). It renders with wgpu: WebGPU where the browser has it, else WebGL2; `?webgl` forces
  WebGL2. The tests run without it.

**Opening**

- A dropped `.figcraft`, `.fig`, `.sketch` or `.json` opens as a document of its own in a new tab,
  which becomes the active one, behind an "Opening as a new file" card
  (`ui-egui/src/canvas/input.rs` `import_dropped`, `open.rs` `is_document`). Images and SVG
  dropped on the canvas are placed into the open document instead; on the Home screen they open
  as documents too. The drop handler does not check `isTrusted`.
- The document's name follows `engine/src/cmd/file/load.rs` `load_with`: an image or SVG is named
  after the file's stem; a `.fig` after `file_name` in its `meta.json`, else the stem; a native
  file (a zip with `document.json`, or that JSON alone) keeps the name stored in it, unless that
  is empty or `Untitled`, which takes the stem. So `glass-and-vectors.figcraft` that stores
  `Glass and vectors` opens as `Glass and vectors`.
- File > Open… (Ctrl+O) clicks a hidden `<input type="file">` whose `accept` lists FigCraft's
  types, `.json` among them (`web.rs` `pick_file`), and opens whatever file is picked as a
  document. Import from file… and Place image… have their own lists, without `.json`, and keep
  what they read inside the open document.

**Saving**

- In the browser, Save and Save As (Ctrl+S, Ctrl+Shift+S, the main menu's File submenu) both go
  through `save_as_dialog` (`ui-egui/src/app/files.rs`): the document has no path, so
  `file.saveAs` with `data` returns the whole file, and the app downloads it as
  `<document name>.figcraft` (`engine/src/cmd/file/save.rs` `save_to`). A save is never an update
  of the opened bytes. The file is a zip with `document.json` (deflated, with the header
  `"format":"figcraft"`), `images/<sha256>`, an optional `thumbnail.png` and the version history.
- Every download goes through `web.rs` `download`: a Blob (`application/octet-stream`) behind an
  `<a download>` that is clicked and removed, its URL revoked after 40 s.
- Exports have other names or types: Export page as PNG (`<page name>.png`), the Export… dialog
  (PNG, JPG, WebP, SVG, PDF, XML, `.fig`), Export frames to PDF… (`<document name>.pdf`), a zip
  for several layers. File > Duplicate makes a new tab named `<name> (Copy)`.
- New documents are named `Untitled` (a board: `Untitled board`), so they save as
  `Untitled.figcraft`. A file stores no identity of its document (no id, no creation time).

**Language**

- The interface language comes from the preference `system`, which reads `navigator.language`
  (`web.rs` `system_language`, `ui-egui/src/i18n.rs` `resolve`), and Spanish of a Latin American
  region (or `US`) shows `es-419`. A language picked in the app lasts for the page; nothing is
  stored.
- The web build shows a language only if it has a font for its script (`ui-egui/src/cjk.rs`
  `can_show`): `bn`, `ja`, `ko`, `th` and `zh-Hans` start in English. Checked in Chromium with each
  of the 22 catalogs: `en`, `cs`, `de`, `es`, `es-419`, `fi`, `fr`, `id`, `it`, `ka`, `nl`, `pl`,
  `pt-BR`, `ru`, `sv`, `tr` and `vi` show properly.

## How the adapter classifies

`savedName` gives the name a save of the opened file gets: `<document name>.figcraft`, with the
document name worked out as `load_with` does (above). Saves under that name reach `classify`
with the opened file's record. If the name is not the opened one (a document named otherwise
than its file, or another type such as `.fig`), the host keeps the opened file and stores the
saves in a new file next to it, which later saves replace ([protocol.md](../protocol.md#saves)).

`classify` returns `document` only if

1. the save has that name,
2. the name is not a new document's (`Untitled.figcraft`, `Untitled board.figcraft`),
3. no file from the user would save under it: the adapter watches the `files` getters of
   `DataTransfer` (a drop the user made, `isTrusted`; the core's simulated drop does not count)
   and of file inputs whose `accept` lists `.json` (File > Open…), and notes for each file both
   `<stem>.figcraft` and the name it would save under, and
4. the save is a FigCraft file (a zip whose `document.json` has the header).

Everything else is an `export`. Save rewrites the whole file, so there is no prefix to compare;
as with DesignCraft, the name and the type decide.

`language` maps the host's tag to the table above (`util.matchLanguage`; a Spanish tag of a
Latin American region becomes `es-419`, as in FigCraft) and sets it as the browser's language
with `util.preferLanguages` before the app's module runs.

## Known gaps

- An opened file whose document is named `Untitled` and that is itself named `Untitled.figcraft`
  saves as a new file each time: its saves cannot be told from a new document's.
- A document the app makes and names like the opened one saves as the document: one from a
  template whose name is the opened document's, or one the user renames in the app to that name.
  Duplicates are named `<name> (Copy)` and are not affected.
- After the user opened or dropped a file whose document saves under the opened document's name,
  the opened document's own saves become new files too. An image or SVG with the same stem dropped
  onto the canvas counts as well, although FigCraft only places it into the open document.
- Should a release read dropped or picked files another way than through the `files` getters,
  such files go unnoticed. The `saved-as` test notices that.

## Hosting notes

- FigCraft's `README.md` (in the web build) allows cross-origin iframes and asks for no special
  headers (no COOP/COEP, no `SharedArrayBuffer`). It asks not to send `X-Frame-Options: DENY` or
  a `frame-ancestors` that excludes the embedding page.
- The `.wasm` of 0.12.1 is 15 MB (about 6 MB with gzip). Its name carries a content hash; only
  `index.html` needs revalidation. Nothing besides the usual Trunk layout (`index.html`,
  `figcraft-web-<hash>.js`, `figcraft-web-<hash>_bg.wasm`, `snippets/`) is served. The default
  startup timeout fits.
- `?webgl` forces WebGL2, `?control` installs `window.figcraft` (the page's control channel),
  `#join=` joins a live session. The configured app URL must have none of them; the adapter adds
  none.
- Live sessions over `ws://` are blocked from an `https://` page except to the same computer.
  That does not touch opening and saving.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `figcraft` | the document; Save replaces the file, or, if its document is named otherwise, a new file next to it | yes | yes: no other app opens it |

Nextcloud 34 and 35 do not know `.figcraft`; for the FigCraft icon in Files the Nextcloud app
registers `application/x-figcraft`, the type FigCraft's packaging names
(`packaging/linux/ai.storyteller.figcraft.mime.xml`; [nextcloud-app.md](../nextcloud-app.md#file-type-icons)).

Not offered: `.fig` (Figma files) and `.sketch` open as new documents and save as a new
`.figcraft` next to them, which would work with the adapter as it is, but FigCraft's own
packaging claims neither (its import is best effort), and the tests have no such files. `.json`
is too general, and images and SVG belong to other apps (FigCraft places them into a document).

## Tests

`figcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`figcraft-chromium` and `figcraft-webkit` (the latter non-blocking until it has passed on a
GitHub runner). The behaviour the core shares with every app is tested in `translator.spec.ts`
and `pdfcraft.spec.ts`; this spec checks what depends on FigCraft. Its header lists the tests:

| Test | What it checks |
|---|---|
| `contract` | The handshake with the served app version and the open of `craftsuite-probe.figcraft`; a duplicated frame saved with Ctrl+S arrives as the document, and Save As (Ctrl+Shift+S) after another edit too; Export frames to PDF (actions palette) and the save of a new document (Ctrl+N) arrive as new files; nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | A file whose document is named otherwise saves under the document's name, as the document, twice; a document stored as `Untitled` takes the file's name; `Untitled.figcraft` saves as a new file; a document from the disk (File > Open…) that saves under the opened name is a new file; the "+ New" blank opens and its first save is the document. |
| `language` (`@language`) | The host's `de` reaches the frame as `navigator.language`, `ready` reports `de`, and the actions palette runs `Speichern` (File > Save only in German). |
| `ui` (`@ui`) | The main menu with the pointer: File > Save saves the document; Export page as PNG in the right panel arrives as a new file. |

The steps use FigCraft's shortcuts (`engine/src/keymap.rs`: Ctrl+A, Ctrl+D, Ctrl+S,
Ctrl+Shift+S, Ctrl+N, Ctrl+O) and its actions palette (Ctrl+K), which runs the command whose label
matches in the interface language. Only the `ui` test clicks with the pointer; its positions are
in the spec's `AT` table, measured on 0.12.1 at a 1400x900 viewport with the locale `en-US`.
When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing, the naming in `load_with`, Save going through `save_as_dialog`, the download helper or
  the file format. The rules fail towards new files: a save under a name the adapter does not
  expect arrives as an `export`.
- **Only the `@ui` test fails.** A menu item or the right panel moved: re-measure `AT`.

The fixture `fixtures/figcraft/craftsuite-probe.figcraft` is written by its `make-fixtures.mjs`:
the document `craftsuite-probe` with one frame named `CRAFTSUITE-PROBE-fg01`, in the fields
FigCraft 0.12.1 writes. The spec makes the other files it opens from it.

## Upstream

FigCraft has a control channel for the page, `window.figcraft` (`?control`, `web.rs`
`api.rs`): `openFile(name, bytes)`, `captureDownloads(true)` and `readFile(name)` would let a
host open and save without drops and downloads, but only from the app's own origin, as with
PdfCraft's bridge ([architecture.md](../architecture.md#native-embedding-apis)). Worth asking
upstream: a document identity in `document.json` (a new document could then be told from the
opened one), and a way to keep the opened file's name for its saves in the browser, as the
desktop app keeps the path.
