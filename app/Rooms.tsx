"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "./apiClient";

type RoomStatus = "ready" | "live" | "finished";
type Batch = { id: string; sequence: number; text: string; gloss_text?: string | null; status: string; created_at: string };
type Room = {
  id: string; name: string; avatar: string; status: RoomStatus; started_at: string | null;
  ended_at?: string | null; created_at: string; duration_seconds: number; batch_count: number; batches?: Batch[];
};

function durationLabel(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}min`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const statusLabels: Record<RoomStatus, string> = { ready: "Preparando", live: "Ao vivo", finished: "Finalizada" };

export default function Rooms({ onCreate, diagnostics = false }: { onCreate: () => void; diagnostics?: boolean }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | RoomStatus>("all");
  const [openRoomId, setOpenRoomId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Room>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const loadRooms = async () => {
    try {
      const result = await apiRequest<Room[]>("/rooms");
      setRooms(result);
      setNotice("");
    } catch {
      setNotice("O histórico não pôde ser atualizado agora. Tente novamente em instantes.");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void apiRequest<Room[]>("/rooms")
      .then((result) => { setRooms(result); setNotice(""); })
      .catch(() => setNotice("O histórico não pôde ser atualizado agora. Tente novamente em instantes."))
      .finally(() => setLoading(false));
  }, []);

  const visibleRooms = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return rooms.filter((room) => (status === "all" || room.status === status) && (!term || room.name.toLocaleLowerCase("pt-BR").includes(term)));
  }, [rooms, search, status]);

  const toggleTranscript = async (room: Room) => {
    if (openRoomId === room.id) { setOpenRoomId(null); return; }
    setOpenRoomId(room.id);
    if (details[room.id]) return;
    setDetailLoading(room.id);
    try {
      const detail = await apiRequest<Room>(`/rooms/${room.id}`);
      setDetails((current) => ({ ...current, [room.id]: detail }));
    } catch {
      setNotice("Não foi possível abrir esta transcrição agora.");
      setOpenRoomId(null);
    } finally { setDetailLoading(null); }
  };

  return <>
    <div className="page-heading"><div><p className="eyebrow">TRANSMISSÕES</p><h1>Salas ao vivo</h1><p>Crie uma sala, capture o microfone e consulte as transmissões realizadas.</p></div><button className="primary" onClick={onCreate}>＋ Criar sala ao vivo</button></div>
    {notice && <div className="history-notice" role="status"><span>{notice}</span><button onClick={() => void loadRooms()}>Tentar novamente</button></div>}
    <div className="filter-bar"><div className="search">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar sala..." /></div><select className="secondary" aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Todos os status</option><option value="live">Ao vivo</option><option value="finished">Finalizadas</option><option value="ready">Preparando</option></select></div>
    <div className="instance-grid">
      {loading && <div className="rooms-empty"><span>◉</span><h3>Carregando suas salas…</h3></div>}
      {!loading && !rooms.length && <div className="rooms-empty"><span>⌁</span><h3>Nenhuma transmissão ainda</h3><p>Crie a primeira sala e ela aparecerá aqui quando for iniciada.</p><button className="primary" onClick={onCreate}>Criar sala ao vivo</button></div>}
      {!loading && rooms.length > 0 && !visibleRooms.length && <div className="rooms-empty"><span>⌕</span><h3>Nenhuma sala encontrada</h3><p>Altere a busca ou o filtro para ver outras transmissões.</p></div>}
      {visibleRooms.map((room, index) => {
        const transcript = details[room.id]?.batches || [];
        const opened = openRoomId === room.id;
        return <article className={`instance-card ${opened ? "expanded" : ""}`} key={room.id}>
          <div className="instance-cover"><span className="instance-number">{String(index + 1).padStart(2, "0")}</span><div className="tiny-figure"><i/><i/></div><span className={`pill good ${room.status === "live" ? "live" : ""}`}><i className="status-dot" /> {statusLabels[room.status]}</span></div>
          <h3>{room.name}</h3><p>{dateLabel(room.started_at || room.created_at)}</p>
          <div className="instance-meta"><span>◷ {durationLabel(room.duration_seconds)}</span><span>{room.batch_count} {room.batch_count === 1 ? "trecho" : "trechos"}</span></div>
          <button className="secondary wide" onClick={() => void toggleTranscript(room)}>{detailLoading === room.id ? "Abrindo…" : opened ? "Fechar transcrição" : "Ver transcrição"}</button>
          {opened && <div className="room-transcript">{transcript.length ? transcript.map((batch) => <div className="transcript-line" key={batch.id}><span>{String(batch.sequence).padStart(2, "0")}</span><p>{batch.text}{diagnostics && batch.gloss_text && <small>Glosas: {batch.gloss_text}</small>}</p>{diagnostics && <em>{batch.status}</em>}</div>) : detailLoading !== room.id && <p className="transcript-empty">Nenhuma fala foi registrada nesta sala.</p>}</div>}
        </article>;
      })}
    </div>
  </>;
}
