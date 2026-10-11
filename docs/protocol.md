<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Message protocol (version 1)

The host page (the Nextcloud editor page, or the test host in `tests/e2e/host/`) and the
translator inside the framed Craft app talk with
[`window.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).
This page describes what `translators/core.js` does. Configuration of the translator is in
[translators/README.md](../translators/README.md), the reasons behind the rules in
[security.md](security.md).

## Envelope

Every message in both directions is a plain object with these fields:

| Field | Value |
|---|---|
| `protocol` | `"craftsuite-layer"` |
| `version` | `1` |
| `type` | the message type, see below |
| `app` | translator to host only: the adapter's app id, for example `"pdfcraft"` |

File contents travel as an `ArrayBuffer` in `data` and are transferred, not copied.

The translator ignores a message unless all of these hold:

- it comes from `window.parent` (`event.source`),
- `protocol` and `version` match exactly,
- before the handshake: it is `init` and its origin is in the allowlist,
- after the handshake: its origin is the one that sent the accepted `init`.

Unknown message types and extra fields are ignored.

## Sequence

```text
host (Nextcloud page)                    translator (inside the Craft app frame)
  frames the configured Craft URL
                                   <---  hello        at once, then every 1 s, at most 30 times,
                                                      addressed to each allowed origin
  init                             --->               accepted once: from window.parent,
                                                      from an allowed origin
                                   <---  ready        once the app can take files
  open {id, name, mime, data}      --->               handed to the app as a dropped file
                                   <---  delivered {id, name, size}

  ... the user edits; the app starts a download (Save, Export, ...) ...

                                   <---  save-started {id, name}
                                                      at once, before the file is read
                                   <---  save {id, kind, openId, follows, name, size, data}
  save-received {id}               --->               within data-save-ack-timeout
  save-result {id, ok, error?}     --->               within data-save-result-timeout
```

## Translator to host

| Type | Fields | When |
|---|---|---|
| `hello` | `layerVersion` | When the adapter registers, then every second until an `init` is accepted, at most 30 times. Posted once per allowed origin with that origin as `targetOrigin`, so the browser delivers it only to an allowed parent. |
| `ready` | `appVersion`, `layerVersion` | Once, after `init` was accepted and the app can take files: it has registered its drop target and, for an adapter with a `started` check, that check has passed. `appVersion` is the hosting's `data-app-version`, or `null`. |
| `delivered` | `id`, `name`, `size` | After an `open` was handed to the app. `id` is the host's open id, `name` the sanitised name. It means the drop was dispatched, not that the app could open the file. |
| `save-started` | `id`, `name` | At once when the app starts a download that becomes a save, before the translator reads and hashes the file. `id` and `name` are those of the `save` that follows. It tells the host that a save is coming, so that it does not let the page be left while a large file is still being read. Hosts may ignore it. A `save` with the same `id` follows, or an `error` of `save` if the translator gives up on the save first (for example when it cannot read the file). |
| `save` | `id`, `kind`, `openId`, `follows`, `name`, `size`, `data` | The app started a download. See [Saves](#saves). |
| `error` | `of`, `id`, `message` | See [Errors](#errors). |

`layerVersion` is the translator's version (currently `0.1.0`).

## Host to translator

| Type | Fields | Effect |
|---|---|---|
| `init` | none | Completes the handshake. Accepted only before the handshake, only from `window.parent` and only from an allowed origin. The host may send it before any `hello` arrives (the test host also sends it on the iframe's `load` event). The accepted origin stays fixed until the page in the frame is reloaded; later `init` messages are ignored. |
| `open` | `id`, `name`, `mime`, `data` | Opens a file in the app. `name` must be a string and `data` an `ArrayBuffer`, or the message is ignored. `id` is chosen by the host and echoed back. `mime` is optional. |
| `save-received` | `id` | The host has the bytes of save `id`. Switches that save's timer from the acknowledgement timeout to the result timeout. Each `save-received` restarts the result timer, so a host that needs longer to store a file (a slow upload) may repeat it as a keep-alive, for example every minute. |
| `save-result` | `id`, `ok`, `error` | The outcome of save `id`. Only `ok: true`, the boolean, means stored and ends it. Any other `ok` (`false`, missing, `1`, `"true"`) is a failure: the translator reports `error` of `save` and downloads the file in the browser; `error` is an optional text. Results for unknown or already finished ids are ignored. |

### Open

The translator waits until the app can take files (an `open` that arrives after the handshake
but before that is held until then). It records the sanitised name with the length and SHA-256
hash of the bytes, the document identity the adapter reads from them (its `identity`, if it has
one), and the name the app will save the file under (the adapter's `savedName`, the opened name
if it has none). It builds a `File` (sanitised name, `mime` or an empty type, current time as
`lastModified`), dispatches `dragover` and `drop` with it at the centre of the drop target, and
sends `delivered`.

The record is kept per name: two files with the same name opened in one frame share one record,
and the later `open` replaces it. Hosts should open one file per frame.

The Craft apps give no signal that a file was opened, could not be opened, or has unsaved
changes (see [apps/pdfcraft.md](apps/pdfcraft.md)), so the protocol has none.

### Saves

Every download the app starts after the handshake becomes a `save`, if it is an
`<a download>` element whose `click()` is called and whose `href` is a `blob:` URL the page
created from a `Blob` with `URL.createObjectURL` and has not revoked yet. Other downloads stay
browser downloads. The translator announces each save at once with `save-started`, then reads,
hashes and classifies the file and sends the `save`.

| Field | Value |
|---|---|
| `id` | Assigned by the translator: 1, 2, 3, ... per page load, in the order the app started the downloads. `save` messages arrive in this order: the translator reads, hashes and classifies saves in parallel, but posts each only after every earlier one. A host that stores saves in the order they arrive therefore never lets an older save replace a newer one. |
| `kind` | `"document"` or `"export"`, see below |
| `openId` | For `document`: the `id` of the `open` whose file this replaces. For `export`: `null`. |
| `follows` | For a `document` that continues an export: the `id` of that export, see [Continued exports](#continued-exports). Otherwise `null`. |
| `name` | The download name, sanitised |
| `size` | Byte length of `data` |
| `data` | The file as an `ArrayBuffer` (transferred) |

There is no MIME type: PdfCraft labels every download `application/pdf`, so the host derives the
type from the name.

**Kinds.** A save is `document` only if its sanitised name is the name of a file opened in this
frame, or the name the app saves that file under, and the app's adapter classifies the bytes as a
save of that file (for PdfCraft: same name and the bytes start with the bytes last stored).
Everything else is `export`, except a [continued export](#continued-exports). Apps that save in
their own format save an opened file under another name: PhotoCraft saves an opened `photo.png`
as `photo.psd`, DesignCraft an opened `layout.idml` as `layout.designcraft`. Such a save is still
the `document` of that open, with its `openId`; the host decides where it goes (see
[What the host must do](#what-the-host-must-do)).

Apps that give new documents the same names (`Untitled-1`) need more than the name. If the
adapter reads a document identity from the bytes (its `identity`), a save whose identity differs
from that of the file is `export` without asking the adapter. If either identity is unknown, the
adapter decides alone.

| Kind | Meaning for the host |
|---|---|
| `document` | May replace the file opened with `openId`; with `follows`, the file that export went to. |
| `export` | A new file. Never overwrites anything. |

When the host answers a `document` save with `ok: true`, the translator records the saved
name, length, hash and identity (the previous identity if the save has none) as the new
reference, so the next save of the document is compared with what was stored. It does so only
while the record still belongs to the save's `openId`: if the host has opened a file under the
same name with another `id` in the meantime, that newer file stays the reference.

### Continued exports

PdfCraft's Save rewrites the whole file after redaction, Sanitize or a security change, or for a
repaired file, and appends every later save to the bytes it wrote. The first such save does not
start with the stored bytes and is an `export`, a new file. For adapters of apps that work like this
(`continuesExports`), the translator remembers each `export` it sent under the name of a file
opened in this frame, with its length and hash: the last 10 per name. A later save under that
name, of the same open, that the adapter classifies as `export` but whose bytes start with the
bytes of such an export, is sent as `document` with the open's `openId` and `follows` set to that
export's `id` (the latest one it extends). The check runs right before the save is sent, so it
also sees an export the host is still storing. An export the host did not store (`ok: false`, or
no result in time) is forgotten: a save that extends it is an `export` again, unless it is
already on its way.

Each such export starts a lineage of its own. Saves with `follows` do not become the reference of
the opened file: every later save that extends the export carries the same `follows`, and saves
that extend the opened file's stored bytes stay ordinary `document` saves (`follows: null`). The
host stores a save with `follows` in the file it stored that export in, and every later save with
the same `follows` there too. If it has no file for that export, it stores the save as a new file
and takes that file for the lineage (see [What the host must do](#what-the-host-must-do)).

### Fallback to a browser download

The translator keeps each save's `Blob` until the save ends. It downloads the file in the
browser under the sanitised name, as the app would without translator, and sends `error` of
`save` with that `id`, when:

| Situation | `message` |
|---|---|
| No `save-received` within `data-save-ack-timeout` after the `save` was sent | `no confirmation from the host` |
| No `save-result` within `data-save-result-timeout` after the last `save-received` | `no result from the host` |
| Reading or classifying the file took longer than `data-save-result-timeout` from the app's download | `the translator could not read the file in time` |
| `save-result` whose `ok` is not `true` | the host's `error`, or `the host could not store it` |
| Reading or classifying the file failed in the translator | the error text |

The download is a copy of the `Blob` typed `application/octet-stream`. The app's own type says
nothing about the file (PdfCraft types every download `application/pdf`), and Firefox would
change the extension to match it, for example save `report.docx` as `report.pdf`.

A host that finishes storing after the translator gave up has stored a file the user also got
as a download: a duplicate, not a loss.

## Errors

`error` messages carry `of`, `id` and `message`:

| `of` | `id` | Meaning |
|---|---|---|
| `startup` | none | The app cannot take files. At most one per page load. |
| `open` | the open's `id` | The file could not be handed to the app. Every `open` that arrives while a startup error stands gets this with the startup message; an `open` that arrived before the error waits until the app registers its drop target. |
| `save` | the save's `id` | The translator gave up on the host for this save and downloaded the file in the browser. |

Startup errors:

| `message` | Cause |
|---|---|
| `the app registered no drop target` | The app started but registered no `drop` listener within `data-drop-target-timeout` (default: the adapter's `dropTargetTimeout`, otherwise 3 seconds), for example PdfCraft without WebGL2. |
| `the app failed to load: <detail>` | Before the app started, the page got an error event (a script error, a `<script>` that failed to load, a preload that failed) or an unhandled promise rejection. |
| `the app did not start in time` | No start and no such error within `data-startup-timeout` after the page's `load` event, for example because a Content-Security-Policy blocks the app's inline module script. |
| `the app did not get ready in time` | The app started and registered its drop target, but the adapter's `started` check did not finish within `data-startup-timeout` after the start. |
| `the app failed to start: <detail>` | Reported by an adapter's `started` check: the app's page says why it cannot run (VectorCraft without WebGL2, for example). Other texts may come from an adapter's check too. |

A startup error that happens before the handshake is sent right after `init` is accepted. It is
provisional: if the app registers its drop target later after all, `ready` follows, and the host
should clear the error.

"Started" means the page dispatched the `TrunkApplicationStarted` event. The loader that Trunk
writes into a web app's `index.html` (the Craft web builds are built with Trunk) is an inline
module script: it awaits the initialisation of the WebAssembly module at its top level and then
dispatches the event. How the usual failures reach the host:

| Failure | What the translator sees | `message` |
|---|---|---|
| The `.wasm` file is missing (HTTP 404), cannot be compiled (a `script-src` without `'wasm-unsafe-eval'`), or the browser has no WebAssembly | The loader's top-level `await` rejects, which the browser reports as an error event | `the app failed to load: <detail>` |
| The loader's `import` of the app's JavaScript fails (missing file or network error) | An error event of the module script | `the app failed to load: <detail>` |
| The `.wasm` preload fails | An error event of the preload. Chromium and WebKit report only network errors there (they fire `load` for a 404, which then fails as in the first row); Firefox also reports a 404 through the preload. The JavaScript `modulepreload` reports a 404 in every engine. | `the app failed to load: <detail>` |
| The inline module script is blocked (a `script-src` without its hash or `'unsafe-inline'`) | Nothing: the script never runs, and the browser reports only a policy violation | `the app did not start in time` |
| The app starts without WebGL2 | `TrunkApplicationStarted`, but no `drop` listener | `the app registered no drop target` |

## Timeouts

Set as attributes on the `core.js` script tag, in milliseconds. Anything but a positive, finite
number (missing, empty, zero, negative, non-numeric) means the default. For the drop target the
default is the adapter's `dropTargetTimeout` if it has one (for apps that take longer to register
their drop target), otherwise 3000; a valid `data-drop-target-timeout` wins over the adapter's.

| Attribute | Default | Runs from | On expiry |
|---|---|---|---|
| `data-save-ack-timeout` | 10000 (10 s) | sending `save` | fallback download, `no confirmation from the host` |
| `data-save-result-timeout` | 300000 (5 min) | each `save-received` | fallback download, `no result from the host` |
| `data-save-result-timeout` (again) | 300000 (5 min) | the app's download | fallback download, `the translator could not read the file in time`, if reading, hashing and classifying the file have not finished |
| `data-startup-timeout` | 60000 (60 s) | the page's `load` event | startup error, `the app did not start in time` |
| `data-drop-target-timeout` | the adapter's `dropTargetTimeout`, otherwise 3000 (3 s) | the app's start (`TrunkApplicationStarted`) | startup error, `the app registered no drop target` |
| `data-startup-timeout` (again) | 60000 (60 s) | the app's start | startup error, `the app did not get ready in time`, if the drop target and the adapter's `started` check have not both finished |
| fixed | 1000 (1 s), 30 times | adapter registration | no more `hello`; an `init` is still accepted |

The acknowledgement timer starts when the `save` is sent, after the translator has read and
hashed the file and sent every earlier save, so large files do not eat into it.

## Names

Names come from the host (`open`) or from the app, and the app may take them from the document
(for example an attachment's file name). The translator keeps a plain base name, as a browser
download would:

1. Take the part after the last `/` or `\`.
2. Remove control characters (U+0000 to U+001F and U+007F). Replace direction marks and
   overrides and invisible format characters (U+061C, U+200B, U+200E, U+200F, U+202A to U+202E,
   U+2060 to U+2069 and U+FEFF) with `_`, as browsers do for downloads, so that a name cannot
   hide its real extension: `invoice` U+202E `fdp.exe` would show as `invoiceexe.pdf` and
   becomes `invoice_fdp.exe`. The zero-width joiner and non-joiner (U+200D, U+200C), which some
   scripts need, stay.
3. If the name is longer than 200 characters (UTF-16 code units), cut it to 200. An extension of
   up to 16 characters including its dot (from the last dot, unless the name starts with it) is
   kept and the part before it is shortened, without leaving half of a surrogate pair.
4. Remove leading and trailing whitespace and dots.
5. Use `download` if nothing is left.

Trimming comes last, so a cut name never ends in a dot or whitespace.

The host must still check names against its own rules before it writes a file.

## Links

Links can come from documents (a link in a PDF, an `<a href>` in an SVG). After the handshake,
the translator's `window.open`:

- opens only `http:`, `https:`, `mailto:` and `blob:` URLs and `about:blank` (resolved against
  the app's page). Anything else, such as `javascript:` or `data:`, opens nothing: `window.open`
  returns `null` and the translator logs a console warning. A `javascript:` URL would run in a
  window on the app's origin, with access to the app and its save path.
- opens the targets `_self`, `_top` and `_parent` (any case) in a new window (`_blank`)
  instead, so that a link cannot replace the editor in the frame.
- adds `noopener` for an `http:` or `https:` URL of another origin, so that the page that
  opens gets no `window.opener`: it can reach neither the frame nor, through it, the host's page
  (Firefox would let it navigate the host's page to another site). `window.open` then returns
  `null`, as for any window opened with `noopener`; the Craft apps do not use what it returns.

Other targets, other features and `<a target>` links are not changed. Before the handshake
`window.open` is left alone.

## What the host must do

1. Frame only the Craft URL from server-side configuration. Never take it from the page URL.
2. Post every message with the configured Craft origin as `targetOrigin`. Accept messages only
   if `event.source` is the iframe's `contentWindow`, `event.origin` is the configured Craft
   origin and `protocol` and `version` match.
3. Answer every `hello` with `init`. A `hello` after `ready` means the frame was reloaded and
   lost its state: wait for the new `ready` before sending `open` again.
4. Send `open` only after `ready`. An `open` before the handshake is ignored.
5. Send `save-received` as soon as a `save` arrives, before storing it, and `save-result` when
   the file is stored or the host gives up. If storing takes long, repeat `save-received` while
   it makes progress: each one restarts the translator's result timer. Bound every request and
   give up on one that stalls, so that a save that cannot be stored ends in the fallback download
   instead of waiting forever. Store saves in the order they arrive (their `id` order).
6. Replace a file only for `kind: "document"`, and only the file the host itself opened under
   `openId` (look it up by id, never by name), with a conditional write (WebDAV `PUT` with
   `If-Match` and the ETag the host last read or wrote). A `412 Precondition Failed` is a
   conflict: do not overwrite. A `document` save under another name or file type than the
   opened file (the app's own format, see [Saves](#saves)) goes to a new file next to the opened
   one; later `document` saves of the same `openId` under that name replace that new file, again
   conditionally. A `document` save with `follows` goes to the file the host stored the
   export with that `id` in, again conditionally, and so does every later save with the same
   `follows`; saves with `follows: null` still go to the opened file. If such a write is a
   conflict, the copy becomes the lineage's file. If the host did not store that export (or no
   longer knows it), it stores the save as a new file and takes that file for the lineage. A host
   never overwrites a file it did not open or create itself.
7. Store `export` saves as new files next to the opened file, under a free name.
8. Keep the bytes of a save until it is stored. On failure, report `ok: false`: the translator
   then downloads the file, so it is not lost, and sends `error` of `save` at once; tell the
   user why. If that `error` does not come, or the page in the frame was reloaded or replaced
   meanwhile (a `hello` after `ready`), the page that held the file is gone: offer the bytes for
   download yourself.
9. Warn before the page is left while saves are pending. A save is pending from its
   `save-started` (or, for a host that ignores `save-started`, its `save`) until the host has sent
   its `save-result` or an `error` of `save` with its `id` arrives. An announced save whose
   `save` never comes (the page in the frame was replaced or crashed) stops counting when the
   page is replaced, or after `data-save-result-timeout` with a margin. Since the app's unsaved
   changes are invisible to the host, warn on close as well.
10. Show `error` messages: `startup` and `open` mean the file is not open, `save` means the user
    got the file as a browser download instead.
11. Hand a file over only on a page the user opened on purpose. A host page that reads the file
    and frames the app as it loads can be opened by any site, the Craft hosting included, also
    through the host's own pages (a link that the host's file list opens by itself, a sign-in
    page that redirects to it). Hand the file over at once only with proof another site cannot
    make, such as the session's CSRF token added on a user's click (the Nextcloud app also
    accepts `Sec-Fetch-Site: none`, a typed address); otherwise ask first. Send
    `Cross-Origin-Opener-Policy: same-origin`, so that no window opened from the frame can reach
    or navigate the host's tab, and delegate no more than `clipboard-write` to the frame.

If the host sandboxes the iframe, PdfCraft needs at least
`sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"`; without
`allow-downloads` the fallback download is blocked.

## Compatibility

The translator ignores messages with another `version`. A change that existing hosts or
translators would misread gets a new protocol version. New optional fields and new message types
keep version 1, so both sides ignore what they do not know. `hello` and `ready` report the
translator's `layerVersion` for diagnostics.
