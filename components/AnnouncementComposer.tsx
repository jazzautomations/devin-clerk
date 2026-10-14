"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Audience = "todos" | "aprovados" | "presentes" | "time";

const OPTIONS: { value: Audience; label: string }[] = [
  { value: "todos", label: "todos os inscritos" },
  { value: "aprovados", label: "só aprovados" },
  { value: "presentes", label: "só quem fez check-in" },
  { value: "time", label: "um time" },
];

// spec 033 US2 — escrever, ver a prévia e publicar um aviso da edição
export function AnnouncementComposer({
  hackathonId,
  teams,
  counts,
}: {
  hackathonId: string;
  teams: { id: number; name: string }[];
  counts: Partial<Record<Audience, number>>;
}) {
  const router = useRouter();
  const [audience, setAudience] = useState<Audience>("todos");
  const [teamId, setTeamId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; msg?: string }>({ kind: "idle" });

  const ready = title.trim() && body.trim() && (audience !== "time" || teamId !== "");

  async function publish() {
    if (!ready) return;
    const target = OPTIONS.find((o) => o.value === audience)!.label;
    if (!window.confirm(`Publicar pra ${target}? Sai por in-app, e-mail e WhatsApp (quem optou).`)) return;
    setState({ kind: "sending" });
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience, teamId: audience === "time" ? teamId : undefined, title, body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState({ kind: "error", msg: data.error ?? "erro ao publicar" });
      return;
    }
    setTitle("");
    setBody("");
    setState({ kind: "done", msg: `publicado — ${data.queued} entregas na fila` });
    router.refresh();
  }

  const field =
    "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void publish();
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-mono text-[12px] tracking-widest text-muted uppercase">público</legend>
          <div className="flex flex-wrap gap-2">
            {OPTIONS.map((o) => (
              <label
                key={o.value}
                className={`cursor-pointer border-[1.5px] border-line px-3 py-1.5 font-mono text-[13px] ${
                  audience === o.value ? "bg-foreground text-band" : "hover:bg-mint"
                }`}
              >
                <input
                  type="radio"
                  name="audience"
                  value={o.value}
                  checked={audience === o.value}
                  onChange={() => setAudience(o.value)}
                  className="sr-only"
                />
                {o.label}
                {counts[o.value] !== undefined && <span className="ml-1.5 opacity-70">({counts[o.value]})</span>}
              </label>
            ))}
          </div>
        </fieldset>
        {audience === "time" && (
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[12px] tracking-widest text-muted uppercase">time</span>
            <select
              className={field}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">{teams.length ? "escolhe o time…" : "nenhum time nesta edição"}</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[12px] tracking-widest text-muted uppercase">título</span>
          <input
            className={field}
            value={title}
            maxLength={140}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Credenciamento abre às 8h"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[12px] tracking-widest text-muted uppercase">texto</span>
          <textarea
            className={field}
            rows={6}
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Traga documento com foto. Entrada pelo portão 2."
          />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="btn rounded-[6px] disabled:opacity-50" disabled={!ready || state.kind === "sending"}>
            {state.kind === "sending" ? "publicando…" : "publicar aviso"}
          </button>
          {state.msg && (
            <p role="status" className={`font-mono text-[13px] ${state.kind === "error" ? "text-orange" : "text-accent"}`}>
              {state.msg}
            </p>
          )}
        </div>
      </form>

      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">prévia — como o inscrito vê</p>
        <div className="flex flex-col gap-2 border-[1.5px] border-l-4 border-line border-l-accent bg-mint px-4 py-4">
          <p className="font-mono text-[12px] font-bold text-accent uppercase">novo</p>
          <h3 className="text-[19px] leading-tight font-extrabold tracking-[-0.02em] break-words">
            {title.trim() || "Título do aviso"}
          </h3>
          <p className="text-[15px] leading-relaxed break-words whitespace-pre-line">
            {body.trim() || "O texto aparece aqui, no e-mail e no WhatsApp de quem optou."}
          </p>
        </div>
      </div>
    </div>
  );
}
