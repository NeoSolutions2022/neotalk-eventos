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
  // Segment raw callbacks instead of trusting exported aggregate percentiles.
  // Translation-ready is NOT evidence that Unity has prepared the next pose.
  const handoffSegments = output => {
    const executions = rows.flatMap((row, rowIndex) => (row.executions || [])
      .filter(execution => execution.output === output && finite(execution.first) && finite(execution.last) && execution.last >= execution.first)
      .map(execution => ({ ...execution, rowIndex, points: row.points })))
      .sort((a, b) => a.first - b.first);
    const groups = { translationReady: [], translationPending: [], inputNotAdmitted: [], unknown: [] };
    let repeatedExecutionTransitions = 0, overlappingTransitions = 0;
    for (let index = 1; index < executions.length; index++) {
      const previous = executions[index - 1], next = executions[index];
      if (previous.rowIndex === next.rowIndex) { repeatedExecutionTransitions++; continue; }
      if (next.first < previous.last) { overlappingTransitions++; continue; }
      const admitted = next.points?.admitted, ready = next.points?.translation_ready;
      let group = 'unknown';
      if (finite(admitted) && admitted > previous.last) group = 'inputNotAdmitted';
      else if (finite(admitted) && finite(ready) && ready >= admitted && ready <= next.first) {
        group = ready <= previous.last ? 'translationReady' : 'translationPending';
      }
      groups[group].push(next.first - previous.last);
    }
    return { ...Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, distribution(values)])),
      repeatedExecutionTransitions, overlappingTransitions };
  };
  const nativeObserved = output => {
    const executions = new Map();
    for (const event of Array.isArray(ledger?.observations) ? ledger.observations : []) {
      if (!event || event.output !== output || typeof event.loadId !== 'string' || !finite(event.at)) continue;
      const item = executions.get(event.loadId) || {};
      if (event.type === 'neotalk:playing') item.ack ??= event.at;
      if (event.type === 'neotalk:playback-frame' && Number.isInteger(event.frameCount) && event.frameCount > 0 &&
        Number.isInteger(event.frame) && event.frame >= 0 && event.frame < event.frameCount) {
        if (event.status === 'preparing') item.preparing ??= event.at;
        if (['started','progress'].includes(event.status) && item.first === undefined) {
          item.first = event.at; item.firstFrame = event.frame; item.frameCount = event.frameCount;
        }
        if (event.status === 'finished' && event.frame === event.frameCount - 1 && item.last === undefined) {
          item.last = event.at; item.lastFrame = event.frame; item.lastFrameCount = event.frameCount;
        }
      }
      executions.set(event.loadId, item);
    }
    const spans = point => distribution([...executions.values()].flatMap(item => finite(item[point]) && finite(item.first) &&
      finite(item.last) && item.first >= item[point] && item.last >= item.first ? [item.first - item[point]] : []));
    return { ackToFirstFrameMs: spans('ack'), preparingToFirstFrameMs: spans('preparing'),
      frameAdvancePerSecond: distribution([...executions.values()].flatMap(item => finite(item.first) && finite(item.last) &&
        item.last > item.first && item.frameCount === item.lastFrameCount && item.lastFrame >= item.firstFrame
        ? [(item.lastFrame - item.firstFrame) * 1000 / (item.last - item.first)] : [])) };
  };
  const outputBarrier = () => {
    const firstSkew = [], primaryTrailing = [], externalTrailing = [];
    let pairedBatches = 0, ambiguousBatches = 0, tiedTerminalCallbacks = 0;
    for (const row of rows) {
      const valid = output => (row.executions || []).filter(execution => execution.output === output &&
        finite(execution.first) && finite(execution.last) && execution.last >= execution.first);
      const primary = valid('primary'), external = valid('external');
      if (primary.length > 1 || external.length > 1) { ambiguousBatches++; continue; }
      if (primary.length !== 1 || external.length !== 1) continue;
      pairedBatches++;
      firstSkew.push(Math.abs(primary[0].first - external[0].first));
      const difference = primary[0].last - external[0].last;
      if (difference > 0) primaryTrailing.push(difference);
      else if (difference < 0) externalTrailing.push(-difference);
      else tiedTerminalCallbacks++;
    }
    return { pairedBatches, ambiguousBatches, tiedTerminalCallbacks, firstCallbackSkewMs: distribution(firstSkew),
      primaryTrailingMs: distribution(primaryTrailing), externalTrailingMs: distribution(externalTrailing) };
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
    queue: { peakPendingBatches: finite(telemetry?.pressure?.maxPendingBatches) ? telemetry.pressure.maxPendingBatches : null,
      sourceWords: finite(telemetry?.input?.sourceWords) ? telemetry.input.sourceWords : null,
      observedInputDurationMs: finite(telemetry?.input?.observedDurationMs) ? telemetry.input.observedDurationMs : null },
    metricsMs: Object.fromEntries(Object.entries(intervals).map(([key, interval]) => [key, metric(interval)])),
    translationByContextCacheMs: Object.fromEntries(['hit', 'miss', 'unreported'].map(group => [group,
      metric(intervals.translationRequest, rows.filter(row => group === 'hit' ? row.contextCacheHit === true : group === 'miss' ? row.contextCacheHit === false : row.contextCacheHit === undefined))])),
    handoffMs: { primary: handoff('primary'), external: externalRequired ? handoff('external') : distribution([]) },
    handoffSegmentsMs: { primary: handoffSegments('primary'), external: externalRequired ? handoffSegments('external') : null },
    outputBarrier: externalRequired ? outputBarrier() : null,
    nativeObservedIntervals: { primary: nativeObserved('primary'), external: nativeObserved('external') },
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
      'Frame advance per second is observed pose-index advancement between callbacks, not GPU FPS; requested playback speed and scheduling must be considered separately.',
      'ACK/preparing-to-first-frame uses observed wall-clock callbacks and includes scheduling, not isolated Unity CPU compute.',
      'Browser-memory replay has no new service call; older unlabeled missing pose spans remain unknown, never zero.',
      'Handoff includes queue/idle and scheduling; samples must be segmented before comparison.',
      'Handoff segments use next-batch admission/translation points at the prior terminal callback; translation readiness does not prove pose preparation. Repeats/overlaps are reported separately, not zero-valued gaps.',
      'Output barrier skew pairs exactly one complete execution per output/batch; ambiguous retries are counted, not arbitrarily paired. Trailing callback time is not isolated renderer CPU cost.',
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
