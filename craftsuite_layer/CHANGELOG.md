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
