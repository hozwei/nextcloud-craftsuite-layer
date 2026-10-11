<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Security

How the layer keeps files from reaching the wrong page and saves from overwriting the wrong file.
To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Trust model

| Party | Trusted for | Not trusted for |
|---|---|---|
| Nextcloud and its editor page (the host) | the user's session and files; deciding what is stored where | |
| The Craft hosting (its own origin) | serving the upstream release unmodified, plus the translator; the files users open there | the Nextcloud session (it is another origin) |
| The Craft app's code (upstream) | editing the file it was given | anything beyond that file |
| Documents | | their contents and every name inside them |
| Other web sites | | framing the app, receiving files, sending files |

The Craft apps must never be served from the Nextcloud origin: code on that origin could use the
user's Nextcloud session.

The Craft hosting serves the code that runs in the frame, so whoever controls it receives every
file a user opens there. What a compromised hosting could and could not do:

- It could send the opened files anywhere: the frame's own Content-Security-Policy is the
  hosting's to set.
- It could not have other files handed to it without the user's say. Code on the Craft origin
  can open the editor page for another file id in a new window on a click of the user (the
  session cookie is sent on such a navigation), directly, through a link to `/index.php/f/<id>`
  (Files then opens the file by itself, as a same-origin navigation) or through the sign-in page
  (which goes on to the editor after a sign-in); file ids are guessed, the frame gets none. The
  editor page opens at once only with the session's request token, which Files' entry adds only
  on a click or key press of the user and no other site can know, or for an address the browser
  reports as typed, bookmarked or opened from outside it (`Sec-Fetch-Site: none`). Every other
  open only asks "Open <file> in <app>?" and reads nothing until the user confirms.
- It could send `save` messages with any content. As `document` they replace only the file the
  user opened, or a file the editor created for that document, and only conditionally;
  Nextcloud's file versions (where enabled) keep the previous state. Everything else becomes new
  files in the same folder, within the user's quota.
- It could show anything inside the frame, such as a form that asks for a password.
- It could not use the Nextcloud session, read the clipboard, or navigate the Nextcloud tab: the
  frame is on another origin, sandboxed without top navigation, and may only write to the
  clipboard; the editor page sends `Cross-Origin-Opener-Policy: same-origin`, so no window the
  frame opens (a link in a document included) gets a handle on the Nextcloud tab; and the editor
  page answers only the frame it created, on the configured origin.

That is why only an administrator sets the Craft app addresses, on the server, and why the
address never comes from a request or a link.

## What the translator enforces

See `translators/core.js`; the message rules are in [protocol.md](protocol.md).

- **Allowlist from the hosting.** The allowed host origins come from the `data-allowed-origins`
  attribute that the hosting writes into `index.html`, never from the URL or a message. Each entry
  must be a plain origin: `https://`, or `http://` only on `localhost`, `127.x.x.x` or `[::1]`;
  no user name or password, no path other than `/`, no query, no fragment. Other entries are
  ignored. Entries are compared as normalised origins; there are no wildcards.
- **Inactive by default.** Without a frame, without a valid allowlist, outside a secure context
  (or without Web Crypto), without an adapter, or without a valid `init`, the translator
  intercepts nothing and the app behaves as without it.
- **`hello` reaches only allowed origins.** It is posted with each allowed origin as
  `targetOrigin`, so the browser drops it for any other parent.
- **`init` must come from the parent.** It is accepted only from `window.parent` and only from an
  allowed origin. The first accepted origin stays fixed until the page in the frame is reloaded.
- **Foreign and forged messages are ignored.** Messages from other windows, from other origins,
  with another `protocol` or `version`, or with wrong field types (`open` without an
  `ArrayBuffer` and a string name) have no effect.
- **Replies go only to the host.** Every message after the handshake is addressed to the accepted
  origin. If the parent navigates to another origin, the browser drops them.
- **Names are sanitised.** Names can come from documents (for example an attachment's file name
  such as `../../Team/Budget 2026.pdf`). The translator keeps a plain base name without control
  characters; direction overrides and invisible format characters become `_`, as in a browser
  download, so a name cannot hide its real extension (`invoice<U+202E>fdp.exe`). A name longer
  than 200 characters is cut to 200 first, keeping a short extension and whole characters.
  Leading and trailing dots and whitespace are removed after the cut, so no name starts or ends
  with one (details in [protocol.md](protocol.md#names)).
- **Links open safely.** After the handshake, `window.open` opens only `http`, `https`,
  `mailto`, `blob` and `about:blank` (never `javascript:` or `data:`, which would run with the
  app's origin), and a page of another origin opens with `noopener`, so it cannot reach the frame.
- **Fixed adapter.** `window.craftsuiteLayer` cannot be replaced, and only the first adapter
  registers.
- **A save counts as stored only on `ok: true`.** Any other `save-result` is a failure.
- **A stale save cannot become the reference.** A confirmed `document` save updates the record
  of the opened file only if that record still belongs to the save's `openId`, not after the host
  opened another file under the same name.
- **Nothing is lost.** A save the host does not confirm in time, or does not report as stored,
  becomes the browser download the app would have made anyway, typed `application/octet-stream`
  so that the browser keeps its name.

The translator tests (`tests/e2e/specs/translator.spec.ts`) check these rules in Chromium.
Firefox and WebKit run the scenarios that depend on how a browser behaves (tagged
`@cross-browser`): the handshake, the open and the saves with an allowed host, including messages
from another window of that origin; the fallback downloads and the names they keep; the inactive
translator at top level and under a host page on an origin that is not allowed, which sends
forged `init` and `open` messages (see [development.md](development.md#test-setup)); and the
reports of an app that fails to load.

### What the translator changes in the app's page

The core and the adapters replace a few browser functions in the Craft app's page. They do so
only inside a frame, with a valid allowlist, in a secure context: otherwise the core returns
before it changes anything, and the adapters do nothing without the core.

| Replaced | By | Acts | Effect |
|---|---|---|---|
| `EventTarget.prototype.addEventListener` | core | until the first `drop` listener, then restored | notes the element that gets it as the drop target; every listener is registered unchanged |
| `URL.createObjectURL`, `URL.revokeObjectURL` | core | always | keep the `Blob` behind each object URL until the URL is revoked; the URLs are unchanged |
| `HTMLAnchorElement.prototype.click` | core | after the handshake, for an `<a download>` whose `href` is a `blob:` URL of this page | the download becomes a `save` message; every other click is the native one |
| `window.open` | core | after the handshake | only `http`, `https`, `mailto`, `blob` and `about:blank` open (anything else returns `null`); the targets `_self`, `_top` and `_parent` become `_blank`; an `http` or `https` page of another origin gets `noopener` |
| the `files` getters of `DataTransfer.prototype` and `HTMLInputElement.prototype` | PhotoCraft adapter | during a trusted `drop`, and for `<input type=file>` | notes the stems of the file names; returns the same list |

The core also listens for `TrunkApplicationStarted`, the page's `load` event, and error events
and unhandled rejections before the app has started, and defines `window.craftsuiteLayer`, which
cannot be replaced. The other adapters replace nothing.

## What the host must do

These rules apply to any host; the Nextcloud app follows them ([nextcloud-app.md](nextcloud-app.md)):

- **Craft URL from server-side configuration only.** Never from the page URL or a query
  parameter; otherwise a crafted link could make the page send the user's file to any origin.
- **Check every message.** `event.source` is the iframe's `contentWindow`, `event.origin` is the
  configured Craft origin, and `protocol` and `version` match. Post with the configured origin as
  `targetOrigin`.
- **Treat `document` as a hint, not as permission to write anywhere.** Replace only the file the
  host itself opened under `openId` (by its own record, never by name), with a conditional WebDAV
  `PUT` (`If-Match` with the ETag last read or written). `412 Precondition Failed` is a conflict:
  keep the bytes and never force the write. A `document` under another name or file type than
  the opened file becomes a new file next to it; later saves of that open under that name may
  replace that new file, again conditionally. Never overwrite a file the host did not open or
  create itself.
- **Never overwrite with an `export`.** Exports become new files next to the original, under a
  free name.
- **Treat names as untrusted.** Check them against Nextcloud's rules before writing, even though
  the translator sanitises them.
- **Keep the user's work.** Report a save that could not be stored as failed, so the translator
  downloads it; store a conflict as a copy instead of forcing the write; warn before leaving
  while saves are pending (from `save-started` on), and ask on close (the app's unsaved changes
  are invisible to the host); let a pending save finish before the frame goes, because the frame
  holds its fallback.
- **Never let an older save replace a newer one.** Store saves in the order of their `id`; a
  `document` with a lower `id` than one already stored for the same open becomes a new file.
  A `document` with `follows` may replace only the file the host stored that export in, or
  the file it created for that lineage, and goes to a new file if it is older than one stored
  there already.
- **Hand files only to a page the user opened.** A page that hands the file to the frame as it
  loads must do so only when the user opened it there: with proof that another site cannot make,
  such as the session's CSRF token, which only the host's own pages know and add on a user's
  click. Otherwise ask first. `Sec-Fetch-Site` alone is not enough: the host's own pages may
  navigate to it for a link another site opened, and so may a sign-in page.
- **Isolate the page.** Send `Cross-Origin-Opener-Policy: same-origin`, so that a window the
  frame opens cannot navigate the host's tab (Firefox allows that through `window.opener`).
  Delegate only what the apps use to the frame (`allow="clipboard-write"`).
- **Never frame the Craft apps on the Nextcloud origin.** Same-origin, the frame's sandbox would
  not separate the app's code from the user's session.
- **Frame only the Craft origin.** The editor page's Content-Security-Policy allows framing only
  the configured Craft origin (in Nextcloud with `addAllowedFrameDomain`, on the editor page
  only).

## What the Nextcloud app adds

- **No files shared without download permission.** Nextcloud lets such files be viewed, and with
  its default settings read through WebDAV, but a Craft app can save and export them. The editor
  page refuses them on the server (the share's `canDownload()`), and Files offers no entry for
  them, nor for files whose downloads are hidden.
- **Writes only where it may.** A `document` save replaces only a file in the editor's own map:
  at first the opened file, later a file the page created for that document; a save that
  `follows` an export replaces only the file that export became, or the file the page created
  for that lineage. Every replacement is conditional (`If-Match`); without a usable ETag the page
  writes a new file instead. A `document` save that arrives after a later one of the same open
  (or lineage) was stored becomes a new file. Every new file is written with
  `If-None-Match: *`, so a file the page did not create is never overwritten, not even one its
  folder listing missed. All reads and writes run as the logged-in user, so Nextcloud's
  permissions, locks and quota apply.
- **New names.** The page reduces every name the app sends to a base name without control
  characters and leading or trailing dots and spaces, replaces direction overrides and invisible
  format characters with `_`, replaces the characters Windows forbids (`<`, `>`, `:`, `"`, `|`,
  `?`, `*`) with `_` in new names, keeps new names within Nextcloud's 250 bytes, and picks a name
  that no file in the folder has in any letter case.
- **The Craft origin.** The address must be `https` (`http` only on `localhost`, `127.x.x.x` or
  `[::1]`), without user name, password or fragment. Its host must be a name of letters, digits,
  hyphens and dots (an international name in its `xn--` form, converted with PHP's `intl` when
  it is installed), a dotted IPv4 address, or an IPv6 address in brackets; the editor page's
  Content-Security-Policy names it in the form the browser uses, so nothing else (a `;`, a space)
  can reach that header. The host must differ from every host name Nextcloud answers on (its own
  address, the request's host, the `trusted_domains` entries as written), whatever the port,
  because cookies do not separate ports. A wildcard entry such as `*.example.com` is not
  expanded: it would also cover a separate Craft host such as `craft.example.com`, which
  [hosting.md](hosting.md) recommends; a Craft host that Nextcloud really serves shows as the
  request's host. It is checked when it is saved and on every open.
- **Who sets the address.** Only administrators: on the settings page, with a recent password
  confirmation, or with `occ`.
- **A page opened by a link asks first.** The editor page reads and frames the file at once only
  when the request carries the session's request token (`passesCSRFCheck()`, which also needs
  Nextcloud's SameSite=Strict cookie) or the browser reports `Sec-Fetch-Site: none` (a typed
  address, a bookmark, a link from outside the browser). Files' entry adds the token only while
  the page has transient user activation (`navigator.userActivation.isActive`): a click or key
  press, not Files' own opening of a `/f/<id>` or `?openfile=true` link. Every other request,
  same-origin ones and those from browsers without the header included, gets only "Open <file>
  in <app>?" with the button "Open in <app>", whose address carries the token; nothing is read or
  framed before. A sign-in on the way does not help another site: the token belongs to the session.
  The editor removes the token from the address bar with `history.replaceState`; the page sends
  `Referrer-Policy: no-referrer` (Nextcloud's default) and its frame `referrerpolicy="no-referrer"`,
  so it never reaches the Craft origin. Like Nextcloud's own logout link, the address with the
  token can appear in the web server's access log.
- **The page and the frame.** Every answer of the editor page, error pages included, carries
  `Cross-Origin-Opener-Policy: same-origin`. The frame is sandboxed with `allow-scripts
  allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox allow-forms
  allow-modals`, so without top navigation; it sends no referrer and is delegated only
  `clipboard-write`. It gets no `clipboard-read` (the apps paste from paste events; with it, the
  Craft origin could read the clipboard under Nextcloud's permission) and no full screen (no app
  uses it).

## What the hosting must do

Details in [hosting.md](hosting.md).

- **HTTPS.** The translator stays inactive outside a secure context.
- **`frame-ancestors` from the same allowlist.** Send
  `Content-Security-Policy: frame-ancestors <origins>` with the origins of
  `data-allowed-origins`. The translator already refuses other parents; the header also keeps
  other sites from framing the app at all, for example to trick users into actions inside it.
  A sign-in page in front of the apps needs it too.
- **Unmodified releases.** Verify each upstream release against its `SHA256SUMS.txt`, change
  nothing but the two script tags in `index.html`, and serve the Craft apps on an origin of their
  own.

## Native embedding APIs

Upstream proposals such as PhotoCraft's pull request #2263 enable an embedding API with
`?embed=<origin>` in the app URL. Its own documentation notes that this origin check cannot tell
a trusted embedder from any other site, because the embedding page names itself;
`frame-ancestors` on the hosting has to do that.

- The host must not enable such an API (for example by adding `?embed=`) while it relies on the
  translator: the frame would then answer two protocols with different trust rules.
- When an app ships a native API, the translator should stand down and the host should switch to
  the native API (planned; see [architecture.md](architecture.md#native-embedding-apis)).

## Known limits

| Limit | Consequence | Mitigation |
|---|---|---|
| The kind is derived from the name and the bytes the app produced, both of which an opened document can influence. | A save can be classified as `document` when it is not one, for example PdfCraft's Action Wizard on a signed PDF, or a DesignCraft document with the opened one's title (see the app pages in [`apps/`](apps/)). | The host writes only to the opened file or the file it created for it, with `If-Match`; Nextcloud's file versions (where enabled) keep the previous state. |
| The app exposes no unsaved changes. | The host cannot know whether closing loses work. | Always warn on close. |
| `delivered` does not mean the app could open the file. | A broken file shows an error only inside the app. | None in the protocol yet. |
| The host may finish storing after the translator gave up. | The file exists twice: stored and downloaded. | None needed; nothing is lost. |
| The upstream app sees the file it edits. | A compromised upstream release or hosting could leak the open file; not the Nextcloud session, and other files only after the user confirmed "Open <file> in <app>?" for them. | Limited: checksums protect the download, not against a compromised upstream; a delay before taking new releases gives time to notice problems; an editor page another site opens asks first. |
