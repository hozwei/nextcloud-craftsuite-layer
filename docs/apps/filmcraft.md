<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# FilmCraft

| | |
|---|---|
| Upstream | [github.com/storytold/filmcraft](https://github.com/storytold/filmcraft) |
| Adapter | [`translators/filmcraft.js`](../../translators/filmcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.6.0 when this page was written) |
| Tests | [`tests/e2e/specs/filmcraft.spec.ts`](../../tests/e2e/specs/filmcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the FilmCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.6.0
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source references
are to the `v0.6.0` tag; `web/` is `apps/filmcraft-web/`, the other paths are under `crates/`.

## What the web build does

**Starting**

- The page is no Trunk build. Its own module script in `index.html` (`web/web/index.html:67-93`)
  imports `filmcraft_web.js`, awaits the `.wasm` and calls `start('filmcraft_canvas')`. It never
  dispatches `TrunkApplicationStarted`, so the core's timers that start with that event (the drop
  target timeout and `the app did not get ready in time`) never run.
- `start()` (`web/src/lib.rs:125-227`) first reads the browser's storage (below), then installs
  `window.filmcraft` and the drop listeners (`lib.rs:144-145`), then starts the graphics (eframe's
  `WebRunner`, `lib.rs:156-220`), and only then removes `#loading` (`lib.rs:224-226`). A file
  dropped in between is not lost: its opening waits for the graphics (`web/src/import.rs:22-32`).
  But if they never start, it waits forever, and the core, which sends `ready` at the first `drop`
  listener, would report a frame that can take files.
- If the start fails, the page writes `FilmCraft failed to start:` and the error into `#status`
  with class `err` (`index.html:88-89`). If the error names the graphics (`wgpu`, `surface`,
  `WebGPU`, ...), it first reloads itself once with `?webgl` added to its query
  (`index.html:84-86`). With neither WebGL2 nor WebGPU the second start fails as well.
- The interface language follows the browser's `navigator.languages`, read on the first frame
  (German, Spanish, French, Japanese, ...). A Chinese browser gets English: the web build has no
  Chinese font. See [Interface language](#interface-language); the tests pin `en-US`.

**Storage in the browser**

- While the open project has unsaved changes, FilmCraft writes a snapshot of it every few seconds
  to the origin's private file system (OPFS), `recovery/snapshot.fcproj` with
  `recovery/meta.json` (`web/src/recovery.rs`). At the next start it reopens a snapshot that is
  still marked unsaved (`lib.rs:141`, `:173-183`).
- Every media file it imports (up to 4 GiB) is copied to OPFS as `media/<name>`
  (`recovery.rs:23`, `:100-111`) and never deleted. At every start each copy is registered again
  under `/files/<name>` (`recovery.rs:114-121`) and listed in the Media Browser, so the same file
  imported again gets the name `<stem> (2).<ext>` (`web/src/fs.rs:76-100`) and a second copy.
- FilmCraft's own query flag `fresh` skips both at the start (`lib.rs:139-141`); `norecover`
  skips only the snapshot. The adapter adds `fresh` (see
  [How the adapter classifies](#how-the-adapter-classifies)). The snapshots are still written,
  and the copies still made; only nothing from an earlier session comes back.
- FilmCraft uses no `localStorage` (eframe's persistence is not enabled, `web/Cargo.toml:28`),
  although `HOSTING.md` says preferences are kept there. The web build keeps its preferences, the
  interface language among them, in memory only (see [Interface language](#interface-language)).

**Opening**

- The drop listeners are on `window`, in the capture phase (`import.rs:235-250`), and do not check
  `isTrusted`, so the translator's simulated drop works like a user's drop. As the listener is not
  on an element, the core drops onto the first `<canvas>`, FilmCraft's `canvas#filmcraft_canvas`;
  the adapter needs no `dropTarget`.
- A dropped file whose name ends in `.fcproj` (any letter case) is read whole, put at
  `/projects/<file name>` and opened as the project (`import.rs:136-156`). It replaces the open
  project without asking, also one with unsaved changes (`engine/src/commands.rs:1200-1203`).
- Every other file is imported into the open project, not opened: media as a `Blob` read in
  chunks (`fs.rs`), interchange files (EDL, XML, FCPXML, OTIO, AAF, OMF, captions) as new items of
  the project. There is always a project open: the demo project `FilmCraft Demo`, which FilmCraft
  opens at every start (`lib.rs:147`, `:184-186`; `?empty` would make it an empty `Untitled`).
- Projects refer to their media by path (`/files/<name>` on the web) and do not contain them. The
  host sends one file per frame, so a project opened from Nextcloud cannot find its media unless
  the user drops them onto the frame (Link Media > Locate… uses a file picker, see below).
- FilmCraft refuses a project from a newer schema or one it cannot read
  (`format/src/lib.rs:178-258`) with a message in its status bar and keeps the project it had
  open.
- File > Open Project… (Ctrl+O), Import… (Ctrl+I) and Link Media > Locate… use the File System
  Access picker where the browser has it (Chromium), else an `<input type=file>`
  (`import.rs:184-230`). Chromium does not show that picker in a frame of another origin
  (`SecurityError`), so in Chromium these commands do nothing inside the editor; in WebKit and
  Firefox the file input works. A drop from the desktop works in every browser.
- There is no `?file=`. `window.filmcraft` (`web/src/api.rs:119-217`) is an automation API on the
  page itself (`execute`, `request`, `importFiles`, `openProject`, `files`, `info`, ...), without
  `postMessage` or an origin check: the host cannot reach it. The tests use it (see [Tests](#tests)).
- There is no JavaScript-visible signal that a file was opened or refused, and none for unsaved
  changes. The host only gets `delivered`.

**Saving and downloads**

- Every file FilmCraft writes goes through one helper (`fs.rs:338-353`, `:411-437`): a `Blob`
  typed `application/octet-stream`, `URL.createObjectURL`, an `<a download>` named after the part
  of the path after its last `/`, appended to `<body>`, clicked and removed; the URL is revoked
  after 60 s. Clicks are at least 125 ms apart (`web/src/download_pacing.rs`), so a burst (an image
  sequence) arrives as one save after another. There is no File System Access save.
- Save (Ctrl+S) of an opened project writes its path, `/projects/<opened name>`, at once and
  without a dialog (`engine/src/commands.rs:1178-1181`). Save of a project without a path (the
  demo, a new project) and Save As… (Ctrl+Shift+S) always ask the web's save hook for
  `<project name>.fcproj` (`ui-egui/src/lib.rs:1219-1225`), which answers `/projects/<that>`
  without a dialog (`import.rs:265`). Save a Copy… (Ctrl+Alt+S) writes `<project name> copy.fcproj`.
- Save and Save As rename the project after the file's stem (`commands.rs:3804-3822`); Save a Copy
  renames nothing and leaves the project's path as it was. So for an opened `craftsuite-probe.fcproj`
  that stores the name `Probe Title`, Ctrl+S writes `craftsuite-probe.fcproj` (and the project is
  `craftsuite-probe` from then on), while Save As first writes `Probe Title.fcproj`.
- Every save is the whole project as compact JSON:
  `{"format":"filmcraft.project","schema_version":15,"generator":"FilmCraft 0.6.0","project":{...},"view":{...}}`
  (`format/src/lib.rs:158-171`), never an update of the opened bytes. Only Save, Save As and Save
  a Copy add the editor view (`view`).
- The first Save of a project opened in an older schema first writes the original bytes as
  `<stem> (schema vN backup).fcproj` (`commands.rs:3826-3835`, `:3847-3850`), then the project in
  the current schema. Older schemas are upgraded on opening.
- New projects are named `Untitled` (File > New > Project…, Ctrl+Alt+N, without a dialog,
  `commands.rs:844-856`; Close Project, `clip_ops.rs:828`), the demo project `FilmCraft Demo`
  (`engine/src/demo.rs:45`, `:52`), not translated. A project stores no identity: no GUID, no
  creation time (`project/src/lib.rs:1229-1260`; the items' `created` fields are counters).
- On Windows and Linux the shortcuts are the Ctrl ones (`Cmd` is Ctrl there,
  `engine/src/shortcut_presets.rs:5-6`; the File shortcuts are at `:66-75`). The tests press
  Ctrl, also in WebKit with Safari's user agent.
- The downloads below were checked in Chromium and WebKit; `<project>` is the project's name.

| Download | Name | Kind |
|---|---|---|
| Save (Ctrl+S) of the opened project | the opened name, the whole project | `document` |
| Save As… (Ctrl+Shift+S) of the opened project | `<project>.fcproj`: before the first Save the name stored in the file, after it the opened name | `document` |
| The backup on the first Save of an older schema | `<stem> (schema vN backup).fcproj`, the opened bytes | `export` |
| Save a Copy… (Ctrl+Alt+S) | `<project> copy.fcproj`; for an opened `<name> copy.fcproj` that still stores `<name>`, the opened name | `export` |
| Save of a new project (Ctrl+Alt+N) or the demo project | `Untitled.fcproj`, `FilmCraft Demo.fcproj`, also when that is the opened name | `export` |
| Save of a project the user dropped or opened from the disk | its name, which may be the opened one | `export` |
| File > Export > EDL…, Final Cut Pro XML…, FCPXML…, OpenTimelineIO…, AAF…, OMF… | `<sequence>.<ext>` (EDL of the demo: `Main Edit.edl`), lossy re-encodings with export reports | `export` |
| File > Export > Avid Log Exchange…, Markers CSV | `<project>.ale`, `<sequence>.csv` | `export` |
| File > Export > Selection as FilmCraft Project… | `<project> Selection.fcproj` (`ui-egui/src/panels/menu_dialogs.rs:215`; `Selection` is translated in some UI languages, see [Interface language](#interface-language)), the selected items stored under that stem, without `view`; for an opened `<name> Selection.fcproj` that stores `<name>`, the opened name | `export` |
| Export mode (Ctrl+M) and the export queue, Export Frame | the File Name field (default: the sequence's name) with the preset's extension; stills `png`, `jpg`, `tif`, `bmp` | `export` |
| Captions, presets, keyboard shortcuts, graphics templates, voice-over and narration WAVs, XMP sidecars | their own names | `export` |

**Links**

- Links open in a new tab (`ui-egui/src/links.rs:38-46`). Egui hyperlinks, such as those in the
  credits, may use target `_self`, which in a frame would replace the editor; the translator opens
  them in a new window instead. Opening or revealing a file's path hands it to the browser as a
  `file://` URL (`ui-egui/src/panels/menu_dialogs.rs:113-128`), which the translator does not open.

## How the adapter classifies

**Start.** The adapter's `started()` resolves once `#loading` is gone, so the host gets `ready`
only when the graphics run. It rejects with `the app failed to start: <the text of #status>` when
`#status` has class `err`, and with `the app did not start in time` after 120 s: the core's own
deadline after the start needs `TrunkApplicationStarted`. Before the drop listeners exist, the
core's checks still apply (`the app failed to load`, and `the app did not start in time` after
`data-startup-timeout`). The `?webgl` reload navigates the frame before `ready`; the translator
starts again and the host sees a second `hello`.

**Flags.** Before FilmCraft's module reads the address, the adapter adds `fresh` to the frame's
query with `history.replaceState`, after whatever query the address has, unless it is there
already; the reload with `?webgl` keeps it. This happens only when the core is active (framed,
with an allowed origin configured, in a secure context); outside the integration FilmCraft keeps
its own behaviour. Without `fresh`, a project the host opens and FilmCraft refuses would leave an
earlier session's unsaved project open, which may have the opened file's name, and every reopened
media file would add another copy in OPFS. The Nextcloud app refuses an app address with a query,
so no address can turn the flag off or set other ones (such as `empty`).

**Saved name.** For an opened `*.fcproj` the adapter's `savedName` is the Save As name,
`<stored project name>.fcproj` (after the last `/`). It also records the opened file's schema as
FilmCraft detects it (`probe_version` and `check_supported` in `format/src/lib.rs`): an envelope
with an integer `schema_version` from 1 and a `format` that is missing or `filmcraft.project`, or a
bare project from before the envelope (`items` and `root`, `version` 0 to 2 meaning 1). Anything
else is no project FilmCraft opens. Other files keep their name.

**Project files from the user.** The adapter watches the `files` getters of `DataTransfer` (only
during a trusted `drop` event, so not the translator's own drop) and `<input type=file>`, and
`FileSystemFileHandle.getFile`. Once a `*.fcproj` came in this way, the open project may not be
the host's file any more, and no later save in this frame is `document`.

**Kinds.** The core calls `classify` for a download named like the opened file or its saved
name. The adapter returns `document` only if all of these hold, otherwise `export`:

- the opened file and the download are `*.fcproj`;
- the download's stem is not `Untitled` or `FilmCraft Demo`;
- no project file came from the user in this frame;
- the opened file was a project FilmCraft opens (a schema was recorded);
- the download is FilmCraft's envelope with `format` and a `view` object (Export Selection as
  Project writes none), in a schema not older than the opened file's (FilmCraft writes only its
  own; an older one is a save of what it had open after refusing a newer file);
- the project name stored in the download is the download's stem: Save and Save As rename the
  project after the file, Save a Copy does not.

Notes:

- A save is never an update of the opened bytes, so the prefix check of PdfCraft does not apply,
  and FilmCraft writes no identity to compare (no `identity`). The name, the envelope and the
  stored project name decide.
- FilmCraft's own format holds everything it models, so no save of an opened project is a `copy`
  (see [protocol.md](../protocol.md#copies)). Unknown fields of the same schema are not kept, as in
  any FilmCraft save.
- Save As before the first Save of an opened `x.fcproj` that stores `Name` arrives as `document`
  named `Name.fcproj` with the open's `openId`: the Nextcloud editor page stores it as a new file
  next to `x.fcproj` (picking a free name), and later saves replace that file (see
  [protocol.md](../protocol.md#saves)). A stored name that the translator has to change in the
  download name (a `\`, control or direction characters, leading dots or spaces, more than 200
  characters, see [protocol.md](../protocol.md#names)) no longer matches the stem, so that Save
  As arrives as an `export`; Ctrl+S is not affected.
- Save a Copy of an opened `Name copy.fcproj` that still stores `Name` (Save a Copy inside the
  integration makes such files) has the opened name but is a copy, so it arrives as an `export`.
  Ctrl+S afterwards renames the project to `Name copy` and is the `document`.
- Export Selection as Project of an opened `Name Selection.fcproj` that stores `Name` has the
  opened name, and the subset it writes stores that stem as its name
  (`engine/src/project_tools.rs:788-807`): only the missing `view` keeps this part of the project
  from replacing the whole file. It arrives as an `export`.
- The schema backup of an older file arrives as an `export` (a new file next to it), and the save
  after it as the `document`. Nextcloud's file versions, where enabled, keep the old state too.
- An opened media or interchange file is imported into the demo project. Its own name comes back
  only from an export (an EDL export of a sequence with the opened EDL's name), never as a save of
  it: `export`.

## Interface language

**How FilmCraft picks it.** From its preference Interface Language
(`general.interfaceLanguage`), by default `system` (`engine/src/settings.rs:36-39`, `:66`). The
web build never loads or stores preferences: they live in the session's memory
(`engine/src/lib.rs:360-362`, `:479-480`); only the desktop app calls `start_autosave`, which
reads `preferences.json` (`:536-552`). So every start is `system`, which means the browser's
`navigator.languages` (`web/src/lib.rs:189-191`). FilmCraft takes the first of them it has, by
the primary subtag (`ui-egui/src/i18n/mod.rs:91-123`): `de-AT` gives German, `fr-CA` French, any
Portuguese Brazilian Portuguese; a language it lacks (`it`) is skipped, and without a match the
interface is English. Chinese counts only for Simplified tags (`zh`, `zh-CN`, `zh-SG`,
`zh-Hans`), and the web build has no Chinese font (`ui-egui/src/cjk.rs:28-49`): FilmCraft then
shows English with `no Chinese font is installed on this system; the interface stays in English`
in its status bar, and tries no later language (`ui-egui/src/lib.rs:640-657`). Japanese renders.
The list is read on the first frame (`apply_prefs` from `frame`, `ui-egui/src/lib.rs:1582-1597`),
seconds after the translator ran, and again only when the preference changes. No query flag sets
the language (see [Hosting notes](#hosting-notes)), there is no `languagechange` listener, and
neither `navigator.language` nor `<html lang>` is read.

**What the adapter does.** Its `language` member gets the host's language
([protocol.md](../protocol.md#host-settings)) before FilmCraft's module runs, finds it in its
`LANGUAGES` table (the same tag, else the same language and script: `de-AT` finds `de`, `pt-PT`
finds `pt-BR`, `en-GB` finds `en`) and makes the frame report FilmCraft's code for it (`pt-br` for
`pt-BR`) as the browser's language: `navigator.language` returns it, and `navigator.languages`
starts with it, followed by the browser's own (getters on `Navigator.prototype`). FilmCraft's
first frame is already in that language. `ready` reports the tag it found. For any other
language, and without one, it changes nothing and reports `null`, so FilmCraft follows the
browser's languages, as outside the integration. A reloaded frame, also FilmCraft's own `?webgl`
reload, gets the language again: the core keeps it in the frame's name.

**Languages.** The Nextcloud app's settings offer the keys of `LANGUAGES`: `en`, `de`, `es`,
`fr`, `ja`, `pt-BR`, `ru` and `uk`, every language of FilmCraft 0.6.0's Edit > Language
(`ui-egui/src/menus.rs:25-33`) except Simplified Chinese. The web build refuses that one for want
of a font, so a start in it would be English with the message above.

**Partial translations.** Spanish, French and Japanese translate nearly the whole interface
(about 3,500 entries each in `ui-egui/src/i18n/<code>.tsv`). German, Brazilian Portuguese,
Russian and Ukrainian translate the menus only (about 350 entries each; their catalogs say so), and
everything else shows in English, such as `(no clips)` in the German interface. Names FilmCraft
gives files and projects (`Untitled`, `FilmCraft Demo`, `<project> copy.fcproj`,
`(schema vN backup)`) are not translated, so the classification does not depend on the language.
The one translated file name is the default of File > Export > Selection as FilmCraft Project…,
`<project> Selection.fcproj` (`ui-egui/src/panels/menu_dialogs.rs:215`): `Selección` in Spanish,
`Sélection` in French, `選択項目` in Japanese (`es.tsv:2744`, `fr.tsv:2746`, `ja.tsv:2734`). It
arrives as a new file in any language.

**A language the user picks.** Edit > Language (`ui-egui/src/menus.rs:25-33`, `:178-223`) and
Edit > Preferences > General… > Interface Language, which also has System Language
(`menus.rs:141`, `engine/src/settings.rs:766-782`), switch the interface at once. The web build
keeps the choice in memory: it lasts until the editor is closed or the frame reloads, and the
next start is in the host's language again (without one, in the browser's). System Language goes
back to the language the adapter set. The host is not told; `ready` reported the language
FilmCraft started in. Chinese is refused there too (no font). Outside the integration the web
build behaves the same; only FilmCraft's desktop app keeps the choice, in `preferences.json`.

## Known gaps

- **Projects named like FilmCraft's own.** A project file named `Untitled.fcproj` or
  `FilmCraft Demo.fcproj` is never saved back: every save of it is a new file (`Untitled (2).fcproj`,
  ...), because a new project's save looks the same and the format has no identity. Renaming the
  file in Nextcloud before opening it avoids that.
- **Project files from elsewhere, unnoticed.** The watch above relies on how FilmCraft 0.6.0 reads
  files from the user. Should a release read them another way, a project the user drops or opens
  from the disk under the opened file's name would pass as `document` and replace the Nextcloud
  file with its content.
- **Crash recovery.** FilmCraft's `#fatal` message promises that unsaved changes come back after a
  reload. In the integration they do not: `fresh` keeps the snapshot closed, and the host opens its
  file again. The snapshots and media copies stay in the origin's storage, for the next user of
  the same browser profile too, but nothing shows them while the translator is active. A hosting
  that wants them gone can send `Clear-Site-Data: "storage"` with FilmCraft's `index.html`, but
  that clears the whole origin's storage, other apps' and other FilmCraft tabs' included, so only
  for a FilmCraft on an origin of its own (see [hosting.md](../hosting.md)).
- **Media.** A project opened from Nextcloud cannot find its media (see Opening), and media opened
  from Nextcloud would only be imported into the demo project; the Nextcloud app does not offer
  them (see [File types](#file-types)). In Chromium, Link Media > Locate… does nothing in the
  frame; dropping the media file onto it relinks `/files/<name>` references.
- **Large files.** The host reads a file whole into memory and the core hashes it; renders are
  built in wasm memory (4 GiB at most) and travel to the host by `postMessage`.
- **No unsaved-changes signal.** FilmCraft shows unsaved changes only as `- Edited` in its header
  and asks nothing before the page unloads. The host must warn on close.
- **`delivered` is not "opened".** A project FilmCraft refuses shows a message in its status bar;
  the host only sees `delivered`, and the demo project stays open (its saves are new files).
- **Saved means downloaded.** FilmCraft marks the project saved when the download starts. If the
  host cannot store the file, the translator's fallback browser download is the copy the user
  keeps.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so FilmCraft
  cannot start there.

## Hosting notes

- FilmCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no special
  headers (no COOP/COEP; it uses no `SharedArrayBuffer`). It asks not to send
  `X-Frame-Options: DENY` or a `frame-ancestors` that excludes the embedding page. For a sandboxed
  iframe it needs at least `allow-scripts allow-same-origin allow-downloads allow-popups`.
- Besides `filmcraft_web.js` and the `.wasm`, the page loads `audio-worklet.js` at start
  (`web/src/audio.rs:59`); serve the whole folder.
- The `.wasm` file of 0.6.0 is 43.5 MB, 15.6 MB with gzip (`HOSTING.md` says about 13 MB and
  5 MB). Serve it compressed, preferably precompressed with Brotli.
- It renders with wgpu: WebGPU where the browser has it, else WebGL2 (the CPU compositor). With
  neither the host gets `the app failed to start: failed to create wgpu surface ...`. The tests run
  on WebGL2 (Chromium with SwiftShader, which offers no WebGPU adapter here, and WebKit).
- Query flags are query keys (`URLSearchParams.has`, `lib.rs:119-121`): `fresh`, `norecover`,
  `empty`, `webgl` and `cpu`; `nowebcodecs` is matched anywhere in the query
  (`web/src/webcodecs.rs:145`). The adapter adds `fresh`; the configured app address has no query.
  `HOSTING.md` lists only `webgl` and `cpu`.
- The loader is the page's own inline module script, not Trunk's. A `.wasm` that is missing or
  cannot be compiled rejects that script before the drop listeners exist, and the host gets
  `the app failed to load: ...`; a Content-Security-Policy that blocks the inline script leads to
  `the app did not start in time` (see [protocol.md](../protocol.md#errors)). A failure after the
  drop listeners (the graphics) is reported by the adapter.
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `fcproj` | the project; Save replaces the file (one named `Untitled` or `FilmCraft Demo` gets a new file per save, see [Known gaps](#known-gaps)) | yes | yes: no other app opens it |

Match the extension in any letter case, as FilmCraft does. Nextcloud 34 and 35 have no MIME type
for it (it arrives as `application/octet-stream`), so the app must pick FilmCraft by extension.
For the FilmCraft icon in Files the Nextcloud app registers `application/x-filmcraft` for it
([nextcloud-app.md](../nextcloud-app.md#file-type-icons)).

Do not offer anything else. Media (mp4, mov, webm, mkv, mxf, wav, mp3, ...) would only be
imported into the demo project, and only new files would come back: a project that cannot find
its media when opened from Nextcloud again, renders, EDLs. The Viewer and the Files player own
those types.
Interchange files (edl, xml, fcpxml, otio, aaf, omf, srt, vtt) import with offline media, and xml,
srt and vtt belong to text editors. `y4m` and `avi` are listed by FilmCraft but have no decoder.

## Tests

`filmcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`filmcraft-chromium` and `filmcraft-webkit`. The behaviour the core shares with every app
(fallback downloads, a foreign host, startup errors) is tested in `translator.spec.ts` and
`pdfcraft.spec.ts`; this spec checks what depends on FilmCraft.

The spec has four tests, and its header lists them with their scenarios. `contract` and `saved-as`
are the contract tests; the canary runs them apart from the `language` test (tagged `@language`) and
the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version; `ready` only after `#loading` was removed, while FilmCraft's drop listener came earlier (times recorded in the frame and the host page); the frame address `?ack=…&result=…&fresh`. The open of `craftsuite-probe.fcproj`, which stores `Probe Title`: a marker (M) saved with Ctrl+S arrives as the document under the opened name, with the edit and the fixture's notes, and so does the next Ctrl+S. Save a Copy (Ctrl+Alt+S) and a new project's save (Ctrl+Alt+N, Ctrl+S) arrive as new files. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. Without WebGL2 and WebGPU (blocked in the frame) the host gets `the app failed to start: failed to create wgpu surface ...` and no `ready`, after FilmCraft's reload to `?fresh&webgl`, although its drop listener was there. |
| `saved-as` | An opened `Probe Title Selection.fcproj` (the fixture under another name): File > Export > Selection as FilmCraft Project… of its sequence, named and stored like the opened file but without `view`, is a new file; Save As first: `Probe Title.fcproj` as the document, then Ctrl+S again. An opened `Probe Title copy.fcproj`: Save a Copy is a new file, Ctrl+S the document. `old-schema.fcproj` (schema 14): the backup with the opened bytes is a new file, the save in schema 15 the document. The blank of the Nextcloud app's "+ New" entry, `blank.fcproj` as in `craftsuite_layer/assets/` (an empty project storing `New FilmCraft project`), opens (`execute('project.inspect')`; `ui.elements` can stay unanswered after it), and its first Ctrl+S, without an edit, is the document. An opened `Untitled.fcproj` storing `FilmCraft Demo`: its Save As and a new project saved under the opened name are new files. An opened EDL: imported, and its EDL export and the demo project's save are new files. A project with the opened name from the user's disk (Chromium: a trusted drop; WebKit: Open Project with the file input): Ctrl+S is a new file. An earlier session's unsaved project named `corrupt` and an imported WAV in OPFS, then the host opens a `corrupt.fcproj` FilmCraft refuses: nothing of the earlier session comes back, Ctrl+S saves the demo project as a new file, and the WAV imported again keeps its name. |
| `language` | The host's language under the browser locale `en-US`: with `lang=de`, `ready` reports `de`, FilmCraft reports `de` as its interface language (`request('ui.inspect')`, polled: a request answered on its very first frame, before the frame applies the language, can still say `en`), File > Save is labelled `Speichern` (`request('ui.menu.list')`), and the open project is the opened `craftsuite-probe.fcproj` (`execute('project.inspect')`: `Probe Title` at `/projects/craftsuite-probe.fcproj`). |
| `ui` (`@ui`) | The File menu with the pointer, on the opened `craftsuite-probe.fcproj`: Save saves the document; Export > EDL… arrives as a new file. |

A test with several scenarios (`saved-as`) runs each in a page of its own and reports every
scenario that fails as `scenario failed: <title>`, not only the first. It is marked slow: it
loads the 43 MB app nine times. The scenario about OPFS runs where OPFS can be written; the tests'
WebKit (Playwright's WPE build) fails every OPFS call with `UnknownError`, also outside a frame, so
there FilmCraft keeps nothing between sessions and the test notes the scenario as skipped.

FilmCraft has no command palette. The tests use its keyboard shortcuts
(`engine/src/shortcut_presets.rs`), wait for what FilmCraft shows through `window.filmcraft`
(`request('ui.elements')`: the Project panel's `<project>.fcproj`, the open menus; `files()`: the
file a drop delivered), and run File > Export > EDL… and Selection as FilmCraft Project… in the
`saved-as` test with `window.filmcraft.execute('file.exportEdl')` and
`execute('file.exportSelectionProject')`, which go the menu item's way
(`ui-egui/src/control.rs:103-110`), after selecting the sequence as a click in the Project panel
does (`execute('project.select', …)`). Only the `ui` test clicks with the pointer. It clicks in
the middle of the rectangle `request('ui.elements')` reports for the File menu (`menu.File`), its
Save (`menu.file.save`) and the Export submenu's EDL… (`menu.file.exportEdl`), so a menu that
gains a row does not move the click (0.8.0 added Open Recent above Save). The `AT` table of the
spec has the fallback positions for a release that reports no rectangle, and the Export row,
which FilmCraft does not list; measured on 0.6.0 (Save again on 0.8.0) at a 1400x900 viewport
with the locale `en-US`. Only the `language` test sets a host language: German moves those menu
items, and Spanish, French and Japanese translate the name `saved-as` expects from Export
Selection as Project. When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the start
  (`#loading`, `#status.err`, the order in `web/src/lib.rs` `start()`), the drop routing
  (`import.rs`), the download helper (`fs.rs`), the save names and the renaming
  (`ui-egui/src/lib.rs:1219-1225`, `commands.rs:3804-3845`), the envelope and its `view`
  (`format/src/lib.rs`), the names `Untitled` and `FilmCraft Demo`, or the flag `fresh`. The rules
  fail towards new files, not towards overwriting: a save the adapter does not recognise arrives
  as an `export`. A renamed `#loading` fails as `the app did not start in time` after 120 s. Sites
  that host the app should hold the release back until the adapter is fixed. If only the waits
  fail (a warning `FilmCraft did not show: ...` in the report), `window.filmcraft` changed; fix the
  helpers in the spec.
- **The `language` test fails.** If FilmCraft does not report German, the release no longer
  starts in the first of `navigator.languages` it has (`web/src/lib.rs:189-191`,
  `ui-egui/src/i18n/mod.rs:91-123`, `ui-egui/src/lib.rs:640-657`), or a stored preference now wins
  over it: the adapter needs another way in. If it reports German but labels Save otherwise, or
  `project.inspect` answers otherwise, the test needs the new label or reply. Files open and save
  as before either way.
- **Only the `@ui` test fails.** A menu item moved that FilmCraft does not list (the Export row),
  or the report has the warning `FilmCraft lists no place for ...`: the element's id or
  rectangle changed. Re-measure the positions in `AT`, or fix the id
  (`window.filmcraft.request('ui.elements')` lists the open menu's items with their rectangles);
  the translator is not at fault.
- **A shortcut changed upstream.** The tests that press it fail: Ctrl+S, Ctrl+Shift+S,
  Ctrl+Alt+S, Ctrl+Alt+N, Ctrl+O (WebKit), M and the arrow keys are used by the contract tests.
  Check them against `shortcut_presets.rs` before holding a release back.

The fixtures in `tests/e2e/fixtures/filmcraft/`: `FilmCraft Demo.fcproj` is FilmCraft 0.6.0's
Ctrl+S of the demo project it opens at start, and `Main Edit.edl` its File > Export > EDL… of the
same project, both kept as FilmCraft wrote them. `make-fixtures.mjs` derives
`craftsuite-probe.fcproj` (stored name `Probe Title`, the marker `CRAFTSUITE-PROBE-fc01` as its
project notes) and `old-schema.fcproj` (schema 14, which differs from 15 only by the notes) from
the former. The spec derives the other files it opens from these.

## Upstream

FilmCraft has no embedding API: `window.filmcraft` works on the app's own page only (see
[architecture.md](../architecture.md#native-embedding-apis)). A `postMessage` bridge to it, for an
allowed parent origin, would replace drops and downloads. Worth reporting upstream as well: a
project identity (a GUID or creation time kept by every save), which would let a new project be
told from the opened one; the OPFS media copies that are never deleted and the second copy on
every reimport; the `localStorage` claim, the sizes and the missing flags in `HOSTING.md`; and the
file pickers that do nothing in a cross-origin frame in Chromium (falling back to
`<input type=file>` when `showOpenFilePicker` rejects with `SecurityError` would make them work).
