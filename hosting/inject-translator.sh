#!/bin/sh
# SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# inject-translator.sh: add the craftsuite-layer translator to an unpacked Craft web build.
#
# A release updater calls it once per app and release, after it has verified and unpacked the
# release and before it compresses the files and switches to the new version
# (docs/hosting.md#updates):
#
#   sh inject-translator.sh --allowed-origins "https://cloud.example.com" \
#     --app pdfcraft --app-version 0.5.0 /srv/craft/releases/pdfcraft-web-0.5.0
#
# It copies translators/core.js and translators/<app>.js into <folder>/craftsuite-layer/ and
# inserts their two script tags directly after the first real <head> tag of <folder>/index.html
# (not one inside an HTML comment, not <header>). A service worker at the build's root
# (<folder>/sw.js, as EffectCraft ships one) is replaced by one that serves nothing and removes
# itself; the original is kept as <folder>/craftsuite-layer/sw.js.orig. Run again, it changes
# nothing; with other origins, another version, another startup timeout or other translator
# files, it replaces its own tags and files.
# Plain POSIX sh and awk: runs with dash, BusyBox ash, bash and others. Run with --help for the
# options and exit codes.

set -u

me=inject-translator

usage() {
  cat <<'EOF'
Usage: inject-translator.sh [options] FOLDER

Adds the craftsuite-layer translator to the Craft web build in FOLDER (the folder that holds
index.html, such as pdfcraft-web-0.5.0/).

Options:
  -o, --allowed-origins LIST  Origins of the Nextcloud servers allowed to frame the app,
                              separated by spaces: https://host[:port], or http:// on
                              localhost, 127.x.x.x or [::1] for tests. No path, no wildcard.
                              Default: $CRAFTSUITE_ALLOWED_ORIGINS. Use the same list for the
                              web server's Content-Security-Policy frame-ancestors.
  -a, --app ID                The app id, such as pdfcraft; the adapter is ID.js in the
                              translators folder. Default: from a FOLDER named
                              <app>-web-<version>.
  -V, --app-version VERSION   Version being served, reported to Nextcloud.
                              Default: from a FOLDER named <app>-web-<version>.
      --startup-timeout MS    Write data-startup-timeout="MS" on the core.js tag: how many
                              milliseconds after the page's load event the app may take to
                              start before the host is told that it did not (the translator's
                              default is 60000). A whole number from 1 to 2147483647. Without
                              this option the tag gets no such attribute, so pass the same
                              value on every run, --check included. Recommended: 180000 for
                              lightcraft and effectcraft, whose large downloads do not hold
                              back the load event (see docs/hosting.md).
  -t, --translators DIR       Folder with core.js and <app>.js. Default: $CRAFTSUITE_TRANSLATORS,
                              else ../translators next to this script.
  -c, --check                 Change nothing. Exit 0 if FOLDER is up to date, 1 if not.
  -r, --remove                Remove the two script tags again and put back the app's own
                              service worker (the app then works as without the layer).
                              Leaves FOLDER/craftsuite-layer/ in place.
  -q, --quiet                 No message on success.
  -h, --help                  Show this help.

Exit codes:
  0  done, or already up to date
  1  --check: FOLDER is not up to date
  2  usage error or invalid setting (origin, app id, version, startup timeout)
  3  missing or unusable input: FOLDER, FOLDER/index.html, FOLDER/craftsuite-layer, core.js
     (see --translators), an unreadable adapter, a FOLDER/sw.js that is not a regular file, or
     no working cksum, sha256sum or md5sum
  4  index.html cannot take the tags: no <head> tag, or craftsuite-layer tags this script did
     not write
  5  writing failed (permissions, disk space)
  6  no adapter for this app in this version of the layer: the app can be served without the
     layer (it works, but Nextcloud cannot open files in it)

A release updater switches to the new release on 0, on 6 only if serving it without the layer
is acceptable, and keeps the current release on any other code.

Messages go to stderr for errors and warnings, to stdout otherwise, one line each, starting
with "inject-translator:".

A service worker that the build ships as FOLDER/sw.js would serve index.html and the translator
from its cache, so that changes to them reach browsers only with the app's next release. It is
replaced by one that serves nothing, deletes the app's caches and unregisters itself; the
original is kept as FOLDER/craftsuite-layer/sw.js.orig.
EOF
}

say() { [ "$quiet" = 1 ] || printf '%s: %s\n' "$me" "$*"; }
warn() { printf '%s: warning: %s\n' "$me" "$*" >&2; }
die() {
  code=$1
  shift
  printf '%s: error: %s\n' "$me" "$*" >&2
  exit "$code"
}

# --- Options ----------------------------------------------------------------------------------
app=
app_set=0
ver=
ver_set=0
startup=
startup_set=0
origins=${CRAFTSUITE_ALLOWED_ORIGINS-}
translators=${CRAFTSUITE_TRANSLATORS-}
mode=inject
quiet=0

need_value() { [ "$1" -ge 2 ] || die 2 "$2 needs a value (see --help)"; }
while [ $# -gt 0 ]; do
  case $1 in
    -o | --allowed-origins) need_value $# "$1"; origins=$2; shift 2 ;;
    --allowed-origins=*) origins=${1#*=}; shift ;;
    -a | --app) need_value $# "$1"; app=$2; app_set=1; shift 2 ;;
    --app=*) app=${1#*=}; app_set=1; shift ;;
    -V | --app-version) need_value $# "$1"; ver=$2; ver_set=1; shift 2 ;;
    --app-version=*) ver=${1#*=}; ver_set=1; shift ;;
    --startup-timeout) need_value $# "$1"; startup=$2; startup_set=1; shift 2 ;;
    --startup-timeout=*) startup=${1#*=}; startup_set=1; shift ;;
    -t | --translators) need_value $# "$1"; translators=$2; shift 2 ;;
    --translators=*) translators=${1#*=}; shift ;;
    -c | --check) mode=check; shift ;;
    -r | --remove) mode=remove; shift ;;
    -q | --quiet) quiet=1; shift ;;
    -h | --help) usage; exit 0 ;;
    --) shift; break ;;
    -?*) die 2 "unknown option $1 (see --help)" ;;
    *) break ;;
  esac
done
[ $# -eq 1 ] || die 2 "expected exactly one FOLDER (see --help)"
case $1 in
  '') die 2 "FOLDER is empty" ;;
  /) dir=/ ;;
  *) dir=${1%/} ;;
esac

# App id and version: given, or from the upstream folder name <app>-web-<version>.
base=${dir##*/}
from_app=
from_ver=
case $base in
  ?*-web-?*) from_app=${base%-web-*}; from_ver=${base##*-web-} ;;
esac
if [ "$app_set" = 0 ]; then
  app=$from_app
elif [ -n "$from_app" ] && [ "$from_app" != "$app" ]; then
  warn "FOLDER is named after $from_app, but --app is $app"
fi
if [ "$ver_set" = 0 ]; then
  ver=$from_ver
elif [ -n "$from_ver" ] && [ "$from_ver" != "$ver" ]; then
  warn "FOLDER is named after version $from_ver, but --app-version is $ver"
fi
case $app in
  '') die 2 "no app id: pass --app (FOLDER is not named <app>-web-<version>)" ;;
  -* | *[!a-z0-9_-]*) die 2 "invalid app id '$app': use lowercase letters, digits, - and _" ;;
esac
case $ver in
  '') [ "$mode" = remove ] || die 2 "no version: pass --app-version (FOLDER is not named <app>-web-<version>)" ;;
  [!0-9A-Za-z]* | *[!0-9A-Za-z.+-]*) die 2 "invalid version '$ver': use letters, digits, '.', '+' and '-'" ;;
esac
# Startup timeout: milliseconds, written without leading zeros. Browsers run a setTimeout of
# more than 2147483647 ms (2^31 - 1) at once, so that is the largest value.
if [ "$startup_set" = 1 ]; then
  bad_startup="invalid startup timeout '$startup': use milliseconds, a whole number from 1 to 2147483647, such as 180000"
  case $startup in
    '' | *[!0-9]*) die 2 "$bad_startup" ;;
  esac
  startup=${startup#"${startup%%[!0]*}"}
  if [ -z "$startup" ] || [ "${#startup}" -gt 10 ] || [ "$startup" -gt 2147483647 ]; then die 2 "$bad_startup"; fi
fi

# --- Allowed origins: the translator's rule (translators/README.md#configuration) -------------
# Normalised like the browser reports MessageEvent.origin: lowercase, no default port, no "/".
# Prints "ok <origins>" or one "bad <entry>" per invalid entry.
# shellcheck disable=SC2016 # awk program, not shell
normalise_origins='
function ipv4(h,    p, n, k) {
  n = split(h, p, ".")
  if (n != 4) return 0
  for (k = 1; k <= 4; k++) if (p[k] !~ /^(0|[1-9][0-9]*)$/ || p[k] + 0 > 255) return 0
  return 1
}
function norm(e,    s, scheme, rest, host, port, labels, n, j, last) {
  s = tolower(e)
  if (substr(s, 1, 8) == "https://") { scheme = "https"; rest = substr(s, 9) }
  else if (substr(s, 1, 7) == "http://") { scheme = "http"; rest = substr(s, 8) }
  else return ""
  if (substr(rest, length(rest)) == "/") rest = substr(rest, 1, length(rest) - 1)
  if (rest == "") return ""
  if (substr(rest, 1, 1) == "[") {
    j = index(rest, "]")
    if (j == 0) return ""
    host = substr(rest, 1, j)
    port = substr(rest, j + 1)
    if (host !~ /^[[][0-9a-f:.]+[]]$/) return ""
    if (port != "" && substr(port, 1, 1) != ":") return ""
  } else {
    j = index(rest, ":")
    if (j > 0) { host = substr(rest, 1, j - 1); port = substr(rest, j) } else { host = rest; port = "" }
    if (host !~ /^[a-z0-9.-]+$/) return ""
    n = split(host, labels, ".")
    for (j = 1; j <= n; j++) if (labels[j] !~ /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/) return ""
    last = labels[n]
    # Hosts that end in a number are IPv4 addresses to a browser: accept only the plain form.
    if ((last ~ /^[0-9]+$/ || last ~ /^0x/) && !ipv4(host)) return ""
  }
  if (port != "") {
    port = substr(port, 2)
    if (port !~ /^[0-9]+$/) return ""
    sub(/^0+/, "", port)
    if (port == "" || length(port) > 5 || port + 0 > 65535) return ""
    if ((scheme == "https" && port == "443") || (scheme == "http" && port == "80")) port = ""
  }
  if (scheme == "http" && host != "localhost" && host != "[::1]" && !(ipv4(host) && host ~ /^127[.]/)) return ""
  return scheme "://" host (port == "" ? "" : ":" port)
}
BEGIN {
  n = split(ENVIRON["CSL_ORIGINS"], list, "[ \t\r\n,]+")
  bad = 0; out = ""; count = 0
  for (i = 1; i <= n; i++) {
    if (list[i] == "") continue
    o = norm(list[i])
    if (o == "") { print "bad " list[i]; bad = 1; continue }
    if (!(o in seen)) { seen[o] = 1; out = out (count++ ? " " : "") o }
  }
  if (!bad) print "ok " out
}'

allowed=
if [ "$mode" != remove ]; then
  [ -n "$origins" ] || die 2 "no allowed origin: pass --allowed-origins or set CRAFTSUITE_ALLOWED_ORIGINS"
  case $origins in
    *,*) warn "separate the allowed origins with spaces: the same list goes into frame-ancestors, where commas are invalid" ;;
  esac
  result=$(CSL_ORIGINS=$origins awk "$normalise_origins" </dev/null) || die 2 "awk failed"
  bad=0
  while IFS= read -r line; do
    case $line in
      'ok '*) allowed=${line#ok } ;;
      'bad '*) printf '%s: error: invalid allowed origin %s: use https://host[:port] (http:// only on localhost, 127.x.x.x or [::1]); no path, query, user name or wildcard\n' "$me" "${line#bad }" >&2; bad=1 ;;
    esac
  done <<EOF
$result
EOF
  [ "$bad" = 0 ] || exit 2
  [ -n "$allowed" ] || die 2 "no allowed origin given"
fi

# --- Inputs -----------------------------------------------------------------------------------
[ -d "$dir" ] || die 3 "no such folder: $dir"
index=$dir/index.html
if [ ! -f "$index" ] || [ -h "$index" ]; then die 3 "$index is missing or not a regular file"; fi
[ -r "$index" ] || die 3 "cannot read $index"
layer=$dir/craftsuite-layer
if [ -e "$layer" ] || [ -h "$layer" ]; then
  if [ ! -d "$layer" ] || [ -h "$layer" ]; then die 3 "$layer exists but is not a folder"; fi
fi

# --- Service worker ---------------------------------------------------------------------------
# A service worker at the build's root (EffectCraft's sw.js) answers from its cache: index.html
# with the translator's tags, the translator files and their headers would stay as they were
# until the app's next release changes sw.js, also for frames that never register it themselves
# (a direct visit on the same site registers it for them). The replacement has no fetch handler,
# so the browser loads everything from the server again; on activation it deletes the app's
# caches (named after the app, as EffectCraft's effectcraft-<version>), takes over the open
# pages and unregisters itself. Its first line marks it as ours.
sw=$dir/sw.js
sw_orig=$layer/sw.js.orig
sw_first='// craftsuite-layer: inject-translator.sh wrote this in place of the service worker of the app.'
sw_replacement() {
  cat <<EOF
$sw_first
// The app's own worker answered from its cache, so a changed page or translator reached browsers
// only with the app's next release. This one answers nothing: on activation it deletes the app's
// caches, takes over the open pages (their requests go to the server again) and unregisters
// itself. The original is craftsuite-layer/sw.js.orig; inject-translator.sh --remove puts it back.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n === '$app' || n.startsWith('$app-')).map((n) => caches.delete(n)));
    } catch (e) { /* unregister all the same */ }
    try { await self.clients.claim(); } catch (e) { /* unregister all the same */ }
    await self.registration.unregister();
  })());
});
EOF
}
# none: no sw.js; current: ours as this version writes it; outdated: ours, other content; app:
# the app's own.
sw_state=none
if [ -e "$sw" ] || [ -h "$sw" ]; then
  if [ ! -f "$sw" ] || [ -h "$sw" ]; then die 3 "$sw exists but is not a regular file"; fi
  [ -r "$sw" ] || die 3 "cannot read $sw"
  first_line=
  IFS= read -r first_line <"$sw" || :
  if sw_replacement | cmp -s - "$sw"; then
    sw_state=current
  elif [ "$first_line" = "$sw_first" ]; then
    sw_state=outdated
  else
    sw_state=app
  fi
fi

if [ "$mode" != remove ]; then
  if [ -z "$translators" ]; then
    case $0 in
      */*) translators=${0%/*}/../translators ;;
      *) translators=../translators ;;
    esac
  fi
  if [ ! -f "$translators/core.js" ] || [ ! -r "$translators/core.js" ]; then
    die 3 "$translators/core.js not found: pass --translators"
  fi
  # Its own exit code: only this case lets an updater serve the release without the layer.
  [ -e "$translators/$app.js" ] || [ -h "$translators/$app.js" ] ||
    die 6 "no adapter for $app in this version of the layer ($translators/$app.js not found)"
  if [ ! -f "$translators/$app.js" ] || [ ! -r "$translators/$app.js" ]; then
    die 3 "$translators/$app.js is not a readable file"
  fi
  # A checksum in the URLs: a cache that keeps *.js for a year still gets new translator files.
  # cksum is POSIX, but some BusyBox builds leave it out (Debian's busybox-static does); then
  # sha256sum or md5sum.
  sum() {
    for prog in cksum sha256sum md5sum; do
      out=$("$prog" <"$1" 2>/dev/null) || continue
      case $prog in
        cksum) out=$(printf '%s\n' "$out" | awk 'NF >= 2 && $1 ~ /^[0-9]+$/ { print $1 "-" $2; exit }') ;;
        *) out=$(printf '%s\n' "$out" | awk '$1 ~ /^[0-9a-f]+$/ { print substr($1, 1, 16); exit }') ;;
      esac
      [ -n "$out" ] && { printf '%s\n' "$out"; return 0; }
    done
    return 1
  }
  if ! core_sum=$(sum "$translators/core.js") || ! app_sum=$(sum "$translators/$app.js"); then
    die 3 "cannot compute a checksum: none of cksum, sha256sum and md5sum works here"
  fi
  startup_attr=
  [ -z "$startup" ] || startup_attr=" data-startup-timeout=\"$startup\""
  tags="<script src=\"./craftsuite-layer/core.js?v=$core_sum\" data-allowed-origins=\"$allowed\" data-app-version=\"$ver\"$startup_attr></script><script src=\"./craftsuite-layer/$app.js?v=$app_sum\"></script>"
else
  tags=
fi

# --- index.html -------------------------------------------------------------------------------
# Exit codes of the awk program: 0 wrote a changed file, 10 nothing to change, 11 (--check) a
# change is due, 4 no <head>, 5 craftsuite-layer tags elsewhere. Our block is one line: a line
# break, the indentation of the next line, then the two tags. All values are validated above and
# contain no characters that need HTML escaping.
# shellcheck disable=SC2016 # awk program, not shell
edit_index='
function blanks(n,    s) { s = ""; while (n-- > 0) s = s " "; return s }
{ buf = buf $0 "\n" }
END {
  if (NR == 0) exit 4
  if (ENVIRON["CSL_NOEOL"] == "1") buf = substr(buf, 1, length(buf) - 1)
  # Lowercase copy with comments blanked out (same length, so positions match buf).
  low = tolower(buf); masked = ""
  while ((p = index(low, "<!--")) > 0) {
    q = index(substr(low, p + 4), "-->")
    if (q == 0) { masked = masked substr(low, 1, p - 1) blanks(length(low) - p + 1); low = ""; break }
    masked = masked substr(low, 1, p - 1) blanks(q + 6)
    low = substr(low, p + q + 6)
  }
  masked = masked low
  # The first "<head" followed by whitespace or ">" (not <header>); end is the position of its ">".
  end = 0; off = 0
  while ((p = index(substr(masked, off + 1), "<head")) > 0) {
    p += off
    c = substr(masked, p + 5, 1)
    if (index(" \t\r\n\f>", c) > 0 && c != "") {
      q = index(substr(masked, p), ">")
      if (q > 0) end = p + q - 1
      break
    }
    off = p + 4
  }
  if (end == 0) exit 4
  after = substr(buf, end + 1)
  # Line break and indentation that follow the tag.
  k = 1; nl = ""; indent = ""
  if (substr(after, 1, 2) == "\r\n") { nl = "\r\n"; k = 3 } else if (substr(after, 1, 1) == "\n") { nl = "\n"; k = 2 }
  if (nl != "") while ((c = substr(after, k, 1)) == " " || c == "\t") { indent = indent c; k++ }
  # The block this script wrote: line break, indentation, <script core.js></script><script ...></script>.
  old = ""; pfx = "<script src=\"./craftsuite-layer/"
  if (nl != "" && substr(after, k, length(pfx) + 7) == pfx "core.js") {
    t = substr(after, k)
    i = index(t, "</script>")
    if (i > 0 && substr(t, i + 9, length(pfx)) == pfx) {
      j = index(substr(t, i + 9), "</script>")
      if (j > 0) old = substr(after, 1, k - 1 + i + 8 + j + 8)
    }
  }
  if (index(substr(masked, 1, end) substr(masked, end + 1 + length(old)), "craftsuite-layer/") > 0) exit 5
  new = ""
  if (ENVIRON["CSL_TAGS"] != "") {
    if (nl == "") { nl = "\n"; indent = "  " }
    new = nl indent ENVIRON["CSL_TAGS"]
  }
  if (old == new) exit 10
  if (ENVIRON["CSL_CHECK"] == "1") exit 11
  res = substr(buf, 1, end) new substr(buf, end + 1 + length(old))
  printf "%s", res
  # The length goes to a file of its own, so the caller can tell a complete write from a cut one.
  print length(res) > ENVIRON["CSL_LEN"]
  close(ENVIRON["CSL_LEN"])
  exit 0
}'

noeol=0
[ -n "$(tail -c 1 "$index" | tr -d '\n')" ] && noeol=1
tmp=$dir/.index.html.craftsuite-$$
sw_tmp=$dir/.sw.js.craftsuite-$$
# shellcheck disable=SC2317,SC2329 # called by the EXIT trap (the code differs between versions)
cleanup() { rm -f "$tmp" "$tmp.len" "$sw_tmp" "$layer/.core.js.craftsuite-$$" "$layer/.$app.js.craftsuite-$$" "$layer/.sw.js.orig.craftsuite-$$"; }
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

if [ "$mode" = inject ] || [ "$mode" = remove ]; then
  cp -p "$index" "$tmp" 2>/dev/null || die 5 "cannot write in $dir"
  out=$tmp
else
  out=/dev/null
fi
LC_ALL=C CSL_TAGS=$tags CSL_CHECK=$([ "$mode" = check ] && echo 1 || echo 0) CSL_NOEOL=$noeol CSL_LEN=$tmp.len \
  awk "$edit_index" "$index" >"$out"
rc=$?
case $rc in
  0 | 10 | 11) ;;
  4) die 4 "$index has no <head> tag outside comments; the release's layout changed, the translator is not added" ;;
  5) die 4 "$index refers to craftsuite-layer/ in a way this script did not write; fix it by hand" ;;
  *) die 5 "could not edit $index (awk exit code $rc)" ;;
esac

# Precompressed copies (nginx gzip_static, brotli_static) of a changed file would serve the old
# content: write a new .gz, remove a .br (no brotli tool assumed).
recompress() {
  if [ -e "$1.gz" ]; then
    if command -v gzip >/dev/null 2>&1 && gzip -9 -c "$1" >"$1.gz.craftsuite-$$" && mv -f "$1.gz.craftsuite-$$" "$1.gz"; then
      :
    else
      rm -f "$1.gz.craftsuite-$$" "$1.gz" || die 5 "cannot remove the outdated $1.gz"
      warn "removed the outdated $1.gz; compress again"
    fi
  fi
  if [ -e "$1.br" ]; then
    rm -f "$1.br" || die 5 "cannot remove the outdated $1.br"
    warn "removed the outdated $1.br; compress again"
  fi
}

# --- Translator files -------------------------------------------------------------------------
changed_files=
if [ "$mode" != remove ]; then
  for f in core.js "$app.js"; do
    cmp -s "$translators/$f" "$layer/$f" 2>/dev/null || changed_files="$changed_files $f"
  done
fi

sw_due=0
case $sw_state in app | outdated) [ "$mode" = remove ] || sw_due=1 ;; esac

if [ "$mode" = check ]; then
  if [ "$rc" = 10 ] && [ -z "$changed_files" ] && [ "$sw_due" = 0 ]; then
    say "$app $ver: up to date in $dir"
    exit 0
  fi
  [ "$rc" = 10 ] || printf '%s: %s %s: index.html is not up to date\n' "$me" "$app" "$ver"
  [ -z "$changed_files" ] || printf '%s: %s %s: craftsuite-layer/ is not up to date:%s\n' "$me" "$app" "$ver" "$changed_files"
  [ "$sw_state" != app ] || printf "%s: %s %s: sw.js is the app's own service worker\n" "$me" "$app" "$ver"
  [ "$sw_state" != outdated ] || printf '%s: %s %s: sw.js is not up to date\n' "$me" "$app" "$ver"
  exit 1
fi

# Translator files first, then the service worker, then index.html: a page never refers to files
# that are not there.
if [ -n "$changed_files" ]; then
  mkdir -p "$layer" || die 5 "cannot create $layer"
  for f in $changed_files; do
    t=$layer/.$f.craftsuite-$$
    { cp "$translators/$f" "$t" && chmod 644 "$t" && mv -f "$t" "$layer/$f"; } 2>/dev/null ||
      die 5 "cannot write $layer/$f"
    recompress "$layer/$f"
  done
fi
if [ "$sw_due" = 1 ]; then
  if [ "$sw_state" = app ]; then
    # Keep the app's own worker for --remove (a newer one from an unpacked release replaces an
    # older copy).
    t=$layer/.sw.js.orig.craftsuite-$$
    { mkdir -p "$layer" && cp -p "$sw" "$t" && cmp -s "$sw" "$t" && mv -f "$t" "$sw_orig"; } 2>/dev/null ||
      die 5 "cannot keep the original $sw as $sw_orig"
  fi
  { sw_replacement >"$sw_tmp" && sw_replacement | cmp -s - "$sw_tmp" && chmod 644 "$sw_tmp" && mv -f "$sw_tmp" "$sw"; } 2>/dev/null ||
    die 5 "cannot write $sw"
  recompress "$sw"
fi
if [ "$rc" = 0 ]; then
  [ "$(wc -c <"$tmp" | tr -d " ")" = "$(cat "$tmp.len" 2>/dev/null)" ] || die 5 "could not write the new $index completely (disk full?); nothing changed"
  mv -f "$tmp" "$index" || die 5 "cannot replace $index"
  recompress "$index"
fi
# --remove: the app's own service worker back in place, once the tags are gone.
sw_restored=0
if [ "$mode" = remove ]; then
  case $sw_state in
    current | outdated)
      if [ -f "$sw_orig" ] && [ ! -h "$sw_orig" ]; then
        mv -f "$sw_orig" "$sw" || die 5 "cannot put back $sw from $sw_orig"
        recompress "$sw"
        sw_restored=1
      else
        warn "no $sw_orig to put back: $sw stays the one that removes itself (the app works, but not offline)"
      fi
      ;;
  esac
fi

if [ "$mode" = remove ]; then
  if [ "$rc" = 0 ]; then say "$app: removed the translator tags from $index"; else say "$app: no translator tags in $index"; fi
  [ "$sw_restored" = 0 ] || say "$app: put back the app's service worker $sw"
elif [ "$rc" = 10 ] && [ -z "$changed_files" ] && [ "$sw_due" = 0 ]; then
  say "$app $ver: already up to date in $dir (allowed origins: $allowed${startup:+; startup timeout: $startup ms})"
else
  say "$app $ver: translator added to $dir (allowed origins: $allowed${startup:+; startup timeout: $startup ms})"
  [ "$sw_state" != app ] || say "$app $ver: replaced the app's service worker $sw with one that removes itself (original: $sw_orig)"
fi
exit 0
