"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Vagas da edição (aba configurar). Morava no topo do editor de perguntas;
// é configuração da edição, junto de datas e curadoria. Aumentar promove a
// fila de espera na hora.
export function CapacityForm({
  hackathonId,
  capacity,
  approved,
  waitlist,
}: {
  hackathonId: string;
  capacity: number | null;
  approved: number;
  waitlist: number;
}) {
  const router = useRouter();
  const [cap, setCap] = useState(capacity === null ? "" : String(capacity));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const value = cap.trim() === "" ? null : Number(cap);
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/capacity`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: value }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setMsg({ kind: "error", text: typeof data?.error === "string" ? data.error : "Não deu pra salvar. Tente de novo." });
      return;
    }
    const promoted = Array.isArray(data?.promoted) ? data.promoted.length : 0;
    setMsg({
      kind: "ok",
      text: `salvo${promoted ? ` · ${promoted} ${promoted === 1 ? "pessoa saiu" : "pessoas saíram"} da fila` : ""}`,
    });
    router.refresh();
  }

  const field =
    "w-36 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] text-foreground focus:border-accent focus:outline-none";

  return (
    <form onSubmit={save} className="flex flex-col gap-2 border-[1.5px] border-line p-4" data-testid="capacity-form">
      <label htmlFor="capacity" className="font-mono text-[12px] tracking-widest text-muted uppercase">
        vagas da edição
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="capacity"
          inputMode="numeric"
          placeholder="sem limite"
          className={field}
          value={cap}
          onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))}
        />
        <button type="submit" disabled={busy} className="btn rounded-[6px]">
          salvar vagas
        </button>
        <span
          role="status"
          className={msg ? `font-mono text-[13px] ${msg.kind === "ok" ? "text-accent" : "text-orange"}` : "sr-only"}
        >
          {msg?.text ?? ""}
        </span>
      </div>
      <p className="font-mono text-[12px] text-muted">
        {approved} {approved === 1 ? "aprovado" : "aprovados"}
        {capacity !== null && ` de ${capacity} vagas`}
        {waitlist > 0 && ` · ${waitlist} na fila`}
      </p>
      <p className="text-[13px] text-muted">
        Vazio = sem limite. Com a edição cheia, quem chega entra na fila de espera; quando alguém cancela, o primeiro
        da fila sobe sozinho.
      </p>
    </form>
  );
}
