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
  /** frente N #7 — itens na programação (oferece deslocar junto) */
  scheduleItems?: number;
};

// mesma conta do servidor (lib/schedule wallClockDelta): parede do relógio
function wallDelta(a: string, b: string): number | null {
  const wall = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v.trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] === undefined ? 9 : +m[4], m[5] === undefined ? 0 : +m[5]) : null;
  };
  const x = wall(a);
  const y = wall(b);
  return x === null || y === null ? null : y - x;
}

function shiftLabel(ms: number): string {
  const sign = ms < 0 ? "−" : "+";
  let mins = Math.round(Math.abs(ms) / 60_000);
  const d = Math.floor(mins / 1440);
  mins -= d * 1440;
  const h = Math.floor(mins / 60);
  mins -= h * 60;
  return sign + [d ? `${d}d` : "", h ? `${h}h` : "", mins ? `${mins}min` : ""].filter(Boolean).join(" ");
}

// "2026-12-01T09:00:00-03:00" → "2026-12-01T09:00" (datetime-local)
const toInput = (v: string | null) => (v ? v.slice(0, 16) : "");

export function EditEventForm({ event }: { event: EditableEvent }) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const [startInput, setStartInput] = useState(toInput(event.startsAt));
  const [shift, setShift] = useState(false);
  const delta = wallDelta(event.startsAt, startInput);
  const offerShift = (event.scheduleItems ?? 0) > 0 && delta !== null && delta !== 0;
  const input =
    "w-full border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

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
        ...(offerShift && shift ? { shiftSchedule: true } : {}),
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
          value={startInput}
          onChange={(e) => setStartInput(e.target.value)}
          className={input}
        />
      </label>
      {offerShift && (
        <label
          data-testid="shift-schedule"
          className="flex cursor-pointer items-start gap-2 border-[1.5px] border-accent bg-mint p-3 text-[13px] leading-snug sm:col-span-2"
        >
          <input
            type="checkbox"
            name="shiftSchedule"
            checked={shift}
            onChange={(e) => setShift(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[#047a43]"
          />
          <span>
            O início mudou ({shiftLabel(delta!)}). Deslocar também os {event.scheduleItems} itens da programação pelo
            mesmo intervalo e avisar os inscritos que a agenda mudou? O calendário (.ics) de quem assinou se atualiza
            sozinho.
          </span>
        </label>
      )}
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
            <span className="font-mono text-xs text-orange">
              {""}
              {error}
            </span>
          )}
          <button
            type="submit"
            disabled={status === "saving"}
            className="border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
          >
            {status === "saving" ? "salvando…" : "salvar edição →"}
          </button>
        </div>
      </div>
    </form>
  );
}
