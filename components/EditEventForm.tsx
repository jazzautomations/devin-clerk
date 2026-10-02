"use client";

import { useState } from "react";

export type EditableEvent = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  format: string;
  location: string | null;
  registrationUrl: string;
  registrationDeadline: string | null;
  tags: string[];
  active: boolean;
  requiresApproval: boolean;
};

// "2026-12-01T09:00:00-03:00" → "2026-12-01T09:00" (datetime-local)
const toInput = (v: string | null) => (v ? v.slice(0, 16) : "");

export function EditEventForm({ event }: { event: EditableEvent }) {
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
    const opt = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const res = await fetch(`/api/admin/hackathons/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        startsAt: f.get("startsAt"),
        endsAt: opt("endsAt"),
        format: f.get("format"),
        location: opt("location"),
        registrationDeadline: opt("registrationDeadline"),
        ...(opt("registrationUrl") ? { registrationUrl: opt("registrationUrl") } : {}),
        tags: String(f.get("tags") ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        active: f.get("active") === "on",
        requiresApproval: f.get("requiresApproval") === "on",
      }),
    });
    if (res.ok) {
      setStatus("done");
      window.location.reload();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "erro ao salvar");
      setStatus("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">nome</span>
        <input name="name" required defaultValue={event.name} className={input} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">formato</span>
        <select
          name="format"
          required
          defaultValue={event.format}
          className={input}
        >
          <option value="presencial">presencial</option>
          <option value="online">online</option>
          <option value="hibrido">híbrido</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">início</span>
        <input
          name="startsAt"
          required
          type="datetime-local"
          defaultValue={toInput(event.startsAt)}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">fim (opcional)</span>
        <input
          name="endsAt"
          type="datetime-local"
          defaultValue={toInput(event.endsAt)}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">local</span>
        <input
          name="location"
          defaultValue={event.location ?? ""}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">deadline inscrição</span>
        <input
          name="registrationDeadline"
          type="datetime-local"
          defaultValue={toInput(event.registrationDeadline)}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          url de inscrição externa
        </span>
        <input
          name="registrationUrl"
          defaultValue={event.registrationUrl}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          tags (separadas por vírgula)
        </span>
        <input
          name="tags"
          defaultValue={event.tags.join(", ")}
          className={input}
        />
      </label>
      <div className="flex items-end justify-between gap-4 sm:col-span-2">
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 font-mono text-xs text-muted">
            <input
              type="checkbox"
              name="active"
              defaultChecked={event.active}
              className="accent-(--color-accent)"
            />
            ativa no radar (desmarcar arquiva)
          </label>
          <label className="flex items-center gap-2 font-mono text-xs text-muted">
            <input
              type="checkbox"
              name="requiresApproval"
              defaultChecked={event.requiresApproval}
              className="accent-(--color-accent)"
            />
            curadoria — vaga só com aprovação (&quot;pedir lugar&quot;)
          </label>
        </div>
        <div className="flex items-center gap-4">
          {status === "error" && (
            <span className="font-mono text-xs text-red-400">
              {"// "}
              {error}
            </span>
          )}
          <button
            type="submit"
            disabled={status === "saving"}
            className="bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {status === "saving" ? "salvando…" : "salvar edição →"}
          </button>
        </div>
      </div>
    </form>
  );
}
