"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Abrir e encerrar as 4 semanas depois (spec 046, onda 5, migration 052).
// Quem organiza a edição abre (2 a 8 semanas, padrão 4) e pode encerrar antes
// do prazo com um motivo — o motivo aparece na página pública pros times.

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, error: "Sem conexão. Tente de novo." };
  const data = await res.json().catch(() => null);
  return { ok: res.ok, error: res.ok ? null : userMessage(res, data, "Não deu certo. Tente de novo.") };
}

export function FollowThroughAdmin({
  hackathonId,
  open,
  closed,
  startsAtInput,
  weeks,
}: {
  hackathonId: string;
  /** o período já está aberto */
  open: boolean;
  /** já encerrado (no fim ou antes do prazo) */
  closed: boolean;
  /** valor do <input type="datetime-local"> (Brasília) */
  startsAtInput: string;
  weeks: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openWeeks, setOpenWeeks] = useState(String(weeks));
  const [start, setStart] = useState(startsAtInput);
  const [reason, setReason] = useState("");

  async function submitOpen(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await call(`/api/hackathons/${hackathonId}/quatro-semanas`, "POST", {
      weeks: Number(openWeeks),
      startsAt: start.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  async function submitClose(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!window.confirm("Encerrar as 4 semanas antes do prazo? O selo só sai no fim.")) return;
    setBusy(true);
    setError(null);
    const r = await call(`/api/hackathons/${hackathonId}/quatro-semanas/close`, "POST", { reason });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setReason("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4" data-testid="ft-admin">
      {!open && (
        <form onSubmit={submitOpen} className="flex flex-col gap-3 border-[1.5px] border-line p-4" data-testid="ft-admin-form">
          <h3 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">abrir as 4 semanas</h3>
          <p className="text-[14px] text-muted">
            Os times que entregaram projeto entram até o fim da primeira semana. Cada semana vale uma atualização no
            diário do projeto, e quem fecha todas leva o selo quatro semanas.
          </p>
          <label className="flex flex-col gap-1 font-mono text-[12px] text-muted">
            semanas
            <input
              type="number"
              min={2}
              max={8}
              value={openWeeks}
              onChange={(e) => setOpenWeeks(e.target.value)}
              className={`${input} max-w-24`}
              data-testid="ft-admin-weeks"
            />
          </label>
          <label className="flex flex-col gap-1 font-mono text-[12px] text-muted">
            começa em (Brasília, opcional)
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={`${input} max-w-64`}
              data-testid="ft-admin-start"
            />
          </label>
          <div>
            <button type="submit" disabled={busy} className="btn min-h-11! rounded-[6px] font-mono font-semibold" data-testid="ft-admin-abrir">
              abrir as 4 semanas
            </button>
          </div>
        </form>
      )}

      {open && !closed && (
        <form onSubmit={submitClose} className="flex flex-col gap-3 border-[1.5px] border-line p-4">
          <h3 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">encerrar antes do prazo</h3>
          <p className="text-[14px] text-muted">
            O motivo aparece na página dos times. Encerrar antes do fim não concede o selo.
          </p>
          <label className="flex flex-col gap-1 font-mono text-[12px] text-muted">
            motivo
            <input
              type="text"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="por exemplo: o time de manutenção encerrou o acompanhamento"
              className={input}
              data-testid="ft-admin-motivo"
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={busy || reason.trim().length < 3}
              className="btn-ghost min-h-11! rounded-[6px] font-mono font-semibold"
              data-testid="ft-admin-encerrar"
            >
              encerrar as 4 semanas
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="font-mono text-[12.5px] text-orange" data-testid="ft-admin-erro">
          {error}
        </p>
      )}
    </div>
  );
}
