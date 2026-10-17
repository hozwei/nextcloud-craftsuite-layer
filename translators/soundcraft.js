/*
 * craftsuite-layer adapter for SoundCraft
 * SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load right after core.js. What SoundCraft (web build, checked with 0.6.1 and 0.7.0) does and why
 * the rules below follow from it is described in docs/apps/soundcraft.md. Source references are
 * to the v0.7.0 tag (0.6.1 does the same unless noted); web.rs is apps/soundcraft-web/src/web.rs,
 * the other paths are under crates/.
 *  - index.html is a Trunk loader that dispatches TrunkApplicationStarted. eframe's only `drop`
 *    listener, on canvas#soundcraft_canvas, comes once the graphics and the app exist (web.rs
 *    start()), so the core's default drop target and `ready` fit. The drop handler does not check
 *    isTrusted.
 *  - The app opens its demo session 'Midnight Groove' at start, or an empty session 'Untitled' when
 *    the query contains `empty` anywhere (web.rs start(), query().contains). The adapter adds the
 *    flag with history.replaceState before the module reads it, only where the core is active, so
 *    a file SoundCraft cannot open leaves an empty 'Untitled' open, not the demo.
 *  - A dropped *.scraftz or *.scraft (any case) opens as the session and replaces the open one
 *    without asking (web.rs handle(), engine/src/io.rs open_session_bytes); its path becomes
 *    '<sanitize_name(stem)>.scraftz', its stored name stays. MIDI files import as instrument tracks,
 *    every other file as audio. Bundles must be stored zips; the app reads no deflate.
 *  - Every download goes through web.rs download(): a Blob behind an <a download> that is clicked
 *    and removed at once.
 *  - Save Session (Ctrl+S, Cmd+S where egui sees a Mac) of a session with a path writes
 *    '<sanitize_name(stem of the path)>.scraftz' at once, with no dialog, and renames the session
 *    after it (io.rs save_session_bundle): a zip of stored entries, the session as pretty JSON in
 *    '<name>.scraft' and every source as 32-bit float WAV under 'Audio Files/' (session_bundle).
 *    Without a path, Save and Save As ask for the name in a dialog (ui-egui/src/dialogs.rs).
 *  - File > Export > Selected Tracks as New Session… (no shortcut) writes the same bundle for a copy
 *    that keeps only the selected tracks and the Master tracks, under the name of its dialog, by
 *    default '<session name>.scraftz': the opened name once the session was saved, or when the file
 *    stores its own stem (engine/src/cmd/file.rs). It needs a selected track, and its copy keeps the
 *    selection, so in it every track but the Master tracks is selected. With every track selected,
 *    its bytes are those of a save.
 *  - Other downloads have other names (Bounce Mix '<name> Bounce.wav', .mid, .musicxml, .svg, Save
 *    As Template '<name>.scraft'); Save Session Copy In… fails in the browser. New sessions
 *    (File > New, Close Session, the empty start) are named 'Untitled'. A session stores no
 *    identity.
 *  - Sessions from the user: a drop from the desktop, or File > Open Session…, which reads an
 *    <input type=file> (rfd) and opens whatever file is picked as a session, whatever its name
 *    (web.rs take_path_prompt; the input's accept, '.scraftz,.scraft', is only a hint to the
 *    browser's picker). Both go through the `files` getters watched below.
 *  - Keys reach shortcuts only while no dialog is open and no text field has the focus
 *    (ui-egui/src/shortcuts.rs handle()); the name dialogs take Enter or their OK button.
 *
 * Rule: a download is the document only if the opened file and the download are *.scraftz, the
 * download has the name Save writes for the opened file (savedName), its stem is not 'Untitled', no
 * session file came from the user in this frame, it is a session bundle, and it cannot be an export
 * of selected tracks: it came right after the Save shortcut, with no other key or pointer press in
 * between, or one of its tracks other than a Master track is not selected, or none is. Everything
 * else becomes a new file.
 */
(() => {
  'use strict';
  if (!window.craftsuiteLayer) return; // core inactive (not framed, not configured, no https)

  // SoundCraft's query flag `empty` (web.rs start()), matched anywhere in the query. Added before
  // the page's module reads it; a reload keeps it.
  try {
    if (!location.search.includes('empty')) history.replaceState(history.state, '', (location.search ? location.search + '&' : '?') + 'empty' + location.hash);
  } catch { /* leave the address as it is */ }

  const BUNDLE = /\.scraftz$/i;
  const SESSION_FILE = /\.scraftz?$/i;
  const MAX_SESSION_TEXT = 64 * 1024 * 1024; // larger session texts are not parsed: never the document

  // The name without its last extension, as Rust's Path::file_stem gives it for these names.
  const fileStem = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };
  // engine/src/io.rs sanitize_name: anything but letters, digits, '-', '_', ' ' and '.' becomes
  // '_' (Rust's char::is_alphanumeric), then spaces at both ends and dots at the start go, then at
  // most 100 characters.
  const KEEP = /^[\p{Alphabetic}\p{N}\-_ .]$/u;
  const sanitizeName = (name) => {
    let out = '';
    for (const c of name) out += KEEP.test(c) ? c : '_';
    out = out.replace(/^ +| +$/g, '').replace(/^\.+/, '');
    return out ? Array.from(out).slice(0, 100).join('') : 'untitled';
  };

  // The core's safeName (core.js), which every download name passes before it reaches classify().
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

  // The session text of a bundle as the app finds it (io.rs read_bundle): the first entry at the
  // top level whose extension is 'scraft', stored, as UTF-8 JSON; null if there is none. Reads the
  // central directory, with the ZIP64 fields SoundCraft writes for every entry.
  const sessionOf = (bytes) => {
    try {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const u16 = (at) => view.getUint16(at, true);
      const u32 = (at) => view.getUint32(at, true);
      const u64 = (at) => Number(view.getBigUint64(at, true));
      if (bytes.length < 22 || u32(0) !== 0x04034b50) return null;
      let end = -1;
      for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
        if (u32(at) === 0x06054b50) { end = at; break; }
      }
      if (end < 0) return null;
      let count = u16(end + 10);
      let at = u32(end + 16);
      if ((count === 0xffff || at === 0xffffffff) && end >= 20 && u32(end - 20) === 0x07064b50) {
        const zip64 = u64(end - 12);
        if (u32(zip64) !== 0x06064b50) return null;
        count = u64(zip64 + 32);
        at = u64(zip64 + 48);
      }
      for (let i = 0; i < count; i++) {
        if (u32(at) !== 0x02014b50) return null;
        const method = u16(at + 10);
        let size = u32(at + 20);
        let full = u32(at + 24);
        let local = u32(at + 42);
        const nameLength = u16(at + 28);
        const extra = at + 46 + nameLength;
        const name = new TextDecoder().decode(bytes.subarray(at + 46, extra));
        // The ZIP64 field (id 1) holds what did not fit, in this order.
        for (let x = extra; x + 4 <= extra + u16(at + 30); x += 4 + u16(x + 2)) {
          if (u16(x) !== 1) continue;
          let field = x + 4;
          if (full === 0xffffffff) { full = u64(field); field += 8; }
          if (size === 0xffffffff) { size = u64(field); field += 8; }
          if (local === 0xffffffff) local = u64(field);
        }
        at = extra + u16(at + 30) + u16(at + 32);
        const dot = name.lastIndexOf('.');
        if (name.includes('/') || dot <= 0 || name.slice(dot + 1) !== 'scraft') continue;
        if (method !== 0 || size !== full || size > MAX_SESSION_TEXT || u32(local) !== 0x04034b50) return null;
        const start = local + 30 + u16(local + 26) + u16(local + 28);
        const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, start + size)));
        const ok = doc && typeof doc === 'object' && Number.isInteger(doc.format_version) && Array.isArray(doc.tracks) &&
          doc.edit && Array.isArray(doc.edit.selected_tracks);
        return ok ? doc : null;
      }
    } catch { /* not a bundle SoundCraft wrote */ }
    return null;
  };

  // Whether a session can be what Export > Selected Tracks as New Session writes: a track is
  // selected, and every track but the Master tracks is.
  const mayBeExportOfSelection = (doc) => {
    const selected = new Set(doc.edit.selected_tracks);
    const isSelected = (track) => !!track && selected.has(track.id);
    return doc.tracks.some(isSelected) && doc.tracks.every((track) => isSelected(track) || (!!track && track.kind === 'Master'));
  };

  // Session files the app read from a user's drop or from its file picker. The core's drop is
  // synthetic (isTrusted false) and does not count. eframe reads drops through
  // DataTransfer.files, rfd its <input type=file> through files; should a release read them
  // another way, such files go unnoticed (see docs/apps/soundcraft.md, known gaps). Once one came
  // in, the open session may be another than the host's file, so no later save is the document.
  // A drop opens as a session by its name (web.rs Purpose::of); the session picker opens any file
  // it is given, so every file read from it counts. rfd sets the picker's accept from the dialog's
  // filter: '.scraftz,.scraft' for sessions, the audio or MIDI types for the imports.
  let foreignSession = false;
  const SESSION_PICKER = /(^|,)\s*\.scraftz?\s*(,|$)/i;
  const watchFiles = (proto, counts) => {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'files');
    if (!desc || typeof desc.get !== 'function' || !desc.configurable) return;
    Object.defineProperty(proto, 'files', {
      ...desc,
      get() {
        const list = desc.get.call(this);
        try {
          if (list) for (const file of list) if (file instanceof File && counts(this, file)) foreignSession = true;
        } catch { /* never break the app's read */ }
        return list;
      },
    });
  };
  watchFiles(window.DataTransfer && DataTransfer.prototype, (_, file) => {
    const event = window.event; // the drop being dispatched, if any
    return !!event && event.type === 'drop' && event.isTrusted && SESSION_FILE.test(file.name);
  });
  watchFiles(window.HTMLInputElement && HTMLInputElement.prototype,
    (input, file) => input.type === 'file' && (SESSION_PICKER.test(input.accept) || SESSION_FILE.test(file.name)));

  // Whether the last key or pointer press was the user's Save shortcut (Ctrl+S, or Cmd+S under a
  // Mac user agent; no Shift or Alt). A save of a session with a path follows it in the app's next
  // frame, before any other input; an export needs its dialog's Enter or OK first. Modifier keys
  // alone and key repeats (which egui ignores for shortcuts) change nothing.
  let saveKey = false;
  const MODIFIERS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn', 'FnLock', 'Hyper', 'Meta', 'NumLock', 'OS', 'ScrollLock', 'Shift', 'Super', 'Symbol', 'SymbolLock']);
  window.addEventListener('keydown', (event) => {
    if (event.repeat || MODIFIERS.has(event.key)) return;
    saveKey = event.isTrusted && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey &&
      (event.code === 'KeyS' || String(event.key).toLowerCase() === 's');
  }, true);
  window.addEventListener('pointerdown', () => { saveKey = false; }, true);

  // Each session download, as the app clicks it: its name (as the core passes it on), its size
  // and whether it followed the Save shortcut. classify() runs later, once the core has read the
  // file, so this is noted at the click. The size tells two downloads of the same name apart.
  const sizes = new Map(); // blob URL -> size
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    const url = createObjectURL.call(URL, obj);
    if (obj instanceof Blob) sizes.set(url, obj.size);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    sizes.delete(url);
    return revokeObjectURL.call(URL, url);
  };
  const clicks = []; // {name, size, keyed}, oldest first; only the last few are kept
  const coreClick = HTMLAnchorElement.prototype.click;
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
    configurable: true,
    writable: true,
    value: function () {
      try {
        if (this.hasAttribute('download')) {
          if (BUNDLE.test(this.download)) clicks.push({ name: safeName(this.download), size: sizes.get(this.href), keyed: saveKey });
          if (clicks.length > 20) clicks.shift();
          saveKey = false;
        }
      } catch { /* never break the app's download */ }
      return coreClick.call(this);
    },
  });
  const followedSaveKey = (name, size) => {
    const at = clicks.findIndex((c) => c.name === name && c.size === size);
    return at >= 0 && clicks.splice(at, 1)[0].keyed;
  };

  window.craftsuiteLayer.register({
    app: 'soundcraft',
    // eframe's drop listener comes after the graphics and the app: 0.4-0.6 s after
    // TrunkApplicationStarted in Chromium with SwiftShader (in WebKit about with it). More room than
    // the default 3 s for slow machines; a browser without WebGPU and WebGL2 is then reported
    // this much later.
    dropTargetTimeout: 10000,
    // Save of an opened '<stem>.scraftz' writes '<sanitize_name(sanitize_name(stem))>.scraftz': the
    // open sets the path, the save takes the path's stem as the session name and names the file
    // after it (io.rs open_session_bytes, save_session_bundle). Other files keep their name.
    savedName(name) {
      if (!BUNDLE.test(name)) return name;
      return sanitizeName(sanitizeName(fileStem(name) || 'Untitled')) + '.scraftz';
    },
    // 'document' may replace the opened session (or, under a saved name that differs from the
    // opened one, the file the host stored next to it); everything else becomes a new file.
    // Known gaps: a new session the user saves under the opened name, typed into Save Session As;
    // File > Save Session with the pointer while every track is selected (a new file, see
    // docs/apps/soundcraft.md).
    classify(save, entry) {
      const keyed = followedSaveKey(save.name, save.bytes.length);
      if (!BUNDLE.test(entry.name) || !BUNDLE.test(save.name)) return 'export';
      if (fileStem(save.name).toLowerCase() === 'untitled' || foreignSession) return 'export';
      const doc = sessionOf(save.bytes);
      if (!doc) return 'export';
      if (!keyed && mayBeExportOfSelection(doc)) return 'export';
      return 'document';
    },
  });
})();
