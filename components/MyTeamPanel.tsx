"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ArchiveTeam } from "@/lib/archive";
import type { IgnoredInvite, MyInvite } from "@/lib/teamInvites";

const input =
  "w-full border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";
const quiet =
  "min-h-11 font-mono text-[12px] text-muted uppercase tracking-[0.06em] transition hover:text-foreground disabled:opacity-50";

const REASON: Record<IgnoredInvite["reason"], string> = {
  nao_existe: "não existe no HackaHub",
  nao_aprovado: "sem inscrição aprovada nesta edição",
  ja_tem_time: "já está em outro time",
  ja_convidado: "já tem convite pendente",
};

const ignoredText = (list: IgnoredInvite[] | undefined) =>
  list?.length ? `sem convite: ${list.map((i) => `@${i.username} (${REASON[i.reason] ?? i.reason})`).join(", ")}` : null;

const splitNames = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

// spec 021 — "meu time": o inscrito cria o time da edição, convida colegas,
// tira quem ficou sem inscrição aprovada e sai do time. O projeto é montado num lugar só, a
// página de entrega (/h/[id]/entrega), que tem os campos que o júri usa.
// Renderizado só quando !past && registered — o server já garante.
// Frente N #4: colega não entra direto — recebe convite e aceita/recusa
// aqui mesmo (ou pela notificação, que aponta pra cá).
export function MyTeamPanel({
  hackathonId,
  initialTeam,
  initialInvites = [],
  initialPending = [],
  myUsername,
}: {
  hackathonId: string;
  initialTeam: ArchiveTeam | null;
  initialInvites?: MyInvite[];
  initialPending?: string[];
  /** quem está vendo (pra não oferecer "remover" na própria linha) */
  myUsername?: string | null;
}) {
  const router = useRouter();
  const [team, setTeam] = useState(initialTeam);
  const [invites, setInvites] = useState(initialInvites);
  const [pending, setPending] = useState(initialPending);
  const [more, setMore] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mates, setMates] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [me, setMe] = useState(myUsername ?? null);
  // quem dá pra tirar daqui (sem inscrição aprovada); o resto é com a organização
  const [removable, setRemovable] = useState<string[]>([]);
  const teamId = team?.id ?? null;

  // a página não diz quem está vendo nem quem está sem inscrição; o GET do
  // time diz
  useEffect(() => {
    if (teamId === null) return;
    let live = true;
    fetch(`/api/hackathons/${hackathonId}/team`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!live) return;
        if (typeof data?.me === "string") setMe(data.me);
        if (Array.isArray(data?.removable)) setRemovable(data.removable as string[]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [teamId, hackathonId]);

  async function call(url: string, method: string, body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setErr("");
    setNote("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.push("/sign-in");
        return null;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(typeof data?.error === "string" ? data.error : "não deu certo. Tente de novo.");
        return null;
      }
      return data ?? {};
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!name.trim() || busy) return;
    const data = await call(`/api/hackathons/${hackathonId}/team`, "POST", { name, memberUsernames: splitNames(mates) });
    if (!data) return;
    setTeam(data.team as ArchiveTeam);
    const invited = (data.invitedUsernames as string[] | undefined) ?? [];
    setPending(invited);
    const badges = (data.newBadges as string[] | undefined) ?? [];
    setNote(
      [
        data.xp ? `${data.xp} xp` : null,
        invited.length ? `convite enviado: ${invited.map((u) => `@${u}`).join(", ")}. Entram quando aceitarem` : null,
        ignoredText(data.ignored as IgnoredInvite[] | undefined),
        badges.length ? `conquista nova: ${badges.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    setOpen(false);
    router.refresh(); // time entra pro arquivo da edição na hora
  }

  async function respond(inviteId: number, action: "accept" | "decline") {
    if (busy) return;
    const data = await call(`/api/hackathons/${hackathonId}/team/invites`, "PATCH", { inviteId, action });
    if (!data) return;
    if (data.status === "accepted") {
      setTeam(data.team as ArchiveTeam);
      setInvites([]);
      setNote("você entrou no time");
    } else {
      setInvites((xs) => xs.filter((i) => i.id !== inviteId));
      setNote("convite recusado");
    }
    router.refresh();
  }

  async function inviteMore() {
    const usernames = splitNames(more);
    if (!usernames.length || busy) return;
    const data = await call(`/api/hackathons/${hackathonId}/team/invites`, "POST", { usernames });
    if (!data) return;
    setPending((data.pending as string[] | undefined) ?? pending);
    setMore("");
    const invited = (data.invited as string[] | undefined) ?? [];
    setNote(
      [
        invited.length ? `convite enviado: ${invited.map((u) => `@${u}`).join(", ")}` : null,
        ignoredText(data.ignored as IgnoredInvite[] | undefined),
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  async function remove(username: string) {
    if (busy || !team) return;
    if (!window.confirm(`Tirar @${username} do time "${team.name}"? A pessoa recebe um aviso.`)) return;
    const data = await call(`/api/hackathons/${hackathonId}/team`, "PATCH", { action: "remove", username });
    if (!data) return;
    setTeam(data.team as ArchiveTeam);
    setRemovable((data.removable as string[] | undefined) ?? []);
    setNote(`@${username} saiu do time`);
    router.refresh();
  }

  async function leave() {
    if (busy || !team) return;
    if (!window.confirm(`Sair do time "${team.name}"? Sua inscrição continua; o time recebe um aviso.`)) return;
    const data = await call(`/api/hackathons/${hackathonId}/team`, "PATCH", { action: "leave" });
    if (!data) return;
    setTeam(null);
    setPending([]);
    setNote("você saiu do time");
    router.refresh();
  }

  return (
    <div data-testid="my-team" className="flex flex-col gap-3">
      {!team && invites.length > 0 && (
        <ul data-testid="team-invites" className="flex flex-col border-[1.5px] border-accent">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 border-line p-4 not-last:border-b sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-[15px]">
                {i.invitedBy ? `@${i.invitedBy}` : "um time"} convidou você pro time{" "}
                <strong className="font-extrabold">{i.teamName}</strong>
              </p>
              <span className="flex shrink-0 gap-2">
                <button type="button" disabled={busy} onClick={() => respond(i.id, "accept")} className="btn">
                  aceitar
                </button>
                <button type="button" disabled={busy} onClick={() => respond(i.id, "decline")} className={quiet}>
                  recusar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {team && (
        <div className="flex flex-col gap-3 border border-line bg-mint p-4">
          <p className="font-display font-extrabold tracking-[-0.035em] break-words">{team.name}</p>
          <ul aria-label="integrantes" className="flex flex-col">
            {team.members.map((u) => (
              <li key={u} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 border-b border-line last:border-b-0">
                <span className="min-w-0 font-mono text-[13px] break-all">
                  @{u}
                  {u === me && <span className="text-muted"> (você)</span>}
                </span>
                {u !== me && removable.includes(u) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(u)}
                    aria-label={`remover @${u} do time`}
                    className={`${quiet} hover:text-orange`}
                  >
                    remover
                  </button>
                )}
              </li>
            ))}
          </ul>
          {team.members.length > 1 && (
            <p className="font-mono text-xs text-muted">
              Dá pra tirar do time quem está sem inscrição aprovada. Pra tirar outra pessoa, fale com a organização.
            </p>
          )}
          <p className="font-mono text-xs text-muted">
            {team.project ? `projeto: ${team.project.title}` : "o projeto ainda não tem título"}
          </p>
          <div className="flex flex-wrap items-center gap-x-4">
            <Link
              href={`/h/${hackathonId}/entrega`}
              data-testid="open-entry"
              className="flex min-h-11 items-center font-mono text-[13px] font-semibold text-accent underline underline-offset-4"
            >
              abrir entrega do projeto →
            </Link>
            <Link
              href={`/p/${team.id}`}
              className="flex min-h-11 items-center font-mono text-xs text-accent underline-offset-4 hover:underline"
            >
              ficha pública
            </Link>
          </div>
          {pending.length > 0 && (
            <p data-testid="team-pending" className="font-mono text-[12px] text-muted">
              aguardando aceite: {pending.map((u) => `@${u}`).join(" ")}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              inviteMore();
            }}
            className="flex flex-wrap gap-2"
          >
            <input
              value={more}
              onChange={(e) => setMore(e.target.value)}
              placeholder="convidar: @maria, @joao_dev"
              aria-label="convidar colegas pro time"
              className={`${input} min-w-0 flex-1 bg-surface`}
            />
            <button type="submit" disabled={busy || !more.trim()} className="btn shrink-0">
              convidar
            </button>
          </form>
          <button type="button" disabled={busy} onClick={leave} className={`${quiet} w-fit hover:text-orange`}>
            sair do time
          </button>
        </div>
      )}

      {!team && !open && (
        <button
          type="button"
          onClick={() => {
            setErr("");
            setOpen(true);
          }}
          className="min-h-11 w-fit border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent"
        >
          criar time
        </button>
      )}

      {!team && open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          className="flex flex-col gap-3 border border-line bg-surface p-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">nome do time (obrigatório, único na edição)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              placeholder="ex.: One Day Hospital"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              colegas (usernames inscritos, separados por vírgula). Você entra na hora; eles recebem convite e entram
              quando aceitarem
            </span>
            <input value={mates} onChange={(e) => setMates(e.target.value)} placeholder="@maria, @joao_dev" className={input} />
          </label>
          <p className="font-mono text-xs text-muted">O projeto você monta depois, na página de entrega.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="min-h-11 border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
            >
              {busy ? "…" : "criar time → +15xp"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={quiet}>
              cancelar
            </button>
          </div>
        </form>
      )}

      <p role="alert" className="font-mono text-xs text-orange empty:hidden">
        {err}
      </p>
      <p role="status" className="font-mono text-xs text-accent empty:hidden">
        {note}
      </p>
    </div>
  );
}
