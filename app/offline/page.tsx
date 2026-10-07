const android = process.env.NEXT_PUBLIC_OFFLINE_ANDROID_URL;
const ios = process.env.NEXT_PUBLIC_OFFLINE_IOS_URL;
function trustedRelease(url?: string) {
  if (!url) return null;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : null; } catch { return null; }
}
export default function OfflinePage() {
  const androidLink = trustedRelease(android), iosLink = trustedRelease(ios);
  return <main className="content" style={{ maxWidth: 900, margin: '40px auto' }}>
    <a href="/salas">← Voltar à plataforma</a>
    <section className="offline-download-card" style={{ background: 'white', padding: 32, borderRadius: 20, marginTop: 24 }}>
      <span className="eyebrow">NEOTALK OFFLINE · EM DESENVOLVIMENTO</span>
      <h1>Uma sala ao vivo no seu celular.</h1>
      <p>Elia, legendas e sinais locais, com a experiência visual da plataforma. A versão offline traduz pelas palavras e expressões disponíveis no pacote, sem interpretação contextual por IA.</p>
      <p>O primeiro download exige internet e inclui o avatar, o catálogo de sinais e o modelo de voz em português. Depois da instalação, o áudio não precisa sair do aparelho.</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '24px 0' }}>
        {androidLink ? <a className="top-create" href={androidLink} rel="noopener noreferrer">Baixar para Android →</a> : <span>Android · pacote ainda não publicado</span>}
        {iosLink ? <a className="top-create" href={iosLink} rel="noopener noreferrer">Instalar no iPhone ou iPad →</a> : <span>iPhone e iPad · TestFlight ainda não publicado</span>}
      </div>
      <small>A velocidade e a compatibilidade dependem do dispositivo. A distribuição será liberada após validação em aparelhos reais.</small>
    </section>
  </main>;
}
