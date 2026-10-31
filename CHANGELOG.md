<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Changelog

All notable changes to this repository are documented in this file. The Nextcloud app keeps its
own changelog in [`craftsuite_layer/CHANGELOG.md`](craftsuite_layer/CHANGELOG.md); its section
for a version is the text of that release on GitHub.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.5] - 2026-10-31

FigCraft joins as the thirteenth app. The Craft releases of 2026-10-28 (canary issue #10): PdfCraft
0.15.0, VectorCraft 0.18.0, DesignCraft 0.14.0, WordCraft 0.12.0, GridCraft 0.13.0, DeckCraft
0.12.0, CADCraft 0.14.0, LightCraft 0.15.0, FilmCraft 0.14.0, EffectCraft 0.18.0, SoundCraft 0.14.0
and FigCraft 0.12.1 are the tested versions (`apps.json`). PhotoCraft stays at 0.16.0: the web
build of 0.17.0 does not start at all, with or without the layer (its loader asks for
`app/snippets/…`, which the release lacks;
[storytold/photocraft#10017](https://github.com/storytold/photocraft/issues/10017), fixed in pull
request #10248). The canary keeps holding it back until a release starts again.

### Added

- FigCraft (0.12.1 and later, the first release that saves in the browser): the adapter
  `translators/figcraft.js`, its spec and docs/apps/figcraft.md. A `.figcraft` opens as the
  document; FigCraft saves the whole file under the name of the document inside it, so a file
  whose document is named otherwise gets its saves in a new file next to it. A new document, or a
  document the user opened from the disk that would save under the same name, never replaces the
  file. The host's language reaches FigCraft as the browser's language (17 languages; Bengali,
  Japanese, Korean, Thai and Chinese show English in its web build). FigCraft is a plain Trunk
  build: it needs no hosting option, and hostings that take their apps from `apps.json` serve it
  as they are.
- Nextcloud app: FigCraft, see craftsuite_layer/CHANGELOG.md.

### Fixed

- Tests: LightCraft's `saved-as` test sometimes saw no file picker. Chromium shows one only within
  about 5 seconds of the key press, and LightCraft handled Ctrl+Shift+I 17 seconds later while it
  still rendered its demo thumbnails (canary 2026-10-30). The test now waits for those renders
  first, as the pointer test does.

### Changed

- Tests: the pointer tests follow PdfCraft 0.15.0 (no Inspector tab above the attachments, a
  Delete button in their row) and SoundCraft 0.14.0 (taller menu rows; the positions now depend
  on the version).
- The README's app table and docs/architecture.md show the tested versions of `apps.json` again
  (they still showed those of 0.4.x).

## [0.5.4] - 2026-10-26

The Craft releases of 2026-10-22 to 2026-10-25 (canary issues #7 and #9): PdfCraft 0.14.0,
PhotoCraft 0.16.0, VectorCraft 0.17.0, DesignCraft 0.13.0, WordCraft 0.11.0, GridCraft 0.12.1,
DeckCraft 0.11.1, CADCraft 0.13.0, LightCraft 0.14.0, FilmCraft 0.13.0, EffectCraft 0.17.0 and
SoundCraft 0.13.1 are the tested versions (`apps.json`). DeckCraft is back: its web build starts
again since 0.10.0 ([storytold/deckcraft#959](https://github.com/storytold/deckcraft/issues/959)
is still open).

### Fixed

- CADCraft adapter: CADCraft 0.13.0 also writes the text fill of the dimension style
  (`$DIMTFILL`, `$DIMTFILLCLR`) into the header. As with 0.10.0, a file it had saved fitted none
  of the releases the adapter knows, so once it was opened again, its saves went to a new file
  next to it instead of replacing it. The adapter now knows what 0.13.0 writes.
  docs/apps/cadcraft.md.
- GridCraft adapter: since 0.11, GridCraft keeps its interface settings in the browser, the
  language among them, and a stored language wins over the browser's at the next start. As it
  stores the language it started in on its first frame, the host's language applied only to the
  first start in a browser (a user whose Nextcloud language changed kept the old one). While no
  language is stored, the adapter now leaves the language GridCraft started in out of what it
  stores; a language the user picks in GridCraft is still stored and wins, and then `ready`
  reports the host's language only when it is that one. A language stored before this release
  counts as the user's. docs/apps/gridcraft.md, Interface language.
- Canary: the report comments on the oldest open issue of its label and closes any other, and a
  passing run closes them all. The run of 0.5.3's release commit found no open `canary` issue
  (GitHub's list missed #4 for a moment) and opened #6, which left #4 with the label
  `canary:cadcraft` open; updaters hold back the apps of every open issue. An empty list is now
  asked again once after 30 seconds before a new issue is opened. #4 was closed by hand.

### Changed

- Tests: the pointer tests follow the new releases: PdfCraft 0.14.0 (Attach a file… above the
  attachments), WordCraft 0.11.0 (Finish & Merge is a menu, Edit Individual Documents… asks which
  records), DeckCraft 0.11.1 (Outline/RTF in the Export dialog). GridCraft's `language` test also
  checks that the language GridCraft started in is not stored, and that a stored one stays.

## [0.5.3] - 2026-10-22

The Craft releases of 2026-10-20 and 2026-10-21 (canary issue #4): PdfCraft 0.11.0, PhotoCraft
0.12.0, VectorCraft 0.14.0, DesignCraft 0.11.0, WordCraft 0.9.0, GridCraft 0.10.0, CADCraft
0.10.0, LightCraft 0.11.0, FilmCraft 0.10.0, EffectCraft 0.14.0 and SoundCraft 0.11.0 are the
tested versions (`apps.json`). The translators handle them, CADCraft 0.10.0 with the fix below.
DeckCraft stays at 0.7.0: the web build of DeckCraft 0.9.0 still stops as it starts, as 0.8.0 did
([storytold/deckcraft#959](https://github.com/storytold/deckcraft/issues/959)).

### Fixed

- CADCraft adapter: CADCraft 0.10.0 writes the variables of the current dimension style
  (`$DIMTXT`, `$DIMDEC` and 61 more) into the header of every DXF it saves. A file it had saved
  fitted none of the releases the adapter knows, so once it was opened again, its saves went to a
  new file next to it instead of replacing it. The adapter now knows what 0.10.0 writes; a file of
  0.10.0 that an older CADCraft saves (dropping those variables) still becomes a new file.
  docs/apps/cadcraft.md.

### Changed

- Tests: the pointer tests follow the new releases: PhotoCraft 0.12.0 (Export As has an Embed
  Color Profile row) and WordCraft 0.9.0 (the Recipient List shows the field names as text boxes
  above the recipients).
- CI and the canary upload only the results of failed tests (screenshots, error context, the
  trace of the first attempt; no HTML report) and keep them 3 days instead of 14; a failed upload
  no longer fails the run.
- Documentation for updaters that follow this repository's releases, such as
  [craftsuite-webapp](https://github.com/hozwei/craftsuite-webapp) from its v0.5.0 on
  (`CRAFTSUITE_LAYER_VERSION=auto`): docs/hosting.md, Following the layer's releases, lists the
  checks before an updater moves to a new layer release, and Updates reads a canary run's layer
  version from `translators/core.js` at the run's commit; docs/development.md, What updaters rely
  on, lists what every release keeps to, and Releasing starts the canary on the release commit
  before the tag (a translator fix after a run that failed for every app comes as the next
  version).
- docs/nextcloud-app.md, docs/protocol.md, docs/architecture.md, SECURITY.md and the README:
  within one protocol version the translators and the Nextcloud app of different releases work
  together, so the Craft hosting and Nextcloud can be updated separately. An update of the app
  needs only its folder and `occ upgrade`, unless the app's changelog says more for that version.

## [0.5.2] - 2026-10-18

The Craft releases of 2026-10-18 (canary issue #4): PdfCraft 0.9.0, PhotoCraft 0.10.0,
VectorCraft 0.13.1, DesignCraft 0.9.0, WordCraft 0.8.0, GridCraft 0.8.0, CADCraft 0.8.0, LightCraft
0.9.1, FilmCraft 0.9.0, EffectCraft 0.11.1 and SoundCraft 0.8.0 are the tested versions
(`apps.json`). The translators handle them unchanged, PhotoCraft 0.10.0 included, whose contract
test the canary failed. DeckCraft stays at 0.7.0: the web build of DeckCraft 0.8.0 stops with an
error as it starts (`no pids on this platform`) and never loads, with or without the layer
([storytold/deckcraft#959](https://github.com/storytold/deckcraft/issues/959)). Hold it back
until a DeckCraft release fixes that.

### Changed

- Tests: PhotoCraft 0.10.0 places a file dropped on the open document's canvas into it as a layer,
  as on the desktop, instead of opening it as a tab. The scenario with a same-named PSD from the
  desktop drops it on the menu bar, where it still opens as a tab, so it still checks that such a
  file's save never replaces the opened one. The core's own drop is not affected: the host's file
  arrives while no document is open. docs/apps/photocraft.md and the adapter's notes describe the
  new behaviour; a same-named file placed as a layer turns the document's later saves into new
  files, as any file the adapter sees coming in does.
- Tests: PdfCraft 0.9.0 turns an attachment's stored name `../../Team/Budget 2026.pdf` into
  `_.._Team_Budget 2026.pdf` itself; the test accepts either plain base name.
- Tests: the pointer tests follow the new releases: PhotoCraft (Export As has Color Profile rows),
  DesignCraft (Open Recent in the File menu), WordCraft (Recover in the backstage, the Recipient
  List dialog) and LightCraft (OK at the bottom right of the Export dialog).

## [0.5.1] - 2026-10-17

The points left open from the operators' notes, and the FigCraft request upstream.

### Fixed

- Nextcloud app 0.5.1: the editor page keeps the link that opens the app in a new tab when it gives
  up after 90 seconds; that message used to replace it, so a user who looked only then lost the
  way to the sign-in page of the Craft site.

### Changed

- `hosting/nginx/craft-apps.conf.template` serves `.webmanifest` (EffectCraft's
  `manifest.webmanifest`) as `application/manifest+json`.
- docs/nextcloud-app.md: going back to an older version of the app (put its folder in place, run
  `occ upgrade`; tested from 0.5.0 to 0.4.2 and back) and what then changes.
- docs/hosting.md and hosting/README.md: a sign-in with Nextcloud itself as the identity provider
  (its `oidc` app) passes inside the frame; `--remove` on a folder not named
  `<app>-web-<version>` needs `--app`; an updater that keeps a minimum age or checks GitHub's
  asset digests needs the API's release list; a canary issue reopened by hand keeps only its last
  close time.
- README.md and docs/architecture.md: FigCraft's request for opening files in its web build,
  [storytold/figcraft#759](https://github.com/storytold/figcraft/issues/759).

## [0.5.0] - 2026-10-17

New Craft apps become routine: one list of the supported apps that hostings and Nextcloud can
follow without a change of their own, and SoundCraft as the first app added that way. VectorCraft
0.12.0 is the tested version (the canary passed it on 2026-10-17).

### Added

- SoundCraft (`translators/soundcraft.js`, SoundCraft 0.6.1 and later, tested with 0.7.0) for its
  `.scraftz` sessions, the bundle of a session with its audio that its web build saves and opens:
  Save replaces the opened session. A save that may be File > Export > Selected Tracks as New
  Session under the opened name (the export keeps only the selected tracks) becomes a new file,
  unless it came right after the Save shortcut, as do sessions named `Untitled` and every save
  after the user opened another session file in the frame. The adapter sets SoundCraft's `empty`,
  so a file it cannot open leaves an empty session, not the demo. Known gaps are in
  docs/apps/soundcraft.md: File > Save Session with the pointer while every track is selected
  makes a new file (Ctrl+S does not), and each save uploads the whole session with its audio as
  32-bit float WAV.
- `apps.json`, the one list of the supported Craft apps, in the order the Nextcloud app gives them
  a click: name, upstream repository, a short description in English and German, brand colour,
  recommended startup timeout, the oldest release the adapter handles (`minVersion`) and the
  tested one. It replaces `tests/e2e/craft-versions.json`, and the hosting bundle carries it, so
  that an updater can take the apps (and those a new release adds) and their values from there
  (docs/hosting.md, The app list). `npm run apps:check`, run in CI, compares it with the Nextcloud
  app, the adapters, specs and pages, the lists of apps in the documentation and `NON_BLOCKING` in
  both workflows. The Playwright projects, the hosting tests and the Nextcloud specs take their
  apps from it.
- Nextcloud app 0.5.0: an address for all apps, under which each app without one of its own is
  in a folder named after it, and a tick per app that switches it off; see
  `craftsuite_layer/CHANGELOG.md`.
- Canary: the issue labelled `canary` gets a label `canary:<app>` for each app whose own tests
  failed in the latest failing run (all apps when the failure is not one of single apps: a failed
  fetch, the translator's own tests, a run that broke before its summary), and every report ends
  with a line `` `canary-result {...}` `` (JSON: the run, the commit and layer version tested, the
  apps to hold back, the app versions tested), so that an updater can hold back only those apps.
- Tests: every app's projects also run `tests/e2e/specs/service-workers.spec.ts`, which visits the
  app directly and fails when it registers a service worker other than `sw.js` at the build's root,
  the only one `inject-translator.sh` replaces. The canary thus holds back a release that brings a
  worker under another name.

### Changed

- Canary: the look at the next Nextcloud release (job `nextcloud-next`) no longer fails the run.
  Its finding still opens the issue labelled `canary-nextcloud`; a failed download only warns. A
  failed run now always means that the tests of the Craft releases (or the report) failed.
- docs/hosting.md, Updates: the first canary run created after a release counts (its
  `created_at`, since GitHub resets `run_started_at` on a re-run), a later green run does not make
  up for a failed one, and the issues as they are at the run's end are its result; holding back
  single apps; releases below `minVersion` are skipped, and the app list recommends the startup
  timeouts.
- docs: FigCraft is not supported yet, since its web build can neither open nor save a file
  (0.6.0); docs/development.md, Adding a Craft app, says how to watch for new apps and to start an
  app's file types from its own packaging; the state of the upstream requests for an embedding API
  (2026-10-17); the WebKit projects are still `NON_BLOCKING`, so the canary decides with Chromium
  only.

## [0.4.2] - 2026-10-16

Translators for the Craft releases of 2026-10-14 (canary issue #3): PdfCraft 0.8.0, PhotoCraft
0.9.0, VectorCraft 0.11.0, DesignCraft 0.8.0, WordCraft 0.7.0, GridCraft 0.7.0, CADCraft 0.7.0,
DeckCraft 0.7.0, FilmCraft 0.8.0, LightCraft 0.8.0 and EffectCraft 0.10.0 are the tested versions
(`tests/e2e/craft-versions.json`). The adapters keep working with the previous releases.

### Fixed

- GridCraft 0.7.0 took more than 3 s to take files on a first start in a fresh browser, and the
  layer reported a startup error to the host before the file arrived. GridCraft now gets 10 s.
- WordCraft 0.7.0 inserts dropped WMF and EMF files as pictures: they no longer count as a
  document of the user's own, so saves after such a picture are no longer all new files.

### Changed

- Tests: the steps that type into a Craft app wait some frames after focusing it before the first
  key (`focusCanvas()` in `tests/e2e/lib/craft-ui.ts`). WordCraft 0.7.0 handles a frame's keys
  with the focus of the frame before, so a key sent at once was lost: Ctrl+S saved nothing and
  typed text lost its first letter. This, not the translator, failed the WordCraft contract
  tests of the canary.
- Tests: GridCraft's sales sample no longer has to come back byte for byte from a release other
  than the one that wrote it (0.7.0 adds `<scheme val="minor"/>` to the default font). Its first
  save must have the fixture's parts, and that save, opened again, must come back unchanged, so
  the fixture needs no new save with each release.
- Tests: FilmCraft's pointer test clicks where FilmCraft reports its menu items
  (`request('ui.elements')`), so a menu that gains a row (0.8.0 added Open Recent) no longer
  breaks it; the positions in `AT` stay as the fallback. The pointer tests of WordCraft (Word 2003
  XML Document on the Export page) and CADCraft (Open Recent in the File menu) follow the new
  releases.
- `docs/apps/` describe what changed: GridCraft's opt-in embedding bridge for a parent on its own
  origin (`?host=parent`, which the translator does not use), the parts GridCraft 0.7.0 keeps
  (chart sheets, XML maps), and WordCraft 0.7.0's key handling.

## [0.4.1] - 2026-10-14

Translators for the Craft releases of 2026-10-13 (canary issue #2): PdfCraft 0.7.1, PhotoCraft
0.8.2, VectorCraft 0.10.0, DesignCraft 0.7.1, WordCraft 0.6.1, GridCraft 0.6.1, CADCraft 0.6.2,
DeckCraft 0.6.1, FilmCraft 0.7.2, LightCraft 0.7.1 and EffectCraft 0.9.2 are the tested versions
(`tests/e2e/craft-versions.json`). The adapters keep working with the previous releases.

### Fixed

- WordCraft 0.6.1: saves in Chromium-based browsers reached neither Nextcloud nor the disk, since
  WordCraft now saves through the browser's save picker, which a frame of another origin refuses.
  The adapter hides the picker from the app, so every save is a download the translator catches.
  WordCraft gets 10 s instead of 3 s to take a dropped file before the layer reports a startup
  error.
- CADCraft 0.6.2: every Ctrl+S of a DXF CADCraft wrote became a new file, because 0.6.2 saves R2018
  by default and writes objects 0.5.0 did not. The adapter now knows what each release writes; a
  DXF a newer CADCraft wrote, or a save in an older DXF version than the file's, goes to a copy.
- EffectCraft 0.9: saves of the opened project became new files, because 0.9 writes the open
  compositions into the project head. While Script Console scripts may write files, every save is
  a new file, so a script cannot replace the opened project under its name.
- GridCraft 0.6.1: a save of the opened file is the document only if GridCraft wrote it and the
  save still has every part GridCraft does not rebuild (custom properties, customXml items,
  external links, threaded comments, ...); otherwise it is a copy. The adapter removes
  `window.showSaveFilePicker` in the frame, so saves always go through the translator. `.xls`
  and `.xlt` are imports, saved as `<stem> (imported).xlsx`.
- VectorCraft 0.10.0 fetches two startup fonts first: the adapter waits up to 45 s (was 30 s) for
  its first drop listener.

### Changed

- WordCraft: a workbook brought into the app counts as a mail-merge recipient list (0.6.1 loads it
  as one), and merge fields in headers and footers mark a merged document.
- PdfCraft is no longer started in Arabic or Japanese (0.7.1's web build lacks their fonts);
  CADCraft can be started in Czech, German, Spanish, French, Brazilian Portuguese and Russian.
- New-document names of the languages PhotoCraft 0.8 and WordCraft 0.6 added are never taken for
  the opened document.
- Tests follow the new releases: the pointer tests (@ui) of PdfCraft, WordCraft, GridCraft,
  CADCraft, LightCraft and EffectCraft, the GridCraft sales sample fixture, and new steps for
  PdfCraft's Create separate PDFs…, a CADCraft file reopened in the release that wrote it, and an
  EffectCraft script writing under the opened name.
- `docs/apps/` describe the new releases (facts, source references, coordinates).
- Dependabot no longer proposes majors of `@types/node`: the types follow the Node.js the tooling
  runs on (24), so they move by hand together with it.

## [0.4.0] - 2026-10-12

### Added

- Nextcloud app: a Craft app can be made the default app for all its file types, so that a click
  in Files opens a `.docx` in WordCraft instead of Nextcloud Office, ONLYOFFICE or Euro-Office,
  for example; see [`craftsuite_layer/CHANGELOG.md`](craftsuite_layer/CHANGELOG.md) and
  docs/nextcloud-app.md, Configuring. A test with an office app's hidden default action covers it.
- Nextcloud app: "+ New" entries for the Craft apps' own formats, with a blank document per app in
  `craftsuite_layer/assets/`, made by `craftsuite_layer/blanks.mjs` (`npm run blanks:check` in CI);
  each app's spec but LightCraft's opens its blank (WordCraft's, GridCraft's and PdfCraft's on A4
  and Letter) and checks that the first save replaces it.

### Changed

- Translators: version 0.4.0 (released together with the Nextcloud app), with no other change.
- The EffectCraft contract test runs Save Frame As through `window.effectcraft`: on GitHub's runner
  its shortcut, pressed right after the command palette, opened the palette again (CI of 0.3.0).

## [0.3.0] - 2026-10-12

### Added

- The language a Craft app starts in, chosen by the host (`translators/core.js`, layer 0.3.0,
  protocol version 1 unchanged): the host frames the app with `#craftsuite-layer:lang=<BCP 47
  tag>`; the core reads it before the app runs, takes it out of the address, keeps it in the
  frame's name for reloads, and hands it to the adapter's new optional member `language(tag,
  util)`, with `util.matchLanguage()` and `util.preferLanguages()`. `ready` reports the applied
  language in a new field `language`. Eight adapters apply it, each the way its app takes a
  language: PdfCraft and PhotoCraft in their own preferences (a language the user picked in the
  app stays), VectorCraft as `?lang`, GridCraft, CADCraft and FilmCraft through the browser's
  language as the page reports it, LightCraft and EffectCraft through their automation call. Only
  languages the web builds show properly are offered (`docs/apps/`). DesignCraft 0.6.0, WordCraft
  0.5.0 and DeckCraft 0.5.0 read no language when they start. See docs/protocol.md, Host settings.
- A test per Craft app that it starts in the host's language, tagged `@language`, and translator
  tests of the fragment, the frame's name and the checks of the tag (`translator.spec.ts`, every
  engine). The canary runs the `@language` tests with the `@ui` tests: they cannot fail its run.
- File type icons in Files: the Nextcloud app shows the Craft apps' own icons
  (`craftsuite_layer/img/types/`, MIT OR Apache-2.0, see `REUSE.toml`) for the types they open; see
  [`craftsuite_layer/CHANGELOG.md`](craftsuite_layer/CHANGELOG.md) and docs/nextcloud-app.md.

### Changed

- docs/hosting.md, Updates: an updater counts a Craft release as tested only when a canary run
  started after it came out and ended (the newest completed run of `canary.yml`, one API
  request); the absence of an open issue is not enough, since GitHub may skip or delay scheduled
  runs. A run ends within about two hours of its start. docs/development.md says what to do when
  no run came.

### Fixed

- docs/apps/wordcraft.md said WordCraft follows the browser's language; 0.5.0 always starts in
  English. docs/apps/vectorcraft.md said VectorCraft keeps its preferences in the browser; 0.9.0
  keeps none there.

## [0.2.0] - 2026-10-12

### Added

- Seven more Craft apps, each with an adapter checked against its source and web build, a page
  in `docs/apps/` and a spec with three scenario tests in Chromium and WebKit:
  - WordCraft (`translators/wordcraft.js`, WordCraft 0.5.0): a save of a Word file WordCraft
    wrote (`docProps/app.xml`) replaces it; a save of one another program wrote is a copy (see
    below). An opened `.odt`, `.rtf`, `.doc` or `.dot` saves as `<stem>.docx` next to it. The
    creation time in `docProps/core.xml` tells new documents (`Document1.docx`) apart. Once a
    recipient list from a file reaches WordCraft, or the opened template's merge fields are
    gone, saves under the opened name become new files: Finish & Merge copies the opened
    document's title and creation time.
  - GridCraft (`translators/gridcraft.js`, GridCraft 0.5.0) for `.xlsx`, `.xlsm`, `.ods` and
    `.csv`: an `.xlsx` GridCraft wrote saves in place, one from another program as a copy;
    `.xlsm`, `.ods` and `.csv` save as `<stem>.xlsx` (`<stem> (imported).xlsx` for ODS) next to
    the original. New workbooks, samples and same-named files the user brings in become new
    files.
  - DeckCraft (`translators/deckcraft.js`, DeckCraft 0.5.0): an opened `.deckcraft` saves in
    place, an opened `.pptx`, `.potx` or `.ppsx` as a new `<stem>.deckcraft` next to it. A
    `.deckcraft` from a newer DeckCraft, or a PowerPoint file under a `.deckcraft` name, saves as
    a copy. Exports (Export PowerPoint under the opened name too), new presentations, the sample
    deck and presentations from the user's disk become new files.
  - CADCraft (`translators/cadcraft.js`, CADCraft 0.5.0) for `.dxf`: a DXF that CADCraft 0.5.0
    wrote, checked against its writer's vocabulary, saves in place; any other DXF as a copy.
    New drawings (`Drawing<N>.dxf`), the sample (`Bracket.dxf`) and same-named drawings the user
    brings in become new files.
  - LightCraft (`translators/lightcraft.js`, LightCraft 0.6.0): open a photo, develop it, export
    a new file next to it; nothing ever replaces a file. The adapter runs LightCraft in memory
    mode (`store=memory&workers=0`) and opens nothing unless LightCraft confirms it, so photos
    are not kept in the browser; the edits are gone when the editor closes.
  - FilmCraft (`translators/filmcraft.js`, FilmCraft 0.6.0) for `.fcproj` projects: Save saves
    back, Save As before the first Save stores `<project name>.fcproj` next to it. `ready` waits
    until FilmCraft's graphics run (it dispatches no `TrunkApplicationStarted`), and the adapter
    starts it with `fresh`, so earlier sessions kept in the browser do not come back.
  - EffectCraft (`translators/effectcraft.js`, EffectCraft 0.8.0) for `.ecproj` projects: the
    adapter starts it with `empty`, `nosw` and `storage=memory` and refuses to start unless the
    app confirms them; a project a newer EffectCraft wrote saves as a copy; `Untitled
    Project.ecproj`, Collect Files' copy and same-named files the user brings in become new
    files.

  SoundCraft is not supported: its web build can neither open nor save files.
- Copies (`translators/core.js`, protocol version 1 unchanged): an adapter's `classify` may
  return `copy` for a save of the opened file that must not replace it because the app saves it
  with losses. The first such save is sent as an `export` (a new file next to the original), the
  later ones of the same open as `document` with `follows` set to the first, so the host
  replaces that copy ([docs/protocol.md](docs/protocol.md#copies)).
- `hosting/inject-translator.sh` replaces a service worker a build ships as `sw.js` (EffectCraft
  does) with one that serves nothing, deletes the app's caches and unregisters itself; the
  original is kept for `--remove`.
- `hosting/inject-translator.sh --startup-timeout MS` writes `data-startup-timeout` on the
  `core.js` tag as part of its block: `--check` compares it, and a run without the option removes
  it. Use 180000 for LightCraft and EffectCraft, whose downloads do not hold back the page's
  `load` event ([docs/hosting.md](docs/hosting.md#startup-timeout)). Values other than a whole
  number from 1 to 2147483647 exit with code 2.

### Changed

- Tested with the newest releases: PdfCraft 0.6.0, PhotoCraft 0.7.0, VectorCraft 0.9.0 and
  DesignCraft 0.6.0, in Chromium and WebKit. The adapters needed no changes; the app pages in
  `docs/apps/` are checked against the new sources.
- The `@ui` tests of PhotoCraft and VectorCraft find their menu entries again: PhotoCraft 0.7.0
  added File > Open EXR Parts… (and its File menu now scrolls at the test's window size), and
  VectorCraft 0.9.0 dropped the app menu before File and made the menu bar lower. PhotoCraft's
  test now finds File > Save from the menu's rows; VectorCraft's places menu entries relative to
  the File title, and both name the entry to re-measure when a click misses.
- docs: PdfCraft 0.6.0 has a same-origin bridge enabled by `?host=parent`; under a Nextcloud on
  another origin it would drop every save, so the app address must not carry it. PhotoCraft
  0.7.0 and VectorCraft 0.9.0 open their contributor links in a new tab themselves.
- The Nextcloud app refuses Craft app addresses with a query: several apps read their query as
  switches, such as PdfCraft 0.6.0's `?host=parent`, which would drop every save under a
  Nextcloud on another origin. Adapters set the switches their app needs themselves.
- When two configured apps open the same type on a click (CADCraft and VectorCraft for `.dxf`),
  only one gets it: CADCraft when both have an address, otherwise the one that has one.
- The WebKit projects of the seven new apps are in `NON_BLOCKING` in CI and the canary until
  they pass on a GitHub runner.
- nginx template: `immutable` only for `*.js` and `*.wasm` whose names carry Trunk's content hash
  (`-[0-9a-f]{8,16}(_bg)?\.(js|wasm)$`), `no-cache` for everything else. Before, every `*.js` and
  `*.wasm` was cached for a year, including EffectCraft's `sw.js` and the unhashed files of
  FilmCraft, LightCraft and EffectCraft, so an update under the same path would have left
  browsers with their old glue and `.wasm` next to a new `index.html`. `.otf` is served as
  `font/otf` and compressed.
- docs/hosting.md: which files to serve (LightCraft's release zip holds Cargo build leftovers,
  `build/`, `deps/`, `.fingerprint/` and others, that must not be served), startup timeouts, the
  cache rule, app addresses without a query, and `Clear-Site-Data` for FilmCraft as an option
  with its trade-off.
- The hosting tests run on the fetched builds of all eleven apps.

## [0.1.0] - 2026-10-11

### Added

- Initial repository structure: translators, Nextcloud app, hosting, documentation and
  end-to-end tests, licensed under the AGPL-3.0-or-later, with SPDX headers and a `REUSE.toml`
  for the files that cannot hold one.
- Translator core (`translators/core.js`, version 0.1.0) with message protocol version 1:
  handshake with allowed origins only, opening files by a simulated drop, saves as `document`
  or `export` (a save counts as stored only with `ok: true`), fallback to a browser download
  when the host does not store a save, startup errors, sanitised names (cut to 200 characters
  keeping a short extension; direction overrides and invisible format characters become `_`),
  and the timeouts `data-save-ack-timeout`, `data-save-result-timeout`, `data-startup-timeout`
  and `data-drop-target-timeout`. Saves are announced at once (`save-started`), prepared in
  parallel and posted in the order the app made them. After the handshake, links open only for
  `http`, `https`, `mailto`, `blob` and `about:blank`, never in the frame or above it, and pages
  of another origin open without `window.opener`.
- Adapter hooks in the translator core: `savedName` (the name the app saves an opened file
  under, so that a save in the app's own format is still the `document` of that open),
  `started` (for an app that can take files only some time after its first `drop` listener),
  `dropTargetTimeout`, `identity` (what tells documents with the same name apart, such as a
  creation time stored in the file) and `continuesExports` (a later save that extends an export
  under the document's name continues it; the `save` names that export in `follows`).
- Adapters, each checked against the app's source and web build:
  - PdfCraft (`translators/pdfcraft.js`, PdfCraft 0.5.0): Save under the opened name with the
    stored bytes as prefix is the document; after a full rewrite (Sanitize, redaction, a
    password change, a repaired file) later saves continue the new file.
  - PhotoCraft (`translators/photocraft.js`, PhotoCraft 0.6.0): an opened file saves as
    `<stem>.psd`; only a Photoshop file under that name is the document, not after a file the
    app saves under the same name reached it from elsewhere, and never a save named like a new
    document (`Untitled-N` and its translations); 15 seconds for the drop target.
  - VectorCraft (`translators/vectorcraft.js`, VectorCraft 0.8.0): ready only once its graphics
    run; a native file under the name its Save As suggests (`<title>.vectorcraft`), or under the
    opened name, is the document if its creation time matches; compressed files are read as a
    stream, at most 512 MB.
  - DesignCraft (`translators/designcraft.js`, DesignCraft 0.5.0): a DesignCraft package under
    `<title>.designcraft` with the opened document's creation time is the document, also for an
    opened IDML.
- End-to-end tests with Playwright, written as scenario tests whose steps check one behaviour
  after another: the translator against a stub app (every scenario in Chromium, those that
  depend on the browser, tagged `@cross-browser`, also in Firefox and WebKit); the real web
  builds of PdfCraft, PhotoCraft, VectorCraft and DesignCraft in Chromium and WebKit, driven
  with the keyboard, with one `@ui` test per app for the pointer paths; the Nextcloud app in a
  real Nextcloud (project `nextcloud-chromium`); a tool that downloads and verifies Craft web
  builds.
- Linting of the TypeScript tests and the Nextcloud app's front end with typescript-eslint
  (`no-floating-promises`, `no-misused-promises`), and of the tests with
  eslint-plugin-playwright.
- Nextcloud app (`craftsuite_layer/`, version 0.1.0, with its own
  [changelog](craftsuite_layer/CHANGELOG.md)) for Nextcloud 34 and 35: entries such as "Open in
  PdfCraft" in Files, matched by extension; an editor page that opens the file through WebDAV
  and stores every save back; an admin settings page for the Craft app addresses; English and
  German.
- Hosting template in `hosting/`: `inject-translator.sh` (POSIX sh) adds the translator to an
  unpacked web build for a release updater: the two script tags after the first real `<head>`
  tag, the translator files, a `?v=<checksum>` in their URLs (from `cksum`, else `sha256sum` or
  `md5sum`), new `.gz` and no stale `.br` copies of what it changed, `--check` and `--remove`,
  and exit codes an updater can act on (6: no adapter for this app, serve it without the layer;
  any other failure: keep the current version). Its tests run under dash, `bash --posix` and
  BusyBox.
  An nginx configuration template (`frame-ancestors` from the same allowed origins, cache and
  type headers, precompressed files) and a Compose example.
- Continuous integration for every change: lint, typecheck, the hosting script (ShellCheck and
  its tests), the end-to-end tests (the `<app>-webkit` projects without failing the run until
  they pass on a GitHub runner), `php -l` on PHP 8.2 to 8.5, `info.xml` against a pinned App
  Store schema, the translation check, the App Store package, and the Nextcloud tests in
  `nextcloud:34.0.4-apache` and `nextcloud:35.0.1-apache`, run on the App Store package with an
  administrator and a second, regular user.
- A daily canary run against the newest Craft releases that decides on the contract tests,
  counts flaky tests as failures and tracks failures in issues labelled `canary` and
  `canary-ui`; its job `nextcloud-next` opens an issue labelled `canary-nextcloud` when
  Nextcloud's development branch no longer asks for `@nextcloud/files` 4.x, and warns while that
  branch is above `info.xml`'s `max-version`.
- Weekly Dependabot updates with a seven-day delay; majors of `@nextcloud/files` move by hand.
- A release workflow: a pushed tag `v<version>` that matches `info.xml`, the translator's
  `LAYER_VERSION` and a dated section in both changelogs publishes a GitHub release with the
  Nextcloud app (`craftsuite_layer-<version>.tar.gz`), the hosting bundle
  (`craftsuite-layer-hosting-<version>.tar.gz`: the injector with the translators, the nginx
  template and the Compose example) and `SHA256SUMS`, as plain downloads for installations and
  release updaters.
- Documentation: an index (`docs/README.md`), architecture, protocol, security, hosting,
  development, the Nextcloud app, and one page per Craft app.

[Unreleased]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.5.5...main
[0.5.5]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hozwei/nextcloud-craftsuite-layer/releases/tag/v0.1.0
