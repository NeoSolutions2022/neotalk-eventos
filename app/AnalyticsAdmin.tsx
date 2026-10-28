"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./apiClient";
import "./analytics.css";
import LandingAnalytics from "./LandingAnalytics";

type Groups = Record<
  "funnel" | "engagement" | "heatmap" | "errors" | "attribution",
  boolean
>;
type Settings = {
  enabled: boolean;
  groups: Groups;
  sources?: { access: boolean; landing: boolean };
};
type Count = { step: string; sessions: number };
export type Report = {
  source: "access" | "landing";
  releases: string[];
  ctas: { cta: string; target: string; clicks: number; sessions: number }[];
  faqs: { faq: string; opens: number; sessions: number }[];
  pricing: {
    plan: string;
    hours: number;
    billing: string;
    changes: number;
    sessions: number;
  }[];
  days: number;
  generated_at: string;
  totals: {
    events: number;
    visitors: number;
    sessions: number;
    funnel_sessions: number;
  };
  events: { name: string; attempts: number; sessions: number }[];
  views: Count[];
  completed: Count[];
  active: (Count & { ms: number })[];
  heatmap: (Count & {
    device: string;
    release: string;
    x: number;
    y: number;
    clicks: number;
  })[];
  scroll: (Count & { depth: number })[];
  options: (Count & { option: number })[];
  segments: { device: string; language: string; sessions: number }[];
  campaigns: { campaign: Record<string, string>; sessions: number }[];
  errors: { name: string; code: string; attempts: number }[];
  abandonment: {
    in_progress: number;
    provisional: number;
    consolidated: number;
    accepted: number;
  };
  last_steps: Record<string, number>;
  daily: { day: string; sessions: number }[];
};
const names: Record<string, string> = {
  perfil_de_uso: "Perfil de uso",
  tipos_de_conteudo: "Conteúdo",
  volume_mensal: "Volume mensal",
  prazo_de_interesse: "Prazo de interesse",
  contato: "Contato",
  sucesso: "Sucesso",
  unknown: "Não observada",
};
const groupNames: Record<keyof Groups, string> = {
  funnel: "Funil e CTAs",
  engagement: "Tempo e rolagem",
  heatmap: "Mapa de calor",
  errors: "Falhas",
  attribution: "Campanhas",
};
const options: Record<string, string[]> = {
  perfil_de_uso: [
    "Criar conteúdos",
    "Aulas ou cursos",
    "Empresa",
    "Eventos e transmissões",
    "Universidade / ensino",
    "Outro",
  ],
  tipos_de_conteudo: [
    "Vídeos",
    "Aulas",
    "Lives",
    "Eventos",
    "Reuniões",
    "Sites / plataformas",
    "Educacional",
    "Outro",
  ],
  volume_mensal: [
    "Até 5h",
    "5–20h",
    "20–50h",
    "50–100h",
    "100–500h",
    "Mais de 500h",
    "Não sabe",
  ],
  prazo_de_interesse: [
    "Assim que disponível",
    "Até 30 dias",
    "Até 3 meses",
    "Conhecendo",
  ],
};
const n = (value: number | undefined) => (value || 0).toLocaleString("pt-BR");
function Row({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="ana-row">
      <span>
        {label}
        {detail && <small>{detail}</small>}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
function Empty({
  children = "Ainda não há amostra suficiente neste período.",
}: {
  children?: React.ReactNode;
}) {
  return <p className="ana-empty">{children}</p>;
}
function Card({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ana-card">
      <span className="ana-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function AnalyticsAdmin() {
  const [days, setDays] = useState(7);
  const [source, setSource] = useState<"access" | "landing">("access");
  const [report, setReport] = useState<Report | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("perfil_de_uso");
  const [device, setDevice] = useState("mobile");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setBusy(true);
      setReport(null);
      setError("");
      try {
        const [data, config] = await Promise.all([
          apiRequest<Report>(
            `/admin/analytics/report?days=${days}&source=${source}`,
            {
              signal,
            },
          ),
          apiRequest<Settings>("/admin/analytics/settings", { signal }),
        ]);
        if (!signal?.aborted) {
          setReport(data);
          setSettings(config);
        }
      } catch (e) {
        if (!signal?.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Não foi possível carregar as métricas.",
          );
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [days, source],
  );
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);
  async function save() {
    if (!settings) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest("/admin/analytics/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setMessage(
        "Preferências de coleta salvas. A escolha individual de cada visitante continua sendo respeitada.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `neotalk-${source}-metricas.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const events = Object.fromEntries(
    (report?.events || []).map((e) => [e.name, e]),
  );
  const views = Object.fromEntries(
    (report?.views || []).map((e) => [e.step, e.sessions]),
  );
  const completed = Object.fromEntries(
    (report?.completed || []).map((e) => [e.step, e.sessions]),
  );
  const cells =
    report?.heatmap.filter((c) => c.step === step && c.device === device) || [];
  const maxHeat = Math.max(1, ...cells.map((c) => c.clicks));
  const accepted = events["lead_submit_accepted"]?.sessions || 0;
  return (
    <section id="analytics-page" aria-busy={busy}>
      <header className="ana-header">
        <div>
          <span className="ana-eyebrow">ANALYTICS · AQUISIÇÃO NEOTALK</span>
          <h1>Do interesse ao próximo passo.</h1>
          <p>
            Landing e formulário, com dados separados no banco da plataforma.
          </p>
        </div>
        <div className="ana-actions">
          <label>
            Origem
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "access" | "landing")
              }
            >
              <option value="access">Formulário /acesso</option>
              <option value="landing">Landing page</option>
            </select>
          </label>
          <label>
            Período
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={1}>Últimas 24h</option>
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
          </label>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            Atualizar
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="ana-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="ana-notice">
          {message}
        </p>
      )}
      {!settings?.enabled && settings && (
        <p className="ana-notice">
          Coleta desativada. Você pode habilitá-la nas opções abaixo após
          revisar as preferências de privacidade.
        </p>
      )}
      <p className="ana-scope">
        Somente sessões com métricas autorizadas. Visitantes são estimativas de
        navegador, não pessoas únicas. Cliques e respostas aceitas não comprovam
        criação de conta. Contatos permanecem no CRM.
      </p>
      {!report ? (
        <Empty>
          {busy
            ? "Carregando métricas…"
            : "Métricas indisponíveis. Tente atualizar."}
        </Empty>
      ) : (
        <>
          {source === "landing" ? (
            <LandingAnalytics report={report} />
          ) : (
            <>
              <div className="ana-kpis">
                {[
                  [
                    "Navegadores estimados",
                    n(report.totals.visitors),
                    "Visitantes que autorizaram métricas",
                  ],
                  [
                    "Sessões observadas",
                    n(report.totals.sessions),
                    "Sem fingerprinting ou dados de contato",
                  ],
                  [
                    "Envios aceitos",
                    n(accepted),
                    "Resposta do webhook, não commit confirmado",
                  ],
                  [
                    "Conclusão observada",
                    report.totals.funnel_sessions
                      ? `${((accepted / report.totals.funnel_sessions) * 100).toFixed(1)}%`
                      : "—",
                    "Envios / sessões com funil autorizado",
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
                <Card title="Funil do formulário" eyebrow="CONVERSÃO">
                  <p className="ana-small">
                    Sessões distintas por etapa; revisitas não duplicam.
                  </p>
                  {Object.keys(names)
                    .slice(0, 5)
                    .map((key) => (
                      <div className="ana-funnel" key={key}>
                        <span>
                          {names[key]}
                          <small>{n(completed[key])} concluíram</small>
                        </span>
                        <div className="ana-track">
                          <i
                            style={{
                              width: `${((views[key] || 0) / Math.max(1, ...Object.values(views))) * 100}%`,
                            }}
                          />
                        </div>
                        <strong>{n(views[key])}</strong>
                      </div>
                    ))}
                  <p className="ana-summary">
                    {n(report.abandonment.in_progress)} em andamento ·{" "}
                    {n(report.abandonment.provisional)} saídas provisórias
                    (30min–24h) · {n(report.abandonment.consolidated)}{" "}
                    consolidadas (&gt;24h). Retomadas corrigem a estimativa.
                  </p>
                </Card>
                <Card title="Depois do formulário" eyebrow="INTENÇÃO">
                  {[
                    ["form_submit_attempt", "Tentativas de envio"],
                    ["lead_submit_accepted", "Resposta aceita pelo webhook"],
                    ["instagram_cta_click", "Clique no Instagram"],
                    ["platform_cta_click", "Clique na plataforma"],
                    ["redirect_initiated", "Redirecionamento iniciado"],
                  ].map(([key, label]) => (
                    <Row
                      key={key}
                      label={label}
                      value={n(events[key]?.sessions)}
                      detail={`${n(events[key]?.attempts)} eventos · sessões únicas em destaque`}
                    />
                  ))}
                  <h3>Atividade por dia</h3>
                  <div className="ana-daily">
                    {report.daily.map((d) => (
                      <div
                        key={d.day}
                        title={`${d.day}: ${n(d.sessions)} sessões`}
                      >
                        <i
                          style={{
                            height: `${(d.sessions / Math.max(1, ...report.daily.map((v) => v.sessions))) * 70}px`,
                          }}
                        />
                        <small>{d.day.slice(5)}</small>
                      </div>
                    ))}
                  </div>
                  <p className="ana-small">Fuso de Fortaleza (UTC−3).</p>
                </Card>
              </div>
              <div className="ana-grid">
                <Card title="Mapa de calor" eyebrow="EXPERIÊNCIA">
                  <div className="ana-filters">
                    <label>
                      Etapa
                      <select
                        value={step}
                        onChange={(e) => setStep(e.target.value)}
                      >
                        {Object.entries(names)
                          .filter(([k]) => !["contato", "unknown"].includes(k))
                          .map(([key, label]) => (
                            <option key={key} value={key}>
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
                        <option value="mobile">Celular</option>
                        <option value="tablet">Tablet</option>
                        <option value="desktop">Computador</option>
                      </select>
                    </label>
                  </div>
                  <div
                    className="ana-heatmap"
                    role="img"
                    aria-label="Mapa de calor agregado por posição normalizada"
                  >
                    {Array.from({ length: 400 }, (_, i) => {
                      const c = cells.find(
                        (c) => c.x === i % 20 && c.y === Math.floor(i / 20),
                      );
                      return (
                        <i
                          key={i}
                          data-level={
                            c
                              ? Math.max(1, Math.ceil((c.clicks / maxHeat) * 5))
                              : 0
                          }
                          title={`Coluna ${(i % 20) + 1}, linha ${Math.floor(i / 20) + 1}: ${n(c?.clicks)} cliques`}
                        />
                      );
                    })}
                  </div>
                  <p className="ana-small">
                    {cells.length
                      ? `${n(cells.reduce((s, c) => s + c.clicks, 0))} cliques em células com amostra suficiente.`
                      : "Sem amostra suficiente para esta etapa e tela."}
                  </p>
                  <p className="ana-small">
                    Grade do cartão, não gravação de tela. Sem contato ou
                    digitação. Células exigem pelo menos 3 sessões distintas.
                  </p>
                </Card>
                <Card
                  title="Tempo, abandono e falhas"
                  eyebrow="FLUIDEZ DO ACESSO"
                >
                  {report.active.map((a) => (
                    <Row
                      key={a.step}
                      label={names[a.step]}
                      value={`${(a.ms / Math.max(1, a.sessions) / 1000).toFixed(1)}s`}
                      detail="Tempo ativo médio por sessão"
                    />
                  ))}
                  {!report.active.length && <Empty />}
                  <h3>Alcance da rolagem</h3>
                  {report.scroll.map((s) => (
                    <Row
                      key={s.step + s.depth}
                      label={names[s.step]}
                      value={`${s.depth}%`}
                      detail={`${n(s.sessions)} sessões neste marco`}
                    />
                  ))}
                  {!report.scroll.length && <Empty />}
                  <h3>Última etapa antes da saída estimada</h3>
                  {Object.entries(report.last_steps).map(([key, count]) => (
                    <Row
                      key={key}
                      label={names[key] || "Não observada"}
                      value={n(count)}
                    />
                  ))}
                  {!Object.keys(report.last_steps).length && (
                    <Empty>Nenhuma saída estimada no período.</Empty>
                  )}
                  <h3>Erros observados</h3>
                  {report.errors.map((e) => (
                    <Row
                      key={e.name + e.code}
                      label={
                        e.name === "form_validation_error"
                          ? `Validação: ${e.code}`
                          : "Falha de envio"
                      }
                      value={n(e.attempts)}
                    />
                  ))}
                  {!report.errors.length && (
                    <Empty>Nenhuma falha observada nesta amostra.</Empty>
                  )}
                </Card>
              </div>
              <div className="ana-grid">
                <Card title="Campanhas e dispositivos" eyebrow="AQUISIÇÃO">
                  {report.campaigns.map((c, i) => (
                    <Row
                      key={i}
                      label={Object.values(c.campaign).join(" / ")}
                      value={n(c.sessions)}
                    />
                  ))}
                  {!report.campaigns.length && <Empty />}
                  <h3>Dispositivo e idioma</h3>
                  {report.segments.map((s, i) => (
                    <Row
                      key={i}
                      label={`${({ mobile: "Celular", tablet: "Tablet", desktop: "Computador" } as Record<string, string>)[s.device]} · ${s.language === "pt" ? "Português" : "Outro idioma"}`}
                      value={n(s.sessions)}
                    />
                  ))}
                  <p className="ana-small">
                    Localidade indisponível nesta versão. Não coletamos GPS nem
                    consultamos serviços externos de IP. Grupos menores que 3
                    sessões são omitidos.
                  </p>
                </Card>
                <Card title="Interesses observados" eyebrow="QUALIFICAÇÃO">
                  {report.options.map((o) => (
                    <Row
                      key={o.step + o.option}
                      label={options[o.step]?.[o.option] || "Opção"}
                      value={n(o.sessions)}
                      detail={names[o.step]}
                    />
                  ))}
                  {!report.options.length && <Empty />}
                  <p className="ana-small">
                    Última conclusão por etapa e jornada. Nome, e-mail e
                    WhatsApp não fazem parte destes relatórios.
                  </p>
                </Card>
              </div>
            </>
          )}
          {settings && (
            <Card title="Ative só o que for útil." eyebrow="CONTROLE DA COLETA">
              <div className="ana-settings">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) =>
                      setSettings({ ...settings, enabled: e.target.checked })
                    }
                  />{" "}
                  Coleta habilitada
                </label>
                {(Object.keys(groupNames) as (keyof Groups)[]).map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={settings.groups[key]}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          groups: {
                            ...settings.groups,
                            [key]: e.target.checked,
                          },
                        })
                      }
                    />
                    {groupNames[key]}
                  </label>
                ))}
                {(["access", "landing"] as const).map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={settings.sources?.[key] ?? key === "access"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          sources: {
                            access: settings.sources?.access ?? true,
                            landing: settings.sources?.landing ?? false,
                            [key]: e.target.checked,
                          },
                        })
                      }
                    />
                    {key === "landing"
                      ? "Origem: landing page"
                      : "Origem: formulário"}
                  </label>
                ))}
              </div>
              <div className="ana-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  Salvar preferências de coleta
                </button>
                <button className="secondary" onClick={download}>
                  Baixar resumo JSON
                </button>
              </div>
              <p className="ana-small">
                A escolha individual do visitante prevalece. Desativar não apaga
                o histórico. Retenção padrão: 90 dias.
              </p>
            </Card>
          )}
          <footer className="ana-small">
            Atualizado em{" "}
            {new Date(report.generated_at).toLocaleString("pt-BR", {
              timeZone: "America/Fortaleza",
            })}{" "}
            · dados no banco da plataforma
          </footer>
        </>
      )}
    </section>
  );
}
