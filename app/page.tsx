"use client";

import { useEffect, useRef, useState } from "react";
import LiveRoom from "./LiveRoom";

type View = "dashboard" | "instances" | "packages" | "billing" | "studio" | "login" | "register";
type AvatarId = "lia" | "asuna";

const avatarWidgetBase = process.env.NEXT_PUBLIC_AVATAR_WIDGET_URL || "http://localhost:8080/widget";

const nav = [
  { id: "dashboard" as View, icon: "⌂", label: "Visão geral" },
  { id: "instances" as View, icon: "◉", label: "Salas ao vivo" },
  { id: "packages" as View, icon: "◷", label: "Pacotes e uso" },
  { id: "billing" as View, icon: "▣", label: "Pagamento" },
];

const instances = [
  { name: "Congresso Inova 2026", date: "Hoje, 09:42", duration: "01h 24min", status: "Finalizada" },
  { name: "Treinamento de segurança", date: "12 ago, 14:10", duration: "00h 48min", status: "Finalizada" },
  { name: "Assembleia mensal", date: "08 ago, 18:30", duration: "02h 06min", status: "Finalizada" },
];

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [playerMode, setPlayerMode] = useState<"complete" | "compact">("complete");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string) => setToast(message);
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (view === "login" || view === "register") {
    const isLogin = view === "login";
    return (
      <main className="auth-shell">
        <section className="auth-brand">
          <Logo />
          <div className="auth-message">
            <span className="eyebrow light">ACESSIBILIDADE EM TEMPO REAL</span>
            <h1>Comunicação que inclui todo mundo.</h1>
            <p>Gerencie traduções em Libras, acompanhe seu saldo de horas e transmita seu avatar onde precisar.</p>
          </div>
          <div className="caption-demo"><span className="live-dot" /> Tradução preparada para começar</div>
        </section>
        <section className="auth-panel">
          <form className="auth-card" onSubmit={(e) => { e.preventDefault(); setView("dashboard"); }}>
            <span className="mobile-logo"><Logo dark /></span>
            <p className="eyebrow">NEOTALK EVENTOS</p>
            <h2>{isLogin ? "Que bom ter você de volta" : "Crie sua conta"}</h2>
            <p className="muted">{isLogin ? "Acesse sua central de traduções." : "Comece a transmitir acessibilidade em poucos passos."}</p>
            {!isLogin && <label>Nome completo<input defaultValue="Marina Almeida" /></label>}
            <label>E-mail<input type="email" defaultValue="marina@empresa.com.br" /></label>
            <label>Senha<input type="password" defaultValue="neotalk123" /></label>
            {isLogin && <div className="form-row"><label className="check"><input type="checkbox" defaultChecked /> Lembrar de mim</label><button type="button" className="link">Esqueci a senha</button></div>}
            <button className="primary wide" type="submit">{isLogin ? "Entrar na plataforma" : "Criar minha conta"}<span>→</span></button>
            <div className="switch-auth">{isLogin ? "Ainda não tem uma conta?" : "Já possui uma conta?"}<button type="button" className="link" onClick={() => setView(isLogin ? "register" : "login")}>{isLogin ? "Criar conta" : "Entrar"}</button></div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav>
          <span className="nav-title">MENU</span>
          {nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">?</span><strong>Precisa de ajuda?</strong><small>Fale com nosso time</small><button onClick={() => showToast("Atendimento solicitado")}>Abrir atendimento</button></div>
          <button className="logout" onClick={() => setView("login")}><span>↗</span> Sair</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu">☰</button>
          <div className="breadcrumbs"><span>NeoTalk</span><b>/</b>{view === "studio" ? "Estúdio ao vivo" : nav.find((item) => item.id === view)?.label}</div>
          <div className="top-actions"><button className="icon-button">♢<i>2</i></button><div className="profile"><div className="avatar-initials">MA</div><div><strong>Marina Almeida</strong><small>Empresa Aurora</small></div><span>⌄</span></div></div>
        </header>
        <div className="content">
          {view === "dashboard" && <Dashboard onCreate={() => setView("studio")} onViewAll={() => setView("instances")} />}
          {view === "instances" && <Instances onCreate={() => setView("studio")} />}
          {view === "packages" && <Packages onBuy={() => setView("billing")} />}
          {view === "billing" && <Billing onSave={() => showToast("Dados de pagamento atualizados")} />}
          {view === "studio" && <LiveRoom recording={recording} setRecording={setRecording} time={time} playerMode={playerMode} setPlayerMode={setPlayerMode} showToast={showToast} />}
        </div>
      </section>
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Logo({ dark = false }: { dark?: boolean }) {
  return <div className={`logo ${dark ? "dark" : ""}`}><img src="/neotalk-logo.png" alt="NeoTalk" /><small>EVENTOS</small></div>;
}

function Dashboard({ onCreate, onViewAll }: { onCreate: () => void; onViewAll: () => void }) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">SEXTA-FEIRA, 14 DE AGOSTO</p><h1>Olá, Marina <span>👋</span></h1><p>Veja como está o uso da sua conta e continue traduzindo.</p></div><button className="primary" onClick={onCreate}><span>＋</span> Criar sala ao vivo</button></div>
    <section className="summary-grid">
      <article className="balance-card"><div className="card-top"><span className="card-icon lime">◷</span><span className="pill good">Saldo disponível</span></div><div><strong>12h <small>35min</small></strong><p>de 20 horas contratadas</p></div><div className="progress"><i style={{ width: "63%" }} /></div><div className="progress-label"><span>63% disponível</span><span>7h 25min utilizadas</span></div></article>
      <article className="stat-card"><span className="card-icon sky">◉</span><div><p>Traduções realizadas</p><strong>18</strong><small><b>↗ 12%</b> nos últimos 30 dias</small></div></article>
      <article className="stat-card"><span className="card-icon purple">⌁</span><div><p>Tempo transmitido</p><strong>7h 25min</strong><small>este mês</small></div></article>
    </section>
    <section className="quick-section"><div className="section-title"><div><h2>Tradução em tempo real</h2><p>Abra uma sala e comece a falar.</p></div></div><div className="quick-card"><div className="quick-copy"><span className="step-number">01</span><div><h3>Nova sala de tradução</h3><p>Capture o microfone, gere legendas ao vivo e envie cada trecho falado para a Lia.</p><div className="features"><span>✓ Microfone em tempo real</span><span>✓ Lia 3D integrada</span><span>✓ Frases enviadas em lotes</span></div><button className="primary" onClick={onCreate}>Criar sala ao vivo <span>→</span></button></div></div><div className="mini-stage"><div className="stage-top"><span><i /> AO VIVO</span><small>00:42:18</small></div><div className="figure"><i className="head" /><i className="body" /><i className="hand left" /><i className="hand right" /></div><div className="fake-caption">Bem-vindos ao nosso evento.<br />É um prazer ter vocês aqui.</div></div></div></section>
    <section className="history"><div className="section-title"><div><h2>Salas recentes</h2><p>Últimas transmissões ao vivo da sua equipe.</p></div><button className="secondary" onClick={onViewAll}>Ver todas →</button></div><div className="table"><div className="table-head"><span>SALA</span><span>DATA</span><span>DURAÇÃO</span><span>STATUS</span><span /></div>{instances.map((item) => <div className="table-row" key={item.name}><span><i className="row-icon">◉</i><b>{item.name}</b></span><span>{item.date}</span><span>{item.duration}</span><span><i className="status-dot" />{item.status}</span><button>•••</button></div>)}</div></section>
  </>;
}

function Instances({ onCreate }: { onCreate: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">TRANSMISSÕES</p><h1>Salas ao vivo</h1><p>Crie uma sala, capture o microfone e acompanhe as sessões realizadas.</p></div><button className="primary" onClick={onCreate}>＋ Criar sala ao vivo</button></div><div className="filter-bar"><div className="search">⌕ <input placeholder="Buscar sala..." /></div><button className="secondary">Todas as datas ⌄</button><button className="secondary">Todos os status ⌄</button></div><div className="instance-grid">{[...instances, { name: "Workshop de liderança", date: "02 ago, 08:00", duration: "01h 35min", status: "Finalizada" }].map((item, index) => <article className="instance-card" key={item.name}><div className="instance-cover"><span className="instance-number">0{index + 1}</span><div className="tiny-figure"><i/><i/></div><span className="pill good"><i className="status-dot" /> {item.status}</span></div><h3>{item.name}</h3><p>{item.date}</p><div className="instance-meta"><span>◷ {item.duration}</span><span>CC Legendas</span></div><button className="secondary wide">Ver detalhes</button></article>)}</div></>;
}

function Packages({ onBuy }: { onBuy: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">CONSUMO</p><h1>Pacotes e uso</h1><p>Acompanhe seu saldo e escolha o pacote ideal para o próximo evento.</p></div></div><div className="usage-banner"><div><span className="card-icon lime">◷</span><div><p>Saldo atual</p><strong>12h 35min</strong><small>Renovação em 01 de setembro</small></div></div><div className="usage-chart"><span><i style={{height:"32%"}} />SEG</span><span><i style={{height:"55%"}} />TER</span><span><i style={{height:"40%"}} />QUA</span><span><i style={{height:"76%"}} />QUI</span><span><i style={{height:"48%"}} />SEX</span><span><i style={{height:"18%"}} />SÁB</span><span><i style={{height:"10%"}} />DOM</span></div></div><div className="section-title plans-title"><div><h2>Adicione mais horas</h2><p>As horas ficam disponíveis assim que o pagamento for confirmado.</p></div></div><div className="plans"><article><span className="plan-label">ESSENCIAL</span><h3>5 horas</h3><p>Para reuniões e eventos pontuais.</p><strong>R$ 490<small> pagamento único</small></strong><button className="secondary wide" onClick={onBuy}>Selecionar pacote</button></article><article className="featured"><span className="popular">MAIS ESCOLHIDO</span><span className="plan-label">PROFISSIONAL</span><h3>20 horas</h3><p>Para equipes com agenda frequente.</p><strong>R$ 1.590<small> pagamento único</small></strong><button className="primary wide" onClick={onBuy}>Selecionar pacote</button></article><article><span className="plan-label">EVENTOS</span><h3>50 horas</h3><p>Para grandes eventos e transmissões.</p><strong>R$ 3.490<small> pagamento único</small></strong><button className="secondary wide" onClick={onBuy}>Selecionar pacote</button></article></div></>;
}

function Billing({ onSave }: { onSave: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">CONTA</p><h1>Pagamento</h1><p>Mantenha os dados de cobrança e o método de pagamento atualizados.</p></div></div><div className="billing-grid"><section className="form-card"><div className="section-title"><div><h2>Dados de cobrança</h2><p>Informações utilizadas nos seus comprovantes.</p></div><span className="secure">● Ambiente seguro</span></div><div className="form-grid"><label className="full">Razão social<input defaultValue="Aurora Eventos e Tecnologia LTDA" /></label><label>CNPJ<input defaultValue="12.345.678/0001-90" /></label><label>Telefone<input defaultValue="(85) 99999-4400" /></label><label className="full">Endereço<input defaultValue="Av. Desembargador Moreira, 1800" /></label><label>Cidade<input defaultValue="Fortaleza" /></label><label>Estado<select defaultValue="CE"><option>CE</option><option>SP</option></select></label></div><hr/><div className="section-title"><div><h2>Método de pagamento</h2><p>Cartão principal para novas compras.</p></div></div><div className="credit-card"><span>neo<strong>talk</strong></span><i>•••• •••• •••• 8240</i><div><small>MARINA ALMEIDA</small><small>08/29</small></div></div><div className="form-grid"><label className="full">Número do cartão<input defaultValue="•••• •••• •••• 8240" /></label><label>Validade<input defaultValue="08/29" /></label><label>Código de segurança<input defaultValue="•••" /></label></div><button className="primary" onClick={onSave}>Salvar alterações</button></section><aside className="billing-side"><h3>Resumo da conta</h3><div><span>Plano atual</span><b>Profissional · 20h</b></div><div><span>Próxima renovação</span><b>01 set 2026</b></div><div><span>Saldo disponível</span><b className="green">12h 35min</b></div><hr/><p>Seus dados são protegidos e usados somente para processar compras e emitir comprovantes.</p><button className="link">Ver histórico de pagamentos →</button></aside></div></>;
}

function Studio({ recording, setRecording, time, playerMode, setPlayerMode, showToast }: { recording: boolean; setRecording: (value: boolean) => void; time: string; playerMode: "complete" | "compact"; setPlayerMode: (value: "complete" | "compact") => void; showToast: (value: string) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [avatar, setAvatar] = useState<AvatarId>("lia");
  const [avatarReady, setAvatarReady] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState("Conectando ao avatar");
  const [avatarError, setAvatarError] = useState("");
  const [phrase, setPhrase] = useState("É uma satisfação receber todos vocês. Hoje vamos falar sobre acessibilidade.");
  const [widgetUrl] = useState(() => {
    const url = new URL(avatarWidgetBase);
    url.searchParams.set("avatar", "lia");
    url.searchParams.set("loop", "1");
    url.searchParams.set("background", "#10233f");
    return url.toString();
  });
  const widgetOrigin = new URL(avatarWidgetBase).origin;

  const sendToAvatar = (message: Record<string, unknown>) => {
    if (!avatarReady || !frameRef.current?.contentWindow) return false;
    frameRef.current.contentWindow.postMessage(message, widgetOrigin);
    return true;
  };

  useEffect(() => {
    const statusLabels: Record<string, string> = {
      loading_avatar: "Carregando avatar 3D",
      ready: "Avatar conectado",
      queued: "Tradução na fila",
      processing: "Preparando sinais",
      loading_pose: "Carregando movimentos",
      playing: "Avatar sinalizando",
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== widgetOrigin || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; status?: string; message?: string };

      if (data.type === "neotalk:ready") {
        setAvatarReady(true);
        setAvatarError("");
        setAvatarStatus("Avatar conectado");
        frameRef.current?.contentWindow?.postMessage({ type: "neotalk:set-avatar", avatar }, widgetOrigin);
      } else if (data.type === "neotalk:status" && data.status) {
        setAvatarStatus(statusLabels[data.status] || data.status);
      } else if (data.type === "neotalk:playing") {
        setAvatarStatus("Avatar sinalizando");
      } else if (data.type === "neotalk:error") {
        setAvatarError(data.message || "Não foi possível executar a tradução no avatar.");
        setAvatarStatus("Avatar indisponível");
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [avatar, widgetOrigin]);

  const selectAvatar = (value: AvatarId) => {
    setAvatar(value);
    if (sendToAvatar({ type: "neotalk:set-avatar", avatar: value })) {
      setAvatarStatus("Trocando avatar");
    }
  };

  const signPhrase = () => {
    if (!phrase.trim()) {
      showToast("Digite uma frase para o avatar");
      return false;
    }
    if (!sendToAvatar({ type: "neotalk:sign", phrase: phrase.trim() })) {
      showToast("Aguarde o avatar terminar de carregar");
      return false;
    }
    setAvatarError("");
    setAvatarStatus("Enviando tradução");
    return true;
  };

  const toggleRecording = () => {
    if (!recording && !signPhrase()) return;
    if (recording) sendToAvatar({ type: "neotalk:pause" });
    setRecording(!recording);
  };

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
      <div><button className="back">←</button><div><p className="eyebrow">NOVA INSTÂNCIA</p><h1>Estúdio de tradução</h1></div></div>
      <div className="studio-status"><span className={recording ? "pill live" : "pill"}><i className="status-dot" />{recording ? `AO VIVO · ${time}` : "PRONTO PARA INICIAR"}</span><button className="secondary" onClick={() => showToast("Configuração salva")}>Salvar configuração</button></div>
    </div>
    <div className="studio-grid">
      <section className="stage-card">
        <div className="stage-toolbar"><div><span className="tag">PRÉVIA</span><b>Player principal</b><span className={`avatar-health ${avatarReady ? "connected" : ""}`}><i />{avatarStatus}</span></div><button onClick={() => frameRef.current?.requestFullscreen()}>⛶</button></div>
        <div className={`live-stage ${playerMode}`}>
          <iframe ref={frameRef} className="avatar-widget-frame" title="Avatar 3D NeoTalk" src={widgetUrl} allow="fullscreen" />
          <div className="stage-brand">neo<strong>talk</strong></div>
          <div className="live-captions">{recording ? phrase : "A legenda aparecerá aqui quando a captura de áudio começar."}</div>
          <span className="stage-language">PT → LIBRAS</span>
          {avatarError && <div className="avatar-error">{avatarError}</div>}
        </div>
        <div className="capture-controls"><div className="audio-source"><span>⌁</span><div><small>ENTRADA DE ÁUDIO</small><b>Microfone padrão</b></div><button>⌄</button></div><button className={recording ? "record stop" : "record"} onClick={toggleRecording}><i />{recording ? "Encerrar captura" : "Iniciar captura"}</button></div>
      </section>
      <aside className="studio-panel">
        <div className="panel-tabs"><button className="active">Configuração</button><button>Legenda</button></div>
        <div className="config-block"><label>Nome da instância<input defaultValue="Evento institucional 2026" /></label><label>Avatar 3D<select value={avatar} onChange={(event) => selectAvatar(event.target.value as AvatarId)}><option value="lia">Lia · NeoTalk</option><option value="asuna">Asuna · NeoTalk</option></select></label><div className="avatar-choice"><div className="avatar-bust"><i/><i/></div><div><b>{avatar === "lia" ? "Lia" : "Asuna"}</b><small>Avatar 3D conectado · Libras</small></div><span>{avatarReady ? "✓" : "…"}</span></div></div>
        <div className="config-block"><div className="block-title"><b>Testar tradução</b><small>Envie uma frase diretamente ao avatar.</small></div><label>Frase<textarea value={phrase} onChange={(event) => setPhrase(event.target.value)} rows={3} /></label><button className="secondary wide sign-button" onClick={signPhrase} disabled={!avatarReady}>Sinalizar frase no avatar</button></div>
        <div className="config-block"><div className="block-title"><b>Formato do player</b><small>Escolha como exibir a tradução.</small></div><div className="mode-options"><button className={playerMode === "complete" ? "selected" : ""} onClick={() => setPlayerMode("complete")}><i className="layout-complete" />Completo<small>Avatar + legenda</small></button><button className={playerMode === "compact" ? "selected" : ""} onClick={() => setPlayerMode("compact")}><i className="layout-compact" />Mini player<small>Flutuante</small></button></div></div>
        <div className="config-block"><div className="block-title"><b>Transmitir</b><small>Escolha onde abrir o player.</small></div><button className="output-button" onClick={() => { window.open(widgetUrl, "_blank", "noopener,noreferrer"); showToast("Player aberto em nova janela"); }}><span>↗</span><div><b>Abrir em nova janela</b><small>Ideal para compartilhar uma tela</small></div><i>→</i></button><button className="output-button" onClick={copyPlayerLink}><span>⌁</span><div><b>Copiar link do player</b><small>Use em OBS, navegador ou telão</small></div><i>→</i></button></div>
      </aside>
    </div>
  </>;
}
