<!--
  - SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Hosting the Craft apps with the translator

Building blocks for hosting the Craft web apps that Nextcloud can frame. The requirements
any hosting must meet are in [docs/hosting.md](../docs/hosting.md); this folder has tools for
them. No real domains or secrets: `cloud.example.com` stands for your Nextcloud.

| File | What it is | State |
|---|---|---|
| [`inject-translator.sh`](inject-translator.sh) | Adds the translator to an unpacked web build. A release updater calls it once per app and release. | done; CI runs ShellCheck and its tests |
| [`tests/inject-translator.test.sh`](tests/inject-translator.test.sh) | Its tests: `sh hosting/tests/inject-translator.test.sh [shell \| --busybox]` | done |
| [`nginx/craft-apps.conf.template`](nginx/craft-apps.conf.template) | nginx server with the headers from [docs/hosting.md](../docs/hosting.md#headers), one path per app | example, not tested in CI |
| [`compose.example.yaml`](compose.example.yaml) | The web server as a container (nginx, unprivileged, read-only) | example, not tested in CI |

Each release of this repository has these files, without the tests, together with the
translators in `craftsuite-layer-hosting-<version>.tar.gz` (see
[In a release updater](#in-a-release-updater)). The pages in `docs/` and the changelog that this
file links to are not in that archive; they are in the repository, at
`https://github.com/hozwei/nextcloud-craftsuite-layer/tree/v<version>`.

There is no release updater here yet: one that takes new upstream releases after a delay,
verifies them, injects the translator, compresses and switches versions in one step
([docs/hosting.md](../docs/hosting.md#updates)) is up to the hosting for now.

## inject-translator.sh

```sh
sh hosting/inject-translator.sh --allowed-origins "https://cloud.example.com" \
  --app pdfcraft --app-version 0.5.0 /srv/craft/releases/pdfcraft-web-0.5.0
```

What it does with the folder (the one that holds the app's `index.html`):

1. Copies `translators/core.js` and `translators/<app>.js` into `craftsuite-layer/` in the folder.
2. Inserts the two script tags on a line of their own directly after the first real `<head>` tag
   of `index.html`: not one inside an HTML comment, not `<header>`, in any case, with or without
   attributes. Nothing else in the file changes, so the integrity attributes of the app's own
   files stay valid.
3. Writes `data-allowed-origins`, `data-app-version` and, with `--startup-timeout`,
   `data-startup-timeout` on the `core.js` tag, and a checksum of each translator file into its
   URL (`core.js?v=<checksum>`), so that a cache which keeps `*.js` for a year (as most upstream
   `_headers` files ask for) still loads a new translator. The
   checksum comes from `cksum` (`<CRC>-<size>`); where `cksum` is missing, as in some BusyBox
   builds, from `sha256sum` or else `md5sum` (the first 16 hex digits).
4. Replaces a service worker at the folder's root, `sw.js` (EffectCraft ships one), with a worker
   that serves nothing: no `fetch` handler, so the browser loads everything from the server; on
   activation it deletes the caches named after the app (`<app>-*`), takes over the open pages and
   unregisters itself. The app's own worker would answer from its cache, so a changed
   `index.html` or translator would reach browsers that have it only with the app's next release
   ([docs/hosting.md](../docs/hosting.md#service-workers)). The original stays as
   `craftsuite-layer/sw.js.orig`. The app then no longer starts offline from the hosting.

```html
<head>
  <script src="./craftsuite-layer/core.js?v=770821886-21573" data-allowed-origins="https://cloud.example.com" data-app-version="0.6.0"></script><script src="./craftsuite-layer/photocraft.js?v=2300969516-8791"></script>
  <meta charset="utf-8">
```

| Option | Meaning |
|---|---|
| `-o`, `--allowed-origins` | The Nextcloud origins allowed to frame the app, separated by spaces. Default: `$CRAFTSUITE_ALLOWED_ORIGINS`. |
| `-a`, `--app` | The app id, such as `pdfcraft`: its adapter is `translators/<app>.js`. The apps the layer has adapters for are in `apps.json` ([docs/hosting.md](../docs/hosting.md#the-app-list)). Default: from a folder named `<app>-web-<version>`, as in the upstream archives. |
| `-V`, `--app-version` | The version served, reported to Nextcloud in `ready`. Default: from the folder name. |
| `--startup-timeout` | Milliseconds (1 to 2147483647) after the page's `load` event for the app to start, written as `data-startup-timeout`; without it the translator's default of 60000 applies. 180000 for LightCraft and EffectCraft, see below. |
| `-t`, `--translators` | Folder with `core.js` and the adapters. Default: `$CRAFTSUITE_TRANSLATORS`, else `../translators` next to the script. |
| `-c`, `--check` | Change nothing; exit 0 if the folder is up to date, 1 if not. For monitoring. |
| `-r`, `--remove` | Remove the tags again and put back the app's own `sw.js` from `craftsuite-layer/sw.js.orig`; the app then works as without the layer. `craftsuite-layer/` stays in place. On a folder not named `<app>-web-<version>` (a served `www/<app>`, for example), give `--app` too; the version is not needed. |
| `-q`, `--quiet` | No message on success. |
| `-h`, `--help` | The options and exit codes. |

**Allowed origins** follow the translator's rule
([translators/README.md](../translators/README.md#configuration)): `https://host[:port]`, or
`http://` on `localhost`, `127.x.x.x` or `[::1]` for tests; no path (a Nextcloud under
`/nextcloud` is listed by its origin), no query, user name or wildcard; international domain
names in their `xn--` form. Write IPv6 addresses in their shortest form (`[2001:db8::1]`): the
script lowercases them but does not shorten them. It refuses everything else instead of passing
it on, and writes the origins normalised: `HTTPS://Cloud.Example.com:443/`
becomes `https://cloud.example.com`. Separate them with spaces: the same list goes into the web
server's `frame-ancestors`, where commas are not allowed (the script accepts commas, with a
warning).

**Startup timeout.** FilmCraft, LightCraft and EffectCraft fetch their large `.wasm` (LightCraft
also a 16 MB font) from a module script, which does not hold back the page's `load` event, so the
translator's startup timer (60 s from `load`) runs during the download. On a slow first load the
host then reports `the app did not start in time` for an app that is still loading, and `ready`
once it has started. Pass `--startup-timeout 180000` for `lightcraft` and `effectcraft`; FilmCraft
needs it only when its `.wasm` is served uncompressed or for users on slow connections
([docs/hosting.md](../docs/hosting.md#startup-timeout)). The script has no per-app defaults.

**Run again**, the script changes nothing and says `already up to date`. With other origins,
another version, another startup timeout or other translator files it replaces its own tags and
files. It writes the whole block each time, so pass the same `--startup-timeout` on every run,
`--check` included: without it, the attribute is removed (and `--check` exits 1). It refuses to
touch `craftsuite-layer` tags it did not write. A `sw.js` that is the app's own again (a release
unpacked over the folder) is replaced again, and the new original kept.

**Precompressed files.** If the folder already has `index.html.gz`, `sw.js.gz` or
`craftsuite-layer/*.js.gz` (for nginx `gzip_static`), the script writes them again for the files
it changed and removes `.br` files, which it cannot write. It is simpler to compress after
injecting.

**Exit codes**, for an updater's log and decisions:

| Code | Meaning | What an updater should do |
|---|---|---|
| 0 | Done, or already up to date | Go on: compress, switch to the new version. |
| 1 | `--check` only: not up to date | Run without `--check`. |
| 2 | Usage error or invalid setting (origin, app id, version, startup timeout) | Fix the configuration. Keep the current version. |
| 3 | Missing or unusable input: folder, `index.html`, `craftsuite-layer/`, `core.js` (a wrong `--translators` or `$CRAFTSUITE_TRANSLATORS`), an unreadable adapter, a `sw.js` that is not a regular file; no working `cksum`, `sha256sum` or `md5sum` | Fix the setup. Keep the current version. |
| 4 | `index.html` cannot take the tags: no `<head>`, or `craftsuite-layer` tags the script did not write | The release changed its layout. Keep the current version and report it. |
| 5 | Writing failed (permissions, disk space) | Keep the current version. |
| 6 | `no adapter for <app>`: this version of the layer does not support the app | The app can be served without the layer (it works, but Nextcloud cannot open files in it), or keep the current version until there is an adapter. |

Errors and warnings go to stderr, everything else to stdout, one line each, starting with
`inject-translator:`.

The script needs only POSIX `sh` and `awk` and a few standard tools: `cat`, `chmod`, `cmp`, `cp`,
`mkdir`, `mv`, `rm`, `tail`, `tr`, `wc`, one of `cksum`, `sha256sum` and `md5sum`, and `gzip` for
precompressed files. CI runs ShellCheck on it and its tests under dash, `bash --posix` and
BusyBox sh with BusyBox's tools (`--busybox`), on made-up pages and on the web builds of all
apps that `npm run craft:fetch` fetched, in the versions `tested` in `apps.json` (EffectCraft's
with its service worker).

### In a release updater

The updater takes this script and the translators from the hosting bundle of one release of this
repository, pinned in its configuration, and moves to a newer one deliberately, after reading the
[changelog](../CHANGELOG.md). The bundle and the release's `SHA256SUMS` are plain downloads, no
GitHub API:

```sh
# Once per layer version: the bundle unpacks to craftsuite-layer-hosting-<version>/, with
# hosting/ and translators/ side by side, so the script finds the translators by itself, and
# apps.json, the apps this release supports (docs/hosting.md#the-app-list).
layer_version=0.5.2
base=https://github.com/hozwei/nextcloud-craftsuite-layer/releases/download/v$layer_version
cd /opt
curl -fL --remote-name-all "$base/craftsuite-layer-hosting-$layer_version.tar.gz" "$base/SHA256SUMS"
grep "  craftsuite-layer-hosting-$layer_version.tar.gz\$" SHA256SUMS | sha256sum -c -
tar -xzf "craftsuite-layer-hosting-$layer_version.tar.gz"
layer=/opt/craftsuite-layer-hosting-$layer_version
```

The `grep` picks the bundle's line from `SHA256SUMS`, which also lists the Nextcloud app; it
works with BusyBox's `sha256sum` too, which has no `--ignore-missing`.

For each new Craft app release the order matters: verify, unpack, remove what must not be
served, inject, compress, switch.

```sh
# The archive's checksum is verified and it is unpacked to "$dir", which is not served yet.
# LightCraft's release also holds the leftovers of its Cargo build (docs/hosting.md#files-to-serve).
if [ "$app" = lightcraft ]; then
  rm -rf "$dir/build" "$dir/deps" "$dir/incremental" "$dir/examples" "$dir/.fingerprint" \
    "$dir/.cargo-lock" "$dir/.cargo-artifact-lock" "$dir/.cargo-build-lock"
fi
# The startup timeout of each app, from the updater's configuration; the same on every run
# (docs/hosting.md#startup-timeout). "$layer/apps.json" recommends one per app (startupTimeout).
case $app in
  lightcraft | effectcraft) startup=180000 ;;
  *) startup= ;;
esac
if sh "$layer/hosting/inject-translator.sh" -q \
     --app "$app" --app-version "$version" ${startup:+"--startup-timeout=$startup"} "$dir"; then
  :
else
  rc=$?
  if [ "$rc" -eq 6 ]; then   # no adapter for this app; any other code keeps the current version
    echo "$app $version: served without the Nextcloud integration" >&2
  else
    echo "$app $version: not switched (inject-translator.sh exit code $rc)" >&2
    exit 1   # keep serving the previous version
  fi
fi
find "$dir" -type f \( -name '*.wasm' -o -name '*.js' -o -name '*.html' -o -name '*.otf' \) \
  -exec gzip -9 -k -f {} \;
# Then switch to "$dir" in one step (rename a symbolic link) and keep the previous version.
```

`CRAFTSUITE_ALLOWED_ORIGINS` is set in the updater's environment. Running the script of a newer
layer version on the Craft app version being served updates the translator without a new Craft
app release; browsers get it on their next load.

To take the layer out of a served app again, run `--remove` on its folder, with `--app` where the
folder is not named `<app>-web-<version>` (it writes the `.gz` copies of the files it changes
again, as on an injection):

```sh
sh "$layer/hosting/inject-translator.sh" --remove --app pdfcraft /srv/craft/www/pdfcraft
```

## nginx

[`nginx/craft-apps.conf.template`](nginx/craft-apps.conf.template) serves `/srv/craft/<app>/`
with:

- `Content-Security-Policy: frame-ancestors` from `CRAFTSUITE_ALLOWED_ORIGINS`, the same variable
  the injector reads, on every response;
- `public, max-age=31536000, immutable` only for `*.js` and `*.wasm` whose names end in Trunk's
  content hash (`-[0-9a-f]{8,16}(_bg)?\.(js|wasm)$`, such as
  `pdfcraft-web-9fbc20856b2df0f8_bg.wasm`), `Cache-Control: no-cache` for everything else:
  `index.html`, `sw.js`, `craftsuite-layer/`, and the JavaScript and WebAssembly of FilmCraft,
  LightCraft and EffectCraft, whose names stay the same from one release to the next
  (`effectcraft_web.js`, `worker.js`, ...). An `immutable` cache would keep their old versions
  for a year after an update under the same `/<app>/` path
  ([docs/hosting.md](../docs/hosting.md#caching));
- `application/wasm` for `.wasm` (from nginx's `mime.types`), `font/ttf` and `font/otf` for
  fonts, `text/javascript` for `.mjs`, and `charset=utf-8` for HTML;
- `gzip_static` for the files the updater compressed, gzip on the fly for the rest;
- `X-Content-Type-Options: nosniff`, no `X-Frame-Options`, 404 for hidden files.

A `location` with its own `add_header` lines drops those of the outer blocks, so each location
repeats them. Behind a sign-in, use `private` instead of `public` in `Cache-Control`. The
template serves every file in an app's folder: remove LightCraft's Cargo leftovers first
(see [In a release updater](#in-a-release-updater)). nginx 1.26 and 1.30 accept it
(`nginx -t`); it is not tested in CI.

## Compose

[`compose.example.yaml`](compose.example.yaml) runs the template with
`nginxinc/nginx-unprivileged`, whose entrypoint fills in `CRAFTSUITE_ALLOWED_ORIGINS`. It serves
`www/<app>/` next to the Compose file at `/<app>/`, on `127.0.0.1:8080`. In the unpacked bundle,
with `pdfcraft-web-0.6.0/` injected next to the bundle as in the repository's README:

```sh
cd craftsuite-layer-hosting-0.5.2/hosting
cp compose.example.yaml compose.yaml
mkdir -p www/releases
mv ../../pdfcraft-web-0.6.0 www/releases/
ln -s releases/pdfcraft-web-0.6.0 www/pdfcraft   # relative, so it resolves in the container
echo 'CRAFTSUITE_ALLOWED_ORIGINS=https://cloud.example.com' > .env
docker compose up -d
curl -sI http://127.0.0.1:8080/pdfcraft/ | grep -i -e content-security-policy -e cache-control
```

A reverse proxy with TLS forwards `https://craft.example.com/` to `http://127.0.0.1:8080/` and
adds no `X-Frame-Options`. The updater is your own.

## A sign-in in front of the apps

The site that hosts the apps may let only signed-in users reach them, for example with a reverse proxy that asks
for a sign-in (with Nextcloud or another identity provider). The Nextcloud editor page frames the
app, so the sign-in's session cookie must reach the app inside the frame. In short (details in
[docs/hosting.md](../docs/hosting.md#a-sign-in-in-front-of-the-apps)):

- **Same site.** Put the apps on a host name under the same registrable domain as Nextcloud
  (`craft.example.com` next to `cloud.example.com`): then a `SameSite=Lax` cookie is sent in the
  frame. On another site (`craft.example.org`) the cookie needs `SameSite=None; Secure`, and
  browsers that block or partition third-party cookies (Safari and Firefox by default) still do
  not send it.
- **Sign in in a tab of its own.** The editor page allows the Craft origin and Nextcloud's own in
  its frame, so a sign-in that redirects to an identity provider on another origin is blocked
  inside the frame. When the editor shows its hint, users open the app in a new tab with its
  link, sign in there and reload the editor page; a long sign-in session helps. With Nextcloud
  itself as the identity provider (its `oidc` app), the sign-in passes inside the frame.
- **`frame-ancestors` on the sign-in page too**, with the Nextcloud origins or `'none'`, so that
  no other site can frame it.
