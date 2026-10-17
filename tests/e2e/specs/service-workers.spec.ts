// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The service workers of each Craft app, in the app's own projects (<app>-<browser>, see
// playwright.config.ts), so CI checks the tested release and the canary the newest one.
//
// A worker that a direct visit of an app registers answers that app's requests from its cache,
// in frames on the same site too: index.html with the translator's tags and the translator files
// stay as they were until the app's next release (docs/hosting.md#service-workers).
// inject-translator.sh replaces a worker at <build>/sw.js (EffectCraft's), and only there. A
// release that registers a worker under another name or path fails here instead of going
// unnoticed.

import { test, expect } from '@playwright/test';

// The test server's app origin (tests/e2e/server/serve.mjs): 127.0.0.2:<base+1>.
const APP_ORIGIN = `http://127.0.0.2:${Number(process.env.CRAFTSUITE_PORT_BASE || 8701) + 1}`;

test('service workers: a direct visit registers none, or only sw.js at the build root', async ({ page }, info) => {
  const app = info.project.name.replace(/-(chromium|firefox|webkit)$/, '');
  // Not framed, so the translator stays inactive and the app does what it does for a visitor.
  await page.goto(`${APP_ORIGIN}/${app}/`, { waitUntil: 'load' });
  // Apps register their worker as their page starts (EffectCraft's before its .wasm has loaded);
  // a few seconds more catch one registered once the app runs.
  await new Promise((resolve) => setTimeout(resolve, 8000));
  const workers = await page.evaluate(async () => 'serviceWorker' in navigator
    ? (await navigator.serviceWorker.getRegistrations()).map((r) => (r.installing ?? r.waiting ?? r.active)?.scriptURL ?? r.scope)
    : []);
  test.info().annotations.push({ type: 'service workers', description: workers.join(' ') || 'none' });
  for (const worker of workers) {
    expect(worker, `${app} registers a service worker that inject-translator.sh does not replace`).toBe(`${APP_ORIGIN}/${app}/sw.js`);
  }
});
