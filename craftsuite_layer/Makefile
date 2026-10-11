# SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds the App Store archive of the Nextcloud app and checks its sources. Run in this folder:
#
#   make appstore   build/artifacts/craftsuite_layer.tar.gz, single top folder craftsuite_layer/
#   make js         bundles the front end (src/*.ts) into js/ with esbuild; appstore does this first
#   make lint       php -l on every PHP file, a CHANGELOG.md section for the version in
#                   appinfo/info.xml, info.xml and icons well-formed (if xmllint is installed)
#   make clean      removes build/
#
# Variables: PHP and XMLLINT name the binaries (lint with the lowest and the highest supported
# PHP, e.g. PHP=php8.2 and PHP=php8.5). INFO_XSD is the path to the App Store's info.xsd; lint
# then also validates info.xml against it and requires xmllint. SOURCE_DATE_EPOCH (e.g. the
# release commit's time) fixes the mtime of all archive entries.
#
# Code signing, which the App Store requires: set OCC to the occ of an installed Nextcloud server
# and SIGN_KEY and SIGN_CERT to the app's private key and certificate. appstore then signs the
# staged folder, so appinfo/signature.json covers exactly the shipped files; a signature made in
# this folder would list dev files and make every installation report them as missing.
#
# The archive is built from an allowlist of runtime files, so tests, sources, Composer and npm
# files and this Makefile never ship. vendor/ stays out on purpose: the app has no runtime
# Composer dependencies, and a dev install (nextcloud/ocp) must never reach a server.
# With GNU tar the archive is reproducible: sorted entries, owner 0, normalised modes, no gzip
# name or timestamp, and with SOURCE_DATE_EPOCH fixed mtimes.

SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := appstore
# Keeps macOS tar from adding ._* AppleDouble files.
export COPYFILE_DISABLE := 1

app_id := craftsuite_layer
build_dir := build
stage_dir := $(build_dir)/stage
artifacts_dir := $(build_dir)/artifacts
archive := $(artifacts_dir)/$(app_id).tar.gz

PHP ?= php
# The front end is TypeScript bundled by esbuild from the repository's node_modules (npm ci there).
NODE ?= node
XMLLINT ?= xmllint
TAR ?= tar
INFO_XSD ?=
SOURCE_DATE_EPOCH ?=
OCC ?=
SIGN_KEY ?=
SIGN_CERT ?=

# What Nextcloud loads at runtime. Folders that do not exist (yet) are skipped. Expanded when
# used (=, not :=), so js/ counts once the js target has built it.
runtime_dirs = $(wildcard appinfo lib img templates js css l10n)
runtime_files := CHANGELOG.md $(wildcard CHANGELOG.*.md)
license := $(wildcard ../LICENSE)

version := $(shell sed -n 's:.*<version>\([^<]*\)</version>.*:\1:p' appinfo/info.xml)

ifeq ($(shell $(TAR) --version 2>/dev/null | grep -c 'GNU tar'),1)
tar_flags := --format=gnu --sort=name --owner=0 --group=0 --numeric-owner --mode=u+rwX,go+rX,go-w
ifneq ($(SOURCE_DATE_EPOCH),)
tar_flags += --mtime=@$(SOURCE_DATE_EPOCH)
endif
endif

.PHONY: appstore js lint lint-php lint-changelog lint-xml clean

# src/<entry>.ts -> js/<entry>.mjs (+ .license), see build.mjs
js:
	@if [ ! -d ../node_modules/esbuild ]; then echo "esbuild not found: run npm ci in the repository root first" >&2; exit 1; fi
	$(NODE) build.mjs

appstore: js
	rm -rf $(stage_dir) $(archive)
	mkdir -p $(stage_dir)/$(app_id) $(artifacts_dir)
	$(TAR) -cf - --exclude='.*' --exclude='*~' $(runtime_dirs) $(runtime_files) | $(TAR) -xf - -C $(stage_dir)/$(app_id)
ifneq ($(license),)
	cp $(license) $(stage_dir)/$(app_id)/LICENSE
endif
	@# The App Store refuses links on the way to info.xml; fail here instead of after the upload.
	@links=$$(find $(stage_dir) -type l); \
	if [ -n "$$links" ]; then echo "Symbolic links are not allowed in the archive:" >&2; echo "$$links" >&2; exit 1; fi
ifneq ($(SIGN_KEY)$(SIGN_CERT),)
	@if [ -z "$(OCC)" ] || [ -z "$(SIGN_KEY)" ] || [ -z "$(SIGN_CERT)" ]; then echo "Signing needs OCC, SIGN_KEY and SIGN_CERT" >&2; exit 1; fi
	$(PHP) $(OCC) integrity:sign-app --path='$(abspath $(stage_dir)/$(app_id))' --privateKey='$(abspath $(SIGN_KEY))' --certificate='$(abspath $(SIGN_CERT))'
	@test -s $(stage_dir)/$(app_id)/appinfo/signature.json
endif
	$(TAR) -C $(stage_dir) $(tar_flags) -cf - $(app_id) | gzip -9n > $(archive)
	@# The App Store's first checks: one top folder named like the app id, with appinfo/info.xml.
	@# The listing is read in full first: `tar | grep -q` fails under pipefail once grep stops
	@# reading early and tar gets SIGPIPE (exit 141), which a larger archive makes likely.
	@# Without its scripts the editor page would never start and Files would have no entry.
	@entries=$$($(TAR) -tzf $(archive)); \
	other=$$(grep -v '^$(app_id)/' <<<"$$entries" || true); \
	if [ -n "$$other" ]; then echo "Entries outside $(app_id)/:" >&2; echo "$$other" >&2; exit 1; fi; \
	for f in appinfo/info.xml js/editor.mjs js/files.mjs js/admin.mjs; do \
		grep -qx "$(app_id)/$$f" <<<"$$entries" || { echo "$$f is missing in the archive" >&2; exit 1; }; \
	done
	@echo "Built $(archive) for version $(version)"

lint: lint-php lint-changelog lint-xml

# -n (no php.ini) keeps local settings from hiding or adding messages, so any output besides the
# success line, a deprecation for example, fails the check.
lint-php:
	@files=$$(find . -name '*.php' -not -path './vendor/*' -not -path './build/*' -not -path './node_modules/*' | LC_ALL=C sort); \
	if [ -z "$$files" ]; then echo "No PHP files found" >&2; exit 1; fi; \
	status=0; \
	for f in $$files; do \
		out=$$($(PHP) -n -d error_reporting=-1 -d display_errors=1 -l "$$f" 2>&1) || status=1; \
		if [ "$$out" != "No syntax errors detected in $$f" ]; then echo "$$out" >&2; status=1; fi; \
	done; \
	if [ $$status -ne 0 ]; then exit 1; fi; \
	echo "PHP $$($(PHP) -n -r 'echo PHP_VERSION;'): no syntax errors in $$(echo "$$files" | wc -l | tr -d ' ') files"

lint-changelog:
	@if [ -z "$(version)" ]; then echo "No <version> found in appinfo/info.xml" >&2; exit 1; fi
	@grep -Eq '^## \[?v?$(subst .,\.,$(version))(\]|[[:space:]]|$$)' CHANGELOG.md || \
	{ echo "CHANGELOG.md has no section '## [$(version)]' for the version in appinfo/info.xml" >&2; exit 1; }
	@echo "CHANGELOG.md has a section for $(version)"

lint-xml:
	@if command -v $(XMLLINT) >/dev/null 2>&1; then \
		$(XMLLINT) --nonet --noout appinfo/info.xml $(wildcard img/*.svg); \
		if [ -n "$(INFO_XSD)" ]; then $(XMLLINT) --nonet --noout --schema '$(INFO_XSD)' appinfo/info.xml; fi; \
		echo "XML well-formed: appinfo/info.xml $(wildcard img/*.svg)"; \
	elif [ -n "$(INFO_XSD)" ]; then \
		echo "INFO_XSD is set, but $(XMLLINT) was not found" >&2; exit 1; \
	else \
		echo "Skipped the XML checks: $(XMLLINT) not found" >&2; \
	fi

clean:
	rm -rf $(build_dir) js
