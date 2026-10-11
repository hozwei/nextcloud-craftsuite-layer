<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# PdfCraft

| | |
|---|---|
| Upstream | [github.com/storytold/pdfcraft](https://github.com/storytold/pdfcraft) |
| Adapter | [`translators/pdfcraft.js`](../../translators/pdfcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.5.0 when this page was written) |
| Tests | [`tests/e2e/specs/pdfcraft.spec.ts`](../../tests/e2e/specs/pdfcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)), plus [`tests/e2e/specs/translator.spec.ts`](../../tests/e2e/specs/translator.spec.ts) against a stub app that imitates PdfCraft: every scenario in Chromium, those that depend on the browser also in Firefox and WebKit |

This page records what the PdfCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.5.0
source and web build. Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#pdfcraft`, through eframe). The drop handler does
  not check `isTrusted`, so the translator's simulated drop works like a user's drop. The core's
  default drop target fits; the adapter needs no `dropTarget`.
- `?file=<url>` opens a PDF on startup, if the URL is same-origin or allows the app's origin
  through CORS. The layer does not use it: the host sends the bytes instead, so Nextcloud never
  has to serve files to another origin.
- There is no JavaScript-visible signal that a file was opened, could not be opened, or has
  unsaved changes. A broken file shows an error inside the app; the host only gets `delivered`.

**Saving and downloads**

- Every download goes through one helper: a `Blob` with type `application/pdf` (even for
  `.docx`, `.csv`, `.xfdf` or `.png`), `URL.createObjectURL`, a detached `<a download>`, `click()`,
  then the URL is revoked at once. The type says nothing, so the translator keeps the `Blob` from
  `createObjectURL` and the `save` message carries no MIME type.
- Firefox gives a download typed `application/pdf` a `.pdf` extension, so it saves the app's own
  exports as, for example, `<stem>.pdf` instead of `<stem>.docx` (checked with the stub app,
  which downloads the same way). The translator's fallback download is a copy typed
  `application/octet-stream`, which keeps the name in every engine.
- Save and Save As write the document's name exactly as it was opened (no `.pdf` appended).
  Usually they write an incremental update: the original bytes plus an appended section. PdfCraft
  then marks the document saved and shows "Downloaded <name>", without knowing whether the host
  stored it.
- Save rewrites the whole file instead after redaction, Sanitize document, Remove hidden
  information or a security change (a password added or removed), and for a file PdfCraft
  repaired on open (damaged cross-reference data): the previous revision would still hold what
  was removed (`crates/cos/src/writer.rs:184-187`, `crates/redact/src/lib.rs:419-421`,
  `crates/redact/src/sanitize.rs:385`, `:394`, `crates/cos/src/document.rs:315-326`). PdfCraft
  then goes on editing the bytes it wrote (`crates/engine/src/lib.rs:2576-2588`, `mark_saved`), so
  every later Save appends to those, not to the opened file.
- Other downloads have other names, or rewrite the file. Examples:

| Download | Name | Kind |
|---|---|---|
| Save (Ctrl+S), Save As | the document's name, incremental update | `document` |
| Save after redaction, Sanitize document, Remove hidden information or a security change, or of a repaired file | the document's name, file rewritten | `export` (a new file); every later Save `document` with `follows`, see below |
| Print | `<stem> (print).pdf` | `export` |
| Reduce file size, PDF Optimizer | `<stem> (reduced).pdf`, `<stem> (optimized).pdf` | `export` |
| Export to Word, HTML, RTF | `<stem>.docx`, `<stem>.html`, `<stem>.rtf` | `export` |
| Export form data | `<stem>.xfdf` | `export` |
| Split document, Extract pages | the parts' names | `export` |
| Export to Image | the images' names | `export` |
| Export measurements as CSV | `measurements.csv` | `export` |
| Action Wizard | the document's name, file rewritten | `export`; signed PDFs see [known gaps](#known-gaps) |
| Recognize Text on several files | each input file's name | `export`, unless the result extends the stored bytes |
| Attachment opened in a tab, then saved | the attachment's own name, taken from the document | `export` (name sanitised) |

`<stem>` is the document's name without its extension. Any download whose name differs from the
opened document's is an `export`.

**Links**

- Links such as About > Contributors use `window.open` with target `_self`. In a frame that would
  replace the editor; the translator opens them in a new window instead.

## How the adapter classifies

The core calls the adapter only for a download whose sanitised name equals a file opened in the
frame. The adapter returns `document` if the name is the same and the bytes start with exactly
the bytes last stored for that file (the opened bytes, or those of the last save the host
confirmed). Otherwise `export`.

The name alone is not enough, because the Action Wizard also downloads under the document's own
name but rewrites the file. The prefix check tells the two apart.

A Save that rewrites the whole file (see above) fails the prefix check too and becomes an
`export`: the opened file is not replaced by bytes that are not an update of it. Because PdfCraft
goes on editing what it wrote, the adapter sets `continuesExports`: the core remembers each
`export` it sends under the opened name (and forgets one the host did not store), and
sends a later save under that name whose bytes start with such an export as `document` of the
open, with `follows` set to that export's `id` (see
[protocol.md](../protocol.md#continued-exports)). The Action Wizard's results are never extended
by PdfCraft's own Save, so this adds nothing for them. The Nextcloud editor page stores the first
rewritten Save as a new file next to the original (`x (2).pdf`), and every later Save that
continues it replaces that new file.

## Known gaps

- **After redaction or Sanitize, the original stays as it was.** The rewritten Save goes to a new
  file, and later saves go there too. The opened file keeps exactly the content the user removed,
  until the user deletes it or replaces it with the new file; the editor page says only that the
  save went to a new file. Nextcloud's file versions (where enabled) also keep older states of
  the original.
- **Action Wizard on a signed PDF.** To keep the signatures, the wizard writes an incremental
  update for a signed file, so its result passes as `document` and may replace the opened file.
  The result still begins with the opened bytes, and Nextcloud's file versions (where enabled)
  keep the previous state.
- **No unsaved-changes signal.** The host cannot tell whether the user has unsaved edits and must
  warn on close.
- **`delivered` is not "opened".** The host cannot tell whether PdfCraft could read the file.
- **Saved means downloaded.** PdfCraft marks the document saved when the download starts. If the
  host cannot store the file, the translator's fallback browser download is the copy the user
  keeps. The Nextcloud editor page relies on that download and offers no retry of its own; it
  says in its status line why the file was not stored.

## Hosting notes

- PdfCraft's `HOSTING.md` (in the web build) allows cross-origin iframes and asks for no special
  headers (no COOP/COEP). It asks not to send `X-Frame-Options: DENY` or a `frame-ancestors`
  that excludes the embedding page. For a sandboxed iframe it needs at least
  `allow-scripts allow-same-origin allow-downloads allow-popups`.
- The 0.5.0 web build renders with WebGL2 (eframe's glow renderer). Without WebGL2 it cannot run,
  and the translator reports `the app registered no drop target`. `HOSTING.md` also mentions
  WebGPU and `?webgl`/`?cpu` flags; the 0.5.0 build does not read them.
- The loader is Trunk's inline module script in `index.html`. It imports
  `pdfcraft-web-<hash>.js`, awaits the `.wasm` module at its top level and then dispatches
  `TrunkApplicationStarted`; `index.html` also preloads both files with integrity hashes. A
  `.wasm` file that is missing or cannot be compiled makes the loader fail, and the host gets
  `the app failed to load: ...`; a Content-Security-Policy that blocks the inline script leads to
  `the app did not start in time` (see [protocol.md](../protocol.md#errors)).
- Preferences live in the frame's `localStorage`. Browsers that partition or block third-party
  storage may forget them between visits.
- Keyboard shortcuts reach the app after the user clicks into the frame.

## Tests

`pdfcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`pdfcraft-chromium` and `pdfcraft-webkit`. `pdfcraft-webkit` has passed only outside GitHub so
far, so neither CI nor the canary lets it decide a run until it has passed on a GitHub runner
(see [development.md](../development.md#continuous-integration)).

The spec has five tests, and its header lists them with their scenarios. The first four are the
contract tests; the canary runs them apart from the `@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open. An edit saved with Ctrl+S arrives as the document, and a second save extends the stored bytes. A link with target `_self` opens a new window and the editor stays in the frame. Export to Word arrives as an export. After Sanitize document (confirmed with Tab and Enter), Save rewrites the file and arrives as an export under the opened name; the next Save extends it and arrives as the document with `follows` set to that export. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `fallbacks` | A host that never confirms: the save becomes a download after the confirmation timeout. A host that reports a failed store: the save is downloaded at once, with the edit. |
| `inactive` | At top level, and under a host on an origin that is not allowed (which sends forged `init` and `open` messages), the translator stays inactive and Save is an ordinary download. |
| `startup` | The `.wasm` module cannot load: the host gets one error, of `startup`, saying `the app failed to load: ...`, and no `ready`. |
| `ui` (`@ui`) | The paths that need pointer clicks: the toolbar Save button saves the document; an Action Wizard result under the document's own name arrives as an export; the attachment `../../Team/Budget 2026.pdf` arrives as `Budget 2026.pdf`; the link to a contributor in About > Contributors opens a new window and the editor stays. |

A test with several scenarios (`fallbacks`, `inactive`, `ui`) runs each in a page of its own and
reports every scenario that fails as `scenario failed: <title>`, not only the first.

The tests drive PdfCraft with the keyboard and the command palette, typing the English command
labels from PdfCraft's `crates/engine/src/commands.rs`. Only the `ui` test also clicks with the
pointer; its click positions are in the `AT` table of the spec, measured on 0.5.0 at a 1400x900
viewport with the locale `en-US`. It runs with a longer time limit (`test.slow()`), so that a
path that misses its button can run into its waits and every such path still gets reported.
When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on (see
  [architecture.md](../architecture.md#upstream-coupling-points)). Sites that host the app should hold the
  release back until the adapter or the core is fixed.
- **Only the `@ui` test fails.** A button or panel moved. Re-measure the positions in `AT` for
  the paths it reports; the translator is not at fault.
- **A command label changed upstream.** The palette then runs another command or none, and the
  tests that run it fail: for `Rotate pages clockwise`, `Export to Word` and `Sanitize document`
  these are contract tests, for `Prepare for distribution` and `About PdfCraft` the `@ui` test.
  Before holding a release back for a failing test that runs a command, check its label against
  `commands.rs` and update it in the spec. The Sanitize document dialog is confirmed with Tab
  (the focus to its first button, Sanitize) and Enter; should a release reorder its buttons, the
  save after it is an update instead of a rewrite, and the contract test says so.

## Upstream

An embedding API for the web build is requested in
[storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422) (open, no response as
of 2026-10-10). With such an API, the open and save paths would no longer depend on drops and
downloads; see [architecture.md](../architecture.md#native-embedding-apis).
