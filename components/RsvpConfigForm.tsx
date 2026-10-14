"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Config = { enabled: boolean; opensDaysBefore: number; deadlineDaysBefore: number; overbookPercent: number };

// aba presença — liga/desliga a confirmação de presença e ajusta as janelas
// e quantos aprovar a mais. Sem e-mail configurado não dá pra ligar (o
// servidor recusa; aqui a caixa já vem travada).
export function RsvpConfigForm({
  hackathonId,
  initial,
  emailReady = true,
}: {
  hackathonId: string;
  initial: Config;
  emailReady?: boolean;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<Config>(initial);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "done" | "error"; msg?: string }>({ kind: "idle" });

  async function put(body: Config & { acceptOverCapacity?: boolean }) {
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/rsvp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    return { res, data: (await res?.json().catch(() => null)) ?? {} };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "saving" });
    let { res, data } = await put(cfg);
    // 409: a capacidade ficaria abaixo de quem já está aprovado — só segue
    // com a confirmação explícita do organizador
    if (res?.status === 409 && window.confirm(`${data.error ?? "A capacidade ficaria abaixo dos aprovados."}\n\nSalvar assim mesmo?`)) {
      ({ res, data } = await put({ ...cfg, acceptOverCapacity: true }));
    }
    if (!res?.ok) {
      setState({ kind: "error", msg: typeof data.error === "string" ? data.error : "Não deu pra salvar. Tente de novo." });
      return;
    }
    setState({
      kind: "done",
      msg: data.promoted ? `salvo · ${data.promoted} saíram da fila` : "salvo",
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
          disabled={!emailReady && !cfg.enabled}
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
          <span className="font-mono text-[12px] text-muted uppercase">aprovar a mais (%)</span>
          <input type="number" min={0} max={100} value={cfg.overbookPercent} onChange={num("overbookPercent")} className={field} />
        </label>
      </div>
      <p className="text-[13px] text-muted">
        Aprovar a mais passa da capacidade (ex.: 100 vagas + 20% = 120 aprovados), contando com quem recusa ou não
        confirma. Só vale com a confirmação de presença ligada; a página pública continua mostrando as vagas reais.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn rounded-[6px]" disabled={state.kind === "saving"}>
          {state.kind === "saving" ? "salvando…" : "salvar"}
        </button>
        <span
          role="status"
          className={state.msg ? `font-mono text-[13px] ${state.kind === "error" ? "text-orange" : "text-accent"}` : "sr-only"}
        >
          {state.msg ?? ""}
        </span>
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
    setMsg(res.ok ? "reenviado" : typeof data.error === "string" ? data.error : "não deu pra reenviar");
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
      <span role="status" className={msg ? "font-mono text-[11px] text-muted" : "sr-only"}>
        {msg ?? ""}
      </span>
    </span>
  );
}
