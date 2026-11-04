"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Entrar nas 4 semanas depois (spec 046, onda 5, migration 052): o time que
// entregou projeto na edição entra pelo integrante, até o fim da semana 1.
// Depois de entrar, a página mostra a semana em curso e o link pro diário.

export function FollowThroughJoin({
  hackathonId,
  teams,
}: {
  hackathonId: string;
  teams: { teamId: number; name: string }[];
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(teams[0]?.teamId ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/hackathons/${hackathonId}/quatro-semanas/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(userMessage(res, data, "Não deu certo. Tente de novo."));
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2 border-[1.5px] border-line p-4" data-testid="ft-entrar">
      <h2 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">entrar com o seu time</h2>
      <p className="text-[15px]">
        Time que entregou projeto na edição entra até o fim da primeira semana. Cada semana vale uma atualização no
        diário do projeto.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {teams.length > 1 && (
          <select
            aria-label="time"
            value={teamId}
            onChange={(e) => setTeamId(Number(e.target.value))}
            className="min-h-11 w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 text-[15px] focus:border-accent focus:outline-none sm:w-auto"
            data-testid="ft-entrar-time"
          >
            {teams.map((t) => (
              <option key={t.teamId} value={t.teamId}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={join}
          disabled={busy}
          aria-busy={busy || undefined}
          className="btn min-h-11! rounded-[6px] font-mono font-semibold"
          data-testid="ft-entrar-enviar"
        >
          {teams.length > 1 ? "entrar com o time escolhido" : `entrar com ${teams[0]?.name ?? "o time"}`}
        </button>
      </div>
      {error && (
        <p role="alert" className="font-mono text-[12.5px] text-orange" data-testid="ft-entrar-erro">
          {error}
        </p>
      )}
    </section>
  );
}
