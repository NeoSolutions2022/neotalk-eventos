"use client";

import { useEffect, useState } from "react";

type Room = {
  id: string;
  name: string;
  avatar: string;
  status: "ready" | "live" | "finished";
  started_at: string | null;
  created_at: string;
  duration_seconds: number;
  batch_count: number;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

function durationLabel(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}min`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const statusLabels = { ready: "Pronta", live: "Ao vivo", finished: "Finalizada" };

export default function Rooms({ onCreate }: { onCreate: () => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/rooms`)
      .then((response) => {
        if (!response.ok) throw new Error("Falha ao carregar salas");
        return response.json() as Promise<Room[]>;
      })
      .then(setRooms)
      .catch(() => setError("Não foi possível carregar o histórico agora."))
      .finally(() => setLoading(false));
  }, []);

  return <>
    <div className="page-heading"><div><p className="eyebrow">TRANSMISSÕES</p><h1>Salas ao vivo</h1><p>Crie uma sala, capture o microfone e acompanhe as sessões realizadas.</p></div><button className="primary" onClick={onCreate}>＋ Criar sala ao vivo</button></div>
    <div className="filter-bar"><div className="search">⌕ <input placeholder="Buscar sala..." /></div><button className="secondary">Todas as datas ⌄</button><button className="secondary">Todos os status ⌄</button></div>
    <div className="instance-grid">
      {loading && <div className="rooms-empty"><span>◉</span><h3>Carregando suas salas…</h3></div>}
      {!loading && error && <div className="rooms-empty error"><span>!</span><h3>{error}</h3><p>Confirme se o backend está em execução.</p></div>}
      {!loading && !error && !rooms.length && <div className="rooms-empty"><span>⌁</span><h3>Nenhuma sala realizada ainda</h3><p>Crie a primeira sala e o histórico aparecerá aqui automaticamente.</p><button className="primary" onClick={onCreate}>Criar sala ao vivo</button></div>}
      {rooms.map((room, index) => <article className="instance-card" key={room.id}><div className="instance-cover"><span className="instance-number">{String(index + 1).padStart(2, "0")}</span><div className="tiny-figure"><i/><i/></div><span className={`pill good ${room.status === "live" ? "live" : ""}`}><i className="status-dot" /> {statusLabels[room.status]}</span></div><h3>{room.name}</h3><p>{dateLabel(room.started_at || room.created_at)}</p><div className="instance-meta"><span>◷ {durationLabel(room.duration_seconds)}</span><span>{room.batch_count} lotes · {room.avatar.toUpperCase()}</span></div><button className="secondary wide">Ver transcrição</button></article>)}
    </div>
  </>;
}
