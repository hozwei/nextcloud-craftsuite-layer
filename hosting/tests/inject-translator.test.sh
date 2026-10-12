#!/bin/sh
# SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for hosting/inject-translator.sh, on small made-up index.html files and, if
# `npm run craft:fetch` has run, on the fetched Craft web builds (.craft-builds/selected.json).
#
#   sh hosting/tests/inject-translator.test.sh                 the script under sh
#   sh hosting/tests/inject-translator.test.sh dash            ... under another shell
#   sh hosting/tests/inject-translator.test.sh --busybox       ... under BusyBox sh, with BusyBox
#                                                              awk, cp, cksum, gzip and so on
# Works in a temporary folder and removes it. Exit code 0 if every check passed.

# The checks are strings evaluated later, so their variables stay unexpanded on purpose.
# shellcheck disable=SC2016,SC2034
set -u
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
inj=$repo/hosting/inject-translator.sh
sut=${1:-sh}
shim=
work=$(mktemp -d "${TMPDIR:-/tmp}/inject-translator-test.XXXXXX") || exit 2
trap 'chmod -R u+w "$work" 2>/dev/null; rm -rf "$work"' EXIT
if [ "$sut" = --busybox ]; then
  bb=$(command -v busybox) || { echo "busybox not found" >&2; exit 2; }
  shim=$work/.busybox
  mkdir "$shim"
  for t in awk cat chmod cksum cmp cp gzip mkdir mv rm tail tr wc; do ln -s "$bb" "$shim/$t"; done
  sut="$bb sh"
fi

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ko() { fail=$((fail + 1)); printf 'FAIL %s\n' "$*"; }
check() { if eval "$2"; then ok; else ko "$1"; fi; }
# run EXPECTED_EXIT_CODE DESCRIPTION ARGS...
run() {
  want=$1
  what=$2
  shift 2
  # shellcheck disable=SC2086 # $sut may be "busybox sh"
  PATH=${shim:+$shim:}$PATH $sut "$inj" "$@" >"$work/out" 2>"$work/err"
  got=$?
  if [ "$got" = "$want" ]; then ok; else
    ko "$what: exit code $got, expected $want"
    sed 's/^/    | /' "$work/out" "$work/err"
  fi
}
mk() { mkdir -p "$work/$1" && printf '%s' "$2" >"$work/$1/index.html"; }
O=https://cloud.example.com

# --- Real builds ------------------------------------------------------------------------------
builds=$repo/.craft-builds
if [ -f "$builds/selected.json" ]; then
  skipped=
  for app in pdfcraft photocraft vectorcraft designcraft wordcraft gridcraft deckcraft cadcraft \
    lightcraft filmcraft effectcraft; do
    ver=$(sed -n "s/.*\"$app\": *\"\([^\"]*\)\".*/\1/p" "$builds/selected.json")
    src=$builds/$app/$ver/$app-web-$ver
    if [ -z "$ver" ] || [ ! -f "$src/index.html" ] || [ ! -f "$repo/translators/$app.js" ]; then
      skipped="$skipped $app"
      continue
    fi
    d=$work/$app-web-$ver
    mkdir "$d" && cp "$src/index.html" "$d/" && cp "$src/index.html" "$work/$app.orig"
    # A service worker at the build's root (EffectCraft's sw.js) is replaced, see below.
    sw=0
    if [ -f "$src/sw.js" ]; then sw=1 && cp "$src/sw.js" "$d/" && cp "$src/sw.js" "$work/$app.sw"; fi
    run 1 "$app: --check before" --check -o "$O" "$d"
    run 0 "$app: inject" -o "$O" "$d"
    check "$app: one line added" '[ "$(diff "$work/$app.orig" "$d/index.html" | grep -c "^[<>]")" = 1 ]'
    [ "$sw" = 0 ] || check "$app: sw.js replaced, the original kept" '! grep -q fetch "$d/sw.js" && grep -q "registration.unregister()" "$d/sw.js" && cmp -s "$work/$app.sw" "$d/craftsuite-layer/sw.js.orig"'
    check "$app: tags right after <head>" 'grep -A1 -i -m1 "<head[ >]" "$d/index.html" | tail -n 1 | grep -q "^ *<script src=\"./craftsuite-layer/core.js?v=[0-9a-f][0-9a-f-]*\" data-allowed-origins=\"$O\" data-app-version=\"$ver\"></script><script src=\"./craftsuite-layer/$app.js?v=[0-9a-f][0-9a-f-]*\"></script>$"'
    check "$app: translator files" 'cmp -s "$repo/translators/core.js" "$d/craftsuite-layer/core.js" && cmp -s "$repo/translators/$app.js" "$d/craftsuite-layer/$app.js"'
    cp "$d/index.html" "$work/$app.injected"
    run 0 "$app: again" -o "$O" "$d"
    check "$app: again changes nothing" 'grep -q "already up to date" "$work/out" && cmp -s "$work/$app.injected" "$d/index.html"'
    run 0 "$app: --check after" --check -o "$O" "$d"
    run 0 "$app: other origins" -o "$O https://other.example.org:8443" "$d"
    check "$app: still one block" '[ "$(grep -c craftsuite-layer/ "$d/index.html")" = 1 ] && grep -q "data-allowed-origins=\"$O https://other.example.org:8443\"" "$d/index.html"'
    run 1 "$app: --check with the old origins" --check -o "$O" "$d"
    run 0 "$app: --remove" --remove "$d"
    check "$app: --remove restores the upstream file" 'cmp -s "$work/$app.orig" "$d/index.html"'
    [ "$sw" = 0 ] || check "$app: --remove restores the upstream sw.js" 'cmp -s "$work/$app.sw" "$d/sw.js" && [ ! -e "$d/craftsuite-layer/sw.js.orig" ]'
    [ "$sw" = 1 ] || check "$app: no sw.js added" '[ ! -e "$d/sw.js" ]'
  done
  [ -z "$skipped" ] || echo "note: no fetched build or no adapter, not tested on a real build:$skipped"
else
  echo "note: no fetched Craft builds (npm run craft:fetch); testing made-up files only"
fi

# --- Allowed origins --------------------------------------------------------------------------
mk pdfcraft-web-1.0.0 '<!doctype html>
<html>
<head>
  <title>x</title>
</head>
</html>
'
d=$work/pdfcraft-web-1.0.0
for bad in http://cloud.example.com https://cloud.example.com/nextcloud 'https://*.example.com' \
  https://user@cloud.example.com ftp://cloud.example.com 'https://cloud.example.com?a=1' \
  'https://cloud.example.com#a' https://1.2.3 https://0x7f.0.0.1 https://cloud.example.com:99999 \
  https://cloud.example.com:0 https://-a.example.com https://a..example.com https://a.example.com. \
  cloud.example.com https:// http://127.0.0.1.example.com 'https://a"b.example.com' http://192.0.2.10 \
  'https://b\a.example.com' 'https://bücher.example'; do
  run 2 "rejects $bad" -o "$bad" "$d"
done
norm() {
  run 0 "accepts $1" -o "$1" "$d"
  expected=$2
  check "normalises $1 to $2" 'grep -qF "data-allowed-origins=\"$expected\"" "$d/index.html"'
}
norm HTTPS://Cloud.Example.COM:443/ https://cloud.example.com
norm http://localhost:8080 http://localhost:8080
norm http://127.0.0.1:80/ http://127.0.0.1
norm 'https://[::1]:8443' 'https://[::1]:8443'
norm https://cloud.example.com:08443 https://cloud.example.com:8443
norm https://xn--bcher-kva.example https://xn--bcher-kva.example
norm ' https://a.example.com  https://b.example.com https://a.example.com ' 'https://a.example.com https://b.example.com'
norm https://a.example.com,https://b.example.com 'https://a.example.com https://b.example.com'
check "warns about commas" 'grep -q "separate the allowed origins with spaces" "$work/err"'
CRAFTSUITE_ALLOWED_ORIGINS=https://env.example.com
export CRAFTSUITE_ALLOWED_ORIGINS
run 0 "origins from the environment" "$d"
check "origins from the environment written" 'grep -q "data-allowed-origins=\"https://env.example.com\"" "$d/index.html"'
unset CRAFTSUITE_ALLOWED_ORIGINS
run 2 "no origins" "$d"

# --- Usage and inputs -------------------------------------------------------------------------
run 0 "--help" --help
run 2 "no folder" -o "$O"
run 2 "two folders" -o "$O" "$d" "$d"
run 2 "unknown option" -o "$O" --nope "$d"
run 2 "option without value" "$d" -o
run 2 "invalid app id" -o "$O" --app 'a;b' "$d"
run 2 "invalid version" -o "$O" --app-version '1"' "$d"
run 2 "--startup-timeout without a value" -o "$O" --startup-timeout
check "... says so" 'grep -q "needs a value" "$work/err"'
mk plain '<html><head></head></html>'
run 2 "no app id from the folder name" -o "$O" "$work/plain"
run 2 "no version from the folder name" -o "$O" --app pdfcraft "$work/plain"
run 0 "--app and --app-version" -o "$O" --app pdfcraft --app-version 2.0.0 "$work/plain"
check "head on the same line as other tags" 'grep -q "^  <script src=\"./craftsuite-layer/core.js" "$work/plain/index.html" && head -n 1 "$work/plain/index.html" | grep -q "^<html><head>\$"'
run 0 "folder with a trailing slash" -o "$O" "$d/"
run 0 "--app that differs from the folder name" -o "$O" --app photocraft --app-version 1.0.0 "$d"
check "... warns" 'grep -q "named after pdfcraft" "$work/err"'
run 3 "no such folder" -o "$O" "$work/nothing-web-1.0.0"
mkdir -p "$work/pdfcraft-web-3.0.0"
run 3 "no index.html" -o "$O" "$work/pdfcraft-web-3.0.0"
mk unknownapp-web-1.0.0 '<html><head></head></html>'
run 6 "no adapter for the app" -o "$O" "$work/unknownapp-web-1.0.0"
check "... says so" 'grep -q "no adapter for unknownapp" "$work/err"'
run 3 "no core.js in --translators" -o "$O" -t "$work" "$d"
check "... is not 'no adapter'" '! grep -q "no adapter" "$work/err"'
mkdir "$work/tr-dir" && cp "$repo/translators/core.js" "$work/tr-dir/" && mkdir "$work/tr-dir/pdfcraft.js"
run 3 "an adapter that is not a file" -o "$O" -t "$work/tr-dir" "$d"
mk pdfcraft-web-4.0.0 '<html><head></head></html>'
ln -s "$work" "$work/pdfcraft-web-4.0.0/craftsuite-layer"
run 3 "craftsuite-layer is a symbolic link" -o "$O" "$work/pdfcraft-web-4.0.0"
mkdir -p "$work/pdfcraft-web-4.1.0"
ln -s "$work/plain/index.html" "$work/pdfcraft-web-4.1.0/index.html"
run 3 "index.html is a symbolic link" -o "$O" "$work/pdfcraft-web-4.1.0"

# --- Shapes of index.html ---------------------------------------------------------------------
mk pdfcraft-web-5.0.0 '<!doctype html><!-- <head> --><html><!--
<head>
--><HEAD lang="en"><header>x</header>
<meta charset="utf-8"></head></html>'
run 0 "skips comments and <header>, takes <HEAD lang>" -o "$O" "$work/pdfcraft-web-5.0.0"
check "... inserted there" 'sed -n 3p "$work/pdfcraft-web-5.0.0/index.html" | grep -q "<HEAD lang=\"en\">\$" && sed -n 4p "$work/pdfcraft-web-5.0.0/index.html" | grep -q "^  <script src=\"./craftsuite-layer/core.js"'
mk pdfcraft-web-5.1.0 '<html><!-- <head> --><header></header><body></body></html>'
run 4 "no <head> outside comments" -o "$O" "$work/pdfcraft-web-5.1.0"
mk pdfcraft-web-5.2.0 '<html><!-- <head> unterminated'
run 4 "<head> in an unterminated comment" -o "$O" "$work/pdfcraft-web-5.2.0"
mk pdfcraft-web-5.3.0 ''
run 4 "empty index.html" -o "$O" "$work/pdfcraft-web-5.3.0"
mk pdfcraft-web-5.4.0 '<html><head>
<script src="./craftsuite-layer/core.js" data-allowed-origins="https://x.example.com"></script>
</head></html>
'
run 4 "craftsuite-layer tags written by hand" -o "$O" "$work/pdfcraft-web-5.4.0"
mk pdfcraft-web-5.5.0 '<html><head><!-- craftsuite-layer/ -->
</head></html>
'
run 0 "craftsuite-layer/ in a comment" -o "$O" "$work/pdfcraft-web-5.5.0"
mkdir -p "$work/pdfcraft-web-6.0.0"
printf '<!DOCTYPE html>\r\n<html>\r\n<head>\r\n    <meta charset="utf-8">\r\n</head>\r\n</html>' >"$work/crlf.orig"
cp "$work/crlf.orig" "$work/pdfcraft-web-6.0.0/index.html"
run 0 "CRLF without a final line break" -o "$O" "$work/pdfcraft-web-6.0.0"
check "... keeps CRLF and indentation" 'awk "NR == 4 { found = 1; exit !(\$0 ~ /^    <script src=.*<.script>\r\$/) } END { if (!found) exit 1 }" "$work/pdfcraft-web-6.0.0/index.html"'
check "... adds no final line break" '[ "$(tail -c 1 "$work/pdfcraft-web-6.0.0/index.html")" = ">" ]'
run 0 "CRLF, --remove" --remove "$work/pdfcraft-web-6.0.0"
check "... restores the file" 'cmp -s "$work/crlf.orig" "$work/pdfcraft-web-6.0.0/index.html"'

# --- Precompressed files, file modes, new translator files ------------------------------------
mk pdfcraft-web-7.0.0 '<html><head>
</head></html>
'
g=$work/pdfcraft-web-7.0.0
gzip -9 -c "$g/index.html" >"$g/index.html.gz"
echo old >"$g/index.html.br"
chmod 640 "$g/index.html"
run 0 "with index.html.gz and .br" -o "$O" "$g"
check "... writes index.html.gz again" 'gzip -dc "$g/index.html.gz" | cmp -s - "$g/index.html"'
check "... removes index.html.br" '[ ! -e "$g/index.html.br" ] && grep -q "index.html.br" "$work/err"'
check "... keeps the mode of index.html" '[ "$(ls -l "$g/index.html" | cut -c1-10)" = "-rw-r-----" ]'
check "... translator files readable" '[ "$(ls -l "$g/craftsuite-layer/core.js" | cut -c1-10)" = "-rw-r--r--" ]'
gzip -9 -c "$g/craftsuite-layer/core.js" >"$g/craftsuite-layer/core.js.gz"
mkdir "$work/tr" && cp "$repo/translators/core.js" "$repo/translators/pdfcraft.js" "$work/tr/" && echo '// new' >>"$work/tr/core.js"
before=$(grep -o 'core.js?v=[0-9a-f-]*' "$g/index.html")
run 1 "--check sees new translator files" --check -o "$O" -t "$work/tr" "$g"
run 0 "new translator files" -o "$O" -t "$work/tr" "$g"
check "... copied, and core.js.gz written again" 'cmp -s "$work/tr/core.js" "$g/craftsuite-layer/core.js" && gzip -dc "$g/craftsuite-layer/core.js.gz" | cmp -s - "$work/tr/core.js"'
check "... new checksum in the URL" '[ -n "${before#core.js?v=}" ] && [ "$(grep -o "core.js?v=[0-9a-f-]*" "$g/index.html")" != "$before" ]'
check "no temporary files left" '[ -z "$(find "$work" -name "*.craftsuite-*")" ]'
if [ "$(id -u)" != 0 ]; then
  mk pdfcraft-web-8.0.0 '<html><head></head></html>'
  chmod a-w "$work/pdfcraft-web-8.0.0"
  run 5 "read-only folder" -o "$O" "$work/pdfcraft-web-8.0.0"
fi

# --- Startup timeout --------------------------------------------------------------------------
# --startup-timeout writes data-startup-timeout on the core.js tag. It is part of the block: a run
# without it, or with another value, writes the block again.
mk pdfcraft-web-10.0.0 '<html><head>
</head></html>
'
s=$work/pdfcraft-web-10.0.0
cp "$s/index.html" "$work/st.orig"
run 0 "--startup-timeout: inject" -o "$O" --startup-timeout 180000 "$s"
check "... written on the core.js tag" 'grep -q "^<script src=\"./craftsuite-layer/core.js?v=[0-9a-f-]*\" data-allowed-origins=\"$O\" data-app-version=\"10.0.0\" data-startup-timeout=\"180000\"></script><script src=\"./craftsuite-layer/pdfcraft.js?v=[0-9a-f-]*\"></script>\$" "$s/index.html"'
check "... says so" 'grep -q "startup timeout: 180000 ms" "$work/out"'
cp "$s/index.html" "$work/st.injected"
run 0 "--startup-timeout: again" -o "$O" --startup-timeout=180000 "$s"
check "... changes nothing" 'grep -q "already up to date" "$work/out" && cmp -s "$work/st.injected" "$s/index.html"'
run 0 "--startup-timeout: --check with the same value" --check -o "$O" --startup-timeout 180000 "$s"
run 1 "--startup-timeout: --check with another value" --check -o "$O" --startup-timeout 120000 "$s"
check "... index.html is not up to date" 'grep -q "index.html is not up to date" "$work/out"'
run 1 "--startup-timeout: --check without it" --check -o "$O" "$s"
check "... changes nothing" 'cmp -s "$work/st.injected" "$s/index.html"'
run 0 "--startup-timeout: another value, with a leading zero" -o "$O" --startup-timeout 0120000 "$s"
check "... replaced, still one block, without the zero" '[ "$(grep -c craftsuite-layer/ "$s/index.html")" = 1 ] && grep -q "data-app-version=\"10.0.0\" data-startup-timeout=\"120000\"></script>" "$s/index.html"'
run 0 "--startup-timeout: a run without it" -o "$O" "$s"
check "... removes the attribute" '! grep -q data-startup-timeout "$s/index.html" && grep -q "data-app-version=\"10.0.0\"></script>" "$s/index.html"'
run 0 "--startup-timeout: the largest value" -o "$O" --startup-timeout 2147483647 "$s"
cp "$s/index.html" "$work/st.largest"
for bad in '' 0 000 -1 +5 1.5 1e5 ' 180000' 180000ms 2147483648 09999999999 99999999999999999999 x; do
  run 2 "--startup-timeout rejects '$bad'" -o "$O" --startup-timeout "$bad" "$s"
done
check "... with a message, leaving index.html alone" 'grep -q "invalid startup timeout" "$work/err" && cmp -s "$work/st.largest" "$s/index.html"'
run 0 "--startup-timeout: --remove" --remove "$s"
check "... restores the file" 'cmp -s "$work/st.orig" "$s/index.html"'

# --- Service worker ---------------------------------------------------------------------------
# A sw.js at the build's root (as EffectCraft ships one) would serve index.html and the translator
# from its cache: it is replaced by one without a fetch handler that removes itself.
mk pdfcraft-web-9.0.0 '<html><head>
</head></html>
'
w=$work/pdfcraft-web-9.0.0
echo 'self.addEventListener("fetch", (e) => e.respondWith(caches.match(e.request)));' >"$w/sw.js"
cp "$w/sw.js" "$work/sw.1"
chmod 640 "$w/sw.js"
gzip -9 -c "$w/sw.js" >"$w/sw.js.gz"
echo old >"$w/sw.js.br"
run 1 "sw.js: --check before" --check -o "$O" "$w"
check "... names the service worker" 'grep -q "sw.js is the app.s own service worker" "$work/out"'
run 0 "sw.js: inject" -o "$O" "$w"
check "... replaced: no fetch handler; deletes the app's caches, claims the pages, unregisters" '! grep -q fetch "$w/sw.js" && grep -q "caches.delete" "$w/sw.js" && grep -qF "n.startsWith('"'"'pdfcraft-'"'"')" "$w/sw.js" && grep -q "clients.claim()" "$w/sw.js" && grep -q "registration.unregister()" "$w/sw.js"'
check "... says so" 'grep -q "replaced the app.s service worker" "$work/out"'
check "... keeps the original, with its mode" 'cmp -s "$work/sw.1" "$w/craftsuite-layer/sw.js.orig" && [ "$(ls -l "$w/craftsuite-layer/sw.js.orig" | cut -c1-10)" = "-rw-r-----" ]'
check "... readable, sw.js.gz written again, sw.js.br removed" '[ "$(ls -l "$w/sw.js" | cut -c1-10)" = "-rw-r--r--" ] && gzip -dc "$w/sw.js.gz" | cmp -s - "$w/sw.js" && [ ! -e "$w/sw.js.br" ]'
cp "$w/sw.js" "$work/sw.ours"
run 0 "sw.js: again" -o "$O" "$w"
check "... changes nothing" 'grep -q "already up to date" "$work/out" && cmp -s "$work/sw.ours" "$w/sw.js" && cmp -s "$work/sw.1" "$w/craftsuite-layer/sw.js.orig"'
run 0 "sw.js: --check after" --check -o "$O" "$w"
echo '// changed by hand' >>"$w/sw.js"
run 1 "sw.js: --check sees a changed replacement" --check -o "$O" "$w"
check "... says so" 'grep -q "sw.js is not up to date" "$work/out"'
run 0 "sw.js: a changed replacement" -o "$O" "$w"
check "... written again, the original kept" 'cmp -s "$work/sw.ours" "$w/sw.js" && cmp -s "$work/sw.1" "$w/craftsuite-layer/sw.js.orig"'
echo 'self.addEventListener("fetch", () => {}); // 2' >"$w/sw.js"
cp "$w/sw.js" "$work/sw.2"
run 1 "sw.js: --check sees a new upstream sw.js" --check -o "$O" "$w"
run 0 "sw.js: a new upstream sw.js" -o "$O" "$w"
check "... replaced, the new one kept" 'cmp -s "$work/sw.ours" "$w/sw.js" && cmp -s "$work/sw.2" "$w/craftsuite-layer/sw.js.orig"'
run 0 "sw.js: --remove" --remove "$w"
check "... puts back the original" 'cmp -s "$work/sw.2" "$w/sw.js" && [ ! -e "$w/craftsuite-layer/sw.js.orig" ] && gzip -dc "$w/sw.js.gz" | cmp -s - "$w/sw.js" && grep -q "put back the app.s service worker" "$work/out"'
run 0 "sw.js: --remove again" --remove "$w"
check "... changes nothing" 'cmp -s "$work/sw.2" "$w/sw.js" && ! grep -q "put back" "$work/out"'
run 0 "sw.js: inject after --remove" -o "$O" "$w"
rm "$w/craftsuite-layer/sw.js.orig"
run 0 "sw.js: --remove without the original" --remove "$w"
check "... warns, and leaves the replacement" 'grep -q "no .*sw.js.orig to put back" "$work/err" && cmp -s "$work/sw.ours" "$w/sw.js"'
mk pdfcraft-web-9.1.0 '<html><head></head></html>'
ln -s "$work/sw.1" "$work/pdfcraft-web-9.1.0/sw.js"
run 3 "sw.js is a symbolic link" -o "$O" "$work/pdfcraft-web-9.1.0"
mk pdfcraft-web-9.2.0 '<html><head></head></html>'
mkdir "$work/pdfcraft-web-9.2.0/sw.js"
run 3 "sw.js is a folder" -o "$O" "$work/pdfcraft-web-9.2.0"
check "no temporary files left after the service worker" '[ -z "$(find "$work" -name "*.craftsuite-*")" ]'

printf '%s: %d checks passed, %d failed\n' "$sut" "$pass" "$fail"
[ "$fail" = 0 ]
