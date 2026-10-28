"use client";

import { useState } from "react";
import type { Report } from "./AnalyticsAdmin";

const sections: Record<string, string> = {
  page: "Página",
  header: "Navegação",
  hero: "Apresentação",
  product: "Plataforma, plugin e app",
  how_it_works: "Como funciona",
  use_cases: "Soluções",
  pricing: "Planos e preços",
  consumption: "Consumo de horas",
  deaf_access: "Acesso pessoal",
  faq: "Perguntas frequentes",
  final_cta: "Convite final",
  footer: "Rodapé",
};
const ctaNames: Record<string, string> = {
  header_start: "Começar · cabeçalho",
  mobile_start: "Começar · menu móvel",
  hero_start: "Conhecer NeoTalk · apresentação",
  hero_how: "Como funciona · apresentação",
  product_platform: "Conhecer plataforma",
  product_browser: "Conhecer plugin",
  product_mobile: "Conhecer app",
  deaf_access: "Solicitar acesso pessoal",
  footer_start: "Começar · convite final",
  footer_platform: "Plataforma · rodapé",
  footer_discover: "Conhecer plataforma · rodapé",
  footer_contact: "Contato · rodapé",
  footer_email: "E-mail",
  footer_instagram: "Instagram",
  pricing_pro: "Plano Pro",
  pricing_business: "Plano Business",
  pricing_enterprise: "Contato Enterprise",
  header_login: "Entrar · cabeçalho",
  mobile_login: "Entrar · menu móvel",
  footer_login: "Entrar · rodapé",
  nav_product: "Navegação · produto",
  nav_how_it_works: "Navegação · como funciona",
  nav_use_cases: "Navegação · soluções",
  nav_pricing: "Navegação · preços",
  nav_deaf_access: "Navegação · acesso pessoal",
  nav_faq: "Navegação · FAQ",
  nav_top: "Navegação · início",
};
const faqNames: Record<string, string> = {
  faq_1: "Hora NeoTalk",
  faq_2: "Público simultâneo",
  faq_3: "Saldo entre experiências",
  faq_4: "Armazenamento de traduções",
  faq_5: "Adicionar horas",
  faq_6: "Limites de volume",
  faq_7: "Contato com vendedor",
  faq_8: "Acesso pessoal gratuito",
};
const n = (v: number | undefined) => (v || 0).toLocaleString("pt-BR");
function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ana-card">
      <span className="ana-eyebrow">LANDING PAGE</span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Row({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="ana-row">
      <span>
        {title}
        {detail && <small>{detail}</small>}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
function Empty() {
  return (
    <p className="ana-empty">Ainda não há amostra suficiente neste período.</p>
  );
}
export default function LandingAnalytics({ report }: { report: Report }) {
  const [section, setSection] = useState("hero");
  const [device, setDevice] = useState("desktop");
  const [selectedRelease, setRelease] = useState("");
  const release = report.releases.includes(selectedRelease)
    ? selectedRelease
    : report.releases[0] || "landing-analytics-v1";
  const cells = report.heatmap.filter(
    (c) => c.step === section && c.device === device && c.release === release,
  );
  const maxHeat = Math.max(1, ...cells.map((c) => c.clicks));
  const views = Object.fromEntries(
    report.views.map((v) => [v.step, v.sessions]),
  );
  const landingSessions =
    report.events.find((e) => e.name === "landing_view")?.sessions || 0;
  const accessClicks = report.ctas.filter((c) => c.target === "access");
  // The same session can click several CTAs. Never add per-CTA distinct counts as unique people.
  const clicks = accessClicks.reduce((sum, c) => sum + c.clicks, 0);
  return (
    <>
      <div className="ana-kpis">
        {[
          [
            "Navegadores estimados",
            n(report.totals.visitors),
            "Somente métricas autorizadas",
          ],
          [
            "Sessões da landing",
            n(landingSessions),
            "Visualização observada com consentimento",
          ],
          [
            "Cliques para /acesso",
            n(clicks),
            "Eventos de clique, não leads ou contas",
          ],
          [
            "Eventos observados",
            n(report.totals.events),
            "Landing isolada do formulário",
          ],
        ].map(([label, value, detail]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <div className="ana-grid">
        <Card title="Alcance e tempo por seção">
          {Object.entries(sections)
            .filter(([id]) => !["page", "header"].includes(id))
            .map(([id, label]) => (
              <div className="ana-funnel" key={id}>
                <span>
                  {label}
                  <small>
                    {n(views[id])} sessões ·{" "}
                    {(
                      (report.active.find((a) => a.step === id)?.ms || 0) /
                      Math.max(
                        1,
                        report.active.find((a) => a.step === id)?.sessions || 0,
                      ) /
                      1000
                    ).toFixed(1)}
                    s ativos/sessão
                  </small>
                </span>
                <div className="ana-track">
                  <i
                    style={{
                      width: `${Math.min(100, ((views[id] || 0) / Math.max(1, landingSessions)) * 100)}%`,
                    }}
                  />
                </div>
                <strong>{n(views[id])}</strong>
              </div>
            ))}
          <p className="ana-small">
            Exposição por pelo menos 1 segundo em janela visível e focada. Tempo
            ativo com limite de 30 segundos sem interação. Leitura automática
            não comprova atenção.
          </p>
        </Card>
        <Card title="Quais botões geram interesse?">
          {report.ctas.map((c) => (
            <Row
              key={c.cta + c.target}
              title={ctaNames[c.cta] || c.cta}
              value={n(c.clicks)}
              detail={`${n(c.sessions)} sessões distintas neste botão`}
            />
          ))}
          {!report.ctas.length && <Empty />}
          <p className="ana-small">
            Clique no /acesso não confirma chegada, envio do formulário ou
            cadastro. Um visitante pode clicar em vários botões.
          </p>
          <h3>Perguntas abertas</h3>
          {report.faqs.map((f) => (
            <Row
              key={f.faq}
              title={faqNames[f.faq] || f.faq}
              value={n(f.opens)}
              detail={`${n(f.sessions)} sessões`}
            />
          ))}
          {!report.faqs.length && <Empty />}
        </Card>
      </div>
      <div className="ana-grid">
        <Card title="Mapa de calor por seção">
          <div className="ana-filters">
            <label>
              Seção
              <select
                value={section}
                onChange={(e) => setSection(e.target.value)}
              >
                {Object.entries(sections)
                  .filter(([id]) => id !== "page")
                  .map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Tela
              <select
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              >
                <option value="desktop">Computador</option>
                <option value="tablet">Tablet</option>
                <option value="mobile">Celular</option>
              </select>
            </label>
            <label>
              Versão do layout
              <select
                value={release}
                onChange={(e) => setRelease(e.target.value)}
              >
                {(report.releases.length ? report.releases : [release]).map(
                  (r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <div
            className="ana-heatmap"
            role="img"
            aria-label="Grade normalizada de cliques da seção selecionada"
          >
            {Array.from({ length: 400 }, (_, i) => {
              const c = cells.find(
                (c) => c.x === i % 20 && c.y === Math.floor(i / 20),
              );
              return (
                <i
                  key={i}
                  data-level={
                    c ? Math.max(1, Math.ceil((c.clicks / maxHeat) * 5)) : 0
                  }
                  title={`Coluna ${(i % 20) + 1}, linha ${Math.floor(i / 20) + 1}: ${n(c?.clicks)} cliques`}
                />
              );
            })}
          </div>
          <p className="ana-small">
            {cells.length
              ? `${n(cells.reduce((sum, c) => sum + c.clicks, 0))} cliques nas células exibidas.`
              : "Sem amostra suficiente para esta seção, tela e versão."}{" "}
            Cada célula exige pelo menos 3 sessões. Coordenadas relativas à
            seção; sem screenshot, texto, digitação ou replay.
          </p>
        </Card>
        <Card title="Rolagem e interesse nos planos">
          {report.scroll
            .filter((s) => s.step === section)
            .map((s) => (
              <Row
                key={s.step + s.depth}
                title={`${sections[s.step]} · ${s.depth}%`}
                value={n(s.sessions)}
                detail="Sessões que alcançaram este marco"
              />
            ))}
          {!report.scroll.some((s) => s.step === section) && <Empty />}
          <h3>Seleções de planos</h3>
          {report.pricing.map((p) => (
            <Row
              key={p.plan + p.billing + p.hours}
              title={`${p.plan === "shared" ? "Periodicidade" : p.plan === "pro" ? "Pro" : "Business"} · ${p.billing === "annual" ? "anual" : "mensal"} · ${p.hours}h`}
              value={n(p.changes)}
              detail={`${n(p.sessions)} sessões; seleção não representa compra`}
            />
          ))}
          {!report.pricing.length && <Empty />}
          <h3>Falhas técnicas</h3>
          {report.errors.map((e) => (
            <Row
              key={e.name + e.code}
              title={
                e.code === "resource"
                  ? "Recurso não carregado"
                  : e.code === "promise"
                    ? "Operação assíncrona"
                    : "Execução da página"
              }
              value={n(e.attempts)}
            />
          ))}
          {!report.errors.length && (
            <p className="ana-empty">Nenhuma falha observada nesta amostra.</p>
          )}
        </Card>
      </div>
      <div className="ana-grid">
        <Card title="Campanhas e dispositivos">
          {report.campaigns.map((c, i) => (
            <Row
              key={i}
              title={Object.values(c.campaign).join(" / ")}
              value={n(c.sessions)}
            />
          ))}
          {!report.campaigns.length && <Empty />}
          <h3>Dispositivo e idioma</h3>
          {report.segments.map((s, i) => (
            <Row
              key={i}
              title={`${s.device} · ${s.language === "pt" ? "Português" : "Outro idioma"}`}
              value={n(s.sessions)}
            />
          ))}
          <p className="ana-small">
            Segmentos abaixo de 3 sessões são omitidos. Sem GPS, IP bruto ou
            localização inferida. O formulário pode ser analisado separadamente
            no seletor de origem.
          </p>
        </Card>
        <Card title="Atividade por dia">
          <div className="ana-daily">
            {report.daily.map((d) => (
              <div key={d.day} title={`${d.day}: ${n(d.sessions)} sessões`}>
                <i
                  style={{
                    height: `${(d.sessions / Math.max(1, ...report.daily.map((v) => v.sessions))) * 70}px`,
                  }}
                />
                <small>{d.day.slice(5)}</small>
              </div>
            ))}
          </div>
          {!report.daily.length && <Empty />}
          <p className="ana-small">
            Fuso de Fortaleza. Bloqueadores, recusa e perda de rede deixam
            lacunas; este relatório não representa o tráfego total.
          </p>
        </Card>
      </div>
    </>
  );
}
