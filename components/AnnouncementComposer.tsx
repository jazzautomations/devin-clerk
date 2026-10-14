"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { announcementReach, type ChannelsEnabled } from "@/lib/notify/reach";
import { userMessage } from "@/lib/apiError";

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
  channels,
}: {
  hackathonId: string;
  teams: { id: number; name: string; members: number }[];
  counts: Partial<Record<Audience, number>>;
  channels: ChannelsEnabled;
}) {
  const router = useRouter();
  const [audience, setAudience] = useState<Audience>("todos");
  const [teamId, setTeamId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; msg?: string }>({ kind: "idle" });

  // quantas pessoas o público escolhido alcança agora; 0 bloqueia o envio
  const people =
    audience === "time"
      ? teamId === ""
        ? null
        : (teams.find((t) => t.id === teamId)?.members ?? 0)
      : (counts[audience] ?? null);
  const empty = people === 0;
  const ready = title.trim() && body.trim() && (audience !== "time" || teamId !== "") && !empty;
  const reach = announcementReach(channels);

  async function publish() {
    if (!ready) return;
    const target = OPTIONS.find((o) => o.value === audience)!.label;
    const howMany = people === null ? target : `${people} ${people === 1 ? "pessoa" : "pessoas"} (${target})`;
    if (!window.confirm(`Publicar pra ${howMany}? O aviso aparece ${reach}.`)) return;
    setState({ kind: "sending" });
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience, teamId: audience === "time" ? teamId : undefined, title, body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState({ kind: "error", msg: userMessage(res, data, "não deu pra publicar, tente de novo") });
      return;
    }
    setTitle("");
    setBody("");
    setState({ kind: "done", msg: `publicado ${reach}` });
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
              <option value="">{teams.length ? "escolha o time…" : "nenhum time nesta edição"}</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.members})
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
        {empty && (
          <p data-testid="audience-empty" className="font-mono text-[13px] text-muted">
            ninguém neste público ainda; escolha outro público
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="btn rounded-[6px] disabled:opacity-50" disabled={!ready || state.kind === "sending"}>
            {state.kind === "sending" ? "publicando…" : "publicar aviso"}
          </button>
          {/* região sempre montada: leitor de tela só anuncia o que muda dentro dela */}
          <p
            role="status"
            className={
              state.msg ? `font-mono text-[13px] ${state.kind === "error" ? "text-orange" : "text-accent"}` : "sr-only"
            }
          >
            {state.msg ?? ""}
          </p>
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
            {body.trim() || `O texto aparece ${reach}.`}
          </p>
        </div>
      </div>
    </div>
  );
}
