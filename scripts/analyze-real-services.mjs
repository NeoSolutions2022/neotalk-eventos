import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function distribution(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  const percentile = value => sorted.length ? sorted[Math.ceil(sorted.length * value) - 1] : null;
  return { count: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
    p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) ?? null };
}

// Recalculate from samples. Never average exported percentiles or trust a
// declared outcome/aggregate in place of first and terminal frame observations.
export function analyzeRealServices(latency, ledger, minimum = 100) {
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > 512) throw new Error('Invalid sample minimum');
  const telemetry = latency?.telemetry;
  const rows = Array.isArray(telemetry?.batches) ? telemetry.batches : [];
  if (rows.length > 512) throw new Error('Input exceeds the bounded telemetry contract');
  if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) ||
    (row.executions !== undefined && (!Array.isArray(row.executions) || row.executions.some(item => !item || typeof item !== 'object'))))) {
    throw new Error('Invalid batch shape');
  }
  const pointNames = ['admitted', 'translation_start', 'translation_ready', 'dispatched', 'first_frame', 'last_frame'];
  const ordered = row => pointNames.every((key, index) => finite(row.points?.[key]) &&
    (!index || row.points[key] >= row.points[pointNames[index - 1]]));
  const executionComplete = (row, output) => Array.isArray(row.executions) && row.executions.some(execution =>
    execution.output === output && finite(execution.first) && finite(execution.last) && execution.last >= execution.first);
  const externalRequired = ledger?.configuration?.output !== 'primary';
  const ids = rows.map(row => row.traceId);
  const uniqueIds = ids.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(id)) && new Set(ids).size === ids.length;
  const complete = rows.filter(row => row.outcome === 'complete' && ordered(row) && executionComplete(row, 'primary') &&
    (!externalRequired || executionComplete(row, 'external')));
  const intervals = {
    admittedToTranslation: ['admitted', 'translation_start'], translationRequest: ['translation_start', 'translation_ready'],
    readyToDispatch: ['translation_ready', 'dispatched'], dispatchToFirstFrame: ['dispatched', 'first_frame'],
    admissionToFirstFrame: ['admitted', 'first_frame'], nativePlayback: ['first_frame', 'last_frame'],
  };
  const metric = ([start, end], subset = rows) => distribution(subset.flatMap(row =>
    finite(row.points?.[start]) && finite(row.points?.[end]) && row.points[end] >= row.points[start] ? [row.points[end] - row.points[start]] : []));
  const counters = ['capturePauses', 'automaticResumes', 'rejectedSourceWords', 'blockedAdmissionAttempts', 'rejectedAudioChunks'];
  const safeCounters = Object.fromEntries(counters.map(key => [key, finite(telemetry?.pressure?.[key]) ? telemetry.pressure[key] : null]));
  const outcomes = Object.fromEntries(['complete', 'error', 'skipped', 'cancelled', 'pending'].map(value =>
    [value, rows.filter(row => (row.outcome || 'pending') === value).length]));
  const missing = { orderedTimeline: rows.filter(row => !ordered(row)).length,
    primaryExecution: rows.filter(row => !executionComplete(row, 'primary')).length,
    externalExecution: externalRequired ? rows.filter(row => !executionComplete(row, 'external')).length : 0,
    serverTimings: rows.filter(row => !finite(row.server?.endpoint_ms)).length,
    poseTimings: rows.filter(row => !finite(row.pose?.total_ms)).length,
    requiredPoseTimings: rows.filter(row => !finite(row.pose?.total_ms) && row.poseSource !== 'browser-memory').length };
  const gate = {
    translationMode: latency?.mode === 'translation', schemaSupported: telemetry?.schema === 1,
    uniqueTraceIds: uniqueIds, noEviction: telemetry?.limits?.evictedRows === 0,
    minimumCompleteSamples: complete.length >= minimum, noIncompleteOrFailedRows: complete.length === rows.length,
    realSpansPresent: missing.serverTimings === 0 && missing.requiredPoseTimings === 0,
    captureUninterrupted: safeCounters.capturePauses === 0 && safeCounters.rejectedSourceWords === 0 && safeCounters.rejectedAudioChunks === 0,
    noRuntimeResets: telemetry?.runtimeResets === 0,
    harnessFinished: ledger?.result === 'PASS',
  };
  const handoff = output => {
    const executions = rows.flatMap(row => (row.executions || []).filter(execution => execution.output === output &&
      finite(execution.first) && finite(execution.last) && execution.last >= execution.first))
      .sort((a, b) => a.first - b.first);
    return distribution(executions.slice(1).flatMap((execution, index) => execution.first >= executions[index].last
      ? [execution.first - executions[index].last] : []));
  };
  // Execution and diagnostic coverage are different gates. A cached pose may
  // have no new service call. The current export does not label that provenance,
  // so show the missing coverage instead of claiming zero-time network work.
  const executionSampleGate = Object.entries(gate).filter(([key]) => key !== 'realSpansPresent' && key !== 'harnessFinished').every(([, value]) => value);
  return { kind: 'local-real-service-evidence-analysis', minimum, observedBatches: rows.length, completeBatches: complete.length,
    consistentSampleGate: Object.values(gate).every(Boolean), executionSampleGate,
    diagnosticCoverageComplete: gate.realSpansPresent, gate, outcomes, missing, pressure: safeCounters,
    poseSources: { service: rows.filter(row => row.poseSource === 'service').length,
      browserMemory: rows.filter(row => row.poseSource === 'browser-memory').length,
      unreported: rows.filter(row => !['service','browser-memory'].includes(row.poseSource)).length },
    runtimeResets: finite(telemetry?.runtimeResets) ? telemetry.runtimeResets : null,
    metricsMs: Object.fromEntries(Object.entries(intervals).map(([key, interval]) => [key, metric(interval)])),
    translationByContextCacheMs: Object.fromEntries(['hit', 'miss', 'unreported'].map(group => [group,
      metric(intervals.translationRequest, rows.filter(row => group === 'hit' ? row.contextCacheHit === true : group === 'miss' ? row.contextCacheHit === false : row.contextCacheHit === undefined))])),
    handoffMs: { primary: handoff('primary'), external: externalRequired ? handoff('external') : distribution([]) },
    // These stages overlap; never add them to infer total worker/Unity cost.
    serviceStagesMs: Object.fromEntries(['context_ms', 'provider_ms', 'validation_ms', 'endpoint_ms'].map(key => [key,
      distribution(rows.map(row => row.server?.[key]))])),
    poseStagesMs: Object.fromEntries(['total_ms', 'submit_request_ms', 'poll_request_ms', 'poll_wait_ms', 'retry_wait_ms',
      'proxy_upstream_submit_ms', 'proxy_upstream_status_ms', 'proxy_download_ms', 'proxy_validation_persist_ms'].map(key =>
      [key, distribution(rows.map(row => row.pose?.[key]))])),
    limitations: ['This gate checks internal sample consistency, NOT production approval, speedup, fluidity or linguistic accuracy.',
      'Service authenticity depends on the documented harness and runtime; JSON declarations alone do not prove it.',
      'ASR is injected. Admission-to-frame is not acoustic speech-to-frame.',
      'Native events are browser-received callbacks, not GPU presentation timestamps.',
      'Browser-memory replay has no new service call; older unlabeled missing pose spans remain unknown, never zero.',
      'Handoff includes queue/idle and scheduling; samples must be segmented before comparison.',
      'Service and pose timings overlap and do not separate internal worker queue/compute.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/analyze-real-services.mjs REPORT_DIRECTORY [MINIMUM=100]');
  const directory = resolve(process.argv[2] || '');
  const minimum = Number(process.argv[3] || 100);
  const files = await Promise.all(['latency.json', 'report.json'].map(async name => {
    const content = await readFile(resolve(directory, name));
    if (content.length > 16 * 1024 * 1024) throw new Error('Report exceeds safe input size');
    return JSON.parse(content);
  }));
  const result = analyzeRealServices(...files, minimum);
  console.log(JSON.stringify(result, null, 2));
  if (!result.consistentSampleGate) process.exitCode = 1;
}
