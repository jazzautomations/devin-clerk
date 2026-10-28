"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Formulário da agenda (criar e editar). Datas em horário de Brasília (o
// datetime-local manda a parede e o servidor converte). Criar oferece
// "salvar rascunho" ou "publicar": publicar avisa membros e quem segue.

const label = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";
const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";

const KINDS = [
  ["meetup", "meetup"],
  ["live", "live"],
  ["workshop", "workshop"],
  ["demo_day", "demo day"],
] as const;
type Kind = (typeof KINDS)[number][0];

const KIND_HINT: Record<Kind, string> = {
  meetup: "Encontro da comunidade: conversa, palestra curta, network.",
  live: "Transmissão no YouTube ou na Twitch, que aparece embutida na página.",
  workshop: "Mão na massa com vagas. Quem não couber fica no talvez.",
  demo_day: "Times mostram projetos. Membro pede palco e você monta a programação.",
};

export type MeetupFormInitial = {
  kind: Kind;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  onlineUrl: string | null;
  embedUrl: string | null;
  capacity: number | null;
  hosts: string[];
};

export function MeetupForm({
  slug,
  city,
  meetupId,
  initial,
}: {
  slug: string;
  city: string | null;
  /** edição: id do evento */
  meetupId?: number;
  initial?: MeetupFormInitial;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "meetup");
  const [saving, setSaving] = useState<null | "draft" | "publish" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const editing = meetupId !== undefined;

  async function send(form: HTMLFormElement, mode: "draft" | "publish" | "save") {
    if (!form.reportValidity()) return;
    setSaving(mode);
    setError(null);
    const f = new FormData(form);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    const body = {
      community: slug,
      kind,
      title: get("title"),
      startsAt: get("startsAt"),
      endsAt: get("endsAt") || undefined,
      location: get("location") || undefined,
      onlineUrl: get("onlineUrl") || undefined,
      embedUrl: get("embedUrl") || undefined,
      capacity: get("capacity") || undefined,
      hosts: get("hosts"),
      description: get("description") || undefined,
      publish: mode === "publish",
    };
    try {
      const res = await fetch(editing ? `/api/meetups/${meetupId}` : "/api/meetups", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(userMessage(res, data, "Não deu pra salvar. Tente de novo."));
        setSaving(null);
        return;
      }
      router.push(data.href);
      router.refresh();
    } catch {
      setError("Sem conexão. Tente de novo.");
      setSaving(null);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(e.currentTarget, editing ? "save" : "publish");
      }}
      className="flex flex-col gap-6"
      data-testid="meetup-form"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>tipo</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KINDS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              data-testid={`meetup-kind-${k}`}
              className={`min-h-[44px] rounded-[6px] border-[1.5px] px-3 text-[14.5px] font-semibold ${
                kind === k ? "border-foreground bg-foreground text-band" : "border-line hover:bg-mint"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="font-mono text-[12px] text-muted">{KIND_HINT[kind]}</p>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className={label}>título</span>
        <input
          name="title"
          required
          minLength={3}
          maxLength={100}
          defaultValue={initial?.title}
          className={input}
          placeholder={kind === "demo_day" ? "Demo day de novembro" : "Rust na prática, do zero ao deploy"}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>início (horário de Brasília)</span>
          <input name="startsAt" required type="datetime-local" defaultValue={initial?.startsAt} className={input} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>fim (opcional)</span>
          <input name="endsAt" type="datetime-local" defaultValue={initial?.endsAt} className={input} />
        </label>
      </div>

      <div className="flex flex-col gap-4 border-[1.5px] border-line p-4">
        <p className={label}>onde (pelo menos um)</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-semibold">local</span>
          <input
            name="location"
            maxLength={160}
            defaultValue={initial?.location ?? ""}
            className={input}
            placeholder={city ? `Auditório, ${city}` : "Auditório, cidade, UF"}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-semibold">link da sala</span>
          <input
            name="onlineUrl"
            type="url"
            maxLength={300}
            defaultValue={initial?.onlineUrl ?? ""}
            className={input}
            placeholder="https://meet.google.com/..."
          />
          <span className="font-mono text-[12px] text-muted">só quem respondeu vê o link.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-semibold">live no YouTube ou na Twitch</span>
          <input
            name="embedUrl"
            type="url"
            maxLength={300}
            defaultValue={initial?.embedUrl ?? ""}
            className={input}
            placeholder="https://www.youtube.com/watch?v=..."
            data-testid="meetup-embed"
          />
          <span className="font-mono text-[12px] text-muted">aparece na página 15 min antes de começar.</span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>vagas (opcional)</span>
          <input
            name="capacity"
            type="number"
            min={1}
            max={100000}
            inputMode="numeric"
            defaultValue={initial?.capacity ?? ""}
            className={input}
            placeholder="40"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>quem conduz (até 5, opcional)</span>
          <input
            name="hosts"
            maxLength={220}
            defaultValue={initial?.hosts.map((h) => `@${h}`).join(" ") ?? ""}
            className={input}
            placeholder="@ana @joao"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={label}>descrição (opcional)</span>
        <textarea
          name="description"
          rows={5}
          maxLength={3000}
          defaultValue={initial?.description ?? ""}
          className={`${input} resize-y`}
          placeholder="O que vai rolar, pra quem é e o que levar."
        />
      </label>

      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange" data-testid="meetup-form-error">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 border-t-2 border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[44ch] font-mono text-[12px] text-muted">
          {editing
            ? "mudou o horário? quem respondeu recebe o aviso."
            : "publicar avisa quem é membro e quem segue a comunidade."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {editing ? (
            <button type="submit" disabled={!!saving} className="btn w-full sm:w-auto" data-testid="meetup-save">
              {saving ? "salvando…" : "salvar"}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={!!saving}
                onClick={(e) => void send(e.currentTarget.form!, "draft")}
                className="btn-ghost w-full sm:w-auto"
                data-testid="meetup-draft"
              >
                {saving === "draft" ? "salvando…" : "salvar rascunho"}
              </button>
              <button type="submit" disabled={!!saving} className="btn w-full sm:w-auto" data-testid="meetup-publish">
                {saving === "publish" ? "publicando…" : "publicar e avisar →"}
              </button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
