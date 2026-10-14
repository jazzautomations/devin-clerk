"use client";

import { useState } from "react";
import { DIET_CHOICES } from "@/components/EventTermsFields";

// corrigir restrição alimentar e alergia depois de inscrito (até o início do
// evento). Antes disso, o único jeito era cancelar e perder a vaga.
export function DietEditor({
  hackathonId,
  initial,
}: {
  hackathonId: string;
  initial: { diet: string[]; allergies: string | null; allergySevere: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [diet, setDiet] = useState<string[]>(initial.diet);
  const [allergies, setAllergies] = useState(initial.allergies ?? "");
  const [severe, setSevere] = useState(initial.allergySevere);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const summary = [...diet, ...(allergies.trim() ? [`alergia: ${allergies.trim()}${severe ? " (grave)" : ""}`] : [])];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/register`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diet, allergies, allergySevere: severe && allergies.trim() !== "" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: typeof data?.error === "string" ? data.error : "não deu pra salvar. Tente de novo." });
        return;
      }
      setDiet(data.diet);
      setAllergies(data.allergies ?? "");
      setSevere(data.allergySevere);
      setMsg({ ok: true, text: "restrição alimentar atualizada" });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3" data-testid="diet-editor">
      <p className="text-[14px]">
        <span className="font-mono text-[12px] tracking-widest text-muted uppercase">restrição alimentar · </span>
        {summary.length ? summary.join(", ") : "nenhuma informada"}
      </p>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-11 w-fit font-mono text-[13px] text-accent underline underline-offset-4"
        >
          editar restrição alimentar
        </button>
      )}
      {open && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <div role="group" aria-label="restrição alimentar" className="flex flex-wrap gap-2">
            {DIET_CHOICES.map((o) => {
              const on = diet.includes(o);
              return (
                <label
                  key={o}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[6px] border-[1.5px] px-3.5 py-2 text-[15px] ${
                    on ? "border-accent bg-background font-semibold text-accent" : "border-line bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-[#047a43]"
                    checked={on}
                    onChange={() => setDiet(on ? diet.filter((x) => x !== o) : [...diet, o])}
                  />
                  {o}
                </label>
              );
            })}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[12px] tracking-widest text-muted uppercase">alergias ou intolerâncias</span>
            <input
              className="w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 text-[16px] focus:border-accent focus:outline-none"
              maxLength={500}
              placeholder="ex.: amendoim, camarão"
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
            />
          </label>
          {allergies.trim() && (
            <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-snug">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
                checked={severe}
                onChange={(e) => setSevere(e.target.checked)}
              />
              <span>É alergia grave (risco de reação séria). A organização avisa o buffet com destaque.</span>
            </label>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-60">
              {busy ? "salvando…" : "salvar"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 font-mono text-[12px] text-muted uppercase"
            >
              cancelar
            </button>
          </div>
        </form>
      )}
      <p role="status" className={`font-mono text-[13px] empty:hidden ${msg?.ok ? "text-accent" : "text-orange"}`}>
        {msg?.text}
      </p>
    </div>
  );
}
