/*
 * craftsuite-layer adapter for FilmCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What FilmCraft (web build, checked with 0.6.0) does and why the rules
 * below follow from it is described in docs/apps/filmcraft.md (source references to the v0.6.0
 * tag; web/ is apps/filmcraft-web/, the other paths are under crates/):
 *  - The page is no Trunk build: its module script awaits the .wasm and calls start()
 *    (web/web/index.html) and never dispatches TrunkApplicationStarted. start() installs the drop
 *    listeners (on window, capture phase, web/src/import.rs:235-250) before the graphics start
 *    and removes #loading only once they run (web/src/lib.rs:145-226). If they cannot start, the
 *    page writes 'FilmCraft failed to start: ...' into #status with class 'err', after reloading
 *    itself once with ?webgl when the error names WebGPU. A drop that comes before the graphics
 *    waits for them, forever if they fail, so started() waits for #loading to go.
 *  - At start FilmCraft reopens the unsaved changes of an earlier session (a recovery snapshot in
 *    the origin's storage, OPFS) and registers every media file an earlier session copied there
 *    (web/src/lib.rs:139-141, recovery.rs). Its own flag `fresh` turns both off (it includes
 *    `norecover`, which only skips the snapshot). The adapter adds it to the frame's address
 *    before the page's module reads it.
 *  - The drop handler does not check isTrusted. A dropped *.fcproj (any letter case) opens as the
 *    project at '/projects/<file name>', replacing the open one without asking (import.rs:136-156);
 *    every other file is imported into the open project as media. With nothing else open that is
 *    the demo project ('FilmCraft Demo'). Projects refer to media by path ('/files/<name>').
 *  - Every download is a Blob (application/octet-stream) behind a clicked <a download>, named
 *    after the part of the path after its last '/' (web/src/fs.rs:409-437).
 *  - Save (Ctrl+S) of an opened project writes '/projects/<opened name>' without a dialog: the
 *    whole project as compact JSON ({"format":"filmcraft.project","schema_version":15,...,
 *    "project":{...},"view":{...}}), never an update of the opened bytes. Save As (Ctrl+Shift+S)
 *    writes '<project name>.fcproj' (ui-egui/src/lib.rs:1219-1225, web hook import.rs:265). Both
 *    rename the project after the file's stem (engine/src/commands.rs:3804-3822). Save a Copy
 *    (Ctrl+Alt+S) writes '<project name> copy.fcproj' and renames nothing, so for an opened
 *    '<name> copy.fcproj' that still stores <name> it has the opened name. The first Save of a
 *    file in an older schema first downloads the original bytes as
 *    '<stem> (schema vN backup).fcproj' (commands.rs:3826-3835).
 *  - Projects FilmCraft makes itself are named 'Untitled' (File > New > Project, Close Project) or
 *    'FilmCraft Demo' (the demo project), not translated. A project file stores no identity (no
 *    GUID, no creation time), so a save named 'Untitled.fcproj' or 'FilmCraft Demo.fcproj' cannot
 *    be told from a new project's.
 *  - Only Save, Save As and Save a Copy write the editor view ("view"); Export Selection as
 *    Project ('<name> Selection.fcproj', a subset of the project stored under its file's stem,
 *    engine/src/project_tools.rs:788-807) and Save as Template do not.
 *  - FilmCraft refuses a project from a newer schema or one it cannot read (format/src/lib.rs:178-
 *    258) and keeps the project it had open. A save in an older schema than the opened file, or of
 *    a file that is no project, is never that file.
 *  - Project files can also come from the user: a drop from the desktop, or File > Open Project
 *    (an <input type=file>, or the File System Access picker, which Chromium blocks in a frame of
 *    another origin). They open under their own name, which may be the opened one.
 *
 * Rule: a download is the document only if the opened file and the download are *.fcproj, the
 * download has the opened name or the Save As name (savedName), its stem is not a name FilmCraft
 * gives its own projects, the opened file was a project FilmCraft reads, the download is a
 * project with "view" in a schema not older than the opened file's, its stored name is the stem
 * of its file name (Save and Save As rename the project, Save a Copy does not), and no project
 * file came from the user in this frame. Everything else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // FilmCraft's own query flags (web/src/lib.rs:119-121, 139-141): `fresh` keeps the recovery
  // snapshot of an earlier session and its media copies in the browser's storage closed. Added to
  // the address as it is, before the page's module reads it; a reload (also FilmCraft's own
  // ?webgl reload, which keeps the query) keeps it.
  const FLAGS = ['fresh'];
  try {
    const present = new URLSearchParams(location.search);
    const missing = FLAGS.filter((flag) => !present.has(flag));
    if (missing.length) history.replaceState(history.state, '', (location.search ? location.search + '&' : '?') + missing.join('&') + location.hash);
  } catch { /* leave the address as it is */ }

  const LOADING = 'loading';
  const STATUS = 'status';
  const START_WAIT_MS = 120000;
  const MAX_PROJECT = 512 * 1024 * 1024; // larger files are not parsed: never the document
  const FORMAT = 'filmcraft.project';
  const PROJECT = /\.fcproj$/i;

  // The name without its last extension, as Rust's Path::file_stem gives it (commands.rs:3805).
  const stem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };
  // Names FilmCraft gives the projects it creates (engine/src/commands.rs:845, clip_ops.rs:828,
  // lib.rs:462; demo.rs:45, 52). Not translated.
  const APP_MADE = new Set(['Untitled', 'FilmCraft Demo']);

  // A file's JSON object, or null: UTF-8 JSON whose first character is '{'.
  const json = (bytes) => {
    if (bytes.length > MAX_PROJECT) return null;
    let at = 0;
    while (at < bytes.length && (bytes[at] === 0x20 || bytes[at] === 0x09 || bytes[at] === 0x0a || bytes[at] === 0x0d)) at++;
    if (bytes[at] !== 0x7b) return null;
    try {
      const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : null;
    } catch {
      return null;
    }
  };

  // {schema, name} of a project as FilmCraft detects its schema (format/src/lib.rs probe_version,
  // check_supported), else null. A field that is null counts as missing, as for serde. An envelope
  // has schema_version (a u32 from OLDEST_SCHEMA, 1, on) and a format that is missing or FilmCraft's;
  // a bare project from before the envelope has items and root, and a version of 0 to 2 means
  // schema 1, a higher one itself. A schema newer than the app's is kept: the comparison with the
  // save's schema in classify() stands for FilmCraft's refusal.
  const u32 = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
  const projectInfo = (doc) => {
    if (!doc) return null;
    if (doc.format != null && doc.format !== FORMAT) return null;
    if (doc.schema_version != null) {
      if (!u32(doc.schema_version) || doc.schema_version < 1) return null;
      const p = doc.project;
      return p && typeof p === 'object' ? { schema: doc.schema_version, name: p.name } : null;
    }
    if (doc.items == null || doc.root == null) return null;
    const version = doc.version ?? 1;
    if (!u32(version)) return null;
    return { schema: version <= 2 ? 1 : version, name: doc.name };
  };

  // The schema of each opened project, by opened name (null: not a project FilmCraft opens), and
  // of each save recognised as the document, by its name: the core keeps a stored save as the
  // reference for later saves under that name.
  const schemas = new Map();

  // Project files the app read from a user's own drop or from its file picker. The core's drop is
  // synthetic (isTrusted false) and does not count. FilmCraft 0.6.0 reads drops through
  // DataTransfer.files, its <input type=file> through files and its File System Access picker
  // through FileSystemFileHandle.getFile (import.rs); should a release read them another way, such
  // files go unnoticed again (see docs/apps/filmcraft.md, known gaps). Once one came in, the open
  // project may be another than the host's file, so no later save in this frame is the document.
  let foreignProject = false;
  const noteForeign = (file) => {
    if (file instanceof File && PROJECT.test(String(file.name))) foreignProject = true;
  };
  const watchFiles = (proto, counts) => {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'files');
    if (!desc || typeof desc.get !== 'function' || !desc.configurable) return;
    Object.defineProperty(proto, 'files', {
      ...desc,
      get() {
        const list = desc.get.call(this);
        try {
          if (list && counts(this)) for (const file of list) noteForeign(file);
        } catch { /* never break the app's read */ }
        return list;
      },
    });
  };
  watchFiles(window.DataTransfer && DataTransfer.prototype, () => {
    const event = window.event; // the drop being dispatched, if any
    return !!event && event.type === 'drop' && event.isTrusted;
  });
  watchFiles(window.HTMLInputElement && HTMLInputElement.prototype, (input) => input.type === 'file');
  const handle = window.FileSystemFileHandle && FileSystemFileHandle.prototype;
  if (handle && typeof handle.getFile === 'function') {
    const getFile = handle.getFile;
    handle.getFile = function (...args) {
      const result = getFile.apply(this, args);
      try {
        result.then(noteForeign, () => undefined);
      } catch { /* never break the app's read */ }
      return result;
    };
  }

  // The interface language: FilmCraft follows navigator.languages (preference 'system', which the
  // web build never stores otherwise) on its first frame (ui-egui/src/lib.rs:640-657,
  // ui-egui/src/i18n/mod.rs:91-123). Left out: Chinese, which the web build refuses for want of a font.
  const LANGUAGES = { en: 'en', de: 'de', es: 'es', fr: 'fr', ja: 'ja', 'pt-BR': 'pt-br', ru: 'ru', uk: 'uk' };

  window.craftsuiteLayer.register({
    app: 'filmcraft',
    language(tag, util) {
      const key = util.matchLanguage(tag, LANGUAGES);
      if (key) util.preferLanguages(LANGUAGES[key]);
      return key;
    },
    // The core's default drop target fits: the listener is on window, and the first <canvas> is
    // FilmCraft's (canvas#filmcraft_canvas).
    // Ready once the graphics run (#loading removed); failed when the page shows why they do not.
    // The core's own start timers need TrunkApplicationStarted, so the deadline is this one.
    started() {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + START_WAIT_MS;
        const check = () => {
          if (!document.getElementById(LOADING)) return resolve();
          const status = document.getElementById(STATUS);
          if (status && status.classList.contains('err')) {
            const text = status.textContent.replace(/^\s*FilmCraft failed to start:/, '').replace(/\s+/g, ' ').trim();
            return reject(new Error('the app failed to start: ' + text.slice(0, 300)));
          }
          if (Date.now() > deadline) return reject(new Error('the app did not start in time'));
          setTimeout(check, 50);
        };
        check();
      });
    },
    // Save As of an opened project writes '<stored project name>.fcproj', named after what follows
    // the last '/'. Anything else is saved, if at all, under the opened name.
    savedName(name, bytes) {
      if (!PROJECT.test(name)) return name;
      const info = projectInfo(json(bytes));
      schemas.set(name, info ? info.schema : null);
      if (!info || typeof info.name !== 'string') return name;
      return (info.name + '.fcproj').split('/').pop();
    },
    // 'document' may replace the opened project (or, under the Save As name, the file the host
    // stored next to it); everything else becomes a new file. Media and interchange files are
    // imported, never saved back: their names reach here only for an export named like them.
    // Known gap: another project with the opened name that reaches FilmCraft some other way than
    // the user's drop or picker (none in 0.6.0).
    classify(save, entry) {
      if (!PROJECT.test(entry.name) || !PROJECT.test(save.name)) return 'export';
      if (APP_MADE.has(stem(save.name)) || foreignProject) return 'export';
      const opened = schemas.get(entry.name);
      if (!opened) return 'export'; // FilmCraft could not open that file
      const doc = json(save.bytes);
      const info = projectInfo(doc);
      // No view: Export Selection as Project, whose subset of an opened '<N> Selection.fcproj'
      // that stores N has the opened name and is stored as its stem (project_tools.rs:802-804).
      if (!info || doc.format !== FORMAT || !doc.view || typeof doc.view !== 'object') return 'export';
      if (info.schema < opened) return 'export';
      if (info.name !== stem(save.name)) return 'export'; // Save a Copy, or another project
      schemas.set(save.name, info.schema);
      return 'document';
    },
  });
})();
