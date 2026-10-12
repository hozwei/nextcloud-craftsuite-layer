<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# nextcloud-craftsuite-layer

Open files from Nextcloud in storytold's Craft web apps (PdfCraft, PhotoCraft, VectorCraft,
DesignCraft, WordCraft, GridCraft, DeckCraft, CADCraft, LightCraft, FilmCraft and EffectCraft)
and save the results back to Nextcloud, without modifying the apps.

[![CI](https://github.com/hozwei/nextcloud-craftsuite-layer/actions/workflows/ci.yml/badge.svg)](https://github.com/hozwei/nextcloud-craftsuite-layer/actions/workflows/ci.yml)
[![Canary](https://github.com/hozwei/nextcloud-craftsuite-layer/actions/workflows/canary.yml/badge.svg)](https://github.com/hozwei/nextcloud-craftsuite-layer/actions/workflows/canary.yml)
License: [AGPL-3.0-or-later](LICENSE)

This is an independent project. It is not affiliated with storytold or Nextcloud GmbH, and the
Craft apps are not part of this repository (see
[Affiliation and trademarks](#affiliation-and-trademarks)).

## What it does

For each Craft app an administrator has set up, Files offers an entry such as **Open in
PdfCraft** in a file's action menu. It opens an editor page in Nextcloud with the Craft app in a
frame and the file loaded. What the user saves in the app goes back into Nextcloud:

- **A save of the opened file** replaces it. Nextcloud keeps the previous content as a version.
- **A save in the app's own format** (a PNG saved as PSD in PhotoCraft) becomes a new file next
  to the original. Later saves replace that new file.
- **A save the app cannot make without losses** (a `.docx` from Word in WordCraft, an `.xlsx`
  from Excel in GridCraft, a DXF from AutoCAD in CADCraft) becomes a copy next to the original,
  which stays as it is. Later saves replace that copy.
- **Exports** always become new files next to the original.
- **A file changed elsewhere** in the meantime is not overwritten: the save becomes a conflict
  copy next to it.
- **A save Nextcloud cannot store** (no permission to write in the folder, quota, an expired
  session) reaches the user as the browser download the app would have made without this layer.

A click on a file opens the Craft app only for types no common Nextcloud app opens. A PDF, PNG
or SVG keeps its Nextcloud viewer on a click, and Office files keep Nextcloud Office, ONLYOFFICE
or Euro-Office; the Craft app is in their action menu. An administrator can make a Craft app the
default app for all its types: then a click opens a `.docx` in WordCraft, for example, and the
other app moves to the action menu ([docs/nextcloud-app.md](docs/nextcloud-app.md#configuring)).
The "+ New" menu of Files makes new files for the Craft apps, such as a PSD for PhotoCraft, and
opens them in the app ([docs/nextcloud-app.md](docs/nextcloud-app.md#new-files)).

| App | Tested version | In the action menu for | Also on a click on the file |
|---|---|---|---|
| PdfCraft | 0.6.0 | `pdf` | none |
| PhotoCraft | 0.7.0 | `psd` `psb` `pcraft` `tga` `png` `jpg` `jpeg` `webp` `gif` `bmp` `tif` `tiff` `ico` `heic` `heif` | `psd` `psb` `pcraft` `tga` |
| VectorCraft | 0.9.0 | `vectorcraft` `drawcraft` `ai` `eps` `svgz` `dxf` `svg` `emf` `wmf` `pdf` | `vectorcraft` `drawcraft` `eps` `svgz` `dxf` |
| DesignCraft | 0.6.0 | `designcraft` `idml` | `designcraft` `idml` |
| WordCraft | 0.5.0 | `docx` `docm` `dotx` `dotm` `doc` `dot` `odt` `rtf` | none |
| GridCraft | 0.5.0 | `xlsx` `xlsm` `ods` `csv` | none |
| DeckCraft | 0.5.0 | `deckcraft` `pptx` `potx` `ppsx` | `deckcraft` |
| CADCraft | 0.5.0 | `dxf` | `dxf` (instead of VectorCraft when both are set up) |
| LightCraft | 0.6.0 | `dng` `cr2` `cr3` `nef` `nrw` `arw` `raf` `orf` `rw2` `rwl` `pef` `srw` `jpg` `jpeg` `png` `tif` `tiff` `webp` | the camera raw types |
| FilmCraft | 0.6.0 | `fcproj` | `fcproj` |
| EffectCraft | 0.8.0 | `ecproj` | `ecproj` |

LightCraft develops photos and exports them as new files; it never saves a photo back, and its
edits are gone when the editor closes. FilmCraft and EffectCraft open their project files; a
project refers to its media, which are not in the file. SoundCraft is not supported: its web
build can neither open nor save files. Each app's page in [docs/apps/](docs/apps/) says what
saves where.

Files are matched by extension, in any letter case. The tested version is the Craft release the
tests pass with; a daily canary run tests each newer release. The Nextcloud app's texts are in
English and German. Details: [docs/nextcloud-app.md](docs/nextcloud-app.md).

Files shows the files a Craft app opens with that app's icon where Nextcloud has only a general
one (a `.psd` with PhotoCraft's, a `.dxf` with CADCraft's), for the users the app is enabled for
([docs/nextcloud-app.md](docs/nextcloud-app.md#file-type-icons)).

An administrator can also choose the language each Craft app starts in: the user's Nextcloud
language, or a fixed one the app has. Eight of the apps can be started that way; DesignCraft,
WordCraft and DeckCraft start in English
([docs/nextcloud-app.md](docs/nextcloud-app.md#configuring)).

## Requirements

- **Nextcloud 34** (PHP 8.2 to 8.5) or **Nextcloud 35** (PHP 8.3 to 8.5), and access to the
  server's apps folder and `occ`.
- **A web server for the Craft apps**: a static web server with HTTPS on another host name than
  Nextcloud, such as `craft.example.com` next to `cloud.example.com`. It serves the apps'
  upstream web builds with the translator added. If a sign-in sits in front of the apps, put
  both host names under the same registrable domain (here `example.com`), so that the sign-in's
  cookie reaches the app in the frame
  ([docs/hosting.md](docs/hosting.md#a-sign-in-in-front-of-the-apps)).
- **A current browser with WebGL2.** The apps run entirely in the browser. Their tests run in
  Chromium and WebKit; Firefox runs only the translator's tests, against a stub app.

## Setup

The app is not in the Nextcloud App Store. Each
[release](https://github.com/hozwei/nextcloud-craftsuite-layer/releases) has three assets:

| Asset | What it is |
|---|---|
| `craftsuite_layer-<version>.tar.gz` | The Nextcloud app, a single folder `craftsuite_layer/` |
| `craftsuite-layer-hosting-<version>.tar.gz` | For the Craft hosting: `hosting/inject-translator.sh` with the translators it adds, the nginx template and the Compose example |
| `SHA256SUMS` | The checksums of both |

```sh
v=0.4.0
base=https://github.com/hozwei/nextcloud-craftsuite-layer/releases/download/v$v
curl -fL --remote-name-all "$base/craftsuite_layer-$v.tar.gz" \
  "$base/craftsuite-layer-hosting-$v.tar.gz" "$base/SHA256SUMS"
sha256sum -c SHA256SUMS
```

### 1. Host the Craft apps with the translator

For each Craft app, here PdfCraft 0.6.0: download and check its web build, then add the
translator, with the origin of your Nextcloud as the one allowed to frame the app.

```sh
tar -xzf craftsuite-layer-hosting-$v.tar.gz
r=https://github.com/storytold/pdfcraft/releases/download/v0.6.0
curl -fL --remote-name-all "$r/pdfcraft-web-0.6.0.zip" "$r/SHA256SUMS.txt"
sha256sum -c --ignore-missing SHA256SUMS.txt
unzip -q pdfcraft-web-0.6.0.zip
sh craftsuite-layer-hosting-$v/hosting/inject-translator.sh \
  --allowed-origins https://cloud.example.com pdfcraft-web-0.6.0
find pdfcraft-web-0.6.0 -type f \( -name '*.wasm' -o -name '*.js' -o -name '*.html' -o -name '*.otf' \) -exec gzip -9 -k -f {} \;
```

Serve the folder at `https://craft.example.com/pdfcraft/`, with `frame-ancestors` for the same
Nextcloud origin and without `X-Frame-Options`. The bundle's Compose example does this with
nginx, one folder per app; a reverse proxy in front adds HTTPS (commands in
[hosting/README.md](hosting/README.md#compose)). The requirements and
a checklist are in [docs/hosting.md](docs/hosting.md). This repository has no updater for new
Craft releases yet; [docs/hosting.md](docs/hosting.md#updates) says what one must do.

### 2. Install the Nextcloud app

Unpack the app into one of the server's apps folders (those listed in `apps_paths` in
`config/config.php`, such as `custom_apps/` in the official Docker image; without that setting,
`apps/`), as the web server's user, and enable it (`occ` is `php occ` in the Nextcloud folder,
run as the web server's user):

```sh
tar -xzf craftsuite_layer-$v.tar.gz -C /path/to/nextcloud/custom_apps
occ app:enable craftsuite_layer
```

### 3. Set the addresses

Under **Administration settings > Craft apps**, enter the address of each Craft app you host,
such as `https://craft.example.com/pdfcraft/`. The page checks each address against the rules
for addresses; it does not test whether the app answers there. Or use `occ`, with
the keys `<app>_url` (`pdfcraft_url`, `photocraft_url`, ... `effectcraft_url`):

```sh
occ config:app:set craftsuite_layer pdfcraft_url --value=https://craft.example.com/pdfcraft/
```

An app without a usable address has no entry in Files. The rules for addresses are in
[docs/nextcloud-app.md](docs/nextcloud-app.md#configuring).

### Upgrading to Nextcloud 35

Install a release of the app that declares Nextcloud 35 (0.1.0 and later do) **before** you upgrade the
server: the server's updater disables every app whose range ends below the new version. Nextcloud
35 needs PHP 8.3 or newer
([docs/nextcloud-app.md](docs/nextcloud-app.md#upgrading-to-nextcloud-35)).

## How it works

```text
 Nextcloud server                          Craft hosting, own origin
 (files, versions, permissions)            (static files: the app's release,
        ^                                   translator added in index.html)
        | WebDAV, as the logged-in user                  |
        v                                                v
+-------------------------------------------------------------------+
| Browser                                                           |
|  Nextcloud editor page      https://cloud.example.com             |
|      | open (bytes)                  ^ save (bytes, kind)         |
|      v            postMessage        |                            |
|  +-------------------------------------------------------------+  |
|  | iframe                  https://craft.example.com/pdfcraft/ |  |
|  |   unmodified Craft app + translator (core.js, pdfcraft.js)  |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

- The Craft apps run on an origin of their own, from their unchanged upstream releases. The
  hosting adds a small **translator** script to each app's `index.html`.
- The **Nextcloud app** (`craftsuite_layer`) adds the Files entries, the editor page and the
  settings page. The editor page reads the file through WebDAV as the logged-in user and hands
  only its bytes to the framed app. The file never passes through the Craft hosting's server.
- The translator hands the file to the app as if it had been dropped, and turns the app's
  downloads into save messages: `document` (a save of the opened file) or `export` (always a
  new file).
- The editor page writes a `document` save with `If-Match`, so it replaces only the version it
  read or last wrote, and every new file with `If-None-Match: *`, so a new file overwrites
  nothing.
- If Nextcloud does not confirm a save, the translator falls back to the browser download.

Details: [architecture](docs/architecture.md), [protocol](docs/protocol.md),
[security](docs/security.md).

## Limitations

- **No autosave and no unsaved-changes signal.** Nothing is stored until the user saves in the
  app. The apps do not tell the page whether there are unsaved changes, so the editor asks before
  leaving, even when everything is saved.
- **No shared editing.** Two people editing the same file each save against the version they
  opened; the second save becomes a conflict copy.
- **One file per editor page.** A file the user opens inside the app from their own disk is
  saved as a new file next to the opened one.
- **Saves in an app's own format become a new file.** A PNG saved in PhotoCraft becomes
  `<name>.psd`, an SVG in VectorCraft `<name>.vectorcraft`, an IDML in DesignCraft
  `<name>.designcraft`, an ODT, RTF or DOC in WordCraft `<name>.docx`, a CSV or XLSM in
  GridCraft `<name>.xlsx` (an ODS `<name> (imported).xlsx`), a PowerPoint file in DeckCraft
  `<name>.deckcraft`. The original stays
  as it was.
- **Files of other programs become copies.** WordCraft, GridCraft and CADCraft drop what they do
  not model (content controls and custom XML in Word files, custom parts in Excel files, unknown
  objects in DXF), so the first save of a `.docx` from Word, an `.xlsx` from Excel or a DXF from
  AutoCAD becomes a new file next to it (`<name> (2).docx`), and later saves in the same editor
  replace that copy. DeckCraft and EffectCraft do the same for a file from a newer version of
  themselves (DeckCraft also for a PowerPoint file named `.deckcraft`). The original stays as it
  was.
- **LightCraft only exports.** A developed photo comes back as a new file; the edits themselves
  are gone when the editor closes, because LightCraft keeps nothing in the browser there.
- **Projects without their media.** FilmCraft and EffectCraft open their project files, but a
  project refers to its video, audio and pictures, which are not in the file and missing when it
  is opened from Nextcloud.
- **PhotoCraft's copies replace the opened file.** Image > Duplicate, Split Channels and Crop and
  Straighten Photos save under the opened document's name, and a PSD carries nothing that tells
  them apart. Nextcloud keeps the previous content as a version.
- **Files named like a new document always save as new files**: `Untitled-1.psd` and the like in
  PhotoCraft, `Untitled-<n>` drawings and packages made in the browser in VectorCraft and
  DesignCraft, `Document1.docx` without a creation time in WordCraft, `Book<n>.xlsx` and the
  sample titles in GridCraft, `Presentation<n>` and `Northern Lights` in DeckCraft,
  `Drawing<n>.dxf` and `Bracket.dxf` in CADCraft, `Untitled.fcproj` and `FilmCraft Demo.fcproj`
  in FilmCraft, `Untitled Project.ecproj` in EffectCraft. Rename such a file in Nextcloud before
  opening it.
- **A WordCraft mail merge with a recipient list typed into the app** may replace the opened
  document with the merged letters when they are saved (see
  [WordCraft's known gaps](docs/apps/wordcraft.md#known-gaps)).
- **A PDF after Sanitize, a redaction or a password change** is saved to a new file. The opened
  file keeps the removed content until the user deletes or replaces it.
- **Only in Files in the browser.** Public share pages and Nextcloud's mobile and desktop clients
  have no entries, and Files' **New** menu has no entry for a new Craft document.
- **The WebKit tests of the apps do not block CI yet.** They have passed only outside GitHub's
  runners so far, so CI runs them without letting them fail a run.

More: [the Nextcloud app's limitations](docs/nextcloud-app.md#limitations) and the known gaps on
each app's page in [docs/apps/](docs/apps/).

## Documentation

| Page | What it covers |
|---|---|
| [docs/README.md](docs/README.md) | Index of the documentation |
| [docs/nextcloud-app.md](docs/nextcloud-app.md) | The Nextcloud app: installing, configuring, the Files entries, the editor page, what it stores, limitations |
| [docs/hosting.md](docs/hosting.md) | Requirements for the Craft hosting: layout, the translator tags, headers, updates, a sign-in in front of the apps, checklist |
| [hosting/README.md](hosting/README.md) | `inject-translator.sh` (options, exit codes, use in a release updater), the nginx template, the Compose example |
| [docs/architecture.md](docs/architecture.md) | Components, opening and saving a file, the Files integration, design decisions, upstream coupling |
| [docs/protocol.md](docs/protocol.md) | The `postMessage` protocol between the host page and the translator |
| [docs/security.md](docs/security.md) | Trust model, and what the translator, the Nextcloud app and the hosting each enforce |
| [translators/README.md](translators/README.md) | Loading and configuring the translator, writing an adapter |
| [docs/apps/](docs/apps/) | One page per Craft app ([PdfCraft](docs/apps/pdfcraft.md), [PhotoCraft](docs/apps/photocraft.md), [VectorCraft](docs/apps/vectorcraft.md), [DesignCraft](docs/apps/designcraft.md), [WordCraft](docs/apps/wordcraft.md), [GridCraft](docs/apps/gridcraft.md), [DeckCraft](docs/apps/deckcraft.md), [CADCraft](docs/apps/cadcraft.md), [LightCraft](docs/apps/lightcraft.md), [FilmCraft](docs/apps/filmcraft.md), [EffectCraft](docs/apps/effectcraft.md)): what its web build does, how its saves are classified, file types, known gaps, tests |
| [docs/development.md](docs/development.md) | Setup, commands, tests (also in a real Nextcloud), testing a new Craft release, CI and the canary, releasing, adding a Craft app, conventions |
| [CHANGELOG.md](CHANGELOG.md), [craftsuite_layer/CHANGELOG.md](craftsuite_layer/CHANGELOG.md) | Changes to the repository, and to the Nextcloud app |

## Repository layout

| Folder | Content |
|---|---|
| [`translators/`](translators/README.md) | Translator core and one adapter per Craft app |
| [`craftsuite_layer/`](craftsuite_layer/) | The Nextcloud app (app id `craftsuite_layer`) |
| [`hosting/`](hosting/README.md) | Hosting building blocks: translator injector, nginx template, Compose example |
| [`docs/`](docs/README.md) | The documentation |
| `tests/e2e/` | Playwright tests, test server, test host page, stub app, fixtures |
| `.github/workflows/` | CI, the daily canary run and the release |

## Development quick start

Requires Node.js 24 or newer.

```sh
npm ci
npx playwright install chromium firefox webkit   # on Linux: --with-deps (needs root)
npm run craft:fetch                               # the Craft web builds the tests run against
npm test                                          # lint, typecheck, translations, end-to-end tests
```

More in [docs/development.md](docs/development.md): test setup, tests in a real Nextcloud,
writing tests, testing a new Craft release, releasing, adding a Craft app, conventions.

## Upstream

The layer exists because the Craft web builds have no embedding API yet. Requests upstream, as
of 2026-10-10:

- PdfCraft: [storytold/pdfcraft#422](https://github.com/storytold/pdfcraft/issues/422), open, no
  response yet.
- PhotoCraft: [storytold/photocraft#1614](https://github.com/storytold/photocraft/issues/1614)
  and [pull request #2263](https://github.com/storytold/photocraft/pull/2263), not merged.

When an app gains a native API, the translator is planned to stand down for it (see
[docs/architecture.md](docs/architecture.md#native-embedding-apis)).

## Security

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md). How the layer is meant to be
secure is described in [docs/security.md](docs/security.md).

## License

[GNU Affero General Public License v3.0 or later](LICENSE) (`AGPL-3.0-or-later`). The files
state this in an SPDX header; those that cannot hold one are listed in [`REUSE.toml`](REUSE.toml).
A few test fixtures are upstream content under upstream's license, MIT or Apache-2.0: GridCraft's
sales sample and FilmCraft's demo project with the files derived from it (see `REUSE.toml`).

## Affiliation and trademarks

This project is not affiliated with, endorsed by or sponsored by storytold or Nextcloud GmbH.
PdfCraft, PhotoCraft, VectorCraft, DesignCraft, WordCraft, GridCraft, DeckCraft, CADCraft,
LightCraft, FilmCraft, EffectCraft, SoundCraft, ArtCraft and Nextcloud are names or trademarks of
their respective owners and are used here only to say what this project works with.

The Craft apps are not part of this repository. They are developed by storytold in their own
repositories, such as [github.com/storytold/pdfcraft](https://github.com/storytold/pdfcraft),
under their own licenses. The Nextcloud app shows the Craft apps' own icons for their file types
(`craftsuite_layer/img/types/`, from those repositories, MIT OR Apache-2.0, used under MIT with
the notices in `craftsuite_layer/img/types/LICENSE-MIT.txt`). Whoever hosts the apps downloads their published web builds, and so do the tests
when they run.
