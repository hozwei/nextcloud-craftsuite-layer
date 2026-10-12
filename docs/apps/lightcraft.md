<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# LightCraft

| | |
|---|---|
| Upstream | [github.com/storytold/lightcraft](https://github.com/storytold/lightcraft) |
| Adapter | [`translators/lightcraft.js`](../../translators/lightcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.6.0 when this page was written) |
| Tests | [`tests/e2e/specs/lightcraft.spec.ts`](../../tests/e2e/specs/lightcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)) |

LightCraft is a photo library and raw developer. With the layer it works as **open a photo from
Nextcloud, develop it, export a new file next to it**. Every download LightCraft makes arrives as
an `export`, so nothing ever replaces a file in Nextcloud. **Edits are not kept**: they exist only
in the editor's memory and are gone when the editor is closed or reloaded. Only what the user
exports reaches Nextcloud. Opening the photo again starts from the original.

This page records what the LightCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.6.0
source and web build. Source references are to the `v0.6.0` tag; `index.html` and `src/*.rs` are
in `apps/lightcraft-web/` (`web.rs` is `src/web.rs`), the other paths are under `crates/`.
Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice.

## What the web build does

**Startup**

- `index.html` is not a Trunk loader. Its inline module script fetches the Simplified Chinese UI
  font (`lightcraft_zh_hans.otf`, 16 MB) and compiles the `.wasm` module, initialises it, sets
  `globalThis.lightcraft = { command }` (an automation call, see below) and calls `start(font)`
  (`index.html:26-47`). The page never dispatches `TrunkApplicationStarted`.
- `start()` reads the URL options `store`, `workers`, `reset` and `bench` (`web.rs:67-96`), takes
  the Web Lock `lightcraft-library` unless `store=memory` (`web.rs:674-681`), opens the library's
  storage (`web.rs:278-363`), then starts eframe, which installs its event handlers, the `drop`
  listener among them, once the app exists. Then the page removes `#lightcraft_loading`
  (`web.rs:690-697`). The first `drop` listener is the one that reads files.
- Failures show only as text, without an error event: a failed load as `LightCraft failed to
  load: <error>` in `#lightcraft_loading` (`index.html:42-46`), a failed graphics start as
  `LightCraft failed to start: <error>` in `#lightcraft_status` (`web.rs:699-702`). A panic (the
  module is built with `panic = "abort"`) covers the page with `#lightcraft_blocking`: `LightCraft
  stopped after an internal error: ... The library saved in this browser is kept. Reload the page
  to continue.` (`src/safety.rs:49-89`). The same cover says `LightCraft is already open in
  another tab` when another tab holds the Web Lock (not in memory mode).
- `globalThis.lightcraft.command(id, json)` runs any of LightCraft's commands by id on the app's
  next frame and resolves to its result as JSON text (`web.rs:576-617`). Besides the commands of
  the menus (`app.export`, `photo.rotateRight`, ...) and queries (`photo.inspect`), `web.stats`
  reports the page's own state: `storage` (`opfs`, `idb` or `memory`), the render workers, the
  render queue. It is same-origin only, with no `postMessage`, so the host cannot reach it.
- Measured with 0.6.0 in the tests: `ready` 0.2 to 3 s after the frame's `load`, `delivered` 1 to
  10 s after `open`, while the page renders the thumbnails of its demo photos (see
  [Known gaps](#known-gaps)).

**Storage**

- By default the library lives in the browser's storage for the app's origin: OPFS, or IndexedDB
  where OPFS cannot be written. It holds the bytes of every imported photo
  (`originals/<hash>`), the catalog (`library/catalog.snap`, `catalog.log`, `prefs.json`,
  `view.json`, `ui.json`) and a thumbnail cache, and it is kept across visits (`src/backend.rs`,
  `src/store.rs`, `docs/web.md`). In a frame the browser partitions it by the top-level site, but
  still keeps it. The page also asks for persistent storage (`src/backend.rs:326-345`). With the
  layer that would make the browser a second, invisible store of the user's photos.
- `?store=memory` keeps nothing: no storage is opened, no Web Lock taken, no persistence asked
  for, and every start creates a new library in memory. In that mode the render workers cannot
  read an imported photo (they read originals from storage, `src/workers.rs:106-110`), so the
  photo would not render; `?workers=0` renders on the page itself, which holds the bytes.
- Every new library starts with 24 procedural demo photos (`LC01312.JPG`, ...). In memory mode
  that is every session.
- The probes found nothing in OPFS, IndexedDB, Local and Session Storage or Cache Storage in
  memory mode, also after eframe's 30 s save interval and after a reload of the frame (eframe is
  built without persistence).

**Opening**

- eframe takes every file of a drop and does not check `isTrusted`, so the translator's simulated
  drop works like a user's. The page reads each dropped file, keeps its bytes in memory (or
  storage) and imports it into the library (`web.rs:99-118`, `476-496`). The new photo becomes the
  active one and shows in the loupe with the Edit panel; the demo photos stay in the filmstrip. A
  second drop adds a second photo. A file that is not a photo fails the import with a message in
  the app.
- File > Import Photos… (Ctrl+Shift+I) adds photos from the user's disk through an
  `<input type=file>` (`web.rs:121-140`); they become the active photo the same way.
- The import list is `engine/src/import.rs:34-41`. Of the camera raws, only DNG, CR2, CR3,
  NEF/NRW, ARW, RAF, ORF, RW2/RWL (and Panasonic files with the `IIU` header), PEF and SRW are
  decoded (`raw/src/lib.rs:112-127`, `336-351`); 3FR and FFF only when they are laid out like a
  DNG. CRW, MRW, X3F, IIQ, ERF, KDC and MOS import as "preview only": the user develops and
  exports the small JPEG preview embedded in the file (`engine/src/files.rs:104-124`). HEIC, HEIF
  and AVIF are in the list but have no decoder in the web build.
- There is no `?file=` and no signal that a photo was opened or could not be opened. The host only
  gets `delivered`.

**Saving and downloads**

- Every download goes through one helper (`web.rs:142-165`): a `Blob` typed after the extension,
  `URL.createObjectURL`, a detached `<a download>`, `click()`, the URL revoked after 5 s. There is
  no File System Access API. Exports run on the page's thread (`write_shared: None`), so the app
  does not respond while a large photo is exported.
- Ctrl+S is Photo > Save Metadata to File (`engine/src/cmd/xmp.rs:72-80`): an XMP sidecar next
  to the original, written with `std::fs` (`engine/src/sidecar.rs:475-486`). On the web it fails
  with `operation not supported on this platform`, without a download. So does Automatically
  Write Changes into XMP (only logged). Nothing saves the opened file.
- File > Export… (alias Shift+E, `ui-egui/src/shortcuts.rs:198`) opens a dialog drawn in the
  canvas: format, size, a file name template (`{name}`), a Folder field and OK. No name is asked
  for. The Folder starts empty on the web (`ui-egui/src/control.rs:421-426` reads `HOME`), and OK
  then says `Choose an export folder first.` (`control.rs:417`, `467-469`); any text works, since
  only the file name reaches the download. Without an earlier export the dialog starts at 2048 px
  on the long edge with Don't enlarge, not at full size (`ui-egui/src/menus.rs:995-1004`). OK has
  no keyboard shortcut. Export with Previous (Ctrl+Alt+Shift+E, alias Ctrl+E,
  `menus.rs:203`, `shortcuts.rs:199`) repeats the last export with its folder, which memory mode
  keeps for the session.
- An export is named after the template plus the format's extension
  (`engine/src/export.rs:1035-1052`): `<stem>.jpg` for JPEG, so an opened JPEG is exported under
  the opened name. It is a new rendering of the photo with its edits: decoded, developed and
  encoded again (JPEG quality 90), by default resized, with LightCraft's own metadata. The
  "If file exists: Add number" choice never applies on the web (its check for an existing file
  uses `std::fs`), so a second export has the same name again.
- The downloads, checked in Chromium (in the tests and the probes):

| Download | Name | Kind |
|---|---|---|
| Export…, Export with Previous, Export with Preset, as JPEG | `<stem>.jpg`; for an opened JPEG the opened name | `export` |
| The same as PNG, TIFF (16 bit) or WebP | `<stem>.png`, `<stem>.tif`, `<stem>.webp`; for an opened PNG or TIFF the opened name | `export` |
| An export of another photo (a demo photo, one from File > Import Photos…) | `<its stem>.<ext>`, or any name the template gives it, also the opened one | `export` |
| Export as AVIF | nothing: `AVIF encoding is not available in this build` (`codecs/src/encode.rs:362`) | |
| Export as Original files, as DNG | nothing: both read the original with `std::fs` and fail | |
| Save Metadata to File (Ctrl+S) | nothing, see above | |
| File > Back Up Library… | nothing in memory mode: `nothing is stored in this browser session (?store=memory)` (`web.rs:173-175`) | |
| Contact Sheet PDF… | nothing: disabled on the web (`ui-egui/src/menus.rs:1593`); it would write with `std::fs` | |
| Preset, keyword and curve files | nothing: not wired on the web (`web.rs:209-220`) | |

**Links**

- Links in the Help menu open with `window.open(url, '_blank')` (`web.rs:230-233`); egui
  hyperlinks open through eframe with target `_self`, which the translator turns into a new
  window. `window.confirm` is used only for `?reset` and for restoring a backup, neither of which
  happens in memory mode.

## How the adapter works

**Memory mode.** When the core is active (framed by an allowed origin over https), the adapter
rewrites the frame's URL with `history.replaceState` before the app's module runs: it sets
`store=memory` and `workers=0` and removes `reset` (which would delete a stored library) and
`bench` (a scripted measurement that, once the thumbnails are done, selects the first photo of the
grid and drags its Exposure, `src/bench.rs:69-112`). Both translator scripts run in `<head>`; the
module script is deferred and reads `location.search` only in `start()`. A configured app URL
such as `?store=opfs&workers=3&reset&bench` is overridden; the tests check that (the Nextcloud
app refuses an app address with a query anyway, see
[architecture.md](../architecture.md#design-decisions)). Outside the integration the adapter does
nothing, and the app keeps its stored library as without the layer.

**`started()`.** The core sends `ready` once the app registered its `drop` listener and the
adapter's `started()` has resolved. `started()` asks the app `web.stats` and resolves only if
`storage` is `memory` and no render worker runs. Otherwise the host gets a startup error and no
file is handed over (fail closed). Startup errors from `started()`:

| `message` | Cause |
|---|---|
| `the app would keep the photo in browser storage (opfs)` (or `idb`) | The URL could not be rewritten, or LightCraft no longer reads `store=memory` |
| `the app would render in workers that cannot read the photo` | LightCraft no longer reads `workers=0` |
| `the app cannot confirm that it keeps nothing in browser storage` | No automation call (`globalThis.lightcraft`); with `: <error>` added, `web.stats` failed or gave no JSON |
| `the app did not get ready in time` | No answer to `web.stats` within 30 s (no frame) |
| `the app failed to start: <LightCraft's text>` | A panic cover or a failure text appeared after the drop listener |

**Startup failures.** The adapter watches the page's DOM (a `MutationObserver`; the page changes
it only for these texts and the loading text) for `LightCraft failed to load` or `failed to start`
in `#lightcraft_loading` or `#lightcraft_status`, and for `#lightcraft_blocking`. Until the app
has a drop target, it raises such a text as an error event (`reportError`), and the core reports
it at once as `the app failed to load: ... LightCraft failed to load: ...` (256 ms after an
aborted `.wasm` in the probes, instead of after the 60 s startup timeout; the tests require less
than 30 s). A browser without WebGL gets `the app failed to load: Uncaught Error: LightCraft
failed to start: JsValue("WebGL isn't supported")` the same way (checked in Chromium with WebGL
made unavailable; eframe installs its event handlers only after the graphics start). After that,
`started()` fails on such a text, until `ready`; then the adapter stops watching. Probes also
checked the other refusals: a frame URL with `workers=2`, a page without `globalThis.lightcraft`
and a panic cover while `web.stats` was pending each gave the startup error of the table above,
and the photo was never sent.

**`classify()`.** Always `export`. No download of LightCraft is a save of the opened file: every
export is a new, lossy rendering, also under the opened name, and a demo photo or a photo from the
user's disk can be exported under that name too. Never `document`, and never `copy`: there is no
save of the opened file whose later versions could replace a copy.

The adapter has no `savedName`, `identity`, `dropTarget`, `continuesExports` or
`dropTargetTimeout`: the core's defaults fit. (Without `TrunkApplicationStarted` the core's
drop-target timer never runs.)

## Known gaps

- **Edits are not kept.** In memory mode LightCraft keeps the photo, its edits and the library
  only in the frame's memory. Closing the editor, reloading the frame or a crash loses them; only
  exported files reach Nextcloud, and opening the photo again starts from the original. The
  host's warning before the page is left is the only protection. An XMP sidecar download on the
  web (see [Upstream](#upstream)) would let the edits be stored next to the photo.
- **Every result is a new file.** An export under the opened name becomes `photo (2).jpg` and so
  on in Nextcloud; the original is never replaced, also when the user expects a "save".
- **The startup timer runs during the download.** The core's `data-startup-timeout` (60 s) runs
  from the page's `load` event, but the `.wasm` and the font (about 18 MB with Brotli) are
  fetched by the module script, which does not delay `load`. On a slow first load (below about
  2.4 Mbit/s) the host gets `the app did not start in time`, and `ready` follows once the app
  starts (the editor first shows the error, then the photo). Give LightCraft a longer
  `data-startup-timeout` in the hosting, such as 180000 (see [Hosting notes](#hosting-notes)).
- **The Export dialog.** Its Folder field needs some text on the web, and it defaults to 2048 px
  on the long edge; full size needs Full size ticked. OK can only be clicked.
- **Demo photos.** Every session shows LightCraft's 24 demo photos next to the opened one. The
  opened photo is selected, and a demo photo exported by mistake arrives as a new file.
- **Rendering on the page's thread.** With `workers=0` all rendering and exports run on the
  page's own thread, one picture per frame. In the first one or two minutes of a session the page
  renders the demo photos' thumbnails, and the app reacts slowly (in Chromium with software
  rendering on a busy machine, a frame took 2 to 10 s). Large raws (24 to 60 MP) make sliders and
  exports slow; a full-size 6000x4000 export took about 80 s with software rendering, with the
  app blocked. The whole original is held in memory inside a 32-bit address space.
- **The fail-closed path still writes the demo library.** If memory mode cannot be set, LightCraft
  has opened its storage before `started()` refuses: it writes its new demo library (catalog,
  `ui.json`, thumbnails, about 140 KB) to OPFS, asks for persistent storage and takes its Web
  Lock. No user file reaches the storage: the host never sends it.
- **A panic after `ready` is not reported.** LightCraft covers the page with its own message
  (which says that the library saved in the browser is kept, wrong in memory mode), and the host
  goes on showing the editor: the protocol has no message for an app that stops after `ready`.
  Before `ready` the adapter reports it as a startup error.
- **`delivered` is not "opened".** The host cannot tell whether LightCraft could read the file; a
  file it cannot import shows an error in the app only.
- **Raws are mostly untested.** The tests open one raw format, a small synthetic DNG; CR2, CR3,
  NEF, ARW, RAF, ORF, RW2, PEF and SRW are decoded by the same build but were not opened in a
  browser.
- **AVIF export does not work** on the web (compiled out), and Original files and DNG export do
  nothing; the dialog offers them.
- **Firefox is untested.** The headless Firefox of the test machines has no WebGL, and LightCraft
  draws with WebGL2.

## File types

For the Nextcloud app's list:

| Extension | Opens as | Offer | Default (a click in Files) |
|---|---|---|---|
| `dng`, `cr2`, `cr3`, `nef`, `nrw`, `arw`, `raf`, `orf`, `rw2`, `rwl`, `pef`, `srw` | the raw photo, decoded; exports are new files next to it | yes | yes: no common Nextcloud app opens camera raws |
| `jpg`, `jpeg`, `png`, `tif`, `tiff`, `webp` | the photo; exports are new files next to it | yes | no: the Viewer opens them, and PhotoCraft offers them too |

Match the extension in any letter case. Nextcloud 34 and 35 give `arw`, `cr2`, `dng`, `erf`, `iiq`,
`kdc`, `nef`, `orf`, `pef`, `raf` and `rw2` the type `image/x-dcraw`
(`resources/config/mimetypemapping.dist.json`), which the Viewer does not open; the other raws
are `application/octet-stream`. So the raws clash with no other app, and the Nextcloud app must
pick LightCraft by extension.

Not offered:

- `crw`, `mrw`, `x3f`, `iiq`, `erf`, `kdc`, `mos`, `3fr`, `fff`: they import as "preview only",
  so the user would develop the small embedded preview. `raw` is too generic an extension.
- `heic`, `heif`, `avif`: no decoder in the web build.
- `jxl`: decoded by the build, but untested.
- `psd`, `gif`, `bmp`: PhotoCraft's.

## Hosting notes

- LightCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks not to send
  `X-Frame-Options: DENY` or a `frame-ancestors` that excludes the embedding page. A sandboxed
  iframe needs `allow-scripts allow-same-origin allow-downloads allow-popups`; the
  `allow-modals` it also lists is for `?reset` and restoring a backup, which memory mode never
  does. Its `clipboard-read` suggestion is not needed: Copy and Paste Edit Settings stay inside
  the app. Isolation headers (COOP/COEP) are optional for 0.6.0.
- **Query flags.** The page reads `store`, `workers`, `reset` and `bench` (`web.rs:67-96`). The
  adapter sets `store=memory&workers=0` and removes `reset` and `bench` itself, so the configured
  app URL needs none of them.
- **Files to serve.** The release zip `lightcraft-web-0.6.0.zip` also holds the leftovers of the
  Cargo build: `build/` (23 MB), `deps/` (95 MB), `.fingerprint/`, the empty `incremental/` and
  `examples/`, and `.cargo-lock`, `.cargo-artifact-lock` and `.cargo-build-lock`. A hosting must
  not serve them. Serve `index.html`, `lightcraft_web.js`, `lightcraft_web_bg.wasm`, `worker.js`
  and `lightcraft_zh_hans.otf`, their `.br` and `.gz` copies if the server uses them, and the
  licences (`LICENSE-APACHE`, `LICENSE-MIT`, `NOTICE`, `OFL-*.txt`). `_headers` and `.htaccess`
  are sample server rules. With `workers=0`, `worker.js` is never loaded.
- **Size.** The `.wasm` file of 0.6.0 is 25.8 MB, 7.1 MB with Brotli and 10.0 MB with gzip
  (`HOSTING.md` says about 13 MB and 3 MB), and every start also fetches the 16.4 MB font
  (11.1 MB with Brotli): about 18 MB with Brotli per cold start. Serve both compressed. The file
  names are the same in every version, so send `Cache-Control: no-cache`, as `HOSTING.md` says.
- **Startup timeout.** Because of that download, give LightCraft `data-startup-timeout="180000"`
  on the translator's script tag: `inject-translator.sh --startup-timeout 180000` (see
  [hosting.md](../hosting.md#startup-timeout) and [Known gaps](#known-gaps)).
- A `.wasm` file that is missing or cannot be compiled (a `script-src` without
  `'wasm-unsafe-eval'`) makes the load fail, and the host gets `the app failed to load: ...`
  through the adapter. A Content-Security-Policy that blocks the inline module script leads to
  `the app did not start in time` (see [protocol.md](../protocol.md#errors)).
- Keyboard shortcuts reach the app after the user clicks into the frame.

## Tests

`lightcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`lightcraft-chromium` and `lightcraft-webkit`. The behaviour the core shares with every app
(fallback downloads, a foreign host) is tested in `translator.spec.ts` and `pdfcraft.spec.ts`;
this spec checks what depends on LightCraft.

The spec has three tests, and its header lists them with their scenarios. The first two are the
contract tests; the canary runs them apart from the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host whose app URL asks for `store=opfs&workers=3&reset&bench`: the frame runs with `store=memory&workers=0`, and `web.stats` reports memory and no workers. The handshake with the served app version, then the open of a JPEG. After an edit (Rotate Right), Ctrl+S sends nothing; Export arrives as an export under the opened name, a JPEG with the edit; after a second edit, Export with Previous (Ctrl+E) arrives as an export again, with both edits; a demo photo exported under the opened name is an export too. The browser's storage stays empty, and nothing becomes a browser download, also not after the deadlines for the host's confirmation and result (20 s each here, not 3 s as in the other specs: the translator's timers run on the page's thread, which LightCraft blocks for seconds at a time, and a frame longer than the result deadline right after an export made the translator give the save up). When memory mode cannot be set (`history.replaceState` blocked), the host gets `the app would keep the photo in browser storage (...)` and never sends the photo; an aborted `.wasm` reaches the host as `the app failed to load: ... LightCraft failed to load: ...` within 30 s. |
| `saved-as` | An opened TIFF exported as TIFF arrives under its own name as an export (not as the document, and not as a copy that the next export would replace); a different TIFF with the same name, brought in with File > Import Photos…, exports under that name as an export too. An opened DNG is decoded as a raw photo (`photo.inspect` has no `preview_only`) and exports as `probe-raw.jpg` at the mosaic's size, an export. |
| `ui` (`@ui`) | The paths that need the pointer: File > Export…, a folder typed into the dialog, OK: an export under the opened name; File > Export with Previous: another export. |

A test with several scenarios runs each in a page of its own and reports every scenario that
fails as `scenario failed: <title>`, not only the first.

LightCraft has no command palette, and its Export dialog cannot be confirmed with the keyboard.
The tests use LightCraft's shortcuts (Ctrl+] Rotate Right and Left Previous Photo from
`engine/src/cmd/library.rs`, Ctrl+S from `engine/src/cmd/xmp.rs`, Ctrl+E and Ctrl+Shift+I from
`ui-egui/src/shortcuts.rs` and `menus.rs`) and its automation call: `app.export` (what the Export
dialog's OK runs) with a folder, for the first export and for formats, and `photo.inspect` and
`web.stats` to wait for what the app shows. They never wait for fixed times. With `workers=0`
every session first renders the demo thumbnails on the page's thread, one per frame, so key
presses and automation calls can take seconds each for a minute or two in Chromium with
software rendering; the tests are marked slow.

Only the `ui` test clicks with the pointer. egui takes a press and a release more than 0.8 s
apart on its frame clock for a long press, so with frames of seconds a click can be lost; the
test first waits until LightCraft has rendered everything it queued (`web.stats`), then hovers
each target for a frame before it clicks. Its click positions are in the `AT` table of the spec,
measured on 0.6.0 at a **1400x1400** viewport with the locale `en-US`: the Export dialog is taller
than the frame at 1400x900, and egui centres it in the frame, so its positions depend on the
frame's height. The File menu has no scroll arrows at that size. When a new release fails the
canary:

- **Contract tests fail.** The release changed something the translator relies on: the URL
  options `store` and `workers`, `web.stats` or the automation call (the host then gets a startup
  error and nothing opens: the adapter fails closed), the failure texts, the drop handling or the
  download helper. Sites that host the app should hold the release back until the adapter is
  fixed.
- **Only the `@ui` test fails.** A menu item or the dialog moved. Re-measure the positions in
  `AT`; the translator is not at fault.
- **A shortcut or command changed upstream.** The tests that use it fail: Ctrl+], Ctrl+S, Ctrl+E,
  Left and Ctrl+Shift+I, and the commands `app.export`, `photo.inspect` and `web.stats`. Check
  them against the files above before holding a release back.

The fixtures are written by
[`tests/e2e/fixtures/lightcraft/make-fixtures.mjs`](../../tests/e2e/fixtures/lightcraft/make-fixtures.mjs):
a 120x80 JPEG (encoded with Chromium's canvas), a 90x60 TIFF, a different 64x64 TIFF under the
same name, and a 96x64 DNG with an uncompressed RGGB mosaic. Their sizes tell the tests which
photo an export shows, and swapped width and height that the rotation was applied.

## Upstream

LightCraft has no embedding API for another origin: `globalThis.lightcraft.command` is same-origin
only. With one, as requested for PdfCraft in
[storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422) and proposed for
PhotoCraft in [pull request #2263](https://github.com/storytold/photocraft/pull/2263), the open
and export paths would no longer depend on drops and downloads; see
[architecture.md](../architecture.md#native-embedding-apis). Worth asking upstream for:

- an XMP sidecar as a download on the web (and reading one dropped with the photo), so that the
  edits of a photo could be kept in Nextcloud as `photo.xmp`;
- render workers that work in memory mode (passing the photo's bytes), so that `workers=0` is no
  longer needed;
- a start in memory mode without the demo photos, for embedding;
- Export on the web without a folder;
- a ready signal (such as `TrunkApplicationStarted`) and an error event on a failed load, start
  or panic, and a panic message that does not claim a stored library in memory mode;
- `HOSTING.md`: the sizes, and a release zip without the Cargo build leftovers.
