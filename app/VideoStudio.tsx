"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "./apiClient";
import { isNonBlockingAvatarError } from "./avatarMessages";
import { avatarCaptureConstraints, avatarRecorderOptions, captureDetails, VideoFrameFormat, VideoQuality, videoFramePresets, videoQualityPresets } from "./avatarVideoQuality";

type AvatarId = "elia" | "lia" | "asuna";
type Translation = { gloss_text: string; skipped?: boolean; reason?: string };
type CroppableVideoTrack = MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> };
type Capture = {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  phrase: string;
  avatar: AvatarId;
  format: VideoFrameFormat;
  details: string;
  started: boolean;
  timer: number | null;
};

const widgetBase = process.env.NEXT_PUBLIC_AVATAR_WIDGET_URL || "https://infra-avatar3d-oficial.k3p3ex.easypanel.host/widget";
const widgetOrigin = new URL(widgetBase).origin;
const avatarNames: Record<AvatarId, string> = { elia: "Elia", lia: "Lia", asuna: "Asuna" };

export default function VideoStudio({ showToast }: { showToast: (message: string) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const captureRef = useRef<Capture | null>(null);
  const loopTimerRef = useRef<number | null>(null);
  const phraseRef = useRef("");
  const [text, setText] = useState("");
  const [gloss, setGloss] = useState("");
  const [avatar, setAvatar] = useState<AvatarId>("elia");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [quality, setQuality] = useState<VideoQuality>("high");
  const [format, setFormat] = useState<VideoFrameFormat>("landscape");
  const [status, setStatus] = useState("Carregando avatar 3D…");
  const [error, setError] = useState("");
  const widgetUrl = `${widgetBase}?avatar=elia&loop=0&background=%2310233f`;

  const clearLoop = () => {
    if (loopTimerRef.current !== null) window.clearTimeout(loopTimerRef.current);
    loopTimerRef.current = null;
  };

  const releaseCapture = useCallback((capture: Capture) => {
    if (capture.timer !== null) window.clearTimeout(capture.timer);
    capture.stream.getTracks().forEach((track) => track.stop());
    if (captureRef.current === capture) captureRef.current = null;
    setCapturing(false);
    setStageOpen(false);
  }, []);

  const stopCapture = useCallback(() => {
    const capture = captureRef.current;
    if (!capture) return;
    if (capture.recorder.state === "recording") capture.recorder.stop();
    else releaseCapture(capture);
  }, [releaseCapture]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== widgetOrigin || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; status?: string; message?: string; words?: unknown[] };
      if (data.type === "neotalk:ready") {
        setReady(true);
        setStatus(`${avatarNames[avatar]} pronta`);
      } else if (data.type === "neotalk:status" && data.status) {
        setStatus(data.status);
      } else if (data.type === "neotalk:playing") {
        setStatus(`${avatarNames[avatar]} sinalizando`);
        clearLoop();
        const words = Array.isArray(data.words) ? data.words.length : phraseRef.current.split(/\s+/).filter(Boolean).length;
        const capture = captureRef.current;
        if (capture && !capture.started && capture.phrase === phraseRef.current && capture.avatar === avatar) {
          capture.started = true;
          if (capture.timer !== null) window.clearTimeout(capture.timer);
          capture.recorder.start(250);
          setStatus(`Gravando · ${capture.details}`);
          capture.timer = window.setTimeout(stopCapture, Math.max(4500, Math.min(60000, words * 1600 + 1500)));
          return;
        }
        if (capture) return;
        loopTimerRef.current = window.setTimeout(() => {
          if (phraseRef.current) frameRef.current?.contentWindow?.postMessage({ type: "neotalk:sign", phrase: phraseRef.current }, widgetOrigin);
        }, Math.max(2800, words * 850));
      } else if (data.type === "neotalk:error" && !isNonBlockingAvatarError(data.message)) {
        if (captureRef.current) return;
        setStatus(data.message || "O avatar não pôde executar este sinal.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [avatar, stopCapture]);

  useEffect(() => {
    if (!ready) return;
    clearLoop();
    const frame = frameRef.current?.contentWindow;
    frame?.postMessage({ type: "neotalk:set-avatar", avatar }, widgetOrigin);
    const timer = window.setTimeout(() => {
      if (phraseRef.current) frame?.postMessage({ type: "neotalk:sign", phrase: phraseRef.current }, widgetOrigin);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [avatar, ready]);

  useEffect(() => {
    return () => {
      if (loopTimerRef.current !== null) window.clearTimeout(loopTimerRef.current);
      const capture = captureRef.current;
      if (!capture) return;
      capture.recorder.onstop = null;
      if (capture.recorder.state === "recording") capture.recorder.stop();
      if (capture.timer !== null) window.clearTimeout(capture.timer);
      capture.stream.getTracks().forEach((track) => track.stop());
      captureRef.current = null;
    };
  }, []);

  const translate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy || capturing) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<Translation>("/agent/translate", { method: "POST", body: JSON.stringify({ text: text.trim() }) });
      if (result.skipped || !result.gloss_text.trim()) {
        throw new Error(result.reason || "A frase não gerou glosas disponíveis no catálogo.");
      }
      phraseRef.current = result.gloss_text;
      setGloss(result.gloss_text);
      clearLoop();
      frameRef.current?.contentWindow?.postMessage({ type: "neotalk:sign", phrase: result.gloss_text }, widgetOrigin);
    } catch (reason) {
      setError(reason instanceof ApiError || reason instanceof Error ? reason.message : "Não foi possível traduzir a frase.");
    } finally {
      setBusy(false);
    }
  };

  const captureVideo = async () => {
    if (capturing || !stageOpen || !gloss || !ready || !frameRef.current?.contentWindow) return;
    const bounds = frameRef.current.getBoundingClientRect();
    const minimum = videoFramePresets[format];
    if (bounds.width < minimum.minWidth || bounds.height < minimum.minHeight) {
      setError("A área de gravação está pequena. Maximize o navegador e tente novamente.");
      return;
    }
    setCapturing(true);
    setError("");
    setStatus("Selecione esta aba para compartilhar.");
    let stream: MediaStream | null = null;
    try {
      const cropTarget = (window as Window & { CropTarget?: { fromElement: (element: Element) => Promise<unknown> } }).CropTarget;
      if (!navigator.mediaDevices?.getDisplayMedia || !cropTarget?.fromElement || typeof MediaRecorder === "undefined") {
        throw new Error("A gravação requer Chrome, Edge ou Brave atualizado no computador.");
      }
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Este navegador não consegue gravar vídeo WebM.");
      const target = await cropTarget.fromElement(frameRef.current);
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: avatarCaptureConstraints(quality), audio: false, preferCurrentTab: true, selfBrowserSurface: "include",
      } as DisplayMediaStreamOptions);
      const track = stream.getVideoTracks()[0] as CroppableVideoTrack | undefined;
      if (!track?.cropTo) throw new Error("Selecione esta aba do navegador para gravar somente o avatar.");
      await track.cropTo(target);
      track.contentHint = "motion";
      const recorder = new MediaRecorder(stream, avatarRecorderOptions(quality, mimeType));
      const capture: Capture = {
        stream, recorder, chunks: [], phrase: gloss, avatar, format,
        details: captureDetails(track.getSettings(), recorder.videoBitsPerSecond),
        started: false, timer: null,
      };
      captureRef.current = capture;
      recorder.ondataavailable = (event) => { if (event.data.size) capture.chunks.push(event.data); };
      recorder.onerror = () => {
        recorder.onstop = null;
        setError("A gravação foi interrompida.");
        releaseCapture(capture);
      };
      recorder.onstop = () => {
        if (capture.chunks.length) {
          const url = URL.createObjectURL(new Blob(capture.chunks, { type: mimeType }));
          const link = document.createElement("a");
          link.href = url;
          link.download = `neotalk-${capture.avatar}-${capture.format}-${Date.now()}.webm`;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 60000);
          showToast("Vídeo do avatar baixado");
        } else {
          setError("A gravação terminou sem quadros de vídeo. Tente novamente.");
        }
        releaseCapture(capture);
        setStatus(capture.chunks.length ? `Vídeo salvo · ${capture.details}` : "Gravação vazia");
        if (phraseRef.current === capture.phrase) frameRef.current?.contentWindow?.postMessage({ type: "neotalk:sign", phrase: capture.phrase }, widgetOrigin);
      };
      track.addEventListener("ended", () => {
        if (recorder.state === "recording") recorder.stop();
        else releaseCapture(capture);
      }, { once: true });
      clearLoop();
      capture.timer = window.setTimeout(() => {
        setError("O avatar não iniciou a sinalização a tempo. Tente novamente.");
        releaseCapture(capture);
      }, 20000);
      frameRef.current.contentWindow.postMessage({ type: "neotalk:sign", phrase: capture.phrase }, widgetOrigin);
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      setCapturing(false);
      if (reason instanceof DOMException && reason.name === "NotAllowedError") {
        setStatus("Compartilhamento cancelado.");
        return;
      }
      setError(reason instanceof Error ? reason.message : "Não foi possível gravar o vídeo.");
    }
  };

  return <>
    <div className="page-heading"><div><p className="eyebrow">VÍDEO EM LIBRAS</p><h1>Crie um vídeo com o avatar</h1><p>Digite uma frase, confira a sinalização e baixe o vídeo no formato da sua publicação.</p></div></div>
    {error && <div className="quality-error" role="alert">{error}</div>}
    <div className="video-studio-grid">
      <form className="video-studio-card" onSubmit={(event) => void translate(event)}>
        <span className="eyebrow">01 · TEXTO</span>
        <h2>O que o avatar vai sinalizar?</h2>
        <label>Texto em português<textarea rows={5} maxLength={2000} required value={text} onChange={(event) => setText(event.target.value)} placeholder="Digite a frase do seu vídeo…" /></label>
        <button type="submit" className="primary" disabled={busy || capturing || !text.trim()}>{busy ? "Traduzindo…" : "Gerar sinalização"}</button>
        {gloss && <div className="gloss-result"><span>GLOSAS</span><strong>{gloss}</strong></div>}
        <p className="video-studio-note">Nesta versão, o vídeo é criado a partir de texto. Envio de um arquivo de vídeo original ficará para uma próxima etapa.</p>
      </form>
      <section className={`video-studio-card video-export-player${stageOpen ? " quality-recording-stage" : ""}`} style={{ "--capture-ratio": videoFramePresets[format].ratio } as React.CSSProperties}>
        <div className="quality-player-title quality-avatar-title"><div><span>02 · AVATAR</span><b>Prévia do vídeo</b></div><div className="quality-avatar-controls"><select aria-label="Avatar do vídeo" value={avatar} onChange={(event) => setAvatar(event.target.value as AvatarId)} disabled={capturing}><option value="elia">Elia</option><option value="lia">Lia</option><option value="asuna">Asuna</option></select><small>{status}</small></div></div>
        <div className="quality-media"><iframe ref={frameRef} src={widgetUrl} title="Prévia do avatar para vídeo" allow="fullscreen" /></div>
        <div className="quality-export">
          <label className="quality-export-quality">Formato
            <select value={format} disabled={capturing} onChange={(event) => setFormat(event.target.value as VideoFrameFormat)}>{Object.entries(videoFramePresets).map(([id, option]) => <option key={id} value={id}>{option.label}</option>)}</select>
          </label>
          <label className="quality-export-quality">Qualidade
            <select value={quality} disabled={capturing} onChange={(event) => setQuality(event.target.value as VideoQuality)}>{Object.entries(videoQualityPresets).map(([id, option]) => <option key={id} value={id}>{option.label} · {option.bitrate / 1_000_000} Mbps</option>)}</select>
          </label>
          {!stageOpen && <button className="secondary" type="button" disabled={!gloss || !ready} onClick={() => setStageOpen(true)}>Preparar vídeo</button>}
          {stageOpen && !capturing && <button className="primary" type="button" onClick={() => void captureVideo()}>Gravar vídeo</button>}
          {stageOpen && <button className="secondary" type="button" onClick={() => capturing ? stopCapture() : setStageOpen(false)}>{capturing ? "Encerrar gravação" : "Voltar"}</button>}
          <small className="quality-export-hint">{stageOpen ? "Confira o enquadramento, maximize a janela e escolha esta aba ao compartilhar." : "A gravação é experimental e baixa um arquivo WebM sem áudio."}</small>
        </div>
      </section>
    </div>
  </>;
}
