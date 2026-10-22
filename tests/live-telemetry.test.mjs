import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../app/liveTelemetry.ts', import.meta.url), 'utf8');
const context = vm.createContext({exports:{}, performance});
vm.runInContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, context);
const {LiveTelemetry,summarize} = context.exports;
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(capacity) {let time=0;const t=new LiveTelemetry(()=>time,capacity);t.begin('qa');return {t,at:n=>{time=n;}};}
test('missing measurements are null, not zero or invented animation',()=>{
  const {t}=fixture();t.admit(1,1);t.frame(1,'primary','x','finished',9,10);
  const s=t.snapshot();assert.equal(s.metrics.dispatch_to_first_frame_ms.mean,null);assert.equal(s.missing.firstFrame,1);
});
test('queue, endpoint and native measurements use separate clocks and stages',()=>{
  const {t,at}=fixture();t.admit(1,1);at(10);t.mark(1,'translation_start');t.attempt(1);t.attempt(1);
  at(110);t.mark(1,'translation_ready');t.server(1,{provider_ms:70,endpoint_ms:95,secret:'no',service_ms:-1});
  at(150);t.mark(1,'dispatched');at(200);t.frame(1,'primary','x','started',0,10);
  at(220);t.frame(1,'primary','x','progress',1,10);at(500);t.frame(1,'primary','x','finished',9,10);
  const s=t.snapshot();assert.equal(s.metrics.admission_to_agent_ms.mean,10);assert.equal(s.metrics.translation_request_ms.mean,100);
  assert.equal(s.metrics.ready_to_dispatch_ms.mean,40);assert.equal(s.metrics.dispatch_to_first_frame_ms.mean,50);
  assert.equal(s.metrics.native_playback_ms.mean,300);assert.equal(s.batches[0].attempts,2);assert.equal(s.server.service_ms.mean,null);
  assert.ok(!JSON.stringify(s).includes('secret'));
});
test('players have independent gaps, duplicate completion does not reset the clock',()=>{
  const {t,at}=fixture();t.admit(1,1);t.admit(2,2);t.frame(1,'primary','a','started',0,2);t.frame(1,'external','b','started',0,2);
  at(100);t.frame(1,'primary','a','finished',1,2);at(150);t.frame(1,'primary','a','finished',1,2);
  at(200);t.frame(1,'external','b','finished',1,2);at(300);t.frame(2,'primary','c','started',0,2);
  at(350);t.frame(2,'external','d','started',0,2);
  assert.equal(t.snapshot().handoff_ms.primary.mean,200);assert.equal(t.snapshot().handoff_ms.external.mean,150);
});
test('invalid frame events cannot become evidence',()=>{
  const {t}=fixture();t.admit(1,1);
  for(const args of [['x','started',-1,3],['x','ready',0,3],['x','started',3,3],['','started',0,3]])t.frame(1,'primary',...args);
  assert.equal(t.snapshot().missing.firstFrame,1);
});

test('handoffs distinguish next translation ready from empty or untranslated queues without claiming native preparation',()=>{
  const {t,at}=fixture();for(let i=1;i<=4;i++)t.admit(i,i);
  t.frame(1,'primary','a','started',0,2);at(100);t.frame(1,'primary','a','finished',1,2,true);
  at(150);t.frame(2,'primary','b','started',0,2);at(200);t.frame(2,'primary','b','finished',1,2,false);
  at(900);t.frame(3,'primary','c','started',0,2);at(1000);t.frame(3,'primary','c','finished',1,2);
  at(1200);t.frame(4,'primary','d','started',0,2);
  const s=t.snapshot().handoff_by_translation_readiness;
  assert.equal(s.primary.ready.mean,50);assert.equal(s.primary.notReady.mean,700);
  assert.equal(s.primary.unreported.mean,200);assert.equal(s.external.ready.count,0);
  assert.equal(t.snapshot().handoff_ms.primary.count,3);
});
test('bounded samples, privacy, pressure and cancellation remain explicit',()=>{
  const {t,at}=fixture(2);t.admit(1,1);t.admit(2,2);t.admit(3,3);t.input(12);at(400);t.input(5);
  t.pressure();t.rejected(6);t.reset();t.transcription(20,false);t.cancelPending();
  const s=t.snapshot();assert.equal(s.limits.evictedRows,1);assert.equal(s.batches.length,2);assert.equal(s.outcomes.cancelled,2);
  assert.equal(s.pressure.rejectedSourceWords,6);assert.equal(s.pressure.capturePauses,1);assert.equal(s.runtimeResets,1);
  assert.equal(s.input.sourceWords,17);assert.equal(s.input.observedDurationMs,400);assert.equal(s.asrFailures,1);
  assert.ok(!('loadId' in s.batches[0]));t.begin('new');assert.equal(t.snapshot().batches.length,0);
  assert.throws(()=>fixture(0));
});
test('nearest-rank percentiles exclude invalid values',()=>{
  assert.deepEqual(plain(summarize([NaN,-1,10,20,30,Infinity])),{count:3,mean:20,p50:20,p95:30,max:30});
});

test('backend context cache groups and catalog size are explicit without storing the catalog',()=>{
  const {t,at}=fixture();
  for(let i=1;i<=3;i++){t.admit(i,i);t.mark(i,'translation_start');at(i*100);t.mark(i,'translation_ready');}
  t.context(1,false,700);t.context(2,true,800);t.context(3,'not-a-boolean','private catalog');
  const s=t.snapshot();assert.equal(s.translation_by_context_cache.hit.count,1);
  assert.equal(s.translation_by_context_cache.miss.mean,100);assert.equal(s.translation_by_context_cache.unreported.count,1);
  assert.equal(s.batches[1].catalogWordCount,800);assert.equal(s.batches[2].catalogWordCount,undefined);
  assert.ok(!JSON.stringify(s).includes('private catalog'));
});
test('failed requests stay separate from successful requests and missing terminal frames remain explicit',()=>{
  const {t,at}=fixture();t.admit(1,1);t.mark(1,'translation_start');at(80);t.mark(1,'translation_failed');t.outcome(1,'error');
  const s=t.snapshot();assert.equal(s.metrics.translation_request_ms.count,0);assert.equal(s.metrics.translation_failed_request_ms.mean,80);
  assert.equal(s.missing.lastFrame,1);assert.equal(s.outcomes.error,1);
});
