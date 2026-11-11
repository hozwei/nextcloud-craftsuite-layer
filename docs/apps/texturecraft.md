<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# TextureCraft

| | |
|---|---|
| Upstream | [github.com/storytold/texturecraft](https://github.com/storytold/texturecraft) |
| Adapter | [`translators/texturecraft.js`](../../translators/texturecraft.js) |
| Tested version | `tested` in [`apps.json`](../../apps.json) (0.5.0 when this page was written) |
| Tests | [`tests/e2e/specs/texturecraft.spec.ts`](../../tests/e2e/specs/texturecraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the TextureCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.5.0
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source references
are to the `v0.5.0` tag; `web.rs` is `apps/texturecraft-web/src/web.rs`, the other paths are under
`crates/`.

TextureCraft paints textures and materials onto 3D models. It joins the layer with 0.5.0, its first
release with a web build; `minVersion` is 0.5.0.

## What the web build does

**Starting**

- `index.html` is Trunk's loader: it preloads the 20 MB `.wasm` (which holds back `load`), imports
  the glue, awaits the module and dispatches `TrunkApplicationStarted`. Then, before eframe
  starts, it bakes its sample project, `Material Ball` (`web.rs` `initial_session`): eframe
  registers its drop listener on `canvas#texturecraft_canvas` about 10 s after
  `TrunkApplicationStarted` on a fast machine. The core's default of 3 s for the drop target is
  too short; the adapter waits as long as the whole start (`dropTargetTimeout`, the startup
  timeout, 60 s by default).
- Over the sample it shows a start window (New project…, Open…, Continue with the sample project);
  it stays open when a file is opened, and keys and the pointer still reach the app behind it.
- It renders with wgpu: WebGPU where the browser has it, else WebGL2 with a notice at the top;
  `?webgl` forces WebGL2. It ships no service worker and has no autosave in the browser. It keeps
  its interface settings in `localStorage` (below) and nothing of the project.

**Opening**

- A dropped file (`ui-egui/src/web_files.rs` `dropped`, `load`): a `.tcraft` project or a mesh
  (`.glb`, `.gltf`, `.fbx`, `.dae`, `.usd`, `.usda`, `.usdc`, `.usdz`, `.abc`, `.obj`, `.ply`,
  `.stl`) replaces the project, after asking to save unsaved changes; images import as resources
  of the open project, materials (`.tcmat`, `.mcmat`, `.mcraft`) as layers of it. The drop handler
  does not check `isTrusted`.
- A `.tcraft` keeps the name stored in its `project.json`; a mesh makes a new project named after
  the file's stem, at 1024 x 1024 (`MESH_RESOLUTION` on the web).
- File > Open… (Ctrl+O) opens rfd's file input, whose `accept` lists the project and mesh types,
  `.tcraft` among them. Import resources, Import material and the bake and HDR pickers have their
  own lists, without `.tcraft`, and keep what they read inside the project.

**Saving**

- In the browser, Save, Save as and Save a copy (Ctrl+S, Ctrl+Shift+S, the File menu) all go to
  `web_files.rs` `save_project`: the whole project downloads as `<name>.tcraft`, where `<name>` is
  the project's name made file-safe (`formats/src/export/mod.rs` `sanitize_file_stem`: every
  character but ASCII letters, digits, `_`, `.` and `-` becomes `_`, at most 200; nothing but dots
  becomes `texture`; a Windows device name gets a leading `_`). A save is never an update of the
  opened bytes.
- The file is a zip (ZIP64 entries) with `project.json` (the project as JSON, its `name` among the
  fields), the painted pixels, the baked maps, the mesh file if it is not a built-in one and the
  imported resources (`formats/src/project_file/mod.rs`).
- Every download goes through `web_files.rs` `download`: a Blob behind an `<a download>` that is
  clicked and removed, its URL revoked after 10 s.
- Exports have other names or types: Export Textures… (a PNG per map, or
  `<project>_textures.zip`), Export Mesh… (`<project>.glb`, `.usdz` or `.obj`).
- New projects are named `Untitled` (New project…, File > Close), the sample `Material Ball`, so
  they save as `Untitled.tcraft` and `Material_Ball.tcraft`. A project file stores no identity of
  its project (no id, no creation time).

**Language**

- On the first start the interface language follows `navigator.language` (`ui-egui/src/i18n.rs`
  `os_language`; `pt` gives `pt-BR`, `zh` `zh-Hans`). The app then writes its interface settings
  as JSON to `localStorage` `ui.json`, with `prefs.language` the language it started in, reads
  them back to check the write, and from then on starts in the stored language
  (`ui-egui/src/lib.rs` `new`, `ui_state_store.rs`). A stored state without a language means
  English, not the browser's (`state.rs` `Prefs`).
- Its catalogs: `en`, `fr`, `de`, `es`, `pt-BR`, `it`, `ja`, `zh-Hans`, `ko`, `ar`. The web build
  carries fonts for Japanese and Arabic; `ko` and `zh-Hans` show no letters there (checked in
  Chromium), so the adapter leaves them out.

## How the adapter classifies

`savedName` gives the name a save of the opened file gets: for a `.tcraft`, its stored project
name, made file-safe as above, with `.tcraft`; for anything else the file's stem, made file-safe,
with `.tcraft`. Saves under that name reach `classify` with the opened file's record. If the name
is not the opened one (a mesh, a project named otherwise than its file, or a file name with
spaces or other characters TextureCraft replaces), the host keeps the opened file and stores the
saves in a new file next to it, which later saves replace ([protocol.md](../protocol.md#saves)).

`classify` returns `document` only if

1. the save has that name,
2. the name is not a new project's (`Untitled.tcraft`, `Material_Ball.tcraft`),
3. no file from the user would save under it: the adapter watches the `files` getters of
   `DataTransfer` (a drop the user made, `isTrusted`; the core's simulated drop does not count)
   and of file inputs whose `accept` lists `.tcraft` (File > Open…), and notes for each file both
   `<stem>.tcraft` and the name it would save under, and
4. the save is a TextureCraft project (a zip with a readable `project.json` with a name).

Everything else is an `export`. Save rewrites the whole project, so there is no prefix to
compare; as with FigCraft, the name and the type decide.

`language` maps the host's tag to the eight languages above (`util.matchLanguage`) and sets it as
the browser's language with `util.preferLanguages`, which the first start reads. Because the app
stores the language it started in and keeps it, the adapter also keeps, under a `localStorage` key
of its own (`craftsuite-layer:texturecraft:language`), the language it had the app start in. While
the stored language is that one, the app reads the host's language instead (the adapter's
`Storage.getItem` gives `ui.json` with the host's language; what the app wrote in the host's
language reads back as written). A language the user picks in TextureCraft is another one: when
the app writes it, the adapter's key goes, and from then on the app's own rule applies, as for a
language stored before this adapter. `language` then returns `null`, so `ready` reports none.

## Known gaps

- A file whose name TextureCraft would not write, such as `Wood crate.tcraft` (a space), saves as
  `Wood_crate.tcraft`, which the host stores next to it; so does the "+ New" file under its default
  name, `New TextureCraft project.tcraft`, whose first save makes `New_TextureCraft_project.tcraft`
  next to the blank. Names of letters, digits, `_`, `.` and `-` save into the file itself.
- An opened project named `Untitled` or `Material Ball` saves as a new file each time: its saves
  cannot be told from a new project's.
- A new project the user names like the opened one saves as the document.
- After the user opened or dropped a file whose project saves under the opened project's name,
  the opened project's own saves become new files too (in TextureCraft that file replaced the
  opened project anyway).
- Should a release read dropped or picked files another way than through the `files` getters,
  such files go unnoticed. The `saved-as` test notices that.

## Hosting notes

- TextureCraft's `HOSTING.md` (in the web build) asks for `application/wasm`, compression and the
  usual caching; no COOP/COEP, no `SharedArrayBuffer`. WebGPU needs a secure context, else WebGL2.
- The `.wasm` of 0.5.0 is 20 MB. Its name carries a content hash; only `index.html` needs
  revalidation. Nothing besides the usual Trunk layout (`index.html`, `texturecraft-web-<hash>.js`,
  `texturecraft-web-<hash>_bg.wasm`, `snippets/`) is served. The default startup timeout fits on
  the machines tested (the sample bakes in about 10 s); a much slower machine needs a longer
  `--startup-timeout`, which the adapter's wait for the drop target follows.
- `?webgl` forces WebGL2. The configured app URL must not have it; the adapter adds nothing.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `tcraft` | the project; Save replaces the file, or, if its project saves under another name, a new file next to it | yes | yes: no other app opens it |

Nextcloud 34 and 35 do not know `.tcraft`; for the TextureCraft icon in Files the Nextcloud app
registers `application/x-texturecraft`, the type TextureCraft's packaging names
(`packaging/linux/ai.storyteller.texturecraft.mime.xml`; [nextcloud-app.md](../nextcloud-app.md#file-type-icons)).

Not offered: meshes (`.glb`, `.obj`, `.fbx`, …) open as a new project that saves as a new
`.tcraft` next to them, which would work with the adapter as it is, but they are models, not
TextureCraft documents, other programs edit them, and a click on one should not open a texture
painter. Images and materials belong to other apps.

## Tests

`texturecraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`texturecraft-chromium` and `texturecraft-webkit` (the latter non-blocking until it has passed on a
GitHub runner). The behaviour the core shares with every app is tested in `translator.spec.ts`
and `pdfcraft.spec.ts`; this spec checks what depends on TextureCraft. Its header lists the tests:

| Test | What it checks |
|---|---|
| `contract` | The handshake with the served app version (no startup error while the sample bakes) and the open of `craftsuite-probe.tcraft`; an edit saved with Ctrl+S arrives as the document, and Save as (Ctrl+Shift+S) after another edit too; the save of the new project File > Close leaves (`Untitled.tcraft`) arrives as a new file; nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `saved-as` | A file whose project is named otherwise (with a space) saves under that name made file-safe, as the document, twice; `Untitled.tcraft` saves as a new file; a project from the disk (File > Open…) that saves under the opened name is a new file; the "+ New" blank, stamped for `blank.tcraft`, opens and its first save is the document. |
| `language` (`@language`) | The host's `de` reaches the frame as `navigator.language`, `ready` reports `de`, and TextureCraft stores `de`; at the next start the host's `fr` replaces it; a language the user picked (`it`) stays, and `ready` reports none. |
| `ui` (`@ui`) | The menu bar with the pointer: File > Save saves the document; File > Export Mesh… > Wavefront OBJ arrives as a new file. |

The edit is Layers > Instantiate across texture sets (Ctrl+Shift+D): the selected layer, the
fixture's marker layer, gets one more linked instance each time. Under a Mac user agent (WebKit's)
egui takes Cmd for Ctrl, so the spec presses the key the user agent calls for. TextureCraft opens
a dropped file a few frames later; the spec waits until the Layers panel changes. The `saved-as`
and `language` tests start the app several times and are marked slow. Only the `ui` test clicks
with the pointer; its positions are in the spec's `AT` table, measured on 0.5.0 at a 1400x900
viewport with the locale `en-US`. When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing, the project name in `project.json`, `save_project` and its file-safe names, the
  download helper or the file format. The rules fail towards new files: a save under a name the
  adapter does not expect arrives as an `export`.
- **The `language` test fails.** The settings moved (another key, field or format): the adapter's
  `followHost` must follow.
- **Only the `@ui` test fails.** A menu item or the Export mesh window moved: re-measure `AT`.

The fixture `fixtures/texturecraft/craftsuite-probe.tcraft` is written by its `make-fixtures.mjs`:
the project `craftsuite-probe` on the built-in material ball at 256 x 256, with one paint layer
named `CRAFTSUITE-PROBE-tx01`, in the fields TextureCraft 0.5.0 writes (a plain zip; TextureCraft
reads it as it reads its own ZIP64 saves). The spec makes the other files it opens from it.

## Upstream

Worth asking upstream: the opened file's name for its saves in the browser (as the desktop app
keeps the path), instead of the file-safe project name; a project identity in `project.json`; a
way to skip the sample bake when a file is about to be opened.
