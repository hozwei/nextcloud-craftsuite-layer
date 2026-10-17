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
with the translators and the list of supported apps as one archive
([The layer's files](#the-layers-files), [The app list](#the-app-list)). There is no release
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
  administrator enters in Nextcloud ([nextcloud-app.md](nextcloud-app.md#configuring)). With
  every app at `<address><app>/` as above, one address for all apps is enough there, and an app
  that a new release of the layer adds needs no setting in Nextcloud.
- The address has no query (`?...`); the Nextcloud app refuses one. Several apps read their
  query as switches: PdfCraft 0.6.0's `?host=parent` would make it drop every save under a
  Nextcloud on another origin. The adapters set the switches their app needs themselves, such as
  `store=memory&workers=0` for LightCraft, `empty`, `nosw` and `storage=memory` for EffectCraft
  and `fresh` for FilmCraft.

## Files to serve

Serve each web build's folder as it was unpacked. The pages load more than `index.html`, the
JavaScript glue and the `.wasm`, all through relative URLs: FilmCraft loads `audio-worklet.js`
at start, EffectCraft `worker.js`, `audio-worklet.js` and a script under `snippets/`, and
LightCraft its font `lightcraft_zh_hans.otf` (and `worker.js`, except with `workers=0`, which its
adapter sets).

The exception is LightCraft. Its release zip (0.6.0) also holds the leftovers of its Cargo build,
which the page never loads and a hosting must not serve: `build/` (about 23 MB), `deps/` (about
95 MB), `.fingerprint/`, the empty `incremental/` and `examples/`, and the files `.cargo-lock`,
`.cargo-artifact-lock` and `.cargo-build-lock`. Remove them after unpacking. What remains is
what to serve: `index.html`, `lightcraft_web.js`, `lightcraft_web_bg.wasm`, `worker.js` and
`lightcraft_zh_hans.otf`, their `.br` and `.gz` copies if the server uses them, and the licences
(`LICENSE-APACHE`, `LICENSE-MIT`, `NOTICE`, `OFL-*.txt`); `_headers` and `.htaccess` are sample
server rules. The nginx template refuses hidden files (`.fingerprint/`, `.cargo-*lock`) but
serves `build/` and `deps/` if they are there.

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
  cache which keeps `*.js` for a year (as most upstream `_headers` files ask for) still loads a
  new translator. It uses `cksum` (`<CRC>-<size>`, as above) and, where that is missing (some
  BusyBox builds), the first 16 hex digits of `sha256sum` or else `md5sum`.
- Leave the timeout attributes (see
  [translators/README.md](../translators/README.md#configuration)) unset unless there is a reason
  to change them. A value that is not a positive, finite number means the default. See
  [Startup timeout](#startup-timeout) for the one that some apps need.
- Change nothing else, except a service worker that the build ships (see
  [Service workers](#service-workers)). The integrity attributes in `index.html` stay valid,
  because the files they cover are unchanged.
- Precompressed copies of a changed file (`index.html.gz`, `index.html.br`; LightCraft's release
  ships both) would serve the old content. Compress after injecting; the injector writes a new
  `.gz` of each file it changes and removes a `.br`, which it cannot write.

The test server does the same injection without the checksum, see `inject()` in
[`tests/e2e/server/serve.mjs`](../tests/e2e/server/serve.mjs). It does not replace service
workers; the EffectCraft adapter keeps the frames from registering one.

### Startup timeout

The translator reports `the app did not start in time` when the app has not started
`data-startup-timeout` milliseconds after the page's `load` event (default 60000). The Trunk
builds preload their `.wasm` with a `<link>` tag, which holds back `load` until it has arrived,
so the default fits them. FilmCraft, LightCraft and EffectCraft have loaders of their own: a
module script fetches the `.wasm` (LightCraft's also a 16.4 MB font), which does not hold back
`load`, so the timer runs during the download. So does SoundCraft's Trunk page (0.6.1, 0.7.0),
whose `load` comes before its `.wasm` has arrived. On a slow first load the host gets the error for
an app that is still loading, and `ready` once it has started (the error is provisional, see
[protocol.md](protocol.md#errors)).

`inject-translator.sh --startup-timeout MS` writes `data-startup-timeout="MS"` on the `core.js`
tag:

- **LightCraft and EffectCraft: 180000** (3 minutes). A cold start of LightCraft 0.6.0 downloads
  about 18 MB even with Brotli (the `.wasm` and the font), one of EffectCraft 0.8.0 its 60 MB
  `.wasm` (17.9 MB with gzip): 60 seconds are too short below about 2.4 Mbit/s.
- **FilmCraft: only if needed.** Its 43.5 MB `.wasm` (0.6.0) is 15.6 MB with gzip: served
  compressed, it fits into 60 seconds down to about 2 Mbit/s. Give it 180000 too if it is
  served uncompressed (then it needs about 6 Mbit/s) or the hosting's users have slow
  connections.
- **SoundCraft: no option.** Its loader does not hold back `load` either, but its `.wasm` is
  smaller (15.5 MB, 5.9 MB with gzip, in 0.7.0): served compressed, it fits into 60 seconds down
  to about 0.8 Mbit/s.
- **The other apps:** no option.

A longer timeout also delays the report of a start that really hangs, such as an inline module
script that a Content-Security-Policy blocks. The injector has no per-app defaults, because the
right value depends on the hosting's compression and its users' connections. It writes the whole
block on every run, so keep the value in the updater's configuration for each app and pass it on
every run, `--check` included: a run without the option removes the attribute, and `--check`
without it reports the page as not up to date. The injector writes no other timeout attribute
and drops one added by hand.

## Service workers

A build may ship a service worker that keeps the app for offline use; EffectCraft's `sw.js` does.
Once a browser has it, it answers every request of the app's pages from its cache: `index.html`
with the translator's tags, the translator files, and their headers (`frame-ancestors`) stay as
they were until the app's next release changes `sw.js`. A new layer release or an added or removed
Nextcloud origin would not reach that browser. Frames on another site than the hosting are kept
apart from it by the browser's storage partitioning, and the EffectCraft adapter keeps frames from
registering it (`nosw`), but on the same site (`craft.example.com` next to `cloud.example.com`,
see [A sign-in in front of the apps](#a-sign-in-in-front-of-the-apps)) a worker that a direct
visit registered controls the frames as well.

So the hosting replaces such a worker. `inject-translator.sh` does it for a `sw.js` at the build's
root. A worker with another name or in another folder it does not detect, but the tests of each
app do: they visit the app directly, as a user would, and fail when it registers any other worker
(`tests/e2e/specs/service-workers.spec.ts`), in CI and in the daily canary, so a release that
brings one is held back before deployments take it ([Updates](#updates), step 4). What the
injector does:

- It keeps the original as `craftsuite-layer/sw.js.orig`; `--remove` puts it back, and `--check`
  reports a `sw.js` that is still the app's own.
- The replacement has no `fetch` handler, so the browser loads everything from the server. It
  activates at once, deletes the caches named after the app (`effectcraft-<build hash>`), takes over
  the app's open pages and unregisters itself.
- Browsers check `sw.js` when one of the app's pages is loaded and install the replacement then:
  that first page still comes from the old cache, every later one from the server (checked in
  Chromium and WebKit). The app's own page registers `sw.js` again on each direct visit, and the
  replacement removes itself again each time.
- The app no longer starts offline from the hosting.

Serve `sw.js` with `Cache-Control: no-cache` (as EffectCraft's `HOSTING.md` asks; the nginx
template does). Browsers fetch a service worker's script past the HTTP cache when they check it,
but other caches in between may not.

## Headers

| Files | Header | Why |
|---|---|---|
| all | `Content-Security-Policy: frame-ancestors https://cloud.example.com` | Only the allowed Nextcloud may frame the app. Use the same origins as `data-allowed-origins`. |
| all | `X-Content-Type-Options: nosniff` | As in the upstream build's `_headers`. |
| `*.js` and `*.wasm` with Trunk's content hash in the name, such as `pdfcraft-web-9fbc20856b2df0f8_bg.wasm` | `Cache-Control: public, max-age=31536000, immutable` | Their names change with their content. |
| everything else: `index.html`, `sw.js`, `craftsuite-layer/*`, and `*.js` and `*.wasm` without a hash in the name | `Cache-Control: no-cache` | Browsers revalidate them on every load, so a new release or translator takes effect at once (see [Caching](#caching)). |
| `*.wasm` | `Content-Type: application/wasm` | Browsers compile WebAssembly while downloading only with this type. |

- Do not send `X-Frame-Options`. It cannot allow another origin, so it would block Nextcloud.
- Compress `.wasm`, `.js`, `.html` and LightCraft's `.otf` font with gzip or Brotli. The `.wasm`
  files of the tested releases have 15 to 60 MB; gzip at level 9 brings them to 30 to 40 % of
  that, Brotli at quality 11 to less than 30 %. The files do not change within a release, so
  compress them once when it is unpacked (with nginx: `gzip_static`) instead of on every
  request. LightCraft's release already has `.gz` and `.br` copies.
- The apps need no `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`.
- Keep the Content-Security-Policy to `frame-ancestors` unless you test more. A `script-src`
  must allow the inline module script in `index.html` (which changes with every release) and
  WebAssembly (`'wasm-unsafe-eval'`). The two fail differently: a blocked inline script never
  runs, and the host gets `the app did not start in time` only after `data-startup-timeout`;
  blocked WebAssembly makes the loader fail, and the host gets `the app failed to load: ...` as
  soon as it does (see [protocol.md](protocol.md#errors)).
- With nginx, an `add_header` inside a `location` block replaces all `add_header` lines of the
  enclosing blocks. Repeat the security headers there.
- An idea for FilmCraft, not a requirement: `Clear-Site-Data: "storage"` on its `index.html`.
  FilmCraft copies every media file it imports into the origin's private file system (OPFS) and
  never deletes the copies, and it keeps snapshots of unsaved work there. In the integration
  nothing shows them (the adapter starts FilmCraft with `fresh`), but they stay in the browser
  profile. The header would delete them on every load of the page. The price: it clears the
  storage of the whole origin, so also what the other apps on it keep in the browser (such as the
  library LightCraft keeps for a direct visit) and the storage of FilmCraft pages open in other
  tabs, and users who open FilmCraft directly lose its crash recovery. Consider it only for a
  FilmCraft on an origin of its own.

[`hosting/nginx/craft-apps.conf.template`](../hosting/nginx/craft-apps.conf.template) sends these
headers, with `frame-ancestors` from the same variable the injector reads. See also the
`HOSTING.md` file in each upstream web build.

### Caching

Only a file whose name changes with its content may be cached as `immutable`. The address of an
app stays `/<app>/` from one release to the next (switching a symbolic link to a new release
folder changes nothing a browser sees), so to a browser every update happens in place.
FilmCraft, LightCraft and EffectCraft use the same file names in every release:

- FilmCraft: `filmcraft_web.js`, `filmcraft_web_bg.wasm`, `audio-worklet.js`
- LightCraft: `lightcraft_web.js`, `lightcraft_web_bg.wasm`, `worker.js`
- EffectCraft: `effectcraft_web.js`, `effectcraft_web_bg.wasm`, `worker.js`, `audio-worklet.js`,
  `sw.js`

With `immutable` and a year's `max-age`, browsers would keep the old glue and `.wasm` for up to a
year after an update while they load the new `index.html`: the app would fail to start, or keep
running the old version. FilmCraft 0.6.0's own `_headers` file still asks for `immutable` on every
`*.js` and `*.wasm`; those of LightCraft and EffectCraft ask for `no-cache`. `no-cache` costs one
conditional request per file and load, answered with `304 Not Modified` while the file is
unchanged.

The other eight apps are Trunk builds. Trunk appends a hash of the content to the names of the
JavaScript glue and the `.wasm`: a `-` and up to 16 hex digits before `.js` or `_bg.wasm`. It
drops leading zeros, so a hash can be shorter (VectorCraft 0.9.0's has 15 digits). The nginx
template gives `immutable` to names that match `-[0-9a-f]{8,16}(_bg)?\.(js|wasm)$` and `no-cache`
to everything else. The pattern looks at the file name only, so EffectCraft's
`snippets/effectcraft-web-c54b28d6bb55bd4b/js/host.js` is revalidated. Other files with a hash in
the name, such as DeckCraft's icon `ai.storyteller.deckcraft-74e97653dd8dd002.png`, are
revalidated too, which is cheap.

## Updates

The apps release often, and the hosting should follow. This repository has no updater yet. An
updater should:

1. Find the newest release through `https://github.com/storytold/<app>/releases/latest`, which
   redirects to the release's tag. It does not use `api.github.com`, whose limit for
   unauthenticated requests (60 per hour) is easily shared and used up. Skip a release below the
   app's `minVersion` in [the app list](#the-app-list): its adapter does not handle it (SoundCraft
   before 0.6.1 cannot save in the browser at all). An updater that keeps a minimum age (from the
   release's `published_at`) or checks GitHub's own checksum of each asset (`digest`) needs the
   release list from the API instead (`/repos/storytold/<app>/releases`, one request per app and
   run); with a token, as step 4 needs anyway, that fits its limit.
2. Download `<app>-web-<version>.zip` and `SHA256SUMS.txt` from
   `https://github.com/storytold/<app>/releases/download/v<version>/`, check the checksum, and
   check that the archive contains only `<app>-web-<version>/`.
3. Unpack into a new directory per version and remove what must not be served (LightCraft's
   Cargo leftovers, see [Files to serve](#files-to-serve)). Add the translator with
   `inject-translator.sh`, with the app's startup timeout from the updater's configuration (see
   [Startup timeout](#startup-timeout); the app list recommends one where the default is too
   short); its exit code says whether the release can be switched
   to: on 0 it can, on 6 (no adapter for the app in this version of the layer) only without the
   Nextcloud integration, on any other code it cannot (see
   [hosting/README.md](../hosting/README.md#in-a-release-updater)). Then compress the files for
   the web server (see [Headers](#headers)) and switch to the new directory in one step, keeping
   the previous version for a rollback.
4. Take a new release only after a delay (for example a day), so that this repository's daily
   canary run has tested it (see [development.md](development.md#continuous-integration)):

   - **The run that counts** for a release is the first run of `canary.yml` on `main` that was
     created after the release was published and ended with `success` or `failure` (a
     `cancelled` run, a timeout for example, tested nothing), and only if no newer release of the
     app came out before that run ended. Take the run's `created_at`, not `run_started_at`:
     GitHub resets `run_started_at` when a run is re-run, while "Re-run failed jobs" keeps the
     result of a test job that passed in the first attempt.
   - **A failed run** advises holding releases back. It opens an issue labelled `canary` in this
     repository (or comments on the open one), and the next passing run closes it. The issue
     carries a label `canary:<app>` for each app whose own tests failed in its latest failing run,
     and every report on it (the issue's text and each comment) ends with one line such as

     ```text
     `canary-result {"run":123456,"attempt":1,"commit":"<sha>","layer":"0.5.0","failed":["wordcraft"],"tested":{"pdfcraft":"0.8.0","wordcraft":"0.7.0"}}`
     ```

     (`run` and `attempt` identify the run, `commit` and `layer` the translators it tested: the
     commit of `main` and the version in its `core.js`, `failed` names the apps to hold back,
     `tested` the versions that run fetched). `failed` names every app when the failure is not one
     of single apps: a failed download, a failure of the translator's own tests, a run that broke
     before its summary (then `layer` is `null` and `tested` empty). So an updater can hold back
     the releases of the apps named and take the others. Treat a failed run without a report of
     its own (no `canary-result` with its `run`) as failed for every app. The report job changes the issues a few
     seconds before the run ends: the issues as they are at the run's end (its `updated_at`) are
     its result. A run fails only for the Craft releases' tests or a failed report; the look at the
     next Nextcloud release has an issue of its own (`canary-nextcloud`) and never fails a run.
   - **Which translators a run tested.** The canary tests the translators on `main` (the run's
     `head_sha`). Changes to them reach `main` only together with a layer release, so a run
     created while a layer release was the newest tested that release. An updater pinned to an
     older layer release counts only runs created before the next layer release came out; for a
     Craft release after that, it moves to the newer layer release.
   - **After a failed run**, a later green run does not make up for it: the canary tests `main`,
     not the layer release an updater is pinned to. The failed release becomes usable with a
     layer release whose changelog says it handles it (its first counted canary run on that
     release's commit passed); until then, take the app's next release that passes its own first
     run.
   - Failing `@ui` tests alone mean that the tests' click positions need updating, not the
     translator. Failing `@language` tests alone mean that the release may start in its own
     language instead of the one the Nextcloud app asks for, until the adapter is fixed; files
     still open and save. Both are tracked by an issue labelled `canary-ui`, and neither fails a
     run.

   No open issue is not enough on its own: GitHub starts scheduled runs late when it is busy
   (the first scheduled run of this repository, due at 04:23 UTC on 12 October 2026, started at
   12:12 UTC), sometimes skips one, and turns the schedule off after 60 days without activity in
   the repository. The runs come from
   `https://api.github.com/repos/hozwei/nextcloud-craftsuite-layer/actions/workflows/canary.yml/runs?branch=main&status=completed`
   (one request for the last 30, with `created_at`, `updated_at`, `run_attempt` and
   `conclusion`; the Canary badge in the [README](../README.md) shows only the latest result),
   the issues from `.../issues?labels=canary&state=all` (with their labels; the comments of an
   issue from `.../issues/<number>/comments`). The workflow never reopens an issue: after a closed
   one it opens a new one. Should someone reopen one by hand, GitHub keeps only its last close time
   (`closed_at`), so take the issue's state at a run's end from its events
   (`.../issues/<number>/events`) or from the runs' reports, not from `created_at` and `closed_at`
   alone.
   Unlike steps 1 and 2 this needs GitHub's API: send a token (`Authorization: Bearer`, 5,000
   requests per hour) where the unauthenticated limit of 60 per hour is shared, retry later when it
   fails, and alert when it fails for a day, instead of taking releases untested.
   A run is due at 04:23 UTC and ends within about two hours of its start (its test job stops
   after 110 minutes); GitHub's delay in starting it comes on top.

`tests/e2e/tools/fetch-craft.mjs` implements steps 1 and 2 for the tests.

### The layer's files

Take the injector, `core.js` and the adapters together from one release of this repository,
pinned in the updater's configuration, and move to a newer one deliberately, after reading its
[changelog](../CHANGELOG.md). Each release has them in its hosting bundle, with the checksums of
its assets in `SHA256SUMS`, as plain downloads (no API) from
`https://github.com/hozwei/nextcloud-craftsuite-layer/releases/download/v<version>/<asset>`:

| Asset | Content |
|---|---|
| `craftsuite-layer-hosting-<version>.tar.gz` | One folder `craftsuite-layer-hosting-<version>/` with `hosting/inject-translator.sh`, `hosting/README.md`, `hosting/nginx/craft-apps.conf.template`, `hosting/compose.example.yaml`, `translators/*.js`, `translators/README.md`, `apps.json` and `LICENSE` |
| `SHA256SUMS` | The SHA-256 checksums of the release's archives, for `sha256sum -c` |

The bundle keeps the repository's layout, so `inject-translator.sh` finds the translators in
`../translators` next to it, without `--translators`. How to fetch and use it:
[hosting/README.md](../hosting/README.md#in-a-release-updater). Running the injector of a newer
release on the Craft app version being served updates the translator without a new Craft app
release.

### The app list

`apps.json` at the root of the hosting bundle (and of this repository) lists the Craft apps the
release supports, in the order the Nextcloud app gives them a click. An updater can take its
list of apps and the values below from there instead of keeping its own, so that an app a new
release adds is served without a change to the updater (and Nextcloud then needs no setting
either, with the address for all apps; [nextcloud-app.md](nextcloud-app.md#configuring)).

```json
{
  "format": 1,
  "apps": {
    "lightcraft": {
      "name": "LightCraft",
      "repo": "storytold/lightcraft",
      "description": { "en": "Develop and export photos and camera raws", "de": "Fotos und Kamera-RAWs entwickeln und exportieren" },
      "color": "#f2a516",
      "startupTimeout": 180000,
      "minVersion": "0.6.0",
      "tested": "0.8.0"
    }
  }
}
```

| Field | Meaning |
|---|---|
| `format` | `1`. A later format that an updater cannot read changes this number. |
| key | The app id: `^[a-z][a-z0-9]*$`, the folder name in `<app>-web-<version>`, the adapter `translators/<app>.js` and the path `/<app>/` of [Layout](#layout). |
| `name` | Display name. |
| `repo` | Upstream repository on GitHub, `owner/name`: the releases of step 1. |
| `description` | A short line about the app in English (`en`) and German (`de`), for a start page. Plain text; escape it like any text from outside. |
| `color` | The app's brand colour, `#rrggbb` (as storytold's launcher has it). |
| `startupTimeout` | Recommended `--startup-timeout` in milliseconds, for apps whose download does not hold back the page's `load` event (see [Startup timeout](#startup-timeout)). Missing: the default of 60000 fits. |
| `minVersion` | The oldest release the adapter handles: older ones were never tested, or cannot do what the layer needs. Skip releases below it (step 1). |
| `tested` | The newest release this layer release was tested with. Newer ones are what the canary tests (step 4). |

Check the values before using them (the id and colour against the patterns above, the texts as
untrusted text) and ignore fields an updater does not know. Repository changes keep the list,
the Nextcloud app and the tests in line (`npm run apps:check` in CI).

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
- **Users sign in in a tab of their own.** The editor page allows the Craft origin in its frame,
  and Nextcloud's own origin (its default policy does, through the bundled PDF viewer). A sign-in
  that redirects to an identity provider on another origin cannot load there, and neither can a
  sign-in page that refuses to be framed. When the app's page has not answered after 15 seconds,
  the editor shows a hint with a link that opens the app in a new tab, and the link stays when the
  editor gives up after 90 seconds: users sign in there and reload the editor page. A long
  sign-in session means they rarely have to.
- **Nextcloud as the identity provider** is the exception: with Nextcloud's OpenID Connect app
  (`oidc`) as the sign-in of the Craft site, the redirect to Nextcloud's authorization page loads
  in the frame, and a user signed in to Nextcloud passes it without a question (reported by an
  operator with Nextcloud 34 and `oidc` 2.5.2). The frame then needs nothing more; the new tab
  stays the way out where it asks something.
- **The sign-in page must not be framed by others.** Send `frame-ancestors` on it too, with the
  Nextcloud origins or `'none'`: a sign-in form that any site can frame invites clickjacking.
- **Caching.** Use `private` instead of `public` in `Cache-Control`, so that shared caches do not
  keep what only signed-in users may get.

## Checklist

- [ ] Own origin, HTTPS, another host name than Nextcloud
- [ ] App addresses without a query
- [ ] Injector and translators from one pinned release of this repository, checked against its
  `SHA256SUMS`
- [ ] Only the files the apps need: no Cargo leftovers from LightCraft's release (`build/`,
  `deps/`, ...)
- [ ] `index.html` starts its `<head>` with the two script tags (`inject-translator.sh --check`
  exits 0)
- [ ] `--startup-timeout 180000` for LightCraft and EffectCraft, the same on every run
- [ ] A service worker the build ships (EffectCraft's `sw.js`) is replaced by one that removes
  itself (`inject-translator.sh` does it; `--check` reports one that is still the app's own)
- [ ] `data-allowed-origins` and `frame-ancestors` list the same Nextcloud origins
- [ ] No `X-Frame-Options`
- [ ] `immutable` only on `*.js` and `*.wasm` with a content hash in the name; `no-cache` on
  everything else (`index.html`, `sw.js`, `craftsuite-layer/`, the unhashed files of FilmCraft,
  LightCraft and EffectCraft); `application/wasm` on `.wasm`
- [ ] Behind a sign-in: the session cookie reaches the framed app, and the sign-in page sends
  `frame-ancestors`
- [ ] Opened directly (not framed), the app works as usual; the translator is inactive
- [ ] Framed by the Nextcloud app, a file opens and Save stores it in Nextcloud
  ([nextcloud-app.md](nextcloud-app.md))
