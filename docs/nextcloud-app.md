<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# The Nextcloud app

`craftsuite_layer/` is a Nextcloud app for Nextcloud 34 and 35. It adds entries such as "Open in
PdfCraft" to Files for each Craft app an administrator has set up; an editor page that frames the
Craft app, hands it the file and stores what the app saves; and a settings page for the Craft app
addresses. Its texts are in English and German (`de` informal, `de_DE` formal).

It needs the Craft apps hosted with the translator ([hosting.md](hosting.md)).

| Nextcloud | PHP | End-to-end tests in CI with |
|---|---|---|
| 34 | 8.2 to 8.5 | `nextcloud:34.0.4-apache` |
| 35 | 8.3 to 8.5 (Nextcloud 35 needs 8.3 or newer) | `nextcloud:35.0.1-apache` |

The end-to-end tests run on the images' PHP 8.5; PHP 8.2 to 8.4 are checked with `php -l` only
(see [development.md](development.md#testing-in-nextcloud)).

## Installing

The app is not in the Nextcloud App Store. Each
[release](https://github.com/hozwei/nextcloud-craftsuite-layer/releases) has it as
`craftsuite_layer-<version>.tar.gz`, with the checksums in `SHA256SUMS`. Both are plain
downloads from
`https://github.com/hozwei/nextcloud-craftsuite-layer/releases/download/v<version>/<asset>`.
For version 0.3.0:

```sh
v=0.3.0
base=https://github.com/hozwei/nextcloud-craftsuite-layer/releases/download/v$v
curl -fL --remote-name-all "$base/craftsuite_layer-$v.tar.gz" "$base/SHA256SUMS"
sha256sum -c --ignore-missing SHA256SUMS      # craftsuite_layer-0.3.0.tar.gz: OK
```

`--ignore-missing` skips the line of the hosting bundle, which `SHA256SUMS` lists too. The
archive holds one folder, `craftsuite_layer/`, as the App Store expects. Unpack it into one
of the server's apps folders (those listed in `apps_paths` in `config/config.php`, such as
`custom_apps/` in the official Docker image; without that setting, `apps/`), as the web server's
user, and enable the app (`occ` is `php occ` in the Nextcloud folder, run as the web server's
user):

```sh
tar -xzf craftsuite_layer-$v.tar.gz -C /path/to/nextcloud/custom_apps
occ app:enable craftsuite_layer
```

To update the app, remove the folder `custom_apps/craftsuite_layer/`, unpack the new archive in
its place and run `occ upgrade`. The addresses stay.

**Building it yourself.** From a checkout of the repository, as the release workflow does:

```sh
npm ci
make -C craftsuite_layer appstore     # craftsuite_layer/build/artifacts/craftsuite_layer.tar.gz
```

## Configuring

Each Craft app needs the address it is hosted at. An app without an address has no entry in
Files. Only administrators set the addresses, on the settings page or with `occ`. They can also
set the language each Craft app starts in.

**Settings page.** Administration settings > Craft apps has one field per Craft app, with the
file types it opens, and next to it the language the app starts in. Saving checks every field and
saves nothing if one cannot be used; an empty address removes it. Saving needs a recent password
confirmation. A stored address or language that can no longer be used (for example after
Nextcloud got a new trusted domain) is shown with the reason.

**Only for some groups.** To offer the Craft apps to some users only (for example those the Craft
hosting lets sign in), enable the app for their groups: `occ app:enable -g <group> [-g <group>]
craftsuite_layer`, or the group setting of the app in Nextcloud's app management. Users outside
these groups get no entries in Files (from 0.3.0 on; Nextcloud runs the app's code for every user
and the app checks the group itself) and no editor page.

**occ.** The keys are `<app>_url`:

```sh
occ config:app:set craftsuite_layer pdfcraft_url --value=https://craft.example.com/pdfcraft/
occ config:app:set craftsuite_layer photocraft_url --value=https://craft.example.com/photocraft/
occ config:app:set craftsuite_layer vectorcraft_url --value=https://craft.example.com/vectorcraft/
occ config:app:set craftsuite_layer designcraft_url --value=https://craft.example.com/designcraft/
occ config:app:delete craftsuite_layer designcraft_url      # no DesignCraft entries again
```

`occ` does not check the address. An address that cannot be used leaves its app without an entry
in Files, and the editor page says why. The app declares one key per app in Nextcloud's config
lexicon: a key it does not know, such as a typo, is not stored, and Nextcloud logs a warning.

**The language an app starts in.** The keys are `<app>_language`, for the apps that can be
started in a chosen language. The value is empty (the default: the app decides, as it does
without Nextcloud), `user` (the language Nextcloud shows the user its own pages in) or one of the
app's languages as a BCP 47 tag:

| App | Languages (tested version) |
|---|---|
| PdfCraft | `en` `ar` `bg` `cs` `de` `es` `fr` `hu` `it` `ja` `pl` `pt-BR` `ru` `uk` |
| PhotoCraft | `en` `cs` `de` `el` `es` `fr` `id` `it` `nl` `pl` `pt-BR` `ru` `uk` |
| VectorCraft | `en` `cs` `de` `es` `fr` `it` `ja` `pt-BR` `ru` `uk` |
| GridCraft | `en` `es` `pt-BR` `ru` |
| CADCraft | `en` `uk` |
| LightCraft | `en` `de` `es` `fr` `ja` `pt-BR` `ru` `uk` `zh-Hans` `zh-Hant` |
| FilmCraft | `en` `de` `es` `fr` `ja` `pt-BR` `ru` `uk` |
| EffectCraft | `en` `es` `pt-BR` `uk` |

```sh
occ config:app:set craftsuite_layer pdfcraft_language --value=user
occ config:app:set craftsuite_layer photocraft_language --value=de
occ config:app:delete craftsuite_layer photocraft_language   # PhotoCraft decides again
```

DesignCraft, WordCraft and DeckCraft have no such key: their tested versions read no language when
they start and always start in English. With `user`, an app that does not have the user's
language, or anything close (`de-AT` finds `de`, `pt-PT` finds `pt-BR`), starts as it would
without the setting. Several apps translate only part of their interface into some of these
languages, and where an app keeps a language the user picked in it (PdfCraft, PhotoCraft,
CADCraft), that choice stays; the app pages in [apps/](apps/) have the details. The editor page
hands the language to the translator in the frame's address ([protocol.md](protocol.md#host-settings)),
so it needs translator 0.3.0 or later in the hosting; an older one ignores it.

**Rules for the address.** It must use `https` (plain `http` only on `localhost`, `127.x.x.x` or
`[::1]`, for development) and have no user name, password, `?query` or `#fragment`. Several Craft
apps read their query as switches: PdfCraft's `?host=parent` would make it drop every save under
a Nextcloud on another origin, and others restore old sessions or keep files in the browser. The
adapters set the switches their app needs themselves. Its host must be a
name of letters, digits, hyphens and dots, a dotted IPv4 address, or an IPv6 address in brackets:
the page's Content-Security-Policy names it, and has to name it as the browser does. A name with
other letters (`bücher.example`) is converted to its `xn--` form when PHP's `intl` extension
is installed; without it the address is refused with a hint to type the `xn--` form. The host
must differ from every host name Nextcloud answers on (its own address, the host of the request
and the entries of `trusted_domains`), whatever the port: on Nextcloud's origin the app's code
would share the user's session, and cookies do not separate ports. `trusted_domains` entries are
compared as written: a wildcard entry such as `*.example.com` is not expanded, because it would
also cover a Craft host of its own such as `craft.example.com`. A Craft host that Nextcloud
really serves is caught by the request's host as soon as someone uses Nextcloud under it. The
editor page checks the address again on every open.

The hosting must in turn allow the Nextcloud origin: in the translator's `data-allowed-origins`
and in its `frame-ancestors` header ([hosting.md](hosting.md)).

## Upgrading to Nextcloud 35

1. Update the app to a release that declares Nextcloud 35 (`max-version="35"` in
   `appinfo/info.xml`, as 0.1.0 and later do; see [Installing](#installing)) **before** upgrading the
   server. The server's updater
   disables every app whose range ends below the new version ("incompatible app"). Installed
   before the upgrade, the app stays enabled and keeps its addresses; this was rehearsed from
   34.0.4 to 35.0.1.
2. Nextcloud 35 needs PHP 8.3 or newer.

If the updater has disabled the app, install a release that declares the new version and enable
it again with `occ app:enable craftsuite_layer`. Nextcloud keeps an app's settings while it is
disabled.

The Files entries rely on the action registry of `@nextcloud/files` 4.x, which Nextcloud 34 and
35 ship. The daily canary checks the server's development branch and opens an issue when the next
release asks for another major ([development.md](development.md#continuous-integration)).

## Files

For each Craft app with a usable address, Files offers "Open in PdfCraft" (and likewise for the
other apps) in the action menu of a file the app opens. For some types it is also what a click
on the file does.

| App | Entry in the action menu for | Also on a click on the file |
|---|---|---|
| PdfCraft | `pdf` | none |
| PhotoCraft | `psd`, `psb`, `pcraft`, `tga`, `png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp`, `tif`, `tiff`, `ico`, `heic`, `heif` | `psd`, `psb`, `pcraft`, `tga` |
| VectorCraft | `vectorcraft`, `drawcraft`, `ai`, `eps`, `svgz`, `dxf`, `svg`, `emf`, `wmf`, `pdf` | `vectorcraft`, `drawcraft`, `eps`, `svgz`, `dxf` |
| DesignCraft | `designcraft`, `idml` | `designcraft`, `idml` |
| WordCraft | `docx`, `docm`, `dotx`, `dotm`, `doc`, `dot`, `odt`, `rtf` | none |
| GridCraft | `xlsx`, `xlsm`, `ods`, `csv` | none |
| DeckCraft | `deckcraft`, `pptx`, `potx`, `ppsx` | `deckcraft` |
| CADCraft | `dxf` | `dxf` |
| LightCraft | `dng`, `cr2`, `cr3`, `nef`, `nrw`, `arw`, `raf`, `orf`, `rw2`, `rwl`, `pef`, `srw`, `jpg`, `jpeg`, `png`, `tif`, `tiff`, `webp` | `dng`, `cr2`, `cr3`, `nef`, `nrw`, `arw`, `raf`, `orf`, `rw2`, `rwl`, `pef`, `srw` |
| FilmCraft | `fcproj` | `fcproj` |
| EffectCraft | `ecproj` | `ecproj` |

SoundCraft has no entry: its web build can neither open nor save files.

- **By extension, in any letter case.** Nextcloud stores `application/octet-stream` for
  extensions it does not know, such as `.designcraft`, `.vectorcraft` and `.idml`. The app adds
  types for them (see [File type icons](#file-type-icons)), but where it cannot, and for files not
  scanned since, the type says nothing; the extension always does.
- **A click only where no common Nextcloud app opens the type.** A PDF stays with the PDF
  viewer, a PNG or SVG with the Viewer; their entries are in the action menu. The PDF viewer also
  opens `.ai` (Illustrator files are PDF-compatible), so `.ai` is in the menu only. Office files
  stay with Nextcloud Office or ONLYOFFICE where they are installed (and `.csv` with Text), so
  WordCraft and GridCraft are in the menu only. A file can show several entries, such as "Open in
  PdfCraft" and "Open in VectorCraft" for a PDF, or PhotoCraft and LightCraft for a JPEG.
- **One app per click.** Where two apps have the same type as their click type (CADCraft and
  VectorCraft for `.dxf`), the click goes to CADCraft when both have an address, and to the one
  with an address otherwise; the other keeps its menu entry.
- **What each list contains** follows from what the app opens from a drop and saves back well;
  the reasons per type, and the types left out on purpose, are on the app pages:
  [PdfCraft](apps/pdfcraft.md), [PhotoCraft](apps/photocraft.md#file-types),
  [VectorCraft](apps/vectorcraft.md#file-types), [DesignCraft](apps/designcraft.md#file-types),
  [WordCraft](apps/wordcraft.md), [GridCraft](apps/gridcraft.md), [DeckCraft](apps/deckcraft.md),
  [CADCraft](apps/cadcraft.md), [LightCraft](apps/lightcraft.md), [FilmCraft](apps/filmcraft.md),
  [EffectCraft](apps/effectcraft.md). The lists live in `lib/Service/CraftApps.php`.
- **Not offered** for several selected files, for folders, in the trash (a deleted file has no
  folder to save to), and for files shared without permission to download or with downloads
  hidden: handing a file to a Craft app, which can save and export it, is a download. Public
  share pages have no entries.

An entry opens the editor page,
`/index.php/apps/craftsuite_layer/edit/<fileId>?app=<app>`. Without `?app=`, the page takes the
app that opens the type on a click, else the first app that opens it, both among the apps with an
address. The entry uses the file's
`id` from Files, as a string of digits (Nextcloud is moving to 64-bit ids). When the user clicked
(or pressed a key) to open the file, the entry adds the session's request token
(`&requesttoken=…`), which lets the editor open at once (see below); Files also runs the entry
by itself, for a link to the file, and then it adds none.

### File type icons

Files shows a file whose type a Craft app opens, and for which Nextcloud has only a general icon
(the plain file or the image icon), with that app's icon, as desktops show the program a file
belongs to:

| Icon | File types |
|---|---|
| PhotoCraft | `psd`, `psb`, `pcraft`, `tga` |
| VectorCraft | `vectorcraft`, `drawcraft`, `ai`, `eps`, `svgz`, `emf`, `wmf`; `dxf` when CADCraft has no address |
| DesignCraft | `designcraft`, `idml` |
| DeckCraft | `deckcraft` |
| CADCraft | `dxf` |
| LightCraft | the camera raws (`dng`, `cr2`, `cr3`, `nef`, `nrw`, `arw`, `raf`, `orf`, `rw2`, `rwl`, `pef`, `srw`) |
| FilmCraft | `fcproj` |
| EffectCraft | `ecproj` |

Office files, PDFs and common images keep Nextcloud's icons, and a file with a preview (a photo,
or a PSD where the administrator enabled Nextcloud's Photoshop previews) shows the preview.

- **Only for users the app is enabled for**, and only for Craft apps with an address. Everyone
  else sees Nextcloud's icons. On a public share page the icons show only if the app is enabled
  for everyone.
- **Where.** In the file list and the grid of Files (also Recent, Favorites, shares, search
  within Files), in the file pickers, for versions, on public share pages and in the Dashboard's
  Favorite files widget. Unified search, Activity, Recommended files (on the Dashboard and in
  Files) and Talk show Nextcloud's icons: they take theirs elsewhere.
- **By type, not by extension.** Nextcloud picks an icon by a file's MIME type. Camera raws share
  one type, `image/x-dcraw`, so the LightCraft icon also shows on the raw formats LightCraft is
  not offered for (`dcr`, `erf`, `iiq`, `k25`, `kdc`, `mef`, `sr2`, `srf`, `xrf`), and `.ai`,
  which the PDF viewer opens on a click, shows the VectorCraft icon of its menu entry.
- **New file types.** Nextcloud 34 and 35 store `application/octet-stream` for most of these
  extensions, so they could not get an icon of their own. The app therefore adds MIME types for
  them to Nextcloud's `config/mimetypemapping.json`, as Nextcloud's Maps app does for its types:

  | Extension | Type |
  |---|---|
  | `psb` | `application/x-photoshop` (as `psd`) |
  | `pcraft` | `application/x-photocraft` |
  | `vectorcraft`, `drawcraft` | `application/x-vectorcraft` |
  | `eps` | `image/x-eps` (Nextcloud's `application/postscript` is shared with `.ps`) |
  | `svgz` | `image/svg+xml-compressed` (downloads as `application/octet-stream`) |
  | `wmf` | `image/wmf` |
  | `dxf` | `image/vnd.dxf` |
  | `designcraft` | `application/vnd.designcraft+zip` |
  | `idml` | `application/vnd.adobe.indesign-idml-package` |
  | `deckcraft` | `application/x-deckcraft` |
  | `cr3`, `nrw`, `rwl`, `srw` | `image/x-dcraw` (as the other raws) |
  | `fcproj` | `application/x-filmcraft` |
  | `ecproj` | `application/x-effectcraft` |
  | `dotm` | `application/vnd.ms-word.template.macroEnabled.12` (WordCraft; Nextcloud shows its document icon, like for `.docm`) |

  For the new `application/*` types it adds Nextcloud's plain file icon as their alias to
  `config/mimetypealiases.json`, so that users without the Craft icons see these files as before.
  Both files apply to all users and survive server updates. So for everyone: `.dxf`, `.svgz`,
  `.wmf`, `.psb` and the raws above change from Nextcloud's plain file icon to its image icon and
  count as images in Files' type filter, `.dotm` gets the document icon, these files are served
  with their new type, and `.eps` files lose the previews of Nextcloud's Postscript preview
  provider where an administrator enabled it (it previews `application/postscript` only). The app adds only entries that
  Nextcloud and the administrator do not define (except `eps`), notes them in its own
  configuration (`file_types`), and gives existing files the new types in one pass over the file
  cache. Nextcloud does this on every enable and app update (the app's repair steps).
- **Taking them back.** Disabling the app (also `occ app:remove`, and Nextcloud's own disabling of
  an incompatible app during a server update) removes its entries that are still unchanged and
  gives those files their earlier types back; Files shows Nextcloud's icons again at once.
  Deleting the app's folder by hand, or `occ app:remove --keep-data`, removes nothing: the entries
  stay, which does no harm (Nextcloud then shows its plain file or image icon for these types).
- **No changes to Nextcloud's own files.** The icons stay in the app's folder (`img/types/`); the
  app does not copy files into `core/` (which every server update replaces) and does not run
  `occ maintenance:mimetype:update-js`, so Nextcloud's integrity check stays clean. Pages that
  pick icons in the browser get the new aliases from a small script of the app.
- **How.** Nextcloud has no API for icons of apps. The app puts its own icon provider in place
  of Nextcloud's (`OCP\Preview\IMimeIconProvider`), through a method of Nextcloud's server
  container that is deprecated since Nextcloud 20 and internal in Nextcloud 36. Should a version
  drop it, Files shows Nextcloud's icons again; nothing else changes.
- **AIO.** Nextcloud All-in-One's update removes the files in `config/` other than `config.php`
  (as its update script reads) and disables and enables the apps around the update, so the app
  adds its entries again then and retypes the files.
- **A read-only `config/`.** Where it cannot be written, the types are not added: Files keeps
  Nextcloud's icons for the extensions above it does not know, and the app logs a warning.

The icons are the Craft apps' own (MIT OR Apache-2.0; the app ships them under MIT, with the
notices in `img/types/LICENSE-MIT.txt`), shown unchanged except for the crop their own packaging
uses for small sizes.

## The editor page

The page shows the file name, a status line and a Close button above the app. The app gets the
file under its name with the extension in lower case (`Photo.PSD` as `Photo.psd`): every Craft app
recognises that, and PhotoCraft writes its saves with a lower-case extension. Saves under that
name still go to `Photo.PSD`.

**Opened by a link.** A page that handed the file to the Craft app as soon as it loads could be
opened by any site with the user's session: with a link, a window or a redirect, or through
Nextcloud itself. A link to `/index.php/f/<fileId>` (or to Files with `?openfile=true`) makes Files open the
file by itself, and an expired session sends the user to the sign-in page, which then goes on to
the page. So the editor opens at once only:

- from Files' entry or a click on the file, which carry the session's request token (only with
  the user's click or key press: Files' own opening of a link carries none), or
- for an address the user typed, bookmarked or opened from outside the browser (the browser sends
  `Sec-Fetch-Site: none`).

Every other open, browsers that send no `Sec-Fetch-Site` included, only asks: "Open <file> in
<app>?", with the buttons "Open in <app>" and "Close". Nothing is read or framed before the click
on "Open in <app>", whose address carries the token. The editor removes the token from the
address bar at once, so a reload of the editor page asks again; the page and its frame send no
referrer, so the token never reaches the Craft origin. Browsers without
`navigator.userActivation` (Firefox before 120) get the question after a click in Files too.

### What it stores

| What the app saves | What the page stores |
|---|---|
| The opened document under the name the app got (PdfCraft's Save, PhotoCraft's Save of a `.psd`, VectorCraft's and DesignCraft's Save of their own files) | Replaces the opened file. The write is conditional (`If-Match` with the version the page read or last wrote), and Nextcloud keeps the previous content as a version. |
| The opened document under another name or file type: PhotoCraft saves a PNG as `<stem>.psd`, VectorCraft an SVG (or a `.drawcraft`) as `<stem>.vectorcraft`, DesignCraft an IDML as `<stem>.designcraft`, WordCraft an ODT as `<stem>.docx`, GridCraft a CSV as `<stem>.xlsx`, DeckCraft a PPTX as `<stem>.deckcraft` | The first save becomes a new file next to the original, which stays as it is. Later saves under that name replace the new file, conditionally. |
| The opened document, but the app cannot save it without losses: WordCraft's Save of a Word file another program wrote, GridCraft's of such an Excel file, CADCraft's of such a DXF, DeckCraft's of a file from a newer DeckCraft (or of a PowerPoint file named `.deckcraft`), EffectCraft's of a project from a newer EffectCraft (a copy, [protocol.md](protocol.md#copies)) | The first save becomes a new file next to the original, which stays as it is, and the name above the app shows that file. Later saves of the same editor session replace it, conditionally. |
| The document, but the file was changed elsewhere since the page read or last wrote it | A new file `<name> (conflict <date> <time>).<ext>` next to it, such as `report (conflict 2026-10-10 14-05).pdf`; the other change stays in the original. Later saves go to the new file. |
| The document, but the file's version cannot be checked (no usable ETag) | The same as a conflict: the page never writes without knowing which version it replaces. |
| The document, but the user may not change the file (for example in a read-only share) | A new file next to it, under the name of the save. Later saves go to the new file. |
| The document again, after the app wrote it anew as a file of its own: PdfCraft's Save after Sanitize, redaction or a change of the password arrives as an export, and every later Save that builds on it continues that export (`follows` in [protocol.md](protocol.md#continued-exports)) | The export became a new file; each continuing save replaces that file, conditionally (on a conflict, or if it may not be changed, a new file takes its place for the saves that continue the export). If the page did not store the export, the first continuing save becomes a new file, which the later ones replace. Saves that build on the opened file's last save still go to the opened file, which keeps its last save. |
| An earlier save of the document that arrives after a later one (the translator sends them in order; the page does not rely on it) | A new file next to it, so that it never replaces the later save. |
| An export, or any other download | Always a new file next to the original. |

**New files.** A new file gets the name of the save. If that is taken, ` (2)`, ` (3)`, ... is
added before the extension. Names are compared with those in the folder in any letter case,
because names that differ only in case clash on Windows and macOS sync clients. Every new file is
written with `If-None-Match: *`, so not even a file the page did not see is overwritten. In new
names the characters Windows forbids (`<`, `>`, `:`, `"`, `|`, `?`, `*`) become `_`; path parts,
control characters and leading or trailing dots and spaces are removed. Direction overrides and
invisible format characters (such as U+202E: `invoice<U+202E>fdp.exe` would show as
`invoiceexe.pdf`) become `_` in every name. A new name is at most 250 bytes (UTF-8), the limit
of Nextcloud: a longer stem is shortened by whole characters, keeping the extension and the
added ` (2)` or ` (conflict …)`.

The name above the app shows the file the newest save of the document went to. After a reload of
the app frame, the app gets that file again, as the last save wrote it: saves of the frame's
previous page that are still being stored finish first, and still count as saves of the document
it had open.

**Failed saves.** A save the page cannot store (no permission to write in the folder, quota, a
lock that does not go away, an expired session, a folder that no longer exists, a name Nextcloud
does not allow, a connection that stalls) is reported to the translator as failed, and the status
line says why. The user then gets the file as the browser download the app would have made
without the layer; the translator says so at once. If it does not within 5 seconds, or the app
frame was reloaded or navigated away while the save was being stored, the page that would have
downloaded it is gone: the page then offers the file itself, in a list below the bar ("Not stored
in Nextcloud: Download <file>", with Discard), which stays until the user discards the entry or
leaves the page, whatever the status line says later.

Reads and writes of the file run one after the other, in the order the saves arrive, which is the
order the app made them: a second save waits for the first and then has its ETag. Every request
is bounded: a read, or a listing of the folder, that gets no answer or no bytes of it for 2
minutes, and an upload that makes no progress for 2 minutes or gets no answer 5 minutes after its
last byte was sent, is given up as "the connection to the server stalled", and the save fails as
above. While uploads and reads make progress, the page repeats `save-received` for every save
that waits for them (at most once a minute, and when an upload has been sent), so that a save that
waits behind others or uploads slowly is not taken for lost and downloaded as well; a request that
stalls stops these repeats. A request that finds the file locked, which happens for a moment while
anything writes it, is repeated up to four times, with pauses from 250 ms to 2 s. Nothing comes
from the browser's cache. The version check uses Nextcloud's `OC-ETag` header, which a
compressing proxy does not change, then `ETag`, then the WebDAV `getetag` property; a weak ETag
never counts.

### Leaving the page

The Craft apps do not tell the page whether there are unsaved changes, so once the app has the
file, the page asks before the user leaves:

- **Close** asks once ("Leave <app>? Changes you have not saved there are lost.") and then goes
  to the file's folder in Files without a second question. If a save is still being stored, or
  the app has just started one (the translator announces it with `save-started` before it reads
  the file), Close first waits for it ("Waiting for the save …"): leaving earlier would remove
  the frame, which holds the save, and stop its upload. If that save fails, the page stays and says why.
  Close again while it waits asks "A save is still being stored. Leave anyway?", or, while the
  app has announced a save that has not arrived yet, "<app> has started a save that has not
  arrived yet. Leave anyway?". An announced save that does not arrive within 6 minutes, or whose
  page in the frame is replaced (a reload, or a navigation to another page), no longer counts:
  the status line says "<app> started saving <file>, but the file did not arrive."
- **Anything else** (the browser's back button, closing the tab, a link elsewhere in Nextcloud)
  gets the browser's own question, also while a save is still being stored or announced.

### When the app does not start

- If the app's page has not answered after 15 seconds, the status line says so and links to the
  app in a new tab. Typically the frame then shows a sign-in page of the Craft hosting: the user
  signs in there and reloads the editor page, which asks "Open <file> in <app>?" once more
  ([hosting.md](hosting.md#a-sign-in-in-front-of-the-apps)).
- If the app is not ready after 90 seconds, the page asks whether it is reachable at its origin.
- Errors the translator reports, such as "the app failed to load" or "the app registered no drop
  target" (no WebGL2, for example), are shown in the status line
  ([protocol.md](protocol.md#errors)).

The page refuses to open a file, with a message, when the file does not exist or cannot be read,
it is shared without permission to download, no Craft app opens its type, or the app's address
is missing or cannot be used. A user who is not logged in gets Nextcloud's sign-in page first.

## How it works

- `lib/Controller/EditorController.php` and `templates/editor.php`: the editor page. It checks
  the file and the address and describes the file, its WebDAV address and its folder in the
  page's initial state; it sends nothing else to the browser. Its Content-Security-Policy allows
  framing only the Craft app's origin. Every answer of the page, error pages included, carries
  `Cross-Origin-Opener-Policy: same-origin`, so a window the app opens has no handle on the
  Nextcloud tab. The frame is sandboxed without top navigation, sends no referrer, and may only
  write to the clipboard (`allow="clipboard-write"`): the apps paste from paste events and never
  read the clipboard. A page opened by a link gets the confirmation instead (see above).
- `src/editor.ts`: the host of the [translator protocol](protocol.md). It reads and writes the
  file through WebDAV as the logged-in user, so permissions, locks, quota and versions are
  Nextcloud's own.
- `lib/Listener/LoadFilesScripts.php` and `src/files.ts`: the entries in Files (see
  [architecture.md](architecture.md#files-integration)).
- `lib/Settings/`, `lib/Controller/SettingsController.php`, `templates/admin.php` and
  `src/admin.ts`: the settings page. `lib/ConfigLexicon.php`: the `<app>_url` keys.
- `lib/Service/CraftApps.php`: the Craft apps, their file types and the rules for their
  addresses.

`make -C craftsuite_layer js` (part of `appstore`) or `npm run build` bundles `src/*.ts` with
esbuild into `js/*.mjs`. The German texts are in `l10n/` (see
[development.md](development.md#commands)).

## Limitations

- **One file per editor page.** The page opens one file, and only saves of that file can replace
  it. A file the user opens inside the app from their own disk is saved as a new file next to
  the opened one, not into it (the exceptions are listed on the app pages below).
- **No unsaved-changes signal.** The page asks before leaving even when everything is saved.
- **"Opened" means handed over.** The status line says the file is open once the app got it;
  whether the app could read it shows only inside the app.
- **Saved means downloaded, for the app.** The apps mark a document saved when the download
  starts. If the page cannot store it, the browser download is the copy the user keeps.
- **No shared editing.** Two people editing the same file each save against the version they
  opened; the second save becomes a conflict copy.
- **One address per Craft app** for the whole Nextcloud; users cannot choose another hosting.
- **Only in Files in the browser.** Public share pages and Nextcloud's mobile and desktop clients
  have no entries, and Files' **New** menu has no entry for a new Craft document.
- **PhotoCraft's copies of the opened document replace it.** Image > Duplicate, Split Channels
  and Crop and Straighten Photos create documents whose Save uses the opened document's name: a
  PSD carries nothing that tells them apart, so such a save replaces the opened file (or the
  `.psd` the page created for an opened image), and both documents then save into it.
  Nextcloud keeps the previous content as a version
  ([PhotoCraft's known gaps](apps/photocraft.md#known-gaps)).
- **The apps' own gaps.** What each Craft app does not do, or does differently in a frame:
  [PdfCraft](apps/pdfcraft.md#known-gaps), [PhotoCraft](apps/photocraft.md#known-gaps),
  [VectorCraft](apps/vectorcraft.md#known-gaps), [DesignCraft](apps/designcraft.md#known-gaps),
  and the pages of WordCraft, GridCraft, DeckCraft, CADCraft, LightCraft, FilmCraft and
  EffectCraft in [apps/](apps/).
