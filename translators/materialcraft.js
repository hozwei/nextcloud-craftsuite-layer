/*
 * craftsuite-layer adapter for MaterialCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What MaterialCraft (web build, checked with 0.3.0) does and why the
 * rules below follow from it is described in docs/apps/materialcraft.md. Source references are to
 * the v0.3.0 tag, under crates/ (web_files.rs is ui-egui/src/web_files.rs).
 *  - index.html is a Trunk loader that dispatches TrunkApplicationStarted; eframe's drop listener
 *    is on canvas#materialcraft_canvas, so the core's defaults fit. The app starts with a new
 *    package, 'Untitled package', and its Home window; it can hold several packages.
 *  - A dropped package (.mcraft, .sbs, or the zip of an SBS download) opens as a package of its own
 *    and becomes the active one (web_files.rs load_now, engine/src/file_cmds.rs open_bytes), with
 *    the file's name as its path ('<stem>.sbs' for '<stem>_sbs.zip'), unless reading it gave
 *    warnings; a package with that path that is open already is only activated. Images and meshes
 *    go into the active package instead.
 *  - Save (Ctrl+S, File menu) of a package with a path downloads it at once under that path: a
 *    .mcraft as '<name>.mcraft', a zip with package.sbs; an .sbs as '<stem>_sbs.zip', a zip with
 *    '<stem>.sbs' and its resources (web_files/package_save.rs). Without a path, and always for Save
 *    as (Ctrl+Shift+S), it asks in a 'Save package' window for a name (the package's identifier)
 *    and a type, and downloads '<name>.mcraft' or '<name>_sbs.zip'. Never an update of the opened
 *    bytes, no autosave in the browser. Exports have other names or types (.mcmat, images, a zip
 *    of several).
 *  - New packages are named 'Untitled package', the sample 'Atomic sample'. A package file stores
 *    no identity of its package.
 *  - The interface language: the one stored with the interface settings in localStorage ('ui', as
 *    RON, prefs.language), else the browser's (navigator.language); it writes them with the
 *    language it started in (ui-egui/src/material_craft_app.rs, state/prefs.rs, i18n.rs).
 *
 * Rule: a download is the document only if it has the name a save of the opened file gets
 * (savedName), that name is not a new package's, and it is a MaterialCraft package of that kind.
 * Everything else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // The languages the web build shows (0.3.0), BCP 47 tag -> MaterialCraft's code.
  const LANGUAGES = { en: 'en', ar: 'ar' };

  const lower = (name) => name.toLowerCase();
  // The download name of a package saved at `path` (web_files/package_save.rs download).
  const downloadName = (path) => {
    if (lower(path).endsWith('.mcraft')) return path;
    return (path.endsWith('.sbs') ? path.slice(0, -4) : path) + '_sbs.zip';
  };
  // What new packages save under, as either type (engine/src/file_cmds.rs, atomic_sample.rs).
  const NEW_PACKAGE = new Set(['Untitled package', 'Atomic sample'].flatMap((n) => [n + '.mcraft', n + '_sbs.zip']));

  // Whether a zip has a member of this name, found through the central directory.
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const hasMember = (bytes, wanted) => {
    if (bytes.length < 22 || u32(bytes, 0) !== 0x04034b50) return false;
    let end = -1; // the end of central directory record, within the last 64 KiB + 22 bytes
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
      if (u32(bytes, i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) return false;
    const name = new TextEncoder().encode(wanted);
    let at = u32(bytes, end + 16);
    for (let n = u16(bytes, end + 10); n > 0 && at + 46 <= bytes.length && u32(bytes, at) === 0x02014b50; n--) {
      const nameLength = u16(bytes, at + 28);
      if (nameLength === name.length && name.every((b, i) => bytes[at + 46 + i] === b)) return true;
      at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    }
    return false;
  };
  // The SBS file at the root of the zip a save of this name holds (formats/src/project.rs).
  const rootSbs = (name) => (lower(name).endsWith('.mcraft') ? 'package.sbs' : name.slice(0, -'_sbs.zip'.length) + '.sbs');

  // The language MaterialCraft stores. It writes its interface settings, prefs.language among
  // them, to localStorage 'ui' (RON) with the language it started in, and from then on starts in
  // that one. So the host's language would apply only once. The adapter keeps, under a key of its
  // own, the language it had MaterialCraft start in; while the stored one is that, MaterialCraft
  // reads the host's language instead. A language the user picks in MaterialCraft is another one:
  // the adapter's key goes, and MaterialCraft's own rule applies, as for a language stored before
  // this adapter. Returns whether MaterialCraft starts in `code`.
  const UI_KEY = 'ui';
  const OWN_KEY = 'craftsuite-layer:materialcraft:language';
  // prefs.language in eframe's RON (Prefs puts it first; codes have no quotes or backslashes).
  const LANGUAGE = /(\bprefs:\(\s*language:\s*)"([^"\\]*)"/;
  const followHost = (code) => {
    const storage = window.localStorage;
    const { getItem, setItem, removeItem } = Storage.prototype;
    const stored = (value) => {
      const match = typeof value === 'string' ? LANGUAGE.exec(value) : null;
      return match ? match[2] : null;
    };
    const current = stored(getItem.call(storage, UI_KEY));
    if (current !== null && current !== code && current !== getItem.call(storage, OWN_KEY)) return false;
    Storage.prototype.getItem = function (key) {
      const value = getItem.call(this, key);
      if (this !== storage || key !== UI_KEY || value === null) return value;
      const language = stored(value);
      if (language === null || language === code || language !== getItem.call(storage, OWN_KEY)) return value;
      return value.replace(LANGUAGE, (_, head) => `${head}"${code}"`);
    };
    Storage.prototype.setItem = function (key, value) {
      if (this === storage && key === UI_KEY) {
        const language = stored(String(value));
        if (language === code) setItem.call(storage, OWN_KEY, code);
        else if (language !== null) removeItem.call(storage, OWN_KEY);
      }
      return setItem.call(this, key, value);
    };
    return true;
  };

  window.craftsuiteLayer.register({
    app: 'materialcraft',
    // An opened package saves under its path (see the header): a .mcraft under its own name, an
    // .sbs as '<stem>_sbs.zip'. If that is not the opened name, the host keeps the file and stores
    // the saves in a new file next to it.
    savedName: (name) => downloadName(name),
    // 'document' may replace the opened file (or the file the host stored next to it); everything
    // else becomes a new file. Save rewrites the whole package, so there is no prefix to compare:
    // the name and the type decide, as in FigCraft.
    // Known gaps: an opened package named 'Untitled package' or 'Atomic sample' saves as a new file
    // each time; another package saved through 'Save package' under the opened name saves as the
    // document; a file that read with warnings has no path, and its saves go through 'Save
    // package', mostly under another name, as new files.
    async classify(save, entry) {
      if (save.name !== entry.savedName || NEW_PACKAGE.has(save.name)) return 'export';
      return hasMember(save.bytes, rootSbs(save.name)) ? 'document' : 'export';
    },
    // The host's language, through navigator.language on the first start and through the stored
    // settings later (see followHost).
    language(tag, util) {
      const key = util.matchLanguage(tag, LANGUAGES);
      if (!key) return null;
      util.preferLanguages(LANGUAGES[key]);
      try {
        return followHost(LANGUAGES[key]) ? key : null;
      } catch {
        return key; // no storage: MaterialCraft keeps nothing and reads navigator.language
      }
    },
  });
})();
