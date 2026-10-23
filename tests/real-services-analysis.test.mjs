// Synthetic fixtures validate the analyzer, not the product or live services.
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRealServices, distribution } from '../scripts/analyze-real-services.mjs';
function fixture() {
  const row = { traceId: 'synthetic_1', outcome: 'complete', contextCacheHit: false,
    points: { admitted: 0, translation_start: 1, translation_ready: 5, dispatched: 10, first_frame: 12, last_frame: 20 },
    server: { endpoint_ms: 4 }, pose: { total_ms: 2 },
    executions: [{ output: 'primary', first: 12, last: 20 }, { output: 'external', first: 13, last: 21 }] };
  return [{ mode: 'translation', telemetry: { schema: 1, limits: { evictedRows: 0 }, batches: [row],
    pressure: { capturePauses: 0, automaticResumes: 0, rejectedSourceWords: 0, blockedAdmissionAttempts: 0, rejectedAudioChunks: 0 }, runtimeResets: 0 } },
  { result: 'PASS', configuration: { output: 'pip' } }];
}
test('nearest-rank quantiles preserve zero and never invent empty samples', () => {
  assert.deepEqual(distribution([]), { count: 0, mean: null, p50: null, p95: null, max: null });
  assert.deepEqual(distribution([0, 1, 2, 3, 4, -1, NaN]), { count: 5, mean: 2, p50: 2, p95: 4, max: 4 });
});
test('recomputes spans from raw points, not claimed aggregate percentiles', () => {
  const [latency, ledger] = fixture(); latency.telemetry.metrics = { translation_request_ms: { p95: 999999 } };
  const result = analyzeRealServices(latency, ledger, 1);
  assert.equal(result.consistentSampleGate, true); assert.equal(result.metricsMs.translationRequest.p95, 4);
  assert.equal(result.translationByContextCacheMs.hit.count, 0); assert.equal(result.translationByContextCacheMs.miss.count, 1);
  assert.equal(analyzeRealServices(latency, ledger).gate.minimumCompleteSamples, false);
});
test('claimed success and missing=0 cannot replace a terminal frame on either output', () => {
  const [latency, ledger] = fixture(); delete latency.telemetry.batches[0].executions[1].last;
  latency.telemetry.missing = { lastFrame: 0 };
  const result = analyzeRealServices(latency, ledger, 1);
  assert.equal(result.consistentSampleGate, false); assert.equal(result.missing.externalExecution, 1);
});
test('duplicate traces, reversed times, evictions and absent spans fail explicitly', () => {
  const [latency, ledger] = fixture(); const row = latency.telemetry.batches[0];
  latency.telemetry.batches.push(structuredClone(row));
  row.points.first_frame = 9; delete row.pose; delete row.server; latency.telemetry.limits.evictedRows = 1;
  const result = analyzeRealServices(latency, ledger, 1);
  assert.equal(result.gate.uniqueTraceIds, false); assert.equal(result.gate.noEviction, false);
  assert.equal(result.missing.orderedTimeline, 1); assert.equal(result.missing.poseTimings, 1);
});
test('missing safety counters stay unknown and free-form text never enters output', () => {
  const [latency, ledger] = fixture(); delete latency.telemetry.pressure.capturePauses;
  latency.speech = 'PRIVATE_TRANSCRIPT'; ledger.failure = 'PRIVATE_SECRET';
  const result = analyzeRealServices(latency, ledger, 1);
  assert.equal(result.pressure.capturePauses, null); assert.equal(result.gate.captureUninterrupted, false);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
});
test('retains failed and skipped rows instead of filtering them out of the gate', () => {
  const [latency, ledger] = fixture(); latency.telemetry.batches.push({ traceId: 'synthetic_2', outcome: 'skipped', points: {} });
  const result = analyzeRealServices(latency, ledger, 1);
  assert.equal(result.completeBatches, 1); assert.equal(result.outcomes.skipped, 1);
  assert.equal(result.consistentSampleGate, false);
});
test('native completion does not imply complete diagnostic coverage for cached poses', () => {
  const [latency, ledger] = fixture(); delete latency.telemetry.batches[0].pose;
  const result = analyzeRealServices(latency, ledger, 1);
  assert.equal(result.executionSampleGate, true); assert.equal(result.diagnosticCoverageComplete, false);
  assert.equal(result.consistentSampleGate, false); assert.equal(result.missing.poseTimings, 1);
});
test('malformed rows fail without echoing input data', () => {
  const [latency, ledger] = fixture(); latency.telemetry.batches = [null];
  assert.throws(() => analyzeRealServices(latency, ledger), /Invalid batch shape/);
});
test('explicit browser-memory provenance explains absent request spans without manufacturing samples', () => {
  const [latency, ledger] = fixture(); const row=latency.telemetry.batches[0];delete row.pose;row.poseSource='browser-memory';
  const result=analyzeRealServices(latency,ledger,1);
  assert.equal(result.consistentSampleGate,true);assert.equal(result.missing.poseTimings,1);
  assert.equal(result.missing.requiredPoseTimings,0);assert.equal(result.poseStagesMs.total_ms.count,0);
});
test('native ACK timing is not mistaken for a first frame or paired across outputs', () => {
  const [latency, ledger]=fixture();ledger.observations=[
    {type:'neotalk:playing',output:'primary',loadId:'one',at:10},
    {type:'neotalk:playback-frame',output:'primary',loadId:'one',status:'preparing',frame:0,frameCount:3,at:12},
    {type:'neotalk:playback-frame',output:'external',loadId:'one',status:'started',frame:0,frameCount:3,at:13},
    {type:'neotalk:playback-frame',output:'primary',loadId:'one',status:'started',frame:0,frameCount:3,at:20},
    {type:'neotalk:playback-frame',output:'primary',loadId:'one',status:'finished',frame:2,frameCount:3,at:25},
  ];const result=analyzeRealServices(latency,ledger,1);
  assert.equal(result.nativeObservedIntervals.primary.ackToFirstFrameMs.mean,10);
  assert.equal(result.nativeObservedIntervals.primary.preparingToFirstFrameMs.mean,8);
  assert.equal(result.nativeObservedIntervals.external.ackToFirstFrameMs.count,0);
});
