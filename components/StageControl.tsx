"use client";

import { useEffect, useState } from "react";
import type { StageAdminState, StageTeam } from "@/lib/stage";
import { fmtAvg, StageTimer, useStageStream } from "@/components/StageLive";

// Modo palco — o controle. Operado com uma mão, do celular, no canto do
// palco: botões grandes, uma ação por toque, erro em uma linha. Cada ação
// manda `from` (o time que esta tela via no palco) — dois operadores ou
// duplo toque viram 409 "o palco já mudou", nunca um pitch pulado.

const PITCH_OPTIONS = [120, 180, 240, 300, 420, 600];

export function StageControl({ hackathonId, initial }: { hackathonId: string; initial: StageAdminState }) {
  const { snap, conn, setSnap } = useStageStream(hackathonId, initial.snapshot);
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // fila/ranking parcial: o stream público não carrega isso — atualiza a cada 5s
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/admin/hackathons/${hackathonId}/stage`, { cache: "no-store" });
        if (r.ok) setState(await r.json());
      } catch {
        // rede caiu: segue com o último estado
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [hackathonId]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      const r = await fetch(`/api/admin/hackathons/${hackathonId}/stage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setState(d as StageAdminState);
        setSnap((d as StageAdminState).snapshot);
      } else {
        setError(typeof d.error === "string" ? d.error : `erro ${r.status}`);
      }
    } catch {
      setError("sem conexão — tenta de novo");
    } finally {
      setBusy(null);
    }
  }

  const cur = snap.current;
  const from = cur?.teamId ?? null;
  const queueIds = state.queue.map((t) => t.teamId);
  const outside = state.candidates.filter((c) => !queueIds.includes(c.teamId));
  const ended = snap.status === "ended";
  const saveQueue = (ids: number[]) => act("queue", { teamIds: ids });
  const move = (i: number, d: -1 | 1) => {
    const ids = [...queueIds];
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void saveQueue(ids);
  };
  const isLast = cur !== null && cur.position >= snap.total;

  return (
    <div className="flex w-full max-w-xl flex-col gap-5" data-testid="stage-control">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[12px]">
        <span className="tag uppercase">
          {snap.status === "idle" ? "aguardando" : ended ? "encerrada" : "ao vivo"}
        </span>
        <span className={conn === "ao vivo" ? "text-accent" : "text-orange"}>● {conn}</span>
      </div>

      {error && (
        <p role="alert" className="border-[1.5px] border-orange px-3 py-2 font-mono text-[13px] text-orange">
          {error}
        </p>
      )}

      {/* AGORA: quem está no palco + cronômetro */}
      <div className="window dark hard">
        <div className="tbar">
          <span className="title">{cur ? `NO PALCO · ${cur.position}/${snap.total}` : "PALCO VAZIO"}</span>
          <span className="dots" aria-hidden>
            <b />
            <b />
          </span>
        </div>
        <div className="tbody gap-3 p-4!">
          {cur ? (
            <div className="min-w-0">
              <p className="truncate text-[20px] leading-tight font-extrabold text-background">{cur.title}</p>
              <p className="truncate font-mono text-[13px] text-mint">time {cur.teamName}</p>
            </div>
          ) : (
            <p className="font-mono text-[13px] text-mint">
              {ended
                ? "final encerrada — o telão mostra o ranking"
                : state.queue.length
                  ? "ninguém no palco — toca em começar/próximo"
                  : "monte a fila lá embaixo"}
            </p>
          )}
          <StageTimer timer={snap.timer} className="text-[64px]" showBar />
          <div className="grid grid-cols-2 gap-2">
            {snap.timer.running ? (
              <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => act("timer-pause")}>
                ❚❚ pausar
              </button>
            ) : (
              <button type="button" className="btn-ghost" disabled={!!busy || !cur} onClick={() => act("timer-start")}>
                ▶ iniciar tempo
              </button>
            )}
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => act("timer-reset")}>
              ↺ zerar
            </button>
          </div>
          <label className="flex items-center justify-between gap-3 font-mono text-[13px] text-mint">
            tempo de pitch
            <select
              value={snap.timer.pitchSeconds}
              disabled={!!busy}
              onChange={(e) => act("pitch-seconds", { seconds: Number(e.target.value) })}
              className="rounded-[6px] border border-band bg-foreground px-2 py-1 text-band"
            >
              {[...new Set([...PITCH_OPTIONS, snap.timer.pitchSeconds])]
                .sort((a, b) => a - b)
                .map((s) => (
                  <option key={s} value={s}>
                    {s % 60 === 0 ? `${s / 60} min` : `${s}s`}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>

      {/* navegação */}
      {!ended && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn-ghost min-h-14!"
            disabled={!!busy || !cur || cur.position <= 1}
            onClick={() => act("prev", { from })}
          >
            ◀ anterior
          </button>
          <button
            type="button"
            className="btn min-h-14!"
            disabled={!!busy || state.queue.length === 0 || isLast}
            onClick={() => act("next", { from })}
            data-testid="stage-next"
          >
            {cur ? "próximo ▶" : "começar ▶"}
          </button>
        </div>
      )}

      {/* votação do pitch atual */}
      {cur && !ended && (
        <div className="flex flex-col gap-3 border-[1.5px] border-line p-4">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => act(snap.votingOpen ? "voting-close" : "voting-open")}
            className={`${snap.votingOpen ? "btn-ghost border-orange! text-orange" : "btn"} min-h-14! w-full`}
          >
            {snap.votingOpen ? "■ fechar votação" : "● abrir votação"}
          </button>
          {snap.tally && (
            <div className="flex items-baseline justify-between gap-3 font-mono text-[13px]">
              <span>
                {snap.votingOpen ? "votando agora" : "votação fechada"} · {snap.tally.count}{" "}
                {snap.tally.count === 1 ? "voto" : "votos"}
              </span>
              <span className="pix text-[28px] leading-none">{fmtAvg(snap.tally.avg)}</span>
            </div>
          )}
        </div>
      )}

      {/* fila */}
      <div className="window paper">
        <div className="tbar">
          <span className="title">FILA.exe · {state.queue.length} pitches</span>
        </div>
        <div className="tbody gap-3 p-0!">
          {state.queue.length === 0 ? (
            <div className="flex flex-col gap-3 p-4">
              <p className="font-mono text-[13px] text-muted">
                {state.candidates.length
                  ? "fila vazia — adiciona os times na ordem dos pitches"
                  : "nenhum time com projeto cadastrado nesta edição ainda"}
              </p>
              {state.candidates.length > 0 && !ended && (
                <button
                  type="button"
                  className="btn w-full"
                  disabled={!!busy}
                  onClick={() => saveQueue(state.candidates.map((c) => c.teamId))}
                >
                  usar todos os {state.candidates.length} times
                </button>
              )}
            </div>
          ) : (
            <ol>
              {state.queue.map((t, i) => (
                <QueueRow
                  key={t.teamId}
                  team={t}
                  index={i}
                  last={i === state.queue.length - 1}
                  onStage={t.teamId === cur?.teamId}
                  disabled={!!busy || ended}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                  onRemove={() => saveQueue(queueIds.filter((id) => id !== t.teamId))}
                  onGo={() => act("goto", { teamId: t.teamId })}
                />
              ))}
            </ol>
          )}
          {outside.length > 0 && !ended && state.queue.length > 0 && (
            <div className="flex flex-col gap-2 border-t-2 border-line p-4">
              <p className="font-mono text-[12px] tracking-widest text-muted uppercase">fora da fila</p>
              {outside.map((c) => (
                <button
                  key={c.teamId}
                  type="button"
                  disabled={!!busy}
                  onClick={() => saveQueue([...queueIds, c.teamId])}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-[6px] border border-line px-3 text-left text-[14px] hover:bg-mint"
                >
                  <span className="min-w-0 truncate">{c.title}</span>
                  <span className="shrink-0 font-mono text-[12px] text-accent">+ adicionar</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ranking parcial — só aqui; o público vê no fim */}
      {state.ranking.some((r) => r.votes > 0) && (
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-[12px] tracking-widest text-muted uppercase">
            parcial · só a organização vê
          </h3>
          <ol className="border-b border-line">
            {state.ranking.map((r) => (
              <li key={r.teamId} className="flex items-baseline gap-3 border-t border-line py-2 text-[14px]">
                <span className="pix w-8 text-[20px]">{r.avg === null ? "—" : `${r.position}º`}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="shrink-0 font-mono text-[12px] text-muted">
                  {fmtAvg(r.avg)} · {r.votes}v{r.tied ? " · empate" : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <a href={`/h/${hackathonId}/telao`} target="_blank" rel="noopener" className="btn-ghost text-[14px]!">
          abrir telão ↗
        </a>
        <a href={`/h/${hackathonId}/votar`} target="_blank" rel="noopener" className="btn-ghost text-[14px]!">
          tela de voto ↗
        </a>
      </div>

      {snap.status === "live" && (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => {
            if (window.confirm("Encerrar a final? Fecha a votação e revela o ranking no telão.")) void act("end");
          }}
          className="btn-ghost w-full border-orange! text-orange"
        >
          encerrar final e revelar ranking
        </button>
      )}
      {ended && (
        <button type="button" disabled={!!busy} onClick={() => act("reopen")} className="btn-ghost w-full">
          reabrir final (desfaz o encerramento)
        </button>
      )}
    </div>
  );
}

function QueueRow({
  team,
  index,
  last,
  onStage,
  disabled,
  onUp,
  onDown,
  onRemove,
  onGo,
}: {
  team: StageTeam;
  index: number;
  last: boolean;
  onStage: boolean;
  disabled: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  onGo: () => void;
}) {
  const icon = "flex size-10 items-center justify-center rounded-[6px] border border-line font-mono text-[14px] disabled:opacity-30";
  return (
    <li className={`flex items-center gap-2 border-b border-line px-3 py-2 ${onStage ? "bg-mint" : ""}`}>
      <span className="pix w-7 shrink-0 text-[22px] text-accent">{String(index + 1).padStart(2, "0")}</span>
      <button
        type="button"
        onClick={onGo}
        disabled={disabled || onStage}
        className="min-w-0 flex-1 text-left"
        title="pôr no palco"
      >
        <span className="block truncate text-[14px] font-semibold">{team.title}</span>
        <span className="block truncate font-mono text-[11px] text-muted">
          {onStage ? "● no palco" : `${team.teamName} · tocar = pôr no palco`}
        </span>
      </button>
      <button type="button" aria-label="subir" className={icon} disabled={disabled || index === 0} onClick={onUp}>
        ↑
      </button>
      <button type="button" aria-label="descer" className={icon} disabled={disabled || last} onClick={onDown}>
        ↓
      </button>
      <button type="button" aria-label="tirar da fila" className={icon} disabled={disabled || onStage} onClick={onRemove}>
        ✕
      </button>
    </li>
  );
}
