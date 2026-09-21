"use client";

import { useEffect, useRef, useState } from "react";
import LiveRoom from "./LiveRoom";
import Rooms from "./Rooms";
import QualityAdmin from "./QualityAdmin";
import { isNonBlockingAvatarError } from "./avatarMessages";
import { ApiError, SessionUser, apiRequest, authenticate, consumeLeadAccess, loadSession, setSession } from "./apiClient";

export type View = "dashboard" | "instances" | "packages" | "billing" | "quality" | "studio" | "videos" | "plugins" | "account" | "login" | "register" | "handoff";
type AvatarId = "lia" | "asuna" | "elia";

const avatarWidgetBase = process.env.NEXT_PUBLIC_AVATAR_WIDGET_URL || "https://infra-avatar3d-oficial.k3p3ex.easypanel.host/widget";
const avatarNames: Record<AvatarId, string> = { lia: "Lia", asuna: "Asuna", elia: "Elia" };

const baseNav = [
  { id: "instances" as View, icon: "broadcast" as IconName, label: "Salas ao vivo", href: "/salas" },
  { id: "videos" as View, icon: "video" as IconName, label: "Tradução de vídeos", href: "/videos", locked: true },
  { id: "plugins" as View, icon: "plugin" as IconName, label: "Plugins", href: "/plugins", locked: true },
];

const viewPaths: Record<View, string> = {
  dashboard: "/dashboard", instances: "/salas", packages: "/uso", billing: "/pagamento",
  quality: "/qualidade", studio: "/salas/ao-vivo", login: "/login", register: "/cadastro",
  videos: "/videos", plugins: "/plugins", account: "/conta",
  handoff: "/acesso",
};

const instances = [
  { name: "Congresso Inova 2026", date: "Hoje, 09:42", duration: "01h 24min", status: "Finalizada" },
  { name: "Treinamento de segurança", date: "12 ago, 14:10", duration: "00h 48min", status: "Finalizada" },
  { name: "Assembleia mensal", date: "08 ago, 18:30", duration: "02h 06min", status: "Finalizada" },
];

export default function PlatformApp({ initialView = "dashboard" }: { initialView?: View }) {
  const [view] = useState<View>(initialView);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [playerMode, setPlayerMode] = useState<"complete" | "compact">("complete");
  const [toast, setToast] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(!["login", "register", "handoff"].includes(view));

  useEffect(() => {
    if (view === "login" || view === "register" || view === "handoff") return;
    loadSession().then((activeUser) => {
      if (["dashboard", "packages", "quality", "billing"].includes(view) && activeUser.role !== "admin") {
        window.location.replace("/salas");
        return;
      }
      setUser(activeUser);
    }).catch(() => window.location.replace(`/login?return_to=${encodeURIComponent(window.location.pathname)}`))
      .finally(() => setAuthLoading(false));
  }, [view]);

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
  const goTo = (target: View) => { window.location.href = viewPaths[target]; };
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (view === "handoff") return <LeadAccess />;

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
          <AuthForm isLogin={isLogin} />
        </section>
      </main>
    );
  }

  if (authLoading || !user) return <main className="session-loading"><Logo dark /><span>Preparando sua plataforma…</span></main>;

  const nav = [
    ...baseNav,
    ...(user.role === "admin" ? [
      { id: "dashboard" as View, icon: "home" as IconName, label: "Visão geral", href: "/dashboard" },
      { id: "packages" as View, icon: "clock" as IconName, label: "Pacotes e uso", href: "/uso" },
      { id: "billing" as View, icon: "card" as IconName, label: "Pagamento", href: "/pagamento" },
      { id: "quality" as View, icon: "sparkles" as IconName, label: "Qualidade", href: "/qualidade" },
    ] : []),
  ];
  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  const logout = async () => {
    try { await apiRequest<void>("/auth/logout", { method: "POST" }); } finally {
      setSession(null);
      window.location.href = "/login";
    }
  };

  return (
    <>
    <main className="app-shell">
      <button className={`sidebar-scrim ${sidebarOpen ? "visible" : ""}`} aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <Logo />
        <nav>
          <span className="nav-title">PLATAFORMA</span>
          {nav.map((item) => {
            const active = view === item.id || (view === "studio" && item.id === "instances");
            return <a key={item.id} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => setSidebarOpen(false)}><span><Icon name={item.icon} /></span>{item.label}</a>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">?</span><strong>Precisa de ajuda?</strong><small>Fale com nosso time</small><button onClick={() => showToast("Atendimento solicitado")}>Abrir atendimento</button></div>
          <button className="logout" onClick={logout}><span><Icon name="logout" /></span> Sair</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Abrir menu principal" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
          <div className="breadcrumbs"><span>NeoTalk</span><b>/</b>{view === "studio" ? "Estúdio ao vivo" : nav.find((item) => item.id === view)?.label}</div>
          <div className="top-actions">{!user.password_set && <a className="secure-account" href="/conta">Definir senha</a>}<a className="top-create" href="/salas/ao-vivo"><Icon name="plus" /> Nova sala</a><button className="icon-button" aria-label="Notificações"><Icon name="bell" /></button><a className="profile" href="/conta"><div className="avatar-initials">{initials}</div><div><strong>{user.name}</strong><small>{user.role === "admin" ? "Administrador" : "Conta gratuita"}</small></div><span><Icon name="chevron" /></span></a></div>
        </header>
        <div className="content">
          {view === "dashboard" && <Dashboard onCreate={() => goTo("studio")} onViewAll={() => goTo("instances")} />}
          {view === "instances" && <Rooms onCreate={() => goTo("studio")} diagnostics={user.role === "admin"} />}
          {view === "packages" && <Packages onBuy={() => goTo("billing")} />}
          {view === "billing" && <Billing onSave={() => showToast("Dados de pagamento atualizados")} />}
          {view === "quality" && <QualityAdmin showToast={showToast} />}
          {view === "studio" && <LiveRoom recording={recording} setRecording={setRecording} time={time} playerMode={playerMode} setPlayerMode={setPlayerMode} showToast={showToast} diagnostics={user.role === "admin"} />}
          {(view === "videos" || view === "plugins") && <LockedPreview kind={view} />}
          {view === "account" && <Account user={user} onReplay={async () => {
            await apiRequest("/auth/onboarding", { method: "PATCH", body: JSON.stringify({ step: 0, status: "pending" }) });
            setUser({ ...user, onboarding_version: 0, onboarding_step: 0, onboarding_status: "pending" });
          }} />}
        </div>
      </section>
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
    {user.onboarding_version < 1 && <Onboarding user={user} onChange={setUser} />}
    </>
  );
}

function AuthForm({ isLogin }: { isLogin: boolean }) {
  const [name, setName] = useState(() => typeof window === "undefined" || isLogin ? "" : new URLSearchParams(window.location.search).get("nome") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const user = await authenticate(isLogin ? "login" : "register", { ...(isLogin ? {} : { name }), email, password });
      const returnTo = new URLSearchParams(window.location.search).get("return_to");
      window.location.href = returnTo?.startsWith("/") ? returnTo : (user.role === "admin" ? "/qualidade" : "/salas");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "Não foi possível entrar agora."); }
    finally { setBusy(false); }
  };
  return <form className="auth-card" onSubmit={submit}>
    <span className="mobile-logo"><Logo dark /></span><p className="eyebrow">NEOTALK EVENTOS</p>
    <h2>{isLogin ? "Que bom ter você de volta" : "Crie sua conta grátis"}</h2>
    <p className="muted">{isLogin ? "Acesse sua central de traduções." : "A beta está aberta e não exige cartão."}</p>
    {!isLogin && <label>Nome completo<input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></label>}
    <label>E-mail<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>Senha<input type="password" minLength={isLogin ? undefined : 10} autoComplete={isLogin ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {!isLogin && <small className="password-hint">Use pelo menos 10 caracteres.</small>}
    {error && <div className="auth-error" role="alert">{error}</div>}
    <button className="primary wide" type="submit" disabled={busy}>{busy ? "Aguarde…" : isLogin ? "Entrar na plataforma" : "Criar minha conta"}<span>→</span></button>
    <div className="switch-auth">{isLogin ? "Ainda não tem uma conta?" : "Já possui uma conta?"}<a className="link" href={isLogin ? "/cadastro" : "/login"}>{isLogin ? "Criar conta" : "Entrar"}</a></div>
  </form>;
}

function LeadAccess() {
  const [message, setMessage] = useState("Preparando seu acesso gratuito…");
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code") || "";
    window.history.replaceState({}, "", "/acesso");
    if (!code) {
      window.location.replace("/login");
      return;
    }
    consumeLeadAccess(code)
      .then(() => window.location.replace("/salas"))
      .catch(() => {
        setMessage("Este acesso expirou. Entre com sua conta ou refaça o formulário.");
        window.setTimeout(() => window.location.replace("/login"), 2400);
      });
  }, []);
  return <main className="session-loading"><Logo dark /><span>{message}</span></main>;
}

function LockedPreview({ kind }: { kind: "videos" | "plugins" }) {
  const video = kind === "videos";
  return <section className="locked-preview">
    <span className="locked-kicker">EM BREVE</span>
    <div className="locked-icon"><Icon name={video ? "video" : "plugin"} /></div>
    <h1>{video ? "Tradução de vídeos" : "Plugins e integrações"}</h1>
    <p>{video ? "Envie um vídeo e receba uma versão acessível com Libras e legendas." : "Conecte a NeoTalk ao OBS, reuniões e plataformas de transmissão."}</p>
    <span className="locked-badge">🔒 Disponível em uma próxima versão</span>
  </section>;
}

function Account({ user, onReplay }: { user: SessionUser; onReplay: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(user.password_set);
  const [error, setError] = useState("");
  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try {
      await apiRequest("/auth/password", { method: "POST", body: JSON.stringify({ password }) });
      setSaved(true); setPassword("");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "Não foi possível salvar a senha."); }
  };
  return <><div className="page-heading"><div><p className="eyebrow">SUA CONTA</p><h1>Perfil</h1><p>Dados usados para acessar a plataforma.</p></div></div>
    <section className="account-card"><div className="account-avatar">{user.name.split(/\s+/).slice(0,2).map((p) => p[0]).join("").toUpperCase()}</div><div><h2>{user.name}</h2><p>{user.email}</p><span>{user.role === "admin" ? "Administrador" : "Beta gratuita"}</span></div><button className="secondary" onClick={() => void onReplay()}>Refazer tutorial</button></section>
    {!saved && <form className="account-password" onSubmit={savePassword}><div><p className="eyebrow">PROTEJA SEU ACESSO</p><h2>Crie uma senha para entrar novamente</h2><p>Você veio pelo formulário e já entrou automaticamente. Defina uma senha antes de sair.</p></div><label>Nova senha<input type="password" minLength={10} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Pelo menos 10 caracteres" /></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="primary" type="submit">Salvar senha</button></form>}
  </>;
}

const onboardingSteps = [
  { title: "Bem-vindo à NeoTalk", body: "Você já pode criar sua sala gratuita de tradução em Libras." },
  { title: "Sua sala ao vivo", body: "Cada conta mantém uma sala ativa por vez. Finalize a atual para começar outra." },
  { title: "Permita o microfone", body: "Ao iniciar a transmissão, o navegador pedirá sua autorização para ouvir e transcrever." },
  { title: "Acompanhe a tradução", body: "Legenda e avatar continuam visíveis na tela cheia, com controles de áudio e zoom." },
  { title: "Tudo pronto", body: "Crie uma sala, escolha o avatar e comece a falar. O tutorial pode ser reaberto no seu perfil." },
];

function Onboarding({ user, onChange }: { user: SessionUser; onChange: (user: SessionUser) => void }) {
  const [step, setStep] = useState(Math.min(user.onboarding_step, onboardingSteps.length - 1));
  const [busy, setBusy] = useState(false);
  const finish = async (status: "completed" | "skipped") => {
    setBusy(true);
    try {
      await apiRequest("/auth/onboarding", { method: "PATCH", body: JSON.stringify({ step: step + 1, status }) });
      onChange({ ...user, onboarding_version: 1, onboarding_step: step + 1, onboarding_status: status });
      if (status === "completed") window.location.href = "/salas/ao-vivo";
    } finally { setBusy(false); }
  };
  const next = async () => {
    if (step === onboardingSteps.length - 1) return finish("completed");
    const nextStep = step + 1;
    setStep(nextStep);
    await apiRequest("/auth/onboarding", { method: "PATCH", body: JSON.stringify({ step: nextStep, status: "pending" }) });
  };
  return <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><section className="onboarding-card">
    <div className="onboarding-progress">{onboardingSteps.map((_, index) => <i key={index} className={index <= step ? "active" : ""} />)}</div>
    <span className="onboarding-count">PASSO {step + 1} DE {onboardingSteps.length}</span>
    <h2 id="onboarding-title">{onboardingSteps[step].title}</h2><p>{onboardingSteps[step].body}</p>
    {step === 2 && <button className="mic-test" type="button" onClick={async (event) => { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); (event.currentTarget as HTMLButtonElement).textContent = "✓ Microfone autorizado"; }}>Testar microfone</button>}
    <div className="onboarding-actions"><button className="link" disabled={busy} onClick={() => void finish("skipped")}>Pular tutorial</button><button className="primary" disabled={busy} onClick={() => void next()}>{step === onboardingSteps.length - 1 ? "Criar minha sala" : "Continuar"} →</button></div>
  </section></div>;
}

function Logo({ dark = false }: { dark?: boolean }) {
  return <div className={`logo ${dark ? "dark" : ""}`}><img src="/neotalk-logo.png" alt="NeoTalk" /><small>EVENTOS</small></div>;
}

type IconName = "home" | "broadcast" | "clock" | "card" | "sparkles" | "video" | "plugin" | "logout" | "menu" | "plus" | "bell" | "chevron";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></>,
    broadcast: <><circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8"/><path d="M18.4 5.6a9 9 0 0 1 0 12.8"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/><path d="m5 13 .8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z"/></>,
    video: <><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 9 4-2v10l-4-2"/></>,
    plugin: <><path d="M8 3v4M16 3v4M5 7h14v4a7 7 0 0 1-14 0V7Z"/><path d="M12 18v3"/></>,
    logout: <><path d="M10 5H5v14h5"/><path d="M14 8l4 4-4 4"/><path d="M8 12h10"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    chevron: <path d="m8 10 4 4 4-4"/>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Dashboard({ onCreate, onViewAll }: { onCreate: () => void; onViewAll: () => void }) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">VISÃO GERAL DA CONTA</p><h1>Olá, Marina</h1><p>Veja como está o uso da sua conta e continue traduzindo.</p></div><button className="primary" onClick={onCreate}><span>＋</span> Criar sala ao vivo</button></div>
    <section className="summary-grid">
      <article className="balance-card"><div className="card-top"><span className="card-icon lime">◷</span><span className="pill good">Saldo disponível</span></div><div><strong>12h <small>35min</small></strong><p>de 20 horas contratadas</p></div><div className="progress"><i style={{ width: "63%" }} /></div><div className="progress-label"><span>63% disponível</span><span>7h 25min utilizadas</span></div></article>
      <article className="stat-card"><span className="card-icon sky">◉</span><div><p>Traduções realizadas</p><strong>18</strong><small><b>↗ 12%</b> nos últimos 30 dias</small></div></article>
      <article className="stat-card"><span className="card-icon purple">⌁</span><div><p>Tempo transmitido</p><strong>7h 25min</strong><small>este mês</small></div></article>
    </section>
    <section className="quick-section"><div className="section-title"><div><h2>Tradução em tempo real</h2><p>Abra uma sala e comece a falar.</p></div></div><div className="quick-card"><div className="quick-copy"><span className="step-number">01</span><div><h3>Nova sala de tradução</h3><p>Capture o microfone, gere legendas ao vivo e envie cada trecho falado para a Lia.</p><div className="features"><span>✓ Microfone em tempo real</span><span>✓ Lia 3D integrada</span><span>✓ Frases enviadas em lotes</span></div><button className="primary" onClick={onCreate}>Criar sala ao vivo <span>→</span></button></div></div><div className="mini-stage"><div className="stage-top"><span><i /> AO VIVO</span><small>00:42:18</small></div><div className="figure"><i className="head" /><i className="body" /><i className="hand left" /><i className="hand right" /></div><div className="fake-caption">Bem-vindos ao nosso evento.<br />É um prazer ter vocês aqui.</div></div></div></section>
    <section className="history"><div className="section-title"><div><h2>Salas recentes</h2><p>Últimas transmissões ao vivo da sua equipe.</p></div><button className="secondary" onClick={onViewAll}>Ver todas →</button></div><div className="table"><div className="table-head"><span>SALA</span><span>DATA</span><span>DURAÇÃO</span><span>STATUS</span><span /></div>{instances.map((item) => <div className="table-row" key={item.name}><span><i className="row-icon">◉</i><b>{item.name}</b></span><span>{item.date}</span><span>{item.duration}</span><span><i className="status-dot" />{item.status}</span><button>•••</button></div>)}</div></section>
  </>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Instances({ onCreate }: { onCreate: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">TRANSMISSÕES</p><h1>Salas ao vivo</h1><p>Crie uma sala, capture o microfone e acompanhe as sessões realizadas.</p></div><button className="primary" onClick={onCreate}>＋ Criar sala ao vivo</button></div><div className="filter-bar"><div className="search">⌕ <input placeholder="Buscar sala..." /></div><button className="secondary">Todas as datas ⌄</button><button className="secondary">Todos os status ⌄</button></div><div className="instance-grid">{[...instances, { name: "Workshop de liderança", date: "02 ago, 08:00", duration: "01h 35min", status: "Finalizada" }].map((item, index) => <article className="instance-card" key={item.name}><div className="instance-cover"><span className="instance-number">0{index + 1}</span><div className="tiny-figure"><i/><i/></div><span className="pill good"><i className="status-dot" /> {item.status}</span></div><h3>{item.name}</h3><p>{item.date}</p><div className="instance-meta"><span>◷ {item.duration}</span><span>CC Legendas</span></div><button className="secondary wide">Ver detalhes</button></article>)}</div></>;
}

function Packages({ onBuy }: { onBuy: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">CONSUMO</p><h1>Pacotes e uso</h1><p>Acompanhe seu saldo e escolha o pacote ideal para o próximo evento.</p></div></div><div className="usage-banner"><div><span className="card-icon lime">◷</span><div><p>Saldo atual</p><strong>12h 35min</strong><small>Renovação em 01 de setembro</small></div></div><div className="usage-chart"><span><i style={{height:"32%"}} />SEG</span><span><i style={{height:"55%"}} />TER</span><span><i style={{height:"40%"}} />QUA</span><span><i style={{height:"76%"}} />QUI</span><span><i style={{height:"48%"}} />SEX</span><span><i style={{height:"18%"}} />SÁB</span><span><i style={{height:"10%"}} />DOM</span></div></div><div className="section-title plans-title"><div><h2>Adicione mais horas</h2><p>As horas ficam disponíveis assim que o pagamento for confirmado.</p></div></div><div className="plans"><article><span className="plan-label">ESSENCIAL</span><h3>5 horas</h3><p>Para reuniões e eventos pontuais.</p><strong>R$ 490<small> pagamento único</small></strong><button className="secondary wide" onClick={onBuy}>Selecionar pacote</button></article><article className="featured"><span className="popular">MAIS ESCOLHIDO</span><span className="plan-label">PROFISSIONAL</span><h3>20 horas</h3><p>Para equipes com agenda frequente.</p><strong>R$ 1.590<small> pagamento único</small></strong><button className="primary wide" onClick={onBuy}>Selecionar pacote</button></article><article><span className="plan-label">EVENTOS</span><h3>50 horas</h3><p>Para grandes eventos e transmissões.</p><strong>R$ 3.490<small> pagamento único</small></strong><button className="secondary wide" onClick={onBuy}>Selecionar pacote</button></article></div></>;
}

function Billing({ onSave }: { onSave: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">CONTA</p><h1>Pagamento</h1><p>Mantenha os dados de cobrança e o método de pagamento atualizados.</p></div></div><div className="billing-grid"><section className="form-card"><div className="section-title"><div><h2>Dados de cobrança</h2><p>Informações utilizadas nos seus comprovantes.</p></div><span className="secure">● Ambiente seguro</span></div><div className="form-grid"><label className="full">Razão social<input defaultValue="Aurora Eventos e Tecnologia LTDA" /></label><label>CNPJ<input defaultValue="12.345.678/0001-90" /></label><label>Telefone<input defaultValue="(85) 99999-4400" /></label><label className="full">Endereço<input defaultValue="Av. Desembargador Moreira, 1800" /></label><label>Cidade<input defaultValue="Fortaleza" /></label><label>Estado<select defaultValue="CE"><option>CE</option><option>SP</option></select></label></div><hr/><div className="section-title"><div><h2>Método de pagamento</h2><p>Cartão principal para novas compras.</p></div></div><div className="credit-card"><span>neo<strong>talk</strong></span><i>•••• •••• •••• 8240</i><div><small>MARINA ALMEIDA</small><small>08/29</small></div></div><div className="form-grid"><label className="full">Número do cartão<input defaultValue="•••• •••• •••• 8240" /></label><label>Validade<input defaultValue="08/29" /></label><label>Código de segurança<input defaultValue="•••" /></label></div><button className="primary" onClick={onSave}>Salvar alterações</button></section><aside className="billing-side"><h3>Resumo da conta</h3><div><span>Plano atual</span><b>Profissional · 20h</b></div><div><span>Próxima renovação</span><b>01 set 2026</b></div><div><span>Saldo disponível</span><b className="green">12h 35min</b></div><hr/><p>Seus dados são protegidos e usados somente para processar compras e emitir comprovantes.</p><button className="link">Ver histórico de pagamentos →</button></aside></div></>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Studio({ recording, setRecording, time, playerMode, setPlayerMode, showToast }: { recording: boolean; setRecording: (value: boolean) => void; time: string; playerMode: "complete" | "compact"; setPlayerMode: (value: "complete" | "compact") => void; showToast: (value: string) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [avatar, setAvatar] = useState<AvatarId>("elia");
  const [avatarReady, setAvatarReady] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState("Conectando ao avatar");
  const [avatarError, setAvatarError] = useState("");
  const [phrase, setPhrase] = useState("É uma satisfação receber todos vocês. Hoje vamos falar sobre acessibilidade.");
  const [widgetUrl] = useState(() => {
    const url = new URL(avatarWidgetBase);
    url.searchParams.set("avatar", "elia");
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
        if (isNonBlockingAvatarError(data.message)) {
          setAvatarError("");
          setAvatarStatus("Avatar sinalizando");
          return;
        }
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
        <div className="config-block"><label>Nome da instância<input defaultValue="Evento institucional 2026" /></label><label>Avatar 3D<select value={avatar} onChange={(event) => selectAvatar(event.target.value as AvatarId)}><option value="lia">Lia · NeoTalk</option><option value="asuna">Asuna · NeoTalk</option><option value="elia">Elia · NeoTalk</option></select></label><div className="avatar-choice"><div className="avatar-bust"><i/><i/></div><div><b>{avatarNames[avatar]}</b><small>Avatar 3D conectado · Libras</small></div><span>{avatarReady ? "✓" : "…"}</span></div></div>
        <div className="config-block"><div className="block-title"><b>Testar tradução</b><small>Envie uma frase diretamente ao avatar.</small></div><label>Frase<textarea value={phrase} onChange={(event) => setPhrase(event.target.value)} rows={3} /></label><button className="secondary wide sign-button" onClick={signPhrase} disabled={!avatarReady}>Sinalizar frase no avatar</button></div>
        <div className="config-block"><div className="block-title"><b>Formato do player</b><small>Escolha como exibir a tradução.</small></div><div className="mode-options"><button className={playerMode === "complete" ? "selected" : ""} onClick={() => setPlayerMode("complete")}><i className="layout-complete" />Completo<small>Avatar + legenda</small></button><button className={playerMode === "compact" ? "selected" : ""} onClick={() => setPlayerMode("compact")}><i className="layout-compact" />Mini player<small>Flutuante</small></button></div></div>
        <div className="config-block"><div className="block-title"><b>Transmitir</b><small>Escolha onde abrir o player.</small></div><button className="output-button" onClick={() => { window.open(widgetUrl, "_blank", "noopener,noreferrer"); showToast("Player aberto em nova janela"); }}><span>↗</span><div><b>Abrir em nova janela</b><small>Ideal para compartilhar uma tela</small></div><i>→</i></button><button className="output-button" onClick={copyPlayerLink}><span>⌁</span><div><b>Copiar link do player</b><small>Use em OBS, navegador ou telão</small></div><i>→</i></button></div>
      </aside>
    </div>
  </>;
}
