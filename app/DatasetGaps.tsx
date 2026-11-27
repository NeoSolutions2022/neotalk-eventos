"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "./apiClient";

type Gap = { term: string; occurrences: number; last_seen_at: string; live_occurrences?: number; quality_occurrences?: number };
type Coverage = { checked: number; covered: number; batches: number; days: number };
type GapPage = { items: Gap[]; has_next: boolean; coverage?: Coverage };
const number = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export default function DatasetGaps() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<GapPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [observedLive, setObservedLive] = useState(true);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void apiRequest<GapPage>(`/admin/dataset-gaps?observed_live=${observedLive}&page=${page}&page_size=25&search=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setReport(result); })
      .catch(() => { if (!controller.signal.aborted) setError("Não foi possível consultar os termos. Tente atualizar."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, page, refresh, query, observedLive]);

  const reload = (nextPage = page) => {
    setLoading(true);
    setError("");
    setPage(nextPage);
    setRefresh(value => value + 1);
  };

  const coverage = report?.coverage;
  return <section>
    <div className="quality-section-title"><div><b>Cobertura do dataset · sala ao vivo</b><small>Palavras da fala comparadas com o catálogo sincronizado.</small></div></div>
    <button className="secondary wide" type="button" aria-expanded={open} aria-controls="dataset-gaps-list" onClick={() => { if (!open) reload(); setOpen(!open); }}>{open ? "Ocultar termos" : "Consultar termos ausentes"}</button>
    {open && <div id="dataset-gaps-list" aria-busy={loading}>
      <label>Origem dos termos{" "}
        <select value={observedLive ? "live" : "suggestions"} onChange={event => { setObservedLive(event.target.value === "live"); reload(1); }}>
          <option value="live">Palavras observadas ao vivo</option>
          <option value="suggestions">Sugestões do agente (histórico)</option>
        </select>
      </label>
      {observedLive && !loading && !error && coverage && <div className="quality-history-empty">
        <b>{coverage.checked ? percent.format(coverage.covered / coverage.checked) : "Ainda sem amostra"} · últimos {coverage.days} dias</b>
        <p>{number.format(coverage.covered)} de {number.format(coverage.checked)} palavras no catálogo · {number.format(coverage.checked - coverage.covered)} ausentes · {number.format(coverage.batches)} trechos medidos</p>
      </div>}
      <p><small>{observedLive
        ? "Cobertura literal do catálogo, não precisão da tradução em Libras. A taxa representa o catálogo da época da fala; termos adicionados saem da lista de ausências. Este relatório não guarda frases completas."
        : "Sugestões históricas do agente, separadas das palavras realmente observadas. Precisam de revisão do QA."}</small></p>
      <form className="quality-audio-actions" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); reload(1); }}>
        <input maxLength={96} aria-label="Filtrar palavras ausentes" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar palavra" />
        <button type="submit" disabled={loading}>Buscar</button>
      </form>
      {loading && <p role="status">Consultando…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && report?.items.length === 0 && <p>Nenhuma lacuna registrada nesta página.</p>}
      {!loading && !error && report?.items.map(item => <div className="quality-history-empty" key={item.term}>
        <b>{item.term.replaceAll("_", " ")}</b><p>{observedLive
          ? `${number.format(item.occurrences)} ocorrências ao vivo`
          : `${number.format(item.occurrences)} sugestões · ${number.format(item.live_occurrences ?? 0)} no fluxo de tradução · ${number.format(item.quality_occurrences ?? 0)} no QA`}</p><small>Última: {new Date(item.last_seen_at).toLocaleString("pt-BR")}</small>
      </div>)}
      <div className="quality-audio-actions">
        <button type="button" disabled={loading || page === 1} onClick={() => reload(page - 1)}>Anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={loading || !report?.has_next} onClick={() => reload(page + 1)}>Próxima</button>
        <button type="button" disabled={loading} onClick={() => reload()}>Atualizar</button>
      </div>
    </div>}
  </section>;
}
