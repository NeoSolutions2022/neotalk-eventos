import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const data=name=>JSON.parse(readFileSync(new URL(`../docs/performance/2026-10-22/${name}.json`,import.meta.url),'utf8'));

test('published loopback aggregates match all measured rounds, without dropping slow samples',()=>{
 const h=data('http-loopback');assert.equal(h.rounds,6);assert.equal(h.samples.length,12);
 assert.equal(h.samples.reduce((sum,s)=>sum+s.requests,0),144);
 for(const variant of ['temporary','pooled']){
  const s=h.samples.filter(s=>s.variant===variant);assert.equal(s.length,6);
  assert.ok(s.every(s=>s.requests===12&&s.tcp_connections===(variant==='pooled'?1:12)&&s.elapsed_ms>0));
  const mean=s.reduce((sum,r)=>sum+r.elapsed_ms,0)/s.length;
  assert.ok(Math.abs(mean-h.summary[variant].mean_ms)<1e-8);
  assert.equal(Math.min(...s.map(s=>s.elapsed_ms)),h.summary[variant].min_ms);
  assert.equal(Math.max(...s.map(s=>s.elapsed_ms)),h.summary[variant].max_ms);
 }
});
test('virtual queue chart exposes the remaining tail rather than implying realtime playback',()=>{
 const rows=data('lab-aggregates').virtual_pitch;
 assert.equal(rows.length,3);
 for(const row of rows){assert.equal(row.words,row.wpm*60);assert.ok(row.drain_finished_ms>3600000);assert.ok(row.max_working_queue<=72);}
 assert.ok((rows[2].drain_finished_ms-3600000)/60000>41);
});
test('native chart uses ordered historical points and does not invent missing backend spans',()=>{
 const h=data('lab-aggregates');assert.equal(h.native_batches.length,3);
 for(const row of h.native_batches){const p=['admitted','translation_ready','dispatched','first_frame','last_frame'].map(k=>row[k]);
  assert.ok(p.every(Number.isFinite));assert.ok(p.every((v,i)=>!i||v>=p[i-1]));assert.equal(row.provider_ms,undefined);}
 assert.match(h.native_environment,/simulated ASR\/API/);
});
