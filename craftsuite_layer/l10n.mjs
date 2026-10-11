// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Translations of the app, in Nextcloud's format: l10n/<lang>.json (read by PHP) and
// l10n/<lang>.js (loaded by the browser before the app's scripts). The .json files are edited;
// this script writes the .js files from them and checks that every text the app shows has a
// translation in every language.
//
//   node l10n.mjs strings   the source texts: t('craftsuite_layer', '…') in src/, $l->t('…') in
//                           lib/ and templates/
//   node l10n.mjs write     l10n/<lang>.json -> l10n/<lang>.js
//   node l10n.mjs check     fails on a missing or unused translation, or a .js out of date
//
// The same layout is what Nextcloud's translationtool and its Transifex bot produce, so the app
// can move to them without changes here.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = 'craftsuite_layer';

function files(dir, ext) {
  const full = path.join(here, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { recursive: true }).filter((f) => f.endsWith(ext)).map((f) => path.join(full, f));
}

const unquote = (q, s) => s.replace(new RegExp(`\\\\([\\\\${q}])`, 'g'), '$1');

export function sourceStrings() {
  const found = new Map();
  const add = (text, where) => found.set(text, [...(found.get(text) ?? []), where]);
  for (const file of files('src', '.ts')) {
    // Comments are no source texts (xgettext skips them too).
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\bt\(\s*'craftsuite_layer'\s*,\s*(['"])((?:\\.|(?!\1).)*)\1/g)) add(unquote(m[1], m[2]), path.relative(here, file));
    if (/\bt\(\s*'craftsuite_layer'\s*,\s*`/.test(src)) throw new Error(`${file}: t() needs a quoted literal, not a template string`);
  }
  for (const file of [...files('lib', '.php'), ...files('templates', '.php')]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/->t\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) add(unquote(m[1], m[2]), path.relative(here, file));
  }
  return found;
}

function languages() {
  return readdirSync(path.join(here, 'l10n')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

function readLang(lang) {
  const data = JSON.parse(readFileSync(path.join(here, 'l10n', `${lang}.json`), 'utf8'));
  if (typeof data.translations !== 'object' || typeof data.pluralForm !== 'string') throw new Error(`l10n/${lang}.json: needs "translations" and "pluralForm"`);
  return data;
}

function jsFor(data) {
  const body = Object.entries(data.translations).map(([k, v]) => `    ${JSON.stringify(k)} : ${JSON.stringify(v)}`).join(',\n');
  return `OC.L10N.register(\n    ${JSON.stringify(APP)},\n    {\n${body}\n},\n${JSON.stringify(data.pluralForm)});\n`;
}

const command = process.argv[2];
if (command === 'strings') {
  for (const [text, where] of sourceStrings()) console.log(`${JSON.stringify(text)}  (${[...new Set(where)].join(', ')})`);
} else if (command === 'write') {
  for (const lang of languages()) writeFileSync(path.join(here, 'l10n', `${lang}.js`), jsFor(readLang(lang)));
  console.log(`wrote l10n/{${languages().join(',')}}.js`);
} else if (command === 'check') {
  const strings = sourceStrings();
  let failed = false;
  for (const lang of languages()) {
    const data = readLang(lang);
    for (const text of strings.keys()) {
      if (!data.translations[text]) { console.error(`l10n/${lang}.json: missing ${JSON.stringify(text)}`); failed = true; }
    }
    for (const text of Object.keys(data.translations)) {
      if (!strings.has(text)) { console.error(`l10n/${lang}.json: unused ${JSON.stringify(text)}`); failed = true; }
      const want = [...text.matchAll(/\{\w+\}|%(\d\$)?s/g)].map((m) => m[0]).sort().join(' ');
      const got = [...String(data.translations[text]).matchAll(/\{\w+\}|%(\d\$)?s/g)].map((m) => m[0]).sort().join(' ');
      if (want !== got) { console.error(`l10n/${lang}.json: placeholders differ for ${JSON.stringify(text)}`); failed = true; }
    }
    const js = path.join(here, 'l10n', `${lang}.js`);
    if (!existsSync(js) || readFileSync(js, 'utf8') !== jsFor(data)) { console.error(`l10n/${lang}.js is out of date: node l10n.mjs write`); failed = true; }
  }
  if (failed) process.exit(1);
  console.log(`${strings.size} texts, translated in: ${languages().join(', ')}`);
} else {
  console.error('usage: node l10n.mjs strings|write|check');
  process.exit(2);
}
