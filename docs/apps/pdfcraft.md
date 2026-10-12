<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# PdfCraft

| | |
|---|---|
| Upstream | [github.com/storytold/pdfcraft](https://github.com/storytold/pdfcraft) |
| Adapter | [`translators/pdfcraft.js`](../../translators/pdfcraft.js) |
| Tested version | `tested` in [`tests/e2e/craft-versions.json`](../../tests/e2e/craft-versions.json) (0.5.0 when this page was written, checked again with 0.6.0) |
| Tests | [`tests/e2e/specs/pdfcraft.spec.ts`](../../tests/e2e/specs/pdfcraft.spec.ts) (Chromium and WebKit, see [Tests](#tests)), plus [`tests/e2e/specs/translator.spec.ts`](../../tests/e2e/specs/translator.spec.ts) against a stub app that imitates PdfCraft: every scenario in Chromium, those that depend on the browser also in Firefox and WebKit |

This page records what the PdfCraft web build does in the browser, as far as the translator
depends on it, and how the adapter follows from it. The facts were checked against the 0.6.0
source and web build (first written for 0.5.0); source references are to the `v0.6.0` tag.
Upstream may change any of them; the daily canary run (see
[development.md](../development.md#continuous-integration)) is there to notice.

## What the web build does

**Opening**

- It takes dropped files on its canvas (`canvas#pdfcraft`, through eframe). The drop handler does
  not check `isTrusted`, so the translator's simulated drop works like a user's drop. The core's
  default drop target fits; the adapter needs no `dropTarget`.
- `?file=<url>` opens a PDF on startup, if the URL is same-origin or allows the app's origin
  through CORS. The layer does not use it: the host sends the bytes instead, so Nextcloud never
  has to serve files to another origin.
- Since 0.6.0, `?host=parent` turns on a `postMessage` bridge for a parent page on the app's own
  origin (`apps/pdfcraft-web/src/main.rs:57-73`, `:122-246`): the parent sends files
  (`pdfcraft:open`), and Save posts the bytes to the parent (`pdfcraft:save`) instead of
  downloading them (`crates/ui-egui/src/editing.rs:419-425`). The layer runs the app on an origin
  of its own, so it cannot use the bridge and does not turn it on; see
  [Hosting notes](#hosting-notes) for why the app URL must not contain `host=parent`.
- There is no JavaScript-visible signal that a file was opened, could not be opened, or has
  unsaved changes. A broken file shows an error inside the app; the host only gets `delivered`.
  Since 0.6.0 PdfCraft cancels the `beforeunload` event while a document has unsaved changes
  (`apps/pdfcraft-web/src/main.rs:54-56`, `:89-101`). Chromium then asks before the page that
  frames the app is left; WebKit did not ask in the same check (the test host, an edit, then a
  navigation of the page). The host still learns nothing.

**Saving and downloads**

- Every download goes through one helper (`crates/ui-egui/src/editing.rs:684-700`, unchanged in
  0.6.0): a `Blob` with type `application/pdf` (even for `.docx`, `.csv`, `.xfdf` or `.png`),
  `URL.createObjectURL`, a detached `<a download>`, `click()`, then the URL is revoked at once.
  The type says nothing, so the translator keeps the `Blob` from `createObjectURL` and the `save`
  message carries no MIME type.
- Firefox gives a download typed `application/pdf` a `.pdf` extension, so it saves the app's own
  exports as, for example, `<stem>.pdf` instead of `<stem>.docx` (checked with the stub app,
  which downloads the same way). The translator's fallback download is a copy typed
  `application/octet-stream`, which keeps the name in every engine.
- Save and Save As write the document's name exactly as it was opened (no `.pdf` appended,
  `crates/ui-egui/src/editing.rs:382`, `:424`). Usually they write an incremental update: the
  original bytes plus an appended section. PdfCraft then marks the document saved and shows
  "Downloaded <name>" (`editing.rs:426-437`), without knowing whether the host stored it.
- Save rewrites the whole file instead after redaction, Sanitize document, Remove hidden
  information or a security change (a password added or removed), and for a file PdfCraft
  repaired on open (damaged cross-reference data): the previous revision would still hold what
  was removed (`crates/cos/src/writer.rs:184-187`, `crates/redact/src/lib.rs:420-422`,
  `crates/redact/src/sanitize.rs:385`, `:394`, `crates/cos/src/document.rs:315-326`). PdfCraft
  then goes on editing the bytes it wrote (`crates/engine/src/lib.rs:2722-2734`, `mark_saved`), so
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
| Split document, Extract pages | the parts' names; Extract pages also takes a name typed in its dialog (`crates/ui-egui/src/files.rs:451-462`, `:495`) | `export` |
| Export to Image | the images' names | `export` |
| Export measurements as CSV | `measurements.csv` | `export` |
| Action Wizard | the document's name, file rewritten (`crates/ui-egui/src/actions_ui.rs:110`) | `export`; signed PDFs see [known gaps](#known-gaps) |
| Recognize Text on several files | each input file's name | `export`, unless the result extends the stored bytes |
| Attachment opened in a tab, then saved | the attachment's own name, taken from the document (`crates/ui-egui/src/lib.rs:1080-1084`) | `export` (name sanitised) |

`<stem>` is the document's name without its extension. Any download whose name differs from the
opened document's is an `export`.

**Links**

- Links such as About > Contributors are egui hyperlinks (`crates/ui-egui/src/credits.rs:280`,
  `:307`), which eframe opens with `window.open` and target `_self`. In a frame that would
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

## Interface language

The Nextcloud app can name the language an app starts in (its setting *Starts in*). The editor
page passes it in the frame's address (`#craftsuite-layer:lang=<tag>`), and the core hands it to
the adapter's `language` member before the app's module runs (see [protocol.md](../protocol.md#host-settings)).

**How PdfCraft picks it**

- Only from its own preferences: the JSON it keeps in `localStorage` under `pdfcraft` (or, saved
  under its former name, `printcraft`), read once as the app is created
  (`apps/pdfcraft-web/src/main.rs:27-29`). Their field `language` counts if it is `auto` or one of
  PdfCraft's codes (`de`, `pt-br`, ...) in any letter case (`crates/ui-egui/src/lib.rs:1454-1456`,
  `crates/ui-egui/src/i18n/mod.rs:260-265`); anything else, such as `de-AT`, leaves the default
  `auto` (`lib.rs:720`).
- `auto` means English on the web, whatever the browser's language: the web build detects no
  system language (`i18n/mod.rs:360-363`), and PdfCraft reads neither `navigator.language(s)` nor
  its address for it. Its fallbacks from locale tags (`de-AT` to `de`, `pt-PT` to `pt-br`, `zh-TW`
  to `zh-hant`, `i18n/mod.rs:269-297`) serve only the system locale of the desktop builds.
- Menu > Edit > Preferences… (Ctrl+,) > Interface language offers Auto and all 17 languages
  (`crates/ui-egui/src/js_ui.rs:234-254`). A choice applies at once and is stored with the other
  preferences, which PdfCraft writes back whole (`lib.rs:1362-1375`, `:1880-1882`) every 30
  seconds and whenever it loses the focus, also when its page is hidden or unloaded while it has
  the focus (eframe 0.36.2 `src/web/events.rs:58`, `:68-69`, `:112-140`,
  `src/web/app_runner.rs:237-247`; eframe's own save on close listens for an event named
  `onbeforeunload`, which never fires, `src/web/events.rs:423`). So a value written into its
  preferences while PdfCraft runs does not last: PdfCraft writes its own over it.

**What the adapter does**

- Before PdfCraft's module runs, it maps the host's language to a key of its `LANGUAGES` table
  (the same tag, else the same language and script: `de-AT` gives `de`, `pt-PT` gives `pt-BR`),
  writes PdfCraft's code into the field `language` of the preferences (keeping the other fields,
  and starting from `printcraft` if `pdfcraft` is missing), and adds that code to a list in a key
  of its own, `craftsuite-layer:pdfcraft:language` (its mark): every code it has written, because
  a PdfCraft that is still open writes its preferences back from memory (every 30 s and when it
  loses the focus), so a language of an earlier start can come back after a later start wrote
  another. `ready` names the language it applied (for `pt-PT`: `pt-BR`).
- It writes only while the stored language is missing, `auto` or in its mark. Any other value is
  a choice the user made in the app: the adapter leaves it, and `ready` names no language.
- Without a host language, or with one PdfCraft does not offer (below), it sets a language it
  wrote back to `auto` and removes its mark, so PdfCraft starts as without the layer; a user's own
  choice stays. With preferences that are not readable JSON, or with `localStorage` blocked, it
  writes nothing.

**Languages**

The settings offer `en`, `ar`, `bg`, `cs`, `de`, `es`, `fr`, `hu`, `it`, `ja`, `pl`, `pt-BR`, `ru`
and `uk`, the keys of the adapter's `LANGUAGES` table. All of them were checked in the web build:
translated and drawn correctly (Arabic right to left), except Czech, which is translated only in
part (159 entries in `crates/ui-egui/src/i18n/cs.tsv`, about 2,170 in `de.tsv`): `Nabídka` and
`Úpravy`, but `All tools`, `Read` and `Open`. Left out are the three languages the web build
cannot draw: Simplified Chinese (many characters as boxes), Traditional Chinese (boxes in common
labels such as Open and Read) and Telugu (boxes only).

**A language the user picks in the app**

It is stored in the frame's `localStorage` and wins at every later start, also over a changed
setting: the adapter tells it from its own values by the mark. Auto counts as no choice, so the
next start has the host's language again. A choice equal to a language the adapter wrote cannot
be told apart from it, so that user follows a later change of the setting. Where the browser
blocks third-party storage, nothing is kept: PdfCraft starts in English every time, and a choice
made in it lasts only as long as the frame. In the same-site setup [hosting.md](../hosting.md#a-sign-in-in-front-of-the-apps) recommends
(`craft.example.com` next to `cloud.example.com`), browsers do not partition the frame's storage,
so it is the same as when the app is opened directly on its own site: the host's language, and a
choice made in either place, apply to both.

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
  warn on close. PdfCraft's own `beforeunload` question (since 0.6.0, see
  [Opening](#what-the-web-build-does)) tells the host nothing and comes only from some browsers.
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
- The web build (0.5.0 and 0.6.0) renders with WebGL2 (eframe's glow renderer,
  `apps/pdfcraft-web/Cargo.toml`). Without WebGL2 it cannot run, and the translator reports
  `the app registered no drop target`. `HOSTING.md` also mentions WebGPU and `?webgl`/`?cpu`
  flags; the build does not read them.
- The configured app URL must not contain `host=parent`. With it, PdfCraft 0.6.0 posts every
  Save to its parent on the app's own origin instead of downloading it and marks the document
  saved (`crates/ui-egui/src/editing.rs:419-439`). Under a parent on another origin, such as
  Nextcloud, the browser drops that message without an error, so the save reaches neither the
  translator nor the user.
- The loader is Trunk's inline module script in `index.html`. It imports
  `pdfcraft-web-<hash>.js`, awaits the `.wasm` module at its top level and then dispatches
  `TrunkApplicationStarted`; `index.html` also preloads both files with integrity hashes. A
  `.wasm` file that is missing or cannot be compiled makes the loader fail, and the host gets
  `the app failed to load: ...`; a Content-Security-Policy that blocks the inline script leads to
  `the app did not start in time` (see [protocol.md](../protocol.md#errors)).
- Preferences live in the frame's `localStorage`, the interface language among them (see
  [Interface language](#interface-language)). Browsers that partition or block third-party
  storage may forget them between visits.
- Keyboard shortcuts reach the app after the user clicks into the frame.

## Tests

`pdfcraft.spec.ts` runs the translator inside the real web build, in the Playwright projects
`pdfcraft-chromium` and `pdfcraft-webkit`. `pdfcraft-webkit` has passed only outside GitHub so
far, so neither CI nor the canary lets it decide a run until it has passed on a GitHub runner
(see [development.md](../development.md#continuous-integration)).

The spec has seven tests, and its header lists them with their scenarios. The first five are the
contract tests; the canary runs them apart from the `language` test (tagged `@language`) and the
`@ui` test.

| Test | What it checks |
|---|---|
| `contract` | An allowed host: the handshake with the served app version, then the open. An edit saved with Ctrl+S arrives as the document, and a second save extends the stored bytes. A link with target `_self` opens a new window and the editor stays in the frame. Export to Word arrives as an export. After Sanitize document (confirmed with Tab and Enter), Save rewrites the file and arrives as an export under the opened name; the next Save extends it and arrives as the document with `follows` set to that export. Nothing becomes a browser download, also not after the deadlines for the host's confirmation and result. |
| `fallbacks` | A host that never confirms: the save becomes a download after the confirmation timeout. A host that reports a failed store: the save is downloaded at once, with the edit. |
| `inactive` | At top level, and under a host on an origin that is not allowed (which sends forged `init` and `open` messages), the translator stays inactive and Save is an ordinary download. |
| `startup` | The `.wasm` module cannot load: the host gets one error, of `startup`, saying `the app failed to load: ...`, and no `ready`. |
| `blank` | The blanks of the "+ New" entry in Files (`craftsuite_layer/assets/blank.pdf` on A4 and `blank-letter.pdf`) open, and their first save (Ctrl+S, no edit) arrives as the document under the opened name (no `follows`); nothing becomes a browser download. |
| `language` | The host's language `de`: `ready` names it, PdfCraft's preferences hold `de` with the adapter's mark, and the command palette finds the German `Öffnen…` (Open…), which opens the file chooser (in English nothing matches). Then a language the user picked in the app (`fr`, stored while no PdfCraft runs) stays: the next start with `de` leaves it, and `ready` names no language. |
| `ui` (`@ui`) | The paths that need pointer clicks: the toolbar Save button saves the document; an Action Wizard result under the document's own name arrives as an export; the attachment `../../Team/Budget 2026.pdf` arrives as `Budget 2026.pdf`; the link to a contributor in About > Contributors opens a new window and the editor stays. |

A test with several scenarios (`fallbacks`, `inactive`, `ui`) runs each in a page of its own and
reports every scenario that fails as `scenario failed: <title>`, not only the first.

The tests drive PdfCraft with the keyboard and the command palette, typing the English command
labels from PdfCraft's `crates/engine/src/commands.rs`; the `language` test types the German
`Öffnen`, from `crates/ui-egui/src/i18n/de.tsv`. Only the `ui` test also clicks with the
pointer; its click positions are in the `AT` table of the spec, measured on 0.5.0 (and still
right in 0.6.0) at a 1400x900 viewport with the locale `en-US` and PdfCraft in English (no host
language: German moves things). It runs with a longer time limit (`test.slow()`), so that a
path that misses its button can run into its waits and every such path still gets reported.
When a new release fails the canary:

- **Contract tests fail.** The release changed something the translator relies on (see
  [architecture.md](../architecture.md#upstream-coupling-points)). Sites that host the app should hold the
  release back until the adapter or the core is fixed.
- **Only the `@ui` test fails.** A button or panel moved. Re-measure the positions in `AT` for
  the paths it reports; the translator is not at fault.
- **Only the `language` test fails.** If only its palette check fails, check the German label
  (below). Otherwise PdfCraft no longer takes its language as described in
  [Interface language](#interface-language): files still open and save, but the start language
  does not apply until the adapter's `language` member is updated.
- **A command label changed upstream.** The palette then runs another command or none, and the
  tests that run it fail: for `Rotate pages clockwise`, `Export to Word` and `Sanitize document`
  these are contract tests, for `Prepare for distribution` and `About PdfCraft` the `@ui` test,
  and for the German `Öffnen…` (`Open…` in `de.tsv`) the `language` test. Before holding a
  release back for a failing test that runs a command, check its label against `commands.rs`
  (or `de.tsv`) and update it in the spec. The Sanitize document dialog is confirmed with Tab
  (the focus to its first button, Sanitize) and Enter; should a release reorder its buttons, the
  save after it is an update instead of a rewrite, and the contract test says so.

## Upstream

An embedding API for the web build is requested in
[storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422) (open, no response as
of 2026-10-10). With such an API, the open and save paths would no longer depend on drops and
downloads; see [architecture.md](../architecture.md#native-embedding-apis).

PdfCraft 0.6.0 has a first such bridge (`?host=parent`, see
[Opening](#what-the-web-build-does)), but only for a parent page on the app's own origin: it
posts to and hears from that origin alone. PdfCraft marks the document saved as soon as
`pdfcraft:save` is posted; the parent reports a failed store itself. The bridge also reports
unsaved changes (`pdfcraft:dirty`), which the translator cannot see. A host on another origin, as
Nextcloud is for the layer, would need the bridge to accept a configured parent origin.
