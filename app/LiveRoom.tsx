"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { isNonBlockingAvatarError, isRetryableAvatarError } from "./avatarMessages";
import { ApiError, apiRequest } from "./apiClient";

type AvatarId = "lia" | "asuna" | "elia";
type RemoteBatchStatus = "queued" | "translating" | "done" | "error";
type LiveBatch = { id: number; text: string; glossText?: string; status: RemoteBatchStatus | "ready" | "playing" };
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
type AvatarMessage = { type?: string; status?: string; code?: string; message?: string; words?: unknown[]; capabilities?: string[] };
type RoomResponse = { id: string; status: string };
type BatchResponse = { id: string; status: string };
type AgentTranslation = { gloss_text: string; prompt_id?: string; model?: string; agent_latency_ms?: number; skipped?: boolean; reason?: string };

const avatarWidgetBase = process.env.NEXT_PUBLIC_AVATAR_WIDGET_URL || "https://infra-avatar3d-oficial.k3p3ex.easypanel.host/widget";
const avatarNames: Record<AvatarId, string> = { lia: "Lia", asuna: "Asuna", elia: "Elia" };
const LIVE_BATCH_MIN_WORDS = 2;
const LIVE_BATCH_MAX_WORDS = 12;
const LIVE_BATCH_SILENCE_MS = 650;
const LIVE_AGENT_CONCURRENCY = 2;
const LIVE_IDLE_LOOP_DELAY_MS = 2200;
const LIVE_IDLE_LOOP_GAP_MS = 320;
const LIVE_API_RETRY_DELAYS_MS = [350, 800];
const LIVE_AVATAR_RETRY_DELAY_MS = 2500;
const LIVE_AVATAR_MAX_RETRIES = 2;
const LIVE_AVATAR_PROCESSING_TIMEOUT_MS = 60000;
const LIVE_AVATAR_MAX_RECOVERIES = 2;
const LIVE_FALLBACK_CHUNK_MS = 3200;
const LIVE_TRANSCRIPTION_CONCURRENCY = 2;
const LIVE_TRANSCRIPTION_BACKLOG = 6;
const LIVE_HEARTBEAT_INTERVAL_MS = 25000;
const LIVE_HEARTBEAT_RETRY_MS = 5000;

async function roomApi<T>(path: string, options?: RequestInit): Promise<T> {
  return apiRequest<T>(path, options);
}

async function retryTransientApi<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (reason) {
      const retryable = reason instanceof ApiError
        ? reason.status === 408 || reason.status === 429 || reason.status >= 500
        : reason instanceof DOMException && ["AbortError", "TimeoutError"].includes(reason.name);
      if (!retryable || attempt >= LIVE_API_RETRY_DELAYS_MS.length) throw reason;
      await new Promise((resolve) => window.setTimeout(resolve, LIVE_API_RETRY_DELAYS_MS[attempt]));
    }
  }
}

export default function LiveRoom({ recording, setRecording, time, showToast, diagnostics = false }: {
  recording: boolean;
  setRecording: (value: boolean) => void;
  time: string;
  showToast: (value: string) => void;
  diagnostics?: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const externalWindowRef = useRef<Window | null>(null);
  const externalFrameRef = useRef<HTMLIFrameElement | null>(null);
  const externalCaptionRef = useRef<HTMLDivElement | null>(null);
  const embeddedAvatarReadyRef = useRef(false);
  const avatarMessageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fallbackRecorderRef = useRef<MediaRecorder | null>(null);
  const fallbackStreamRef = useRef<MediaStream | null>(null);
  const fallbackChunkTimerRef = useRef<number | null>(null);
  const fallbackCaptureGenerationRef = useRef(0);
  const fallbackRecoveryInFlightRef = useRef(false);
  const fallbackTranscriptionQueueRef = useRef<{ blob: Blob; generation: number }[]>([]);
  const fallbackTranscriptionInFlightRef = useRef(0);
  const recoverFallbackCaptureRef = useRef<() => void>(() => undefined);
  const heartbeatTimerRef = useRef<number | null>(null);
  const heartbeatInFlightRef = useRef(false);
  const heartbeatFailuresRef = useRef(0);
  const restartRecognitionRef = useRef<(delay?: number) => void>(() => undefined);
  const listeningRef = useRef(false);
  const microphoneMutedRef = useRef(false);
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
  const avatarWidgetReloadCountRef = useRef(0);
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
  const avatarSupportsReplayRef = useRef(false);
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
    desiredBatchStatusRef.current.set(localId, status);
    const remoteId = remoteBatchIdsRef.current.get(localId);
    if (!remoteId) return;
    try {
      const agent = agentResultsRef.current.get(localId);
      await roomApi<BatchResponse>(`/batches/${remoteId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          error_message: errorMessage || null,
          gloss_text: agent?.gloss_text || null,
          prompt_id: agent?.prompt_id || null,
          model: agent?.model || null,
          agent_latency_ms: agent?.agent_latency_ms ?? null,
        }),
      });
      setBackendStatus("Histórico sincronizado");
    } catch {
      setBackendStatus("Falha ao sincronizar lote");
    }
  };

  const persistBatch = async (batch: LiveBatch) => {
    const roomId = roomIdRef.current;
    if (!roomId) return;
    try {
      const remote = await roomApi<BatchResponse>(`/rooms/${roomId}/batches`, {
        method: "POST",
        body: JSON.stringify({ text: batch.text }),
      });
      remoteBatchIdsRef.current.set(batch.id, remote.id);
      const desiredStatus = desiredBatchStatusRef.current.get(batch.id);
      if (desiredStatus && desiredStatus !== "queued") await updateRemoteBatch(batch.id, desiredStatus);
      else setBackendStatus("Histórico sincronizado");
    } catch {
      setBackendStatus("Falha ao salvar lote");
    }
  };

  const refreshBatchView = () => {
    const active = activeBatchRef.current ? [{ ...activeBatchRef.current }] : [];
    const visiblePending = pendingBatchesRef.current.filter((batch) => batch.status !== "error");
    setBatches([...active, ...visiblePending].slice(0, 4));
  };

  const sendToAvatar = (message: Record<string, unknown>) => {
    let embeddedSent = false;
    if (embeddedAvatarReadyRef.current && frameRef.current?.contentWindow) {
      frameRef.current.contentWindow.postMessage(message, widgetOrigin);
      embeddedSent = true;
    }
    const externalWindow = externalWindowRef.current;
    if (externalWindow && !externalWindow.closed) {
      if (!avatarReadyRef.current || !externalFrameRef.current?.contentWindow) return embeddedSent;
      externalWindow.postMessage({ type: "neotalk:external-player-command", message }, window.location.origin);
      return true;
    }
    return embeddedSent;
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
    avatarWidgetReloadCountRef.current = 0;
    avatarCommandAcknowledgedRef.current = false;
    avatarPlaybackStartedRef.current = false;
    setAvatarError("");
    setAvatarStatus(`${avatarNames[avatar]} mantendo a tradução ativa`);
    const loopCommand = avatarSupportsReplayRef.current ? "neotalk:replay" : "neotalk:sign";
    if (!sendToAvatar({ type: loopCommand, phrase: phrase.glossText || phrase.text })) {
      idleLoopActiveRef.current = false;
      avatarBusyRef.current = false;
    } else scheduleAvatarRetry();
  };

  const scheduleIdleLoop = (minimumDelay = LIVE_IDLE_LOOP_DELAY_MS) => {
    clearIdleLoopTimer();
    if (!listeningRef.current || activeBatchRef.current || pendingBatchesRef.current.length || wordBufferRef.current.length || !recentPhrasesRef.current.length) return;
    // Executado apenas pelo timer/evento de reprodução, nunca durante o render.
    // eslint-disable-next-line react-hooks/purity
    const silenceRemaining = Math.max(0, LIVE_IDLE_LOOP_DELAY_MS - (Date.now() - lastSpeechAtRef.current));
    idleLoopTimerRef.current = window.setTimeout(playIdleLoopPhrase, Math.max(minimumDelay, silenceRemaining));
  };

  const finishIdleLoopPhrase = () => {
    if (!idleLoopActiveRef.current) return;
    idleLoopActiveRef.current = false;
    avatarBusyRef.current = false;
    setAvatarStatus(`${avatarNames[avatar]} aguardando nova fala`);
    scheduleIdleLoop(LIVE_IDLE_LOOP_GAP_MS);
  };

  const interruptIdleLoopForSpeech = () => {
    // Executado apenas em resposta à captura de fala.
    // eslint-disable-next-line react-hooks/purity
    lastSpeechAtRef.current = Date.now();
    clearIdleLoopTimer();
    if (idleLoopActiveRef.current) {
      clearAvatarRetryTimer();
      clearAvatarProcessingTimer();
      avatarRetryCountRef.current = 0;
      avatarRecoveryCountRef.current = 0;
      avatarCommandAcknowledgedRef.current = false;
      avatarPlaybackStartedRef.current = false;
      if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
      idleLoopActiveRef.current = false;
      avatarBusyRef.current = false;
      sendToAvatar({ type: "neotalk:pause" });
      setAvatarStatus("Nova fala detectada");
    }
    scheduleIdleLoop();
  };

  const dispatchNextBatch = () => {
    if (!avatarReadyRef.current || avatarBusyRef.current || !pendingBatchesRef.current.length) return;
    clearIdleLoopTimer();
    clearAvatarRetryTimer();
    clearAvatarProcessingTimer();
    while (pendingBatchesRef.current[0]?.status === "error") pendingBatchesRef.current.shift();
    const first = pendingBatchesRef.current[0];
    if (!first || first.status !== "ready") return;
    const next = pendingBatchesRef.current.shift();
    if (!next) return;
    next.status = "playing";
    void updateRemoteBatch(next.id, "translating");
    activeBatchRef.current = next;
    avatarBusyRef.current = true;
    avatarRetryCountRef.current = 0;
    avatarRecoveryCountRef.current = 0;
    avatarWidgetReloadCountRef.current = 0;
    avatarCommandAcknowledgedRef.current = false;
    avatarPlaybackStartedRef.current = false;
    refreshBatchView();
    setAvatarError("");
    setAvatarStatus(`Enviando glosas para ${avatarNames[avatar]}`);
    if (!sendToAvatar({ type: "neotalk:sign", phrase: next.glossText })) {
      next.status = "ready";
      pendingBatchesRef.current.unshift(next);
      activeBatchRef.current = null;
      avatarBusyRef.current = false;
      refreshBatchView();
    } else scheduleAvatarRetry();
  };

  const translateBatch = (batch: LiveBatch) => {
    if (batch.status !== "queued" || agentPromisesRef.current.has(batch.id)) return;
    batch.status = "translating";
    void updateRemoteBatch(batch.id, "translating");
    refreshBatchView();
    const request = retryTransientApi(() => roomApi<AgentTranslation>("/agent/translate", {
      method: "POST",
      body: JSON.stringify({ text: batch.text, batch_id: remoteBatchIdsRef.current.get(batch.id) || null }),
    })).then((agent) => {
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
    }).catch((reason) => {
      const message = reason instanceof Error ? reason.message : "O agente não conseguiu traduzir o lote.";
      batch.status = "error";
      if (diagnostics) setAvatarError(message);
      else {
        setAvatarError("");
        setAvatarStatus("A tradução segue ouvindo os próximos trechos");
      }
      void updateRemoteBatch(batch.id, "error", message);
    }).finally(() => {
      agentPromisesRef.current.delete(batch.id);
      refreshBatchView();
      pretranslatePendingBatches();
      dispatchNextBatch();
    });
    agentPromisesRef.current.set(batch.id, request);
  };

  const pretranslatePendingBatches = () => {
    let available = LIVE_AGENT_CONCURRENCY - agentPromisesRef.current.size;
    if (available <= 0) return;
    for (const batch of pendingBatchesRef.current) {
      if (batch.status !== "queued") continue;
      translateBatch(batch);
      available -= 1;
      if (available <= 0) break;
    }
  };

  const completeActiveBatch = (status: "done" | "error") => {
    clearAvatarProcessingTimer();
    if (!activeBatchRef.current) return;
    const completedBatch = activeBatchRef.current;
    completedBatch.status = status;
    void updateRemoteBatch(completedBatch.id, status, status === "error" ? "O widget não conseguiu traduzir o lote." : undefined);
    if (status === "done") {
      setProcessedBatches((value) => value + 1);
      recentPhrasesRef.current = [...recentPhrasesRef.current, { ...completedBatch }].slice(-2);
    }
    activeBatchRef.current = null;
    avatarBusyRef.current = false;
    avatarCommandAcknowledgedRef.current = false;
    refreshBatchView();
    if (status === "done") {
      window.setTimeout(() => {
        dispatchNextBatch();
        scheduleIdleLoop();
      }, 100);
    }
  };

  const releaseAvatarAfterRetryFailure = () => {
    clearAvatarRetryTimer();
    clearAvatarProcessingTimer();
    avatarRetryCountRef.current = 0;
    avatarCommandAcknowledgedRef.current = false;
    avatarPlaybackStartedRef.current = false;
    if (idleLoopActiveRef.current) {
      idleLoopActiveRef.current = false;
      avatarBusyRef.current = false;
      scheduleIdleLoop(LIVE_IDLE_LOOP_GAP_MS);
      return;
    }
    const failedBatch = activeBatchRef.current;
    if (failedBatch) {
      failedBatch.status = "error";
      void updateRemoteBatch(failedBatch.id, "error", "O avatar recusou o lote após as retentativas.");
    }
    activeBatchRef.current = null;
    avatarBusyRef.current = false;
    refreshBatchView();
    window.setTimeout(() => {
      dispatchNextBatch();
      scheduleIdleLoop();
    }, 100);
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
    const command = idleLoopActiveRef.current && avatarSupportsReplayRef.current ? "neotalk:replay" : "neotalk:sign";
    if (!sendToAvatar({ type: command, phrase: text })) releaseAvatarAfterRetryFailure();
    else scheduleAvatarRetry();
  };

  const recoverAcceptedAvatarPhrase = () => {
    clearAvatarProcessingTimer();
    if (!avatarBusyRef.current || avatarPlaybackStartedRef.current) return;
    if (avatarRecoveryCountRef.current >= LIVE_AVATAR_MAX_RECOVERIES) {
      const activeFrame = externalWindowRef.current && !externalWindowRef.current.closed
        ? externalFrameRef.current
        : frameRef.current;
      if (avatarWidgetReloadCountRef.current >= 1 || !activeFrame) {
        releaseAvatarAfterRetryFailure();
        return;
      }
      avatarWidgetReloadCountRef.current += 1;
      avatarReadyRef.current = false;
      setAvatarReady(false);
      setAvatarStatus(`Reiniciando o renderizador da ${avatarNames[avatar]}`);
      activeFrame.src = widgetUrl;
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
    const command = idleLoopActiveRef.current && avatarSupportsReplayRef.current ? "neotalk:replay" : "neotalk:sign";
    if (!sendToAvatar({ type: command, phrase: text })) releaseAvatarAfterRetryFailure();
    else scheduleAvatarRetry();
  };

  const scheduleAvatarProcessingWatchdog = () => {
    clearAvatarProcessingTimer();
    if (!avatarBusyRef.current || avatarPlaybackStartedRef.current) return;
    avatarProcessingTimerRef.current = window.setTimeout(recoverAcceptedAvatarPhrase, LIVE_AVATAR_PROCESSING_TIMEOUT_MS);
  };

  const scheduleAvatarRetry = () => {
    clearAvatarRetryTimer();
    if (avatarPlaybackStartedRef.current || avatarCommandAcknowledgedRef.current) return;
    avatarRetryTimerRef.current = window.setTimeout(retryCurrentAvatarPhrase, LIVE_AVATAR_RETRY_DELAY_MS);
  };

  const enqueueBatch = (text: string) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    clearIdleLoopTimer();
    const batch: LiveBatch = { id: ++batchIdRef.current, text: normalized, status: "queued" };
    pendingBatchesRef.current.push(batch);
    desiredBatchStatusRef.current.set(batch.id, "queued");
    void persistBatch(batch);
    refreshBatchView();
    pretranslatePendingBatches();
    dispatchNextBatch();
  };

  const flushWordBuffer = (force = false) => {
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    batchTimerRef.current = null;
    while (wordBufferRef.current.length >= LIVE_BATCH_MAX_WORDS) {
      enqueueBatch(wordBufferRef.current.splice(0, LIVE_BATCH_MAX_WORDS).join(" "));
    }
    if (wordBufferRef.current.length >= LIVE_BATCH_MIN_WORDS || (force && wordBufferRef.current.length > 0)) {
      enqueueBatch(wordBufferRef.current.splice(0).join(" "));
    }
  };

  const addTranscriptToBuffer = (text: string) => {
    wordBufferRef.current.push(...text.split(/\s+/).filter(Boolean));
    while (wordBufferRef.current.length >= LIVE_BATCH_MAX_WORDS) {
      enqueueBatch(wordBufferRef.current.splice(0, LIVE_BATCH_MAX_WORDS).join(" "));
    }
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    const delay = /[.!?;:]$/.test(text.trim()) ? 180 : LIVE_BATCH_SILENCE_MS;
    batchTimerRef.current = window.setTimeout(flushWordBuffer, delay);
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
      const externalWindow = externalWindowRef.current;
      const externalActive = Boolean(externalWindow && !externalWindow.closed);
      const fromEmbeddedFrame = event.source === frameRef.current?.contentWindow;
      const fromExternalFrame = event.source === externalFrameRef.current?.contentWindow;
      if (event.origin !== widgetOrigin || (!fromEmbeddedFrame && !fromExternalFrame)) return;
      if (fromEmbeddedFrame && event.data?.type === "neotalk:ready") embeddedAvatarReadyRef.current = true;
      if ((externalActive && !fromExternalFrame) || (!externalActive && !fromEmbeddedFrame)) return;
      const data = event.data as AvatarMessage;

      if (data.type === "neotalk:ready") {
        if (fromEmbeddedFrame) embeddedAvatarReadyRef.current = true;
        avatarReadyRef.current = true;
        avatarSupportsReplayRef.current = Array.isArray(data.capabilities) && data.capabilities.includes("replay");
        setAvatarReady(true);
        setAvatarError("");
        setAvatarStatus(`${avatarNames[avatar]} conectada`);
        window.setTimeout(() => {
          const active = activeBatchRef.current;
          if (active && avatarBusyRef.current && !avatarPlaybackStartedRef.current) {
            avatarCommandAcknowledgedRef.current = false;
            if (sendToAvatar({ type: "neotalk:sign", phrase: active.glossText || active.text })) scheduleAvatarRetry();
            else releaseAvatarAfterRetryFailure();
          } else {
            dispatchNextBatch();
            scheduleIdleLoop();
          }
        }, 100);
      } else if (data.type === "neotalk:status" && data.status) {
        if (avatarBusyRef.current && ["queued", "processing", "loading_pose"].includes(data.status)) {
          avatarCommandAcknowledgedRef.current = true;
          clearAvatarRetryTimer();
          avatarRetryCountRef.current = 0;
          scheduleAvatarProcessingWatchdog();
        }
        setAvatarStatus(statusLabels[data.status] || data.status);
      } else if (data.type === "neotalk:playing") {
        clearAvatarRetryTimer();
        clearAvatarProcessingTimer();
        avatarRetryCountRef.current = 0;
        avatarRecoveryCountRef.current = 0;
        avatarWidgetReloadCountRef.current = 0;
        avatarCommandAcknowledgedRef.current = true;
        avatarPlaybackStartedRef.current = true;
        setAvatarStatus(idleLoopActiveRef.current ? `${avatarNames[avatar]} mantendo a tradução ativa` : `${avatarNames[avatar]} sinalizando o lote atual`);
        const wordCount = Array.isArray(data.words) ? data.words.length : 4;
        if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = window.setTimeout(
          () => idleLoopActiveRef.current ? finishIdleLoopPhrase() : completeActiveBatch("done"),
          Math.max(2600, wordCount * 850),
        );
      } else if (data.type === "neotalk:error") {
        if (data.code === "pose_cache_miss" && idleLoopActiveRef.current) {
          const phrase = recentPhrasesRef.current[idleLoopIndexRef.current === 0 ? recentPhrasesRef.current.length - 1 : idleLoopIndexRef.current - 1];
          if (phrase && sendToAvatar({ type: "neotalk:sign", phrase: phrase.glossText || phrase.text })) return;
        }
        if (isRetryableAvatarError(data.message)) {
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
        if (!diagnostics) {
          setAvatarError("");
          setAvatarStatus("Ajustando a tradução");
          if (!avatarPlaybackStartedRef.current) scheduleAvatarRetry();
          return;
        }
        avatarReadyRef.current = false;
        setAvatarReady(false);
        setAvatarError(data.message || "Não foi possível traduzir o lote atual.");
        setAvatarStatus("Fila pausada");
        if (idleLoopActiveRef.current) {
          idleLoopActiveRef.current = false;
          avatarBusyRef.current = false;
        } else {
          completeActiveBatch("error");
        }
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
      const { blob, generation } = queued;
      fallbackTranscriptionInFlightRef.current += 1;
      void apiRequest<{ text: string }>("/agent/transcribe", {
        method: "POST",
        headers: { "Content-Type": blob.type.split(";", 1)[0] },
        body: blob,
      }).then(({ text }) => {
        if (!text || !listeningRef.current || generation !== fallbackCaptureGenerationRef.current) return;
        interruptIdleLoopForSpeech();
        setLastCaption(text);
        setInterimCaption("");
        addTranscriptToBuffer(text);
      }).catch(() => {
        if (diagnostics) setBackendStatus("Trecho de áudio não transcrito");
      }).finally(() => {
        fallbackTranscriptionInFlightRef.current = Math.max(0, fallbackTranscriptionInFlightRef.current - 1);
        pumpFallbackTranscriptions();
      });
    }
  };

  const queueFallbackTranscription = (blob: Blob, generation: number) => {
    if (fallbackTranscriptionQueueRef.current.length >= LIVE_TRANSCRIPTION_BACKLOG) {
      fallbackTranscriptionQueueRef.current.shift();
      if (diagnostics) setBackendStatus("Áudio recuperado após lentidão da rede");
    }
    fallbackTranscriptionQueueRef.current.push({ blob, generation });
    pumpFallbackTranscriptions();
  };

  const startFallbackChunk = () => {
    const stream = fallbackStreamRef.current;
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track || track.readyState !== "live" || !listeningRef.current || microphoneMutedRef.current || fallbackRecorderRef.current?.state === "recording") return;
    const generation = fallbackCaptureGenerationRef.current;
    const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: BlobPart[] = [];
    fallbackRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
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
  };

  const stopFallbackCapture = (releaseStream = true) => {
    fallbackCaptureGenerationRef.current += 1;
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
    try {
      stopFallbackCapture();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!listeningRef.current || microphoneMutedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      bindFallbackStream(stream);
      setTranscriptionEngine("server");
      setAvatarStatus("Microfone reconectado");
      startFallbackChunk();
    } catch {
      if (diagnostics) setBackendStatus("Reconectando microfone");
      window.setTimeout(() => recoverFallbackCaptureRef.current(), 2000);
    } finally {
      fallbackRecoveryInFlightRef.current = false;
    }
  };
  recoverFallbackCaptureRef.current = () => { void recoverFallbackCapture(); };

  const selectAvatar = (value: AvatarId) => {
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
    if (!roomId || heartbeatInFlightRef.current) return;
    heartbeatInFlightRef.current = true;
    try {
      await roomApi<void>(`/rooms/${roomId}/heartbeat`, {
        method: "POST",
        signal: AbortSignal.timeout(10000),
      });
      heartbeatFailuresRef.current = 0;
      if (diagnostics) setBackendStatus("Sala conectada ao histórico");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404 && roomIdRef.current === roomId) {
        try {
          await roomApi<RoomResponse>(`/rooms/${roomId}/start`, { method: "POST" });
          heartbeatFailuresRef.current = 0;
          if (diagnostics) setBackendStatus("Histórico da sala retomado");
        } catch {
          heartbeatFailuresRef.current += 1;
        }
      } else {
        heartbeatFailuresRef.current += 1;
      }
      if (diagnostics && heartbeatFailuresRef.current) setBackendStatus("Reconectando histórico da sala");
    } finally {
      heartbeatInFlightRef.current = false;
      scheduleHeartbeat(heartbeatFailuresRef.current ? LIVE_HEARTBEAT_RETRY_MS : LIVE_HEARTBEAT_INTERVAL_MS);
    }
  }

  const stopLiveRoom = () => {
    listeningRef.current = false;
    microphoneMutedRef.current = false;
    setMicrophoneMuted(false);
    clearIdleLoopTimer();
    clearAvatarRetryTimer();
    clearAvatarProcessingTimer();
    idleLoopActiveRef.current = false;
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
    recognitionWatchdogRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopFallbackCapture();
    clearHeartbeat();
    heartbeatFailuresRef.current = 0;
    sendToAvatar({ type: "neotalk:pause" });
    setInterimCaption("");
    flushWordBuffer(true);
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
      }).then(() => setBackendStatus("Sala salva no histórico")).catch(() => setBackendStatus("Falha ao encerrar sala"));
    }
  };

  const startLiveRoom = async () => {
    const browserWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const SpeechRecognitionApi = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
    let createdRoomId: string | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      if (track?.label) setMicrophoneName(track.label);
      if (SpeechRecognitionApi) stream.getTracks().forEach((item) => item.stop());
      else bindFallbackStream(stream);

      setBackendStatus("Criando sala");
      let room: RoomResponse;
      try {
        room = await roomApi<RoomResponse>("/rooms", {
          method: "POST",
          body: JSON.stringify({ name: roomName.trim() || "Sala ao vivo", avatar }),
        });
        createdRoomId = room.id;
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 409) throw reason;
        const rooms = await roomApi<RoomResponse[]>("/rooms");
        const activeRoom = rooms.find((item) => item.status === "ready" || item.status === "live");
        if (!activeRoom) throw reason;
        room = activeRoom;
        setBackendStatus("Retomando sua sala ativa");
      }
      await roomApi<RoomResponse>(`/rooms/${room.id}/start`, { method: "POST" });
      roomIdRef.current = room.id;
      roomStartedAtRef.current = Date.now();
      remoteBatchIdsRef.current.clear();
      desiredBatchStatusRef.current.clear();
      agentResultsRef.current.clear();
      recentPhrasesRef.current = [];
      idleLoopIndexRef.current = 0;
      idleLoopActiveRef.current = false;
      lastSpeechAtRef.current = Date.now();
      setBackendStatus("Sala conectada ao histórico");

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
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
        recognitionWatchdogRef.current = null;
        recognition.onerror = null;
        recognition.onend = null;
        try { recognition.abort(); } catch { /* reconhecimento já encerrado */ }
        recognitionRef.current = null;
        try {
          const compatibleStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
          listeningRef.current = false;
          setRecording(false);
          showToast("Não foi possível acessar o microfone. Revise a permissão do navegador.");
        }
      };
      const restartRecognition = (delay = 350) => {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          if (!listeningRef.current || microphoneMutedRef.current) return;
          try {
            recognition.start();
            recognitionActivityAtRef.current = Date.now();
          } catch {
            restartRecognition(900);
          }
        }, delay);
      };
      recognition.onresult = (event) => {
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
          listeningRef.current = false;
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
      listeningRef.current = false;
      setRecording(false);
      stopFallbackCapture();
      if (createdRoomId) {
        roomIdRef.current = null;
        roomStartedAtRef.current = null;
        void roomApi<RoomResponse>(`/rooms/${createdRoomId}/finish`, {
          method: "POST",
          body: JSON.stringify({ duration_seconds: 0 }),
        });
      }
      showToast("Não foi possível iniciar a sala ou acessar o microfone");
    }
  };

  const toggleRecording = () => {
    if (recording) stopLiveRoom();
    else void startLiveRoom();
  };

  const toggleMicrophone = () => {
    if (!recording) return;
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
      recognitionActivityAtRef.current = Date.now();
      if (transcriptionEngine === "server") startFallbackChunk();
      else restartRecognitionRef.current(0);
      setAvatarStatus("Microfone reativado");
    }
  };

  useEffect(() => {
    const restoreLongRunningSession = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine || !listeningRef.current) return;
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
    resetPlaybackForOutputChange();
    externalWindowRef.current = null;
    externalFrameRef.current = null;
    externalCaptionRef.current = null;
    avatarReadyRef.current = embeddedAvatarReadyRef.current;
    setAvatarReady(embeddedAvatarReadyRef.current);
    setAvatarStatus(embeddedAvatarReadyRef.current ? `${avatarNames[avatar]} conectada` : `Conectando à ${avatarNames[avatar]}`);
    setExternalPlayerMode(null);
    window.setTimeout(() => {
      const active = activeBatchRef.current;
      if (active && avatarBusyRef.current && embeddedAvatarReadyRef.current) {
        avatarCommandAcknowledgedRef.current = false;
        avatarPlaybackStartedRef.current = false;
        if (sendToAvatar({ type: "neotalk:sign", phrase: active.glossText || active.text })) scheduleAvatarRetry();
      } else {
        dispatchNextBatch();
        scheduleIdleLoop();
      }
    }, 100);
  };

  const resetPlaybackForOutputChange = () => {
    clearAvatarRetryTimer();
    clearAvatarProcessingTimer();
    clearIdleLoopTimer();
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
    avatarCommandAcknowledgedRef.current = false;
    avatarPlaybackStartedRef.current = false;
    avatarRetryCountRef.current = 0;
    avatarRecoveryCountRef.current = 0;
    idleLoopActiveRef.current = false;
    avatarBusyRef.current = Boolean(activeBatchRef.current);
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
      relay.src = new URL("/external-player-relay.js?v=2", window.location.origin).href;
      relay.onload = () => resolve();
      relay.onerror = () => reject(new Error("Não foi possível conectar o mini-player."));
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
    resetPlaybackForOutputChange();
    avatarReadyRef.current = false;
    setAvatarReady(false);
    setAvatarStatus(`Conectando à ${avatarNames[avatar]} no mini-player`);
    setExternalPlayerMode(mode);
    targetWindow.addEventListener("pagehide", () => restoreStage(targetWindow), { once: true });
    outputFrame.src = widgetUrl;
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
      await navigator.clipboard.writeText(widgetUrl);
      showToast("Link direto do avatar copiado — esta saída não inclui as legendas");
    } catch {
      showToast("Não foi possível copiar o link");
    }
  };

  return <>
    <div className="studio-heading">
      <div><button className="back" aria-label="Voltar para salas" onClick={() => { window.location.href = "/salas"; }}>←</button><div><p className="eyebrow">TRADUÇÃO EM TEMPO REAL</p><h1>Sala ao vivo</h1></div></div>
      <div className="studio-status"><span className={recording ? "pill live" : "pill"}><i className="status-dot" />{recording ? `AO VIVO · ${time}` : "SALA PRONTA"}</span><button className="secondary" onClick={() => showToast("Configuração da sala salva")}>Salvar sala</button></div>
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
        <div className="capture-controls"><div className={`audio-source ${recording && !microphoneMuted ? "listening" : ""} ${microphoneMuted ? "muted" : ""}`}><span>{microphoneMuted ? "×" : "⌁"}</span><div><small>{microphoneMuted ? "MICROFONE MUTADO" : recording ? `MICROFONE CAPTURANDO · ${transcriptionEngine === "server" ? "MODO COMPATÍVEL" : "TEMPO REAL"}` : "ENTRADA DE ÁUDIO"}</small><b>{microphoneName}</b></div><span className="audio-level" aria-hidden="true"><i/><i/><i/><i/></span></div>{recording && <button className={`mute-button ${microphoneMuted ? "active" : ""}`} onClick={toggleMicrophone}>{microphoneMuted ? "Ativar microfone" : "Mutar microfone"}</button>}<button className={recording ? "record stop" : "record"} onClick={toggleRecording}><i />{recording ? "Encerrar sala" : "Iniciar sala ao vivo"}</button></div>
      </section>
      <aside className="studio-panel">
        <div className="panel-tabs"><button className="active">Sala</button><button>Legenda</button></div>
        <div className="config-block"><label>Nome da sala<input value={roomName} disabled={recording} onChange={(event) => setRoomName(event.target.value)} /></label><label>Avatar 3D<select value={avatar} disabled={recording} onChange={(event) => selectAvatar(event.target.value as AvatarId)}><option value="lia">Lia · NeoTalk</option><option value="asuna">Asuna · NeoTalk</option><option value="elia">Elia · NeoTalk</option></select></label><div className="avatar-choice"><div className="avatar-bust"><i/><i/></div><div><b>{avatarNames[avatar]}</b><small>Avatar da sala · Libras</small></div><span>{avatarReady ? "✓" : "…"}</span></div></div>
        <div className="config-block live-queue"><div className="block-title"><b>Tradução ao vivo</b><small>Trechos contínuos · últimas frases mantêm o avatar ativo · {processedBatches} concluídos</small>{diagnostics && <span className={`backend-state ${backendStatus.includes("conect") || backendStatus.includes("sincronizado") || backendStatus.includes("salva") ? "online" : ""}`}><i />{backendStatus}</span>}</div>{batches.length ? <div className="batch-list">{batches.map((batch) => <div className={`batch-item ${batch.status}`} key={batch.id}><span>{batch.status === "playing" ? "AGORA" : batch.status === "ready" ? "A SEGUIR" : "PREPARANDO"}</span><p>{batch.text}{diagnostics && batch.glossText && <small>GLOSAS · {batch.glossText}</small>}</p></div>)}</div> : <div className="queue-empty"><span>⌁</span><p>{recording ? "Ouvindo o primeiro trecho…" : "Os trechos falados aparecerão aqui."}</p></div>}</div>
        <div className="config-block"><div className="block-title"><b>Transmitir a sala</b><small>Avatar e legendas continuam sincronizados em qualquer saída.</small></div>{externalPlayerMode ? <button className="output-button active-output" onClick={closeExternalPlayer}><span>×</span><div><b>Fechar saída externa</b><small>{externalPlayerMode === "pip" ? "Mini-player flutuante ativo" : "Janela separada ativa"}</small></div><i>●</i></button> : <><button className="output-button" onClick={() => void openExternalPlayer("pip")}><span>▣</span><div><b>Mini-player flutuante</b><small>Sempre visível e com tamanho ajustável</small></div><i>→</i></button><button className="output-button" onClick={() => void openExternalPlayer("window")}><span>↗</span><div><b>Abrir em outra janela</b><small>Para outra aba, monitor ou captura de janela</small></div><i>→</i></button></>}<button className="output-button" onClick={() => { setCameraGuideOpen((value) => !value); if (!externalPlayerMode) void openExternalPlayer("window"); }}><span>◎</span><div><b>Usar no Meet ou Zoom</b><small>Saída para OBS Virtual Camera</small></div><i>{cameraGuideOpen ? "−" : "+"}</i></button>{cameraGuideOpen && <div className="camera-guide"><b>Transformar em câmera</b><ol><li>No OBS, adicione uma fonte <strong>Captura de janela</strong>.</li><li>Selecione <strong>NeoTalk · Tradução em Libras</strong>.</li><li>Clique em <strong>Iniciar câmera virtual</strong>.</li><li>No Meet ou Zoom, escolha <strong>OBS Virtual Camera</strong>.</li></ol><small>O navegador não pode criar uma câmera do sistema sozinho. Sem OBS, compartilhe a janela NeoTalk como tela.</small></div>}<button className="output-button" onClick={copyPlayerLink}><span>⌁</span><div><b>Copiar link direto</b><small>Somente avatar, sem as legendas da sala</small></div><i>→</i></button></div>
      </aside>
    </div>
  </>;
}
