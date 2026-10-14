"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Nova edição: só o essencial (endereço, nome, datas e local). Ela nasce como
// rascunho e o resto (prazo, vagas, curadoria, equipe) fica no checklist do
// painel da edição, pra onde a pessoa vai logo depois de criar.
// Evento de outro organizador (bloco recolhido) vai direto pro radar, com o
// link oficial e o prêmio, e a busca do /admin abre nele.
export function CreateEventForm() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");
  const input =
    "w-full border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    setError("");
    const f = new FormData(e.currentTarget);
    const id = String(f.get("id") ?? "").trim();
    const res = await fetch("/api/admin/hackathons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: f.get("name"),
        startsAt: f.get("startsAt"),
        endsAt: f.get("endsAt") || undefined,
        location: f.get("location") || undefined,
        organizer: f.get("organizer") || undefined,
        format: f.get("format") || undefined,
        registrationUrl: f.get("registrationUrl") || undefined,
        prize: f.get("prize") || undefined,
      }),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null);
      router.push(data?.radar ? `/admin?q=${encodeURIComponent(id)}` : `/admin/h/${id}`);
      return;
    }
    const data = await res?.json().catch(() => null);
    setError(typeof data?.error === "string" ? data.error : "Não deu pra criar a edição. Tente de novo.");
    setStatus("error");
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">endereço da página (hackahub…/h/…)</span>
        <input
          name="id"
          required
          className={input}
          placeholder="hack-inova-sorocaba-2027"
          pattern="[a-z0-9\-]{3,80}"
          title="de 3 a 80 letras minúsculas, números ou hífen"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">nome</span>
        <input
          name="name"
          required
          className={input}
          placeholder="Hack Inova Sorocaba"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">início (horário de Brasília)</span>
        <input
          name="startsAt"
          required
          type="datetime-local"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">fim (opcional, horário de Brasília)</span>
        <input name="endsAt" type="datetime-local" className={input} />
      </label>
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="font-mono text-xs text-muted">local</span>
        <input
          name="location"
          className={input}
          placeholder="Unipe Alphaville, SP"
        />
      </label>
      <details className="border-t border-line pt-3 sm:col-span-2">
        <summary className="min-h-11 cursor-pointer py-2 font-mono text-xs text-muted hover:text-foreground">
          evento de outro organizador? ponha no radar
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <p className="font-mono text-xs text-muted sm:col-span-2">
            Com outro organizador, o evento entra no ar direto no radar. Vazio, é uma edição da Hack Inova.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">organizador</span>
            <input name="organizer" className={input} placeholder="Prefeitura de Sorocaba" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">formato</span>
            <select name="format" defaultValue="presencial" className={input}>
              <option value="presencial">presencial</option>
              <option value="online">online</option>
              <option value="hibrido">híbrido</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">link oficial da inscrição</span>
            <input
              name="registrationUrl"
              type="url"
              className={input}
              placeholder="https://www.sympla.com.br/evento/..."
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">prêmio (opcional)</span>
            <input name="prize" className={input} placeholder="R$ 15 mil" />
          </label>
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button
          type="submit"
          disabled={status === "saving"}
          className="min-h-11 border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
        >
          {status === "saving" ? "criando…" : "criar edição →"}
        </button>
        <span role="status" className={status === "error" ? "font-mono text-xs text-orange" : "sr-only"}>
          {status === "error" ? error : ""}
        </span>
        <span className="font-mono text-xs text-muted">edição da Hack Inova nasce como rascunho; você publica pelo painel</span>
      </div>
    </form>
  );
}
