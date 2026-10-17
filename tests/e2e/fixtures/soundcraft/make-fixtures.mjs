// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the SoundCraft fixture. It is committed; run this only to change it:
//   node tests/e2e/fixtures/soundcraft/make-fixtures.mjs
//
// craftsuite-probe.scraftz  a session bundle as SoundCraft's web build saves one: a zip of stored
//                           entries holding 'craftsuite-probe.scraft' (the session, pretty JSON,
//                           format_version 1) and its audio under 'Audio Files/'. Two mono audio
//                           tracks, 'Tone A' (440 Hz) and 'Tone B' (660 Hz), each with one clip of
//                           0.1 s of its own tone (16-bit PCM, 48 kHz); the stored session name is
//                           the file's stem, the session comments are MARKER, and only Tone A is
//                           selected (edit.selected_tracks), so File > Export > Selected Tracks as
//                           New Session writes a part of it under the opened name.
//
// The session has the fields and values SoundCraft 0.6.1 writes for two WAVs dropped onto an empty
// session (crates/model/src/session.rs, track.rs, mixer.rs at v0.6.1); 0.7.0 reads it as well.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-sc01';
const RATE = 48000;
const FRAMES = 4800; // 0.1 s

// One tone as a mono 16-bit PCM WAV.
function toneWav(hz) {
  const wav = Buffer.alloc(44 + FRAMES * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + FRAMES * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(FRAMES * 2, 40);
  for (let i = 0; i < FRAMES; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * hz * i / RATE)), 44 + i * 2);
  return wav;
}

const fade = { len: 0, shape: 'EqualPower' };
const nulls = () => Array(10).fill(null);
// An audio track with one clip of the whole source, as an import onto a new track makes it.
const track = (id, name, color, clip, source) => ({
  id, name, kind: 'Audio', format: 'Mono', color, height: 'Medium',
  playlists: [{
    name,
    clips: [{
      id: clip, name, start: 0, length: FRAMES, content: { Audio: { source, offset: 0 } }, gain_db: 0, gain_env: [],
      fade_in: fade, fade_out: fade, muted: false, edit_locked: false, time_locked: false, rating: 0, sync_point: 0,
      color: null, stretch: 1, group: null,
    }],
  }],
  active_playlist: 0,
  mixer: {
    volume_db: 0, pan: [0], mute: false, solo: false, solo_safe: false, record_arm: false, input_monitor: false,
    phase_invert: false, input: 'None', output: 'Main', inserts: nulls(), sends: nulls(), automation_mode: 'Read',
    trim_db: 0, vca: null, surround: null,
  },
  automation: [], view: 'waveform', hidden: false, inactive: false, frozen: false, comments: '', folder: null,
  folder_open: true, instrument: null, ticks_timebase: false, elastic: null, pinned: false,
});
const source = (id, name) => ({
  id, name, path: `Audio Files/${name}.wav`, channels: 1, frames: FRAMES, sample_rate: RATE, format: 'Wav',
  time_reference: 0, unsaved: false,
});

export function session(name) {
  return {
    format_version: 1, name, sample_rate: RATE, bit_depth: 'Int24', frame_rate: 'Fps30', timecode_start: 0,
    tempo: { tempos: [{ tick: 0, bpm: 120 }], meters: [{ tick: 0, numerator: 4, denominator: 4 }] },
    key_signatures: [],
    tracks: [track(2, 'Tone A', [86, 132, 214], 3, 1), track(5, 'Tone B', [94, 170, 214], 6, 4)],
    sources: [source(1, 'Tone A'), source(4, 'Tone B')],
    videos: [], busses: [], outputs: [{ name: 'Out 1-2', first_channel: 0, format: 'Stereo' }], markers: [], groups: [],
    edit: {
      tool: 'Smart', edit_mode: 'Slip', selection: { start: 0, end: 0 }, selected_tracks: [2], selected_clips: [],
      selected_sources: [], playhead: 0, grid: { Note: { value: 'Sixteenth', dotted: false, triplet: false } },
      nudge: { Seconds: 1 }, grid_lines: true, main_counter: 'MinSecs', sub_counter: 'Samples',
      zoom: { samples_per_px: 1024, scroll: 0, waveform_zoom: 1, presets: [64, 256, 1024, 4096, 16384] },
      rulers: ['bars_beats', 'min_secs', 'tempo', 'meter', 'markers'], link_timeline_edit: true, link_track_edit: false,
      insertion_follows_playback: false, loop_playback: false, pre_post_roll: false, pre_roll: 96000, post_roll: 96000,
      tab_to_transient: false, automation_follows_edit: true, markers_follow_edit: false, layered_editing: false,
      mirrored_midi: false, click: false, countoff: false, countoff_bars: 2, midi_merge: false, record_mode: 'normal',
      loop_record: false, quickpunch: false, scrolling: 'page', solo_mode: 'sip', pre_fader_metering: false,
      delay_compensation: true, keyboard_focus: 'commands', timeline_selection: { start: 0, end: 0 },
      flags: ['view.clip.gain_line', 'view.clip.name', 'view.clip.overlap_shadows', 'view.marker.ruler_lines', 'waveform.peak'],
      values: {},
    },
    next_id: 7, comments: MARKER, midi_originals: {},
  };
}

// A bundle: the audio first and the session last, stored, as SoundCraft writes it
// (crates/engine/src/io.rs session_bundle); a fixed time keeps the bytes the same on every run.
export function bundle(doc) {
  const mtime = new Date('2026-01-02T03:04:00Z');
  return Buffer.from(zipSync({
    'Audio Files/Tone A.wav': [toneWav(440), { mtime }],
    'Audio Files/Tone B.wav': [toneWav(660), { mtime }],
    [`${doc.name}.scraft`]: [strToU8(JSON.stringify(doc, null, 2)), { mtime }],
  }, { level: 0 }));
}

writeFileSync(path.join(here, 'craftsuite-probe.scraftz'), bundle(session('craftsuite-probe')));
