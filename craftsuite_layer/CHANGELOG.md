<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Changelog

All notable changes to the Nextcloud app `craftsuite_layer` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each GitHub release takes its text from the section whose heading matches the version in
`appinfo/info.xml`, as the App Store would. `make lint` fails if that section is missing.

## [Unreleased]

## [0.5.1] - 2026-10-17

### Fixed

- The editor page keeps the link that opens the Craft app in a new tab when it gives up after 90
  seconds ("… did not start. Is it reachable at …?"): a user who looks only then can still sign
  in to the Craft site there.

### Changed

- docs/nextcloud-app.md describes going back to an older version of the app. Released together
  with translators 0.5.1, which are unchanged but for the version.

## [0.5.0] - 2026-10-17

### Added

- SoundCraft (0.6.1 and later): `.scraftz` sessions open in it from the action menu and on a
  click, with SoundCraft's icon (as `application/x-soundcraft-session`, the type SoundCraft
  declares for its session file), and "+ New" makes a "New SoundCraft session" from an empty
  session. It starts in English (it reads no language).
- An address for all apps (settings page "All apps", key `apps_base_url`): each Craft app without
  an address of its own is at `<address><app>/`, so that an app a new version of this app brings
  needs no setting. The line under each app says which address it takes from there.
- A tick per app switches it off (key `<app>_disabled`): no entries in Files, Nextcloud's icons for
  its types, and its editor page says it is switched off, whatever its addresses. Untick an app the
  hosting does not serve, for example a new one until the hosting has it.

### Changed

- The settings page tells an administrator outside the groups the app is enabled for that
  Nextcloud does not let them save it, and the status line shows Nextcloud's own message when it
  refuses a save (HTTP 412, "App is not enabled").

### Upgrading

- With the address for all apps set, SoundCraft gets its entries as soon as Nextcloud runs 0.5.0:
  switch it off until the hosting serves it. Without that address nothing changes: SoundCraft has
  no address, so no entries.

## [0.4.2] - 2026-10-16

### Changed

- No change in the app itself. Released together with translators 0.4.2, which handle the Craft
  releases of 2026-10-14; see the repository's CHANGELOG.md.

## [0.4.1] - 2026-10-14

### Changed

- Start languages follow the new Craft releases: PdfCraft no longer offers Arabic and Japanese
  (the web build of PdfCraft 0.7.1 lacks their fonts and draws boxes), CADCraft offers Czech,
  German, Spanish, French, Brazilian Portuguese and Russian besides English and Ukrainian
  (CADCraft 0.6.2). A stored language that is no longer offered counts as unset (the app
  decides), and the settings page points it out.
- Released together with translators 0.4.1, which handle the Craft releases of 2026-10-13; see the
  repository's CHANGELOG.md.

## [0.4.0] - 2026-10-12

### Added

- The default app: a Craft app whose file types other apps open too (PdfCraft, PhotoCraft,
  VectorCraft, WordCraft, GridCraft, DeckCraft, LightCraft) can be made the default app for all
  its types, with a tick on the settings page ("On a click") or `occ config:app:set
  craftsuite_layer <app>_default_app --value=true`. A click in Files then opens them in the Craft
  app, before the Viewer, Nextcloud Office, ONLYOFFICE and Euro-Office. The app it replaces stays
  in the file's menu; ONLYOFFICE and Euro-Office leave theirs out while they are set to open the
  type, so the app adds it under their name. A type that is a Craft app's own stays with it. The
  settings page says for each app which types a click opens in it.
- Entries in the "+ New" menu of Files, one per Craft app with an address for its own format: New
  PhotoCraft image (`.psd`), New VectorCraft drawing, New DesignCraft document, New DeckCraft
  presentation, New CADCraft drawing (`.dxf`), New FilmCraft project and New EffectCraft project;
  New WordCraft document (`.docx`), New GridCraft spreadsheet (`.xlsx`) and New PdfCraft document
  (`.pdf`) only for a default app. The file gets the app's blank document (`assets/`: what the app
  makes for a new document, checked with its tested version) and opens in the app. WordCraft's,
  GridCraft's and PdfCraft's are on A4 pages, or on Letter where the user's Nextcloud locale is in
  a region that uses Letter (or is Nextcloud's plain English). The user's own templates of the
  type are offered as in other apps.

### Changed

- A Craft app's click entry now comes before the Viewer's View and Rename in a file's action menu
  (order −20 instead of 10).

### Fixed

- Back from the editor page no longer opens the file again when Files had opened it by itself (a
  link to the file, now also a new file): the entry takes `openfile` out of Files' address first.

## [0.3.0] - 2026-10-12

### Added

- The language each Craft app starts in, next to its address on the settings page and as
  `occ config:app:set craftsuite_layer <app>_language`: the app's own choice (the default), the
  user's Nextcloud language, or one of the app's languages. The editor page hands it to the
  translator in the frame's address; it needs the translators of layer 0.3.0 or later in the
  hosting. For PdfCraft, PhotoCraft, VectorCraft, GridCraft, CADCraft, LightCraft, FilmCraft and
  EffectCraft; DesignCraft, WordCraft and DeckCraft always start in English.
- The Craft apps' icons for the file types they open, where Nextcloud has only a general icon:
  PhotoCraft for `.psd`, `.psb`, `.pcraft` and `.tga`, VectorCraft for `.vectorcraft`,
  `.drawcraft`, `.ai`, `.eps`, `.svgz`, `.emf` and `.wmf`, DesignCraft for `.designcraft` and
  `.idml`, DeckCraft for `.deckcraft`, CADCraft for `.dxf` (VectorCraft without CADCraft),
  LightCraft for camera raws, FilmCraft for `.fcproj` and EffectCraft for `.ecproj`. In the file
  list and grid of Files, the file pickers, versions and public shares; only for users the app is
  enabled for and only for Craft apps with an address. The app takes the place of Nextcloud's icon
  provider for these types; it changes no file of Nextcloud's code (`core/`); the MIME types below
  go into `config/`.
- MIME types for the extensions Nextcloud 34 and 35 do not know (and `image/x-eps` for `.eps`, and
  the Office type for `.dotm`), added to `config/mimetypemapping.json` with aliases in
  `config/mimetypealiases.json` when the app is enabled or updated, with existing files retyped;
  removed again, with the files' earlier types, when it is disabled. The app notes its entries in
  the new key `file_types`.

### Fixed

- The Files entries ("Open in …") appeared also for users outside the groups the app is enabled
  for, whose editor page Nextcloud does not serve. They now appear only for users the app is
  enabled for.

## [0.2.0] - 2026-10-12

### Added

- Entries in Files for seven more Craft apps, matched by file extension in any letter case:
  - WordCraft: .docx, .docm, .dotx, .dotm, .doc, .dot, .odt, .rtf
  - GridCraft: .xlsx, .xlsm, .ods, .csv
  - DeckCraft: .deckcraft, .pptx, .potx, .ppsx (a click opens .deckcraft)
  - CADCraft: .dxf (a click opens it)
  - LightCraft: .dng, .cr2, .cr3, .nef, .nrw, .arw, .raf, .orf, .rw2, .rwl, .pef, .srw, .jpg,
    .jpeg, .png, .tif, .tiff, .webp (a click opens the camera raw types)
  - FilmCraft: .fcproj (a click opens it)
  - EffectCraft: .ecproj (a click opens it)

  Office files stay with Nextcloud Office or ONLYOFFICE on a click. The settings page has a field
  for each new app.
- The editor page stores the copies some apps make of a file they cannot save without losses (a
  Word file from another program in WordCraft): the first save becomes a new file next to the
  original, later saves of the same editor session replace it, and the original stays as it is.

### Changed

- A Craft app address with a query (`?…`) is refused, on the settings page and when a file
  opens: several apps read their query as switches.
- One app per click: where two configured apps open the same type on a click (CADCraft and
  VectorCraft for .dxf), CADCraft gets it when both have an address, otherwise the one that has
  one. An editor link without `?app=` chooses among the configured apps.

## [0.1.0] - 2026-10-11

### Added

- "Open in PdfCraft", "Open in PhotoCraft", "Open in VectorCraft" and "Open in DesignCraft" in
  Files, for each Craft app with an address, matched by file extension in any letter case:
  - PdfCraft: .pdf
  - PhotoCraft: .psd, .psb, .pcraft, .tga, .png, .jpg, .jpeg, .webp, .gif, .bmp, .tif, .tiff,
    .ico, .heic, .heif
  - VectorCraft: .vectorcraft, .drawcraft, .ai, .eps, .svgz, .dxf, .svg, .emf, .wmf, .pdf
  - DesignCraft: .designcraft, .idml

  A click on the file opens the Craft app only for types no common Nextcloud app opens (.psd,
  .psb, .pcraft, .tga, .vectorcraft, .drawcraft, .eps, .svgz, .dxf, .designcraft, .idml).
  Not offered in the trash or for files shared without permission to download. The entries
  use the file's id (`Node.id`), not the deprecated numeric `fileid`.
- Editor page `/apps/craftsuite_layer/edit/<fileId>` that frames the Craft app, opens the file
  through WebDAV as the user and stores what the app saves:
  - A save of the opened document replaces the file conditionally; Nextcloud keeps its versions.
  - A save in the app's own format (an image saved as PSD, an SVG as .vectorcraft, an IDML as
    .designcraft) becomes a new file next to the original, and later saves replace that file.
  - A file changed elsewhere meanwhile, or one whose version cannot be checked, gets a conflict
    copy; a file the user may not change gets a new file. Later saves go to the new file.
  - Exports always become new files. When PdfCraft rewrites the whole file on Save (after
    Sanitize, a redaction or a password change), that save becomes a new file, and every later
    save that builds on it replaces that file; saves that build on the opened file still replace
    the opened file.
  - Saves are stored in the order the app made them; an older save that arrives late becomes a
    new file instead of replacing a newer one.
  - New files get a free name, compared in any letter case, without the characters Windows does
    not allow in names, and within Nextcloud's 250-byte limit.
  - The app gets the file name with a lower-case extension.
  - When the app frame reloads, saves still being stored finish into the right file and the app
    gets the last save; a save that cannot be stored after its page in the frame is gone is
    offered for download in a list below the bar until the user discards it.
  - A long upload keeps the app from falling back to a browser download of the same file while
    it makes progress; a request that stalls (no progress for 2 minutes, or no answer 5 minutes
    after an upload) fails the save, and the app downloads the file instead.
  - Close asks once and waits for a save that is still being stored or that the app has
    announced (at most 6 minutes for one that never arrives); leaving the page otherwise asks once
    the app has the file.
  - When the Craft app's page has not answered after 15 seconds (typically a sign-in page of its
    hosting), a hint with a link to open it in a new tab.
- Admin settings page (Administration settings > Craft apps) with one address per Craft app,
  checked on the server; saving needs a recent password confirmation. With `occ`, the addresses
  are the keys `<app>_url`, declared in the config lexicon.
- German translation (informal `de` and formal `de_DE`).
- For Nextcloud 34 (PHP 8.2 to 8.5) and 35 (PHP 8.3 to 8.5).

### Security

- The editor refuses files shared without permission to download them: Nextcloud lets such files
  be viewed and read through WebDAV, but a Craft app could save or export them.
- A Craft app address must use https (http only on loopback addresses) and is refused on one of
  Nextcloud's host names, whatever its port (cookies do not separate ports).
- The editor page frames only the configured Craft app origin, sandboxed without top navigation,
  and never writes over a file it did not open or create.
- The editor page opens the file at once only from Files (a click or key press there adds the
  session's request token) or from an address the user typed or bookmarked. Opened any other way
  (by another site, the Craft hosting included, through a `/f/<id>` link that Files opens by
  itself, or after a sign-in) it asks "Open <file> in <app>?" before it reads or frames anything,
  so code on the Craft origin cannot have other files handed to it. The token is removed from the
  address bar and never reaches the Craft origin.
- The editor page sends `Cross-Origin-Opener-Policy: same-origin`, so a window opened from the
  app (a link in a document, for example) cannot navigate the Nextcloud tab; the frame gets
  `clipboard-write` only.
- A Craft app address needs a host a Content-Security-Policy can name exactly (letters, digits,
  hyphens and dots, or an IP address); international names are converted to their `xn--` form,
  and the page uses the browser's canonical origin.
- Direction overrides and invisible format characters in file names become `_`, so a name
  cannot hide its real extension.
