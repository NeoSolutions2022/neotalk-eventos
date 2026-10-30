"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "./apiClient";

type Gap = { term: string; occurrences: number; live_occurrences: number; quality_occurrences: number; last_seen_at: string };
type GapPage = { items: Gap[]; has_next: boolean };

export default function DatasetGaps() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<GapPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void apiRequest<GapPage>(`/admin/dataset-gaps?page=${page}&page_size=25`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setReport(result); })
      .catch(() => { if (!controller.signal.aborted) setError("Não foi possível consultar os termos. Tente atualizar."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, page, refresh]);

  const reload = (nextPage = page) => {
    setLoading(true);
    setError("");
    setPage(nextPage);
    setRefresh(value => value + 1);
  };

  return <section>
    <div className="quality-section-title"><div><b>Sinais a adicionar</b><small>Conceitos sugeridos pelo agente, por frequência. Precisam de revisão do QA.</small></div></div>
    <button className="secondary wide" type="button" aria-expanded={open} aria-controls="dataset-gaps-list" onClick={() => { if (!open) reload(); setOpen(!open); }}>{open ? "Ocultar termos" : "Consultar termos ausentes"}</button>
    {open && <div id="dataset-gaps-list" aria-busy={loading}>
      <p><small>Termos já presentes no catálogo sincronizado ficam ocultos. Não armazenamos a fala completa neste relatório.</small></p>
      {loading && <p role="status">Consultando…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && report?.items.length === 0 && <p>Nenhuma lacuna registrada nesta página.</p>}
      {!loading && !error && report?.items.map(item => <div className="quality-history-empty" key={item.term}>
        <b>{item.term.replaceAll("_", " ")}</b><p>{item.occurrences} ocorrências · {item.live_occurrences} ao vivo · {item.quality_occurrences} no QA</p><small>Última: {new Date(item.last_seen_at).toLocaleString("pt-BR")}</small>
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
