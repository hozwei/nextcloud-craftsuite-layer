<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting:
open the repository's **Security** tab and choose **Report a vulnerability**
([direct link](https://github.com/hozwei/nextcloud-craftsuite-layer/security/advisories/new)).
Do not open a public issue for a vulnerability.

Please include:

- what is affected (translator, adapter, Nextcloud app, hosting template or documentation) and
  the version or commit,
- the steps to reproduce, ideally against the test server in `tests/e2e/server/`,
- what an attacker gains.

We will confirm receipt, keep you informed, and credit you in the advisory unless you prefer
otherwise.

## Scope

In scope:

- the translators in `translators/` (origin checks, message handling, name sanitising, the
  handling of saves),
- the Nextcloud app in `craftsuite_layer/`,
- the hosting template in `hosting/` and the hosting guidance in `docs/`,
- the release assets and the workflows in `.github/workflows/` that build them.

Out of scope, please report to the respective project:

- vulnerabilities in the Craft apps themselves, to their upstream repositories (for PdfCraft:
  [github.com/storytold/pdfcraft](https://github.com/storytold/pdfcraft)),
- vulnerabilities in Nextcloud, as described in
  [Nextcloud's security policy](https://nextcloud.com/security/),
- the configuration of a particular hosting or Nextcloud instance, to its operator.

How the layer is meant to be secure is described in [docs/security.md](docs/security.md).

## Supported versions

Only the latest [release](https://github.com/hozwei/nextcloud-craftsuite-layer/releases) and the
`main` branch are supported. Fixes land on `main` and come out in the next release; older
releases get no backports. A release carries both the Nextcloud app and the translators, so
update both: the app in Nextcloud, and the translators in the hosting
([docs/hosting.md](docs/hosting.md#the-layers-files)).
