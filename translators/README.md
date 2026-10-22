<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Translators

The translator runs inside an unmodified Craft web app, on the app's own origin, and connects it
to the host page that frames it (the Nextcloud editor page). It opens the files the host sends
and turns the app's downloads into save messages. The messages are described in
[docs/protocol.md](../docs/protocol.md).

| File | What it is |
|---|---|
| `core.js` | The translator core: handshake, opening files, download interception, fallbacks. Shared by all apps. |
| `pdfcraft.js` | The adapter for PdfCraft: tells saves of the opened document from exports. See [docs/apps/pdfcraft.md](../docs/apps/pdfcraft.md). |
| `photocraft.js` | The adapter for PhotoCraft. See [docs/apps/photocraft.md](../docs/apps/photocraft.md). |
| `vectorcraft.js` | The adapter for VectorCraft. See [docs/apps/vectorcraft.md](../docs/apps/vectorcraft.md). |
| `designcraft.js` | The adapter for DesignCraft. See [docs/apps/designcraft.md](../docs/apps/designcraft.md). |
| `wordcraft.js` | The adapter for WordCraft. See [docs/apps/wordcraft.md](../docs/apps/wordcraft.md). |
| `gridcraft.js` | The adapter for GridCraft. See [docs/apps/gridcraft.md](../docs/apps/gridcraft.md). |
| `deckcraft.js` | The adapter for DeckCraft. See [docs/apps/deckcraft.md](../docs/apps/deckcraft.md). |
| `cadcraft.js` | The adapter for CADCraft. See [docs/apps/cadcraft.md](../docs/apps/cadcraft.md). |
| `lightcraft.js` | The adapter for LightCraft. See [docs/apps/lightcraft.md](../docs/apps/lightcraft.md). |
| `filmcraft.js` | The adapter for FilmCraft. See [docs/apps/filmcraft.md](../docs/apps/filmcraft.md). |
| `effectcraft.js` | The adapter for EffectCraft. See [docs/apps/effectcraft.md](../docs/apps/effectcraft.md). |
| `soundcraft.js` | The adapter for SoundCraft. See [docs/apps/soundcraft.md](../docs/apps/soundcraft.md). |

## Loading

The hosting adds both files to the app's `index.html` as the first elements of `<head>`, as
classic scripts (no `async`, `defer` or `type="module"`), so that they run before the app:

```html
<script src="./craftsuite-layer/core.js"
        data-allowed-origins="https://cloud.example.com"
        data-app-version="0.5.0"></script>
<script src="./craftsuite-layer/pdfcraft.js"></script>
```

Nothing else in the app changes. See [docs/hosting.md](../docs/hosting.md).

## Configuration

Attributes on the `core.js` script tag:

| Attribute | Required | Meaning |
|---|---|---|
| `data-allowed-origins` | yes | Origins of the pages allowed to frame and drive the app, separated by spaces or commas. |
| `data-app-version` | no | The app version the hosting serves. Reported to the host in `ready`. |
| `data-save-ack-timeout` | no | Milliseconds to wait for `save-received` (default 10000). |
| `data-save-result-timeout` | no | Milliseconds to wait for `save-result` after `save-received` (default 300000). It also limits reading and classifying a save, from the app's download. |
| `data-startup-timeout` | no | Milliseconds after the page's `load` event for the app to start (default 60000). |
| `data-drop-target-timeout` | no | Milliseconds after the app started (`TrunkApplicationStarted`) for it to register its drop target (default: the adapter's `dropTargetTimeout`, otherwise 3000). |

A timeout that is not a positive, finite number (missing, empty, zero, negative, non-numeric)
means the default. A valid `data-drop-target-timeout` wins over the adapter's
`dropTargetTimeout`; an invalid or empty one leaves the adapter's value in place. What happens
when one expires is described in [docs/protocol.md](../docs/protocol.md#timeouts).

Per frame, the host can also name the language the app starts in, in the fragment of the address
it frames (`#craftsuite-layer:lang=de`); see
[Host settings](../docs/protocol.md#host-settings). The hosting configures nothing for it.

Each allowed origin must be an origin, not a URL: `https://` (or `http://` on `localhost`,
`127.x.x.x` or `[::1]`, for tests), no user name or password, no path other than `/`, no query or
fragment. Entries that break these rules are ignored with a console warning. Entries are
normalised (`https://Cloud.Example.com:443/` becomes `https://cloud.example.com`). There are no
wildcards; an entry with `*` never matches. A Nextcloud installed under a path such as
`https://cloud.example.com/nextcloud` is listed by its origin, `https://cloud.example.com`.

## When the translator stays inactive

The core does nothing, and the app behaves exactly as without it (Save is a browser download),
when:

- the page is not framed,
- no valid allowed origin is configured,
- the page is not a secure context (`https://`, or loopback `http://`) or has no Web Crypto,
- no adapter registers (console: `inactive: no adapter registered`),
- no allowed parent answers with `init`.

## Writing an adapter

An adapter is a classic script loaded right after `core.js`. It registers once:

```js
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive
  window.craftsuiteLayer.register({
    app: 'exampleapp',
    // Called for a download whose name is that of a file opened in this frame, or the name
    // the app saves it under (savedName). Return 'document' only for a save of that file;
    // anything else becomes 'export'.
    async classify(save, entry, util) {
      return (await util.extendsOpened(save.bytes, entry)) ? 'document' : 'export';
    },
  });
})();
```

| Member | Required | Meaning |
|---|---|---|
| `app` | yes | App id, a string. Sent as `app` in every message. |
| `classify(save, entry, util)` | yes | `save` is `{name, bytes}` (`bytes` a `Uint8Array`), `entry` the record of the opened file the name belongs to: `{id, name, savedName, length, hash, identity}` (`id` the host's open id, `name` the opened name, `savedName` the name the app saves it under, `hash` the SHA-256 of the bytes last stored, `identity` see `identity` below). May return a promise. `'document'`: a save of that file, which may replace it. `'copy'`: a save of that file that must not replace it (the app saves it with losses); the first becomes a new file, and the later ones of the same open replace that file (see [docs/protocol.md](../docs/protocol.md#copies)). Anything else is `'export'`. |
| `dropTarget(registered)` | no | Returns the element that receives the simulated drop. `registered` is the element on which the app registered its first `drop` listener; if that was not an element (such as `window` or `document`), the first `<canvas>`, else `<body>`. |
| `started(registered)` | no | A promise that resolves once the app can take files: for an app whose first `drop` listener comes before that (VectorCraft), whose page never dispatches `TrunkApplicationStarted` (FilmCraft: the core's timers that start with that event, for the drop target and for `ready`, never run; only `data-startup-timeout` from `load` applies, until the app's drop listener), or that must be in a certain mode first (LightCraft: nothing kept in the browser). The core sends `ready` only then; a rejection becomes a startup error with the rejection's message. |
| `savedName(name, bytes)` | no | The name the app gives the opened file when it saves it, if not `name` (PhotoCraft saves an opened `photo.png` as `photo.psd`). `bytes` is the opened file as a `Uint8Array`; may return a promise. Saves under that name reach `classify` with the opened file's record. |
| `identity(bytes)` | no | For apps that give new documents the same names (`Untitled-1`): a string that tells documents apart, read from a file's bytes (`Uint8Array`), such as a creation stamp the app writes once and keeps; `null` if the bytes have none. May return a promise; a rejection, like anything but a non-empty string, counts as `null`. The core reads it from the opened file and from each stored `document` save (keeping the previous one if a save has none). A save whose identity and the file's are both known and differ is `export` without calling `classify`. An adapter may also use it as a mark of the opened file rather than a document id (EffectCraft marks a file a newer EffectCraft wrote). |
| `continuesExports` | no | `true` for an app that goes on editing from the bytes of a save that came out as `export` under the opened file's name (PdfCraft's Save rewrites the whole file after redaction or Sanitize, then appends to it). A later save that `classify` calls `export` but whose bytes extend such an export becomes `document` (unless the host did not store that export: `ok: false`, or no answer in time), with `follows` naming that export (see [docs/protocol.md](../docs/protocol.md#continued-exports)). |
| `dropTargetTimeout` | no | Milliseconds the app may take after its start to register its drop target, if more than the default 3000. A valid `data-drop-target-timeout` of the hosting takes precedence; an invalid or empty one does not. |
| `language(tag, util)` | no | Makes the app start in the host's language (see [Host settings](../docs/protocol.md#host-settings)). Called once, synchronously, inside `register()`, so before the app's module runs; `tag` is the checked BCP 47 tag, or `null` when the host named none (then an adapter that wrote a language into the app's own preferences on an earlier start takes it back). Returns the key of its table it applied (the tag `ready` reports), `null`, or a promise of either for an app that takes the language only through its API once it runs (the adapter sets it in `started()`, before `ready`, and bounds that call itself; after `started()` the core waits at most 5 s more for the promise). Never fail the start for it: on any problem the app starts in its own language. |

`util.extendsOpened(bytes, entry)` resolves to `true` if `bytes` start with exactly the bytes last
stored for `entry`, which is what an incremental save looks like.

`util.matchLanguage(tag, table)` returns the key of `table` (BCP 47 tags of the languages the app
shows, mapped to the app's own codes) that fits `tag`: the same tag in any letter case, else the
first key with the same language and script (`de-AT` finds `de`, `pt-PT` finds `pt-BR`, `zh-TW`
finds `zh-Hant`; `sr-Latn` never finds a Cyrillic `sr`), else `null`.

`util.preferLanguages(code)` makes the page report `code` as the browser's language:
`navigator.language`, and first in `navigator.languages`, before the browser's own. For apps that
read the browser's language as they start; it applies to every script in the frame.

`register` returns `false` if an adapter is already registered or the object lacks `app` or
`classify`. The registry (`window.craftsuiteLayer`) cannot be replaced, and only the first
adapter counts.

Rules for adapters:

- Classify by what the app reliably does, and check it against the app's source and the
  end-to-end tests. When in doubt, return `'export'`: an export never overwrites a file.
- Return `'copy'`, not `'document'`, for a save of the opened file that loses what the app does
  not model, such as a file another program wrote in an interchange format.
- If the app needs switches in its address to behave safely in a frame (LightCraft's
  `store=memory`, EffectCraft's `empty`, `nosw` and `storage=memory`), the adapter adds them with
  `history.replaceState` as it loads, before the app's module reads `location.search`, and only
  when the core is active. The Nextcloud app refuses app addresses with a query, so the adapter's
  switches are the only ones. Check in `started()` that they took effect where the app tells.
- Offer in `language` only languages the app's web build shows properly (some draw missing
  glyphs for want of a font), list the same tags in the Nextcloud app (`CraftApps::APPS`,
  `languages`) and on the app's page, and leave a language the user picked inside the app alone
  where the app keeps it.
- Document the app's browser-facing behaviour in `docs/apps/<app>.md`, including known gaps.
- Add the app to `apps.json` (with `minVersion`, the oldest release the adapter handles) and a
  spec under `tests/e2e/specs/` with a few scenario tests (see
  [docs/development.md](../docs/development.md#writing-tests)); `tests/e2e/playwright.config.ts`
  then has the projects `<app>-chromium` and `<app>-webkit`, which the daily canary selects by
  that name. `npm run apps:check` says what else the app needs. See
  [docs/development.md](../docs/development.md#adding-a-craft-app).

## Version

`core.js` reports its version (`layerVersion`, currently `0.5.3`) in `hello` and `ready`, and
speaks protocol version 1.
