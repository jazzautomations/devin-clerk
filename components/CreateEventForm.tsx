"use client";

import { useState } from "react";

export function CreateEventForm() {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const input =
    "w-full border border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/hackathons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: f.get("id"),
        name: f.get("name"),
        organizer: f.get("organizer"),
        startsAt: f.get("startsAt"),
        endsAt: f.get("endsAt") || undefined,
        format: f.get("format"),
        location: f.get("location") || undefined,
        registrationDeadline: f.get("registrationDeadline") || undefined,
        tags: String(f.get("tags") ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    });
    if (res.ok) {
      setStatus("done");
      (e.target as HTMLFormElement).reset();
      window.location.reload();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "erro ao criar");
      setStatus("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">slug (vira /h/slug)</span>
        <input
          name="id"
          required
          className={input}
          placeholder="hackinova-alphaville-2026"
          pattern="[a-z0-9\-]+"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">nome</span>
        <input
          name="name"
          required
          className={input}
          placeholder="Hack Inova — Alphaville"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">organizador</span>
        <input
          name="organizer"
          required
          className={input}
          placeholder="Hack Inova"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">formato</span>
        <select name="format" required className={input}>
          <option value="presencial">presencial</option>
          <option value="online">online</option>
          <option value="hibrido">híbrido</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">início (ISO)</span>
        <input
          name="startsAt"
          required
          type="datetime-local"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">fim (opcional)</span>
        <input name="endsAt" type="datetime-local" className={input} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">local</span>
        <input
          name="location"
          className={input}
          placeholder="Unipe Alphaville, SP"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          tags (separadas por vírgula)
        </span>
        <input name="tags" className={input} placeholder="ia, agentes" />
      </label>
      <div className="flex items-end sm:col-span-2">
        <button
          type="submit"
          disabled={status === "saving"}
          className="bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {status === "saving" ? "criando…" : "criar edição →"}
        </button>
        {status === "error" && (
          <span className="ml-4 font-mono text-xs text-red-400">
            {"// "}
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
