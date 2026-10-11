// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Two kinds of tests:
//  - translator.spec.ts: the translator against a stub that behaves like PdfCraft in the browser
//    (fast, independent of the app's UI). All of it in Chromium; Firefox and WebKit run only the
//    tests tagged @cross-browser, the ones that depend on how a browser behaves.
//  - <app>.spec.ts: the translator inside the real web build of each Craft app (pdfcraft,
//    photocraft, vectorcraft, designcraft), in Chromium and WebKit (the apps need WebGL2), as the
//    projects <app>-chromium and <app>-webkit. Needs `npm run craft:fetch` first.
//
// Environment: CRAFTSUITE_PORT_BASE (test server ports), CRAFTSUITE_WEBKIT_EXECUTABLE (optional
// WebKit binary or wrapper, for machines without the usual system libraries), NEXTCLOUD_URL (adds
// the project nextcloud-chromium for nextcloud.spec.ts, nextcloud-apps.spec.ts and
// nextcloud-files.spec.ts, with NEXTCLOUD_USER, NEXTCLOUD_PASSWORD).

import { defineConfig, devices } from '@playwright/test';

const base = Number(process.env.CRAFTSUITE_PORT_BASE || 8701);
const chromiumArgs = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
const webkitExecutable = process.env.CRAFTSUITE_WEBKIT_EXECUTABLE || undefined;
const nextcloud = process.env.NEXTCLOUD_URL ? new URL(process.env.NEXTCLOUD_URL).origin : '';
// The Craft apps with a spec of their own; the canary finds their projects by the name prefix.
const apps = ['pdfcraft', 'photocraft', 'vectorcraft', 'designcraft'];

export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'translator-chromium',
      testMatch: /translator\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, launchOptions: { args: chromiumArgs } },
    },
    {
      name: 'translator-firefox',
      testMatch: /translator\.spec\.ts/,
      grep: /@cross-browser/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1400, height: 900 } },
    },
    {
      name: 'translator-webkit',
      testMatch: /translator\.spec\.ts/,
      grep: /@cross-browser/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1400, height: 900 }, launchOptions: { executablePath: webkitExecutable } },
    },
    // The Nextcloud app; only with a test Nextcloud (NEXTCLOUD_URL, see nextcloud.spec.ts): the editor
    // page with PdfCraft (nextcloud.spec.ts) and with the other apps (nextcloud-apps.spec.ts), Files
    // and the settings (nextcloud-files.spec.ts).
    // One test at a time: a test Nextcloud on SQLite answers parallel writes with 'database is locked'.
    ...(nextcloud ? [{
      name: 'nextcloud-chromium',
      testMatch: /nextcloud(-files|-apps)?\.spec\.ts/,
      workers: 1,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, launchOptions: { args: chromiumArgs } },
    }] : []),
    ...apps.flatMap((app) => [
      {
        name: `${app}-chromium`,
        testMatch: new RegExp(`(^|/)${app}\\.spec\\.ts$`),
        use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, launchOptions: { args: chromiumArgs } },
      },
      {
        name: `${app}-webkit`,
        testMatch: new RegExp(`(^|/)${app}\\.spec\\.ts$`),
        use: { ...devices['Desktop Safari'], viewport: { width: 1400, height: 900 }, launchOptions: { executablePath: webkitExecutable } },
      },
    ]),
  ],
  webServer: {
    command: 'node server/serve.mjs',
    url: `http://127.0.0.1:${base}/config.js`,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    // The test Nextcloud frames the app too, so the translator must accept it as a parent.
    env: { CRAFTSUITE_EXTRA_ALLOWED: nextcloud },
  },
});
