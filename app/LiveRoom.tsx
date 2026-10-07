"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { isNonBlockingAvatarError, isRetryableAvatarError } from "./avatarMessages";
import { ApiError, apiRequest } from "./apiClient";
import { batchFlushDelayMs, LIVE_IDLE_LOOP_GAP_MS, matchesActivePhrase, playbackDurationMs } from "./liveTiming";
import { LiveSessionScope, OrderedTranscriptBuffer, retryLiveRequest } from "./liveResilience";

type AvatarId = "lia" | "asuna" | "elia";
type RemoteBatchStatus = "queued" | "translating" | "done" | "error";
type LiveBatch = { id: number; text: string; glossText?: string; admittedAt?: number; status: RemoteBatchStatus | "ready" | "playing" };
type SpeechResultEvent = { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; 0: { transcript: string } } } };
type SpeechErrorEvent = { error: string };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type DocumentPictureInPictureApi = { requestWindow: (options?: { width?: number; height?: number }) => Promise<Window> };
type NativePlayback = { primaryId: string | null; externalId: string | null; primaryDone: boolean; externalDone: boolean; externalRequired: boolean; primaryFrame: number; externalFrame: number };
const emptyNativePlayback = (): NativePlayback => ({ primaryId: null, externalId: null, primaryDone: false, externalDone: false, externalRequired: false, primaryFrame: -1, externalFrame: -1 });
type SharedPose = { phrase: string; pose: { content_url: string; fps?: number; frame_count?: number }; words: string[]; loadId?: string; traceId?: string; taskId?: string };
type AvatarMessage = { type?: string; avatar?: string; status?: string; code?: string; message?: string; phrase?: string; pose?: SharedPose["pose"]; words?: unknown[]; capabilities?: string[]; stage?: string; traceId?: string; taskId?: string; loadId?: string; correlationId?: string; poseId?: string; attempt?: number; elapsedMs?: number; networkMs?: number | null; acknowledgedPoseId?: boolean };
type PoseDiagnostic = { at: string; output: "principal" | "mini-player"; batchId: number | null; event: string; stage?: string; code?: string; loadId?: string; correlationId?: string; traceId?: string; taskId?: string; poseId?: string; attempt?: number; elapsedMs?: number; networkMs?: number | null; acknowledgedPoseId?: boolean };
type RoomResponse = { id: string; status: string };
type BatchResponse = { id: string; status: string };
type AgentTranslation = { gloss_text: string; prompt_id?: string; model?: string; agent_latency_ms?: number; skipped?: boolean; reason?: string };

const avatarWidgetBase = process.env.NEXT_PUBLIC_AVATAR_WIDGET_URL || "https://infra-avatar3d-oficial.k3p3ex.easypanel.host/widget";
const avatarNames: Record<AvatarId, string> = { lia: "Lia", asuna: "Asuna", elia: "Elia" };
const LIVE_BATCH_MIN_WORDS = 2;
const LIVE_BATCH_MAX_WORDS = 12;
const LIVE_AGENT_CONCURRENCY = 2;
const LIVE_PENDING_LIMIT = 24;
const LIVE_RESUME_LIMIT = 8;
const LIVE_BUFFER_LIMIT = 120;
const LIVE_COMPOUND_BATCH_MAX_WORDS = 36;
const LIVE_IDLE_LOOP_DELAY_MS = 2200;
const LIVE_AVATAR_RETRY_DELAY_MS = 2500;
const LIVE_AVATAR_MAX_RETRIES = 2;
// O widget comunica progresso durante o polling; silêncio prolongado indica travamento.
const LIVE_AVATAR_PROCESSING_TIMEOUT_MS = 20000;
const LIVE_AVATAR_POSE_LOAD_TIMEOUT_MS = 35000;
const LIVE_AVATAR_MAX_RECOVERIES = 1;
const LIVE_FALLBACK_CHUNK_MS = 3200;
const LIVE_TRANSCRIPTION_CONCURRENCY = 2;
const LIVE_TRANSCRIPTION_BACKLOG = 6;
const LIVE_HEARTBEAT_INTERVAL_MS = 25000;
const LIVE_HEARTBEAT_RETRY_MS = 5000;
const poseKey = (phrase: string) => phrase.replace(/\s+/g, " ").trim().toUpperCase();

async function roomApi<T>(path: string, options?: RequestInit): Promise<T> {
  return apiRequest<T>(path, options);
}

export default function LiveRoom({ recording, setRecording, time, showToast, diagnostics = false, offline = false, captureAvailable = true }: {
  recording: boolean;
  setRecording: (value: boolean) => void;
  time: string;
  showToast: (value: string) => void;
  diagnostics?: boolean;
  offline?: boolean;
  captureAvailable?: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sessionScopeRef = useRef(new LiveSessionScope());
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const orderedTranscriptsRef = useRef(new OrderedTranscriptBuffer());
  const captureControllerRef = useRef(new AbortController());
  const stageRef = useRef<HTMLDivElement>(null);
  const externalWindowRef = useRef<Window | null>(null);
  const externalFrameRef = useRef<HTMLIFrameElement | null>(null);
  const externalCaptionRef = useRef<HTMLDivElement | null>(null);
  const embeddedAvatarReadyRef = useRef(false);
  const externalAvatarReadyRef = useRef(false);
  const avatarSupportsSharedPoseRef = useRef(false);
  const avatarSupportsPrefetchRef = useRef(false);
  const externalSupportsSharedPoseRef = useRef(false);
  const avatarSupportsNativePlaybackRef = useRef(false);
  const externalSupportsNativePlaybackRef = useRef(false);
  const nativePlaybackRef = useRef<NativePlayback>(emptyNativePlayback());
  const latestPoseRef = useRef<SharedPose | null>(null);
  const prefetchedPosesRef = useRef(new Map<string, SharedPose>());
  const prefetchingPhrasesRef = useRef(new Set<string>());
  const prefetchStartedAtRef = useRef(new Map<string, number>());
  const batchDispatchedAtRef = useRef(0);
  const expectedPoseCorrelationRef = useRef<string | null>(null);
  const recentPosesRef = useRef(new Map<string, SharedPose>());
  const externalCurrentPoseRef = useRef<SharedPose | null>(null);
  const externalPoseRecoveryRef = useRef({ correlationId: "", attempts: 0 });
  const poseDiagnosticsRef = useRef<PoseDiagnostic[]>([]);
  const avatarMessageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fallbackRecorderRef = useRef<MediaRecorder | null>(null);
  const fallbackStreamRef = useRef<MediaStream | null>(null);
  const fallbackChunkTimerRef = useRef<number | null>(null);
  const fallbackCaptureGenerationRef = useRef(0);
  const fallbackRecoveryInFlightRef = useRef(false);
  const fallbackTranscriptionQueueRef = useRef<{ blob: Blob; generation: number; sequence: number }[]>([]);
  const fallbackTranscriptionInFlightRef = useRef(0);
  const transcriptionOverloadNoticeAtRef = useRef(0);
  const recoverFallbackCaptureRef = useRef<() => void>(() => undefined);
  const heartbeatTimerRef = useRef<number | null>(null);
  const heartbeatInFlightRef = useRef(false);
  const heartbeatFailuresRef = useRef(0);
  const restartRecognitionRef = useRef<(delay?: number) => void>(() => undefined);
  const listeningRef = useRef(false);
  const microphoneMutedRef = useRef(false);
  const pressurePausedRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const recognitionWatchdogRef = useRef<number | null>(null);
  const sessionHealthTimerRef = useRef<number | null>(null);
  const recognitionActivityAtRef = useRef(0);
  const batchTimerRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const idleLoopTimerRef = useRef<number | null>(null);
  const avatarRetryTimerRef = useRef<number | null>(null);
  const avatarProcessingTimerRef = useRef<number | null>(null);
  const avatarRetryCountRef = useRef(0);
  const avatarRecoveryCountRef = useRef(0);
  const avatarCommandAcknowledgedRef = useRef(false);
  const avatarPlaybackStartedRef = useRef(false);
  const wordBufferRef = useRef<string[]>([]);
  const pendingBatchesRef = useRef<LiveBatch[]>([]);
  const activeBatchRef = useRef<LiveBatch | null>(null);
  const recentPhrasesRef = useRef<LiveBatch[]>([]);
  const idleLoopActiveRef = useRef(false);
  const idleLoopIndexRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const avatarReadyRef = useRef(false);
  const avatarBusyRef = useRef(false);
  const batchIdRef = useRef(0);
  const roomIdRef = useRef<string | null>(null);
  const roomStartedAtRef = useRef<number | null>(null);
  const remoteBatchIdsRef = useRef(new Map<number, string>());
  const desiredBatchStatusRef = useRef(new Map<number, RemoteBatchStatus>());
  const agentResultsRef = useRef(new Map<number, AgentTranslation>());
  const agentPromisesRef = useRef(new Map<number, Promise<void>>());

  const [avatar, setAvatar] = useState<AvatarId>("elia");
  const [avatarReady, setAvatarReady] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState("Conectando à Elia");
  const [, setAvatarError] = useState("");
  const [interimCaption, setInterimCaption] = useState("");
  const [lastCaption, setLastCaption] = useState("");
  const [microphoneName, setMicrophoneName] = useState("Microfone padrão");
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [transcriptionEngine, setTranscriptionEngine] = useState<"browser" | "server">("browser");
  const [stageZoom, setStageZoom] = useState(1);
  const [batches, setBatches] = useState<LiveBatch[]>([]);
  const [panelTab, setPanelTab] = useState<"room" | "captions">("room");
  const [completedHistory, setCompletedHistory] = useState<LiveBatch[]>([]);
  const [processedBatches, setProcessedBatches] = useState(0);
  const [roomName, setRoomName] = useState("Evento institucional 2026");
  const [backendStatus, setBackendStatus] = useState("Verificando histórico");
  const [externalPlayerMode, setExternalPlayerMode] = useState<"pip" | "window" | null>(null);
  const [cameraGuideOpen, setCameraGuideOpen] = useState(false);
  const [widgetUrl] = useState(() => {
    const url = new URL(avatarWidgetBase);
    url.searchParams.set("avatar", "elia");
    url.searchParams.set("loop", "0");
    url.searchParams.set("background", "#10233f");
    return url.toString();
  });
  const widgetOrigin = new URL(avatarWidgetBase).origin;

  const updateRemoteBatch = async (localId: number, status: RemoteBatchStatus, errorMessage?: string) => {
    const signal = sessionScopeRef.current.signal;
    if (signal.aborted) return;
    desiredBatchStatusRef.current.set(localId, status);
    const remoteId = remoteBatchIdsRef.current.get(localId);
    if (!remoteId) return;
    try {
      const agent = agentResultsRef.current.get(localId);
      await roomApi<BatchResponse>(`/batches/${remoteId}`, {
        method: "PATCH",
        signal,
        body: JSON.stringify({
          status,
          error_message: errorMessage || null,
          gloss_text: agent?.gloss_text || null,
          prompt_id: agent?.prompt_id || null,
          model: agent?.model || null,
          agent_latency_ms: agent?.agent_latency_ms ?? null,
        }),
      });
      if (sessionScopeRef.current.isCurrent(signal)) setBackendStatus("Histórico sincronizado");
    } catch {
      if (sessionScopeRef.current.isCurrent(signal)) setBackendStatus("Falha ao sincronizar lote");
    } finally {
      if (sessionScopeRef.current.isCurrent(signal) && ["done", "error"].includes(status)
          && desiredBatchStatusRef.current.get(localId) === status) {
        remoteBatchIdsRef.current.delete(localId);
        desiredBatchStatusRef.current.delete(localId);
        agentResultsRef.current.delete(localId);
      }
    }
  };

  const persistBatch = async (batch: LiveBatch) => {
    const signal = sessionScopeRef.current.signal;
    const roomId = roomIdRef.current;
    if (!roomId) return;
    try {
      const remote = await roomApi<BatchResponse>(`/rooms/${roomId}/batches`, {
        method: "POST",
        signal,
        body: JSON.stringify({ text: batch.text }),
      });
      if (!sessionScopeRef.current.isCurrent(signal)) return;
      remoteBatchIdsRef.current.set(batch.id, remote.id);
      const desiredStatus = desiredBatchStatusRef.current.get(batch.id);
      if (desiredStatus && desiredStatus !== "queued") await updateRemoteBatch(batch.id, desiredStatus);
      else setBackendStatus("Histórico sincronizado");
    } catch {
      if (sessionScopeRef.current.isCurrent(signal)) setBackendStatus("Falha ao salvar lote");
    }
  };

  const refreshBatchView = () => {
    const active = activeBatchRef.current ? [{ ...activeBatchRef.current }] : [];
    const visiblePending = pendingBatchesRef.current.filter((batch) => batch.status !== "error");
    setBatches([...active, ...visiblePending].slice(0, 4).concat(recentPhrasesRef.current.slice().reverse()));
  };

  const rememberPose = (shared: SharedPose) => {
    const key = poseKey(shared.phrase);
    recentPosesRef.current.delete(key);
    recentPosesRef.current.set(key, shared);
    while (recentPosesRef.current.size > 8) recentPosesRef.current.delete(recentPosesRef.current.keys().next().value!);
  };

  const prefetchNextBatch = () => {
    if (!embeddedAvatarReadyRef.current || !avatarSupportsPrefetchRef.current || !avatarBusyRef.current) return;
    const next = pendingBatchesRef.current.find((batch) => batch.status !== "error");
    if (!next || next.status !== "ready" || !next.glossText) return;
    const key = poseKey(next.glossText);
    if (recentPosesRef.current.has(key) || prefetchedPosesRef.current.has(key) || prefetchingPhrasesRef.current.has(key)) return;
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    prefetchingPhrasesRef.current.add(key);
    prefetchStartedAtRef.current.set(key, Date.now());
    recordPoseDiagnostic("principal", { type: "neotalk:prefetch-start" }, next.id);
    frame.postMessage({ type: "neotalk:prefetch", phrase: next.glossText }, widgetOrigin);
  };

  const poseCommandFor = (phrase: string): Record<string, unknown> => {
    const cached = recentPosesRef.current.get(poseKey(phrase));
    return cached && avatarSupportsSharedPoseRef.current ? { type: "neotalk:load-pose", ...cached } : { type: "neotalk:sign", phrase };
  };

  const recordPoseDiagnostic = (output: PoseDiagnostic["output"], data: AvatarMessage, batchId = activeBatchRef.current?.id ?? null) => {
    const event: PoseDiagnostic = {
      at: new Date().toISOString(), output, batchId,
      event: data.type || "unknown", stage: data.stage, code: data.code,
      loadId: data.loadId, correlationId: data.correlationId, traceId: data.traceId,
      taskId: data.taskId, poseId: data.poseId, attempt: data.attempt,
      elapsedMs: data.elapsedMs, networkMs: data.networkMs, acknowledgedPoseId: data.acknowledgedPoseId,
    };
    poseDiagnosticsRef.current = [...poseDiagnosticsRef.current, event].slice(-120);
  };

  const recordNativeFrameDiagnostic = (output: PoseDiagnostic["output"], data: AvatarMessage) => {
    const native = data as AvatarMessage & { frame?: number; frameCount?: number; revision?: number; fps?: number };
    if (!Number.isInteger(native.frame) || !Number.isInteger(native.frameCount)
        || native.frame! < 0 || native.frameCount! < 1 || native.frame! >= native.frameCount!) return;
    const event: PoseDiagnostic & { status?: string; frame: number; frameCount: number; revision?: number; fps?: number } = {
      at: new Date().toISOString(), output, batchId: activeBatchRef.current?.id ?? null,
      event: "neotalk:playback-frame", status: native.status,
      loadId: native.loadId, correlationId: native.correlationId,
      frame: native.frame!, frameCount: native.frameCount!, revision: native.revision, fps: native.fps,
    };
    poseDiagnosticsRef.current = [...poseDiagnosticsRef.current, event].slice(-120);
  };

  const sendToAvatar = (message: Record<string, unknown>) => {
    let embeddedSent = false;
    if (embeddedAvatarReadyRef.current && frameRef.current?.contentWindow) {
      if (["neotalk:sign", "neotalk:load-pose", "neotalk:replay"].includes(String(message.type))) {
        nativePlaybackRef.current = emptyNativePlayback();
        if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      if (message.type === "neotalk:load-pose") expectedPoseCorrelationRef.current = String(message.loadId || message.correlationId || "");
      else if (message.type === "neotalk:sign") expectedPoseCorrelationRef.current = null;
      frameRef.current.contentWindow.postMessage(message, widgetOrigin);
      embeddedSent = true;
    }
    const externalWindow = externalWindowRef.current;
    if (externalWindow && !externalWindow.closed) {
      if (!embeddedSent && ["neotalk:sign", "neotalk:replay"].includes(String(message.type))) return false;
      if (!externalAvatarReadyRef.current || !externalFrameRef.current?.contentWindow) return embeddedSent;
      if (avatarSupportsSharedPoseRef.current && externalSupportsSharedPoseRef.current && ["neotalk:sign", "neotalk:replay"].includes(String(message.type))) return embeddedSent;
      if (message.type === "neotalk:load-pose") {
        const shared = message as SharedPose;
        if (!externalSupportsSharedPoseRef.current) {
          externalWindow.postMessage({ type: "neotalk:external-player-command", message: { type: "neotalk:sign", phrase: shared.phrase } }, window.location.origin);
          return true;
        }
        externalCurrentPoseRef.current = shared;
        nativePlaybackRef.current.externalRequired = externalSupportsNativePlaybackRef.current;
        const correlationId = shared.loadId || "";
        if (externalPoseRecoveryRef.current.correlationId !== correlationId) externalPoseRecoveryRef.current = { correlationId, attempts: 0 };
      }
      externalWindow.postMessage({ type: "neotalk:external-player-command", message }, window.location.origin);
      return true;
    }
    return embeddedSent;
  };

  const sendSharedPoseToExternal = (shared: SharedPose) => {
    const outputWindow = externalWindowRef.current;
    if (!outputWindow || outputWindow.closed || !externalAvatarReadyRef.current || !externalSupportsSharedPoseRef.current) return;
    externalCurrentPoseRef.current = shared;
    nativePlaybackRef.current.externalRequired = externalSupportsNativePlaybackRef.current;
    nativePlaybackRef.current.externalId = null;
    nativePlaybackRef.current.externalDone = false;
    nativePlaybackRef.current.externalFrame = -1;
    const correlationId = shared.loadId || "";
    if (externalPoseRecoveryRef.current.correlationId !== correlationId) externalPoseRecoveryRef.current = { correlationId, attempts: 0 };
    outputWindow.postMessage({ type: "neotalk:external-player-command", message: { type: "neotalk:load-pose", ...shared } }, window.location.origin);
  };

  const clearIdleLoopTimer = () => {
    if (idleLoopTimerRef.current) window.clearTimeout(idleLoopTimerRef.current);
    idleLoopTimerRef.current = null;
  };

  const clearAvatarRetryTimer = () => {
    if (avatarRetryTimerRef.current) window.clearTimeout(avatarRetryTimerRef.current);
    avatarRetryTimerRef.current = null;
  };

  const clearAvatarProcessingTimer = () => {
    if (avatarProcessingTimerRef.current) window.clearTimeout(avatarProcessingTimerRef.current);
    avatarProcessingTimerRef.current = null;
  };

  const playIdleLoopPhrase = () => {
    clearIdleLoopTimer();
    clearAvatarRetryTimer();
    if (!listeningRef.current || !avatarReadyRef.current || avatarBusyRef.current || activeBatchRef.current || pendingBatchesRef.current.length || wordBufferRef.current.length) return;
    const recentPhrases = recentPhrasesRef.current;
    if (!recentPhrases.length) return;
    const phraseIndex = idleLoopIndexRef.current % recentPhrases.length;
    const phrase = recentPhrases[phraseIndex];
    idleLoopIndexRef.current = (phraseIndex + 1) % recentPhrases.length;
    idleLoopActiveRef.current = true;
    avatarBusyRef.current = true;
    avatarRetryCountRef.current = 0;
    avatarRecoveryCountRef.current = 0;
    avatarCommandAcknowledgedRef.current = false;
    avatarPlaybackStartedRef.current = false;
    setAvatarError("");
    setAvatarStatus(`${avatarNames[avatar]} mantendo a tradução ativa`);
    latestPoseRef.current = recentPosesRef.current.get(poseKey(phrase.glossText || phrase.text)) || null;
    if (!sendToAvatar(poseCommandFor(phrase.glossText || phrase.text))) {
      idleLoopActiveRef.current = false;
      avatarBusyRef.current = false;
    } else scheduleAvatarRetry();
  };

  const scheduleIdleLoop = (minimumDelay = LIVE_IDLE_LOOP_DELAY_MS) => {
    clearIdleLoopTimer();
    if (!listeningRef.current || activeBatchRef.current || pendingBatchesRef.current.length || wordBufferRef.current.length || !recentPhrasesRef.current.length) return;
    // Executado apenas pelo timer/evento de reprodução, nunca durante o render.
    const silenceRemaining = Math.max(0, LIVE_IDLE_LOOP_DELAY_MS - (Date.now() - lastSpeechAtRef.current));
    idleLoopTimerRef.current = window.setTimeout(playIdleLoopPhrase, Math.max(minimumDelay, silenceRemaining));
  };

  const finishIdleLoopPhrase = () => {
    if (!idleLoopActiveRef.current) return;
    idleLoopActiveRef.current = false;
    avatarBusyRef.current = false;
    setAvatarStatus(`${avatarNames[avatar]} aguardando nova fala`);
    dispatchNextBatch();
    if (!avatarBusyRef.current) scheduleIdleLoop(LIVE_IDLE_LOOP_GAP_MS);
  };

  const interruptIdleLoopForSpeech = () => {
    // Executado apenas em resposta à captura de fala.
    lastSpeechAtRef.current = Date.now();
    clearIdleLoopTimer();
    if (idleLoopActiveRef.current) {
      // Preserve a palavra final do sinal em execução. A nova fala é traduzida
      // em paralelo e entra na fila assim que a pose atual termina.
      setAvatarStatus("Nova fala detectada · concluindo sinal atual");
      return;
    }
    scheduleIdleLoop();
  };

  function dispatchNextBatch() {
    if (!listeningRef.current) return;
    if (!avatarReadyRef.current || avatarBusyRef.current || !pendingBatchesRef.current.length) return;
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
    clearIdleLoopTimer();
    clearAvatarRetryTimer();
    clearAvatarProcessingTimer();
    while (pendingBatchesRef.current[0]?.status === "error") pendingBatchesRef.current.shift();
    const first = pendingBatchesRef.current[0];
    if (!first || first.status !== "ready") return;
    const next = pendingBatchesRef.current.shift();
    if (!next) return;
    next.status = "playing";
    recordPoseDiagnostic("principal", { type: "neotalk:queue-dispatch", elapsedMs: next.admittedAt ? Date.now() - next.admittedAt : undefined }, next.id);
    latestPoseRef.current = null;
    expectedPoseCorrelationRef.current = null;
    void updateRemoteBatch(next.id, "translating");
    activeBatchRef.current = next;
    batchDispatchedAtRef.current = Date.now();
    avatarBusyRef.current = true;
    avatarRetryCountRef.current = 0;
    avatarRecoveryCountRef.current = 0;
    avatarCommandAcknowledgedRef.current = false;
    avatarPlaybackStartedRef.current = false;
    refreshBatchView();
    setAvatarError("");
    setAvatarStatus(`Enviando glosas para ${avatarNames[avatar]}`);
    const key = poseKey(next.glossText || "");
    const prepared = prefetchedPosesRef.current.get(key) || recentPosesRef.current.get(key);
    if (prepared) {
      prefetchedPosesRef.current.delete(key);
      latestPoseRef.current = prepared;
    }
    if (!sendToAvatar(prepared && avatarSupportsSharedPoseRef.current
      ? { type: "neotalk:load-pose", ...prepared }
      : { type: "neotalk:sign", phrase: next.glossText })) {
      next.status = "ready";
      pendingBatchesRef.current.unshift(next);
      activeBatchRef.current = null;
      avatarBusyRef.current = false;
      refreshBatchView();
    } else {
      scheduleAvatarRetry();
      prefetchNextBatch();
      pretranslatePendingBatches();
    }
  }

  const translateBatch = (batch: LiveBatch) => {
    if (batch.status !== "queued" || agentPromisesRef.current.has(batch.id)) return;
    batch.status = "translating";
    // Persist only when the text is sealed. Waiting batches may absorb adjacent
    // speech fragments, reducing API/pose handoffs during natural fast speech.
    void persistBatch(batch);
    void updateRemoteBatch(batch.id, "translating");
    refreshBatchView();
    const signal = sessionScopeRef.current.signal;
    const translationStartedAt = Date.now();
    let translationAttempt = 0;
    const request = retryLiveRequest(() => {
      recordPoseDiagnostic("principal", { type: "neotalk:translation-request", attempt: ++translationAttempt }, batch.id);
      return roomApi<AgentTranslation>("/agent/translate", {
      method: "POST",
      signal,
      body: JSON.stringify({ text: batch.text, batch_id: remoteBatchIdsRef.current.get(batch.id) || null }),
      });
    }, signal).then((agent) => {
      if (!sessionScopeRef.current.isCurrent(signal)) return;
      recordPoseDiagnostic("principal", { type: "neotalk:translation-ready", elapsedMs: Date.now() - translationStartedAt, attempt: translationAttempt }, batch.id);
      if (agent.skipped || !agent.gloss_text.trim()) {
        batch.status = "error";
        setAvatarError("");
        void updateRemoteBatch(batch.id, "error", agent.reason || "Trecho sem glosa disponível no catálogo.");
        return;
      }
      batch.glossText = agent.gloss_text;
      batch.status = "ready";
      agentResultsRef.current.set(batch.id, agent);
      void updateRemoteBatch(batch.id, "translating");
      prefetchNextBatch();
    }).catch((reason) => {
      if (!sessionScopeRef.current.isCurrent(signal)) return;
      recordPoseDiagnostic("principal", { type: "neotalk:translation-error", elapsedMs: Date.now() - translationStartedAt, attempt: translationAttempt }, batch.id);
      const message = reason instanceof Error ? reason.message : "O agente não conseguiu traduzir o lote.";
      batch.status = "error";
      if (diagnostics) setAvatarError(message);
      else {
        setAvatarError("");
        setAvatarStatus("A tradução segue ouvindo os próximos trechos");
      }
      void updateRemoteBatch(batch.id, "error", message);
    }).finally(() => {
      if (!sessionScopeRef.current.isCurrent(signal)) return;
      agentPromisesRef.current.delete(batch.id);
      pendingBatchesRef.current = pendingBatchesRef.current.filter(item => item.status !== "error");
      if (pressurePausedRef.current) flushWordBuffer(true);
      refreshBatchView();
      pretranslatePendingBatches();
      dispatchNextBatch();
    });
    agentPromisesRef.current.set(batch.id, request);
  };

  const pretranslatePendingBatches = () => {
    // Keep a small translated lookahead, not an entire immutable queue of
    // tiny fragments. Unstarted text can still be grouped under pressure.
    let available = LIVE_AGENT_CONCURRENCY - agentPromisesRef.current.size
      - pendingBatchesRef.current.filter(batch => batch.status === "ready").length;
    if (available <= 0) return;
    for (const batch of pendingBatchesRef.current) {
      if (batch.status !== "queued") continue;
      translateBatch(batch);
      available -= 1;
      if (available <= 0) break;
    }
  };

  const completeActiveBatch = (completion: "estimated" | "native" = "estimated") => {
    clearAvatarProcessingTimer();
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
    if (!activeBatchRef.current) return;
    const completedBatch = activeBatchRef.current;
    recordPoseDiagnostic("principal", { type: `neotalk:completion-${completion}`, elapsedMs: completedBatch.admittedAt ? Date.now() - completedBatch.admittedAt : undefined }, completedBatch.id);
    completedBatch.status = "done";
    setCompletedHistory((history) => [{ ...completedBatch }, ...history].slice(0, 50));
    void updateRemoteBatch(completedBatch.id, "done");
    setProcessedBatches((value) => value + 1);
    recentPhrasesRef.current = [...recentPhrasesRef.current, { ...completedBatch }].slice(-2);
    activeBatchRef.current = null;
    avatarBusyRef.current = false;
    avatarCommandAcknowledgedRef.current = false;
    pretranslatePendingBatches();
    if (pressurePausedRef.current) flushWordBuffer(true);
    refreshBatchView();
    dispatchNextBatch();
    scheduleIdleLoop();
  };

  function finishNativePlayback() {
    const native = nativePlaybackRef.current;
    if (!avatarBusyRef.current || !native.primaryDone) return;
    const externalOpen = externalWindowRef.current && !externalWindowRef.current.closed;
    if (native.externalRequired && externalOpen && !native.externalDone) return;
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
    if (idleLoopActiveRef.current) finishIdleLoopPhrase();
    else completeActiveBatch("native");
  }

  function scheduleNativePlaybackWatchdog() {
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
    const execution = nativePlaybackRef.current;
    playbackTimerRef.current = window.setTimeout(() => {
      playbackTimerRef.current = null;
      if (!listeningRef.current || !avatarBusyRef.current || execution !== nativePlaybackRef.current) return;
      finishNativePlayback();
      if (execution !== nativePlaybackRef.current || !avatarBusyRef.current) return;
      recordPoseDiagnostic("principal", { type: "neotalk:playback-stalled", loadId: execution.primaryId || undefined });
      // Silence is not proof of failure (hidden tab, busy GPU, long preparation).
      // Never restart or discard an accepted native execution on a timer.
      scheduleNativePlaybackWatchdog();
    }, LIVE_AVATAR_PROCESSING_TIMEOUT_MS);
  }

  function handleNativePlaybackFrame(data: AvatarMessage, external: boolean) {
    if (!avatarBusyRef.current || !listeningRef.current || !avatarSupportsNativePlaybackRef.current) return;
    const native = nativePlaybackRef.current;
    const packet = data as AvatarMessage & { frame?: number; frameCount?: number };
    const id = external ? native.externalId : native.primaryId;
    if (!id || data.loadId !== id || !Number.isInteger(packet.frame) || !Number.isInteger(packet.frameCount)
        || packet.frame! < 0 || packet.frameCount! < 1 || packet.frame! >= packet.frameCount!) return;
    if (!["preparing", "started", "progress", "finished"].includes(data.status || "")) return;
    if (data.status === "finished") {
      if (packet.frame !== packet.frameCount! - 1) return;
      if (external) native.externalDone = true;
      else native.primaryDone = true;
      finishNativePlayback();
      return;
    }
    if (external ? native.externalDone : native.primaryDone) return;
    const previousFrame = external ? native.externalFrame : native.primaryFrame;
    if (external) native.externalFrame = packet.frame!;
    else native.primaryFrame = packet.frame!;
    if (!external && ["started", "progress"].includes(data.status || "")) {
      avatarPlaybackStartedRef.current = true;
      clearAvatarProcessingTimer();
    }
    if (data.status === "preparing" || packet.frame! > previousFrame) scheduleNativePlaybackWatchdog();
  }

  const releaseAvatarAfterRetryFailure = () => {
    clearAvatarRetryTimer();
    clearAvatarProcessingTimer();
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
    avatarRetryCountRef.current = 0;
    avatarCommandAcknowledgedRef.current = false;
    avatarPlaybackStartedRef.current = false;
    if (idleLoopActiveRef.current) {
      idleLoopActiveRef.current = false;
      avatarBusyRef.current = false;
      dispatchNextBatch();
      if (!avatarBusyRef.current) scheduleIdleLoop(LIVE_IDLE_LOOP_DELAY_MS);
      return;
    }
    const failedBatch = activeBatchRef.current;
    if (failedBatch) {
      failedBatch.status = "error";
      void updateRemoteBatch(failedBatch.id, "error", "O avatar recusou o lote após as retentativas.");
    }
    activeBatchRef.current = null;
    avatarBusyRef.current = false;
    setAvatarError("");
    setAvatarStatus(`${avatarNames[avatar]} seguindo com a próxima frase`);
    pretranslatePendingBatches();
    if (pressurePausedRef.current) flushWordBuffer(true);
    refreshBatchView();
    dispatchNextBatch();
    scheduleIdleLoop();
  };

  const retryCurrentAvatarPhrase = () => {
    if (avatarPlaybackStartedRef.current || avatarCommandAcknowledgedRef.current) return;
    if (avatarRetryCountRef.current >= LIVE_AVATAR_MAX_RETRIES) {
      releaseAvatarAfterRetryFailure();
      return;
    }
    const phrase = idleLoopActiveRef.current
      ? recentPhrasesRef.current[idleLoopIndexRef.current === 0 ? recentPhrasesRef.current.length - 1 : idleLoopIndexRef.current - 1]
      : activeBatchRef.current;
    const text = phrase?.glossText || phrase?.text;
    if (!text) {
      releaseAvatarAfterRetryFailure();
      return;
    }
    avatarRetryCountRef.current += 1;
    avatarCommandAcknowledgedRef.current = false;
    setAvatarStatus("Reenviando sinais");
    if (!sendToAvatar(poseCommandFor(text))) releaseAvatarAfterRetryFailure();
    else scheduleAvatarRetry();
  };

  const recoverAcceptedAvatarPhrase = () => {
    clearAvatarProcessingTimer();
    if (!avatarBusyRef.current || avatarPlaybackStartedRef.current) return;
    if (avatarCommandAcknowledgedRef.current) {
      recordPoseDiagnostic("principal", { type: "neotalk:processing-delayed" });
      scheduleAvatarProcessingWatchdog("processing");
      return;
    }
    if (avatarRecoveryCountRef.current >= LIVE_AVATAR_MAX_RECOVERIES) {
      // Um lote lento não significa que o WebGL travou. Preserve o renderizador,
      // encerre apenas este lote e deixe os próximos avançarem pela fila.
      releaseAvatarAfterRetryFailure();
      return;
    }
    const phrase = idleLoopActiveRef.current
      ? recentPhrasesRef.current[idleLoopIndexRef.current === 0 ? recentPhrasesRef.current.length - 1 : idleLoopIndexRef.current - 1]
      : activeBatchRef.current;
    const text = phrase?.glossText || phrase?.text;
    if (!text) {
      releaseAvatarAfterRetryFailure();
      return;
    }
    avatarRecoveryCountRef.current += 1;
    avatarCommandAcknowledgedRef.current = false;
    avatarPlaybackStartedRef.current = false;
    setAvatarStatus(`Reconectando ${avatarNames[avatar]} à tradução`);
    if (!sendToAvatar(poseCommandFor(text))) releaseAvatarAfterRetryFailure();
    else scheduleAvatarRetry();
  };

  const scheduleAvatarProcessingWatchdog = (status: string) => {
    clearAvatarProcessingTimer();
    if (!avatarBusyRef.current || avatarPlaybackStartedRef.current) return;
    const timeout = status === "loading_pose" ? LIVE_AVATAR_POSE_LOAD_TIMEOUT_MS : LIVE_AVATAR_PROCESSING_TIMEOUT_MS;
    avatarProcessingTimerRef.current = window.setTimeout(recoverAcceptedAvatarPhrase, timeout);
  };

  const scheduleAvatarRetry = () => {
    clearAvatarRetryTimer();
    if (avatarPlaybackStartedRef.current || avatarCommandAcknowledgedRef.current) return;
    avatarRetryTimerRef.current = window.setTimeout(retryCurrentAvatarPhrase, LIVE_AVATAR_RETRY_DELAY_MS);
  };

  const enqueueBatch = (text: string) => {
    if (!listeningRef.current) return false;
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return false;
    const tail = pendingBatchesRef.current.at(-1);
    if (pendingBatchesRef.current.length >= 3 && tail?.status === "queued"
        && tail.text.length + 1 + normalized.length <= 480
        && tail.text.split(" ").length + normalized.split(" ").length <= LIVE_COMPOUND_BATCH_MAX_WORDS) {
      tail.text += ` ${normalized}`;
      refreshBatchView();
      return true;
    }
    // Never evict an accepted phrase or reset Unity to catch up. At sustained
    // overload, pause admission visibly while the existing queue keeps playing.
    if (pendingBatchesRef.current.length >= LIVE_PENDING_LIMIT) {
      pauseCaptureForPressure();
      return false;
    }
    clearIdleLoopTimer();
    const batch: LiveBatch = { id: ++batchIdRef.current, text: normalized, admittedAt: Date.now(), status: "queued" };
    recordPoseDiagnostic("principal", { type: "neotalk:queue-admitted" }, batch.id);
    pendingBatchesRef.current.push(batch);
    desiredBatchStatusRef.current.set(batch.id, "queued");
    refreshBatchView();
    pretranslatePendingBatches();
    dispatchNextBatch();
    if (pendingBatchesRef.current.length >= LIVE_PENDING_LIMIT) pauseCaptureForPressure();
    return true;
  };

  function pauseCaptureForPressure() {
    if (pressurePausedRef.current) return;
    pressurePausedRef.current = true;
    microphoneMutedRef.current = true;
    setMicrophoneMuted(true);
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    // Do not abort accepted transcription requests: they still need draining.
    fallbackStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = false; });
    setAvatarStatus("Microfone pausado por acúmulo · os sinais continuam");
    showToast("A sinalização acumulou trechos. O microfone foi pausado; a fila continua. Aguarde e toque em Ativar microfone.");
  }

  const flushWordBuffer = (force = false) => {
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    batchTimerRef.current = null;
    while (wordBufferRef.current.length >= LIVE_BATCH_MAX_WORDS) {
      if (!enqueueBatch(wordBufferRef.current.slice(0, LIVE_BATCH_MAX_WORDS).join(" "))) return;
      wordBufferRef.current.splice(0, LIVE_BATCH_MAX_WORDS);
    }
    if (wordBufferRef.current.length >= LIVE_BATCH_MIN_WORDS || (force && wordBufferRef.current.length > 0)) {
      if (enqueueBatch(wordBufferRef.current.join(" "))) wordBufferRef.current.splice(0);
    }
  };

  const addTranscriptToBuffer = (text: string) => {
    if (!listeningRef.current || (microphoneMutedRef.current && !pressurePausedRef.current)) return;
    const words = text.split(/\s+/).filter(Boolean);
    const remaining = LIVE_BUFFER_LIMIT - wordBufferRef.current.length;
    wordBufferRef.current.push(...words.slice(0, remaining));
    if (words.length > remaining) {
      pauseCaptureForPressure();
      setBackendStatus("Limite de transcrição atingido · parte do trecho não foi admitida");
      if (Date.now() - transcriptionOverloadNoticeAtRef.current > 15000) {
        transcriptionOverloadNoticeAtRef.current = Date.now();
        showToast("A capacidade de processamento foi excedida. Parte do trecho não entrou na fila; aguarde a sinalização antes de retomar.");
      }
    }
    while (wordBufferRef.current.length >= LIVE_BATCH_MAX_WORDS) {
      if (!enqueueBatch(wordBufferRef.current.slice(0, LIVE_BATCH_MAX_WORDS).join(" "))) break;
      wordBufferRef.current.splice(0, LIVE_BATCH_MAX_WORDS);
    }
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    const queuedBatches = pendingBatchesRef.current.filter((batch) => batch.status !== "error").length + Number(Boolean(activeBatchRef.current));
    const delay = batchFlushDelayMs(text, wordBufferRef.current.length, queuedBatches);
    batchTimerRef.current = window.setTimeout(() => flushWordBuffer(true), delay);
  };

  const currentAvatarPhrase = () => {
    if (idleLoopActiveRef.current) {
      const recent = recentPhrasesRef.current;
      const index = idleLoopIndexRef.current === 0 ? recent.length - 1 : idleLoopIndexRef.current - 1;
      return recent[index]?.glossText || recent[index]?.text || "";
    }
    return activeBatchRef.current?.glossText || activeBatchRef.current?.text || "";
  };

  const isCurrentAvatarPhrase = (phrase?: string) => {
    return listeningRef.current && matchesActivePhrase(phrase, currentAvatarPhrase());
  };

  useEffect(() => {
    const statusLabels: Record<string, string> = {
      loading_avatar: "Carregando avatar 3D",
      ready: `${avatarNames[avatar]} conectada`,
      queued: "Tradução recebida",
      processing: "Preparando tradução",
      loading_pose: "Preparando avatar",
      playing: `${avatarNames[avatar]} sinalizando`,
    };

    const onMessage = (event: MessageEvent) => {
      const fromEmbeddedFrame = event.source === frameRef.current?.contentWindow;
      const fromExternalFrame = event.source === externalFrameRef.current?.contentWindow;
      if (event.origin !== widgetOrigin || (!fromEmbeddedFrame && !fromExternalFrame)) return;
      const data = event.data as AvatarMessage;
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      if (["neotalk:pose-stage", "neotalk:pose-ready", "neotalk:playing", "neotalk:error"].includes(data.type || "")) {
        recordPoseDiagnostic(fromExternalFrame ? "mini-player" : "principal", data);
      }
      if (data.type === "neotalk:playback-frame") {
        recordNativeFrameDiagnostic(fromExternalFrame ? "mini-player" : "principal", data);
        handleNativePlaybackFrame(data, fromExternalFrame);
        return;
      }
      if (data.type === "neotalk:pose-stage") return;

      if (fromExternalFrame) {
        if (data.type === "neotalk:ready") {
          externalAvatarReadyRef.current = true;
          externalSupportsSharedPoseRef.current = Array.isArray(data.capabilities) && data.capabilities.includes("shared-pose");
          externalSupportsNativePlaybackRef.current = process.env.NEXT_PUBLIC_NATIVE_PLAYBACK_COMPLETION !== "false" && Array.isArray(data.capabilities) && data.capabilities.includes("native-playback-progress");
          if (latestPoseRef.current && externalSupportsSharedPoseRef.current) sendSharedPoseToExternal(latestPoseRef.current);
          else if (!externalSupportsSharedPoseRef.current) {
            const phrase = activeBatchRef.current?.glossText || activeBatchRef.current?.text || latestPoseRef.current?.phrase;
            if (phrase) externalWindowRef.current?.postMessage({ type: "neotalk:external-player-command", message: { type: "neotalk:sign", phrase } }, window.location.origin);
          }
        } else if (data.type === "neotalk:playing" && data.loadId) {
          const current = externalCurrentPoseRef.current;
          const correlation = data.correlationId || data.loadId;
          if (current && correlation === current.loadId && !nativePlaybackRef.current.externalId) {
            nativePlaybackRef.current.externalId = data.loadId;
          }
        } else if (data.type === "neotalk:status" && data.status === "loading_avatar") {
          externalAvatarReadyRef.current = false;
          externalSupportsNativePlaybackRef.current = false;
        } else if (data.type === "neotalk:error" && ["pose_ack_timeout", "pose_load_failed"].includes(data.code || "")) {
          const current = externalCurrentPoseRef.current;
          const recovery = externalPoseRecoveryRef.current;
          const stillCurrent = current && (latestPoseRef.current?.loadId === current.loadId || (!activeBatchRef.current && recentPosesRef.current.get(poseKey(current.phrase))?.loadId === current.loadId));
          if (stillCurrent && (!data.correlationId || data.correlationId === current.loadId) && recovery.attempts < 1) {
            recovery.attempts += 1;
            window.setTimeout(() => {
              if (listeningRef.current && externalCurrentPoseRef.current?.loadId === current.loadId) sendSharedPoseToExternal(current);
            }, 600);
          }
        }
        return;
      }

      if (data.type === "neotalk:prefetch-ready" && data.phrase && data.pose?.content_url) {
        const key = poseKey(data.phrase);
        prefetchingPhrasesRef.current.delete(key);
        const startedAt = prefetchStartedAtRef.current.get(key);
        prefetchStartedAtRef.current.delete(key);
        const pending = pendingBatchesRef.current.find((batch) => batch.status === "ready" && poseKey(batch.glossText || "") === key);
        recordPoseDiagnostic("principal", { ...data, elapsedMs: startedAt ? Date.now() - startedAt : undefined }, pending?.id ?? null);
        if (data.avatar === avatar && pending) {
          prefetchedPosesRef.current.set(key, {
            phrase: data.phrase, pose: data.pose,
            words: Array.isArray(data.words) ? data.words.map(String) : [],
            loadId: data.loadId, traceId: data.traceId, taskId: data.taskId,
          });
        }
        return;
      }
      if (data.type === "neotalk:prefetch-error") {
        if (data.phrase) {
          const key = poseKey(data.phrase);
          prefetchingPhrasesRef.current.delete(key);
          const startedAt = prefetchStartedAtRef.current.get(key);
          prefetchStartedAtRef.current.delete(key);
          recordPoseDiagnostic("principal", { ...data, elapsedMs: startedAt ? Date.now() - startedAt : undefined });
        }
        return;
      }

      if (data.type === "neotalk:pose-ready" && data.phrase && data.pose?.content_url) {
        if (!isCurrentAvatarPhrase(data.phrase)) return;
        const shared: SharedPose = { phrase: data.phrase, pose: data.pose, words: Array.isArray(data.words) ? data.words.map(String) : [], loadId: data.loadId, traceId: data.traceId, taskId: data.taskId };
        latestPoseRef.current = shared;
        if (shared.loadId) expectedPoseCorrelationRef.current = shared.loadId;
        rememberPose(shared);
        sendSharedPoseToExternal(shared);
        return;
      }

      if (data.type === "neotalk:ready") {
        embeddedAvatarReadyRef.current = true;
        avatarReadyRef.current = true;
        avatarSupportsSharedPoseRef.current = Array.isArray(data.capabilities) && data.capabilities.includes("shared-pose");
        avatarSupportsPrefetchRef.current = Array.isArray(data.capabilities) && data.capabilities.includes("prefetch");
        avatarSupportsNativePlaybackRef.current = process.env.NEXT_PUBLIC_NATIVE_PLAYBACK_COMPLETION !== "false" && Array.isArray(data.capabilities) && data.capabilities.includes("native-playback-progress");
        setAvatarReady(true);
        setAvatarError("");
        setAvatarStatus(`${avatarNames[avatar]} conectada`);
        window.setTimeout(() => {
          const active = activeBatchRef.current;
          if (active && avatarBusyRef.current && !avatarPlaybackStartedRef.current && !avatarCommandAcknowledgedRef.current) {
            avatarCommandAcknowledgedRef.current = false;
            if (sendToAvatar(poseCommandFor(active.glossText || active.text))) scheduleAvatarRetry();
            else releaseAvatarAfterRetryFailure();
          } else {
            dispatchNextBatch();
            scheduleIdleLoop();
          }
        }, 100);
      } else if (data.type === "neotalk:status" && data.status) {
        if (data.status === "loading_avatar") {
          embeddedAvatarReadyRef.current = false;
          avatarReadyRef.current = false;
          avatarSupportsNativePlaybackRef.current = false;
          nativePlaybackRef.current = emptyNativePlayback();
          setAvatarReady(false);
        }
        if (["queued", "processing", "loading_pose", "playing"].includes(data.status) && !isCurrentAvatarPhrase(data.phrase)) return;
        if (avatarBusyRef.current && ["queued", "processing", "loading_pose"].includes(data.status)) {
          avatarCommandAcknowledgedRef.current = true;
          clearAvatarRetryTimer();
          avatarRetryCountRef.current = 0;
          scheduleAvatarProcessingWatchdog(data.status);
        }
        setAvatarStatus(statusLabels[data.status] || data.status);
      } else if (data.type === "neotalk:playing") {
        if (!avatarBusyRef.current || !isCurrentAvatarPhrase(data.phrase)) return;
        const reportedCorrelation = data.correlationId || data.loadId;
        if (reportedCorrelation && expectedPoseCorrelationRef.current && reportedCorrelation !== expectedPoseCorrelationRef.current) return;
        if (avatarSupportsNativePlaybackRef.current && nativePlaybackRef.current.primaryId === data.loadId && data.loadId) return;
        if (avatarPlaybackStartedRef.current) return; // Duplicate ACK must not restart the completion clock.
        if (!idleLoopActiveRef.current && batchDispatchedAtRef.current) {
          recordPoseDiagnostic("principal", { type: avatarSupportsNativePlaybackRef.current ? "neotalk:playback-ack" : "neotalk:playback-start-estimated", elapsedMs: Date.now() - batchDispatchedAtRef.current });
        }
        clearAvatarRetryTimer();
        clearAvatarProcessingTimer();
        avatarRetryCountRef.current = 0;
        if (!avatarSupportsNativePlaybackRef.current) avatarRecoveryCountRef.current = 0;
        avatarCommandAcknowledgedRef.current = true;
        avatarPlaybackStartedRef.current = !avatarSupportsNativePlaybackRef.current;
        prefetchNextBatch();
        setAvatarStatus(idleLoopActiveRef.current ? `${avatarNames[avatar]} mantendo a tradução ativa` : `${avatarNames[avatar]} sinalizando o lote atual`);
        if (avatarSupportsNativePlaybackRef.current && data.loadId) {
          nativePlaybackRef.current.primaryId = data.loadId;
          scheduleNativePlaybackWatchdog();
          return;
        }
        const wordCount = Array.isArray(data.words) ? data.words.length : 4;
        if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = window.setTimeout(
          () => idleLoopActiveRef.current ? finishIdleLoopPhrase() : completeActiveBatch(),
          playbackDurationMs(latestPoseRef.current?.pose, wordCount),
        );
      } else if (data.type === "neotalk:error") {
        if (!isCurrentAvatarPhrase(data.phrase)) return;
        const reportedCorrelation = data.correlationId || data.loadId;
        if (reportedCorrelation && expectedPoseCorrelationRef.current && reportedCorrelation !== expectedPoseCorrelationRef.current) return;
        if (avatarPlaybackStartedRef.current || nativePlaybackRef.current.primaryId) {
          // A pose já está animando; erro tardio não deve interromper a fila.
          if (diagnostics) console.warn("Aviso tardio do widget durante reprodução", { code: data.code, traceId: data.traceId });
          return;
        }
        if (data.code === "transient_api_error" && diagnostics) {
          console.warn("Falha transitória na pose", { stage: data.stage, traceId: data.traceId, message: data.message });
        }
        if (data.code === "pose_cache_miss") {
          const phrase = currentAvatarPhrase();
          if (phrase) {
            recentPosesRef.current.delete(poseKey(phrase));
            avatarCommandAcknowledgedRef.current = false;
            if (sendToAvatar({ type: "neotalk:sign", phrase })) {
              scheduleAvatarRetry();
              return;
            }
          }
        }
        if (["transient_api_error", "pose_ack_timeout", "pose_load_failed", "pose_cache_miss"].includes(data.code || "") || isRetryableAvatarError(data.message)) {
          setAvatarError("");
          setAvatarStatus("Reconectando a tradução");
          avatarCommandAcknowledgedRef.current = false;
          clearAvatarRetryTimer();
          clearAvatarProcessingTimer();
          if (!avatarPlaybackStartedRef.current) {
            avatarRetryTimerRef.current = window.setTimeout(recoverAcceptedAvatarPhrase, LIVE_AVATAR_RETRY_DELAY_MS);
          }
          return;
        }
        if (isNonBlockingAvatarError(data.message)) {
          setAvatarError("");
          setAvatarStatus(idleLoopActiveRef.current ? `${avatarNames[avatar]} mantendo a tradução ativa` : `${avatarNames[avatar]} sinalizando o lote atual`);
          return;
        }
        if (diagnostics) console.warn("Falha no lote do avatar", { code: data.code, message: data.message, traceId: data.traceId });
        setAvatarError("");
        releaseAvatarAfterRetryFailure();
      }
    };

    avatarMessageHandlerRef.current = onMessage;
    window.addEventListener("message", onMessage);
    externalWindowRef.current?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      externalWindowRef.current?.removeEventListener("message", onMessage);
      if (avatarMessageHandlerRef.current === onMessage) avatarMessageHandlerRef.current = null;
    };
  }, [avatar, diagnostics, showToast, widgetOrigin]);

  const clearFallbackChunkTimer = () => {
    if (fallbackChunkTimerRef.current) window.clearTimeout(fallbackChunkTimerRef.current);
    fallbackChunkTimerRef.current = null;
  };

  const pumpFallbackTranscriptions = () => {
    while (
      fallbackTranscriptionInFlightRef.current < LIVE_TRANSCRIPTION_CONCURRENCY
      && fallbackTranscriptionQueueRef.current.length
    ) {
      const queued = fallbackTranscriptionQueueRef.current.shift();
      if (!queued) return;
      const { blob, generation, sequence } = queued;
      const ordered = orderedTranscriptsRef.current;
      const signal = captureControllerRef.current.signal;
      const deliver = (text: string) => {
        if (!listeningRef.current || (microphoneMutedRef.current && !pressurePausedRef.current) || signal.aborted || generation !== fallbackCaptureGenerationRef.current) return;
        for (const transcript of ordered.complete(sequence, text)) {
          interruptIdleLoopForSpeech();
          setLastCaption(transcript);
          setInterimCaption("");
          addTranscriptToBuffer(transcript);
        }
      };
      fallbackTranscriptionInFlightRef.current += 1;
      void retryLiveRequest(() => apiRequest<{ text: string }>("/agent/transcribe", {
        method: "POST",
        signal,
        headers: { "Content-Type": blob.type.split(";", 1)[0] },
        body: blob,
      }), signal).then(({ text }) => {
        deliver(text || "");
      }).catch(() => {
        // A failed slot must release later successful slots, never block them.
        deliver("");
        if (!signal.aborted && diagnostics) setBackendStatus("Trecho de áudio não transcrito");
      }).finally(() => {
        fallbackTranscriptionInFlightRef.current = Math.max(0, fallbackTranscriptionInFlightRef.current - 1);
        pumpFallbackTranscriptions();
      });
    }
  };

  const queueFallbackTranscription = (blob: Blob, generation: number) => {
    if (fallbackTranscriptionQueueRef.current.length >= LIVE_TRANSCRIPTION_BACKLOG) {
      // Do not silently drop a queued spoken passage. Discard only this new
      // chunk and signal overload to the presenter (not inside the broadcast).
      setBackendStatus("Rede lenta · um trecho de áudio não pôde entrar na fila");
      if (Date.now() - transcriptionOverloadNoticeAtRef.current > 15000) {
        transcriptionOverloadNoticeAtRef.current = Date.now();
        showToast("A conexão está atrasando o áudio. Um trecho não pôde ser processado.");
      }
      return;
    }
    fallbackTranscriptionQueueRef.current.push({ blob, generation, sequence: orderedTranscriptsRef.current.issue() });
    pumpFallbackTranscriptions();
    if (listeningRef.current && fallbackTranscriptionQueueRef.current.length >= LIVE_TRANSCRIPTION_BACKLOG) pauseCaptureForPressure();
  };

  const startFallbackChunk = () => {
    const stream = fallbackStreamRef.current;
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track || track.readyState !== "live" || !listeningRef.current || microphoneMutedRef.current || fallbackRecorderRef.current?.state === "recording") return;
    const generation = fallbackCaptureGenerationRef.current;
    try {
    const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: BlobPart[] = [];
    fallbackRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (generation !== fallbackCaptureGenerationRef.current) return;
      clearFallbackChunkTimer();
      if (fallbackRecorderRef.current === recorder) fallbackRecorderRef.current = null;
      if (generation !== fallbackCaptureGenerationRef.current) return;
      const shouldProcess = listeningRef.current && !microphoneMutedRef.current && track.readyState === "live";
      if (shouldProcess) window.setTimeout(startFallbackChunk, 30);
      if (!shouldProcess || !chunks.length) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      queueFallbackTranscription(blob, generation);
    };
    recorder.onerror = () => {
      if (generation !== fallbackCaptureGenerationRef.current || !listeningRef.current || microphoneMutedRef.current) return;
      recoverFallbackCaptureRef.current();
    };
    recorder.start();
    fallbackChunkTimerRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, LIVE_FALLBACK_CHUNK_MS);
    } catch {
      stopLiveRoom();
      showToast("O navegador não conseguiu iniciar a captura de áudio. Revise o microfone ou tente outro navegador.");
    }
  };

  const stopFallbackCapture = (releaseStream = true) => {
    fallbackCaptureGenerationRef.current += 1;
    captureControllerRef.current.abort();
    captureControllerRef.current = new AbortController();
    orderedTranscriptsRef.current = new OrderedTranscriptBuffer();
    fallbackTranscriptionQueueRef.current = [];
    clearFallbackChunkTimer();
    try { if (fallbackRecorderRef.current?.state === "recording") fallbackRecorderRef.current.stop(); } catch { /* já encerrado */ }
    fallbackRecorderRef.current = null;
    if (releaseStream) {
      fallbackStreamRef.current?.getTracks().forEach((track) => track.stop());
      fallbackStreamRef.current = null;
    }
  };

  const bindFallbackStream = (stream: MediaStream) => {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("Nenhuma faixa de áudio disponível.");
    track.onended = () => {
      if (listeningRef.current && !microphoneMutedRef.current) recoverFallbackCaptureRef.current();
    };
    if (track.label) setMicrophoneName(track.label);
    fallbackStreamRef.current = stream;
  };

  const recoverFallbackCapture = async () => {
    if (fallbackRecoveryInFlightRef.current || !listeningRef.current || microphoneMutedRef.current || !navigator.onLine) return;
    fallbackRecoveryInFlightRef.current = true;
    const signal = sessionScopeRef.current.signal;
    try {
      stopFallbackCapture();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!sessionScopeRef.current.isCurrent(signal) || !listeningRef.current || microphoneMutedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      bindFallbackStream(stream);
      setTranscriptionEngine("server");
      setAvatarStatus("Microfone reconectado");
      startFallbackChunk();
    } catch {
      if (!sessionScopeRef.current.isCurrent(signal)) return;
      if (diagnostics) setBackendStatus("Reconectando microfone");
      window.setTimeout(() => recoverFallbackCaptureRef.current(), 2000);
    } finally {
      fallbackRecoveryInFlightRef.current = false;
    }
  };
  recoverFallbackCaptureRef.current = () => { void recoverFallbackCapture(); };

  const selectAvatar = (value: AvatarId) => {
    if (offline && value !== "elia") { showToast("O pacote offline instalado contém somente a Elia."); return; }
    latestPoseRef.current = null;
    recentPosesRef.current.clear();
    prefetchedPosesRef.current.clear();
    prefetchingPhrasesRef.current.clear();
    prefetchStartedAtRef.current.clear();
    expectedPoseCorrelationRef.current = null;
    setAvatar(value);
    if (sendToAvatar({ type: "neotalk:set-avatar", avatar: value })) setAvatarStatus("Trocando avatar");
  };

  function clearHeartbeat() {
    if (heartbeatTimerRef.current) window.clearTimeout(heartbeatTimerRef.current);
    heartbeatTimerRef.current = null;
  }

  function scheduleHeartbeat(delay = LIVE_HEARTBEAT_INTERVAL_MS) {
    clearHeartbeat();
    if (!roomIdRef.current) return;
    heartbeatTimerRef.current = window.setTimeout(() => { void runHeartbeat(); }, delay);
  }

  async function runHeartbeat() {
    const roomId = roomIdRef.current;
    const signal = sessionScopeRef.current.signal;
    if (!roomId || heartbeatInFlightRef.current) return;
    heartbeatInFlightRef.current = true;
    try {
      await roomApi<void>(`/rooms/${roomId}/heartbeat`, {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      if (!sessionScopeRef.current.isCurrent(signal) || roomIdRef.current !== roomId) return;
      heartbeatFailuresRef.current = 0;
      if (diagnostics) setBackendStatus("Sala conectada ao histórico");
    } catch (reason) {
      if (!sessionScopeRef.current.isCurrent(signal) || roomIdRef.current !== roomId) return;
      // A 404 may mean the room was finished/deleted elsewhere. Never revive
      // it automatically from a background heartbeat.
      if (reason instanceof ApiError && reason.status === 404) {
        stopLiveRoom();
        showToast("Esta sala foi encerrada. Inicie uma nova sala para continuar.");
        return;
      }
      heartbeatFailuresRef.current += 1;
      if (diagnostics && heartbeatFailuresRef.current) setBackendStatus("Reconectando histórico da sala");
    } finally {
      heartbeatInFlightRef.current = false;
      if (sessionScopeRef.current.isCurrent(signal)) scheduleHeartbeat(heartbeatFailuresRef.current ? LIVE_HEARTBEAT_RETRY_MS : LIVE_HEARTBEAT_INTERVAL_MS);
    }
  }

  const stopLiveRoom = () => {
    listeningRef.current = false;
    sessionScopeRef.current.end();
    microphoneMutedRef.current = false;
    pressurePausedRef.current = false;
    setMicrophoneMuted(false);
    clearIdleLoopTimer();
    clearAvatarRetryTimer();
    clearAvatarProcessingTimer();
    idleLoopActiveRef.current = false;
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
    recognitionWatchdogRef.current = null;
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      try { recognitionRef.current.abort(); } catch { /* already stopped */ }
    }
    recognitionRef.current = null;
    stopFallbackCapture();
    clearHeartbeat();
    heartbeatFailuresRef.current = 0;
    sendToAvatar({ type: "neotalk:pause" });
    setInterimCaption("");
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    batchTimerRef.current = null;
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
    pendingBatchesRef.current = [];
    activeBatchRef.current = null;
    avatarBusyRef.current = false;
    avatarPlaybackStartedRef.current = false;
    avatarCommandAcknowledgedRef.current = false;
    agentPromisesRef.current.clear();
    agentResultsRef.current.clear();
    remoteBatchIdsRef.current.clear();
    desiredBatchStatusRef.current.clear();
    latestPoseRef.current = null;
    setBatches([]);
    recentPhrasesRef.current = [];
    externalCurrentPoseRef.current = null;
    externalPoseRecoveryRef.current = { correlationId: "", attempts: 0 };
    wordBufferRef.current.splice(0);
    setRecording(false);
    const roomId = roomIdRef.current;
    const startedAt = roomStartedAtRef.current;
    roomIdRef.current = null;
    roomStartedAtRef.current = null;
    if (roomId) {
      const durationSeconds = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
      void roomApi<RoomResponse>(`/rooms/${roomId}/finish`, {
        method: "POST",
        body: JSON.stringify({ duration_seconds: durationSeconds }),
      }).then(() => { if (!roomIdRef.current) setBackendStatus("Sala salva no histórico"); })
        .catch(() => { if (!roomIdRef.current) setBackendStatus("Falha ao encerrar sala"); });
    }
  };

  const startLiveRoom = async () => {
    if (startingRef.current || listeningRef.current) return;
    startingRef.current = true;
    setStarting(true);
    const signal = sessionScopeRef.current.begin();
    const browserWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    // Browser speech services can send audio to the cloud. Offline builds must
    // exclusively use their bundled transcription adapter.
    const SpeechRecognitionApi = offline ? undefined : browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
    let createdRoomId: string | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!sessionScopeRef.current.isCurrent(signal)) {
        stream.getTracks().forEach((item) => item.stop());
        return;
      }
      const track = stream.getAudioTracks()[0];
      if (!track) {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error("Nenhuma faixa de áudio disponível.");
      }
      if (!SpeechRecognitionApi && typeof MediaRecorder === "undefined") {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error("Este navegador não oferece captura de áudio compatível.");
      }
      if (track?.label) setMicrophoneName(track.label);
      if (SpeechRecognitionApi) stream.getTracks().forEach((item) => item.stop());
      else bindFallbackStream(stream);

      setBackendStatus("Criando sala");
      let room: RoomResponse;
      try {
        room = await roomApi<RoomResponse>("/rooms", {
          method: "POST",
          signal,
          body: JSON.stringify({ name: roomName.trim() || "Sala ao vivo", avatar }),
        });
        createdRoomId = room.id;
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 409) throw reason;
        const rooms = await roomApi<RoomResponse[]>("/rooms", { signal });
        const activeRoom = rooms.find((item) => item.status === "ready" || item.status === "live");
        if (!activeRoom) throw reason;
        room = activeRoom;
        setBackendStatus("Retomando sua sala ativa");
      }
      await roomApi<RoomResponse>(`/rooms/${room.id}/start`, { method: "POST", signal });
      if (!sessionScopeRef.current.isCurrent(signal)) return;
      roomIdRef.current = room.id;
      pressurePausedRef.current = false;
      roomStartedAtRef.current = Date.now();
      remoteBatchIdsRef.current.clear();
      desiredBatchStatusRef.current.clear();
      agentResultsRef.current.clear();
      recentPhrasesRef.current = [];
      recentPosesRef.current.clear();
      prefetchedPosesRef.current.clear();
      prefetchingPhrasesRef.current.clear();
      prefetchStartedAtRef.current.clear();
      latestPoseRef.current = null;
      expectedPoseCorrelationRef.current = null;
      poseDiagnosticsRef.current = [];
      idleLoopIndexRef.current = 0;
      idleLoopActiveRef.current = false;
      lastSpeechAtRef.current = Date.now();
      setBackendStatus("Sala conectada ao histórico");
      setProcessedBatches(0);
      setCompletedHistory([]);
      setLastCaption("");
      setInterimCaption("");

      heartbeatFailuresRef.current = 0;
      scheduleHeartbeat();

      if (!SpeechRecognitionApi) {
        listeningRef.current = true;
        microphoneMutedRef.current = false;
        setMicrophoneMuted(false);
        setTranscriptionEngine("server");
        setRecording(true);
        startFallbackChunk();
        showToast("Sala iniciada com transcrição compatível com este navegador");
        return;
      }

      const recognition = new SpeechRecognitionApi();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "pt-BR";
      const activateServerFallback = async () => {
        if (!sessionScopeRef.current.isCurrent(signal) || !listeningRef.current || microphoneMutedRef.current || fallbackRecoveryInFlightRef.current) return;
        fallbackRecoveryInFlightRef.current = true;
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
        recognitionWatchdogRef.current = null;
        recognition.onerror = null;
        recognition.onend = null;
        try { recognition.abort(); } catch { /* reconhecimento já encerrado */ }
        recognitionRef.current = null;
        try {
          const compatibleStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!sessionScopeRef.current.isCurrent(signal) || !listeningRef.current || microphoneMutedRef.current) {
            compatibleStream.getTracks().forEach((item) => item.stop());
            return;
          }
          stopFallbackCapture();
          bindFallbackStream(compatibleStream);
          listeningRef.current = true;
          microphoneMutedRef.current = false;
          setMicrophoneMuted(false);
          setTranscriptionEngine("server");
          setRecording(true);
          setAvatarStatus("Microfone conectado em modo compatível");
          startFallbackChunk();
          showToast("Ativamos o modo compatível de transcrição para este navegador");
        } catch {
          if (sessionScopeRef.current.isCurrent(signal)) {
            stopLiveRoom();
            showToast("Não foi possível acessar o microfone. Revise a permissão do navegador.");
          }
        } finally {
          fallbackRecoveryInFlightRef.current = false;
        }
      };
      const restartRecognition = (delay = 350) => {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          if (!sessionScopeRef.current.isCurrent(signal) || !listeningRef.current || microphoneMutedRef.current) return;
          try {
            recognition.start();
            recognitionActivityAtRef.current = Date.now();
          } catch {
            restartRecognition(900);
          }
        }, delay);
      };
      recognition.onresult = (event) => {
        if (!sessionScopeRef.current.isCurrent(signal) || !listeningRef.current || microphoneMutedRef.current) return;
        recognitionActivityAtRef.current = Date.now();
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript?.trim() || "";
          if (!transcript) continue;
          interruptIdleLoopForSpeech();
          if (result.isFinal) {
            setLastCaption(transcript);
            addTranscriptToBuffer(transcript);
          } else {
            interim += `${transcript} `;
          }
        }
        setInterimCaption(interim.trim());
      };
      recognition.onerror = (event) => {
        if (event.error === "service-not-allowed" || event.error === "network") {
          void activateServerFallback();
        } else if (event.error === "not-allowed") {
          stopLiveRoom();
          if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
          if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
          recognitionWatchdogRef.current = null;
          setRecording(false);
          showToast("Permita o acesso ao microfone para iniciar a sala");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          void activateServerFallback();
        }
      };
      recognition.onend = () => {
        if (!listeningRef.current || microphoneMutedRef.current) return;
        setAvatarStatus(idleLoopActiveRef.current ? "Loop ativo · renovando escuta" : "Renovando escuta do microfone");
        restartRecognition();
      };

      recognitionRef.current = recognition;
      restartRecognitionRef.current = restartRecognition;
      listeningRef.current = true;
      microphoneMutedRef.current = false;
      pressurePausedRef.current = false;
      setMicrophoneMuted(false);
      setRecording(true);
      setTranscriptionEngine("browser");
      recognitionActivityAtRef.current = Date.now();
      if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
      recognitionWatchdogRef.current = window.setInterval(() => {
        if (document.visibilityState === "hidden" || !navigator.onLine || !listeningRef.current || microphoneMutedRef.current || Date.now() - recognitionActivityAtRef.current < 30000) return;
        recognitionActivityAtRef.current = Date.now();
        try {
          recognition.abort();
          restartRecognition(900);
        } catch {
          restartRecognition(0);
        }
      }, 5000);
      restartRecognition(0);
      showToast("Sala ao vivo iniciada — pode falar");
    } catch {
      if (!sessionScopeRef.current.isCurrent(signal)) return;
      listeningRef.current = false;
      setRecording(false);
      stopFallbackCapture();
      if (createdRoomId) {
        roomIdRef.current = null;
        roomStartedAtRef.current = null;
        void roomApi<RoomResponse>(`/rooms/${createdRoomId}/finish`, {
          method: "POST",
          body: JSON.stringify({ duration_seconds: 0 }),
        }).catch(() => undefined);
      }
      showToast("Não foi possível iniciar a sala ou acessar o microfone");
    } finally {
      if (!sessionScopeRef.current.isCurrent(signal) && createdRoomId) {
        void roomApi(`/rooms/${createdRoomId}/finish`, { method: "POST", body: JSON.stringify({ duration_seconds: 0 }) }).catch(() => undefined);
      }
      startingRef.current = false;
      setStarting(false);
    }
  };

  const toggleRecording = () => {
    if (!recording && !captureAvailable) { showToast("Prepare a voz local antes de iniciar a sala."); return; }
    if (recording) stopLiveRoom();
    else void startLiveRoom();
  };

  const toggleMicrophone = () => {
    if (!recording) return;
    if (pressurePausedRef.current && (pendingBatchesRef.current.length > LIVE_RESUME_LIMIT || fallbackTranscriptionQueueRef.current.length > 2 || wordBufferRef.current.length > LIVE_BATCH_MAX_WORDS)) {
      showToast("A sinalização ainda está acumulada. Aguarde a fila diminuir para reativar o microfone.");
      return;
    }
    const nextMuted = !microphoneMutedRef.current;
    microphoneMutedRef.current = nextMuted;
    setMicrophoneMuted(nextMuted);
    if (nextMuted) {
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      setInterimCaption("");
      flushWordBuffer(true);
      try { recognitionRef.current?.abort(); } catch { /* reconhecimento já encerrado */ }
      if (transcriptionEngine === "server") stopFallbackCapture(false);
      setAvatarStatus(idleLoopActiveRef.current ? "Microfone mutado · loop ativo" : `${avatarNames[avatar]} aguardando em loop`);
      scheduleIdleLoop(0);
    } else {
      pressurePausedRef.current = false;
      fallbackStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = true; });
      recognitionActivityAtRef.current = Date.now();
      if (transcriptionEngine === "server") startFallbackChunk();
      else restartRecognitionRef.current(0);
      setAvatarStatus("Microfone reativado");
    }
  };

  useEffect(() => {
    const restoreLongRunningSession = () => {
      if (offline && document.visibilityState === "hidden" && listeningRef.current && !microphoneMutedRef.current) {
        microphoneMutedRef.current = true;
        setMicrophoneMuted(true);
        setInterimCaption("");
        stopFallbackCapture(false);
        setAvatarStatus("Microfone pausado ao sair do app · toque em Ativar microfone para retomar");
        return;
      }
      if (document.visibilityState === "hidden" || (!offline && !navigator.onLine) || !listeningRef.current) return;
      if (roomIdRef.current && !heartbeatInFlightRef.current) void runHeartbeat();
      if (microphoneMutedRef.current) return;
      const stream = fallbackStreamRef.current;
      if (stream) {
        const track = stream.getAudioTracks()[0];
        if (!track || track.readyState !== "live") recoverFallbackCaptureRef.current();
        else if (!fallbackRecorderRef.current || fallbackRecorderRef.current.state === "inactive") startFallbackChunk();
      } else if (recognitionRef.current && Date.now() - recognitionActivityAtRef.current >= 30000) {
        try { recognitionRef.current.abort(); } catch { restartRecognitionRef.current(0); }
      }
      if (avatarReadyRef.current) window.setTimeout(dispatchNextBatch, 100);
    };

    window.addEventListener("online", restoreLongRunningSession);
    document.addEventListener("visibilitychange", restoreLongRunningSession);
    sessionHealthTimerRef.current = window.setInterval(restoreLongRunningSession, 10000);
    return () => {
      window.removeEventListener("online", restoreLongRunningSession);
      document.removeEventListener("visibilitychange", restoreLongRunningSession);
      if (sessionHealthTimerRef.current) window.clearInterval(sessionHealthTimerRef.current);
      sessionHealthTimerRef.current = null;
    };
  }, []);

  const adjustStageZoom = (delta: number) => {
    setStageZoom((value) => Math.min(1.5, Math.max(0.7, Math.round((value + delta) * 10) / 10)));
  };

  useEffect(() => {
    const caption = externalCaptionRef.current;
    if (!caption) return;
    caption.textContent = recording
      ? (microphoneMuted ? (lastCaption || "Microfone mutado · mantendo a tradução em loop") : (interimCaption || lastCaption || "Ouvindo…"))
      : "Inicie a sala para capturar o microfone e gerar legendas.";
  }, [interimCaption, lastCaption, microphoneMuted, recording]);

  useEffect(() => () => {
    listeningRef.current = false;
    sessionScopeRef.current.end();
    recognitionRef.current?.abort();
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
    if (sessionHealthTimerRef.current) window.clearInterval(sessionHealthTimerRef.current);
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
    if (idleLoopTimerRef.current) window.clearTimeout(idleLoopTimerRef.current);
    if (avatarRetryTimerRef.current) window.clearTimeout(avatarRetryTimerRef.current);
    if (avatarProcessingTimerRef.current) window.clearTimeout(avatarProcessingTimerRef.current);
    if (heartbeatTimerRef.current) window.clearTimeout(heartbeatTimerRef.current);
    const outputWindow = externalWindowRef.current;
    externalWindowRef.current = null;
    externalFrameRef.current = null;
    externalCaptionRef.current = null;
    externalCurrentPoseRef.current = null;
    externalPoseRecoveryRef.current = { correlationId: "", attempts: 0 };
    if (outputWindow && !outputWindow.closed) outputWindow.close();
    stopFallbackCapture();
    const roomId = roomIdRef.current;
    const startedAt = roomStartedAtRef.current;
    if (roomId) {
      void roomApi(`/rooms/${roomId}/finish`, {
        method: "POST",
        keepalive: true,
        body: JSON.stringify({ duration_seconds: startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0 }),
      }).catch(() => undefined);
    }
  }, []);

  const restoreStage = (sourceWindow?: Window) => {
    if (sourceWindow && externalWindowRef.current !== sourceWindow) return;
    const messageHandler = avatarMessageHandlerRef.current;
    if (sourceWindow && messageHandler) sourceWindow.removeEventListener("message", messageHandler);
    externalWindowRef.current = null;
    externalFrameRef.current = null;
    externalCaptionRef.current = null;
    externalCurrentPoseRef.current = null;
    externalPoseRecoveryRef.current = { correlationId: "", attempts: 0 };
    externalAvatarReadyRef.current = false;
    externalSupportsSharedPoseRef.current = false;
    externalSupportsNativePlaybackRef.current = false;
    finishNativePlayback();
    setExternalPlayerMode(null);
  };

  const mountStageInWindow = async (targetWindow: Window, mode: "pip" | "window") => {
    const targetDocument = targetWindow.document;
    const messageHandler = avatarMessageHandlerRef.current;
    if (messageHandler) targetWindow.addEventListener("message", messageHandler);
    targetDocument.title = "NeoTalk · Tradução em Libras";
    targetDocument.documentElement.lang = "pt-BR";
    targetDocument.head.replaceChildren();
    document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style').forEach((node) => {
      const clone = node.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
      if (node instanceof HTMLLinkElement && clone instanceof HTMLLinkElement) clone.href = node.href;
      targetDocument.head.appendChild(clone);
    });
    const outputStyles = targetDocument.createElement("style");
    outputStyles.textContent = `
      html, body, .neotalk-output-shell { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #10233f; }
      .neotalk-output-shell { display: grid; }
      .neotalk-output-shell .live-stage { width: 100%; height: 100% !important; min-height: 0; border-radius: 0; }
      .neotalk-output-shell .avatar-widget-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
      .neotalk-output-shell .exit-fullscreen { display: none !important; }
    `;
    targetDocument.head.appendChild(outputStyles);
    await new Promise<void>((resolve, reject) => {
      const relay = targetDocument.createElement("script");
      const timeout = window.setTimeout(() => reject(new Error("O mini-player demorou para conectar. Tente abrir em outra janela.")), 8000);
      relay.src = new URL("/external-player-relay.js?v=2", window.location.origin).href;
      relay.onload = () => { window.clearTimeout(timeout); resolve(); };
      relay.onerror = () => { window.clearTimeout(timeout); reject(new Error("Não foi possível conectar o mini-player.")); };
      targetDocument.head.appendChild(relay);
    });
    const shell = targetDocument.createElement("main");
    shell.className = "neotalk-output-shell";
    const outputStage = targetDocument.createElement("div");
    outputStage.className = "live-stage";
    const outputFrame = targetDocument.createElement("iframe");
    outputFrame.className = "avatar-widget-frame";
    outputFrame.title = "Avatar 3D NeoTalk";
    outputFrame.allow = "fullscreen";
    const brand = targetDocument.createElement("div");
    brand.className = "stage-brand";
    brand.append("neo");
    const brandStrong = targetDocument.createElement("strong");
    brandStrong.textContent = "talk";
    brand.appendChild(brandStrong);
    const caption = targetDocument.createElement("div");
    caption.className = "live-captions";
    caption.setAttribute("aria-live", "polite");
    caption.textContent = recording
      ? (microphoneMuted ? (lastCaption || "Microfone mutado · mantendo a tradução em loop") : (interimCaption || lastCaption || "Ouvindo…"))
      : "Inicie a sala para capturar o microfone e gerar legendas.";
    const language = targetDocument.createElement("span");
    language.className = "stage-language";
    language.textContent = "PT → LIBRAS";
    outputStage.append(outputFrame, brand, caption, language);
    shell.appendChild(outputStage);
    targetDocument.body.replaceChildren(shell);

    externalWindowRef.current = targetWindow;
    externalFrameRef.current = outputFrame;
    externalCaptionRef.current = caption;
    externalCurrentPoseRef.current = null;
    externalPoseRecoveryRef.current = { correlationId: "", attempts: 0 };
    externalAvatarReadyRef.current = false;
    externalSupportsSharedPoseRef.current = false;
    setExternalPlayerMode(mode);
    targetWindow.addEventListener("pagehide", () => restoreStage(targetWindow), { once: true });
    const outputUrl = new URL(widgetUrl);
    outputUrl.searchParams.set("avatar", avatar);
    outputFrame.src = outputUrl.toString();
    targetWindow.focus();
  };

  const closeExternalPlayer = () => {
    const outputWindow = externalWindowRef.current;
    restoreStage(outputWindow || undefined);
    if (outputWindow && !outputWindow.closed) outputWindow.close();
  };

  const openExternalPlayer = async (preference: "pip" | "window") => {
    const current = externalWindowRef.current;
    if (current && !current.closed) {
      current.focus();
      showToast("O mini-player já está aberto");
      return;
    }
    try {
      const pipApi = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi }).documentPictureInPicture;
      if (preference === "pip" && pipApi) {
        let pipWindow: Window | null = null;
        try {
          pipWindow = await pipApi.requestWindow({ width: 560, height: 420 });
          await mountStageInWindow(pipWindow, "pip");
          showToast("Mini-player aberto — redimensione pela borda da janela");
          return;
        } catch {
          if (pipWindow && !pipWindow.closed) pipWindow.close();
          // O navegador pode expor a API e bloquear o modo flutuante por política.
          // Nesse caso continuamos automaticamente com uma janela comum.
        }
      }
      const popup = window.open("", "neotalk-live-output", "popup=yes,width=720,height=540,resizable=yes,scrollbars=no");
      if (!popup) throw new Error("O navegador bloqueou a nova janela.");
      try {
        await mountStageInWindow(popup, "window");
      } catch (reason) {
        popup.close();
        throw reason;
      }
      showToast(preference === "pip" ? "Mini-player aberto em janela compatível" : "Saída aberta em outra janela");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Não foi possível abrir o mini-player");
    }
  };

  useEffect(() => {
    roomApi<{ status: string }>("/health")
      .then(() => setBackendStatus("Histórico conectado"))
      .catch(() => setBackendStatus("Backend indisponível"));
  }, []);

  const copyPlayerLink = async () => {
    try {
      const selectedUrl = new URL(widgetUrl);
      selectedUrl.searchParams.set("avatar", avatar);
      await navigator.clipboard.writeText(selectedUrl.toString());
      showToast("Link direto do avatar copiado — esta saída não inclui as legendas");
    } catch {
      showToast("Não foi possível copiar o link");
    }
  };

  const copyPoseDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ capturedAt: new Date().toISOString(), events: poseDiagnosticsRef.current }, null, 2));
      showToast("Diagnóstico dos players copiado sem frases ou dados do microfone");
    } catch {
      showToast("Não foi possível copiar o diagnóstico");
    }
  };

  const visibleBatches = panelTab === "captions"
    ? [...batches.filter((batch) => batch.status !== "done"), ...completedHistory]
    : batches;
  return <>
    <div className="studio-heading">
      <div>{!offline && <button className="back" aria-label="Voltar para salas" onClick={() => { window.location.href = "/salas"; }}>←</button>}<div><p className="eyebrow">TRADUÇÃO EM TEMPO REAL</p><h1>Sala ao vivo</h1></div></div>
      <div className="studio-status"><span className={recording ? "pill live" : "pill"}><i className="status-dot" />{recording ? `AO VIVO · ${time}` : "SALA PRONTA"}</span>{!offline && <button className="secondary" onClick={() => showToast("Configuração da sala salva")}>Salvar sala</button>}</div>
    </div>
    <div className="studio-grid">
      <section className="stage-card">
        <div className="stage-toolbar"><div><span className={recording ? "tag live-tag" : "tag"}>{recording ? "AO VIVO" : "PRÉVIA"}</span><b>Sala · {roomName || "Sem nome"}</b><span className={`avatar-health ${avatarReady ? "connected" : ""}`}><i />{avatarStatus}</span></div><button aria-label="Exibir player e legendas em tela cheia" onClick={() => stageRef.current?.requestFullscreen()}>⛶</button></div>
        <div ref={stageRef} className="live-stage complete" style={{ "--stage-zoom": stageZoom } as CSSProperties}>
          <iframe ref={frameRef} className="avatar-widget-frame" title="Avatar 3D NeoTalk" src={widgetUrl} allow="fullscreen" />
          <button className="exit-fullscreen" aria-label="Sair da tela cheia" onClick={() => void document.exitFullscreen()}>×</button>
          <div className="fullscreen-zoom" aria-label="Zoom da transmissão"><button aria-label="Diminuir zoom" onClick={() => adjustStageZoom(-0.1)}>−</button><button className="zoom-value" aria-label="Restaurar zoom para 100%" onClick={() => setStageZoom(1)}>{Math.round(stageZoom * 100)}%</button><button aria-label="Aumentar zoom" onClick={() => adjustStageZoom(0.1)}>+</button></div>
          <div className="stage-brand">neo<strong>talk</strong></div>
          <div className="live-captions" aria-live="polite">{recording ? (microphoneMuted ? (lastCaption || "Microfone mutado · mantendo a tradução em loop") : (interimCaption || lastCaption || "Ouvindo…")) : "Inicie a sala para capturar o microfone e gerar legendas."}</div>
          <span className="stage-language">PT → LIBRAS</span>
        </div>
        <div className="capture-controls"><div className={`audio-source ${recording && !microphoneMuted ? "listening" : ""} ${microphoneMuted ? "muted" : ""}`}><span>{microphoneMuted ? "×" : "⌁"}</span><div><small>{microphoneMuted ? "MICROFONE MUTADO" : recording ? `MICROFONE CAPTURANDO · ${transcriptionEngine === "server" ? "MODO COMPATÍVEL" : "TEMPO REAL"}` : "ENTRADA DE ÁUDIO"}</small><b>{microphoneName}</b></div><span className="audio-level" aria-hidden="true"><i/><i/><i/><i/></span></div>{recording && <button className={`mute-button ${microphoneMuted ? "active" : ""}`} onClick={toggleMicrophone}>{microphoneMuted ? "Ativar microfone" : "Mutar microfone"}</button>}<button disabled={starting} className={recording ? "record stop" : "record"} onClick={toggleRecording}><i />{starting ? "Iniciando sala…" : recording ? "Encerrar sala" : "Iniciar sala ao vivo"}</button></div>
      </section>
      <aside className="studio-panel">
        <div className="panel-tabs"><button className={panelTab === "room" ? "active" : ""} onClick={() => setPanelTab("room")}>Sala</button><button className={panelTab === "captions" ? "active" : ""} onClick={() => setPanelTab("captions")}>Legenda</button></div>
        {panelTab === "room" && <div className="config-block"><label>Nome da sala<input value={roomName} disabled={recording} onChange={(event) => setRoomName(event.target.value)} /></label><label>Avatar 3D<select value={avatar} disabled={recording || offline} onChange={(event) => selectAvatar(event.target.value as AvatarId)}>{!offline && <><option value="lia">Lia · NeoTalk</option><option value="asuna">Asuna · NeoTalk</option></>}<option value="elia">Elia · NeoTalk</option></select></label><div className="avatar-choice"><div className="avatar-bust"><i/><i/></div><div><b>{avatarNames[avatar]}</b><small>Avatar da sala · Libras</small></div><span>{avatarReady ? "✓" : "…"}</span></div></div>}
        <div className="config-block live-queue"><div className="block-title"><b>{panelTab === "captions" ? "Histórico de legendas" : "Tradução ao vivo"}</b><small>{panelTab === "captions" ? "Últimos 50 trechos concluídos desta sessão" : "Trechos contínuos · últimas frases mantêm o avatar ativo"} · {processedBatches} concluídos</small>{diagnostics && <span className={`backend-state ${backendStatus.includes("conect") || backendStatus.includes("sincronizado") || backendStatus.includes("salva") ? "online" : ""}`}><i />{backendStatus}</span>}</div>{visibleBatches.length ? <div className="batch-list">{visibleBatches.map((batch) => <div className={`batch-item ${batch.status}`} key={batch.id}><span>{batch.status === "done" ? "CONCLUÍDO" : batch.status === "playing" ? "AGORA" : batch.status === "ready" ? "A SEGUIR" : "PREPARANDO"}</span><p>{batch.text}{diagnostics && batch.glossText && <small>GLOSAS · {batch.glossText}</small>}</p></div>)}</div> : <div className="queue-empty"><span>⌁</span><p>{recording ? processedBatches ? "A tradução continua ouvindo." : "Ouvindo o primeiro trecho…" : "Os trechos falados aparecerão aqui."}</p></div>}</div>
        <div className="config-block"><div className="block-title"><b>Transmitir a sala</b><small>Avatar e legendas continuam sincronizados em qualquer saída.</small></div>{externalPlayerMode ? <button className="output-button active-output" onClick={closeExternalPlayer}><span>×</span><div><b>Fechar saída externa</b><small>{externalPlayerMode === "pip" ? "Mini-player flutuante ativo" : "Janela separada ativa"}</small></div><i>●</i></button> : <><button className="output-button" onClick={() => void openExternalPlayer("pip")}><span>▣</span><div><b>Mini-player flutuante</b><small>Sempre visível e com tamanho ajustável</small></div><i>→</i></button><button className="output-button" onClick={() => void openExternalPlayer("window")}><span>↗</span><div><b>Abrir em outra janela</b><small>Para outra aba, monitor ou captura de janela</small></div><i>→</i></button></>}<button className="output-button" onClick={() => { setCameraGuideOpen((value) => !value); if (!externalPlayerMode) void openExternalPlayer("window"); }}><span>◎</span><div><b>Usar no Meet ou Zoom</b><small>Saída para OBS Virtual Camera</small></div><i>{cameraGuideOpen ? "−" : "+"}</i></button>{cameraGuideOpen && <div className="camera-guide"><b>Transformar em câmera</b><ol><li>No OBS, adicione uma fonte <strong>Captura de janela</strong>.</li><li>Selecione <strong>NeoTalk · Tradução em Libras</strong>.</li><li>Clique em <strong>Iniciar câmera virtual</strong>.</li><li>No Meet ou Zoom, escolha <strong>OBS Virtual Camera</strong>.</li></ol><small>O navegador não pode criar uma câmera do sistema sozinho. Sem OBS, compartilhe a janela NeoTalk como tela.</small></div>}<button className="output-button" onClick={copyPlayerLink}><span>⌁</span><div><b>Copiar link direto</b><small>Somente avatar, sem as legendas da sala</small></div><i>→</i></button></div>
        {diagnostics && <div className="config-block"><div className="block-title"><b>Diagnóstico dos players</b><small>Registra as últimas 120 etapas de carregamento, sem áudio ou frases.</small></div><button className="output-button" onClick={() => void copyPoseDiagnostics()}><span>↧</span><div><b>Copiar diagnóstico</b><small>Principal e mini-player · tempos e IDs</small></div><i>→</i></button></div>}
      </aside>
    </div>
  </>;
}
