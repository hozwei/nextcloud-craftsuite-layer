<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Development

## Requirements

- Node.js 24 or newer.
- The Playwright browsers Chromium, Firefox and WebKit. On Linux they need system libraries;
  `npx playwright install --with-deps` installs them (needs root).
- The loopback addresses `127.0.0.1` and `127.0.0.2`. Linux and Windows route all of
  `127.0.0.0/8` to loopback; on macOS add the second one with
  `sudo ifconfig lo0 alias 127.0.0.2 up`.
- For the tests in Nextcloud: Docker and `make`, or any Nextcloud 34 or 35 the browser can
  reach (see [Testing in Nextcloud](#testing-in-nextcloud)).
- Optional: `make`, PHP and `xmllint` for the app's checks, and dash, BusyBox and ShellCheck for
  the [hosting tests](#hosting-tests).

## Setup

```sh
npm ci
npx playwright install chromium firefox webkit
npm run craft:fetch          # the web builds of the Craft apps in apps.json, in their tested versions
npm test                     # lint, typecheck, translations, end-to-end tests
```

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Bundles the Nextcloud app's front end (`craftsuite_layer/src/{editor,files,admin}.ts`) with esbuild into `craftsuite_layer/js/*.mjs`, each with a `.license` file listing the bundled npm packages. `npm run build:dev` keeps the output readable, with inline source maps. |
| `npm run lint` | ESLint over the JavaScript (translators, test pages, test server, tools, the app's build scripts), the app's front end and the TypeScript tests in `tests/e2e/`. For the TypeScript it uses typescript-eslint with type information (`no-floating-promises`, `no-misused-promises`: a forgotten `await` is the most common cause of flaky browser tests), and for the tests the recommended rules of eslint-plugin-playwright. |
| `npm run typecheck` | TypeScript check of `tests/e2e/` and of the app's front end |
| `npm run l10n:check` | Every text the app shows has a translation in each language of `craftsuite_layer/l10n/` (German: `de` informal, `de_DE` formal), none is unused, placeholders match, and `l10n/*.js` matches `l10n/*.json` |
| `npm run blanks:check` | The blank documents of the "+ New" entries in `craftsuite_layer/assets/` are byte for byte what `craftsuite_layer/blanks.mjs` makes, and their stand-ins (the creation time, FilmCraft's project name) are the ones `lib/Service/NewFiles.php` replaces; `npm run blanks:write` makes them again after a change there |
| `npm run l10n:write` | Writes `l10n/*.js` from the edited `l10n/*.json` |
| `npm run apps:check` | `apps.json`, the one list of the Craft apps, against the Nextcloud app (`CraftApps::APPS`: the same apps, names and order; `MimeIcons` and `NewFiles` name no other app, read with PHP from `$PHP` or `php`), each app's adapter, spec and page, the lists of apps in the documentation, and `NON_BLOCKING` in both workflows |
| `npm run craft:fetch` | Downloads the tested version of each Craft app (`tested` in `apps.json`) into `.craft-builds/` and verifies it |
| `npm run craft:fetch-latest` | The same with the newest release of each app |
| `npm run test:e2e` | All Playwright projects |
| `npm test` | `lint`, `typecheck`, `l10n:check`, `blanks:check`, `apps:check` and `test:e2e` |
| `make -C craftsuite_layer lint` | `php -l` on every PHP file, a `CHANGELOG.md` section for the version in `appinfo/info.xml`, and `info.xml` and the icons well-formed (with `xmllint`; with `INFO_XSD=<path>` also against the App Store schema) |
| `make -C craftsuite_layer appstore` | The App Store archive, see the `Makefile` |

`package.json` pins every tool to an exact version. TypeScript stays at 6.0 (6.0.3) rather than
7, because typescript-eslint (8.71) supports TypeScript only below 6.1 so far. Update the two
together once typescript-eslint supports a newer TypeScript.

Run one project with `npm run test:e2e -- --project translator-firefox`.

| Project | Spec | Runs against |
|---|---|---|
| `translator-chromium` | `specs/translator.spec.ts`, every test | the stub app in `tests/e2e/stub-app/`, which imitates PdfCraft's browser-facing behaviour: fast and independent of the app's UI |
| `translator-firefox`, `translator-webkit` | `specs/translator.spec.ts`, only the tests tagged `@cross-browser` (see [Writing tests](#writing-tests)) | the same stub app |
| `<app>-chromium`, `<app>-webkit` for each app in `apps.json` | `specs/<app>.spec.ts` and `specs/service-workers.spec.ts` | the real web build from `.craft-builds/`. The apps need WebGL2: Chromium runs them with SwiftShader, WebKit with the system's GL libraries (set `CRAFTSUITE_WEBKIT_EXECUTABLE` where those are missing). The `<app>-webkit` projects are in `NON_BLOCKING`, so CI does not let them fail a run (see [Continuous integration](#continuous-integration)). |
| `nextcloud-chromium` | `specs/nextcloud.spec.ts`, `specs/nextcloud-files.spec.ts`, `specs/nextcloud-apps.spec.ts` | the Nextcloud app in a real Nextcloud, with the real Craft builds; only defined when `NEXTCLOUD_URL` is set (see [Testing in Nextcloud](#testing-in-nextcloud)) |

Each `<app>.spec.ts` keeps the steps that drive the app apart from the contract checks: what the
host and the browser see. It drives the app with the keyboard: its shortcuts and, where the app
has one, its command palette, with the English labels from the app's source (the app's page in
[`apps/`](apps/) names the files). Only its `ui` test, tagged `@ui`, also clicks with the pointer.
The click positions are the only layout knowledge in the spec, in its `AT` table, measured at a
1400x900 viewport with the locale `en-US` (LightCraft's at 1400x1400: its Export dialog is taller
than a 900 px frame). Some apps are driven partly through their own page APIs where neither a
shortcut nor a palette reaches a command (`window.filmcraft`, `window.effectcraft`,
`lightcraft.command`); LightCraft, which renders on the page's thread, also gets longer host
deadlines (20 s for `app-ack` and `app-result` instead of 3 s). When only the `@ui` test fails after a release,
re-measure those positions; the test reports every pointer path that failed
(`scenario failed: <title>`), not only the first. The `language` test of each app that can start
in a chosen language, tagged `@language`, starts it with a host language and checks that the app
took it, through a translated label, its own API or a part of the screen compared with a start
in that browser locale. The contract tests alone: `npm run test:e2e -- --grep-invert '@ui|@language'`.

| Environment variable | Meaning |
|---|---|
| `CRAFTSUITE_PORT_BASE` | First of the three test server ports (default 8701) |
| `CRAFT_BUILDS_DIR` | Where the Craft builds are (default `.craft-builds`) |
| `CRAFTSUITE_WEBKIT_EXECUTABLE` | A WebKit binary or wrapper script, for machines without WebKit's usual system libraries |
| `CI` | Set by CI: one retry, list and HTML report, never reuse a running test server |
| `NEXTCLOUD_URL`, `NEXTCLOUD_USER`, `NEXTCLOUD_PASSWORD` | A test Nextcloud for the project `nextcloud-chromium`; `NEXTCLOUD_URL` also adds its origin to the translator's allowed origins on the test server (`CRAFTSUITE_EXTRA_ALLOWED`) |
| `NEXTCLOUD_USER2`, `NEXTCLOUD_PASSWORD2` | A second user of that Nextcloud, not an administrator, for the tests with files shared between users and without admin rights (see [Testing in Nextcloud](#testing-in-nextcloud)) |

**Runs at the same time** in one checkout need a port base and an output folder each:

```sh
CRAFTSUITE_PORT_BASE=8711 npm run test:e2e -- --project photocraft-chromium --output test-results/photocraft
CRAFTSUITE_PORT_BASE=8721 npm run test:e2e -- --project vectorcraft-chromium --output test-results/vectorcraft
```

Outside CI, a run reuses a test server that already listens on its port, and the run that
started that server stops it when it ends. Every run empties its output folder (`test-results/`
by default) when it starts.

## Test setup

Playwright starts `tests/e2e/server/serve.mjs`, or outside CI reuses one already running on the
port. The server reads `.craft-builds/selected.json` on every request, so a running server
serves the builds fetched after it started and needs no restart after `npm run craft:fetch`.
The handshake step of the `contract` test in each `<app>.spec.ts` checks that the server serves
the build named in `<CRAFT_BUILDS_DIR>/selected.json`; if it fails with "restart the server", a
server from another checkout, another `CRAFT_BUILDS_DIR` or an older `serve.mjs` is running on
the port. The server serves three origins:

| Name | Address | Serves |
|---|---|---|
| host | `http://127.0.0.1:<base>` | The test host page (`tests/e2e/host/`), standing in for the Nextcloud editor page |
| app | `http://127.0.0.2:<base+1>` | `/<app>/` for each fetched Craft build and `/stub/` for the stub app, with the translator injected into `index.html` as a Craft site would |
| foreign | `http://127.0.0.1:<base+2>` | The same host page on an origin that is not allowed |

Both the host and the app origin serve the fixtures under `/files/`, and under `/files/blanks/`
the blank documents of the Nextcloud app's "+ New" entries (`craftsuite_layer/assets/`). Run the
server by hand with `node tests/e2e/server/serve.mjs` and open
`http://127.0.0.1:8701/?target=stub`.

The test host frames a configured app and records everything in `window.__host` (`state`,
`events`, `messages`, `saves`, `errors`, `opened`). Like a real host, it answers every `hello`
with `init` (a `hello` after `ready` means the frame was reloaded), opens one fixture after each
`ready`, and takes the app URL from the server's configuration (`/config.js` on the host origin:
the app URLs, their versions and the app origin), never from its own URL. Its query parameters
only pick a configured app and test behaviour:

| Parameter | Effect |
|---|---|
| `target=<app>` or `stub` | Which configured app to frame (default `pdfcraft`) |
| `name=<fixture>` | The file to open, a path under `tests/e2e/fixtures/`, or `blanks/<name>` for a blank document in `craftsuite_layer/assets/` (default `craftsuite-probe.pdf`), sent under its base name |
| `open=0` | Open nothing |
| `appfile=1` | Let the app load the probe itself with `?file=` instead of sending it with `open` |
| `ack=0` | Never confirm saves |
| `result=0` | Confirm saves, but never report a result |
| `fail=1` | Confirm saves, then report a failed store |
| `fail-delay=<ms>` | With `fail=1`: milliseconds between recording the save and reporting the failure (default 300) |
| `app-<name>=<value>` | Passed on to the app URL as `<name>=<value>`. The test server turns `allowed` into the translator's `data-allowed-origins` (default: the host origin), and `ack`, `result`, `startup` and `drop` into `data-save-ack-timeout`, `data-save-result-timeout`, `data-startup-timeout` and `data-drop-target-timeout` (milliseconds). `version` replaces `data-app-version` (default: the served build's version); an empty `version` leaves it out. The stub app reads its own parameters from the same URL, such as `mode` (see the header of `tests/e2e/stub-app/stub.js`). `app-adapter=stub` serves the test adapter `tests/e2e/stub-app/stub-adapter.js` instead of the app's adapter (its knobs are in its header). |

Fixtures in `tests/e2e/fixtures/` (committed):

| File | Content |
|---|---|
| `craftsuite-probe.pdf` | Two pages with a marker, classic cross-reference table, so PdfCraft saves incrementally and the tests can compare prefixes |
| `attach-traversal.pdf` | One page with an embedded PDF named `../../Team/Budget 2026.pdf`, a document-controlled name |
| `photocraft/probe.psd`, `photocraft/probe.png`, `photocraft/elsewhere/probe.psd` | A 64x48 PSD, the same picture as a PNG, and a different PSD under the same name |
| `vectorcraft/craftsuite-probe.vectorcraft`, `vectorcraft/renamed-probe.vectorcraft`, `vectorcraft/probe.svg` | A native file, the same drawing renamed (gzip, another stored title, data after the JSON), and an SVG |
| `designcraft/craftsuite-probe.designcraft`, `designcraft/from-indesign.idml` | Saved by DesignCraft 0.5.0 from inputs of this project (see [apps/designcraft.md](apps/designcraft.md)) |
| `wordcraft/craftsuite-probe.docx`, `wordcraft/from-word.docx`, `wordcraft/probe.odt`, `wordcraft/probe.rtf` | A `.docx` saved by WordCraft 0.5.0 (see [apps/wordcraft.md](apps/wordcraft.md#tests)), a `.docx` as Word writes it (a content control, a form field, a custom XML part), an ODT and an RTF |
| `gridcraft/craftsuite-probe.xlsx`, `gridcraft/sales-sample.xlsx`, `gridcraft/from-excel.xlsx`, `gridcraft/macros.xlsm`, `gridcraft/data.ods`, `gridcraft/data.csv` | Saved by GridCraft 0.5.0 (a new workbook with the marker; the Start dialog's sales sample with charts, a table and notes, GridCraft's own content under MIT or Apache-2.0), and written by `gridcraft/make-fixtures.mjs`: an Excel workbook with parts GridCraft drops, the same with a VBA project, an ODS and a CSV (see [apps/gridcraft.md](apps/gridcraft.md)) |
| `deckcraft/craftsuite-probe.pptx`, `deckcraft/craftsuite-probe.deckcraft` | A one-slide PowerPoint package with a marker, a stored title and a creation time (written by `deckcraft/make-fixtures.mjs`), and DeckCraft 0.5.0's save of the same slide without a creation time (see [apps/deckcraft.md](apps/deckcraft.md)) |
| `cadcraft/craftsuite-probe.dxf`, `cadcraft/foreign.dxf`, `cadcraft/newer-cadcraft.dxf` | A DXF saved by CADCraft 0.5.0 (a circle and a text with a marker); an R2018 DXF as another program writes it, with header variables, xdata, an MLINE and an XRECORD that CADCraft drops; and the CADCraft DXF with an MLINE, `$FINGERPRINTGUID` and another application's xdata added. CRLF text, kept byte for byte (`.gitattributes`, see [apps/cadcraft.md](apps/cadcraft.md#tests)) |
| `lightcraft/probe-photo.jpg`, `lightcraft/probe-scan.tif`, `lightcraft/elsewhere/probe-scan.tif`, `lightcraft/probe-raw.dng` | A 120x80 JPEG, a 90x60 TIFF, a different 64x64 TIFF under the same name, and a 96x64 DNG with an uncompressed RGGB mosaic, written by `lightcraft/make-fixtures.mjs` (which needs Playwright's Chromium for the JPEG; see [apps/lightcraft.md](apps/lightcraft.md#tests)) |
| `filmcraft/FilmCraft Demo.fcproj`, `filmcraft/Main Edit.edl`, `filmcraft/craftsuite-probe.fcproj`, `filmcraft/old-schema.fcproj` | Saved by FilmCraft 0.6.0 from its demo project (the project, and its File > Export > EDL…; FilmCraft's own content under MIT or Apache-2.0), and derived from it by `filmcraft/make-fixtures.mjs`: a copy that stores another project name (`Probe Title`) with a marker in its notes, and one in schema 14 (see [apps/filmcraft.md](apps/filmcraft.md)) |
| `effectcraft/craftsuite-probe.ecproj`, `effectcraft/craftsuite-probe.ecprojx` | Saved by EffectCraft 0.8.0: a blank project with a new composition and a solid, and its Save a Copy As XML (see [apps/effectcraft.md](apps/effectcraft.md#tests)); the spec derives the other files it opens from them |
| `soundcraft/craftsuite-probe.scraftz` | Written by `soundcraft/make-fixtures.mjs`: a bundle of stored entries like SoundCraft's saves, the session `craftsuite-probe` (comments `CRAFTSUITE-PROBE-sc01`) with the tracks Tone A (selected) and Tone B, each a 0.1 s tone, in the fields SoundCraft 0.6.1 writes (see [apps/soundcraft.md](apps/soundcraft.md#tests)) |

`node tests/e2e/fixtures/make-fixtures.mjs` rewrites the PDFs, and the `make-fixtures.mjs` in the
app folders rewrite the files that are not saved by the app itself (each script says which).

## Testing in Nextcloud

The project `nextcloud-chromium` runs three specs in a real Nextcloud with the app:

| Spec | What it checks |
|---|---|
| `nextcloud.spec.ts` | The editor page with PdfCraft: saves replace the opened file and Nextcloud keeps a version, two quick saves both reach Nextcloud, a reload of the app frame keeps the last save, exports become new files, after Sanitize the next Save continues the new file, a conflict becomes a copy that later saves follow, a missing ETag gives a copy too, a page another site opened asks first, the page explains files it cannot open, Close waits for a pending save, leaving asks |
| `nextcloud-files.spec.ts` | The entries in Files ("Open in PdfCraft", PhotoCraft on a click for a PSD but not a PNG, DesignCraft for a `.designcraft`, a `.dxf` to CADCraft when it has an address and to VectorCraft otherwise) and the Craft icons, the settings page refusing unusable addresses (also one with a `?query`), saving after Nextcloud's password dialog and the language an app starts in; `default app`: WordCraft and PdfCraft made the default app take the click on a `.docx` and a PDF, the settings page says what a click opens, the office app they replace (a hidden default of the test's own) gets a menu entry that opens it without leaving Files, the Viewer's View keeps the Viewer open for a PDF, and a PNG still opens in the Viewer; `new files`: the "+ New" entries (WordCraft's only as the default app) make files from the blanks that open in their app, with the time they were made as the creation time (DesignCraft, WordCraft, DeckCraft) and, for FilmCraft, the file's name as the project name, DeckCraft's and FilmCraft's under a name changed in Files' dialog; shares to the second user (without download permission: no entry and 403; read-only: a save becomes a new file; no settings for non-admins), a `/f/<id>` link that another site opens getting the question first, and the German texts |
| `nextcloud-apps.spec.ts` | PhotoCraft, VectorCraft and DesignCraft saving the opened file as another type, and WordCraft saving a Word file another program wrote as a copy: the first save becomes a new file next to the original, later saves replace it, the original stays unchanged |

It runs one test at a time: a test Nextcloud on SQLite answers parallel writes with `database is
locked`. The tests log in with the given user, who must be an administrator, work in a folder of
their own and check the results through WebDAV. A second user, `NEXTCLOUD_USER2`, must not be an
administrator: the tests share files with that user and use the app without admin rights. The
tests in `nextcloud-files.spec.ts` that change settings (`designcraft_url`, `vectorcraft_url` and
`cadcraft_url`, languages, default apps) note the addresses, languages and default apps as they
found them, and an `afterEach` hook saves them again, also after a test that failed or timed out
(the other specs need them).

A test Nextcloud with Docker, for the default port base. It runs the App Store package, as
users install it: `make appstore` stages it in `craftsuite_layer/build/stage/craftsuite_layer/`,
so a runtime file the package leaves out fails the tests here too. The browser reaches the test
server on its own loopback addresses; Nextcloud never contacts it.

```sh
make -C craftsuite_layer appstore  # builds js/ and stages the App Store package
docker run -d --name nextcloud-test -p 8080:80 \
  -e SQLITE_DATABASE=nextcloud \
  -e NEXTCLOUD_ADMIN_USER=admin -e NEXTCLOUD_ADMIN_PASSWORD=test-password \
  -e NEXTCLOUD_TRUSTED_DOMAINS=localhost \
  -v "$PWD/craftsuite_layer/build/stage/craftsuite_layer:/var/www/html/custom_apps/craftsuite_layer" \
  nextcloud:35.0.1-apache
# Wait until http://localhost:8080/status.php reports "installed":true.
occ() { docker exec -u www-data nextcloud-test php occ "$@"; }
occ app:enable craftsuite_layer
occ app:disable firstrunwizard     # its dialog would cover the page
for app in $(node -p "Object.keys(require('./apps.json').apps).join(' ')"); do
  occ config:app:set craftsuite_layer "${app}_url" --value="http://127.0.0.2:8702/$app/"
done
# The second user, not an administrator; occ reads the password from OC_PASS.
docker exec -e OC_PASS=e2e-user-password -u www-data nextcloud-test \
  php occ user:add --password-from-env e2e-user
NEXTCLOUD_URL=http://localhost:8080 NEXTCLOUD_USER=admin NEXTCLOUD_PASSWORD=test-password \
  NEXTCLOUD_USER2=e2e-user NEXTCLOUD_PASSWORD2=e2e-user-password \
  npm run test:e2e -- --project nextcloud-chromium
```

After a change to the app, run `make -C craftsuite_layer appstore` again and
`docker restart nextcloud-test`: make replaces the staged folder, and a running container goes on
using the removed one. With another `CRAFTSUITE_PORT_BASE`, the app origin is
`127.0.0.2:<base+1>`. The CI job `nextcloud-e2e` does the same with `nextcloud:34.0.4-apache`
and `nextcloud:35.0.1-apache`. Both images run PHP 8.5, so the end-to-end tests run on PHP 8.5
only; PHP 8.2 to 8.4, which `appinfo/info.xml` also allows, get only the `php -l` of the job
`nextcloud-app`.

## Hosting tests

`hosting/tests/inject-translator.test.sh` tests `hosting/inject-translator.sh` on small made-up
pages and, after `npm run craft:fetch`, on the fetched web builds of all apps; it names
the apps it skipped for want of a fetched build or an adapter. It works in a temporary folder and
removes it. `--busybox` needs `busybox` on the `PATH`; Debian's `busybox-static` has no `cksum`
applet, so it also tests the injector's fallback to `sha256sum`.

```sh
sh hosting/tests/inject-translator.test.sh                 # under sh
sh hosting/tests/inject-translator.test.sh 'bash --posix'  # under another shell, here bash in POSIX mode (or dash)
sh hosting/tests/inject-translator.test.sh --busybox       # BusyBox sh with BusyBox's tools
shellcheck -s sh hosting/inject-translator.sh hosting/tests/inject-translator.test.sh
```

CI runs ShellCheck and the tests under dash, `bash --posix` and BusyBox. The nginx template and
the Compose example have no tests: after changing the template, fill in
`${CRAFTSUITE_ALLOWED_ORIGINS}`, run `nginx -t` on it and check the `Cache-Control` of a few
files of each build with `curl -I`, hashed and unhashed.

## Writing tests

Every test runs once in each Playwright project that matches it, so the specs keep their tests
few: a handful of scenario tests per spec, browsers only where the behaviour differs, one `@ui`
test per Craft app for the paths that need the pointer, and one `@language` test for an app that
can start in a chosen language. `npm run test:e2e -- --list` shows every run, by project.

- A test is a scenario: its steps (`test.step`) check one behaviour after another, and a failure
  names the step that broke. Add a check as a step of the scenario that already sets up what it
  needs, and start a test of its own only for a new setup. A scenario that needs other host
  parameters opens another page in the same test; in the `<app>.spec.ts` files the `scenario()`
  helper runs each in a page of its own and reports every one that fails.
- Several cases of one rule run in a loop inside the test, not as a test each, with
  `expect.soft` where every case should be reported, also after one failed.
- Keyboard first. Drive the Craft apps with their shortcuts and, where there is one, their
  command palette (`tests/e2e/lib/craft-ui.ts`); pointer clicks only in the `@ui` test, whose
  positions are the only layout knowledge in a spec.
- The header of each spec lists its scenarios. Keep it up to date.
- Where a step must show that nothing happens before a deadline, `translator.spec.ts` fakes time
  with Playwright's clock (`page.clock`) instead of waiting: the stub and the translator measure
  time only with timers and animation frames, so a stopped clock makes the deadline exact. The
  clock belongs to the browser context, so a test that needs a clock per case opens a context
  per case. Other steps wait for the event they expect, never for a fixed time. The real Craft
  apps animate and cannot run under a fake clock, so their specs use short timeouts in real time.
- `translator.spec.ts` runs every test in Chromium, and Firefox and WebKit run only the tests
  tagged `@cross-browser`. Tag a test `{ tag: '@cross-browser' }`, and place it under "Every
  engine" in the spec and in its header, only if what it checks depends on how a browser drops
  files, downloads them or posts messages, such as the name a download keeps. Anything else goes
  into a Chromium-only test.
- The Nextcloud specs share `tests/e2e/lib/nextcloud.ts` (login, a WebDAV folder per test, the
  editor page) and check every result through WebDAV.

## Testing a new Craft release

```sh
npm run craft:fetch-latest   # the newest release of each app
npm run test:e2e
npm run craft:fetch          # back to the tested versions
```

A specific release: `node tests/e2e/tools/fetch-craft.mjs --app pdfcraft --version <version>`. It
changes only that app's entry in `selected.json`, so the other apps keep theirs;
`npm run craft:fetch` goes back to the tested versions of all of them.

The fetch tool uses github.com release URLs only (no API), checks each archive against the
release's `SHA256SUMS.txt`, accepts only `<app>-web-<version>/` inside, and reuses builds it has
verified before. It records the selected versions in `.craft-builds/selected.json`. The test
server reads that file on every request, so a server that is already running tests the new
build without a restart.

When the tests pass with a newer release, raise `tested` in `apps.json`.
When they fail, find the changed behaviour (see
[architecture.md](architecture.md#upstream-coupling-points)), fix the adapter or the core, and
update `docs/apps/<app>.md`.

## Continuous integration

Workflows live in `.github/workflows/`:

| Workflow, job | When | What |
|---|---|---|
| CI (`ci.yml`), `translators-and-tests` | pushes to `main`, pull requests, by hand | Lint, typecheck, the [hosting tests](#hosting-tests), and the end-to-end tests against the tested Craft versions |
| CI, `nextcloud-app` | the same | `php -l` on PHP 8.2, 8.3, 8.4 and 8.5 (a deprecation fails too); on 8.2 also `appinfo/info.xml` against the App Store schema, `npm run l10n:check`, `npm run blanks:check`, `npm run apps:check`, and the App Store package with the App Store's archive rules |
| CI, `nextcloud-e2e` | the same | The project `nextcloud-chromium` in a Nextcloud started from the official images `nextcloud:34.0.4-apache` and `nextcloud:35.0.1-apache` (both on PHP 8.5), on SQLite, see [Testing in Nextcloud](#testing-in-nextcloud) |
| Canary (`canary.yml`), `canary` | daily, by hand | Fetches the newest release of each Craft app and runs `translator-chromium` and every `<app>-<browser>` project against it: first the contract tests, then the `@ui` and `@language` tests, then the `NON_BLOCKING` projects |
| Canary, `nextcloud-next` | the same | Reads `package.json` and `version.php` of Nextcloud's development branch (raw files, no API). Reports (`changed`) when `package.json` no longer asks for `@nextcloud/files` 4.x, the major whose action registry the Files entries use, and warns when the branch's major version is above the `max-version` in `appinfo/info.xml`. Nothing else of the server is checked. It never fails, so a failed run is always one of the Craft releases' tests (or of the report). |
| Canary, `report` | after both, on `main` | Opens, comments on or closes the issues labelled `canary` and `canary-ui` (from the job `canary`) and `canary-nextcloud` (from `nextcloud-next`); each part acts only on its own job's result. On the `canary` issue it sets the labels `canary:<app>` of the apps to hold back |
| Release (`release.yml`), `release` | a pushed tag `v*` | Checks the versions, builds the release's assets and publishes the GitHub release, see [Releasing](#releasing) |

In CI, every Playwright project can fail the check, except those listed in `NON_BLOCKING`: at
present the `<app>-webkit` project of every app. They were added there because they had passed
only outside GitHub, through a WebKit wrapper with its own GL libraries, while on a GitHub runner
the apps' WebGL2 depends on the image's libraries; they have since passed on GitHub runners too
(the CI of 0.2.0 and 0.4.0 among others). Until they are removed, the canary decides with
Chromium only: a release that breaks the translator only in Safari opens no issue (Firefox is not
tested with the apps at all). `ci.yml` and `canary.yml` each carry this list, and both must stay
the same (`npm run apps:check`): the listed projects run all their tests in a step of their own
that can neither fail the run nor change the canary's advice or issues. A new app's
`<app>-webkit` starts in the list; remove a project from both files to make it decide. The App
Store schema (`info.xsd`) comes from the `nextcloud/appstore` commit in `SCHEMA_COMMIT`, so a
change there cannot break CI without a change here; `ci.yml` describes how to move it.

The canary's contract tests decide its result. A test that passes only on its retry counts as
failed and is listed in the summary, so that a release that changes the timing gets looked at.

- **Contract tests fail.** An upstream release changed something the translator relies on, or
  the test environment changed. The summary advises holding a new release back, and the run opens
  an issue labelled `canary` (or comments on the open one); the next passing run closes it. This
  happens before sites that wait a day take the release (see
  [hosting.md](hosting.md#updates)). The summary names the apps to hold back: those whose own
  projects failed, or all apps when the failure is not one of single apps (a failed fetch, the
  translator's own tests). The issue gets their labels (`canary:<app>`; a later failing run
  replaces them), and each report ends with a line `canary-result {...}` with the run, those apps
  and the versions tested, for updaters. A spec of every app is also
  `service-workers.spec.ts`: a release that registers a service worker other than `sw.js` at the
  build's root fails it, because the hosting would not replace that worker
  ([hosting.md](hosting.md#service-workers)). When a spec's check of the "+ New" blank fails (it opens
  `blanks/blank.<ext>`, and for WordCraft, GridCraft and PdfCraft also
  `blanks/blank-letter.<ext>`), the release changed what it takes as its own new document:
  `craftsuite_layer/blanks.mjs` needs the release's format, not the translator; until then the
  entry makes files the app saves as copies or does not open.
- **Only `@ui` or `@language` tests fail.** The run passes, and an issue labelled `canary-ui`
  tracks the failure until the tests pass again. With a new release, the summary names the specs
  whose `AT` pointer positions need updating, and those whose language test fails: the release
  changed a label or screen area the test reads, or how the app takes its language (then the
  adapter's `language` member needs a new way in; files still open and save, and the app starts
  in its own language). Raise `tested` only after that, because CI runs these tests against the
  tested versions.
- **Everything passes.** The summary says which `tested` versions to raise, if any.
- **The next Nextcloud release asks for another `@nextcloud/files` major.** The job
  `nextcloud-next` says so, and an issue labelled `canary-nextcloud` opens (the next run that
  finds 4.x again closes it); the run itself does not fail. The Files entries then need that
  major, a test against that server and a wider range in `appinfo/info.xml` before the release
  ships. When the check finds nothing out (a download fails, the dependency is gone from
  `package.json`), `report` only adds a warning to the run, and leaves the issue as it is. The warning of `nextcloud-next` that the development branch is above `max-version` is a
  reminder: that release needs a row in the `nextcloud-e2e` matrix and a wider range before it
  ships.
- **No run.** GitHub may skip a scheduled run, and turns the schedule off after 60 days without
  activity in the repository; then no issue opens or closes. The first scheduled run, due at
  04:23 UTC on 12 October 2026, did not start then: the canary first ran by hand that day, and
  the first scheduled run started at 12:12 UTC. When the Actions
  tab shows no run for a day (the Canary badge shows only the latest result, not when it ran),
  start one there (Run workflow, branch `main`), and turn the schedule back on if GitHub turned it
  off. Sites that update from the
  canary check its latest run, not only its issues (see [hosting.md](hosting.md#updates)).

Dependabot (`.github/dependabot.yml`) proposes updates once a week, for the npm packages at the
root (the test tooling, and the libraries and esbuild that build the app's front end), the
Composer file of the Nextcloud app and the pinned actions, each release at least seven days old.
Major updates come one by one. Majors of `@nextcloud/files` are ignored: the bundled major must
be the one the supported servers ship, so it moves by hand, together with the range in
`appinfo/info.xml` and the `nextcloud-e2e` matrix. Majors of `@types/node` are ignored too: they
describe the Node.js the tooling runs on (24, `engines` in `package.json` and the workflows'
`node-version`), so they move by hand, together with it. New TypeScript majors and minors move by
hand, together with typescript-eslint, which supports only a range of TypeScript versions. The Nextcloud image tags in that matrix are
moved by hand as well. `SCHEMA_COMMIT` is not covered and is moved by hand.

## Releasing

Changes to `translators/` reach `main` only together with a release (the release commit, then its
tag): the canary tests `main`, and updaters count its runs by the `LAYER_VERSION` that
`translators/core.js` has at a run's commit ([hosting.md](hosting.md#updates), step 4). Changes
that leave the translators as they are (documentation, tests, workflows, Dependabot) may come in
between.

The Nextcloud app and the translator share one version number, following
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). A release is a tag `v<version>` on
`main`; the workflow `release.yml` builds and publishes it.

1. Raise the version in `craftsuite_layer/appinfo/info.xml` (`<version>`) and in
   `translators/core.js` (`LAYER_VERSION`, which `hello` and `ready` report as `layerVersion`),
   together.
2. In both changelogs, `CHANGELOG.md` and `craftsuite_layer/CHANGELOG.md`, turn
   `## [Unreleased]` into `## [<version>] - <YYYY-MM-DD>` and add a new, empty
   `## [Unreleased]` above it. At the end of `CHANGELOG.md`, point the `[Unreleased]` link at
   `compare/v<version>...main` and add one for the new version, comparing the previous tag with
   `v<version>` (`releases/tag/v<version>` for the first release). `make -C craftsuite_layer lint`
   checks that the app's changelog has a section for the version in `info.xml`.
3. Check whether `SCHEMA_COMMIT` in `ci.yml` needs moving (its comment says how).
4. Merge into `main` and wait until CI has passed there.
5. Start the canary on `main` by hand (Actions > Canary > Run workflow, branch `main`) and wait
   for it to end. Updaters that follow the releases take a release only once a canary run of its
   `LAYER_VERSION` has finished and the newest finished one did not fail for every app
   ([hosting.md](hosting.md#following-the-layers-releases)). A run that fails only for single
   apps (an upstream release the translators cannot handle yet) does not hold the release back.
   One that fails for every app does: if the cause lies outside the translators (a failed
   download, the runner), start the canary again once it is gone; if the translators need a fix,
   do not tag this version, and make the fix a release of the next one (steps 1 to 5), so that
   all runs of one `LAYER_VERSION` tested the same translators.
6. Push the tag `v<version>` on that commit, with `git tag` and `git push` or the maintainers'
   own publishing tools.

`release.yml` then checks that the tag is `v` plus the version in `info.xml`, that `LAYER_VERSION`
is the same, and that both changelogs have a section `## [<version>] - <YYYY-MM-DD>`. If one of
these fails, the run stops and no release is created: fix it on `main`, delete the tag and push
it again on the new commit. Otherwise it builds the assets, writes the release notes (the app
changelog's section for the version, then a list of the assets) and creates the release:

| Asset | Content |
|---|---|
| `craftsuite_layer-<version>.tar.gz` | The Nextcloud app as `make -C craftsuite_layer appstore` builds it: one folder `craftsuite_layer/`, unpacked into the server's `custom_apps/` ([nextcloud-app.md](nextcloud-app.md#installing)). It is not code-signed; signing would need the app's certificate (see the `Makefile`). |
| `craftsuite-layer-hosting-<version>.tar.gz` | One folder `craftsuite-layer-hosting-<version>/` with `hosting/inject-translator.sh`, `hosting/README.md`, `hosting/nginx/craft-apps.conf.template`, `hosting/compose.example.yaml`, `translators/*.js`, `translators/README.md`, `apps.json` and `LICENSE`, in the repository's layout, so that the injector finds `../translators` ([hosting.md](hosting.md#the-layers-files)) |
| `SHA256SUMS` | The SHA-256 checksums of both archives, for `sha256sum -c` |

Each asset is a plain download from
`https://github.com/hozwei/nextcloud-craftsuite-layer/releases/download/v<version>/<asset>`, so
that installations and release updaters need no GitHub API (and none of its rate limit) to
download them; only the check that the canary has run and, for an updater that follows the
releases, the release list use it ([hosting.md](hosting.md#updates),
[Following the layer's releases](hosting.md#following-the-layers-releases)).

### What updaters rely on

Hostings may take new releases of this repository by themselves
([hosting.md](hosting.md#following-the-layers-releases)), and a Nextcloud server may be updated by
a script that replaces the app's folder and runs `occ upgrade`
([nextcloud-app.md](nextcloud-app.md#installing)). So every release keeps to this:

- **Only what may be rolled out is a full release.** `release.yml` publishes every tag as one,
  and GitHub's `releases/latest` then points at it; updaters that follow the releases take it
  once its checks pass (with step 5 done, on their next run). A release that must not be rolled
  out has to be turned into a draft or a pre-release on GitHub at once; `release.yml` has no
  switch for that. Sites that took it in the meantime stay on it (updaters never move to a lower
  release), so the fix comes as a newer release.
- **The form stays:** the tag `v<major>.<minor>.<patch>` on the release commit, the two archives
  with exactly the names above, `SHA256SUMS` with both of their lines, and `translators/core.js`
  at that path with the lines `const LAYER_VERSION = '<version>';` and
  `const PROTOCOL_VERSION = <n>;` (updaters read both, from the bundle and from the file at a
  canary run's commit; `release.yml` checks the first).
- **`translators/` changes on `main` only in a release commit**, the one that raises
  `LAYER_VERSION`, so that all canary runs of one `LAYER_VERSION` tested the same translators.
- **The canary has run on the release commit before the tag** (step 5): until a run of its
  `LAYER_VERSION` has ended, and while the newest one failed for every app, updaters that follow
  the releases leave the release alone.
- **`PROTOCOL_VERSION`** in `translators/core.js` (with `VERSION` in
  `craftsuite_layer/src/editor.ts`) changes only with a change that one side would misread
  ([protocol.md](protocol.md#compatibility)). Updaters stop at such a release, and the hosting
  and the Nextcloud app move to it together by hand; both changelogs say so.
- **The canary keeps its form:** `canary.yml` on `main` with its `schedule` and
  `workflow_dispatch`; one issue labelled `canary` that a failing run opens or comments on and the
  next passing run closes (the workflow never reopens one); the labels `canary:<app>` of the apps
  of its latest failing run; and at the end of each report the line `canary-result {...}` with
  `run`, `attempt`, `commit`, `layer`, `failed` and `tested`, written with the workflow's own
  token (`github-actions[bot]`: updaters read only its reports, since anybody may comment on a
  public issue) ([hosting.md](hosting.md#updates), step 4).
- **The changelog names what needs more than the usual update.** For the Nextcloud app, more than
  replacing its folder and `occ upgrade`: a database migration, a setting someone has to set, an
  `occ` command, an order of steps, another range in `<nextcloud>` in `appinfo/info.xml`. For the
  hosting: a change of the requirements in [hosting.md](hosting.md) (files to serve, headers,
  caching, service workers), of `inject-translator.sh`'s options, of `CRAFTSUITE_ALLOWED_ORIGINS`
  or of its exit codes 0 and 6, of the bundle's layout, or of `apps.json` (another `format`, new
  fields that carry a meaning, or an app's `repo`, from which updaters download); an app's
  `minVersion` raised above a release that may be served (that release loses the translator until
  a newer one is taken); an app that leaves `apps.json`.

## Adding a Craft app

A new Craft app comes with a release of this repository, and the steps below make it routine: the
app's id, name and versions are kept in one place, `apps.json`, and `npm run apps:check` (in CI)
says what else is missing. Hostings that take their list of apps from the hosting bundle and a
Nextcloud with the address for all apps then serve and offer the app without a change of their
own ([hosting.md](hosting.md#the-app-list), [nextcloud-app.md](nextcloud-app.md#configuring)).

**Which apps.** storytold's launcher lists the suite (`storytold/craft-launcher`,
`crates/core/src/catalog.rs`); watch the releases of a candidate (on GitHub, Watch → Custom →
Releases) and look at storytold's new repositories now and then. An app can join once its web
build opens a file it is handed (a drop on the page, as the core hands files over) and saves to a
download (a Blob URL on an `<a download>` that the page clicks). FigCraft 0.6.0 does neither
(SoundCraft does since 0.6.1).

1. Study the web build: how it takes files, how it downloads, how it names and writes saves.
   Start the list of file types from the app's own packaging, `packaging/macos/Info.plist.in`
   (`CFBundleDocumentTypes`, with role `Editor` or `Viewer` and rank `Owner` or `Alternate`),
   `packaging/linux/*.desktop` and `*.mime.xml`, and `packaging/windows/*.wxs`, then try each in
   the web build: the sources disagree with each other, and the web build often does less. Record
   the facts in `docs/apps/<app>.md`.
2. Add the app at the end of `apps.json` (the order decides which app a click opens where two
   apps claim a type and nothing else decides): its name, upstream `repo`, a short description in
   English and German, its brand colour (as in the launcher's catalog), a `startupTimeout` if its
   download does not hold back the page's `load` event (see
   [hosting.md](hosting.md#startup-timeout)), `minVersion`, the oldest release the adapter handles
   (run its spec against that build: `CRAFT_BUILDS_DIR=<dir>` with
   `node tests/e2e/tools/fetch-craft.mjs --out <dir> --app <app> --version <version>`), and
   `tested`. After `npm run craft:fetch`, the test server serves it at `/<app>/` with the adapter
   of the same name, and `playwright.config.ts` defines the projects `<app>-chromium` and
   `<app>-webkit`, which the canary picks up by that name.
3. Write `translators/<app>.js`, see
   [translators/README.md](../translators/README.md#writing-an-adapter).
4. Add `tests/e2e/specs/<app>.spec.ts`, a few scenario tests, one `@ui` test and, if the app can
   start in a chosen language, one `@language` test (see [Writing tests](#writing-tests)). The
   app's projects also run `service-workers.spec.ts`. List `<app>-webkit` in `NON_BLOCKING` in
   both workflows until it has passed on a GitHub runner.
5. Add the app to `CraftApps::APPS` in `craftsuite_layer/lib/Service/CraftApps.php`, at the same
   place as in `apps.json` and with the same name: the extensions it opens, those it opens on a
   click in Files, and `languages`, the BCP 47 tags of its adapter's `LANGUAGES` table (`[]` if
   its web build reads no language). The settings row, the `<app>_url`, `<app>_disabled`,
   `<app>_language` and `<app>_default_app` keys and the Files entries follow from that list. For
   its icon in Files, add its file types to `MimeIcons::ICONS` (and to `FileTypes::MAPPINGS`
   where Nextcloud has no type for them), its icon to `img/types/` with `MimeIcons::FILES`, and its
   copyright to `REUSE.toml` and `img/types/LICENSE-MIT.txt`. If another app already opens a click
   type of the new one, decide which gets the click (`PREFERRED`). CI's Nextcloud job, like the
   Docker example under [Testing in Nextcloud](#testing-in-nextcloud), sets an address for every
   app in `apps.json`; add the app to `LANGUAGE_APPS` and `DEFAULT_APPS` in
   `tests/e2e/specs/nextcloud-files.spec.ts` where the app has these settings: the tests compare
   them with the settings page. Nextclouds with the address for all apps offer the app as soon as
   they run the new release, so say in the changelog that the hosting must serve it first, or
   that the app is to be switched off there until it does.
6. If the app makes new documents, give it a "+ New" entry: its format in `NewFiles::FORMATS`
   (the extension, the MIME type the user's templates must have, the aspect ratio of their
   previews) and the entry's name in `NewFiles::label()`, with its German texts (see
   [Conventions](#conventions)). Add its blank to `blanks.mjs` (an A4 and a Letter one, listed in
   `NewFiles::PAPER`, where the page size matters) and write it with `npm run blanks:write`; where
   the app keeps a creation time or a name its adapter tells documents by, the blank gets a
   stand-in that `NewFiles::stamped()` replaces. A blank with parts of the app's own saves needs
   their copyright in `REUSE.toml` and `assets/LICENSE-MIT.txt`. The entry's icon is the app's
   48 px icon (`assets/app-icon/hicolor/48x48/apps/` in its repository) as `img/new/<app>.png`,
   with its copyright in `REUSE.toml` and `img/new/LICENSE-MIT.txt`. Add a scenario to
   `<app>.spec.ts` that opens the blank (`name=blanks/blank.<ext>`) and checks that its first save
   is the document.
7. The hosting tests run on every fetched build (`hosting/tests/inject-translator.test.sh`). If the
   app's page never dispatches `TrunkApplicationStarted`, loads large files after `load`, has file
   names without a content hash or ships a service worker, say so in `docs/hosting.md` and
   `hosting/README.md` (startup timeout, caching, `sw.js`).
8. New fixtures need an entry in `REUSE.toml` (upstream content under upstream's license), and a
   row in the fixtures table above. Name the app wherever all apps are listed: the README, the
   documentation index, `docs/architecture.md`, `docs/nextcloud-app.md`, `translators/README.md`,
   `craftsuite_layer/appinfo/info.xml` and both changelogs (`npm run apps:check` checks the first
   six).

## Conventions

- English only. Everything here is public: no real domains, IP addresses, personal or account
  names, server names or secrets. Use `example.com` and `example.org` in examples, loopback
  addresses (`127.x.x.x`, `[::1]`) where tests need them, and `192.0.2.x` (reserved for
  documentation, RFC 5737) where an example or a test needs any other address.
- Every source file starts with an SPDX header where comments are possible:

  ```text
  SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
  ```

  Files that cannot hold a comment (JSON, the fixtures, the generated `l10n/*.js`) are listed in
  `REUSE.toml`, in the format of the [REUSE specification](https://reuse.software/spec-3.3/).
  Add new ones there.
- Comments are short and explain why.
- Formatting follows `.editorconfig`: two spaces, LF, final newline; tabs in PHP.
- Translators are classic scripts in ES2022 without a build step.
- A change to the translator's behaviour updates [protocol.md](protocol.md) and the app pages in
  the same change.
- The Nextcloud app in `craftsuite_layer/` has its own changelog: the release notes take each
  version's section from it, as the App Store would (see [Releasing](#releasing)). Its front end
  is TypeScript in `src/`, bundled by `build.mjs`. Texts go through `t('craftsuite_layer', '…')`
  (`src/l10n.ts`) or `$l->t('…')` with a literal text, so that `l10n.mjs` and Nextcloud's
  translation tools find them; a new text needs its German translations in `l10n/de.json` and
  `l10n/de_DE.json`, then `npm run l10n:write`. The root `npm run lint` skips the app's
  generated folders (`js/`, `l10n/`, `vendor/`, `build/`).
