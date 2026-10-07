/* Deepcut prototype UI */
(function () {
  'use strict';
  const D = window.Deepcut;
  const $ = s => document.querySelector(s);
  const h = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  const state = {
    ref: D.CATALOG[1], refExact: true, refNote: '',
    opts: { keyOnly: false, bpmWindow: 0.06, energy: 'any', sort: 'sim' },
    set: [D.CATALOG[1], D.CATALOG[7], D.CATALOG[3], D.CATALOG[8], D.CATALOG[5]],
    bpSrc: D.CATALOG[1], bpOver: {}, daw: 'ableton',
  };

  // ---------- toast + downloads ----------
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
  function download(name, data, type) {
    const blob = new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Downloaded ' + name);
  }

  // ---------- audio preview (synth renders the blueprint groove) ----------
  let ctx = null, current = null, noiseBuf = null;
  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function env(g, t, peak, a, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function noise(out, t, type, freq, peak, dec, q) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = ctx.createGain(); env(g, t, peak, 0.002, dec);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dec + 0.05);
  }
  function tone(out, t, type, freq, peak, a, dur, cutoff, q, detune) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; if (detune) o.detune.value = detune;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = q || 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur - 0.04)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.12);
  }
  function kick(out, t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    const g = ctx.createGain(); env(g, t, 0.9, 0.003, 0.34);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.4);
  }

  function preview(id, bp) {
    if (current) { const was = current.id; stopPreview(); if (was === id) return; }
    const c = audio();
    const master = c.createGain(); master.gain.value = 0.55;
    const comp = c.createDynamicsCompressor(); master.connect(comp).connect(c.destination);
    const step = 60 / bp.bpm / 4, t0 = c.currentTime + 0.08, bars = 4;
    const sw = bp.swing * step * 0.33, Dr = bp.drums;
    const on = (p, i) => p && p[i] === 'x';
    for (let bar = 0; bar < bars; bar++) {
      const ch = bp.progression[Math.floor(bar / 2) % bp.progression.length];
      for (let i = 0; i < 16; i++) {
        const t = t0 + (bar * 16 + i) * step + (i % 2 ? sw : 0);
        if (bp.style !== 'ambient') {
          if (on(Dr.kick, i)) kick(master, t);
          if (on(Dr.snare, i)) noise(master, t, 'bandpass', 1800, 0.5, 0.16, 0.8);
          if (on(Dr.ghost, i)) noise(master, t, 'bandpass', 2000, 0.16, 0.08, 0.8);
        }
        if (on(Dr.hat3, i)) noise(master, t, 'highpass', 7500, i % 4 === 2 ? 0.16 : 0.08, 0.035);
        if (on(Dr.ohat, i)) noise(master, t, 'highpass', 6500, 0.11, 0.2);
        const bv = bp.bass[i];
        if (bv != null) {
          let len = 1; while (i + len < 16 && bp.bass[i + len] == null && len < (bp.style === 'ambient' ? 16 : bp.style === 'breaks' ? 8 : 2)) len++;
          let root = 36 + ch.rootPc; if (root > 43) root -= 12;
          tone(master, t, 'sawtooth', mtof(root + bv), 0.22, 0.005, len * step * 0.92, 420, 5);
        }
        if (bp.lead[i] != null) {
          const tones = ch.notes.concat([ch.notes[0] + 12]);
          tone(master, t, 'square', mtof(tones[bp.lead[i]] + 12), 0.045, 0.004, step * (bp.style === 'ambient' ? 3.5 : 0.8), 2600);
        }
      }
      if (bp.style === 'four') {
        for (const st of [2, 6, 10, 14]) ch.notes.forEach(n => tone(master, t0 + (bar * 16 + st) * step, 'sawtooth', mtof(n), 0.04, 0.005, step * 0.9, 1800, 1, 7));
      } else {
        ch.notes.forEach(n => { const t = t0 + bar * 16 * step; tone(master, t, 'sawtooth', mtof(n), 0.035, 0.15, 16 * step * 0.95, 1100, 1, -8); tone(master, t, 'sawtooth', mtof(n), 0.035, 0.15, 16 * step * 0.95, 1100, 1, 8); });
      }
    }
    const total = bars * 16 * step;
    const timer = setTimeout(stopPreview, total * 1000 + 300);
    current = { id, master, timer, t0, step, bp };
    tick();
    syncPlayButtons();
  }
  function stopPreview() {
    if (!current) return;
    const { master, timer } = current;
    clearTimeout(timer);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    setTimeout(() => master.disconnect(), 300);
    current = null;
    document.querySelectorAll('.drumgrid .p').forEach(e => e.classList.remove('p'));
    syncPlayButtons();
  }
  function tick() {
    if (!current) return;
    const s = Math.floor((ctx.currentTime - current.t0) / current.step) % 16;
    if (current.id === 'bp' && s >= 0) {
      document.querySelectorAll('.drumgrid .c').forEach(e => e.classList.toggle('p', +e.dataset.s === s));
    }
    requestAnimationFrame(tick);
  }
  const ICON_PLAY = '<svg viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 14 14"><rect x="2.5" y="2.5" width="9" height="9" rx="1"/></svg>';
  function syncPlayButtons() {
    document.querySelectorAll('[data-play]').forEach(b => {
      const on = current && current.id === b.dataset.play;
      b.classList.toggle('on', !!on); b.innerHTML = on ? ICON_STOP : ICON_PLAY;
      b.setAttribute('aria-label', on ? 'Stop preview' : 'Play preview');
    });
  }
  function trackById(id) { return id === 'custom' ? state.custom : D.CATALOG.find(t => t.id === id); }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-play]'); if (!b) return;
    const id = b.dataset.play;
    if (id === 'bp') preview('bp', currentBlueprint());
    else preview(id, D.blueprint(trackById(id)));
  });

  // ---------- waveform ----------
  function wave(t) {
    const r = D.rng(t.id + t.title), n = 48, w = 150, hgt = 34, bw = w / n;
    let bars = '';
    for (let i = 0; i < n; i++) {
      const sec = i / n;
      const shape = t.style === 'ambient' ? 0.35 + 0.3 * Math.sin(sec * Math.PI) : (sec < 0.12 || sec > 0.9) ? 0.4 : (sec > 0.45 && sec < 0.55) ? 0.3 : 0.85;
      const v = Math.max(0.08, Math.min(1, shape * (0.6 + 0.4 * r()) * (0.75 + t.energy / 40)));
      const bh = v * hgt;
      bars += `<rect x="${(i * bw).toFixed(1)}" y="${((hgt - bh) / 2).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" rx="1"/>`;
    }
    return `<svg class="wave" viewBox="0 0 ${w} ${hgt}" fill="#3a4556" aria-hidden="true">${bars}</svg>`;
  }

  // ---------- dig ----------
  function renderRef() {
    const t = state.ref, k = D.camInfo(t.cam);
    $('#refcard').innerHTML = `
      <div class="refcard">
        <button class="play" data-play="${t.id}" aria-label="Play preview">${ICON_PLAY}</button>
        <div><div class="eyebrow">Reference</div><div class="t">${h(t.title)}</div><div class="a">${h(t.artist)} · ${h(t.label)} · ${h(t.genre)}</div>
          <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><span class="chip">${t.bpm} BPM</span><span class="chip hot">${t.cam} · ${k.name}</span><span class="chip">energy ${t.energy}/10</span></div>
          ${state.refNote ? `<div class="refnote">${h(state.refNote)}</div>` : ''}</div>
        <div><button class="btn sm" data-bp="${t.id}">Blueprint →</button></div>
      </div>`;
  }
  function renderResults() {
    const rows = D.dig(state.ref, state.opts);
    const inSet = id => state.set.some(s => s.id === id);
    $('#results').innerHTML = rows.length ? rows.slice(0, 12).map((r, i) => {
      const t = r.t, d = t.bpm - state.ref.bpm;
      const bpmChip = `<span class="chip ${r.bpmPct <= 0.03 ? 'good' : r.bpmPct <= 0.06 ? 'ok' : 'bad'}">${t.bpm} BPM ${d === 0 ? '' : (d > 0 ? '+' : '') + d}</span>`;
      return `<div class="row">
        <div class="rank">${String(i + 1).padStart(2, '0')}</div>
        <button class="play" data-play="${t.id}" aria-label="Play preview">${ICON_PLAY}</button>
        <div style="min-width:0"><div class="ti">${h(t.title)}</div><div class="ar">${h(t.artist)} · ${h(t.label)} · ${h(t.genre)}</div>
          <div class="meta">${bpmChip}<span class="chip ${r.key.cls}">${t.cam} · ${r.key.label}</span><span class="chip">E${t.energy}</span></div></div>
        ${wave(t)}
        <div class="sim">${r.sim}%<small>MATCH</small></div>
        <div class="acts"><button class="btn sm" data-add="${t.id}" ${inSet(t.id) ? 'disabled' : ''}>${inSet(t.id) ? 'In set' : '+ Set'}</button><button class="btn sm" data-bp="${t.id}">Blueprint</button></div>
      </div>`;
    }).join('') : '<div class="empty">Nothing passes these filters. Widen the BPM window or switch off "Mixes in key".</div>';
    syncPlayButtons();
  }
  function setRef(t, note) { state.ref = t; state.refNote = note || ''; renderRef(); renderResults(); }

  function segBind(sel, key, parse) {
    $(sel).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $(sel).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      state.opts[key] = parse ? parse(b.dataset.v) : b.dataset.v; renderResults();
    });
  }
  segBind('#fBpm', 'bpmWindow', v => +v);
  segBind('#fEnergy', 'energy');
  segBind('#fSort', 'sort');
  $('#fKey').addEventListener('change', e => { state.opts.keyOnly = e.target.checked; renderResults(); });

  $('#searchForm').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q) { $('#q').focus(); return; }
    const f = D.findRef(q);
    const note = f.exact ? '' : `Prototype: live link analysis isn't wired up yet, so "${q.length > 48 ? q.slice(0, 48) + '…' : q}" is mapped to a demo track.`;
    setRef(f.track, note);
    state.bpSrc = f.track; state.bpOver = {}; renderBlueprint();
    document.getElementById('dig').scrollIntoView({ behavior: 'smooth' });
  });
  const ex = $('#examples');
  [D.CATALOG[0], D.CATALOG[9], D.CATALOG[12], D.CATALOG[15]].forEach(t => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = `${t.artist} – ${t.title}`;
    b.onclick = () => { $('#q').value = t.title; $('#searchForm').requestSubmit(); };
    ex.appendChild(b);
  });

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-add]');
    if (a) { const t = trackById(a.dataset.add); if (!state.set.some(s => s.id === t.id)) { state.set.push(t); renderSet(); renderResults(); toast(`Added "${t.title}" to your set`); } }
    const b = e.target.closest('[data-bp]');
    if (b) { state.bpSrc = trackById(b.dataset.bp); state.bpOver = {}; renderBlueprint(); document.getElementById('blueprint').scrollIntoView({ behavior: 'smooth' }); }
  });

  // ---------- blueprint ----------
  function currentBlueprint() { return D.blueprint(state.bpSrc, state.bpOver); }
  const LVL_COLOR = { 0: '#1e3047', 1: '#26303d', 2: '#6b3418', 3: '#ff5a1f', b: 'repeating-linear-gradient(135deg,#a8461c 0 6px,#8a3916 6px 12px)' };
  const LVL_H = { 0: 0.15, 1: 0.4, 2: 0.65, b: 0.8, 3: 1 };
  function renderBlueprint() {
    const bp = currentBlueprint(), src = state.bpSrc;
    const timeline = bp.sections.map(s => `<div style="flex:${s.bars};background:${LVL_COLOR[s.lvl]};color:${s.lvl === 3 ? '#140600' : '#eef1f5'}" title="${h(s.name)}: bar ${s.start}, ${s.bars} bars"><b>${h(s.name)}</b>${s.bars}</div>`).join('');
    // energy lane
    let x = 0; const pts = [];
    bp.sections.forEach(s => { const w = s.bars / bp.totalBars * 400, y = 38 - LVL_H[s.lvl] * 32; pts.push(`${x.toFixed(1)},${y}`, `${(x + w).toFixed(1)},${y}`); x += w; });
    const D0 = bp.drums;
    const rows = [['Kick', D0.kick], [bp.drums.snareNote === 38 ? 'Snare' : 'Clap', D0.snare]];
    if (D0.ghost) rows.push(['Ghost', D0.ghost]);
    rows.push(['Hat', D0.hat3], ['Open hat', D0.ohat]);
    const grid = rows.map(([n, p]) => `<div>${n}</div>` + [...p].map((c, i) => `<div class="c ${c === 'x' ? (n === 'Ghost' ? 'g' : 'x') : i % 4 === 0 ? 'q' : ''}" data-s="${i}"></div>`).join('')).join('');
    const bassRow = '<div>Bass</div>' + bp.bass.map((v, i) => `<div class="c ${v != null ? 'x' : i % 4 === 0 ? 'q' : ''}" data-s="${i}" ${v != null ? `title="${['root', '', '', '', '', '', '', '5th', '', '', '♭7', '', 'oct'][v] || ''}"` : ''}></div>`).join('');
    const camOpts = D.ALL_CAMS.map(c => `<option value="${c}" ${c === bp.cam ? 'selected' : ''}>${c} · ${D.camInfo(c).long}</option>`).join('');
    const styleOpts = Object.entries(D.STYLES).map(([k, v]) => `<option value="${k}" ${k === bp.style ? 'selected' : ''}>${v.label}</option>`).join('');
    const daws = Object.entries(D.DAWS).map(([k, v]) => `<button data-daw="${k}" class="${k === state.daw ? 'on' : ''}">${v.name}</button>`).join('');
    const steps = D.DAWS[state.daw].steps(bp).map(s => `<li>${h(s)}</li>`).join('');
    $('#bp').innerHTML = `
      <div class="bp-top">
        <div>
          <div class="eyebrow">Blueprint from</div>
          <div class="bp-title">${h(bp.title)}</div>
          <div style="color:var(--mute);font-size:14px">${h(src.artist || '')}${src.genre ? ' · ' + h(src.genre) : ''}</div>
          <div class="stats">
            <div class="stat"><b>${bp.bpm}</b><span>BPM</span></div>
            <div class="stat"><b>${bp.cam}</b><span>${h(bp.key)}</span></div>
            <div class="stat"><b>${bp.totalBars}</b><span>bars</span></div>
            <div class="stat"><b>${fmtTime(bp.seconds)}</b><span>length</span></div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:16px">
            <button class="play" data-play="bp" aria-label="Play preview">${ICON_PLAY}</button>
            <span style="color:var(--mute);font-size:14px">Hear the drop groove: drums, bass, chords and hook sketch.</span>
          </div>
        </div>
        <div>
          <div class="lbl"><span>Tweak the template</span></div>
          <div class="editor">
            <label class="full">Style<select id="eStyle">${styleOpts}</select></label>
            <label>Tempo<input id="eBpm" type="number" min="60" max="200" value="${bp.bpm}"></label>
            <label>Key<select id="eKey">${camOpts}</select></label>
          </div>
          <div class="ownaudio"><label for="bpFile">Use your own audio</label>: we estimate tempo and key locally, then build the blueprint around it.
            <input type="file" id="bpFile" accept="audio/*" hidden><div class="st" id="bpStatus">${state.customStatus ? h(state.customStatus) : ''}</div></div>
        </div>
      </div>
      <div class="bp-body">
        <div>
          <div class="lbl"><span>Arrangement · ${bp.sections.length} sections, markers embedded</span><span>${h(bp.styleLabel)}</span></div>
          <div class="timeline">${timeline}</div>
          <svg class="energy-lane" viewBox="0 0 400 40" preserveAspectRatio="none"><polyline points="${pts.join(' ')}" fill="none" stroke="#ff8a3d" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>
          <div class="tl-scale"><span>bar 1</span><span>energy</span><span>bar ${bp.totalBars}</span></div>
        </div>
        <div class="grid2">
          <div><div class="lbl"><span>Drop groove · 16 steps</span><span>swing ${Math.round(bp.swing * 100)}%</span></div>
            <div class="drumgrid">${grid}${bassRow}</div></div>
          <div><div class="lbl"><span>Chords · 2 bars each</span><span>${h(bp.key)}</span></div>
            <div class="chords">${bp.progression.map(c => `<div class="chord"><b>${h(c.name)}</b><span>${h(c.roman)}</span></div>`).join('')}</div>
            <div class="lbl" style="margin-top:22px"><span>Sound palette</span><span>free · stock</span></div>
            <table class="palette">${bp.palette.map(([p, f, s]) => `<tr><td>${h(p)}</td><td>${h(f)}</td><td>${h(s)}</td></tr>`).join('')}</table>
          </div>
        </div>
        <div>
          <div class="lbl"><span>Your DAW</span></div>
          <div class="dawpick">${daws}</div>
          <ol class="steps">${steps}</ol>
          <div class="dl">
            <button class="btn hot" id="dlPack">Download template pack (.zip)</button>
            <button class="btn" id="dlMidi">MIDI only (.mid)</button>
          </div>
          <div class="legal">Pack = multi-track MIDI (tempo, key signature, section markers, drums, bass, chords, hook sketch) + README with arrangement map and setup steps + blueprint.json. Parts are generated, never transcribed from the reference, so they are yours to use.</div>
        </div>
      </div>`;
    $('#eStyle').onchange = e => { state.bpOver.style = e.target.value; renderBlueprint(); };
    $('#eBpm').onchange = e => { const v = Math.max(60, Math.min(200, +e.target.value || bp.bpm)); state.bpOver.bpm = v; renderBlueprint(); };
    $('#eKey').onchange = e => { state.bpOver.cam = e.target.value; renderBlueprint(); };
    $('#bpFile').onchange = e => analyseFile(e.target.files[0]);
    $('#dlPack').onclick = () => { const p = D.templatePack(currentBlueprint(), state.daw); download(p.name, p.bytes, 'application/zip'); };
    $('#dlMidi').onclick = () => { const b = currentBlueprint(); download(`${D.slug(b.title)}_${b.bpm}bpm_${b.cam}.mid`, D.buildMidi(b), 'audio/midi'); };
    $('#bp').querySelectorAll('[data-daw]').forEach(b => b.onclick = () => { state.daw = b.dataset.daw; renderBlueprint(); });
    if (current && current.id === 'bp') stopPreview();
    syncPlayButtons();
  }

  // ---------- own audio analysis ----------
  async function analyseFile(file) {
    if (!file) return;
    const say = m => { state.customStatus = m; const el = $('#bpStatus'); if (el) el.textContent = m; };
    say(`Reading ${file.name}…`);
    document.getElementById('blueprint').scrollIntoView({ behavior: 'smooth' });
    try {
      const c = audio();
      const buf = await c.decodeAudioData(await file.arrayBuffer());
      const dur = Math.min(30, buf.duration), off = Math.max(0, (buf.duration - dur) / 2), SR = 11025;
      const oc = new OfflineAudioContext(1, Math.floor(dur * SR), SR);
      const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start(0, off, dur);
      say('Listening for tempo and key…');
      const rendered = await oc.startRendering();
      await new Promise(r => setTimeout(r, 30));
      const x = rendered.getChannelData(0);
      const bpm = D.estimateBpm(x, SR), key = D.estimateKey(x, SR);
      const style = bpm >= 155 ? 'breaks' : bpm < 100 ? 'ambient' : 'four';
      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'My track';
      state.custom = { id: 'custom', title, artist: 'Your track', label: 'Your upload', genre: 'your audio', bpm, cam: key.cam, energy: 6, year: new Date().getFullYear(), vec: D.GENRES[style === 'breaks' ? 'jungle' : style === 'ambient' ? 'ambient' : 'house'].proto.slice(), style };
      say(`Detected ~${bpm} BPM, ${key.cam} (${D.camInfo(key.cam).long}), key confidence ${Math.round(key.confidence * 100)}%. Adjust above if it's off.`);
      state.bpSrc = state.custom; state.bpOver = {}; renderBlueprint();
      setRef(state.custom, 'Your file: results ranked by tempo, key and style. Timbre matching arrives with the embedding model.');
      toast(`${title}: ${bpm} BPM · ${key.cam}`);
    } catch (err) {
      say('Could not decode that file in this browser. Try an MP3, WAV or M4A.');
    }
  }
  $('#heroFile').addEventListener('change', e => analyseFile(e.target.files[0]));

  // ---------- set builder ----------
  function renderSet() {
    $('#setCount').textContent = state.set.length;
    const L = state.set;
    if (!L.length) { $('#setlist').innerHTML = '<div class="empty">Your set is empty. Hit "+ Set" on any dig result.</div>'; $('#curve').innerHTML = ''; $('#setLen').textContent = ''; return; }
    let html = '';
    L.forEach((t, i) => {
      html += `<div class="st-item"><div class="n">${i + 1}</div>
        <div style="min-width:0"><div class="ti">${h(t.title)}</div><div class="ar">${h(t.artist)}</div>
          <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap"><span class="chip">${t.bpm}</span><span class="chip hot">${t.cam}</span><span class="chip">E${t.energy}</span></div></div>
        <div class="ctl"><button data-mv="${i}:-1" aria-label="Move up">↑</button><button data-mv="${i}:1" aria-label="Move down">↓</button><button data-rm="${i}" aria-label="Remove">✕</button></div></div>`;
      if (L[i + 1]) {
        const tr = D.transition(t, L[i + 1]);
        html += `<div class="trans"><span class="g ${tr.grade}">${tr.grade}</span><span>${h(tr.key.label)} · ${(tr.bpmPct * 100).toFixed(1)}% tempo · ${h(tr.tip)}</span></div>`;
      }
    });
    $('#setlist').innerHTML = html;
    // energy curve
    const W = 400, H = 180, pad = 18, n = L.length;
    const X = i => n === 1 ? W / 2 : pad + i * (W - pad * 2) / (n - 1), Y = e => H - pad - (e - 1) / 9 * (H - pad * 2);
    const line = L.map((t, i) => `${X(i)},${Y(t.energy)}`).join(' ');
    let svg = '';
    for (let e = 1; e <= 10; e += 3) svg += `<line x1="0" x2="${W}" y1="${Y(e)}" y2="${Y(e)}" stroke="#232a35"/>`;
    svg += `<polygon points="${X(0)},${H - pad} ${line} ${X(n - 1)},${H - pad}" fill="rgba(255,90,31,.12)"/>`;
    svg += `<polyline points="${line}" fill="none" stroke="#ff5a1f" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`;
    $('#curve').innerHTML = svg;
    const mins = L.reduce((a, t) => a + 6.5, 0);
    $('#setLen').textContent = `${n} tracks · ~${Math.round(mins)} min`;
  }
  $('#setlist').addEventListener('click', e => {
    const mv = e.target.closest('[data-mv]'), rm = e.target.closest('[data-rm]');
    if (mv) { const [i, d] = mv.dataset.mv.split(':').map(Number), j = i + d; if (j >= 0 && j < state.set.length) { [state.set[i], state.set[j]] = [state.set[j], state.set[i]]; renderSet(); } }
    if (rm) { state.set.splice(+rm.dataset.rm, 1); renderSet(); renderResults(); }
  });
  $('#autoBtn').onclick = () => { state.set = D.autoOrder(state.set); renderSet(); toast('Reordered for key flow and a rising energy arc'); };
  $('#clearBtn').onclick = () => { state.set = []; renderSet(); renderResults(); };
  document.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => {
    if (!state.set.length) return toast('Add some tracks first');
    const k = b.dataset.exp, name = 'deepcut-set';
    if (k === 'rb') download(name + '.xml', D.rekordboxXml(state.set, 'Deepcut set'), 'application/xml');
    if (k === 'm3u') download(name + '.m3u8', D.m3u(state.set), 'audio/x-mpegurl');
    if (k === 'csv') download(name + '.csv', D.csv(state.set), 'text/csv');
  });

  // ---------- boot ----------
  renderRef(); renderResults(); renderBlueprint(); renderSet();
})();
