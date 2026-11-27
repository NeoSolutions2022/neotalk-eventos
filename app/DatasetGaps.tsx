"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE, apiRequest } from "./apiClient";
import "./dataset-gaps.css";

type Gap = { term: string; occurrences: number; last_seen_at: string; live_occurrences?: number; quality_occurrences?: number };
type Coverage = { checked: number; covered: number; batches: number; days: number };
type GapPage = { items: Gap[]; has_next: boolean; coverage?: Coverage };
const number = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export default function DatasetGaps() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<GapPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [observedLive, setObservedLive] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

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
  const exportCsv = async () => {
    setExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams({ observed_live: String(observedLive), search: query });
      const response = await fetch(`${API_BASE}/admin/dataset-gaps/export.csv?${params}`, {
        credentials: "include",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : "Não foi possível gerar a planilha.");
      }
      const file = await response.blob();
      if (!file.type.includes("text/csv")) throw new Error("A API não retornou um CSV válido.");
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = observedLive ? "neotalk-palavras-ausentes-ao-vivo.csv" : "neotalk-sugestoes-dataset.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) {
      setExportError(reason instanceof Error && reason.name === "Error" ? reason.message : "Não foi possível baixar a planilha. Tente novamente.");
    } finally {
      setExporting(false);
    }
  };
  return <section>
    <div className="quality-section-title"><div><b>Cobertura do dataset · sala ao vivo</b><small>Palavras da fala comparadas com o catálogo sincronizado.</small></div></div>
    <button className="secondary wide" type="button" aria-haspopup="dialog" aria-controls="dataset-gaps-dialog" onClick={() => {
      dialogRef.current?.showModal();
      reload(1);
      setOpen(true);
    }}>Ver panorama de palavras ausentes</button>
    <dialog ref={dialogRef} id="dataset-gaps-dialog" className="dataset-gaps-dialog" aria-labelledby="dataset-gaps-title" onClose={() => setOpen(false)}>
      <header className="dataset-gaps-header">
        <div><h2 id="dataset-gaps-title">Panorama de palavras ausentes</h2><p>Dataset da sala ao vivo · últimos 30 dias</p></div>
        <button type="button" className="secondary" onClick={() => dialogRef.current?.close()}>Fechar</button>
      </header>
      <div className="dataset-gaps-body" aria-busy={loading}>
      <label>Origem dos termos{" "}
        <select value={observedLive ? "live" : "suggestions"} onChange={event => { setObservedLive(event.target.value === "live"); reload(1); }}>
          <option value="live">Palavras observadas ao vivo</option>
          <option value="suggestions">Sugestões do agente (histórico)</option>
        </select>
      </label>
      {observedLive && !loading && !error && coverage && <dl className="dataset-gaps-kpis">
        <div><dt>Cobertura</dt><dd>{coverage.checked ? percent.format(coverage.covered / coverage.checked) : "Sem amostra"}</dd></div>
        <div><dt>Palavras verificadas</dt><dd>{number.format(coverage.checked)}</dd></div>
        <div><dt>Palavras ausentes</dt><dd>{number.format(coverage.checked - coverage.covered)}</dd></div>
        <div><dt>Trechos medidos</dt><dd>{number.format(coverage.batches)}</dd></div>
      </dl>}
      <p><small>{observedLive
        ? "Cobertura literal do catálogo, não precisão da tradução em Libras. A taxa representa o catálogo da época da fala; termos adicionados saem da lista de ausências. Este relatório não guarda frases completas."
        : "Sugestões históricas do agente, separadas das palavras realmente observadas. Precisam de revisão do QA."}</small></p>
      <form className="quality-audio-actions" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); reload(1); }}>
        <input maxLength={96} aria-label="Filtrar palavras ausentes" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar palavra" />
        <button type="submit" disabled={loading}>Buscar</button>
        <button type="button" disabled={exporting || loading} onClick={() => void exportCsv()}>
          {exporting ? "Gerando planilha…" : "Baixar planilha (CSV)"}
        </button>
      </form>
      {loading && <p role="status">Consultando…</p>}
      {error && <p role="alert">{error}</p>}
      {exportError && <p role="alert">{exportError}</p>}
      {!loading && !error && report?.items.length === 0 && <p>Nenhuma lacuna registrada nesta página.</p>}
      {!loading && !error && <div className="dataset-gaps-results">{report?.items.map(item => <div className="quality-history-empty" key={item.term}>
        <b>{item.term.replaceAll("_", " ")}</b><p>{observedLive
          ? `${number.format(item.occurrences)} ocorrências ao vivo`
          : `${number.format(item.occurrences)} sugestões · ${number.format(item.live_occurrences ?? 0)} no fluxo de tradução · ${number.format(item.quality_occurrences ?? 0)} no QA`}</p><small>Última: {new Date(item.last_seen_at).toLocaleString("pt-BR")}</small>
      </div>)}</div>}
      <div className="quality-audio-actions">
        <button type="button" disabled={loading || page === 1} onClick={() => reload(page - 1)}>Anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={loading || !report?.has_next} onClick={() => reload(page + 1)}>Próxima</button>
        <button type="button" disabled={loading} onClick={() => reload()}>Atualizar</button>
      </div>
      </div>
    </dialog>
  </section>;
}
