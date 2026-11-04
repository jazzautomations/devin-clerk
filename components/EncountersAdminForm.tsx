"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Liga/desliga os encontros e as missões da edição (spec 046, onda 5).
// Missões nascem desligadas: são sugestão, nunca etapa. A página é do
// organizador e mostra só número agregado.

export function EncountersAdminForm({
  hackathonId,
  encountersOn,
  missionsOn,
}: {
  hackathonId: string;
  encountersOn: boolean;
  missionsOn: boolean;
}) {
  const [on, setOn] = useState(encountersOn);
  const [missions, setMissions] = useState(missionsOn);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setMsg(null);
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/encounters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) return setError(res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo.");
    const next = data as { encountersOn?: boolean; missionsOn?: boolean } | null;
    if (typeof next?.encountersOn === "boolean") setOn(next.encountersOn);
    if (typeof next?.missionsOn === "boolean") setMissions(next.missionsOn);
    setMsg("Salvo.");
  }

  return (
    <div className="flex flex-col gap-4" data-testid="admin-encontros-form">
      <div className="flex flex-col gap-1.5 border-[1.5px] border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Encontros na edição</p>
            <p className="text-[13px] text-muted">
              Quem fez check-in lê o código do bicho de alguém, os dois confirmam e o contato aparece.
            </p>
          </div>
          <button
            type="button"
            onClick={() => save({ on: !on })}
            disabled={busy}
            aria-pressed={on}
            className={`inline-flex min-h-[44px] items-center rounded-[6px] border-[1.5px] px-3 font-mono text-[13px] transition disabled:opacity-60 ${
              on ? "border-accent bg-mint text-accent-hi" : "border-line hover:border-foreground"
            }`}
            data-testid="admin-encontros-toggle"
          >
            {on ? "ligados" : "desligados"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-[1.5px] border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Sugestões de missão</p>
            <p className="text-[13px] text-muted">
              Primeira viagem, um mentor, outra faculdade ou cidade e ponte. Sugestão: nada trava sem elas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => save({ missions: !missions })}
            disabled={busy || !on}
            aria-pressed={missions}
            className={`inline-flex min-h-[44px] items-center rounded-[6px] border-[1.5px] px-3 font-mono text-[13px] transition disabled:opacity-60 ${
              missions ? "border-accent bg-mint text-accent-hi" : "border-line hover:border-foreground"
            }`}
            data-testid="admin-missoes-toggle"
          >
            {missions ? "ligadas" : "desligadas"}
          </button>
        </div>
      </div>

      {msg && (
        <p role="status" className="font-mono text-[12.5px] text-accent-hi">
          {msg}
        </p>
      )}
      {error && (
        <p role="alert" className="font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}
