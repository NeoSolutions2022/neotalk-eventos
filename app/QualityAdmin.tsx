"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isNonBlockingAvatarError } from "./avatarMessages";

type Prompt = { id: string; name: string; instructions: string; version: number; is_active: boolean; created_at: string };
type AvatarId = "lia" | "asuna" | "elia";
type Integrations = { neotalk_configured: boolean; openai_configured: boolean; openai_model: string; dataset_words: number; active_prompt?: { id: string; name: string; version: number } };
type QualityRun = {
  id: string;
  source_text: string;
  gloss_text: string;
  glosses: string[];
  missing_words: string[];
  prompt_id: string;
  model: string;
  agent_latency_ms: number;
  video_task_id?: string;
  video_url?: string;
  video_words: string[];
  status: string;
  error_message?: string;
  reasoning_summary?: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
const widgetBase = process.env.NEXT_PUBLIC_AVATAR_WIDGET_URL || "https://infra-avatar3d-oficial.k3p3ex.easypanel.host/widget";
const avatarNames: Record<AvatarId, string> = { lia: "Lia", asuna: "Asuna", elia: "Elia" };

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Falha da API (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export default function QualityAdmin({ showToast }: { showToast: (message: string) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const latestGlossRef = useRef("");
  const avatarLoopTimerRef = useRef<number | null>(null);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [instructions, setInstructions] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [wordSearch, setWordSearch] = useState("");
  const [phrase, setPhrase] = useState("Você é muito bonito e sua casa tem uma parede de barro.");
  const [run, setRun] = useState<QualityRun | null>(null);
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [avatarReady, setAvatarReady] = useState(false);
  const [avatar, setAvatar] = useState<AvatarId>("lia");
  const [avatarStatus, setAvatarStatus] = useState("Carregando avatar");
  const [rating, setRating] = useState(0);
  const widgetUrl = `${widgetBase}?avatar=lia&loop=0&background=%2310233f`;
  const widgetOrigin = new URL(widgetBase).origin;

  useEffect(() => {
    latestGlossRef.current = run?.gloss_text || "";
  }, [run?.gloss_text]);

  const clearAvatarLoop = () => {
    if (avatarLoopTimerRef.current) window.clearTimeout(avatarLoopTimerRef.current);
    avatarLoopTimerRef.current = null;
  };

  const loadAdmin = useCallback(async () => {
    const [integrationData, promptData, wordData] = await Promise.all([
      api<Integrations>("/admin/integrations"),
      api<Prompt[]>("/admin/prompts"),
      api<{ items: string[] }>(`/admin/pose-words?search=${encodeURIComponent(wordSearch)}&page_size=120`),
    ]);
    setIntegrations(integrationData);
    setPrompts(promptData);
    const active = promptData.find((item) => item.is_active);
    if (active) setInstructions(active.instructions);
    setWords(wordData.items);
  }, [wordSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAdmin().catch((reason) => setError(String(reason.message || reason)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAdmin]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== widgetOrigin || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; status?: string; message?: string; words?: unknown[] };
      if (data.type === "neotalk:ready") {
        setAvatarReady(true);
        setAvatarStatus(`${avatarNames[avatar]} pronta`);
      } else if (data.type === "neotalk:status" && data.status) {
        setAvatarStatus(data.status);
      } else if (data.type === "neotalk:playing") {
        setAvatarStatus(`${avatarNames[avatar]} sinalizando em loop`);
        clearAvatarLoop();
        const wordCount = Array.isArray(data.words) ? data.words.length : latestGlossRef.current.split(/\s+/).filter(Boolean).length;
        avatarLoopTimerRef.current = window.setTimeout(() => {
          const gloss = latestGlossRef.current;
          if (!gloss || !frameRef.current?.contentWindow) return;
          frameRef.current.contentWindow.postMessage({ type: "neotalk:sign", phrase: gloss }, widgetOrigin);
        }, Math.max(2800, wordCount * 850));
      } else if (data.type === "neotalk:error") {
        if (isNonBlockingAvatarError(data.message)) {
          setAvatarStatus(`${avatarNames[avatar]} sinalizando em loop`);
          return;
        }
        clearAvatarLoop();
        setAvatarStatus(data.message || "Erro no avatar");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [avatar, widgetOrigin]);

  useEffect(() => {
    if (!avatarReady || !frameRef.current?.contentWindow) return;
    clearAvatarLoop();
    const frameWindow = frameRef.current.contentWindow;
    frameWindow.postMessage({ type: "neotalk:set-avatar", avatar }, widgetOrigin);
    setAvatarStatus(`Trocando para ${avatarNames[avatar]}`);
    const timer = window.setTimeout(() => {
      if (latestGlossRef.current) frameWindow.postMessage({ type: "neotalk:sign", phrase: latestGlossRef.current }, widgetOrigin);
      else setAvatarStatus(`${avatarNames[avatar]} pronta`);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [avatar, avatarReady, widgetOrigin]);

  useEffect(() => {
    clearAvatarLoop();
    return clearAvatarLoop;
  }, [run?.id]);

  useEffect(() => {
    if (!run?.gloss_text || !avatarReady) return;
    frameRef.current?.contentWindow?.postMessage({ type: "neotalk:sign", phrase: run.gloss_text }, widgetOrigin);
  }, [run?.id, run?.gloss_text, avatarReady, widgetOrigin]);

  const runId = run?.id;
  const runStatus = run?.status;

  useEffect(() => {
    if (!runId || runStatus !== "video_processing") return;
    const timer = window.setInterval(() => {
      void api<QualityRun>(`/admin/quality-runs/${runId}`).then((latest) => {
        setRun(latest);
        if (latest.status !== "video_processing") window.clearInterval(timer);
      }).catch((reason) => {
        setError(reason.message);
        window.clearInterval(timer);
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [runId, runStatus]);

  const syncDataset = async () => {
    setSyncing(true);
    setError("");
    try {
      const result = await api<{ word_count: number }>("/admin/dataset/sync", { method: "POST" });
      showToast(`${result.word_count} palavras sincronizadas`);
      await loadAdmin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao sincronizar catálogo");
    } finally {
      setSyncing(false);
    }
  };

  const savePrompt = async () => {
    setError("");
    try {
      await api<Prompt>("/admin/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Tradutor Libras", instructions, activate: true }),
      });
      showToast("Nova versão do prompt ativada");
      await loadAdmin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao salvar prompt");
    }
  };

  const executeTest = async () => {
    setRunning(true);
    clearAvatarLoop();
    latestGlossRef.current = "";
    setRun(null);
    setRating(0);
    setError("");
    try {
      const result = await api<QualityRun>("/admin/quality-runs", {
        method: "POST",
        body: JSON.stringify({ text: phrase }),
      });
      setRun(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao executar o teste");
    } finally {
      setRunning(false);
    }
  };

  const rate = async (score: number) => {
    if (!run) return;
    setRating(score);
    try {
      await api(`/admin/quality-runs/${run.id}/ratings`, {
        method: "POST",
        body: JSON.stringify({ output: "comparison", score, notes: null }),
      });
      showToast("Avaliação registrada");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao avaliar");
    }
  };

  return <>
    <div className="page-heading quality-heading">
      <div><p className="eyebrow">QUALIDADE DE TRADUÇÃO</p><h1>Laboratório do agente</h1><p>Compare o vídeo de referência e os avatares usando exatamente as mesmas glosas.</p></div>
      <div className="integration-pills">
        <span className={integrations?.openai_configured ? "ok" : "warn"}>GPT {integrations?.openai_configured ? integrations.openai_model : "sem chave"}</span>
        <span className={integrations?.neotalk_configured ? "ok" : "warn"}>API NeoTalk</span>
        <span className={integrations?.dataset_words ? "ok" : "warn"}>{integrations?.dataset_words || 0} glosas</span>
      </div>
    </div>
    {error && <div className="quality-error">{error}</div>}
    <section className="quality-input-card">
      <label>Texto em português<textarea rows={3} value={phrase} onChange={(event) => setPhrase(event.target.value)} /></label>
      <button className="primary" disabled={running || !phrase.trim()} onClick={executeTest}>{running ? "Agente traduzindo…" : "Executar comparação"}</button>
      {run && <div className="gloss-result"><span>GLOSAS VALIDADAS</span><strong>{run.gloss_text}</strong><small>{run.model} · {run.agent_latency_ms} ms · tarefa {run.video_task_id || "vídeo indisponível"}</small></div>}
    </section>
    <div className="quality-layout">
      <div className="quality-main">
        <div className="compare-grid">
          <article className="quality-player"><div className="quality-player-title"><div><span>REFERÊNCIA</span><b>Última versão do vídeo</b></div><small>{run?.status === "ready" ? "Reprodução em loop" : run?.status === "video_error" ? "Erro" : run ? "Processando" : "Aguardando teste"}</small></div><div className="quality-media">{run?.video_url ? <video src={run.video_url} controls autoPlay loop><track kind="captions" /></video> : <div className="media-empty"><span>▶</span><p>{run?.error_message || "O vídeo gerado aparecerá aqui."}</p></div>}</div></article>
          <article className="quality-player"><div className="quality-player-title quality-avatar-title"><div><span>AVATAR</span><b>{avatarNames[avatar]} · widget oficial</b></div><div className="quality-avatar-controls"><select aria-label="Avatar para comparação" value={avatar} onChange={(event) => setAvatar(event.target.value as AvatarId)}><option value="lia">Lia</option><option value="asuna">Asuna</option><option value="elia">Elia</option></select><small>{avatarStatus}</small></div></div><div className="quality-media"><iframe ref={frameRef} src={widgetUrl} title={`${avatarNames[avatar]} para comparação de qualidade`} allow="fullscreen" /></div></article>
        </div>
        <div className="quality-rating"><div><b>Fidelidade geral</b><small>Avalie a comparação desta execução.</small></div><div>{[1,2,3,4,5].map((score) => <button key={score} className={rating >= score ? "selected" : ""} onClick={() => void rate(score)} disabled={!run}>★</button>)}</div></div>
      </div>
      <aside className="quality-sidebar">
        <section><div className="quality-section-title"><div><b>Prompt do agente</b><small>Editar cria e ativa uma nova versão.</small></div><span>v{integrations?.active_prompt?.version || "—"}</span></div><textarea rows={13} value={instructions} onChange={(event) => setInstructions(event.target.value)} /><button className="secondary wide" onClick={savePrompt} disabled={instructions.trim().length < 20}>Salvar e ativar versão</button><div className="prompt-history">{prompts.slice(0, 4).map((prompt) => <span key={prompt.id} className={prompt.is_active ? "active" : ""}>v{prompt.version} · {prompt.is_active ? "ativa" : new Date(prompt.created_at).toLocaleDateString("pt-BR")}</span>)}</div></section>
        <section><div className="quality-section-title"><div><b>Dataset .pose</b><small>Palavras autorizadas para o agente.</small></div><button className="link" onClick={syncDataset} disabled={syncing}>{syncing ? "Sincronizando…" : "Sincronizar"}</button></div><input placeholder="Buscar palavra" value={wordSearch} onChange={(event) => setWordSearch(event.target.value)} /><div className="word-cloud">{words.map((word) => <span key={word}>{word}</span>)}</div></section>
      </aside>
    </div>
  </>;
}
