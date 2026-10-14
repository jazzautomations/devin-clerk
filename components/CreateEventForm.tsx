"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Nova edição: só o essencial (endereço, nome, datas e local). Ela nasce como
// rascunho e o resto (prazo, vagas, curadoria, equipe) fica no checklist do
// painel da edição, pra onde a pessoa vai logo depois de criar.
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
      }),
    }).catch(() => null);
    if (res?.ok) {
      router.push(`/admin/h/${id}`);
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
        <span className="font-mono text-xs text-muted">a edição nasce como rascunho; você publica pelo painel</span>
      </div>
    </form>
  );
}
