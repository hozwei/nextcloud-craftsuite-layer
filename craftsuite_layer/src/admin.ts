// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin settings: sends the form (templates/admin.php) to SettingsController and shows the result.
// The server checks every address and saves nothing if one is not acceptable. It requires a
// recent password confirmation; Nextcloud's own dialog asks for it when needed.

import { generateUrl } from '@nextcloud/router';
import { t } from './l10n.ts';

interface PasswordConfirmation {
  requirePasswordConfirmation(callback: () => void, options?: object, rejectCallback?: () => void): void;
}

const form = document.querySelector<HTMLFormElement>('#craftsuite-layer-admin form');
const status = form?.querySelector<HTMLElement>('.craftsuite-admin__status');

// Nextcloud's password dialog (OC.PasswordConfirmation, in Nextcloud 34 and 35). Without it the
// server answers 403 when a confirmation is due, and the status line says so.
function confirmPassword(): Promise<void> {
  const pc = (window as unknown as { OC?: { PasswordConfirmation?: PasswordConfirmation } }).OC?.PasswordConfirmation;
  if (!pc) return Promise.resolve();
  return new Promise((resolve, reject) => pc.requirePasswordConfirmation(resolve, {}, () => reject(new Error('cancelled'))));
}

function showHint(input: HTMLInputElement, error: string | null): void {
  const hint = document.getElementById(`${input.id}-hint`);
  if (!hint) return;
  hint.textContent = error ?? hint.dataset.hint ?? '';
  hint.classList.toggle('craftsuite-admin__hint--error', error !== null);
  if (error === null) input.removeAttribute('aria-invalid');
  else input.setAttribute('aria-invalid', 'true');
}

async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!form || !status) return;
  const inputs = [...form.querySelectorAll<HTMLInputElement>('input[name]')];
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  if (button) button.disabled = true;
  status.textContent = t('craftsuite_layer', 'Saving …');
  try {
    await confirmPassword();
    const res = await fetch(generateUrl('/apps/craftsuite_layer/settings'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', requesttoken: document.head.dataset.requesttoken ?? '' },
      body: JSON.stringify({ urls: Object.fromEntries(inputs.map((input) => [input.name, input.value.trim()])) }),
    });
    const body = (await res.json().catch(() => ({}))) as { errors?: Record<string, string>; message?: string };
    for (const input of inputs) showHint(input, body.errors?.[input.name] ?? null);
    status.textContent = res.ok ? t('craftsuite_layer', 'Saved')
      : body.errors ? t('craftsuite_layer', 'Nothing was saved. Correct the marked addresses.')
        : res.status === 403 ? t('craftsuite_layer', 'Nothing was saved: confirm your password and try again.')
          : t('craftsuite_layer', 'Nothing was saved: the server answered HTTP {status}.', { status: res.status });
  } catch (err) {
    status.textContent = err instanceof Error && err.message === 'cancelled'
      ? t('craftsuite_layer', 'Nothing was saved: the password was not confirmed.')
      : t('craftsuite_layer', 'Nothing was saved: the connection to the server failed.');
  } finally {
    if (button) button.disabled = false;
  }
}

form?.addEventListener('submit', (event) => void save(event));
