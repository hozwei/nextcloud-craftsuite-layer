// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin settings: sends the form (templates/admin.php) to SettingsController and shows the result.
// The server checks every address, language and default app and saves nothing if one is not
// acceptable; after a save it says per app what a click in Files opens now. It requires a recent
// password confirmation; Nextcloud's own dialog asks for it when needed. The languages an app can
// start in come as tags ('pt-BR'); each is shown by its own name.

import { generateUrl } from '@nextcloud/router';
import { t } from './l10n.ts';

interface PasswordConfirmation {
  requirePasswordConfirmation(callback: () => void, options?: object, rejectCallback?: () => void): void;
}

const form = document.querySelector<HTMLFormElement>('#craftsuite-layer-admin form');
const status = form?.querySelector<HTMLElement>('.craftsuite-admin__status');

// 'pt-BR' -> 'português (Brasil)': each language in its own words, as language menus do.
for (const option of form?.querySelectorAll<HTMLOptionElement>('select[data-app] option[lang]') ?? []) {
  try {
    const name = new Intl.DisplayNames([option.value], { type: 'language' }).of(option.value);
    if (name && name !== option.value) option.textContent = name.charAt(0).toLocaleUpperCase(option.value) + name.slice(1);
  } catch { /* the tag stays */ }
}

// Nextcloud's password dialog (OC.PasswordConfirmation, in Nextcloud 34 and 35). Without it the
// server answers 403 when a confirmation is due, and the status line says so.
function confirmPassword(): Promise<void> {
  const pc = (window as unknown as { OC?: { PasswordConfirmation?: PasswordConfirmation } }).OC?.PasswordConfirmation;
  if (!pc) return Promise.resolve();
  return new Promise((resolve, reject) => pc.requirePasswordConfirmation(resolve, {}, () => reject(new Error('cancelled'))));
}

interface Problems {
  error: string | null;
  languageError: string | null;
  defaultAppError: string | null;
}

// The hint under an app's row shows the problem with its address, else the one with its language
// or its default app setting, else what the app opens (and a click opens in it).
function showHint(input: HTMLInputElement, { error, languageError, defaultAppError }: Problems, text?: string): void {
  const hint = document.getElementById(`${input.id}-hint`);
  if (!hint) return;
  if (text !== undefined) hint.dataset.hint = text;
  const problem = error ?? languageError ?? defaultAppError;
  hint.textContent = problem ?? hint.dataset.hint ?? '';
  hint.classList.toggle('craftsuite-admin__hint--error', problem !== null);
  const mark = (field: Element | null, bad: boolean) => {
    if (bad) field?.setAttribute('aria-invalid', 'true');
    else field?.removeAttribute('aria-invalid');
  };
  mark(input, error !== null);
  mark(document.getElementById(`${input.id}-language`), languageError !== null);
  mark(document.getElementById(`${input.id}-default`), defaultAppError !== null);
}

async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!form || !status) return;
  const inputs = [...form.querySelectorAll<HTMLInputElement>('input[name]')];
  const selects = [...form.querySelectorAll<HTMLSelectElement>('select[data-app]')];
  const checks = [...form.querySelectorAll<HTMLInputElement>('input[type=checkbox][data-app]')];
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  if (button) button.disabled = true;
  status.textContent = t('craftsuite_layer', 'Saving …');
  try {
    await confirmPassword();
    const res = await fetch(generateUrl('/apps/craftsuite_layer/settings'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', requesttoken: document.head.dataset.requesttoken ?? '' },
      body: JSON.stringify({
        urls: Object.fromEntries(inputs.map((input) => [input.name, input.value.trim()])),
        languages: Object.fromEntries(selects.map((select) => [select.dataset.app ?? '', select.value])),
        defaultApps: Object.fromEntries(checks.map((check) => [check.dataset.app ?? '', check.checked])),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      errors?: Record<string, string>; languageErrors?: Record<string, string>; defaultAppErrors?: Record<string, string>;
      hints?: Record<string, string>; message?: string;
    };
    for (const input of inputs) {
      showHint(input, {
        error: body.errors?.[input.name] ?? null,
        languageError: body.languageErrors?.[input.name] ?? null,
        defaultAppError: body.defaultAppErrors?.[input.name] ?? null,
      }, body.hints?.[input.name]);
    }
    status.textContent = res.ok ? t('craftsuite_layer', 'Saved')
      : body.errors ? t('craftsuite_layer', 'Nothing was saved. Correct the marked fields.')
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
