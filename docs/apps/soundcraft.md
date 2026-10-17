<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# SoundCraft

| | |
|---|---|
| Upstream | [github.com/storytold/soundcraft](https://github.com/storytold/soundcraft) |
| Adapter | [`translators/soundcraft.js`](../../translators/soundcraft.js) |
| Tested version | `tested` in [`apps.json`](../../apps.json) (0.7.0 when this page was written, checked again with 0.6.1) |
| Tests | [`tests/e2e/specs/soundcraft.spec.ts`](../../tests/e2e/specs/soundcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

This page records what the SoundCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.7.0 and
0.6.1 source and web builds; 0.6.1 is the first release whose web build opens and saves files
(0.5.0 and older cannot). Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice. Source references
are to the `v0.7.0` tag; `web.rs` is `apps/soundcraft-web/src/web.rs`, the other paths are under
`crates/`. 0.6.1 does the same unless noted.

## What the web build does

**Starting**

- `index.html` is a Trunk loader: its inline module script awaits the `.wasm` and then dispatches
  `TrunkApplicationStarted`. The module's `start()` (`web.rs:16-56`) runs eframe's web runner,
  which first sets up the graphics, then creates the app with its session (`web.rs:42`), then
  installs its event handlers, among them the only `drop` listener, on `canvas#soundcraft_canvas`
  (eframe 0.36 `web_runner.rs` `start`, `events.rs` `install_drag_and_drop`), and then removes
  `#soundcraft_loading` (`web.rs:49-54`). So when SoundCraft listens for drops, it can take them,
  and the core's default (`ready` at the first `drop` listener) fits. Measured: the listener comes
  0.4-0.6 s after `TrunkApplicationStarted` in Chromium with SwiftShader, in WebKit at about the
  same time.
- Without WebGL2 and WebGPU, eframe fails before it listens for drops, and the page writes
  `SoundCraft failed to start: ...` into `#soundcraft_loading`. The core reports
  `the app registered no drop target` once the adapter's `dropTargetTimeout` (10 s) has passed.
- The page's `load` event comes before the `.wasm` has arrived (the preload link does not hold it
  back): at 16 Mbit/s, `load` after 0.25 s and the start after 8.2 s for the uncompressed 15.5 MB.
  The core's `data-startup-timeout` (60 s from `load`) therefore includes the download; see
  [Hosting notes](#hosting-notes).
- At start the app opens its synthesised demo session `Midnight Groove`, or an empty session
  `Untitled` when the query contains `empty` anywhere (`web.rs:42`, `query().contains`).
- A classic script in `index.html` wraps `AudioContext` and resumes it on the first key or pointer
  press in the page: playback is heard only after the user clicked or typed into the frame.
- The interface is English only: there is no string catalog (upstream
  `docs/localization-parity.md`), no language setting, and nothing reads the browser's language.

**Storage in the browser**

- None. eframe's persistence is not enabled (`apps/soundcraft-web/Cargo.toml`), and the web build
  keeps nothing in `localStorage`, `sessionStorage`, IndexedDB or OPFS and registers no service
  worker (checked in Chromium after a start and a save). File > Open Recent (0.7.0) lists the
  session paths of the running page only.

**Opening**

- The drop listener reads `DataTransfer.files` and does not check `isTrusted`, so the translator's
  simulated drop works like a user's drop. The core's default drop target is the canvas the
  listener is on; the adapter needs no `dropTarget`.
- A dropped file goes by its extension, in any letter case (`web.rs:70-87`): `scraftz` and
  `scraft` open as the session, `mid`, `midi` and `smf` are imported as instrument tracks, and
  everything else as audio, a new track per file. Since 0.7.0 audio dropped on an instrument track
  or on a Sampler window goes into that sampler (`ui-egui/src/sampler_window.rs:88-111`).
- A session opens through `engine/src/io.rs` `open_session_bytes` (`:1240-1269`): bytes that start
  like a zip are a bundle, whose first top-level entry with the extension `scraft` is the session
  and whose other entries are its audio by path (`read_bundle`, at most 10,000 entries and 1 GiB);
  anything else is read as the session's JSON, whose audio is then missing. The zip reader takes
  stored entries only: a bundle that another program compressed with deflate does not open. A
  session whose `format_version` is newer than 1 is refused. A session that does not open leaves
  the open one as it was, with a message in the status line.
- An opened session replaces the open one without asking, also one with unsaved changes; only the
  menu's Open asks first. Since 0.7.0 a session is refused while a bounce runs
  (`ui-egui/src/bounce.rs:41-46`). The session keeps the name stored in it, and its path becomes
  `<sanitize_name(stem)>.scraftz`, after the file's name (`io.rs:1262-1264`).
- File > Open Session… (Ctrl+O) and Import > Audio…/MIDI… replace their path prompt with the
  browser's file picker, an `<input type=file>` (`web.rs` `take_path_prompt`, rfd), which works in
  a frame of another origin in Chromium and WebKit. Open Recent and Revert Session to Saved read
  paths from a disk the browser does not have and fail.
- There is no `?file=`, no automation API on the page (`window.wasmBindings` has none) and no
  `postMessage`: the host cannot reach the app, and nothing outside the canvas shows what is open.
  The host only gets `delivered`.

**Saving and downloads**

- Every file SoundCraft writes goes through `io.rs` `write_file` (`:1174-1181`) to
  `web.rs` `download` (`:230-263`): a `Blob` typed by the extension (`application/zip` for
  `.scraftz`), `URL.createObjectURL`, a hidden `<a download>` appended to `<body>`, clicked and
  removed at once; the URL is revoked after 10 s. There is no File System Access save.
- The shortcuts are egui's: Ctrl off macOS, Cmd (the Meta key) where egui finds `Mac` in the user
  agent, so in WebKit with Safari's user agent too (egui `os.rs` `from_user_agent`). They reach the
  app only while no dialog is open and no text field has the focus
  (`ui-egui/src/shortcuts.rs:57-62`).
- Save Session (Ctrl+S) of a session with a path writes it at once, without a dialog
  (`ui-egui/src/dialogs.rs:107`, `engine/src/cmd/file.rs:18-23`): `io.rs` `save_session_bundle`
  (`:1221-1236`) takes the path's stem as the session's name, writes the whole session as a bundle
  named `<sanitize_name(name)>.scraftz`, then sets the path to that name and marks the session
  saved. So an opened session saves under the opened name, unless `sanitize_name` changes it.
- `sanitize_name` (`io.rs:860-864`) turns every character that is not a letter, a digit, `-`, `_`,
  a space or `.` into `_`, removes spaces at both ends and dots at the start, keeps at most 100
  characters, and gives `untitled` for an empty result: `Lied (v2) & Mix ä.scraftz` saves as
  `Lied _v2_ _ Mix ä.scraftz`.
- A bundle (`io.rs` `session_bundle`, `:1187-1218`) is a zip of stored entries, each with ZIP64
  fields: the audio of every source as 32-bit float WAV, `Audio Files/<sanitize_name(source)>.wav`
  (`_01`, `_02`, … for duplicates), then the session as pretty JSON, `<sanitize_name(name)>.scraft`,
  with `format_version` 1. Every save writes the whole session with all its audio: the 35 s demo
  is 66 MB, and the tests' 0.1 s fixture grows from 27 KB (16-bit WAV) to 46 KB.
- Without a path (a new, empty or demo session, or the one left after a file that did not open),
  Save and Save As… (Ctrl+Shift+S) ask for the name in the dialog `Save Session As`, prefilled with
  `<session name>.scraftz` (`dialogs.rs:108-118`). Its text field does not take the focus by itself;
  Enter or OK confirms, Esc or Cancel closes it.
- File > Export > Selected Tracks as New Session… has no shortcut. Its dialog is prefilled with
  `/<session name>.scraft` (`dialogs.rs:200-216`), and it writes a bundle named
  `<sanitize_name(stem)>.scraftz` of a copy of the session that keeps the selected tracks and every
  Master track (`cmd/file.rs:133-142`): the rest of the session, the audio of every source (also
  of the tracks it leaves out) and the selection stay as they are. SoundCraft's own session is not
  renamed or marked saved. It needs a selected track (`has_selection`, `tracks_required`). Once the
  session was saved, or when the file stores its own stem as the session name (as every file
  SoundCraft saved does), the prefilled name is the opened name.
- New sessions are named `Untitled`: File > New… (its dialog is prefilled with that name), Close
  Session, and the empty start. A session stores no identity (no id, no creation time, no
  "saved by"); the ids of tracks, clips and sources count from 1 in every session.
- Save Session Copy In… fails in the browser (`Audio Files: operation not supported on this
  platform` in the status line) and downloads nothing.
- Edit > Select All (Ctrl+A) selects every visible track (`engine/src/cmd/edit.rs:443-449`).
- The downloads below were checked in Chromium and WebKit; `<name>` is the session's name.

| Download | Name | Kind |
|---|---|---|
| Save Session (Ctrl+S, or File > Save Session) of the opened session | the opened name, or `sanitize_name` of its stem, the whole session | `document` (see [How the adapter classifies](#how-the-adapter-classifies) for a session whose every track is selected) |
| Save Session As… under the name the dialog proposes, before the first save of a file that stores another name | `<stored name>.scraftz` | `export` |
| File > Export > Selected Tracks as New Session… | the dialog's name, by default `<name>.scraftz`, often the opened name | `export` |
| Save of a new session, the empty session or the demo | `Untitled.scraftz` or the name typed into the dialog | `export` (see [Known gaps](#known-gaps) for the opened name typed in) |
| Save of a session the user dropped or opened from the disk | its name, which may be the opened one | `export` |
| File > Save As Template… | `<name>.scraft`, the session without clips and audio | `export` |
| File > Bounce Mix… (Ctrl+Alt+B) | `<name> Bounce.wav` (or `.aiff`, `.flac`) | `export` |
| File > Export > MIDI…, Sibelius…; Print Score… (Ctrl+P) | the dialog's name, by default `<name>.mid`, `<name>.musicxml`, `<name>.svg` | `export` |

**Links**

- The Dashboard and the credits show egui hyperlinks, which eframe opens with `window.open` and
  target `_self` unless a modifier is held. In a frame that would replace the editor; the
  translator opens them in a new window instead.

## How the adapter classifies

**Start.** The core's default fits (see Starting); the adapter only gives the drop listener 10 s
after `TrunkApplicationStarted` (`dropTargetTimeout`) instead of 3 s, for slow machines. A browser
without WebGPU and WebGL2 is reported that much later.

**Flag.** Before SoundCraft's module reads the address, the adapter adds `empty` to the frame's
query with `history.replaceState`, after whatever query the address has, unless the query
contains `empty` already. This happens only when the core is active (framed, with an allowed
origin configured, in a secure context); outside the integration SoundCraft keeps its own
behaviour. With it, a file SoundCraft cannot open leaves an empty `Untitled` session open, whose
save is a new file, not the demo session, whose Save would offer `Midnight Groove.scraftz`; the
start is also lighter (no demo audio to synthesise).

**Saved name.** For an opened `*.scraftz` (any letter case) the adapter's `savedName` is the name
Save writes: `sanitize_name` applied twice to the file's stem (once by the open, once by the save),
then `.scraftz`. For `Lied (v2) & Mix ä.scraftz` that is `Lied _v2_ _ Mix ä.scraftz`; the host
stores such a save next to the opened file, and later saves replace that file (see
[protocol.md](../protocol.md#saves)). Other files keep their name.

**Session files from the user.** The adapter watches the `files` getters of `DataTransfer` (only
during a trusted `drop` event, so not the translator's own drop) and of `<input type=file>`. Once a
`*.scraftz` or `*.scraft` came in this way, the open session may not be the host's file any more,
and no later save in this frame is `document`.

**The Save shortcut.** The adapter notes, for each download of a `.scraftz`, whether the last key
or pointer press before it was the user's Save shortcut: S with Ctrl or with Cmd (Meta), not both,
without Shift or Alt, from the browser (a key event a script made does not count); modifier keys
alone and key repeats do not count, and the download uses the note up.
A save of a session with a path follows that key in the app's next frame. The export has no
shortcut, and its dialog needs Enter or a click on OK, so it never follows the shortcut directly.

**Kinds.** The core calls `classify` for a download named like the opened file or its saved name.
The adapter returns `document` only if all of these hold, otherwise `export`:

- the opened file and the download are `*.scraftz`;
- the download's stem is not `Untitled` (in any letter case);
- no session file came from the user in this frame;
- the download is a session bundle: its first top-level `*.scraft` entry is stored and is a JSON
  object with `format_version`, `tracks` and `edit.selected_tracks`;
- it cannot be an export of the selected tracks: it followed the Save shortcut, or one of its
  tracks other than a Master track is not selected, or none of its tracks is.

Notes:

- The last rule follows from the export: its copy keeps the selection and only the selected tracks
  and the Master tracks, so in what it writes every other track is selected, and with every track
  selected its bytes are those of a save. A save in which a track is not selected cannot be that
  export. A save with every track selected (a session with one track whose track or clip was
  clicked, or after Select All) is the document only after the Save shortcut; from the File menu
  it arrives as a new file (see [Known gaps](#known-gaps)).
- A save is never an update of the opened bytes (it rewrites every WAV as 32-bit float), so the
  prefix check of PdfCraft does not apply, and SoundCraft writes no identity to compare (no
  `identity`).
- The format holds everything SoundCraft models, so no save of an opened session is a `copy` (see
  [protocol.md](../protocol.md#copies)). A bundle whose audio is in another format (AIFF, FLAC,
  MP3) comes back with 32-bit float WAVs, bigger but without further loss.
- Save As… of the opened session under the name its dialog proposes is the document when that is
  the opened name and a track is not selected (the dialog's Enter or OK comes between the shortcut
  and the download); under another name it is a new file.

## Known gaps

- **A new session saved under the opened name.** A session made in the frame (File > New, Close
  Session) and saved with the opened file's name typed into Save Session As replaces the Nextcloud
  file: nothing in the bundle tells it from the opened session. The default name of every new
  session is `Untitled`, which the adapter never takes as the document; the user has to type the
  opened name. Nextcloud's file versions, where enabled, keep the old state.
- **File > Save Session with every track selected** arrives as a new file (`<name> (2).scraftz`
  or similar, as the host names it), because it cannot be told from Export > Selected Tracks as New
  Session; Ctrl+S (Cmd+S on a Mac) saves it as the document.
- **Sessions named like SoundCraft's own.** An opened `Untitled.scraftz` is never saved back:
  every save of it is a new file. Renaming the file in Nextcloud before opening it avoids that.
- **Session files from elsewhere, unnoticed.** The watch above relies on how eframe and rfd read
  files from the user in 0.6.1 and 0.7.0. Should a release read them another way, a session the
  user drops or opens from the disk under the opened name would pass as `document`.
- **Newer files.** A session written by a newer SoundCraft with the same `format_version` loses on
  saving what this version does not know: 0.6.1 drops 0.7.0's fade curvature, clip loop ids and
  Zoom Toggle state. The format has no version of its writer to tell such a file by.
- **Unsaved changes on a drop.** A session the user drops onto the frame replaces the open one
  without asking, also one with unsaved changes (File > Open Session… asks).
- **Large sessions.** Every save uploads the whole session with all its audio as 32-bit float WAV
  (the 35 s demo: 66 MB). The host reads a file whole into memory, the core hashes it, and a
  bundle travels to the host by `postMessage`.
- **No unsaved-changes signal.** SoundCraft shows unsaved changes only inside its canvas (`*`
  after the name, `modified` in the counter) and asks nothing before the page unloads. The host
  must warn on close.
- **`delivered` is not "opened".** A session SoundCraft refuses shows a message in its status line;
  the host only sees `delivered`, and the empty session stays open (its saves are new files).
- **Saved means downloaded.** SoundCraft marks the session saved when the download starts. If the
  host cannot store the file, the translator's fallback browser download is the copy the user
  keeps.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, so SoundCraft
  cannot start there.

## Hosting notes

- SoundCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no special
  headers (no COOP/COEP; it uses no `SharedArrayBuffer`). It asks not to send
  `X-Frame-Options: DENY` or a `frame-ancestors` that excludes the embedding page, suggests
  `allow="fullscreen; autoplay; clipboard-read; clipboard-write"` on the iframe, and for a
  sandboxed iframe needs at least `allow-scripts allow-same-origin`. Its last paragraph (no file
  dialogs, the demo session only) is out of date since 0.6.1.
- The `.wasm` file is 15.5 MB in 0.7.0 (5.9 MB with gzip) and 14.6 MB in 0.6.1 (5.6 MB). As the
  page's `load` comes before it has arrived, the core's default 60 s from `load` cover the download
  down to about 0.8 Mbit/s when it is served compressed, which is enough; no `startupTimeout` is
  needed. Serve it compressed, preferably precompressed with Brotli.
- It renders with wgpu: WebGPU where the browser has it, else WebGL2. With neither the host gets
  `the app registered no drop target` after 10 s. The tests run on WebGL2 (Chromium with
  SwiftShader, and WebKit).
- Query flags are substrings of the whole query string (`web.rs:58-60`): `webgl` forces WebGL2,
  `empty` starts with an empty session. Any query that contains one of them by accident turns it
  on. The adapter adds `empty`; the Nextcloud app refuses app addresses with a query.
- The loader is Trunk's inline module script. A `.wasm` that is missing or cannot be compiled makes
  it fail, and the host gets `the app failed to load: ...`; a Content-Security-Policy that blocks
  the inline script leads to `the app did not start in time` (see
  [protocol.md](../protocol.md#errors)).
- The file names carry a content hash; `index.html` needs revalidation (`_headers`, `.htaccess`).
  There is no service worker.
- Keyboard shortcuts reach the app after the user clicks into the frame.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `scraftz` | the session; Save replaces the file (one named `Untitled` gets a new file per save, see [Known gaps](#known-gaps)) | yes | yes: no other app opens it |

Match the extension in any letter case, as SoundCraft does. Nextcloud 34 and 35 have no MIME type
for it (it arrives as `application/octet-stream`), so the app must pick SoundCraft by extension.
Upstream declares `application/x-soundcraft-session` for its desktop session file `.scraft`
(`packaging/linux/ai.storyteller.soundcraft.mime.xml`, `packaging/macos/Info.plist.in`,
`packaging/windows/soundcraft.wxs`) and no type for the browser's bundle. For the SoundCraft icon
in Files the Nextcloud app registers that type for `scraftz` too
([nextcloud-app.md](../nextcloud-app.md#file-type-icons)); it still picks SoundCraft by the
extension.

Do not offer anything else. A `.scraft` is the desktop app's session file, whose audio lies in a
folder next to it: it opens without its audio, and its saves are a new `.scraftz`. Audio and MIDI
files (which the desktop packaging lists as Viewer or Open With types) would only be imported into
the empty session, and their saves would be new `Untitled.scraftz` files; the Viewer and the Files
player own them.

The smallest session SoundCraft 0.6.1 and 0.7.0 open, for a "+ New" entry: a zip with one stored
entry (compression method 0; deflate does not open), any name ending in `.scraft` at the top level,
holding the JSON SoundCraft 0.6.1 writes for its empty session (the save of a start with `?empty`,
compact or pretty). Its `name` is what the dialogs propose until the first save; the first Ctrl+S,
without an edit, saves it under the file's name as the document. Dropping fields with serde
defaults makes it smaller but changes the view (no clip names), so the blank keeps them. The
Nextcloud app's blank (`craftsuite_layer/assets/blank.scraftz`, made by `blanks.mjs`) is that
session, named `New session`, as `New session.scraft` in a zip of one stored entry (1,735 bytes);
the server leaves it as it is, since the name in it does not matter.

## Tests

`soundcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`soundcraft-chromium` and `soundcraft-webkit`. The behaviour the core shares with every app
(fallback downloads, a foreign host, startup errors) is tested in `translator.spec.ts` and
`pdfcraft.spec.ts`; this spec checks what depends on SoundCraft.

The spec has three tests, and its header lists them with their scenarios. `contract` and `exports`
are the contract tests; the canary runs them apart from the `@ui` test. SoundCraft has no language
to choose, so there is no `@language` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version; `ready` once SoundCraft listens for drops on `canvas#soundcraft_canvas` (it has removed `#soundcraft_loading` by then); the frame address `?ack=…&result=…&empty`. The open of `craftsuite-probe.scraftz`: the Save shortcut (Ctrl+S in Chromium, Cmd+S in WebKit) saves the document under the opened name, a bundle with the fixture's session, comments and audio; after Select All the next Save is the document too, with every track selected. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. The "+ New" blank (`blanks/blank.scraftz`): its first Ctrl+S, without an edit, is the document, a session `blank` without tracks or audio. Without WebGL2 and WebGPU (blocked in the frame) the host gets `the app registered no drop target` and no `ready`, and SoundCraft shows `SoundCraft failed to start: ...`. |
| `exports` | Under a Mac user agent (SoundCraft's Search opens only with Cmd+Ctrl+S): File > Export > Selected Tracks as New Session… from Search, with the proposed name, is a new file under the opened name holding only the selected track, and Cmd+S after it the document. An opened `Untitled.scraftz` (the fixture under that name): Cmd+S is a new file. A deflated bundle SoundCraft cannot open: the empty session stays open (`empty`), and its save, through the name dialog, is a new `Untitled.scraftz` without tracks. A session with the opened name and other comments from the user's disk, through File > Open Session… (Cmd+O, the browser's file picker) and, in Chromium, dropped from the desktop: Cmd+S is a new file with that session. |
| `ui` (`@ui`) | With the pointer: File > Save Session saves the document (one of two tracks selected); File > Export > Selected Tracks as New Session… and its dialog's OK arrive as a new file under the opened name; after Select All, File > Save Session is a new file. |

A test with several scenarios (`exports`) runs each in a page of its own and reports every
scenario that fails as `scenario failed: <title>`, not only the first. SoundCraft has no
automation API in the browser and shows what it has open only inside its canvas, so the steps wait
for the picture to settle after the open, and the checks read the saved bundles: their session's
name, comments, tracks and selection show what was open. The tests use SoundCraft's shortcuts
(`engine/src/cmd/`, `ui-egui/src/shortcuts.rs`) with the modifier egui reads from the user agent,
and confirm the name dialogs with Enter. Only the `ui` test clicks with the pointer, at the
positions in the spec's `AT` table, measured on 0.6.1 and 0.7.0 at a 1400x900 viewport (0.7.0
added Open Recent to the File menu, which `AT` allows for by the served version). When a new
release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on: the drop
  routing (`web.rs` `take_drops`, `Purpose::of`), the download hook (`web.rs` `download`), the
  save name (`io.rs` `save_session_bundle`, `sanitize_name`), the bundle (`session_bundle`), the
  export of selected tracks (`cmd/file.rs`), the name `Untitled`, the flag `empty`, or how eframe
  and rfd read files from the user. The rules fail towards new files, not towards overwriting: a
  save the adapter does not recognise arrives as an `export`. Sites that host the app should hold
  the release back until the adapter is fixed.
- **Only the `@ui` test fails.** A menu item moved: re-measure the positions in `AT`; the
  translator is not at fault.
- **A shortcut changed upstream.** The tests that press it fail: Ctrl/Cmd+S, Ctrl/Cmd+A,
  Cmd+O, Cmd+Ctrl+S (Search) and Enter in the dialogs are used by the contract tests. Check them
  against the release's command list before holding it back.

The fixture `tests/e2e/fixtures/soundcraft/craftsuite-probe.scraftz` is written by
`make-fixtures.mjs`: a bundle like the ones SoundCraft saves, with the session `craftsuite-probe`
(its comments `CRAFTSUITE-PROBE-sc01`), the tracks `Tone A` (selected) and `Tone B`, each with a
0.1 s tone, in the fields and values SoundCraft 0.6.1 writes. The spec derives the other files it
opens from it.

## Upstream

SoundCraft has no embedding API in the browser. A `postMessage` bridge, for an allowed parent
origin, would replace drops and downloads. Worth reporting upstream as well: a session identity
(an id or creation time kept by every save) or a mark of the writing version, which would tell the
opened session from a new one and a file of a newer release from one of this release; a question
before a dropped session replaces unsaved changes; the bundle's audio kept in its original format
(or FLAC) instead of 32-bit float WAV; deflate in the bundle reader; `.scraftz` in the desktop app
and in the packaging's file types; and the out-of-date last paragraph of `HOSTING.md`.
