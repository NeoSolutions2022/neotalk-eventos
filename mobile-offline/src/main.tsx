import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LiveRoom from '../../app/LiveRoom';
import { initializeCatalog, buildPose } from './offlineClient';
import { prepareSpeech } from './speech';
import './offline.css';

// The widget runs the same renderer, with an in-process local API instead of HTTP.
Object.assign(globalThis, { neoTalkOffline: { buildPose } });
function App() {
  const [catalog, setCatalog] = useState<any>();
  const [error, setError] = useState('');
  const [voice, setVoice] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState(false);
  useEffect(() => { initializeCatalog().then(setCatalog).catch(reason => setError(reason.message)); }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); } }, [toast]);
  const prepare = async () => {
    setError(''); setVoice('loading');
    try { await prepareSpeech(); setVoice('ready'); } catch (reason) { setVoice('idle'); setError(`Voz local não pronta: ${reason instanceof Error ? reason.message : reason}`); }
  };
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return <main className="app-shell offline-app">
    <button className={`sidebar-scrim ${menu ? 'visible' : ''}`} aria-label="Fechar menu" onClick={() => setMenu(false)} />
    <aside className={`sidebar ${menu ? 'open' : ''}`}>
      <div className="logo"><img src="/neotalk-logo.png" alt="NeoTalk"/><small>OFFLINE</small></div>
      <nav><span className="nav-title">PLATAFORMA</span><a href="#sala" className="active" onClick={() => setMenu(false)}>◉ &nbsp; Salas ao vivo</a><span className="nav-title">NESTE DISPOSITIVO</span><p className="offline-sidebar-note">Sem envio de áudio. Sem GPT.<br/>Os sinais e a voz são processados localmente.</p></nav>
      <div className="sidebar-bottom"><div className="help-card"><strong>Pacote de sinais</strong><small>{catalog ? `${catalog.entries.length} sinais instalados · ${catalog.complete ? 'completo' : 'amostra de desenvolvimento'}` : 'Verificando arquivos…'}</small></div></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><button className="mobile-menu" aria-label="Abrir menu" onClick={() => setMenu(true)}>☰</button><div className="breadcrumbs"><span>NeoTalk</span><b>/</b>Estúdio ao vivo</div><div className="top-actions"><span className="offline-badge">● Offline</span></div></header>
      <div className="content" id="sala">
        <section className="offline-setup" aria-live="polite"><div><strong>Sala ao vivo no seu aparelho</strong><p>Tradução por palavras e expressões do catálogo. Não substitui a interpretação contextual da versão online.</p></div><button disabled={!catalog || voice !== 'idle'} onClick={() => void prepare()}>{voice === 'ready' ? 'Voz em português pronta' : voice === 'loading' ? 'Preparando voz local…' : 'Preparar voz local'}</button></section>
        {error && <p className="offline-error" role="alert">{error}</p>}
        {catalog && !catalog.complete && <p className="offline-warning">Pacote de desenvolvimento: apenas {catalog.entries.length} sinais locais. Não é a versão de distribuição.</p>}
        {catalog && <LiveRoom recording={recording} setRecording={setRecording} time={time} showToast={setToast} offline captureAvailable={voice === 'ready'} />}
      </div>
    </section>
    {toast && <div className="toast">{toast}</div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
