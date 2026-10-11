// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Driving a Craft app like a user without a mouse, shared by the specs that run the real apps.
// The four apps are eframe/egui web builds: one <canvas>, keys only while it (or eframe's hidden
// text <input>) has the focus, and nothing else in the DOM to query.

import { test, type Frame, type Locator, type Page } from '@playwright/test';

// Resolves after n animation frames of the app (eframe runs and draws in requestAnimationFrame),
// or after a while if the browser stops sending frames.
export function appFrames(app: Frame, n: number) {
  return app.evaluate((n) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000 + n * 50);
    let left = n;
    const tick = () => (--left <= 0 ? (clearTimeout(timer), resolve()) : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
}

// After something that changes the picture (a file opening, a panel or dialog appearing), wait
// until the app shows the same picture twice in a row, some frames apart.
export async function settle(view: Locator | Page, app: Frame, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  const shot = () => view.screenshot({ caret: 'initial', scale: 'css' });
  await appFrames(app, 5);
  let previous = await shot();
  while (Date.now() < deadline) {
    await appFrames(app, 5);
    const current = await shot();
    if (current.equals(previous)) return;
    previous = current;
  }
  // Something keeps moving: carry on and let the contract checks decide.
  test.info().annotations.push({ type: 'warning', description: `the app did not settle within ${timeout} ms` });
}

// eframe takes keys only while its canvas (or its hidden text <input>) has the focus.
export async function press(page: Page, app: Frame, key: string) {
  await app.locator('canvas').first().focus();
  await page.keyboard.press(key);
}

// eframe moves the focus to its hidden <input> while an egui text field is edited, and back to
// the canvas afterwards: the one sign in the DOM that the palette opened or closed. Should a
// release change that, fall back to waiting some frames; the contract checks still decide.
export async function waitForTextEditing(app: Frame, editing: boolean, what: string) {
  try {
    await app.waitForFunction((editing) => (document.activeElement?.tagName === 'INPUT') === editing, editing, { timeout: 5_000 });
  } catch {
    test.info().annotations.push({ type: 'warning', description: `no focus change: ${what}` });
    await appFrames(app, 10);
  }
}

// The key that opens each app's command palette (DesignCraft has none).
export const PALETTE_KEYS: Record<string, string> = {
  pdfcraft: 'Control+k',
  photocraft: 'Control+f',
  vectorcraft: 'Control+Shift+Slash',
};

// Runs a command like a user without a mouse: the palette key, the command's label, Enter. The
// palettes match labels by substring and run the top hit, so a full label picks its command.
export async function runCommand(page: Page, app: Frame, label: string, palette = PALETTE_KEYS.pdfcraft) {
  await test.step(`ui: run "${label}" from the command palette`, async () => {
    await press(page, app, palette);
    await waitForTextEditing(app, true, `the command palette did not open on ${palette}`);
    await page.keyboard.insertText(label); // no key events: stray letters could be shortcuts
    await appFrames(app, 3); // the palette filters on its next frame; Enter must see the result
    await page.keyboard.press('Enter');
    await waitForTextEditing(app, false, `the command palette did not close after "${label}"`);
  });
}
