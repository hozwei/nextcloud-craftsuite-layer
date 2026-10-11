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
  for app in pdfcraft photocraft vectorcraft designcraft; do
    ver=$(sed -n "s/.*\"$app\": *\"\([^\"]*\)\".*/\1/p" "$builds/selected.json")
    src=$builds/$app/$ver/$app-web-$ver
    [ -n "$ver" ] && [ -f "$src/index.html" ] && [ -f "$repo/translators/$app.js" ] || continue
    d=$work/$app-web-$ver
    mkdir "$d" && cp "$src/index.html" "$d/" && cp "$src/index.html" "$work/$app.orig"
    run 1 "$app: --check before" --check -o "$O" "$d"
    run 0 "$app: inject" -o "$O" "$d"
    check "$app: one line added" '[ "$(diff "$work/$app.orig" "$d/index.html" | grep -c "^[<>]")" = 1 ]'
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
  done
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

printf '%s: %d checks passed, %d failed\n' "$sut" "$pass" "$fail"
[ "$fail" = 0 ]
