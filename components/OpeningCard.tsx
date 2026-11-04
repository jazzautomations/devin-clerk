"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AREA_KEYS, areaLabel } from "@/lib/areas";
import type { Opening } from "@/lib/teamOpenings";

// Vagas de time (spec 046, onda 3 — migration 045).
//
// O card da vaga faz tudo que é da vaga: candidatar (intro curta), o time
// aceitar (vira convite) ou recusar, fechar a vaga. O aceite do convite
// continua no painel da edição — aqui só se mostra o estado.
//
// No mesmo arquivo ficam as três ações pequenas que o /times e o board da
// edição usam (abrir vaga, convidar pro meu time, bora fazer junto), porque
// todas falam com as mesmas rotas e repetem o mesmo tratamento de erro.

const input =
  "w-full min-w-0 border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

const primary =
  "w-fit border-[1.5px] border-line bg-foreground px-4 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50";

const ghost =
  "font-mono text-[12px] text-muted uppercase tracking-[0.06em] transition hover:text-accent disabled:opacity-50";

const chip = "border border-line px-1.5 py-0.5 font-mono text-[11.5px] text-muted";

const STATUS_TEXT: Record<string, string> = {
  enviada: "candidatura enviada. O time responde por notificação.",
  aceita: "o time aceitou: o convite está no painel da edição, seção meu time.",
  recusada: "o time seguiu com outra pessoa.",
  retirada: "a candidatura foi retirada.",
};

async function postJson(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export function OpeningCard({ opening }: { opening: Opening }) {
  const router = useRouter();
  const [intro, setIntro] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  const pending = opening.applications.filter((a) => a.status === "enviada");
  const accepted = opening.applications.filter((a) => a.status === "aceita");

  async function apply() {
    if (busy || !intro.trim()) return;
    setBusy(true);
    setErr("");
    const r = await postJson(`/api/openings/${opening.id}/applications`, "POST", { intro });
    if (!r.ok) {
      setErr(typeof r.data?.error === "string" ? r.data.error : "não deu pra se candidatar. Tente de novo.");
      setBusy(false);
      return;
    }
    setOpen(false);
    setIntro("");
    setBusy(false);
    router.refresh();
  }

  async function respond(applicationId: number, action: "accept" | "decline") {
    if (busy) return;
    setBusy(true);
    setErr("");
    const r = await postJson(`/api/openings/${opening.id}/applications/${applicationId}`, "PATCH", { action });
    if (!r.ok) {
      setErr(typeof r.data?.error === "string" ? r.data.error : "não deu pra responder. Tente de novo.");
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  async function close() {
    if (busy) return;
    setBusy(true);
    setErr("");
    const r = await postJson(`/api/openings/${opening.id}`, "PATCH", { status: "fechada" });
    if (!r.ok) {
      setErr(typeof r.data?.error === "string" ? r.data.error : "não deu pra fechar a vaga. Tente de novo.");
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <li
      className={`flex min-w-0 flex-col gap-3 border p-4 ${
        opening.isTeamMember ? "border-accent bg-mint" : "border-line bg-surface"
      }`}
      data-testid="vaga-card"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 text-[16px] leading-tight font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]">
          {opening.teamName}
        </span>
        <span className="border border-line bg-mint px-1.5 font-mono text-[11.5px] text-accent">
          procura {areaLabel(opening.area) ?? opening.area}
        </span>
        {opening.status !== "aberta" && (
          <span className={chip}>{opening.status === "preenchida" ? "vaga preenchida" : "vaga fechada"}</span>
        )}
        <span className="font-mono text-[11.5px] text-muted">{opening.hackathonName}</span>
        {opening.isTeamMember && <span className="font-mono text-[11.5px] text-accent">← seu time</span>}
      </div>

      <p className="min-w-0 font-mono text-[12.5px] text-foreground [overflow-wrap:anywhere]">{opening.intro}</p>

      <p className="flex min-w-0 flex-wrap gap-x-2 font-mono text-[11.5px] text-muted">
        {opening.creator && <span>aberta por @{opening.creator}</span>}
        <span className="[overflow-wrap:anywhere]">
          {opening.members.map((u) => `@${u}`).join(" ")}
        </span>
      </p>

      {opening.isTeamMember && (
        <div className="flex min-w-0 flex-col gap-2 border-t border-line pt-3">
          <p className="font-mono text-[11.5px] tracking-[0.06em] text-muted uppercase">
            candidaturas ({pending.length} esperando)
          </p>
          {accepted.length > 0 && (
            <p className="font-mono text-[11.5px] text-accent">
              convite enviado pra {accepted.map((a) => `@${a.username}`).join(", ")} — a vaga fica preenchida quando
              a pessoa aceitar.
            </p>
          )}
          {opening.applications.length === 0 ? (
            <p className="font-mono text-[11.5px] text-muted">
              ninguém ainda. Quem tiver a área no perfil aparece em &quot;pra você&quot;.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {opening.applications.map((a) => (
                <li key={a.id} className="flex min-w-0 flex-col gap-1.5 border border-line bg-background p-3">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <Link href={`/u/${a.username}`} className="font-mono text-[12.5px] text-accent hover:underline">
                      @{a.username}
                    </Link>
                    {a.headline && (
                      <span className="min-w-0 font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">
                        {a.headline}
                      </span>
                    )}
                    <span className={chip}>{a.status}</span>
                  </div>
                  <p className="min-w-0 font-mono text-[12px] text-foreground [overflow-wrap:anywhere]">{a.intro}</p>
                  {(a.city || a.institution) && (
                    <p className="font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">
                      {[a.city, a.institution].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {a.helpOffer.length > 0 && (
                    <p className="flex flex-wrap gap-1">
                      {a.helpOffer.map((k) => (
                        <span key={k} className={chip}>
                          ajuda em {areaLabel(k)}
                        </span>
                      ))}
                    </p>
                  )}
                  {a.email && <p className="font-mono text-[12px] text-accent [overflow-wrap:anywhere]">{a.email}</p>}
                  {a.status === "enviada" && (
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => respond(a.id, "accept")} disabled={busy} className={primary}>
                        {busy ? "…" : "aceitar e convidar →"}
                      </button>
                      <button type="button" onClick={() => respond(a.id, "decline")} disabled={busy} className={ghost}>
                        recusar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={close} disabled={busy} className={ghost}>
            {busy ? "…" : "fechar a vaga — achei alguém"}
          </button>
        </div>
      )}

      {!opening.isTeamMember && opening.mine && (
        <div className="flex min-w-0 flex-col gap-1 border-t border-line pt-3">
          <p className="font-mono text-[11.5px] text-muted">{STATUS_TEXT[opening.mine.status]}</p>
          {opening.mine.status === "aceita" && (
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-mono text-[11.5px] text-muted">contato do time:</p>
              <p className="min-w-0 font-mono text-[12px] text-accent [overflow-wrap:anywhere]">
                {opening.contactEmails.join(" · ") || "o time não deixou e-mail no perfil"}
              </p>
            </div>
          )}
        </div>
      )}

      {!opening.isTeamMember && !opening.mine && opening.canApply && (
        <div className="flex min-w-0 flex-col gap-2 border-t border-line pt-3">
          {open ? (
            <>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="font-mono text-[11.5px] text-muted">
                  sua intro (até 280): o que você faz e o que quer construir
                </span>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={3}
                  maxLength={280}
                  className={`${input} resize-none`}
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={apply} disabled={busy || !intro.trim()} className={primary}>
                  {busy ? "…" : "enviar candidatura →"}
                </button>
                <button type="button" onClick={() => setOpen(false)} className={ghost}>
                  cancelar
                </button>
              </div>
              <p className="font-mono text-[11.5px] text-muted">
                O e-mail aparece pros dois quando o time aceitar.
              </p>
            </>
          ) : (
            <button type="button" onClick={() => setOpen(true)} className={primary}>
              me candidatar →
            </button>
          )}
        </div>
      )}

      {!opening.isTeamMember && !opening.mine && !opening.canApply && opening.status === "aberta" && (
        <p className="font-mono text-[11.5px] text-muted">
          Pra se candidatar você precisa de inscrição aprovada nesta edição e ainda estar sem time.
        </p>
      )}

      <p role="alert" className="min-w-0 font-mono text-[11.5px] text-orange empty:hidden [overflow-wrap:anywhere]">
        {err}
      </p>
    </li>
  );
}

/** abre vaga no meu time — o time vem da edição escolhida */
export function OpenOpeningForm({ editions }: { editions: { id: string; name: string }[] }) {
  const router = useRouter();
  const [hackathonId, setHackathonId] = useState(editions[0]?.id ?? "");
  const [area, setArea] = useState<string>(AREA_KEYS[0]);
  const [intro, setIntro] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  async function submit() {
    if (busy || !intro.trim() || !hackathonId) return;
    setBusy(true);
    setErr("");
    const r = await postJson("/api/openings", "POST", { hackathonId, area, intro });
    if (!r.ok) {
      setErr(typeof r.data?.error === "string" ? r.data.error : "não deu pra abrir a vaga. Tente de novo.");
      setBusy(false);
      return;
    }
    setIntro("");
    setOpen(false);
    setBusy(false);
    router.refresh();
  }

  if (editions.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={primary}>
          + abrir vaga no meu time
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex min-w-0 flex-col gap-3 border border-line bg-surface p-4"
        >
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="font-mono text-[11.5px] text-muted">edição</span>
            <select value={hackathonId} onChange={(e) => setHackathonId(e.target.value)} className={input}>
              {editions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="font-mono text-[11.5px] text-muted">área que falta</span>
            <select value={area} onChange={(e) => setArea(e.target.value)} className={input}>
              {AREA_KEYS.map((k) => (
                <option key={k} value={k}>
                  {areaLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="font-mono text-[11.5px] text-muted">o que vocês procuram (até 280)</span>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={3}
              maxLength={280}
              placeholder="procuro design pra fechar o pitch: a gente faz o back e a demo"
              className={`${input} resize-none`}
            />
          </label>
          <p className="font-mono text-[11.5px] text-muted">
            Até 3 vagas abertas por time. O e-mail aparece pros dois quando o time aceitar.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || !intro.trim()} className={primary}>
              {busy ? "…" : "abrir vaga →"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={ghost}>
              cancelar
            </button>
          </div>
        </form>
      )}
      <p role="alert" className="font-mono text-[11.5px] text-orange empty:hidden [overflow-wrap:anywhere]">
        {err}
      </p>
    </div>
  );
}

/** convida a pessoa pro meu time na edição (team_invites) */
export function InviteToTeamButton({
  hackathonId,
  username,
  className = "",
}: {
  hackathonId: string;
  username: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");

  async function invite() {
    if (state !== "idle") return;
    setState("busy");
    setErr("");
    const r = await postJson(`/api/hackathons/${hackathonId}/team/invites`, "POST", { usernames: [username] });
    if (!r.ok) {
      setErr(typeof r.data?.error === "string" ? r.data.error : "não deu pra convidar.");
      setState("idle");
      return;
    }
    if (Array.isArray(r.data?.invited) && r.data.invited.includes(username)) {
      setState("done");
      return;
    }
    const reason = r.data?.ignored?.[0]?.reason;
    setErr(
      reason === "ja_tem_time"
        ? "essa pessoa já entrou em um time"
        : reason === "ja_convidado"
          ? "essa pessoa já tem convite do seu time"
          : reason === "nao_aprovado"
            ? "essa pessoa não tem inscrição aprovada na edição"
            : "não deu pra convidar.",
    );
    setState("idle");
  }

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <button type="button" onClick={invite} disabled={state !== "idle"} className={`${ghost} ${className}`}>
        {state === "done" ? "convite enviado" : state === "busy" ? "…" : "convidar pro meu time"}
      </button>
      {err && <span className="font-mono text-[11px] text-orange [overflow-wrap:anywhere]">{err}</span>}
    </span>
  );
}

/**
 * "Bora fazer junto": sinal silencioso. Antes do mútuo a resposta não conta
 * nada do outro lado — só quando os dois marcam o app age.
 */
export function TeamUpButton({ hackathonId, username }: { hackathonId: string; username: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "sent" | "mutual">("idle");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  async function signal() {
    if (state !== "idle") return;
    setState("busy");
    setErr("");
    const r = await postJson("/api/team-up", "POST", { username, hackathonId });
    if (!r.ok) {
      setErr(typeof r.data?.error === "string" ? r.data.error : "não deu pra marcar agora.");
      setState("idle");
      return;
    }
    if (r.data?.mutual) {
      setNote(
        r.data.action === "convite"
          ? "os dois marcaram: convite do meu time enviado."
          : r.data.action === "time"
            ? "os dois marcaram: time criado, confirme o convite no painel da edição."
            : "os dois marcaram: a conexão ficou salva.",
      );
      setState("mutual");
      router.refresh();
      return;
    }
    setNote("sinal enviado. Se a pessoa marcar também, o app chama vocês dois.");
    setState("sent");
  }

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={signal}
        disabled={state !== "idle"}
        className="w-fit border-[1.5px] border-line px-3 py-1.5 font-mono text-[11.5px] text-foreground transition hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {state === "busy" ? "…" : state === "idle" ? "bora fazer junto" : "marcado"}
      </button>
      {note && <span className="font-mono text-[11px] text-muted [overflow-wrap:anywhere]">{note}</span>}
      {err && <span className="font-mono text-[11px] text-orange [overflow-wrap:anywhere]">{err}</span>}
    </span>
  );
}
