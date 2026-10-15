"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Abrir hackathon pela comunidade: só o essencial. Nasce rascunho e o resto
// (formulário, prazos, júri, certificado) fica no painel da edição, pra onde
// a pessoa vai logo depois.

const label = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";
const input =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";

export function CommunityHackathonForm({ slug, city }: { slug: string; city: string | null }) {
  const router = useRouter();
  const [format, setFormat] = useState("presencial");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    try {
      const res = await fetch(`/api/communities/${slug}/hackathons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: get("name"),
          startsAt: get("startsAt"),
          endsAt: get("endsAt") || undefined,
          format,
          location: get("location") || undefined,
          capacity: get("capacity") || undefined,
          description: get("description") || undefined,
          infoUrl: get("infoUrl") || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(userMessage(res, data, "Não deu pra criar. Tente de novo."));
        setSaving(false);
        return;
      }
      router.push(`${data.panel}?novo=1`);
    } catch {
      setError("Sem conexão. Tente de novo.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" data-testid="community-hackathon-form">
      <label className="flex flex-col gap-1.5">
        <span className={label}>nome do hackathon</span>
        <input name="name" required minLength={3} maxLength={90} className={input} placeholder="Hackathon de Sorocaba 2027" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={label}>início (horário de Brasília)</span>
          <input name="startsAt" required type="datetime-local" className={input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>fim (opcional)</span>
          <input name="endsAt" type="datetime-local" className={input} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>formato</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            ["presencial", "presencial"],
            ["online", "online"],
            ["hibrido", "híbrido"],
          ].map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={format === k}
              onClick={() => setFormat(k)}
              className={`min-h-[44px] rounded-[6px] border-[1.5px] px-3 text-[14.5px] font-semibold ${
                format === k ? "border-foreground bg-foreground text-band" : "border-line hover:bg-mint"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
        <label className="flex flex-col gap-1.5">
          <span className={label}>{format === "online" ? "local (opcional)" : "local"}</span>
          <input
            name="location"
            required={format !== "online"}
            maxLength={160}
            className={input}
            placeholder={city ? `Campus, ${city}` : "Campus, cidade, UF"}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>vagas (opcional)</span>
          <input name="capacity" type="number" min={1} max={100000} inputMode="numeric" className={input} placeholder="120" />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={label}>descrição (opcional)</span>
        <textarea
          name="description"
          rows={4}
          maxLength={2000}
          className={`${input} resize-y`}
          placeholder="Tema, pra quem é e o que a pessoa leva do fim de semana."
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>link do evento (opcional)</span>
        <input name="infoUrl" type="url" maxLength={300} className={input} placeholder="https://..." />
      </label>
      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3 border-t-2 border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[44ch] font-mono text-[12px] text-muted">
          nasce como rascunho, só a equipe vê. Você publica pelo painel quando estiver pronto.
        </p>
        <button type="submit" disabled={saving} className="btn w-full sm:w-auto" data-testid="community-hackathon-submit">
          {saving ? "criando…" : "criar rascunho →"}
        </button>
      </div>
    </form>
  );
}
