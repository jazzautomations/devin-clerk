"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Config = { enabled: boolean; opensDaysBefore: number; deadlineDaysBefore: number; overbookPercent: number };

// aba presença — liga/desliga o RSVP e ajusta as janelas e a sobrevenda
export function RsvpConfigForm({ hackathonId, initial }: { hackathonId: string; initial: Config }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<Config>(initial);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "done" | "error"; msg?: string }>({ kind: "idle" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "saving" });
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/rsvp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState({ kind: "error", msg: data.error ?? "erro ao salvar" });
      return;
    }
    setState({
      kind: "done",
      msg: data.promoted ? `salvo — ${data.promoted} saíram da fila com a sobrevenda` : "salvo",
    });
    router.refresh();
  }

  const field =
    "w-24 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-[15px] focus:border-accent focus:outline-none";
  const num = (k: keyof Omit<Config, "enabled">) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCfg({ ...cfg, [k]: e.target.value === "" ? 0 : Number(e.target.value) });

  return (
    <form onSubmit={save} className="flex flex-col gap-4 border-[1.5px] border-line p-4" data-testid="rsvp-config">
      <label className="flex items-start gap-3 text-[15px]">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          className="mt-1 size-4 accent-[#047a43]"
        />
        <span>
          <strong>Pedir confirmação de presença</strong>
          <span className="block text-[14px] text-muted">
            Aprovados recebem &ldquo;confirmo / não vou&rdquo;; sem resposta no prazo, a vaga vai pra fila.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap gap-x-6 gap-y-3 text-[14px]">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[12px] text-muted uppercase">convite (dias antes)</span>
          <input type="number" min={1} max={60} value={cfg.opensDaysBefore} onChange={num("opensDaysBefore")} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[12px] text-muted uppercase">prazo (dias antes)</span>
          <input type="number" min={0} max={59} value={cfg.deadlineDaysBefore} onChange={num("deadlineDaysBefore")} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[12px] text-muted uppercase">sobrevenda (%)</span>
          <input type="number" min={0} max={100} value={cfg.overbookPercent} onChange={num("overbookPercent")} className={field} />
        </label>
      </div>
      <p className="text-[13px] text-muted">
        Sobrevenda aprova acima da capacidade (ex.: 100 vagas + 20% = 120 aprovados) contando com quem recusa ou não
        confirma. Só vale com o RSVP ligado; a página pública continua mostrando as vagas reais.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn rounded-[6px]" disabled={state.kind === "saving"}>
          {state.kind === "saving" ? "salvando…" : "salvar"}
        </button>
        {state.msg && (
          <span role="status" className={`font-mono text-[13px] ${state.kind === "error" ? "text-orange" : "text-accent"}`}>
            {state.msg}
          </span>
        )}
      </div>
    </form>
  );
}

export function RsvpResendButton({ hackathonId, memberId }: { hackathonId: string; memberId: number }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function resend() {
    setBusy(true);
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/rsvp/resend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? "reenviado" : (data.error ?? "erro"));
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="rounded-[6px] border-[1.5px] border-line px-2 py-0.5 font-mono text-[12px] hover:border-accent hover:text-accent"
      >
        {busy ? "…" : "reenviar"}
      </button>
      {msg && <span className="font-mono text-[11px] text-muted">{msg}</span>}
    </span>
  );
}
