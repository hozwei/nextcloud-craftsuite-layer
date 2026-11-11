<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# MaterialCraft

| | |
|---|---|
| Upstream | [github.com/storytold/materialcraft](https://github.com/storytold/materialcraft) |
| Adapter | [`translators/materialcraft.js`](../../translators/materialcraft.js) |
| Tested version | `tested` in [`apps.json`](../../apps.json) (0.3.0 when this page was written) |
| Tests | [`tests/e2e/specs/materialcraft.spec.ts`](../../tests/e2e/specs/materialcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the MaterialCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.3.0
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source references
are to the `v0.3.0` tag, under `crates/`; `web_files.rs` is `ui-egui/src/web_files.rs`.

MaterialCraft builds procedural materials from node graphs, in packages compatible with
Substance's SBS format. It joins the layer with 0.3.0, the release it was found with; `minVersion`
is 0.3.0.

## What the web build does

**Starting**

- `index.html` is Trunk's loader: it preloads the 14 MB `.wasm` (which holds back `load`), imports
  the glue, awaits the module and dispatches `TrunkApplicationStarted`. eframe registers its drop
  listener on `canvas#materialcraft_canvas` a fraction of a second later; the core's defaults fit.
- The app starts with a new package, `Untitled package`, and its Home window over it; the window
  stays open when a file is opened, and keys and the pointer still reach the app behind it. It
  can hold several packages at once (the explorer at the top left lists them).
- It ships no service worker and has no autosave in the browser. It keeps its interface settings
  in `localStorage` (below) and nothing of the packages.

**Opening**

- A dropped package (`.mcraft`, `.sbs`, or the zip of an SBS download) opens as a package of its
  own and becomes the active one (`web_files.rs` `load_now`, `engine/src/file_cmds.rs`
  `open_bytes`). Its path is the file's name (`<stem>.sbs` for `<stem>_sbs.zip`), unless reading
  it gave warnings; then it has none. A package whose path is open already is only activated.
  Images and meshes dropped go into the active package. The drop handler does not check
  `isTrusted`.
- File > Open… (Ctrl+O) opens rfd's file input for `.sbs`, `.mcraft` and `.zip`.

**Saving**

- Save (Ctrl+S, File menu) of a package with a path downloads it at once under that path
  (`web_files/package_save.rs`): a `.mcraft` path as `<name>.mcraft`, a zip with `package.sbs`
  (the package as SBS XML) and its resources; an `.sbs` path as `<stem>_sbs.zip`, a zip with
  `<stem>.sbs` and its resources. A save is never an update of the opened bytes.
- Without a path, and always for Save as (Ctrl+Shift+S), MaterialCraft asks in a `Save package`
  window: a name (the package's identifier at first) and a type, `SBS XML Package (*.sbs)` or
  `MaterialCraft Project (*.mcraft)` (preselected when the path is a `.mcraft`), and downloads
  `<name>.mcraft` or `<name>_sbs.zip` with its Download button. Save as then takes the new path.
- Every download goes through `web_files.rs` `download`: a Blob behind an `<a download>` that is
  clicked and removed, its URL revoked after 10 s.
- Exports have other names or types: Export material (`<graph>.mcmat`), Export outputs (images, or
  `<graph>_outputs.zip`).
- New packages are named `Untitled package`, the sample `Atomic sample`. A package file stores no
  identity of its package.

**Language**

- The interface language is the one stored with the interface settings, which eframe keeps as
  RON in `localStorage` `ui` (`prefs:(language:"…"`, `ui-egui/src/material_craft_app.rs`,
  `state/prefs.rs`), else the browser's (`ui-egui/src/i18n.rs` `os_language`). The app writes the
  settings with the language it started in, and from then on starts in that one.
- Its catalogs: `en` and `ar`. Arabic shows in the web build (checked in Chromium).

## How the adapter classifies

`savedName` gives the name a save of the opened file gets: the opened name for a `.mcraft` (and
for a `<stem>_sbs.zip`), `<stem>_sbs.zip` for an `.sbs`. Saves under that name reach `classify`
with the opened file's record. If the name is not the opened one (an `.sbs`), the host keeps the
opened file and stores the saves in a new file next to it, which later saves replace
([protocol.md](../protocol.md#saves)).

`classify` returns `document` only if

1. the save has that name,
2. the name is not a new package's (`Untitled package` or `Atomic sample`, as `.mcraft` or
   `_sbs.zip`), and
3. the save is a MaterialCraft save of that kind: a zip with `package.sbs` for a `.mcraft`, with
   `<stem>.sbs` for a `<stem>_sbs.zip`.

Everything else is an `export`. Save rewrites the whole package, so there is no prefix to compare;
as with FigCraft, the name and the type decide. A file from the user's disk with the opened name
does not open as a package of its own (MaterialCraft only activates the opened one), so the
adapter need not watch the user's files.

`language` maps the host's tag to `en` or `ar` (`util.matchLanguage`) and sets it as the browser's
language with `util.preferLanguages`, which the first start reads. As with
[TextureCraft](texturecraft.md#how-the-adapter-classifies), the adapter keeps the language it had
the app start in under a key of its own (`craftsuite-layer:materialcraft:language`); while the
stored language is that one, the app reads the host's language instead (in the RON, only
`prefs.language` changes). A language the user picks in MaterialCraft (Edit > Preferences) drops
the adapter's key and stays; `language` then returns `null`.

## Known gaps

- An opened package file named `Untitled package.mcraft` or `Atomic sample.mcraft` saves as a new
  file each time: its saves cannot be told from a new package's.
- Another package (a new one, or one from the disk) saved through `Save package` under the opened
  file's name and type saves as the document: the user chose that name.
- A file that read with warnings has no path: its saves go through `Save package`, under the
  package's identifier, and so mostly as new files.

## Hosting notes

- MaterialCraft's `HOSTING.md` (in the web build) asks for `application/wasm`, compression and the
  usual caching; no COOP/COEP, no `SharedArrayBuffer`.
- The `.wasm` of 0.3.0 is 14 MB. Its name carries a content hash; only `index.html` needs
  revalidation. Nothing besides the usual Trunk layout (`index.html`, `materialcraft-web-<hash>.js`,
  `materialcraft-web-<hash>_bg.wasm`, `snippets/`) is served. The default startup timeout fits.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `mcraft` | the package; Save replaces the file | yes | yes: no other app opens it |

Nextcloud 34 and 35 do not know `.mcraft`; for the MaterialCraft icon in Files the Nextcloud app
registers `application/x-materialcraft`, the type MaterialCraft's packaging names
(`packaging/linux/ai.storyteller.materialcraft.mime.xml`; [nextcloud-app.md](../nextcloud-app.md#file-type-icons)).

Not offered: `.sbs` opens, but saves as `<stem>_sbs.zip` (the SBS with its resources) next to it,
never as an `.sbs`, and MaterialCraft's own packaging does not claim it; `.zip` is too general.

## Tests

`materialcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`materialcraft-chromium` and `materialcraft-webkit` (the latter non-blocking until it has passed on
a GitHub runner). The behaviour the core shares with every app is tested in `translator.spec.ts`
and `pdfcraft.spec.ts`; this spec checks what depends on MaterialCraft. Its header lists the tests:

| Test | What it checks |
|---|---|
| `contract` | The handshake with the served app version and the open of `craftsuite-probe.mcraft`; an edit saved with Ctrl+S arrives as the document, and the next one too; a package from the disk (File > Open…) saves under its own name as a new file; nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | An opened `.sbs` saves as `<stem>_sbs.zip`, as the document, twice; `Untitled package.mcraft` saves as a new file; the "+ New" blank opens and its first save is the document. |
| `language` (`@language`) | The host's `ar` reaches the frame as `navigator.language`, `ready` reports `ar`, and MaterialCraft stores `ar`; at the next start the host's `en` replaces it; a language the user picked stays, and `ready` reports none. |
| `ui` (`@ui`) | Save as (Ctrl+Shift+S) and the pointer in the `Save package` window: Download as a MaterialCraft Project is the document; as an SBS XML Package it arrives as a new file. |

The edit is Select all (Ctrl+A) and Duplicate (Ctrl+D) in the open graph, which doubles its nodes.
Under a Mac user agent (WebKit's) egui takes Cmd for Ctrl, so the spec presses the key the user
agent calls for. MaterialCraft opens a dropped file a few frames later; the spec waits until the
explorer changes. Save as always asks in the `Save package` window, which only the pointer
operates reliably, so it is in the `ui` test; its positions are in the spec's `AT` table, measured
on 0.3.0 at a 1400x900 viewport with the locale `en-US`. When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing, the path a dropped package gets, `PackageSave`, the download helper or the file format.
  The rules fail towards new files.
- **The `language` test fails.** The settings moved (another key or format): the adapter's
  `followHost` must follow.
- **Only the `@ui` test fails.** The `Save package` window moved: re-measure `AT`.

The fixture `fixtures/materialcraft/craftsuite-probe.mcraft` is written by its `make-fixtures.mjs`:
the package `craftsuite-probe` with one material graph named `CRAFTSUITE_PROBE_mc01` holding one
Blur node, in the elements MaterialCraft 0.3.0 writes. The spec makes the other files it opens
from it.
