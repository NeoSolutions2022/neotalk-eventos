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
  assert.equal(result.nativeObservedIntervals.primary.frameAdvancePerSecond.mean,400);
});

test('handoff separates translation-ready, pending and absent input using raw next-batch points', () => {
  const [latency, ledger] = fixture(); const rows = latency.telemetry.batches;
  for (const [index, admitted, ready, first, last] of [[2, 5, 19, 23, 30], [3, 25, 35, 40, 50], [4, 55, 58, 60, 70], [5, 65, null, 80, 90]]) {
    rows.push({ traceId: `synthetic_${index}`, outcome: 'complete', points: { admitted, translation_ready: ready },
      executions: [{ output: 'primary', first, last }] });
  }
  latency.telemetry.handoff_by_translation_readiness = { primary: { ready: { mean: 999999 } } };
  const result = analyzeRealServices(latency, ledger, 1).handoffSegmentsMs.primary;
  assert.equal(result.translationReady.mean, 3); assert.equal(result.translationPending.mean, 10);
  assert.equal(result.inputNotAdmitted.mean, 10); assert.equal(result.unknown.mean, 10);
  assert.equal(result.repeatedExecutionTransitions, 0); assert.equal(result.overlappingTransitions, 0);
});

test('handoff segmentation reports repeats and overlaps without manufacturing zero gaps or cross-output readiness', () => {
  const [latency, ledger] = fixture(); const rows = latency.telemetry.batches;
  rows[0].executions.push({ output: 'primary', first: 22, last: 35 });
  rows.push({ traceId: 'synthetic_2', points: { admitted: 5, translation_ready: 24 },
    executions: [{ output: 'primary', first: 30, last: 40 }, { output: 'external', first: 45, last: 50 }] });
  const result = analyzeRealServices(latency, ledger, 1).handoffSegmentsMs;
  assert.equal(result.primary.repeatedExecutionTransitions, 1); assert.equal(result.primary.overlappingTransitions, 1);
  assert.equal(result.primary.translationReady.count, 0);
  assert.equal(result.external.translationPending.mean, 24);
});

test('dual-output barrier identifies the trailing callback without pairing different batches', () => {
  const [latency, ledger] = fixture(); const first = latency.telemetry.batches[0];
  const second = structuredClone(first); second.traceId = 'synthetic_2';
  second.executions = [{ output: 'primary', first: 30, last: 60 }, { output: 'external', first: 35, last: 40 }];
  const incomplete = structuredClone(first); incomplete.traceId = 'synthetic_3'; incomplete.executions = [{ output: 'external', first: 70, last: 80 }];
  latency.telemetry.batches.push(second, incomplete);
  const result = analyzeRealServices(latency, ledger, 1).outputBarrier;
  assert.equal(result.pairedBatches, 2); assert.equal(result.firstCallbackSkewMs.max, 5);
  assert.equal(result.primaryTrailingMs.mean, 20); assert.equal(result.externalTrailingMs.mean, 1);
});

test('repeated executions are ambiguous for barrier pairing and primary-only runs have no dual-output metric', () => {
  const [latency, ledger] = fixture(); latency.telemetry.batches[0].executions.push({ output: 'primary', first: 22, last: 30 });
  let result = analyzeRealServices(latency, ledger, 1).outputBarrier;
  assert.equal(result.ambiguousBatches, 1); assert.equal(result.pairedBatches, 0);
  assert.equal(result.primaryTrailingMs.mean, null); assert.equal(result.externalTrailingMs.mean, null);
  ledger.configuration.output = 'primary';
  assert.equal(analyzeRealServices(latency, ledger, 1).outputBarrier, null);
});

test('pose frame-index advance is neither GPU FPS nor inferred from missing or inconsistent callbacks', () => {
  const [latency, ledger] = fixture(); ledger.observations = [
    {type:'neotalk:playback-frame',output:'primary',loadId:'normal',status:'started',frame:0,frameCount:121,at:1000},
    {type:'neotalk:playback-frame',output:'primary',loadId:'normal',status:'finished',frame:120,frameCount:121,at:11000},
    {type:'neotalk:playback-frame',output:'primary',loadId:'no-first',status:'finished',frame:120,frameCount:121,at:12000},
    {type:'neotalk:playback-frame',output:'primary',loadId:'changed',status:'started',frame:0,frameCount:121,at:13000},
    {type:'neotalk:playback-frame',output:'primary',loadId:'changed',status:'finished',frame:240,frameCount:241,at:23000},
  ];
  const metric = analyzeRealServices(latency, ledger, 1).nativeObservedIntervals.primary.frameAdvancePerSecond;
  assert.equal(metric.count, 1); assert.equal(metric.mean, 12);
});
