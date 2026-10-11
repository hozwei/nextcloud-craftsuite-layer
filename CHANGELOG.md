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

[Unreleased]: https://github.com/hozwei/nextcloud-craftsuite-layer/compare/v0.1.0...main
[0.1.0]: https://github.com/hozwei/nextcloud-craftsuite-layer/releases/tag/v0.1.0
