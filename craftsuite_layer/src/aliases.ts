// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The aliases of the file types this app added to Nextcloud's config/mimetypealiases.json
// (lib/Service/FileTypes.php), for the scripts that pick file icons in the browser
// (OC.MimeType.getIconUrl: Recommended files, Talk, the template picker). Nextcloud gives them its
// aliases from core/js/mimetypelist.js, which only `occ maintenance:mimetype:update-js` writes;
// without these, those places show Nextcloud's cog for the new application/* types instead of the
// plain file icon. Added once the page is parsed, when mimetypelist.js has defined the list; an
// alias the list has already (after update-js) stays as it is.

interface MimeTypeWindow {
  OC?: {
    MimeTypeList?: { aliases?: Record<string, string> };
    MimeType?: { clearIconCache?: () => void };
  };
}

function readState(): Record<string, string> {
  const input = document.querySelector<HTMLInputElement>('#initial-state-craftsuite_layer-aliases');
  if (!input) return {};
  try {
    const aliases = JSON.parse(atob(input.value)) as unknown;
    return aliases && typeof aliases === 'object' && !Array.isArray(aliases) ? (aliases as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function apply(): void {
  const oc = (window as unknown as MimeTypeWindow).OC;
  const list = oc?.MimeTypeList?.aliases;
  if (!list) return;
  let added = false;
  for (const [type, alias] of Object.entries(readState())) {
    if (typeof alias === 'string' && !Object.hasOwn(list, type)) {
      list[type] = alias;
      added = true;
    }
  }
  if (added) oc?.MimeType?.clearIconCache?.();
}

if (document.readyState === 'complete') apply();
else document.addEventListener('DOMContentLoaded', apply, { once: true });
