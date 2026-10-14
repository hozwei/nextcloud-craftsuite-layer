/*
 * craftsuite-layer adapter for EffectCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What EffectCraft (web build, checked with 0.8.0 and 0.9.2) does and
 * why the rules below follow from it is described in docs/apps/effectcraft.md. Source references
 * are to the v0.9.2 tag (apps/effectcraft-web/ is the same as in 0.8.0); index.html is
 * apps/effectcraft-web/web/index.html, app.rs, files.rs and api.rs are in apps/effectcraft-web/src/,
 * the other paths are under crates/.
 *  - index.html is not a Trunk loader: its inline module script defines window.effectcraft,
 *    registers the service worker sw.js unless the URL has `nosw` (index.html:86-88), compiles the
 *    .wasm and runs start(), and never dispatches TrunkApplicationStarted. eframe registers the
 *    first `drop` listener, on canvas#effectcraft_canvas, once the app exists, so the core's
 *    default drop target fits and its `ready` comes when the app can take files.
 *  - start() reads its URL (app.rs:189-265): without flags it loads browser storage, restores the
 *    last session with its project path and unsaved changes, or opens the demo project. If a
 *    dropped project then fails to open, the restored one stays and saves under its own path,
 *    which may be the opened name. This adapter, a classic script that runs before the module
 *    script, therefore sets the app's own flags with history.replaceState, only where the core
 *    is active: `empty` (a blank project, no session restored or kept), `nosw` (no service
 *    worker, which would serve index.html and the translator from its cache) and
 *    `storage=memory` (nothing read from or written to the frame's OPFS or IndexedDB). Its
 *    started() checks with effectcraft.info() that the storage is memory and no session was
 *    restored; if not, the host gets a startup error.
 *  - A drop or a pick (File > Open Project, Ctrl+O) stores each file in the app's file table as
 *    '/<name>' (files.rs:61-65, 256-289); a name ending in '.ecproj' (any case) opens as the
 *    project, replacing the open one without asking; anything else is imported as footage
 *    (app.rs:61-79, 98-102). The project's path is that table path.
 *  - Every download goes through files.rs:85-108: a Blob typed by the extension, an <a download>
 *    appended to <body>, click(), removed at once; the URL is revoked after 60 s. Every file the
 *    engine writes is downloaded under the last part of its path (files.rs:120-132).
 *  - Save (Ctrl+S) writes the project to its path: the opened name for an opened file, a full
 *    rewrite as pretty JSON that starts with "savedBy" (this version), since 0.9 the open
 *    compositions ("activeComp", "openComps", each only when there is one), then "schema"
 *    (project/src/lib.rs:1426-1448, engine/src/commands/file.rs:97-118), then marks the project
 *    clean. There is no dialog: the save hook takes the suggested name (app.rs:178), and the
 *    suggestion is always 'Untitled Project.ecproj', for Save of a project without a path (new,
 *    demo, blank), Save As (Ctrl+Shift+S) and Save a Copy (ui-egui/src/menus.rs:1229-1231).
 *    After Save As the project's path is '/Untitled Project.ecproj'. Increment and Save writes
 *    '<stem> <n>.ecproj', never a name in the file table (engine/src/autosave.rs:249-264).
 *  - A project file has no document identity (project/src/lib.rs:1297-1312), and every new
 *    project saves as 'Untitled Project.ecproj': a save under that name is never the document.
 *  - Collect Files downloads the project again as '/Collected Files/<stem>.ecproj', which arrives
 *    under the opened name, with its footage paths rewritten; it is written with Project::to_json,
 *    without "savedBy" (engine/src/commands/file_more.rs:374-421). Only the "savedBy" head rule
 *    keeps it from passing as the document.
 *  - A project that a newer EffectCraft wrote opens with a warning that what this version does not
 *    know is lost on saving (engine/src/commands/file.rs:59-65). saved_by() reads the top-level
 *    "savedBy" wherever it stands, also of the XML form, which opens like JSON after the app's own
 *    lenient reader converted it (engine/src/xml_project.rs). identity() reads it the same way,
 *    with a port of that reader, and marks such an opened file; its saves are copies: the opened
 *    file stays as it is.
 *  - Files the user brings in (a drop from the desktop, a file picker) land in the same table:
 *    one with the opened name replaces the opened project under the same path, and its Save
 *    would arrive as the document. Importing a template (.ectemplate) downloads its media through
 *    the same writer, under names the template chooses (engine/src/commands/essential.rs:900-917);
 *    in 0.8.0 and 0.9.2 only window.effectcraft and scripts reach that (the menu's picker hands the
 *    file to the drop path, which imports it as media), but a release may wire it up. So a save is
 *    the document only if no such file came in and the app's own state right after it says that
 *    the project with the saved name as its path was just saved: clean (project.summary through
 *    window.effectcraft, api.rs:45-61, engine/src/commands/query.rs:32-70).
 *  - A script in the Script Console writes files under any name, with any content, while the
 *    project stays clean (script/src/runtime.rs:346-361, 399-418), but only with the user's
 *    setting scripting.allowScriptsWriteFiles, which is off by default and which a script cannot
 *    change (engine/src/commands/settings.rs:14). While it is on, no save is the document.
 *
 * Rule: a download is the document only if it has the opened name, ending in '.ecproj', its stem
 * is not 'Untitled Project', it starts like a project Save writes ("savedBy", the open
 * compositions, "schema"), no file with that name came from the user in this frame, the opened
 * file's savedBy and the app's version were read, project.summary reports that path, clean, and
 * scripts may not write files. Of a file a newer EffectCraft wrote, such a save is a copy.
 * Everything else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // The app's URL flags (see the header), set before the app's module script reads them. A frame
  // reload keeps them, as they are in the URL.
  const FLAGS = [['empty', ''], ['nosw', ''], ['storage', 'memory']];
  try {
    const url = new URL(location.href);
    let changed = false;
    for (const [name, value] of FLAGS) {
      if (url.searchParams.get(name) !== value) {
        url.searchParams.set(name, value);
        changed = true;
      }
    }
    if (changed) history.replaceState(history.state, '', url.href);
  } catch { /* the URL stays as it is; the rules below still hold */ }

  const stem = (name) => name.replace(/\.[^.]*$/, '');
  // The name the web build gives every project without a path, Save As and Save a Copy.
  const UNTITLED = 'Untitled Project';

  // The core's safeName (core.js), which every save name passes through before it reaches
  // classify(): the names of files the user brings in are compared after the same changes.
  const MAX_NAME = 200;
  const safeName = (raw) => {
    let name = String(raw || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '_');
    if (name.length > MAX_NAME) {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
      name = name.slice(0, MAX_NAME - ext.length).replace(/[\uD800-\uDBFF]$/, '') + ext;
    }
    name = name.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
    return name || 'download';
  };

  // A project file as Save writes it: pretty JSON whose first member is savedBy, then (since 0.9)
  // the open compositions, activeComp and openComps, each left out when there is none, then
  // schema. Collect Files writes no savedBy, so its copy under the opened name fails this test.
  // openComps has an id per line, so the head is looked for in the first 64 KiB.
  const PROJECT_HEAD = new RegExp([
    /^\s*\{\s*"savedBy"\s*:\s*"[^"\\]{0,64}"\s*,/.source,
    /(?:\s*"activeComp"\s*:\s*\d+\s*,)?(?:\s*"openComps"\s*:\s*\[[\s\d,]*\]\s*,)?/.source,
    /\s*"schema"\s*:\s*\d+\s*,/.source,
  ].join(''));
  const HEAD_BYTES = 65536;
  const isSavedProject = (bytes) => PROJECT_HEAD.test(new TextDecoder().decode(bytes.subarray(0, HEAD_BYTES)));

  // The XML form as the app reads it (engine/src/xml_project.rs: is_xml, from_xml), ported so that
  // every savedBy the app finds is found here too: the first `n="` anywhere in a tag names a
  // member, entities are decoded in names and text, whitespace (Rust's), comments and processing
  // instructions are skipped between elements, and the last member of a name wins. Objects become
  // Maps. Throws where the app's reader fails, also for elements nested deeper than its limit
  // (since 0.9; such a file did not open in 0.8.0 either, whose JSON reader stops at that depth).
  const WS = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const WS_CHAR = new RegExp(WS);
  const WS_START = new RegExp(`^${WS}+`);
  const WS_ENDS = new RegExp(`^${WS}+|${WS}+$`, 'g');
  const XML_ROOT = 'EffectCraftProject';
  const XML_MAX_DEPTH = 128;
  const isXml = (text) => {
    const start = text.replace(/^\ufeff+/, '').replace(WS_START, '');
    return start.startsWith('<?xml') || start.startsWith('<' + XML_ROOT);
  };
  const charRef = (digits, radix) => {
    if (!(radix === 16 ? /^\+?[0-9a-fA-F]+$/ : /^\+?[0-9]+$/).test(digits)) return '';
    const n = parseInt(digits.replace(/^\+/, ''), radix);
    return n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  };
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unescapeXml = (s) => {
    let out = '';
    let rest = s;
    for (let a = rest.indexOf('&'); a >= 0; a = rest.indexOf('&')) {
      out += rest.slice(0, a);
      rest = rest.slice(a);
      const e = rest.indexOf(';');
      if (e < 0) break;
      const ent = rest.slice(1, e);
      if (Object.hasOwn(NAMED, ent)) out += NAMED[ent];
      else if (ent.startsWith('#x')) out += charRef(ent.slice(2), 16);
      else if (ent.startsWith('#')) out += charRef(ent.slice(1), 10);
      else out += '&' + ent + ';';
      rest = rest.slice(e + 1);
    }
    return out + rest;
  };
  const fromXml = (source) => {
    const s = source.replace(/^\ufeff+/, '');
    let i = 0;
    const fail = () => { throw new Error('not an XML project the app can read'); };
    const skip = () => {
      for (;;) {
        while (i < s.length && WS_CHAR.test(s[i])) i++;
        const end = s.startsWith('<?', i) ? s.indexOf('?>', i) : s.startsWith('<!--', i) ? s.indexOf('-->', i) : null;
        if (end === null) return;
        i = end < 0 ? s.length : end + (s[i + 1] === '?' ? 2 : 3);
      }
    };
    const open = () => {
      skip();
      if (s[i] !== '<' || s.startsWith('</', i)) fail();
      const end = s.indexOf('>', i);
      if (end < 0) fail();
      let inner = s.slice(i + 1, end);
      i = end + 1;
      const closed = inner.endsWith('/');
      if (closed) inner = inner.slice(0, -1);
      const ws = inner.search(WS_CHAR);
      const attrs = ws < 0 ? '' : inner.slice(ws + 1);
      const at = attrs.indexOf('n="');
      const rest = at < 0 ? '' : attrs.slice(at + 3);
      const key = at < 0 ? null : unescapeXml(rest.includes('"') ? rest.slice(0, rest.indexOf('"')) : rest);
      return { name: ws < 0 ? inner : inner.slice(0, ws), key, closed };
    };
    const close = (name) => {
      skip();
      if (!s.startsWith(`</${name}>`, i)) fail();
      i += name.length + 3;
    };
    const text = () => {
      const lt = s.indexOf('<', i);
      const end = lt < 0 ? s.length : lt;
      const t = unescapeXml(s.slice(i, end));
      i = end;
      return t;
    };
    const value = (depth) => {
      if (depth > XML_MAX_DEPTH) fail();
      const { name, closed } = open();
      let v;
      if (name === 'null') v = null;
      else if (closed) v = name === 'arr' ? [] : name === 'obj' ? new Map() : name === 'str' ? '' : fail();
      else if (name === 'bool') v = text().replace(WS_ENDS, '') === 'true';
      else if (name === 'num') v = JSON.parse(text().replace(WS_ENDS, ''));
      else if (name === 'str') v = text();
      else if (name === 'arr') {
        v = [];
        for (skip(); !s.startsWith('</', i); skip()) v.push(value(depth + 1));
      } else if (name === 'obj') {
        v = new Map();
        for (skip(); !s.startsWith('</', i); skip()) {
          const member = open();
          if (member.name !== 'm') fail();
          v.set(member.key ?? '', value(depth + 1));
          close('m');
        }
      } else fail();
      if (!closed && name !== 'null') close(name);
      return v;
    };
    if (open().name !== XML_ROOT) fail();
    const project = value(0);
    close(XML_ROOT);
    return project;
  };

  // The versions a project file names as its writer, read as the app's saved_by() does: the
  // top-level "savedBy" of the JSON wherever it stands, or of the XML form, which the app
  // converts to JSON first (engine/src/commands/file.rs:45, 60, project/src/lib.rs:42-50). [] for
  // a file without one, null for a file that cannot be read so (not UTF-8, neither form, or a
  // savedBy that is not text).
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const savedByOf = (bytes) => {
    try {
      const text = utf8.decode(bytes);
      const project = isXml(text) ? fromXml(text) : JSON.parse(text);
      let savedBy;
      if (project instanceof Map) savedBy = project.get('savedBy');
      else if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
      else if (Object.hasOwn(project, 'savedBy')) savedBy = project.savedBy;
      if (savedBy === undefined) return [];
      return typeof savedBy === 'string' ? [savedBy] : null;
    } catch {
      return null;
    }
  };
  // Whether version a is newer than b, as the app compares them (project/src/lib.rs:88-95):
  // major.minor.patch, anything after '-' or '+' ignored, a part that is not a number counts as 0.
  const parts = (v) => {
    const n = String(v).split(/[-+]/)[0].split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
    return [n[0] || 0, n[1] || 0, n[2] || 0];
  };
  const newer = (a, b) => {
    const x = parts(a);
    const y = parts(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };
  const appVersion = () => {
    try {
      const version = window.effectcraft.info().version;
      return typeof version === 'string' && version ? version : null;
    } catch {
      return null;
    }
  };
  // Marks that identity() gives an opened file instead of a document identity, which the format
  // does not have.
  const NEWER = 'saved by a newer EffectCraft';
  const UNKNOWN = 'savedBy or the app version unknown';

  // Names of files the user brought in: a trusted drop (the core's own drop is synthetic,
  // isTrusted false) or an <input type=file> (File > Open Project, File > Import, the Media
  // Browser's Add Files). eframe and the app read both through the `files` getters (files.rs:265,
  // the Media Browser's host.js:629); should a release read them another way, such files go
  // unnoticed again, and only the project.summary check below is left.
  const broughtIn = new Set();
  const watchFiles = (proto, counts) => {
    const desc = Object.getOwnPropertyDescriptor(proto, 'files');
    if (!desc || typeof desc.get !== 'function' || !desc.configurable) return;
    Object.defineProperty(proto, 'files', {
      ...desc,
      get() {
        const list = desc.get.call(this);
        try {
          if (list && counts(this)) for (const file of list) if (file instanceof File) broughtIn.add(safeName(file.name));
        } catch { /* never break the app's read */ }
        return list;
      },
    });
  };
  watchFiles(DataTransfer.prototype, () => {
    const event = window.event; // the drop being dispatched, if any
    return !!event && event.type === 'drop' && event.isTrusted;
  });
  watchFiles(HTMLInputElement.prototype, (input) => input.type === 'file');

  // The app's own state right after the download: Save leaves the project clean, with the saved
  // name as its path, and scripts may not write files. With the user's Allow Scripts to Write
  // Files and Access Network (Preferences > Scripting & Expressions, off by default and not a
  // script's to change), a script in the Script Console writes any bytes under any name (File's
  // write and copy, since 0.9 writeBinary) while the project stays clean. The engine answers on
  // its next frame; anything else (no API, an error, no answer within SUMMARY_TIMEOUT) counts as no.
  const SUMMARY_TIMEOUT = 10000;
  const savedJustNow = async (name) => {
    let timer;
    try {
      const [summary, scriptsWrite] = await Promise.race([
        Promise.all([
          window.effectcraft.execute('project.summary'),
          window.effectcraft.execute('prefs.get', { key: 'scripting.allowScriptsWriteFiles' }),
        ]),
        new Promise((resolve) => { timer = setTimeout(resolve, SUMMARY_TIMEOUT, []); }),
      ]);
      return !!summary && summary.path === '/' + name && summary.dirty === false && scriptsWrite === false;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  // The interface language: the web build reads none at start (no system language; under
  // storage=memory no stored preference either, crates/ui-egui/src/i18n.rs:65-77), but its
  // automation call sets the preference general.language, which applies on the next frame
  // (crates/engine/src/prefs.rs:25-68). BCP 47 tag -> EffectCraft's code; left out: ja, zh-Hans and
  // zh-Hant, which the web build draws without a font, and ru, fr, de and cs, which 0.9 added and
  // 0.8.0 refuses (see docs/apps/effectcraft.md). Its Spanish translates only the menu bar.
  const LANGUAGES = { en: 'en', es: 'es', 'pt-BR': 'pt-br', uk: 'uk' };
  const LANGUAGE_WAIT_MS = 10000;
  let wantedLanguage = null;
  let settleLanguage = () => undefined;
  const languageApplied = new Promise((resolve) => { settleLanguage = resolve; });

  window.craftsuiteLayer.register({
    app: 'effectcraft',
    language(tag, util) {
      wantedLanguage = util.matchLanguage(tag, LANGUAGES);
      return wantedLanguage ? languageApplied : null;
    },
    // Ready only if the flags took effect where the app tells (effectcraft.info(), set before
    // eframe registers its drop listener, app.rs:201, 239-243): memory storage and no restored
    // session. Otherwise (a release that renamed a flag, or no answer) the host gets a
    // startup error and no file is handed over.
    async started() {
      let info = null;
      try { info = window.effectcraft.info(); } catch { /* below */ }
      const storage = info && info.storage ? info.storage.backend : undefined;
      if (storage !== 'memory') throw new Error(`the app would keep the opened project in browser storage (storage: ${String(storage)})`);
      if (info.restored !== false) throw new Error(`the app may have restored an earlier session (restored: ${String(info.restored)})`);
      // The host's language, before `ready`; the app goes on in its own if it does not take it.
      if (!wantedLanguage) return settleLanguage(null);
      let timer;
      try {
        await Promise.race([
          window.effectcraft.execute('prefs.set', { key: 'general.language', value: LANGUAGES[wantedLanguage] }),
          new Promise((resolve, reject) => { timer = setTimeout(reject, LANGUAGE_WAIT_MS, new Error('no answer')); }),
        ]);
        settleLanguage(wantedLanguage);
      } catch (error) {
        console.warn('[craftsuite-layer] EffectCraft did not take the language', error);
        settleLanguage(null);
      } finally {
        clearTimeout(timer);
      }
    },
    // Not a document identity (the format has none): NEWER for a file a newer EffectCraft wrote,
    // UNKNOWN when savedBy or the app's own version cannot be read, null otherwise. A save of this
    // version names this version, so it gets null, and classify() decides by the opened file's mark.
    identity(bytes) {
      const versions = savedByOf(bytes);
      const own = appVersion();
      if (!versions || !own) return UNKNOWN;
      return versions.some((v) => newer(v, own)) ? NEWER : null;
    },
    // 'document' may replace the opened file, 'copy' goes next to it; everything else becomes a
    // new file. Save rewrites the whole project under the opened name, so there is no prefix to
    // compare and no identity to tell projects apart: the name, Save's own format, the files the
    // user brought in and the app's state decide.
    // Known gap: another project the user opens in a way the getters above do not see, saved
    // under the opened name (see docs/apps/effectcraft.md).
    async classify(save, entry) {
      if (save.name !== entry.name || !/\.ecproj$/i.test(save.name)) return 'export';
      if (stem(save.name) === UNTITLED) return 'export';
      if (!isSavedProject(save.bytes)) return 'export';
      if (broughtIn.has(save.name)) return 'export';
      if (entry.identity && entry.identity !== NEWER) return 'export';
      if (!(await savedJustNow(save.name))) return 'export';
      return entry.identity === NEWER ? 'copy' : 'document';
    },
  });
})();
