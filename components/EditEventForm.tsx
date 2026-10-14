"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEventTime, toBrtInput } from "@/lib/eventTime";

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

// mesma conta do servidor: diferença entre os dois instantes (o input é
// horário de Brasília; o valor salvo pode ter fuso, Z ou ser só a data)
function startDelta(saved: string, input: string): number | null {
  const a = parseEventTime(saved);
  const b = parseEventTime(input);
  return a && b ? b.getTime() - a.getTime() : null;
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

// valor salvo → datetime-local no horário de Brasília. Nunca cortar o texto
// (slice): "…T09:00:00-03:00" virava "…T09:00" e, sem fuso, o servidor lia
// como outro horário.
const toInput = (v: string | null) => toBrtInput(v);

export function EditEventForm({ event, isAdmin = false }: { event: EditableEvent; isAdmin?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const [startInput, setStartInput] = useState(toInput(event.startsAt));
  const [shift, setShift] = useState(false);
  const delta = startDelta(event.startsAt, startInput);
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
        ...(isAdmin && opt("registrationUrl") ? { registrationUrl: opt("registrationUrl") } : {}),
        tags: String(f.get("tags") ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        ...(isAdmin ? { active: f.get("active") === "on" } : {}),
        requiresApproval: f.get("requiresApproval") === "on",
        ...(offerShift && shift ? { shiftSchedule: true } : {}),
      }),
    });
    if (res.ok) {
      setStatus("done");
      setShift(false);
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(typeof data?.error === "string" ? data.error : "Não deu pra salvar. Tente de novo.");
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
        <span className="font-mono text-xs text-muted">início (horário de Brasília)</span>
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
        <span className="font-mono text-xs text-muted">fim (opcional, horário de Brasília)</span>
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
        <span className="font-mono text-xs text-muted">prazo de inscrição (opcional)</span>
        <input
          name="registrationDeadline"
          type="datetime-local"
          defaultValue={toInput(event.registrationDeadline)}
          className={input}
        />
      </label>
      {isAdmin && (
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">
            link de inscrição, se for em outro site
          </span>
          <input
            name="registrationUrl"
            defaultValue={event.registrationUrl}
            className={input}
          />
        </label>
      )}
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
      <div className="flex flex-wrap items-end justify-between gap-4 sm:col-span-2">
        <div className="flex flex-col gap-2">
          {isAdmin && (
            <label className="flex min-h-11 items-center gap-2 font-mono text-xs text-muted">
              <input
                type="checkbox"
                name="active"
                defaultChecked={event.active}
                className="size-4 accent-(--color-accent)"
              />
              no ar (desmarcar arquiva a edição)
            </label>
          )}
          <label className="flex min-h-11 items-center gap-2 font-mono text-xs text-muted">
            <input
              type="checkbox"
              name="requiresApproval"
              defaultChecked={event.requiresApproval}
              className="size-4 accent-(--color-accent)"
            />
            aprovar cada inscrição antes de liberar a vaga
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span
            role="status"
            className={status === "error" ? "font-mono text-xs text-orange" : status === "done" ? "font-mono text-xs text-accent" : "sr-only"}
          >
            {status === "error" ? error : status === "done" ? "salvo" : ""}
          </span>
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
