"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Cliques da página do evento da agenda: responder (vou/talvez), publicar,
// cancelar e apagar (quem organiza), pedir palco no demo day e decidir os
// pedidos.

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, error: "Sem conexão. Tente de novo.", data: null };
  const data = await res.json().catch(() => null);
  return { ok: res.ok, error: res.ok ? null : userMessage(res, data, "Não deu certo. Tente de novo."), data };
}

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";

function Alert({ text, testId }: { text: string | null; testId?: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="font-mono text-[12.5px] text-orange" data-testid={testId}>
      {text}
    </p>
  );
}

export function RsvpButtons({
  meetupId,
  status,
  full,
}: {
  meetupId: number;
  status: "vou" | "talvez" | null;
  /** lotação cheia e a pessoa ainda não está no "vou" */
  full: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function answer(next: "vou" | "talvez" | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = next ? await call(`/api/meetups/${meetupId}/rsvp`, "POST", { status: next }) : await call(`/api/meetups/${meetupId}/rsvp`, "DELETE");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (r.data?.full) setNotice("lotado: você ficou no talvez. Se abrir vaga, é só tocar em vou de novo.");
    router.refresh();
  }

  const btn = (s: "vou" | "talvez", text: string) => (
    <button
      type="button"
      disabled={busy}
      aria-pressed={status === s}
      onClick={() => answer(s)}
      data-testid={`rsvp-${s}`}
      className={`min-h-[48px] flex-1 rounded-[6px] border-[1.5px] px-4 text-[15px] font-bold sm:flex-none sm:px-6 ${
        status === s ? "border-foreground bg-foreground text-band" : "border-line bg-background hover:bg-mint"
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="flex flex-col gap-2" data-testid="rsvp">
      <div className="flex gap-2">
        {btn("vou", full && status !== "vou" ? "vou (lotado)" : "vou")}
        {btn("talvez", "talvez")}
      </div>
      {status && (
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(null)}
          className="self-start font-mono text-[12.5px] text-muted underline underline-offset-4 hover:text-foreground"
          data-testid="rsvp-clear"
        >
          tirar minha resposta
        </button>
      )}
      {notice && (
        <p role="status" className="font-mono text-[12.5px] text-accent" data-testid="rsvp-full">
          {notice}
        </p>
      )}
      <Alert text={error} />
    </div>
  );
}

export function MeetupManageBar({
  meetupId,
  slug,
  published,
  cancelled,
  over,
}: {
  meetupId: number;
  slug: string;
  published: boolean;
  cancelled: boolean;
  over: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "publish" | "cancel" | "delete") {
    if (kind === "cancel" && !confirm("Cancelar o evento? Quem respondeu recebe o aviso.")) return;
    if (kind === "delete" && !confirm("Apagar o rascunho?")) return;
    setBusy(true);
    setError(null);
    const r =
      kind === "delete"
        ? await call(`/api/meetups/${meetupId}`, "DELETE")
        : await call(`/api/meetups/${meetupId}/${kind}`, "POST");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (kind === "delete") return router.push(`/comunidade/${slug}/agenda`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 border-[1.5px] border-dashed border-line p-4" data-testid="meetup-manage">
      <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
        {!published ? "rascunho: só quem organiza vê" : cancelled ? "cancelado" : "você organiza"}
      </p>
      <div className="flex flex-wrap gap-2">
        {!published && (
          <button type="button" disabled={busy} onClick={() => act("publish")} className="btn min-h-[44px]!" data-testid="meetup-do-publish">
            publicar e avisar →
          </button>
        )}
        {!cancelled && !over && (
          <Link href={`/agenda/${meetupId}/editar`} className="btn-ghost min-h-[44px]!" data-testid="meetup-edit">
            editar
          </Link>
        )}
        {published && !cancelled && !over && (
          <button type="button" disabled={busy} onClick={() => act("cancel")} className="btn-ghost min-h-[44px]!" data-testid="meetup-cancel">
            cancelar evento
          </button>
        )}
        {!published && (
          <button type="button" disabled={busy} onClick={() => act("delete")} className="btn-ghost min-h-[44px]!" data-testid="meetup-delete">
            apagar
          </button>
        )}
      </div>
      <Alert text={error} />
    </div>
  );
}

export function StageRequestForm({
  meetupId,
  projects,
}: {
  meetupId: number;
  projects: { teamId: number; title: string; hackathonName: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pitch, setPitch] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const r = await call(`/api/meetups/${meetupId}/stage`, "POST", { teamId: Number(f.get("teamId")), pitch });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSent(true);
    setPitch("");
    router.refresh();
  }

  if (projects.length === 0) {
    return (
      <p className="border-[1.5px] border-line px-4 py-3 text-[14.5px] text-muted" data-testid="stage-no-project">
        Pra pedir palco você precisa de um projeto num time. Ele aparece aqui quando o time cadastra.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-[1.5px] border-line p-4" data-testid="stage-form">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">projeto</span>
        <select name="teamId" required className={input} data-testid="stage-project">
          {projects.map((p) => (
            <option key={p.teamId} value={p.teamId}>
              {p.title} · {p.hackathonName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">o que vocês vão mostrar</span>
        <textarea
          name="pitch"
          required
          rows={3}
          maxLength={280}
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          className={`${input} resize-y`}
          placeholder="App que acha vaga de estágio pelo GitHub. Demo ao vivo, 5 minutos."
          data-testid="stage-pitch"
        />
        <span className="self-end font-mono text-[12px] text-muted">{pitch.length}/280</span>
      </label>
      <button type="submit" disabled={busy} className="btn self-start" data-testid="stage-submit">
        {busy ? "enviando…" : "pedir palco"}
      </button>
      {sent && (
        <p role="status" className="font-mono text-[12.5px] text-accent">
          pedido enviado. Quem organiza responde por notificação.
        </p>
      )}
      <Alert text={error} testId="stage-error" />
    </form>
  );
}

export function StageDecision({ meetupId, requestId, status }: { meetupId: number; requestId: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(next: "aceito" | "recusado") {
    setBusy(true);
    setError(null);
    const r = await call(`/api/meetups/${meetupId}/stage/${requestId}`, "PATCH", { status: next });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        {status !== "aceito" && (
          <button type="button" disabled={busy} onClick={() => decide("aceito")} className="btn min-h-[40px]! px-3! text-[14px]!" data-testid="stage-accept">
            aceitar
          </button>
        )}
        {status !== "recusado" && (
          <button type="button" disabled={busy} onClick={() => decide("recusado")} className="btn-ghost min-h-[40px]! px-3! text-[14px]!" data-testid="stage-refuse">
            recusar
          </button>
        )}
      </div>
      <Alert text={error} />
    </div>
  );
}
