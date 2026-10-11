<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Hosting the Craft apps

The Craft apps are static sites. The hosting serves each app's upstream web build with the
translator added, on an origin of its own. This page lists the requirements any hosting must
meet. [`hosting/`](../hosting/README.md) has building blocks for them: `inject-translator.sh`,
which adds the translator to a web build (tested in CI), and an nginx configuration template
with a Compose example (examples, not tested in CI). Each release of this repository ships them
with the translators as one archive ([The layer's files](#the-layers-files)). There is no release
updater yet; [Updates](#updates) says what one must do.

## Layout

One origin for the Craft apps, separate from Nextcloud, with one path per app:

```text
https://craft.example.com/pdfcraft/
  index.html                      upstream, with the two script tags added
  pdfcraft-web-<hash>.js          upstream, unchanged
  pdfcraft-web-<hash>_bg.wasm     upstream, unchanged
  ...                             other upstream files, unchanged
  craftsuite-layer/core.js        translators/core.js
  craftsuite-layer/pdfcraft.js    translators/pdfcraft.js
https://craft.example.com/photocraft/
  ...                             the same for PhotoCraft, with photocraft.js
```

- Use HTTPS. The translator stays inactive outside a secure context.
- Never serve the apps from the Nextcloud origin: code there could use the user's Nextcloud
  session. Use another host name than Nextcloud (such as `craft.example.com` next to
  `cloud.example.com`); the Nextcloud app refuses an address on one of Nextcloud's host names,
  whatever the port.
- Several Craft apps may share the origin under different paths. Each path is the address an
  administrator enters in Nextcloud ([nextcloud-app.md](nextcloud-app.md#configuring)).

## Injecting the translator

[`hosting/inject-translator.sh`](../hosting/README.md#inject-translatorsh) does this step for an
unpacked web build; this section says what it writes, for setups that do it another way.

Insert the two tags directly after the opening `<head>` tag of the app's `index.html` (the first
real one: not one inside an HTML comment, and not a `<header>` tag):

```html
<script src="./craftsuite-layer/core.js?v=770821886-21573"
        data-allowed-origins="https://cloud.example.com"
        data-app-version="0.5.0"></script>
<script src="./craftsuite-layer/pdfcraft.js?v=4249947243-2048"></script>
```

- They must be classic scripts (no `async`, `defer` or `type="module"`) and come before the app's
  own scripts, so that they run first.
- `data-allowed-origins` lists the origins of the Nextcloud instances that may use the app.
  Origins only, no paths: see [translators/README.md](../translators/README.md#configuration).
  The translator accepts spaces or commas between them; use spaces, because the same list goes
  into `frame-ancestors`, where commas are not allowed. HTML-escape the values.
- `data-app-version` is the version being served. The host sees it in `ready`.
- `?v=` is optional. The injector writes a checksum of each translator file there, so that a
  cache which keeps `*.js` for a year (as the upstream `_headers` file asks for) still loads a
  new translator. It uses `cksum` (`<CRC>-<size>`, as above) and, where that is missing (some
  BusyBox builds), the first 16 hex digits of `sha256sum` or else `md5sum`.
- Leave the timeout attributes (see
  [translators/README.md](../translators/README.md#configuration)) unset unless there is a reason
  to change them. A value that is not a positive, finite number means the default.
- Change nothing else. The integrity attributes in `index.html` stay valid, because the files
  they cover are unchanged.
- Precompressed copies of a changed file (`index.html.gz`, `index.html.br`) would serve the old
  content. Compress after injecting; the injector writes a new `.gz` of each file it changes and
  removes a `.br`, which it cannot write.

The test server does the same injection without the checksum, see `inject()` in
[`tests/e2e/server/serve.mjs`](../tests/e2e/server/serve.mjs).

## Headers

| Files | Header | Why |
|---|---|---|
| all | `Content-Security-Policy: frame-ancestors https://cloud.example.com` | Only the allowed Nextcloud may frame the app. Use the same origins as `data-allowed-origins`. |
| all | `X-Content-Type-Options: nosniff` | As in the upstream build's `_headers`. |
| `index.html`, `craftsuite-layer/*.js` | `Cache-Control: no-cache` | New releases and translator updates take effect at once; these names carry no hash. |
| hashed `*.js` and `*.wasm` | `Cache-Control: public, max-age=31536000, immutable` | Their names change with their content. |
| `*.wasm` | `Content-Type: application/wasm` | Browsers compile WebAssembly while downloading only with this type. |

- Do not send `X-Frame-Options`. It cannot allow another origin, so it would block Nextcloud.
- Turn on gzip or Brotli for `.wasm`, `.js` and `.html`. PdfCraft 0.5.0's `.wasm` file is
  38,490,160 bytes; gzip at level 9 brings it to about 15.5 MB, Brotli at quality 11 to about
  11 MB.
  The files do not change within a release, so they can be compressed once when it is unpacked
  (with nginx: `gzip_static`) instead of on every request.
- The apps need no `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`.
- Keep the Content-Security-Policy to `frame-ancestors` unless you test more. A `script-src`
  must allow the inline module script in `index.html` (which changes with every release) and
  WebAssembly (`'wasm-unsafe-eval'`). The two fail differently: a blocked inline script never
  runs, and the host gets `the app did not start in time` only after `data-startup-timeout`;
  blocked WebAssembly makes the loader fail, and the host gets `the app failed to load: ...` as
  soon as it does (see [protocol.md](protocol.md#errors)).
- With nginx, an `add_header` inside a `location` block replaces all `add_header` lines of the
  enclosing blocks. Repeat the security headers there.

[`hosting/nginx/craft-apps.conf.template`](../hosting/nginx/craft-apps.conf.template) sends these
headers, with `frame-ancestors` from the same variable the injector reads. See also the
`HOSTING.md` file in each upstream web build.

## Updates

The apps release often, and the hosting should follow. This repository has no updater yet. An
updater should:

1. Find the newest release through `https://github.com/storytold/<app>/releases/latest`, which
   redirects to the release's tag. It does not use `api.github.com`, whose limit for
   unauthenticated requests (60 per hour) is easily shared and used up.
2. Download `<app>-web-<version>.zip` and `SHA256SUMS.txt` from
   `https://github.com/storytold/<app>/releases/download/v<version>/`, check the checksum, and
   check that the archive contains only `<app>-web-<version>/`.
3. Unpack into a new directory per version, add the translator with `inject-translator.sh`,
   whose exit code says whether the release can be switched to: on 0 it can, on 6 (no adapter
   for the app in this version of the layer) only without the Nextcloud integration, on any
   other code it cannot (see
   [hosting/README.md](../hosting/README.md#in-a-release-updater)). Then compress the files for
   the web server (see [Headers](#headers)) and switch to the new directory in one step, keeping
   the previous version for a rollback.
4. Take a new release only after a delay (for example a day), so that this repository's daily
   canary run has tested it (see [development.md](development.md#continuous-integration)). If the
   canary's contract tests fail for the release (an open issue labelled `canary` in this
   repository says so), stay on the last good version until a fixed
   adapter is released. Failing `@ui` tests alone mean that the tests' click positions need
   updating, not the translator.

`tests/e2e/tools/fetch-craft.mjs` implements steps 1 and 2 for the tests.

### The layer's files

Take the injector, `core.js` and the adapters together from one release of this repository,
pinned in the updater's configuration, and move to a newer one deliberately, after reading its
[changelog](../CHANGELOG.md). Each release has them in its hosting bundle, with the checksums of
its assets in `SHA256SUMS`, as plain downloads (no API) from
`https://github.com/hozwei/nextcloud-craftsuite-layer/releases/download/v<version>/<asset>`:

| Asset | Content |
|---|---|
| `craftsuite-layer-hosting-<version>.tar.gz` | One folder `craftsuite-layer-hosting-<version>/` with `hosting/inject-translator.sh`, `hosting/README.md`, `hosting/nginx/craft-apps.conf.template`, `hosting/compose.example.yaml`, `translators/*.js`, `translators/README.md` and `LICENSE` |
| `SHA256SUMS` | The SHA-256 checksums of the release's archives, for `sha256sum -c` |

The bundle keeps the repository's layout, so `inject-translator.sh` finds the translators in
`../translators` next to it, without `--translators`. How to fetch and use it:
[hosting/README.md](../hosting/README.md#in-a-release-updater). Running the injector of a newer
release on the Craft app version being served updates the translator without a new Craft app
release.

## A sign-in in front of the apps

The site that hosts the apps may let only signed-in users reach them, for example with a reverse proxy that asks
for a sign-in (with Nextcloud or another identity provider) before it serves them. The editor
page frames the app, so:

- **The session cookie must reach the framed app.** Browsers send a cookie with the frame's
  requests only when its `SameSite` rule and their third-party cookie rules allow it.
  - *Same site*: the Craft hosting and Nextcloud under one registrable domain, both on https
    (`craft.example.com` next to `cloud.example.com`). The frame's requests are same-site, so a
    cookie with `SameSite=Lax` is sent. This works in every browser.
  - *Cross site* (`craft.example.org` next to `cloud.example.com`): the cookie needs
    `SameSite=None; Secure`, and browsers that block or partition third-party cookies still do
    not send it: Safari and Firefox by default, others in private windows or when the user turns
    third-party cookies off. Prefer the same-site setup.
- **Users sign in in a tab of their own.** The editor page allows only the Craft origin in its
  frame, so a sign-in that redirects to an identity provider on another origin cannot load
  there, and neither can a sign-in page that refuses to be framed. When the app's page has not
  answered after 15 seconds, the editor shows a hint with a link that opens the app in a new
  tab: users sign in there and reload the editor page. A long sign-in session means they rarely
  have to.
- **The sign-in page must not be framed by others.** Send `frame-ancestors` on it too, with the
  Nextcloud origins or `'none'`: a sign-in form that any site can frame invites clickjacking.
- **Caching.** Use `private` instead of `public` in `Cache-Control`, so that shared caches do not
  keep what only signed-in users may get.

## Checklist

- [ ] Own origin, HTTPS, another host name than Nextcloud
- [ ] Injector and translators from one pinned release of this repository, checked against its
  `SHA256SUMS`
- [ ] `index.html` starts its `<head>` with the two script tags (`inject-translator.sh --check`
  exits 0)
- [ ] `data-allowed-origins` and `frame-ancestors` list the same Nextcloud origins
- [ ] No `X-Frame-Options`
- [ ] `no-cache` on `index.html` and `craftsuite-layer/*.js`, `application/wasm` on `.wasm`
- [ ] Behind a sign-in: the session cookie reaches the framed app, and the sign-in page sends
  `frame-ancestors`
- [ ] Opened directly (not framed), the app works as usual; the translator is inactive
- [ ] Framed by the Nextcloud app, a file opens and Save stores it in Nextcloud
  ([nextcloud-app.md](nextcloud-app.md))
