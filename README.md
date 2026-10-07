# deepcut (prototype)

Sound-based track discovery for DJs, plus DAW-ready blueprint packs for producers.
Static site, no build step, no dependencies: `index.html` + `app.js` + `engine.js`.

- **Dig:** similarity ranking with Camelot key compatibility, BPM delta (half/double-time aware), energy filters.
- **Set builder:** transition grades, energy arc, auto-ordering, exports to rekordbox XML, M3U8 and CSV.
- **Blueprints:** tempo, key, arrangement markers, drums, bass, chords and a hook sketch as a multi-track MIDI file,
  zipped with a README (arrangement map, sound palette, setup steps for Ableton, Logic, FL, Bitwig, REAPER, Studio One/Cubase).
- **Your own audio:** BPM and key estimated in the browser; the file is never uploaded.

All catalog tracks, artists and labels are fictional demo data. Blueprint parts are generated, never transcribed.

Test: `node test/engine.test.js`  ·  Run: `python3 -m http.server` and open http://localhost:8000
