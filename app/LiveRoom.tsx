"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { isNonBlockingAvatarError, isRetryableAvatarError } from "./avatarMessages";

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
type AvatarMessage = { type?: string; status?: string; message?: string; words?: unknown[] };
type RoomResponse = { id: string; status: string };
type BatchResponse = { id: string; status: string };
type AgentTranslation = { gloss_text: string; prompt_id: string; model: string; agent_latency_ms: number };

const avatarWidgetBase = process.env.NEXT_PUBLIC_AVATAR_WIDGET_URL || "https://infra-avatar3d-oficial.k3p3ex.easypanel.host/widget";
const liveRoomsApiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
const avatarNames: Record<AvatarId, string> = { lia: "Lia", asuna: "Asuna", elia: "Elia" };
const LIVE_BATCH_MIN_WORDS = 2;
const LIVE_BATCH_MAX_WORDS = 12;
const LIVE_BATCH_SILENCE_MS = 650;
const LIVE_AGENT_CONCURRENCY = 2;
const LIVE_IDLE_LOOP_DELAY_MS = 2200;
const LIVE_IDLE_LOOP_GAP_MS = 320;
const LIVE_API_RETRY_DELAYS_MS = [350, 800];
const LIVE_AVATAR_RETRY_DELAY_MS = 900;
const LIVE_AVATAR_MAX_RETRIES = 2;

class RoomApiError extends Error {
  constructor(public status: number) {
    super(`Falha da API (${status})`);
  }
}

async function roomApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${liveRoomsApiBase}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) throw new RoomApiError(response.status);
  return response.json() as Promise<T>;
}

async function retryUnprocessable<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (reason) {
      if (!(reason instanceof RoomApiError) || reason.status !== 422 || attempt >= LIVE_API_RETRY_DELAYS_MS.length) throw reason;
      await new Promise((resolve) => window.setTimeout(resolve, LIVE_API_RETRY_DELAYS_MS[attempt]));
    }
  }
}

export default function LiveRoom({ recording, setRecording, time, playerMode, setPlayerMode, showToast }: {
  recording: boolean;
  setRecording: (value: boolean) => void;
  time: string;
  playerMode: "complete" | "compact";
  setPlayerMode: (value: "complete" | "compact") => void;
  showToast: (value: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const restartRecognitionRef = useRef<(delay?: number) => void>(() => undefined);
  const listeningRef = useRef(false);
  const microphoneMutedRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const recognitionWatchdogRef = useRef<number | null>(null);
  const recognitionActivityAtRef = useRef(0);
  const batchTimerRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const idleLoopTimerRef = useRef<number | null>(null);
  const avatarRetryTimerRef = useRef<number | null>(null);
  const avatarRetryCountRef = useRef(0);
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

  const [avatar, setAvatar] = useState<AvatarId>("lia");
  const [avatarReady, setAvatarReady] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState("Conectando à Lia");
  const [avatarError, setAvatarError] = useState("");
  const [interimCaption, setInterimCaption] = useState("");
  const [lastCaption, setLastCaption] = useState("");
  const [microphoneName, setMicrophoneName] = useState("Microfone padrão");
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [stageZoom, setStageZoom] = useState(1);
  const [batches, setBatches] = useState<LiveBatch[]>([]);
  const [processedBatches, setProcessedBatches] = useState(0);
  const [roomName, setRoomName] = useState("Evento institucional 2026");
  const [backendStatus, setBackendStatus] = useState("Verificando histórico");
  const [widgetUrl] = useState(() => {
    const url = new URL(avatarWidgetBase);
    url.searchParams.set("avatar", "lia");
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
    setBatches([...active, ...pendingBatchesRef.current].slice(0, 4));
  };

  const sendToAvatar = (message: Record<string, unknown>) => {
    if (!avatarReadyRef.current || !frameRef.current?.contentWindow) return false;
    frameRef.current.contentWindow.postMessage(message, widgetOrigin);
    return true;
  };

  const clearIdleLoopTimer = () => {
    if (idleLoopTimerRef.current) window.clearTimeout(idleLoopTimerRef.current);
    idleLoopTimerRef.current = null;
  };

  const clearAvatarRetryTimer = () => {
    if (avatarRetryTimerRef.current) window.clearTimeout(avatarRetryTimerRef.current);
    avatarRetryTimerRef.current = null;
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
    avatarPlaybackStartedRef.current = false;
    setAvatarError("");
    setAvatarStatus(`Loop de espera · frase ${phraseIndex + 1} de ${recentPhrases.length}`);
    if (!sendToAvatar({ type: "neotalk:sign", phrase: phrase.glossText || phrase.text })) {
      idleLoopActiveRef.current = false;
      avatarBusyRef.current = false;
    }
  };

  const scheduleIdleLoop = (minimumDelay = LIVE_IDLE_LOOP_DELAY_MS) => {
    clearIdleLoopTimer();
    if (!listeningRef.current || activeBatchRef.current || pendingBatchesRef.current.length || wordBufferRef.current.length || !recentPhrasesRef.current.length) return;
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
    lastSpeechAtRef.current = Date.now();
    clearIdleLoopTimer();
    clearAvatarRetryTimer();
    avatarRetryCountRef.current = 0;
    avatarPlaybackStartedRef.current = false;
    if (idleLoopActiveRef.current) {
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
    avatarPlaybackStartedRef.current = false;
    refreshBatchView();
    setAvatarError("");
    setAvatarStatus("Enviando glosas para a Lia");
    if (!sendToAvatar({ type: "neotalk:sign", phrase: next.glossText })) {
      next.status = "ready";
      pendingBatchesRef.current.unshift(next);
      activeBatchRef.current = null;
      avatarBusyRef.current = false;
      refreshBatchView();
    }
  };

  const translateBatch = (batch: LiveBatch) => {
    if (batch.status !== "queued" || agentPromisesRef.current.has(batch.id)) return;
    batch.status = "translating";
    void updateRemoteBatch(batch.id, "translating");
    refreshBatchView();
    const request = retryUnprocessable(() => roomApi<AgentTranslation>("/agent/translate", {
      method: "POST",
      body: JSON.stringify({ text: batch.text, batch_id: remoteBatchIdsRef.current.get(batch.id) || null }),
    })).then((agent) => {
      batch.glossText = agent.gloss_text;
      batch.status = "ready";
      agentResultsRef.current.set(batch.id, agent);
      void updateRemoteBatch(batch.id, "translating");
    }).catch((reason) => {
      const message = reason instanceof Error ? reason.message : "O agente não conseguiu traduzir o lote.";
      batch.status = "error";
      if (!(reason instanceof RoomApiError) || reason.status !== 422) setAvatarError(message);
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
    avatarRetryCountRef.current = 0;
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
    if (avatarPlaybackStartedRef.current) return;
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
    setAvatarStatus("Reenviando sinais");
    if (!sendToAvatar({ type: "neotalk:sign", phrase: text })) releaseAvatarAfterRetryFailure();
    else scheduleAvatarRetry();
  };

  const scheduleAvatarRetry = () => {
    clearAvatarRetryTimer();
    if (avatarPlaybackStartedRef.current) return;
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
      ready: "Lia conectada",
      queued: "Lote recebido",
      processing: "Preparando sinais",
      loading_pose: "Carregando movimentos",
      playing: "Lia sinalizando",
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== widgetOrigin || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as AvatarMessage;

      if (data.type === "neotalk:ready") {
        avatarReadyRef.current = true;
        setAvatarReady(true);
        setAvatarError("");
        setAvatarStatus(`${avatarNames[avatar]} conectada`);
        window.setTimeout(dispatchNextBatch, 100);
      } else if (data.type === "neotalk:status" && data.status) {
        setAvatarStatus(statusLabels[data.status] || data.status);
      } else if (data.type === "neotalk:playing") {
        clearAvatarRetryTimer();
        avatarRetryCountRef.current = 0;
        avatarPlaybackStartedRef.current = true;
        setAvatarStatus(idleLoopActiveRef.current ? `${avatarNames[avatar]} mantendo a tradução ativa` : `${avatarNames[avatar]} sinalizando o lote atual`);
        const wordCount = Array.isArray(data.words) ? data.words.length : 4;
        if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = window.setTimeout(
          () => idleLoopActiveRef.current ? finishIdleLoopPhrase() : completeActiveBatch("done"),
          Math.max(2600, wordCount * 850),
        );
      } else if (data.type === "neotalk:error") {
        if (isRetryableAvatarError(data.message)) {
          setAvatarError("");
          if (!avatarPlaybackStartedRef.current) scheduleAvatarRetry();
          return;
        }
        if (isNonBlockingAvatarError(data.message)) {
          setAvatarError("");
          setAvatarStatus(idleLoopActiveRef.current ? `${avatarNames[avatar]} mantendo a tradução ativa` : `${avatarNames[avatar]} sinalizando o lote atual`);
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

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [avatar, widgetOrigin]);

  const selectAvatar = (value: AvatarId) => {
    setAvatar(value);
    if (sendToAvatar({ type: "neotalk:set-avatar", avatar: value })) setAvatarStatus("Trocando avatar");
  };

  const stopLiveRoom = () => {
    listeningRef.current = false;
    microphoneMutedRef.current = false;
    setMicrophoneMuted(false);
    clearIdleLoopTimer();
    clearAvatarRetryTimer();
    idleLoopActiveRef.current = false;
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
    recognitionWatchdogRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
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
    if (!SpeechRecognitionApi) {
      showToast("Use Chrome ou Edge para capturar e transcrever o microfone");
      return;
    }

    let createdRoomId: string | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      if (track?.label) setMicrophoneName(track.label);
      stream.getTracks().forEach((item) => item.stop());

      setBackendStatus("Criando sala");
      const room = await roomApi<RoomResponse>("/rooms", {
        method: "POST",
        body: JSON.stringify({ name: roomName.trim() || "Sala ao vivo", avatar }),
      });
      createdRoomId = room.id;
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

      const recognition = new SpeechRecognitionApi();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "pt-BR";
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
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          listeningRef.current = false;
          if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
          if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
          recognitionWatchdogRef.current = null;
          setRecording(false);
          showToast("Permita o acesso ao microfone para iniciar a sala");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          showToast("A captura de voz foi interrompida");
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
      recognitionActivityAtRef.current = Date.now();
      if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
      recognitionWatchdogRef.current = window.setInterval(() => {
        if (!listeningRef.current || microphoneMutedRef.current || Date.now() - recognitionActivityAtRef.current < 30000) return;
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
      setAvatarStatus(idleLoopActiveRef.current ? "Microfone mutado · loop ativo" : `${avatarNames[avatar]} aguardando em loop`);
      scheduleIdleLoop(0);
    } else {
      recognitionActivityAtRef.current = Date.now();
      restartRecognitionRef.current(0);
      setAvatarStatus("Microfone reativado");
    }
  };

  const adjustStageZoom = (delta: number) => {
    setStageZoom((value) => Math.min(1.5, Math.max(0.7, Math.round((value + delta) * 10) / 10)));
  };

  useEffect(() => () => {
    listeningRef.current = false;
    recognitionRef.current?.abort();
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    if (recognitionWatchdogRef.current) window.clearInterval(recognitionWatchdogRef.current);
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
    if (idleLoopTimerRef.current) window.clearTimeout(idleLoopTimerRef.current);
    if (avatarRetryTimerRef.current) window.clearTimeout(avatarRetryTimerRef.current);
  }, []);

  useEffect(() => {
    roomApi<{ status: string }>("/health")
      .then(() => setBackendStatus("Histórico conectado"))
      .catch(() => setBackendStatus("Backend indisponível"));
  }, []);

  const copyPlayerLink = async () => {
    try {
      await navigator.clipboard.writeText(widgetUrl);
      showToast("Link do player copiado");
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
        <div ref={stageRef} className={`live-stage ${playerMode}`} style={{ "--stage-zoom": stageZoom } as CSSProperties}>
          <iframe ref={frameRef} className="avatar-widget-frame" title="Avatar 3D NeoTalk" src={widgetUrl} allow="fullscreen" />
          <button className="exit-fullscreen" aria-label="Sair da tela cheia" onClick={() => void document.exitFullscreen()}>×</button>
          <div className="fullscreen-zoom" aria-label="Zoom da transmissão"><button aria-label="Diminuir zoom" onClick={() => adjustStageZoom(-0.1)}>−</button><button className="zoom-value" aria-label="Restaurar zoom para 100%" onClick={() => setStageZoom(1)}>{Math.round(stageZoom * 100)}%</button><button aria-label="Aumentar zoom" onClick={() => adjustStageZoom(0.1)}>+</button></div>
          <div className="stage-brand">neo<strong>talk</strong></div>
          <div className="live-captions" aria-live="polite">{recording ? (microphoneMuted ? (lastCaption || "Microfone mutado · mantendo a tradução em loop") : (interimCaption || lastCaption || "Ouvindo…")) : "Inicie a sala para capturar o microfone e gerar legendas."}</div>
          <span className="stage-language">PT → LIBRAS</span>
          {avatarError && <div className="avatar-error">{avatarError}</div>}
        </div>
        <div className="capture-controls"><div className={`audio-source ${recording && !microphoneMuted ? "listening" : ""} ${microphoneMuted ? "muted" : ""}`}><span>{microphoneMuted ? "×" : "⌁"}</span><div><small>{microphoneMuted ? "MICROFONE MUTADO" : recording ? "MICROFONE CAPTURANDO" : "ENTRADA DE ÁUDIO"}</small><b>{microphoneName}</b></div><span className="audio-level" aria-hidden="true"><i/><i/><i/><i/></span></div>{recording && <button className={`mute-button ${microphoneMuted ? "active" : ""}`} onClick={toggleMicrophone}>{microphoneMuted ? "Ativar microfone" : "Mutar microfone"}</button>}<button className={recording ? "record stop" : "record"} onClick={toggleRecording}><i />{recording ? "Encerrar sala" : "Iniciar sala ao vivo"}</button></div>
      </section>
      <aside className="studio-panel">
        <div className="panel-tabs"><button className="active">Sala</button><button>Legenda</button></div>
        <div className="config-block"><label>Nome da sala<input value={roomName} disabled={recording} onChange={(event) => setRoomName(event.target.value)} /></label><label>Avatar 3D<select value={avatar} disabled={recording} onChange={(event) => selectAvatar(event.target.value as AvatarId)}><option value="lia">Lia · NeoTalk</option><option value="asuna">Asuna · NeoTalk</option><option value="elia">Elia · NeoTalk</option></select></label><div className="avatar-choice"><div className="avatar-bust"><i/><i/></div><div><b>{avatarNames[avatar]}</b><small>Avatar da sala · Libras</small></div><span>{avatarReady ? "✓" : "…"}</span></div></div>
        <div className="config-block live-queue"><div className="block-title"><b>Fila de tradução</b><small>Frases contínuas · loop das 2 últimas na pausa · {processedBatches} concluídos</small><span className={`backend-state ${backendStatus.includes("conect") || backendStatus.includes("sincronizado") || backendStatus.includes("salva") ? "online" : ""}`}><i />{backendStatus}</span></div>{batches.length ? <div className="batch-list">{batches.map((batch) => <div className={`batch-item ${batch.status}`} key={batch.id}><span>{batch.status === "playing" ? "LIA" : batch.status === "translating" ? "GPT" : batch.status === "ready" ? "PRONTO" : "FILA"}</span><p>{batch.text}{batch.glossText && <small>GLOSAS · {batch.glossText}</small>}</p></div>)}</div> : <div className="queue-empty"><span>⌁</span><p>{recording ? "Ouvindo o primeiro trecho…" : "Os trechos falados aparecerão aqui."}</p></div>}</div>
        <div className="config-block"><div className="block-title"><b>Formato do player</b><small>Escolha como exibir a tradução.</small></div><div className="mode-options"><button className={playerMode === "complete" ? "selected" : ""} onClick={() => setPlayerMode("complete")}><i className="layout-complete" />Completo<small>Avatar + legenda</small></button><button className={playerMode === "compact" ? "selected" : ""} onClick={() => setPlayerMode("compact")}><i className="layout-compact" />Mini player<small>Flutuante</small></button></div></div>
        <div className="config-block"><div className="block-title"><b>Transmitir a sala</b><small>Abra o avatar em uma saída separada.</small></div><button className="output-button" onClick={() => { window.open(widgetUrl, "_blank", "noopener,noreferrer"); showToast("Player aberto em nova janela"); }}><span>↗</span><div><b>Abrir em nova janela</b><small>Ideal para compartilhar uma tela</small></div><i>→</i></button><button className="output-button" onClick={copyPlayerLink}><span>⌁</span><div><b>Copiar link do player</b><small>Use em OBS, navegador ou telão</small></div><i>→</i></button></div>
      </aside>
    </div>
  </>;
}
