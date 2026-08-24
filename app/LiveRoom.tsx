"use client";

import { useEffect, useRef, useState } from "react";

type AvatarId = "lia" | "asuna";
type LiveBatch = { id: number; text: string; status: "queued" | "translating" | "done" | "error" };
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

const avatarWidgetBase = process.env.NEXT_PUBLIC_AVATAR_WIDGET_URL || "http://localhost:8080/widget";
const liveRoomsApiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

async function roomApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${liveRoomsApiBase}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) throw new Error(`Falha da API (${response.status})`);
  return response.json() as Promise<T>;
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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const batchTimerRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const wordBufferRef = useRef<string[]>([]);
  const pendingBatchesRef = useRef<LiveBatch[]>([]);
  const activeBatchRef = useRef<LiveBatch | null>(null);
  const avatarReadyRef = useRef(false);
  const avatarBusyRef = useRef(false);
  const batchIdRef = useRef(0);
  const roomIdRef = useRef<string | null>(null);
  const roomStartedAtRef = useRef<number | null>(null);
  const remoteBatchIdsRef = useRef(new Map<number, string>());
  const desiredBatchStatusRef = useRef(new Map<number, LiveBatch["status"]>());

  const [avatar, setAvatar] = useState<AvatarId>("lia");
  const [avatarReady, setAvatarReady] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState("Conectando à Lia");
  const [avatarError, setAvatarError] = useState("");
  const [interimCaption, setInterimCaption] = useState("");
  const [lastCaption, setLastCaption] = useState("");
  const [microphoneName, setMicrophoneName] = useState("Microfone padrão");
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

  const updateRemoteBatch = async (localId: number, status: LiveBatch["status"], errorMessage?: string) => {
    desiredBatchStatusRef.current.set(localId, status);
    const remoteId = remoteBatchIdsRef.current.get(localId);
    if (!remoteId) return;
    try {
      await roomApi<BatchResponse>(`/batches/${remoteId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, error_message: errorMessage || null }),
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

  const dispatchNextBatch = () => {
    if (!avatarReadyRef.current || avatarBusyRef.current || !pendingBatchesRef.current.length) return;
    const next = pendingBatchesRef.current.shift();
    if (!next) return;
    next.status = "translating";
    void updateRemoteBatch(next.id, "translating");
    activeBatchRef.current = next;
    avatarBusyRef.current = true;
    refreshBatchView();
    setAvatarError("");
    setAvatarStatus("Enviando lote para a Lia");
    if (!sendToAvatar({ type: "neotalk:sign", phrase: next.text })) {
      next.status = "queued";
      pendingBatchesRef.current.unshift(next);
      activeBatchRef.current = null;
      avatarBusyRef.current = false;
      refreshBatchView();
    }
  };

  const completeActiveBatch = (status: "done" | "error") => {
    if (!activeBatchRef.current) return;
    const completedBatch = activeBatchRef.current;
    completedBatch.status = status;
    void updateRemoteBatch(completedBatch.id, status, status === "error" ? "O widget não conseguiu traduzir o lote." : undefined);
    if (status === "done") setProcessedBatches((value) => value + 1);
    activeBatchRef.current = null;
    avatarBusyRef.current = false;
    refreshBatchView();
    if (status === "done") window.setTimeout(dispatchNextBatch, 250);
  };

  const enqueueBatch = (text: string) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    const batch: LiveBatch = { id: ++batchIdRef.current, text: normalized, status: "queued" };
    pendingBatchesRef.current.push(batch);
    desiredBatchStatusRef.current.set(batch.id, "queued");
    void persistBatch(batch);
    refreshBatchView();
    dispatchNextBatch();
  };

  const flushWordBuffer = () => {
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    batchTimerRef.current = null;
    if (!wordBufferRef.current.length) return;
    enqueueBatch(wordBufferRef.current.splice(0).join(" "));
  };

  const addTranscriptToBuffer = (text: string) => {
    wordBufferRef.current.push(...text.split(/\s+/).filter(Boolean));
    while (wordBufferRef.current.length >= 12) {
      enqueueBatch(wordBufferRef.current.splice(0, 12).join(" "));
    }
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    batchTimerRef.current = window.setTimeout(flushWordBuffer, 1400);
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
        setAvatarStatus(`${avatar === "lia" ? "Lia" : "Asuna"} conectada`);
        window.setTimeout(dispatchNextBatch, 200);
      } else if (data.type === "neotalk:status" && data.status) {
        setAvatarStatus(statusLabels[data.status] || data.status);
      } else if (data.type === "neotalk:playing") {
        setAvatarStatus("Lia sinalizando o lote atual");
        const wordCount = Array.isArray(data.words) ? data.words.length : 4;
        if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = window.setTimeout(() => completeActiveBatch("done"), Math.max(2600, wordCount * 850));
      } else if (data.type === "neotalk:error") {
        avatarReadyRef.current = false;
        setAvatarReady(false);
        setAvatarError(data.message || "Não foi possível traduzir o lote atual.");
        setAvatarStatus("Fila pausada");
        completeActiveBatch("error");
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
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setInterimCaption("");
    flushWordBuffer();
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
      setBackendStatus("Sala conectada ao histórico");

      const recognition = new SpeechRecognitionApi();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "pt-BR";
      recognition.onresult = (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript?.trim() || "";
          if (!transcript) continue;
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
          setRecording(false);
          showToast("Permita o acesso ao microfone para iniciar a sala");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          showToast("A captura de voz foi interrompida");
        }
      };
      recognition.onend = () => {
        if (!listeningRef.current) return;
        restartTimerRef.current = window.setTimeout(() => {
          try { recognition.start(); } catch { /* o navegador ainda está encerrando a sessão anterior */ }
        }, 250);
      };

      recognitionRef.current = recognition;
      listeningRef.current = true;
      setRecording(true);
      recognition.start();
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

  useEffect(() => () => {
    listeningRef.current = false;
    recognitionRef.current?.abort();
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    if (batchTimerRef.current) window.clearTimeout(batchTimerRef.current);
    if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
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
      <div><button className="back">←</button><div><p className="eyebrow">TRADUÇÃO EM TEMPO REAL</p><h1>Sala ao vivo</h1></div></div>
      <div className="studio-status"><span className={recording ? "pill live" : "pill"}><i className="status-dot" />{recording ? `AO VIVO · ${time}` : "SALA PRONTA"}</span><button className="secondary" onClick={() => showToast("Configuração da sala salva")}>Salvar sala</button></div>
    </div>
    <div className="studio-grid">
      <section className="stage-card">
        <div className="stage-toolbar"><div><span className={recording ? "tag live-tag" : "tag"}>{recording ? "AO VIVO" : "PRÉVIA"}</span><b>Sala · {roomName || "Sem nome"}</b><span className={`avatar-health ${avatarReady ? "connected" : ""}`}><i />{avatarStatus}</span></div><button aria-label="Exibir player em tela cheia" onClick={() => frameRef.current?.requestFullscreen()}>⛶</button></div>
        <div className={`live-stage ${playerMode}`}>
          <iframe ref={frameRef} className="avatar-widget-frame" title="Avatar 3D NeoTalk" src={widgetUrl} allow="fullscreen" />
          <div className="stage-brand">neo<strong>talk</strong></div>
          <div className="live-captions" aria-live="polite">{recording ? (interimCaption || lastCaption || "Ouvindo…") : "Inicie a sala para capturar o microfone e gerar legendas."}</div>
          <span className="stage-language">PT → LIBRAS</span>
          {avatarError && <div className="avatar-error">{avatarError}</div>}
        </div>
        <div className="capture-controls"><div className={`audio-source ${recording ? "listening" : ""}`}><span>⌁</span><div><small>{recording ? "MICROFONE CAPTURANDO" : "ENTRADA DE ÁUDIO"}</small><b>{microphoneName}</b></div><span className="audio-level" aria-hidden="true"><i/><i/><i/><i/></span></div><button className={recording ? "record stop" : "record"} onClick={toggleRecording}><i />{recording ? "Encerrar sala" : "Iniciar sala ao vivo"}</button></div>
      </section>
      <aside className="studio-panel">
        <div className="panel-tabs"><button className="active">Sala</button><button>Legenda</button></div>
        <div className="config-block"><label>Nome da sala<input value={roomName} disabled={recording} onChange={(event) => setRoomName(event.target.value)} /></label><label>Avatar 3D<select value={avatar} disabled={recording} onChange={(event) => selectAvatar(event.target.value as AvatarId)}><option value="lia">Lia · NeoTalk</option><option value="asuna">Asuna · NeoTalk</option></select></label><div className="avatar-choice"><div className="avatar-bust"><i/><i/></div><div><b>{avatar === "lia" ? "Lia" : "Asuna"}</b><small>Avatar da sala · Libras</small></div><span>{avatarReady ? "✓" : "…"}</span></div></div>
        <div className="config-block live-queue"><div className="block-title"><b>Fila de tradução</b><small>Lotes de até 12 palavras · {processedBatches} concluídos</small><span className={`backend-state ${backendStatus.includes("conect") || backendStatus.includes("sincronizado") || backendStatus.includes("salva") ? "online" : ""}`}><i />{backendStatus}</span></div>{batches.length ? <div className="batch-list">{batches.map((batch) => <div className={`batch-item ${batch.status}`} key={batch.id}><span>{batch.status === "translating" ? "LIA" : "FILA"}</span><p>{batch.text}</p></div>)}</div> : <div className="queue-empty"><span>⌁</span><p>{recording ? "Ouvindo o primeiro trecho…" : "Os trechos falados aparecerão aqui."}</p></div>}</div>
        <div className="config-block"><div className="block-title"><b>Formato do player</b><small>Escolha como exibir a tradução.</small></div><div className="mode-options"><button className={playerMode === "complete" ? "selected" : ""} onClick={() => setPlayerMode("complete")}><i className="layout-complete" />Completo<small>Avatar + legenda</small></button><button className={playerMode === "compact" ? "selected" : ""} onClick={() => setPlayerMode("compact")}><i className="layout-compact" />Mini player<small>Flutuante</small></button></div></div>
        <div className="config-block"><div className="block-title"><b>Transmitir a sala</b><small>Abra o avatar em uma saída separada.</small></div><button className="output-button" onClick={() => { window.open(widgetUrl, "_blank", "noopener,noreferrer"); showToast("Player aberto em nova janela"); }}><span>↗</span><div><b>Abrir em nova janela</b><small>Ideal para compartilhar uma tela</small></div><i>→</i></button><button className="output-button" onClick={copyPlayerLink}><span>⌁</span><div><b>Copiar link do player</b><small>Use em OBS, navegador ou telão</small></div><i>→</i></button></div>
      </aside>
    </div>
  </>;
}
