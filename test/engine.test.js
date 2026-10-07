const D = require('../engine.js');
const fs = require('fs'); const assert = require('assert');
// minimal SMF parser
function parseMidi(u8){ let p=0; const r32=()=>{const v=(u8[p]<<24|u8[p+1]<<16|u8[p+2]<<8|u8[p+3])>>>0;p+=4;return v}; const r16=()=>{const v=u8[p]<<8|u8[p+1];p+=2;return v};
  const tag=()=>String.fromCharCode(...u8.slice(p,p+=4)); assert.equal(tag(),'MThd'); assert.equal(r32(),6); const fmt=r16(), nt=r16(), ppq=r16();
  const tracks=[]; for(let k=0;k<nt;k++){ assert.equal(tag(),'MTrk'); const len=r32(), end=p+len; let t=0, rs=0; const ev={notes:0,offs:0,markers:[],name:null,tempo:null,keysig:null,maxT:0, open:new Map()};
    while(p<end){ let d=0,b; do{b=u8[p++]; d=(d<<7)|(b&127)}while(b&128); t+=d; let st=u8[p]; if(st<0x80){st=rs}else{p++; if(st<0xf0) rs=st}
      if(st===0xff){const ty=u8[p++]; let l=0; do{b=u8[p++]; l=(l<<7)|(b&127)}while(b&128); const data=u8.slice(p,p+=l);
        if(ty===6) ev.markers.push([t,String.fromCharCode(...data)]); if(ty===3) ev.name=String.fromCharCode(...data); if(ty===0x51) ev.tempo=60000000/((data[0]<<16)|(data[1]<<8)|data[2]); if(ty===0x59) ev.keysig=[(data[0]<<24)>>24,data[1]]; if(ty===0x2f) assert.equal(p,end,'EOT at end');}
      else { const hi=st&0xf0; const n=u8[p], v=u8[p+1]; p+= (hi===0xc0||hi===0xd0)?1:2;
        if(hi===0x90&&v>0){ev.notes++; ev.open.set((st&15)+':'+n,(ev.open.get((st&15)+':'+n)||0)+1)} if(hi===0x80||(hi===0x90&&v===0)){ev.offs++; const k=(st&15)+':'+n; ev.open.set(k,(ev.open.get(k)||0)-1)} }
      ev.maxT=t; }
    assert.equal(p,end); tracks.push(ev);} return {fmt,nt,ppq,tracks}; }

let n=0;
for (const t of D.CATALOG){ for (const style of Object.keys(D.STYLES)) {
  const bp = D.blueprint(t, {style}); const m = parseMidi(D.buildMidi(bp));
  assert.equal(m.fmt,1); assert.equal(m.nt,5); assert.equal(m.ppq,480);
  assert.equal(Math.round(m.tracks[0].tempo), bp.bpm);
  assert.equal(m.tracks[0].markers.length, bp.sections.length+1);
  for (const tr of m.tracks.slice(1)) { assert.equal(tr.notes, tr.offs, 'balanced notes'); for (const [k,v] of tr.open) assert.equal(v,0,'note '+k+' left open'); assert.ok(tr.maxT <= bp.totalBars*1920+200, 'within length'); }
  if (style!=='ambient') assert.ok(m.tracks[1].notes>100,'drums present');
  assert.ok(m.tracks[3].notes>20,'chords present');
  n++; } }
console.log('MIDI ok for', n, 'blueprints');

// keysig sanity: 8A = A minor (0 sharps, minor); 5B = Eb major (-3); 1B = B major (5)
const ks = cam => parseMidi(D.buildMidi(D.blueprint({title:'k',bpm:120,cam,style:'four'}))).tracks[0].keysig;
assert.deepEqual(ks('8A'),[0,1]); assert.deepEqual(ks('5B'),[-3,0]); assert.deepEqual(ks('1B'),[5,0]); assert.deepEqual(ks('10A'),[2,1]);
// chord check: A minor progression degree 1 = Am (A C E)
const bpA = D.blueprint({title:'k',bpm:120,cam:'8A',style:'four'});
assert.ok(bpA.progression.every(c=>c.notes.every(x=>[0,2,4,5,7,9,11].includes(x%12))), 'A minor chords stay diatonic');
console.log('progression 8A:', bpA.progression.map(c=>c.roman+' '+c.name).join(' → '));
// compat
assert.equal(D.compat('8A','9A').score,3); assert.equal(D.compat('8A','8B').label,'Relative'); assert.equal(D.compat('8A','2B').score,0); assert.equal(D.compat('12A','1A').score,3);
assert.ok(D.bpmDelta(172,86)<0.01);
// dig
const ref=D.CATALOG[0]; const res=D.dig(ref); console.log('top digs for', ref.title, res.slice(0,4).map(r=>r.t.title+' '+r.sim+'%').join(', '));
// pack
const pack=D.templatePack(D.blueprint(D.CATALOG[3]),'logic'); fs.writeFileSync('/tmp/'+pack.name, pack.bytes); console.log('wrote /tmp/'+pack.name);
fs.writeFileSync('/tmp/set.xml', D.rekordboxXml(D.CATALOG.slice(0,5),'Test set'));
// analysis on synthetic audio: 128 BPM kick + A minor triad drone
const sr=11025, secs=20, N=sr*secs, s=new Float32Array(N);
const bpm=128, beat=60/bpm;
for(let i=0;i<N;i++){ const t=i/sr; const ph=t%beat; let v= ph<0.12 ? Math.sin(2*Math.PI*(50+100*Math.exp(-ph*30))*ph)*Math.exp(-ph*20) : 0;
  for (const f of [220,261.63,329.63,110]) v+=0.15*Math.sin(2*Math.PI*f*t); s[i]=v; }
const eb=D.estimateBpm(s,sr), ek=D.estimateKey(s,sr); console.log('estimated', eb, 'BPM', ek); assert.ok(Math.abs(eb-128)<=1); assert.equal(ek.cam,'8A');
console.log('ALL PASS');
