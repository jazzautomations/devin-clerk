"use client";

import { useState } from "react";

const area =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 text-[15px] text-foreground focus:border-accent focus:outline-none";

type Answer = { score: number; worked: string | null; improve: string | null };

// roadmap 037 #11 — nota 0–10 + duas abertas; editável até o prazo
export function NpsForm({
  hackathonId,
  questions,
  initial,
  maxLength,
}: {
  hackathonId: string;
  questions: { score: string; worked: string; improve: string };
  initial: Answer | null;
  maxLength: number;
}) {
  const [score, setScore] = useState<number | null>(initial?.score ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    initial ? { ok: true, text: "Você já respondeu. Dá pra editar até o prazo." } : null,
  );

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (score === null) return setMsg({ ok: false, text: "escolha uma nota de 0 a 10" });
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/hackathons/${hackathonId}/nps`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, worked: f.get("worked"), improve: f.get("improve") }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "Resposta salva. Obrigado!" } : { ok: false, text: data?.error ?? "não deu certo" });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" data-testid="nps-form">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-[17px] font-semibold">{questions.score}</legend>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              aria-pressed={score === n}
              onClick={() => setScore(n)}
              className={`rounded-[6px] border-[1.5px] border-line py-2.5 font-mono text-[15px] tabular-nums ${
                score === n ? "bg-foreground text-background" : "bg-background hover:text-accent"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between font-mono text-[12px] text-muted">
          <span>0 · nada provável</span>
          <span>10 · com certeza</span>
        </div>
      </fieldset>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">{questions.worked}</span>
        <textarea name="worked" rows={3} maxLength={maxLength} defaultValue={initial?.worked ?? ""} className={area} />
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">{questions.improve}</span>
        <textarea name="improve" rows={3} maxLength={maxLength} defaultValue={initial?.improve ?? ""} className={area} />
      </label>
      <button type="submit" disabled={busy} className="btn w-fit rounded-[6px] disabled:opacity-60">
        {initial ? "salvar alteração" : "enviar resposta"}
      </button>
      {/* sempre montada: leitor de tela só anuncia região que já existia */}
      <p role="status" className={msg ? `font-mono text-[13px] ${msg.ok ? "text-accent" : "text-orange"}` : "sr-only"}>
        {msg?.text ?? ""}
      </p>
    </form>
  );
}
