<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Documentation

What the project is and how it works in short: [README](../README.md). Changes per version:
[CHANGELOG.md](../CHANGELOG.md), and for the Nextcloud app
[craftsuite_layer/CHANGELOG.md](../craftsuite_layer/CHANGELOG.md).

## For administrators

- [The Nextcloud app](nextcloud-app.md): installing it from a release, the Craft app addresses,
  the Files entries, and what the editor page stores where.
- [Hosting the Craft apps](hosting.md): the requirements for serving the apps with the
  translator: origin, injection, headers, updates, a sign-in in front of them.
- [Security](security.md): the trust model, and what the translator, the host page, the
  Nextcloud app and the hosting each enforce.

## How each Craft app behaves

- [PdfCraft](apps/pdfcraft.md): which saves replace the opened PDF, and the rewrites after
  redaction or Sanitize.
- [PhotoCraft](apps/photocraft.md): saves as `<stem>.psd`, the file types it opens, and its
  known gaps.
- [VectorCraft](apps/vectorcraft.md): the first Save's dialog, saves as `.vectorcraft`, the file
  types it opens.
- [DesignCraft](apps/designcraft.md): saves as `<title>.designcraft`, IDML, and its known gaps.

## For developers

- [Architecture](architecture.md): the components, how opening and saving work, the design
  decisions and what the layer relies on upstream.
- [Message protocol](protocol.md): the messages between the host page and the translator, and
  what a host must do.
- [Development](development.md): setup, tests, CI and the canary, releasing, adding a Craft app,
  conventions.
- [Translators](../translators/README.md): loading and configuring the translator, and writing an
  adapter.
- [Hosting template](../hosting/README.md): `inject-translator.sh`, the nginx template and the
  Compose example.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).
