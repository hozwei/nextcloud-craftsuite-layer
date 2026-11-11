/*
 * craftsuite-layer adapter for TextureCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What TextureCraft (web build, checked with 0.5.0) does and why the
 * rules below follow from it is described in docs/apps/texturecraft.md. Source references are to
 * the v0.5.0 tag: web.rs is apps/texturecraft-web/src/web.rs, the other paths are under crates/.
 *  - index.html is a Trunk loader that dispatches TrunkApplicationStarted; eframe's drop listener
 *    is on canvas#texturecraft_canvas. Before eframe starts, the app bakes its sample project,
 *    'Material Ball' (web.rs initial_session): its drop listener comes about 10 s after
 *    TrunkApplicationStarted on a fast machine. It holds one project at a time.
 *  - A dropped .tcraft project or mesh (.glb, .obj, .fbx, ...) replaces the project
 *    (ui-egui/src/web_files.rs load): a .tcraft keeps the name stored in its project.json, a mesh
 *    makes a new project named after the file's stem. Dropped images and materials go into the
 *    open project instead.
 *  - Save, Save as and Save a copy (Ctrl+S, Ctrl+Shift+S, File menu) all download the whole
 *    project as '<name>.tcraft', the project's name made file-safe (web_files.rs save_project,
 *    formats/src/export/mod.rs sanitize_file_stem): a zip with project.json. Never an update of the
 *    opened bytes, no autosave in the browser. Exports are textures (PNG, a zip of several) and
 *    meshes (.glb, .usdz, .obj).
 *  - New projects are named 'Untitled' (New project, Close), the sample 'Material Ball'. A project
 *    file stores no identity of its project.
 *  - Files from the user: a drop from the desktop, or File > Open (Ctrl+O, an <input type=file>
 *    whose accept lists '.tcraft'). Both go through the `files` getters watched below.
 *  - The interface language: on the first start the browser's (navigator.language), then the one
 *    stored with the interface settings in localStorage ('ui.json', prefs.language), which the
 *    app writes with the language it started in (ui-egui/src/lib.rs new, i18n.rs os_language).
 *
 * Rule: a download is the document only if it has the name a save of the opened file gets
 * (savedName), that name is not a new project's, no file from the user would save under it, and
 * it is a TextureCraft project. Everything else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // The startup timeout core.js was given on its tag (data-startup-timeout, else its 60 s).
  const startupTimeout = (() => {
    const tag = document.querySelector('script[data-allowed-origins]');
    const n = Number(tag && tag.dataset.startupTimeout);
    return Number.isFinite(n) && n > 0 ? n : 60000; // as core.js reads it
  })();

  // The languages the web build shows (0.5.0), BCP 47 tag -> TextureCraft's code. Left out: ko and
  // zh-Hans, which it shows without letters on the web (no font for their scripts).
  const LANGUAGES = { en: 'en', fr: 'fr', de: 'de', es: 'es', 'pt-BR': 'pt-BR', it: 'it', ja: 'ja', ar: 'ar' };

  // Rust's Path::file_stem and extension() for a file name.
  const stem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };
  const ext = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  };
  // sanitize_file_stem: up to 200 characters, each but ASCII letters, digits, '_', '.' and '-'
  // becomes '_'; nothing but dots becomes 'texture'; a Windows device name gets a leading '_'.
  const fileStem = (name) => {
    let out = [...name].slice(0, 200).map((c) => (/^[A-Za-z0-9_.-]$/.test(c) ? c : '_')).join('');
    if (out.replace(/\./g, '') === '') out = 'texture';
    const device = out.split('.')[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/.test(device)) out = '_' + out;
    return out;
  };
  // What new projects save under (engine/src/project_cmds.rs, engine/src/file_cmds.rs).
  const NEW_PROJECT = new Set(['Untitled.tcraft', 'Material_Ball.tcraft']);

  // A zip member found through the central directory, unpacked up to MAX_JSON bytes; null for
  // anything else. Enough for project.json (TextureCraft writes it deflated).
  const MAX_JSON = 256 * 1024 * 1024;
  const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const isZip = (bytes) => bytes.length >= 22 && u32(bytes, 0) === 0x04034b50;
  const entryData = (bytes, wanted) => {
    let end = -1; // the end of central directory record, within the last 64 KiB + 22 bytes
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
      if (u32(bytes, i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) return null;
    let at = u32(bytes, end + 16);
    for (let n = u16(bytes, end + 10); n > 0 && at + 46 <= bytes.length && u32(bytes, at) === 0x02014b50; n--) {
      const nameLength = u16(bytes, at + 28);
      if (ascii(bytes, at + 46, nameLength) === wanted) {
        const method = u16(bytes, at + 10);
        let size = u32(bytes, at + 20);
        let local = u32(bytes, at + 42);
        // TextureCraft writes ZIP64 entries (large_file): a size or offset of 0xffffffff is in the
        // ZIP64 extra field, after the uncompressed size if that is 0xffffffff too.
        if (size === 0xffffffff || local === 0xffffffff) {
          const u64 = (i) => u32(bytes, i) + u32(bytes, i + 4) * 2 ** 32;
          for (let x = at + 46 + nameLength, xEnd = x + u16(bytes, at + 30); x + 4 <= xEnd && x + 4 <= bytes.length; x += 4 + u16(bytes, x + 2)) {
            if (u16(bytes, x) !== 1) continue;
            let p = x + 4 + (u32(bytes, at + 24) === 0xffffffff ? 8 : 0);
            if (size === 0xffffffff) { size = u64(p); p += 8; }
            if (local === 0xffffffff) local = u64(p);
            break;
          }
        }
        if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) return null;
        const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
        return start + size <= bytes.length ? { method, data: bytes.subarray(start, start + size) } : null;
      }
      at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    }
    return null;
  };
  const inflate = async (data) => {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
        if (size > MAX_JSON) return null;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  };

  // The project of a .tcraft file: its project.json (formats/src/project_file/mod.rs), or null.
  // Kept per byte array: savedName() and classify() ask about the same bytes.
  const projects = new WeakMap();
  const projectOf = (bytes) => {
    if (!projects.has(bytes)) {
      projects.set(bytes, (async () => {
        const entry = isZip(bytes) && entryData(bytes, 'project.json');
        if (!entry || (entry.method !== 0 && entry.method !== 8) || (entry.method === 0 && entry.data.length > MAX_JSON)) return null;
        const json = entry.method === 8 ? await inflate(entry.data) : entry.data;
        const project = json && JSON.parse(new TextDecoder().decode(json));
        return project && typeof project === 'object' && typeof project.name === 'string' ? project : null;
      })().catch(() => null));
    }
    return projects.get(bytes);
  };

  // The name a save of the project TextureCraft opens from this file gets (see the header). A
  // .tcraft it cannot read leaves the project it had; then the stem is a guess that saves of that
  // project rarely match.
  const savedName = async (name, bytes) => {
    const project = ext(name) === 'tcraft' ? await projectOf(bytes) : null;
    return fileStem(project ? project.name : stem(name)) + '.tcraft';
  };

  // The names that files from the user save under: a drop from the desktop (the core's drop is
  // synthetic, isTrusted false, and does not count) and files read from File > Open, whose
  // picker lists '.tcraft' (the imports of images, materials, meshes for baking and HDRs do not,
  // and keep what they read inside the project). eframe reads drops through DataTransfer.files,
  // rfd's picker through the input's files; should a release read them another way, such files
  // go unnoticed (docs/apps/texturecraft.md). Images and materials dropped from the desktop count
  // too, which costs nothing: their stems rarely name the opened project.
  const userNames = new Set();
  const reading = new Set();
  const noteUserFile = (file) => {
    userNames.add(fileStem(stem(file.name)) + '.tcraft');
    const read = (async () => {
      if (file.size > MAX_JSON) return;
      userNames.add(await savedName(file.name, new Uint8Array(await file.arrayBuffer())));
    })().catch(() => undefined).finally(() => reading.delete(read));
    reading.add(read);
  };
  const watchFiles = (proto, counts) => {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'files');
    if (!desc || typeof desc.get !== 'function' || !desc.configurable) return;
    const seen = new WeakSet();
    Object.defineProperty(proto, 'files', {
      ...desc,
      get() {
        const list = desc.get.call(this);
        try {
          if (list) for (const file of list) if (file instanceof File && !seen.has(file) && counts(this)) { seen.add(file); noteUserFile(file); }
        } catch { /* never break the app's read */ }
        return list;
      },
    });
  };
  watchFiles(window.DataTransfer && DataTransfer.prototype, () => {
    const event = window.event; // the drop being dispatched, if any
    return !!event && event.type === 'drop' && event.isTrusted;
  });
  watchFiles(window.HTMLInputElement && HTMLInputElement.prototype,
    (input) => input.type === 'file' && /(^|,)\s*\.tcraft\s*(,|$)/i.test(input.accept));

  // The language TextureCraft stores. It writes its interface settings, prefs.language among them,
  // to localStorage 'ui.json' with the language it started in, and from then on starts in that one
  // (ui-egui/src/ui_state_store.rs, state.rs Prefs; a missing language means English, not the
  // browser's). So the host's language would apply only once. The adapter keeps, under a key of
  // its own, the language it had TextureCraft start in; while the stored one is that, TextureCraft
  // reads the host's language instead. A language the user picks in TextureCraft is another one:
  // the adapter's key goes, and TextureCraft's own rule applies, as for a language stored before
  // this adapter. Returns whether TextureCraft starts in `code`.
  const UI_KEY = 'ui.json';
  const OWN_KEY = 'craftsuite-layer:texturecraft:language';
  const followHost = (code) => {
    const storage = window.localStorage;
    const { getItem, setItem, removeItem } = Storage.prototype;
    const stored = (value) => {
      try {
        const ui = JSON.parse(value);
        const language = ui && ui.prefs && ui.prefs.language;
        return typeof language === 'string' ? { ui, language } : null;
      } catch {
        return null; // unreadable: TextureCraft keeps it aside and starts with defaults
      }
    };
    const current = stored(getItem.call(storage, UI_KEY));
    if (current && current.language !== code && current.language !== getItem.call(storage, OWN_KEY)) return false;
    Storage.prototype.getItem = function (key) {
      const value = getItem.call(this, key);
      if (this !== storage || key !== UI_KEY || value === null) return value;
      // TextureCraft reads its settings back after writing them (ui_state_store.rs write_storage):
      // what it wrote in the host's language comes back as it is.
      const found = stored(value);
      if (!found || found.language === code || found.language !== getItem.call(storage, OWN_KEY)) return value;
      found.ui.prefs.language = code;
      return JSON.stringify(found.ui, null, 2);
    };
    Storage.prototype.setItem = function (key, value) {
      if (this === storage && key === UI_KEY) {
        const found = stored(String(value));
        if (found && found.language === code) setItem.call(storage, OWN_KEY, code);
        else if (found) removeItem.call(storage, OWN_KEY);
      }
      return setItem.call(this, key, value);
    };
    return true;
  };

  window.craftsuiteLayer.register({
    app: 'texturecraft',
    // TextureCraft takes drops only after baking its sample project (see the header), which may
    // take as long as the whole start on a slow machine; a browser without WebGL2 is then
    // reported this much later.
    dropTargetTimeout: startupTimeout,
    // An opened file saves as '<project name>.tcraft' (see the header). If that is not the opened
    // name (a mesh, or a project named otherwise than its file), the host keeps the file and
    // stores the saves in a new file next to it.
    savedName,
    // 'document' may replace the opened file (or the file the host stored next to it); everything
    // else becomes a new file. Save rewrites the whole project, so there is no prefix to compare:
    // the name and the type decide, as in FigCraft.
    // Known gaps: an opened project named 'Untitled' or 'Material Ball' saves as a new file each
    // time; a new project given the opened project's name saves as the document.
    async classify(save, entry) {
      if (save.name !== entry.savedName || NEW_PROJECT.has(save.name)) return 'export';
      await Promise.all([...reading]);
      if (userNames.has(save.name)) return 'export';
      return (await projectOf(save.bytes)) ? 'document' : 'export';
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
        return key; // no storage: TextureCraft keeps nothing and reads navigator.language
      }
    },
  });
})();
