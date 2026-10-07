/* Deepcut engine: catalog, similarity, Camelot logic, blueprint generation,
   Standard MIDI File writer, store-only ZIP writer, DJ-software exports,
   and in-browser BPM/key estimation. No dependencies. Works in browser + Node. */
(function (root) {
  'use strict';

  // ---------- seeded randomness ----------
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed));
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  // ---------- music theory ----------
  const NOTE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const MINOR_PC = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1]; // Camelot 1A..12A
  const MAJOR_PC = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4]; // Camelot 1B..12B

  function camInfo(cam) {
    const n = parseInt(cam, 10), l = cam.slice(-1).toUpperCase();
    const minor = l === 'A';
    const pc = (minor ? MINOR_PC : MAJOR_PC)[n - 1];
    return { n, l, minor, pc, name: NOTE[pc] + (minor ? 'm' : ''), long: NOTE[pc] + (minor ? ' minor' : ' major') };
  }
  function camFrom(pc, minor) {
    const n = (minor ? MINOR_PC : MAJOR_PC).indexOf(((pc % 12) + 12) % 12) + 1;
    return n + (minor ? 'A' : 'B');
  }
  const ALL_CAMS = [];
  for (let i = 1; i <= 12; i++) { ALL_CAMS.push(i + 'A'); ALL_CAMS.push(i + 'B'); }

  // Harmonic compatibility from a reference key to a candidate key.
  function compat(refCam, cam) {
    const a = camInfo(refCam), b = camInfo(cam);
    const d = ((b.n - a.n) % 12 + 12) % 12;
    if (a.n === b.n && a.l === b.l) return { score: 3, label: 'Same key', cls: 'good' };
    if (a.l === b.l && (d === 1 || d === 11)) return { score: 3, label: (d === 1 ? '+1' : '−1') + ' Camelot', cls: 'good' };
    if (a.n === b.n) return { score: 2, label: 'Relative', cls: 'good' };
    if (a.l === b.l && d === 2) return { score: 1, label: 'Energy boost', cls: 'ok' };
    if (a.l === b.l && d === 7) return { score: 1, label: 'Semitone lift', cls: 'ok' };
    return { score: 0, label: 'Key clash', cls: 'bad' };
  }

  function bpmDelta(a, b) {
    // Treat half/double time as mixable (e.g. 172 jungle vs 86 halftime).
    const ratios = [1, 2, 0.5];
    let best = Infinity;
    for (const r of ratios) best = Math.min(best, Math.abs(b * r - a) / a);
    return best;
  }

  function transition(a, b) {
    const k = compat(a.cam, b.cam);
    const p = bpmDelta(a.bpm, b.bpm);
    const e = b.energy - a.energy;
    let grade = 'C';
    if (p <= 0.03 && k.score >= 2) grade = 'A';
    else if (p <= 0.06 && k.score >= 1) grade = 'B';
    const tips = [];
    if (p > 0.06) tips.push('big tempo jump: use a loop-out or echo cut');
    else if (p > 0.03) tips.push('ride the pitch over 16 bars');
    if (k.score === 0) tips.push('keys clash: mix on drums only, or key-shift');
    if (k.label === 'Energy boost') tips.push('+2 lift: drop it on the breakdown');
    if (e >= 3) tips.push('steep energy climb');
    if (e <= -3) tips.push('energy drop: good reset point');
    return { grade, key: k, bpmPct: p, energyDelta: e, tip: tips.join('; ') || 'smooth blend' };
  }

  // ---------- fictional demo catalog ----------
  // Feature axes: rhythm complexity, bass weight, grit, atmosphere, brightness, swing
  const AXES = ['Rhythm', 'Bass', 'Grit', 'Atmos', 'Bright', 'Swing'];
  const GENRES = {
    'deep house': { proto: [0.3, 0.6, 0.3, 0.7, 0.4, 0.6], style: 'four' },
    'house': { proto: [0.35, 0.65, 0.4, 0.5, 0.6, 0.5], style: 'four' },
    'techno': { proto: [0.4, 0.7, 0.75, 0.5, 0.4, 0.2], style: 'four' },
    'dub techno': { proto: [0.3, 0.6, 0.5, 0.9, 0.2, 0.3], style: 'four' },
    'minimal': { proto: [0.55, 0.5, 0.35, 0.4, 0.5, 0.4], style: 'four' },
    'electro': { proto: [0.6, 0.65, 0.6, 0.4, 0.6, 0.3], style: 'electro' },
    'breakbeat': { proto: [0.75, 0.6, 0.55, 0.4, 0.6, 0.5], style: 'breaks' },
    'jungle': { proto: [0.95, 0.85, 0.6, 0.6, 0.5, 0.6], style: 'breaks' },
    'uk garage': { proto: [0.7, 0.7, 0.4, 0.4, 0.7, 0.85], style: 'garage' },
    'ambient': { proto: [0.1, 0.2, 0.3, 1.0, 0.3, 0.2], style: 'ambient' },
  };
  const RAW = [
    ['Low Tide Telemetry', 'Mara Quell', 'Siltwork', 'dub techno', 122, '5A', 4, 2025],
    ['Copper Hours', 'Ilse Varro', 'Night Ledger', 'deep house', 121, '8A', 5, 2024],
    ['Fogbank Signals', 'Tomas Rielle', 'Siltwork', 'dub techno', 120, '4A', 3, 2023],
    ['Afterglow Index', 'Juno Halvard', 'Open Plan', 'house', 124, '9A', 6, 2026],
    ['Parallax Club', 'Kofi Ammel', 'Open Plan', 'house', 125, '8B', 7, 2025],
    ['Grain Silo', 'Hesper Unit', 'Concrete Choir', 'techno', 132, '6A', 8, 2026],
    ['Steel Pastoral', 'Hesper Unit', 'Concrete Choir', 'techno', 130, '5A', 7, 2024],
    ['Under Mercury', 'Vela Rook', 'Bright Basement', 'minimal', 126, '7A', 5, 2022],
    ['Small Machines', 'Odile Prenn', 'Bright Basement', 'minimal', 127, '8A', 6, 2025],
    ['Night Bus Theory', 'Arlo Fenwick', 'Two Step Mutual', 'uk garage', 132, '10A', 6, 2026],
    ['Southbound Lines', 'Pia Lowery', 'Two Step Mutual', 'uk garage', 134, '9A', 7, 2025],
    ['Rain Engine', 'Rook & Ferrier', 'Pressure Archive', 'jungle', 168, '4A', 8, 2024],
    ['Coastal Pressure', 'Delta Mowbray', 'Pressure Archive', 'jungle', 170, '5A', 9, 2026],
    ['Tin Roof Breaks', 'Sol Ibarra', 'Loose Grid', 'breakbeat', 132, '11A', 7, 2023],
    ['Elastic Weekend', 'Sol Ibarra', 'Loose Grid', 'breakbeat', 128, '12A', 6, 2025],
    ['Voltage Choir', 'Kestrel Data', 'Tangent Works', 'electro', 128, '2A', 7, 2026],
    ['Pylon Talk', 'Kestrel Data', 'Tangent Works', 'electro', 126, '3A', 6, 2024],
    ['Glasshouse Morning', 'Inez Albrecht', 'Slow Field', 'ambient', 90, '8B', 2, 2025],
    ['Paper Lanterns', 'Noor Castellan', 'Slow Field', 'ambient', 84, '7B', 1, 2023],
    ['Basement Bloom', 'Ilse Varro', 'Night Ledger', 'deep house', 122, '7A', 5, 2026],
    ['Humid Arcade', 'Juno Halvard', 'Open Plan', 'house', 123, '9B', 6, 2024],
    ['Iron Lung Lullaby', 'Hesper Unit', 'Concrete Choir', 'techno', 134, '4A', 9, 2025],
    ['Mothlight Dub', 'Mara Quell', 'Siltwork', 'dub techno', 118, '6A', 3, 2022],
    ['Late Shift Swing', 'Pia Lowery', 'Two Step Mutual', 'uk garage', 130, '8A', 5, 2026],
    ['Rewire Sequence', 'Odile Prenn', 'Bright Basement', 'minimal', 125, '9A', 5, 2024],
    ['Deep Water Bodies', 'Delta Mowbray', 'Pressure Archive', 'jungle', 172, '6A', 8, 2025],
    ['Static Orchard', 'Vela Rook', 'Bright Basement', 'deep house', 120, '6A', 4, 2025],
    ['Cathode Prayer', 'Tomas Rielle', 'Tangent Works', 'electro', 130, '1A', 8, 2026],
  ];
  const CATALOG = RAW.map((r, i) => {
    const [title, artist, label, genre, bpm, cam, energy, year] = r;
    const rr = rng(title + artist);
    const vec = GENRES[genre].proto.map(v => Math.max(0, Math.min(1, v + (rr() - 0.5) * 0.22)));
    vec[1] = Math.max(0, Math.min(1, vec[1] + (energy - 5) * 0.02));
    return { id: 't' + (i + 1), title, artist, label, genre, bpm, cam, energy, year, vec, style: GENRES[genre].style };
  });

  function similarity(a, b) {
    const w = [1.2, 1, 0.8, 1, 0.7, 0.9];
    let s = 0, ws = 0;
    for (let i = 0; i < w.length; i++) { s += w[i] * (a.vec[i] - b.vec[i]) ** 2; ws += w[i]; }
    const d = Math.sqrt(s / ws); // 0..1
    const tempo = 1 - Math.min(1, bpmDelta(a.bpm, b.bpm) / 0.25);
    const v = Math.max(0, 1 - d * 1.9) * 0.88 + tempo * 0.12;
    return Math.round(Math.max(1, Math.min(99, v * 100)));
  }

  function dig(ref, opts) {
    opts = opts || {};
    let rows = CATALOG.filter(t => t.id !== ref.id).map(t => {
      const k = compat(ref.cam, t.cam);
      return { t, sim: similarity(ref, t), key: k, bpmPct: bpmDelta(ref.bpm, t.bpm) };
    });
    if (opts.keyOnly) rows = rows.filter(r => r.key.score >= 1);
    if (opts.bpmWindow) rows = rows.filter(r => r.bpmPct <= opts.bpmWindow);
    if (opts.energy === 'up') rows = rows.filter(r => r.t.energy >= ref.energy);
    if (opts.energy === 'match') rows = rows.filter(r => Math.abs(r.t.energy - ref.energy) <= 2);
    const sort = opts.sort || 'sim';
    rows.sort((x, y) => sort === 'bpm' ? x.t.bpm - y.t.bpm : sort === 'energy' ? y.t.energy - x.t.energy : y.sim - x.sim);
    return rows;
  }

  function findRef(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const hit = CATALOG.find(t => (t.title + ' ' + t.artist).toLowerCase().includes(q) || q.includes(t.title.toLowerCase()));
    if (hit) return { track: hit, exact: true };
    // Unknown link or text: deterministic stand-in so the demo stays honest and repeatable.
    return { track: CATALOG[hash(q) % CATALOG.length], exact: false };
  }

  // Greedy harmonic ordering: start low energy, each step pick best next transition.
  function autoOrder(tracks) {
    if (tracks.length < 3) return tracks.slice();
    const left = tracks.slice().sort((a, b) => a.energy - b.energy || a.bpm - b.bpm);
    const out = [left.shift()];
    while (left.length) {
      const cur = out[out.length - 1];
      let bi = 0, bs = -Infinity;
      left.forEach((t, i) => {
        const tr = transition(cur, t);
        const s = { A: 3, B: 1.5, C: 0 }[tr.grade] - Math.abs(tr.energyDelta - 1) * 0.6 - tr.bpmPct * 10;
        if (s > bs) { bs = s; bi = i; }
      });
      out.push(left.splice(bi, 1)[0]);
    }
    return out;
  }

  // ---------- blueprint (producer template) ----------
  const STYLES = {
    four: { label: 'Four-to-the-floor (house / techno)' },
    breaks: { label: 'Breaks (breakbeat / jungle / DnB)' },
    garage: { label: '2-step (UK garage / bassline)' },
    electro: { label: 'Electro (syncopated kicks)' },
    ambient: { label: 'Ambient (beatless / drift)' },
  };
  const ARR = {
    four: [['Intro', 16, 1], ['Groove', 16, 2], ['Breakdown', 16, 0], ['Build', 8, 'b'], ['Drop', 32, 3], ['Break', 16, 1], ['Drop 2', 16, 3], ['Outro', 16, 1]],
    electro: [['Intro', 16, 1], ['Groove', 16, 2], ['Breakdown', 8, 0], ['Build', 8, 'b'], ['Drop', 32, 3], ['Break', 16, 1], ['Drop 2', 16, 3], ['Outro', 16, 1]],
    breaks: [['Intro', 32, 1], ['Build', 8, 'b'], ['Drop', 32, 3], ['Breakdown', 16, 0], ['Build 2', 8, 'b'], ['Drop 2', 32, 3], ['Outro', 16, 1]],
    garage: [['Intro', 16, 1], ['Verse', 16, 2], ['Hook', 16, 3], ['Verse 2', 16, 2], ['Hook 2', 16, 3], ['Breakdown', 8, 0], ['Hook 3', 16, 3], ['Outro', 16, 1]],
    ambient: [['Emerge', 16, 0], ['Drift', 32, 1], ['Swell', 16, 3], ['Dissolve', 16, 0]],
  };
  const DRUMS = {
    four: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', hat3: 'xxxxxxxxxxxxxxxx', ohat: '..x...x...x...x.', snareNote: 39 },
    electro: { kick: 'x.....x...x..x..', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', hat3: 'x.xxx.xxx.xxx.xx', ohat: '......x.......x.', snareNote: 39 },
    breaks: { kick: 'x.........xx....', snare: '....x.......x...', ghost: '.......x.x....x.', hat: 'x.x.x.x.x.x.x.x.', hat3: 'xxxxxxxxxxxxxxxx', ohat: '..............x.', snareNote: 38 },
    garage: { kick: 'x......x..x.....', snare: '....x.......x...', hat: '..x...x...x...x.', hat3: '..x.x.x...x.x.xx', ohat: '......x.......x.', snareNote: 38 },
    ambient: { kick: '................', snare: '................', hat: '..x...........x.', hat3: 'x...x...x...x...', ohat: '................', snareNote: 39 },
  };
  const BASS = {
    four: [[null, null, 0, null, null, null, 0, null, null, null, 0, null, null, null, 0, 12], [0, null, null, 0, null, null, 0, null, null, 0, null, null, 7, null, 0, null], [null, null, 0, 0, null, null, 0, null, null, null, 0, 0, null, 12, 0, null]],
    electro: [[0, null, null, 0, null, null, 12, null, 0, null, 10, null, 0, null, 7, null], [0, 0, null, 12, null, 0, null, 10, null, 0, null, 7, 0, null, 12, null]],
    breaks: [[0, null, null, null, null, null, null, null, null, null, 0, null, null, null, 7, null], [0, null, null, null, null, null, 12, null, null, null, 0, null, null, null, null, null]],
    garage: [[0, null, null, 0, null, null, null, 0, null, null, 0, null, null, 7, null, null], [0, null, null, null, null, null, 0, null, 12, null, null, 0, null, null, 10, null]],
    ambient: [[0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]],
  };
  const PROG = {
    minor: [[1, 6, 3, 7], [1, 4, 6, 5], [1, 7, 6, 7], [1, 3, 4, 6], [1, 4, 1, 6], [6, 7, 1, 1]],
    major: [[1, 5, 6, 4], [1, 4, 2, 5], [1, 6, 4, 5], [4, 1, 5, 6], [1, 3, 4, 4]],
  };
  const ROMAN = { minor: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'], major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'] };
  const SCALE = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11] };

  const PALETTE = {
    four: [['Drums', 'Geonkick (free) for kicks', 'Drum Rack · Drum Machine Designer · FPC'], ['Bass', 'Surge XT: init saw → LP 24 at 300 Hz', 'Operator · Retro Synth · Sytrus'], ['Chords', 'Vital: detuned stab, short release', 'Wavetable · Alchemy · FLEX'], ['Space', 'Dragonfly Hall: 2.4 s, 20% wet', 'Hybrid Reverb · ChromaVerb · Fruity Reeverb 2']],
    electro: [['Drums', 'Geonkick 808-style kick', 'Drum Rack · Drum Machine Designer · FPC'], ['Bass', 'Odin 2: square + sub, fast filter env', 'Analog · Retro Synth · 3x Osc'], ['Lead', 'OB-Xf: brassy poly lead', 'Wavetable · ES2 · Harmor'], ['Grit', 'Airwindows Console + tape', 'Saturator · Phat FX · Fruity Blood Overdrive']],
    breaks: [['Drums', 'Chop your own break; sfizz to play slices', 'Simpler (slice) · Quick Sampler · Slicex'], ['Bass', 'Surge XT: sine sub + reese layer', 'Operator · ES2 · Sytrus'], ['Pads', 'Vital: warm pad, slow attack', 'Wavetable · Alchemy · Harmor'], ['Space', 'Dragonfly Plate: 1.6 s', 'Reverb · ChromaVerb · Fruity Reeverb 2']],
    garage: [['Drums', 'Geonkick + swung hats (swing is in the MIDI)', 'Drum Rack · Drum Machine Designer · FPC'], ['Bass', 'Surge XT: organ-ish sub, glide on', 'Operator · Retro Synth · 3x Osc'], ['Chords', 'Dexed: E.Piano FM patch', 'Electric · Vintage EP · FL Keys'], ['Vox', 'Your own chopped vocal on the hook', 'Simpler · Quick Sampler · Slicex']],
    ambient: [['Pads', 'Vital: spectral morph pad, 4 s attack', 'Wavetable · Alchemy · Harmor'], ['Texture', 'Surge XT: noise + resonant filter sweep', 'Operator · Sculpture · Sytrus'], ['Keys', 'Dexed: glassy bell', 'Electric · Vintage EP · FL Keys'], ['Space', 'Dragonfly Hall: 6 s, 40% wet', 'Hybrid Reverb · Space Designer · Fruity Reeverb 2']],
  };

  function chordTones(pc, mode, degree, seventh) {
    const sc = SCALE[mode];
    const idx = degree - 1;
    const at = k => sc[(idx + k) % 7] + 12 * Math.floor((idx + k) / 7);
    const iv = [at(0), at(2), at(4)];
    if (seventh) iv.push(at(6));
    const rootPc = (pc + sc[idx]) % 12;
    const third = (iv[1] - iv[0] + 12) % 12, fifth = (iv[2] - iv[0] + 12) % 12;
    const q = fifth === 6 ? 'dim' : third === 3 ? 'm' : '';
    const sev = seventh ? (q === 'dim' ? 'ø7' : ((iv[3] - iv[0] + 12) % 12 === 11 ? 'maj7' : '7')) : '';
    let base = 48 + pc; if (base > 54) base -= 12;
    const notes = iv.map(v => { let n = base + v; while (n > 71) n -= 12; return n; }).sort((a, b) => a - b);
    return { degree, roman: ROMAN[mode][idx], name: NOTE[rootPc] + (q === 'dim' && seventh ? 'm' : q) + sev, rootPc, notes };
  }

  function blueprint(src, over) {
    over = over || {};
    const style = over.style || src.style || 'four';
    const bpm = Math.max(60, Math.min(200, Math.round(over.bpm || src.bpm)));
    const cam = over.cam || src.cam;
    const ki = camInfo(cam);
    const mode = ki.minor ? 'minor' : 'major';
    const r = rng((src.title || 'x') + '|' + style + '|' + cam + '|' + bpm);
    const swing = style === 'garage' ? 0.55 : (src.vec ? src.vec[5] * 0.25 : 0.1);
    const seventh = /deep|dub/.test(src.genre || '') || style === 'ambient' || style === 'garage';
    const progDeg = pick(r, PROG[mode]);
    const progression = progDeg.map(d => chordTones(ki.pc, mode, d, seventh));
    let start = 1;
    const sections = ARR[style].map(([name, bars, lvl]) => { const s = { name, bars, lvl, start }; start += bars; return s; });
    const totalBars = start - 1;
    const drums = DRUMS[style];
    const bass = pick(r, BASS[style]);
    const leadDensity = style === 'ambient' ? 0.18 : style === 'breaks' ? 0.35 : 0.5;
    const lead = Array.from({ length: 16 }, (_, i) => (i === 0 || r() < leadDensity) ? Math.floor(r() * 4) : null);
    const seconds = totalBars * 4 * 60 / bpm;
    return {
      title: src.title, artist: src.artist || '', sourceGenre: src.genre || 'custom',
      style, styleLabel: STYLES[style].label, bpm, cam, key: ki.long, keyShort: ki.name, pc: ki.pc, mode,
      swing: Math.round(swing * 100) / 100, sections, totalBars, seconds, progression, drums, bass, lead,
      palette: PALETTE[style],
    };
  }

  // ---------- MIDI writer (SMF type 1, 480 PPQ) ----------
  const PPQ = 480, STEP = PPQ / 4, BAR = PPQ * 4;
  function vlq(n) {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  }
  function strBytes(s) { const o = []; for (const ch of s) { const c = ch.charCodeAt(0); o.push(c < 128 ? c : 63); } return o; }
  function meta(type, data) { return [0xff, type, ...vlq(data.length), ...data]; }
  function trackChunk(events) {
    // events: {t, data[], order}
    events.sort((a, b) => a.t - b.t || a.order - b.order);
    const bytes = []; let last = 0;
    for (const e of events) { bytes.push(...vlq(e.t - last), ...e.data); last = e.t; }
    bytes.push(0, 0xff, 0x2f, 0);
    const len = bytes.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...bytes];
  }
  function noteEv(list, ch, t, dur, note, vel) {
    note = Math.max(0, Math.min(127, note)); vel = Math.max(1, Math.min(127, vel | 0));
    list.push({ t, order: 1, data: [0x90 | ch, note, vel] });
    list.push({ t: t + Math.max(1, dur), order: 0, data: [0x80 | ch, note, 0] });
  }

  function buildMidi(bp) {
    const swingTicks = Math.round(STEP * 0.33 * bp.swing);
    const at = (bar0, step) => bar0 * BAR + step * STEP + (step % 2 === 1 ? swingTicks : 0);
    const camN = camInfo(bp.cam).n;
    const sf = (((camN - 8) % 12 + 12 + 6) % 12) - 6;

    // Track 0: conductor
    const t0 = [];
    const name = (bp.title || 'Blueprint') + ' blueprint';
    t0.push({ t: 0, order: 0, data: meta(0x03, strBytes(name)) });
    t0.push({ t: 0, order: 0, data: meta(0x02, strBytes('Generated by Deepcut. Original material, free to use.')) });
    const us = Math.round(60000000 / bp.bpm);
    t0.push({ t: 0, order: 0, data: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) });
    t0.push({ t: 0, order: 0, data: meta(0x58, [4, 2, 24, 8]) });
    t0.push({ t: 0, order: 0, data: meta(0x59, [sf & 255, bp.mode === 'minor' ? 1 : 0]) });
    for (const s of bp.sections) t0.push({ t: (s.start - 1) * BAR, order: 0, data: meta(0x06, strBytes(s.name)) });
    t0.push({ t: bp.totalBars * BAR, order: 0, data: meta(0x06, strBytes('End')) });

    const drums = [], bass = [], chords = [], lead = [];
    const named = (list, n, ch, prog) => {
      list.push({ t: 0, order: 0, data: meta(0x03, strBytes(n)) });
      if (prog != null) list.push({ t: 0, order: 0, data: [0xc0 | ch, prog] });
    };
    named(drums, 'Drums', 9, null);
    named(bass, 'Bass', 0, 38);
    named(chords, 'Chords', 1, 89);
    named(lead, 'Hook sketch', 2, 81);

    const D = bp.drums;
    const on = (pat, i) => pat && pat[i] === 'x';
    for (const s of bp.sections) {
      for (let b = 0; b < s.bars; b++) {
        const bar0 = s.start - 1 + b;
        const chord = bp.progression[Math.floor(bar0 / 2) % bp.progression.length];
        const lvl = s.lvl;
        const isBuild = lvl === 'b';
        const lastBarOfBuild = isBuild && b === s.bars - 1;
        for (let i = 0; i < 16; i++) {
          const t = at(bar0, i);
          if (bp.style !== 'ambient') {
            if ((lvl >= 1 || (isBuild && !lastBarOfBuild)) && on(D.kick, i)) noteEv(drums, 9, t, STEP, 36, 112);
            if (lvl >= 2 && on(D.snare, i)) noteEv(drums, 9, t, STEP, D.snareNote, 100);
            if (lvl >= 3 && on(D.ghost, i)) noteEv(drums, 9, t, STEP, D.snareNote, 52);
            if (isBuild) {
              const div = b < s.bars / 2 ? 4 : b < s.bars - 2 ? 2 : 1;
              if (i % div === 0) noteEv(drums, 9, t, STEP / 2, D.snareNote, 60 + Math.round(55 * (b * 16 + i) / (s.bars * 16)));
            }
          }
          const hatPat = lvl >= 3 ? D.hat3 : D.hat;
          if ((lvl >= 1 || isBuild) && on(hatPat, i)) noteEv(drums, 9, t, STEP / 2, 42, i % 4 === 2 ? 92 : 64);
          if (lvl >= 3 && on(D.ohat, i)) noteEv(drums, 9, t, STEP, 46, 78);
          // bass
          const bv = bp.bass[i];
          if ((lvl >= 1 || isBuild) && !lastBarOfBuild && bv != null) {
            let len = 1; while (i + len < 16 && bp.bass[i + len] == null && len < (bp.style === 'ambient' ? 16 : bp.style === 'breaks' ? 8 : 2)) len++;
            let root = 36 + chord.rootPc; if (root > 43) root -= 12;
            noteEv(bass, 0, t, len * STEP - 10, root + bv, 100);
          }
          // hook sketch in peak sections
          if (lvl >= 3 && bp.lead[i] != null) {
            const tones = chord.notes.concat([chord.notes[0] + 12]);
            noteEv(lead, 2, t, STEP * (bp.style === 'ambient' ? 4 : 1) - 8, tones[bp.lead[i]] + 12, 88);
          }
        }
        // chords: one hit per bar (pads hold, stabs on 4-floor peaks)
        if (lvl === 0 || lvl >= 2 || isBuild || bp.style === 'ambient') {
          if (bp.style === 'four' && lvl >= 3) {
            for (const st of [2, 6, 10, 14]) chord.notes.forEach(n => noteEv(chords, 1, at(bar0, st), STEP, n, 78));
          } else {
            chord.notes.forEach(n => noteEv(chords, 1, bar0 * BAR, BAR - 20, n, lvl === 0 ? 64 : 72));
          }
        }
      }
    }
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 5, (PPQ >> 8) & 255, PPQ & 255];
    const all = header.concat(trackChunk(t0), trackChunk(drums), trackChunk(bass), trackChunk(chords), trackChunk(lead));
    return new Uint8Array(all);
  }

  // ---------- ZIP writer (store, no compression) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function utf8(s) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, 'utf8')); }
  function zip(files) {
    const parts = [], central = []; let offset = 0;
    const dosTime = 0, dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const name = utf8(f.name), data = typeof f.data === 'string' ? utf8(f.data) : f.data, crc = crc32(data);
      const local = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      parts.push(Uint8Array.from(local), name, data);
      central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + data.length;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = parts.concat(central, [end]);
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  // ---------- DAW guides ----------
  const DAWS = {
    ableton: { name: 'Ableton Live', steps: b => [`Set the tempo to ${b.bpm} BPM.`, 'Drag the .mid file into Arrangement View. Live 11 and later split it into one MIDI track per part.', 'Drop a Drum Rack on "Drums" (GM map: 36 kick, 38/39 snare-clap, 42 hat, 46 open hat).', 'Add locators at the bars listed in README.md for each section.'] },
    logic: { name: 'Logic Pro', steps: b => ['File › Import › MIDI File, or drag the .mid into the Tracks area.', `Logic reads the embedded tempo (${b.bpm} BPM), key signature and section markers from the file.`, 'Assign Drum Machine Designer to "Drums" and pick Alchemy or Retro Synth for the rest.'] },
    fl: { name: 'FL Studio', steps: b => ['File › Import › MIDI file and tick "Start new project".', `FL picks up the ${b.bpm} BPM tempo and makes one channel per part.`, 'Load FPC on "Drums"; section bars are listed in README.md for playlist markers.'] },
    bitwig: { name: 'Bitwig Studio', steps: b => ['Drag the .mid into the Arranger, one lane per part.', `Set the project tempo to ${b.bpm} BPM if it does not follow.`, 'Use Drum Machine on "Drums" and Polymer for bass and chords.'] },
    reaper: { name: 'REAPER', steps: b => ['Insert › Media file, choose the .mid.', 'In the import dialog, tick "Import MIDI tempo map" and expand tracks to new tracks.', 'The section markers come in with the tempo map.'] },
    studioone: { name: 'Studio One / Cubase', steps: b => ['Open the .mid directly (it becomes a new song or project).', `The tempo track (${b.bpm} BPM), the key and the section markers are imported.`, 'Assign Impact/Groove Agent to "Drums".'] },
  };

  function readme(bp, dawKey) {
    const fmt = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
    const secAt = bar => (bar - 1) * 4 * 60 / bp.bpm;
    const lines = [];
    lines.push(`# ${bp.title} blueprint`, '');
    lines.push(`A Deepcut template pack. Everything in it is original, generated material: tempo, key, arrangement and a starter groove.`, `No audio or melodies from the reference track are included, so you are free to build on it.`, '');
    lines.push(`- **Tempo:** ${bp.bpm} BPM, 4/4`, `- **Key:** ${bp.key} (Camelot ${bp.cam})`, `- **Style:** ${bp.styleLabel}`, `- **Swing:** ${Math.round(bp.swing * 100)}%`, `- **Length:** ${bp.totalBars} bars (${fmt(bp.seconds)})`, '');
    lines.push('## Arrangement', '', '| Section | Bar | Bars | Time |', '|---|---|---|---|');
    for (const s of bp.sections) lines.push(`| ${s.name} | ${s.start} | ${s.bars} | ${fmt(secAt(s.start))} |`);
    lines.push('', '## Chords (2 bars each, looping)', '', bp.progression.map(c => `${c.roman} ${c.name}`).join('  →  '), '');
    lines.push('## Parts in the MIDI file', '', '1. **Drums** (channel 10, GM map: 36 kick, 38/39 snare-clap, 42 hat, 46 open hat)', '2. **Bass** follows the chord roots', '3. **Chords** pads in breakdowns, stabs or holds in peaks', '4. **Hook sketch** chord-tone idea in peak sections; replace it with your own', '');
    lines.push('## Sound palette', '', '| Part | Free / open-source pick | Stock alternative (Ableton · Logic · FL) |', '|---|---|---|');
    for (const [p, free, stock] of bp.palette) lines.push(`| ${p} | ${free} | ${stock} |`);
    lines.push('', '## Opening it in your DAW', '');
    const order = [dawKey].concat(Object.keys(DAWS).filter(k => k !== dawKey));
    for (const k of order) { lines.push(`### ${DAWS[k].name}`, ''); DAWS[k].steps(bp).forEach((s, i) => lines.push(`${i + 1}. ${s}`)); lines.push(''); }
    return lines.join('\n');
  }

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'blueprint'; }

  function templatePack(bp, dawKey) {
    const base = `${slug(bp.title)}_${bp.bpm}bpm_${bp.cam}`;
    const json = JSON.stringify({ generator: 'deepcut-prototype', ...bp, palette: bp.palette.map(([part, free, stock]) => ({ part, free, stock })) }, null, 2);
    return {
      name: base + '.zip',
      bytes: zip([
        { name: `${base}/${base}.mid`, data: buildMidi(bp) },
        { name: `${base}/README.md`, data: readme(bp, dawKey || 'ableton') },
        { name: `${base}/blueprint.json`, data: json },
      ]),
    };
  }

  // ---------- DJ exports ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function rekordboxXml(tracks, name) {
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<DJ_PLAYLISTS Version="1.0.0">', '  <PRODUCT Name="Deepcut" Version="0.1" Company="Deepcut"/>', `  <COLLECTION Entries="${tracks.length}">`];
    tracks.forEach((t, i) => lines.push(`    <TRACK TrackID="${i + 1}" Name="${esc(t.title)}" Artist="${esc(t.artist)}" Genre="${esc(t.genre)}" Label="${esc(t.label)}" Year="${t.year}" AverageBpm="${t.bpm.toFixed(2)}" Tonality="${esc(camInfo(t.cam).name)}" Comments="Camelot ${t.cam} · energy ${t.energy}" Location=""/>`));
    lines.push('  </COLLECTION>', '  <PLAYLISTS>', '    <NODE Type="0" Name="ROOT" Count="1">', `      <NODE Name="${esc(name)}" Type="1" KeyType="0" Entries="${tracks.length}">`);
    tracks.forEach((t, i) => lines.push(`        <TRACK Key="${i + 1}"/>`));
    lines.push('      </NODE>', '    </NODE>', '  </PLAYLISTS>', '</DJ_PLAYLISTS>', '');
    return lines.join('\n');
  }
  function m3u(tracks) {
    return ['#EXTM3U'].concat(...tracks.map(t => [`#EXTINF:-1,${t.artist} - ${t.title}`, `# ${t.bpm} BPM · ${t.cam} · energy ${t.energy} · ${t.label}`, `${slug(t.artist)}-${slug(t.title)}.mp3`])).join('\n') + '\n';
  }
  function csv(tracks) {
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['#', 'Artist', 'Title', 'Label', 'Genre', 'BPM', 'Camelot', 'Key', 'Energy', 'Into next']];
    tracks.forEach((t, i) => {
      const n = tracks[i + 1]; const tr = n ? transition(t, n) : null;
      rows.push([i + 1, t.artist, t.title, t.label, t.genre, t.bpm, t.cam, camInfo(t.cam).long, t.energy, tr ? `${tr.grade}: ${tr.tip}` : '']);
    });
    return rows.map(r => r.map(q).join(',')).join('\n') + '\n';
  }

  // ---------- in-browser analysis (BPM + key estimate) ----------
  function estimateBpm(samples, sr) {
    const hop = 256, win = 1024;
    const env = [];
    let prev = 0;
    for (let i = 0; i + win < samples.length; i += hop) {
      let e = 0; for (let j = 0; j < win; j += 2) { const v = samples[i + j]; e += v * v; }
      const l = Math.log(1e-9 + e);
      env.push(Math.max(0, l - prev)); prev = l;
    }
    const fps = sr / hop;
    const mean = env.reduce((a, b) => a + b, 0) / env.length;
    const x = env.map(v => v - mean);
    let best = 0, bestBpm = 120;
    for (let bpm = 70; bpm <= 185; bpm += 0.5) {
      const lag = fps * 60 / bpm;
      let s = 0;
      for (const m of [1, 2, 4]) {
        const L = lag * m, Li = Math.floor(L), fr = L - Li;
        let acc = 0;
        for (let i = 0; i + Li + 1 < x.length; i++) acc += x[i] * (x[i + Li] * (1 - fr) + x[i + Li + 1] * fr);
        s += acc / m;
      }
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 125) / 0.6) ** 2);
      s *= 0.6 + 0.4 * prior;
      if (s > best) { best = s; bestBpm = bpm; }
    }
    return Math.round(bestBpm);
  }
  function estimateKey(samples, sr) {
    const N = 4096, chroma = new Float64Array(12);
    const hopN = Math.max(N, Math.floor(samples.length / 60));
    for (let start = 0; start + N < samples.length; start += hopN) {
      for (let m = 40; m <= 84; m++) {
        const f = 440 * Math.pow(2, (m - 69) / 12);
        const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w);
        let s1 = 0, s2 = 0;
        for (let i = 0; i < N; i++) { const hw = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); const s0 = samples[start + i] * hw + c * s1 - s2; s2 = s1; s1 = s0; }
        chroma[m % 12] += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
      }
    }
    const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const corr = (prof, rot) => {
      const a = [], b = []; for (let i = 0; i < 12; i++) { a.push(chroma[(i + rot) % 12]); b.push(prof[i]); }
      const ma = a.reduce((p, v) => p + v, 0) / 12, mb = b.reduce((p, v) => p + v, 0) / 12;
      let n = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
      return n / Math.sqrt(da * db || 1);
    };
    let best = { r: -2, pc: 0, minor: true };
    for (let pc = 0; pc < 12; pc++) {
      const rM = corr(MAJ, pc), rm = corr(MIN, pc);
      if (rM > best.r) best = { r: rM, pc, minor: false };
      if (rm > best.r) best = { r: rm, pc, minor: true };
    }
    return { cam: camFrom(best.pc, best.minor), confidence: Math.max(0, Math.min(1, best.r)) };
  }

  const api = { hash, rng, NOTE, AXES, GENRES, CATALOG, ALL_CAMS, STYLES, DAWS, camInfo, camFrom, compat, bpmDelta, transition, similarity, dig, findRef, autoOrder, blueprint, buildMidi, zip, crc32, readme, templatePack, rekordboxXml, m3u, csv, slug, estimateBpm, estimateKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Deepcut = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
