import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseDbDate } from "@/lib/buildWeeks";
import {
  CLOSED_BY_PERIOD,
  canSeeFollowThroughGrid,
  dayLabel,
  followThroughGrid,
  getFollowThrough,
  myFollowThroughTeams,
  periodEnd,
  periodLabel,
} from "@/lib/followThrough";
import { getHackathon } from "@/lib/hackathons";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { FollowThroughJoin } from "@/components/FollowThroughJoin";

// 4 semanas depois (spec 046, onda 5, migration 052). O acompanhamento
// pós-edição: cada semana conta quando o time posta no diário do projeto
// (posts.teamId, Onda 3). A grade times × semanas é do time e de quem
// organiza (spec 040 #15); quem é de fora vê só o agregado e, depois do fim,
// a lista de quem completou. Nada de streak: semana vazia não apaga nada.

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h) return { title: "edição não encontrada" };
  return {
    title: `4 semanas depois · ${h.name}`,
    description: `O que os times da ${h.name} construíram depois do evento.`,
    alternates: { canonical: `/h/${id}/quatro-semanas` },
  };
}

const h2 = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";

export default async function FollowThroughPage({ params }: PageProps<"/h/[id]/quatro-semanas">) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h) notFound();
  const me = await currentMember();
  const [ft, isOrganizer] = await Promise.all([getFollowThrough(id), canManageEdition(me, id)]);

  const header = (
    <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
      <p className="font-mono text-[12px] tracking-widest text-muted uppercase">
        <Link href={`/h/${id}`} className="hover:text-accent">
          {h.name}
        </Link>
      </p>
      <h1 className="text-[clamp(2rem,6vw,3.4rem)] leading-none font-extrabold tracking-[-0.04em]">4 semanas depois</h1>
      <p className="max-w-2xl text-[15px] text-muted">
        O projeto continua depois do evento. Cada semana conta quando o time posta uma atualização no diário do projeto.
      </p>
      {isOrganizer && (
        <p className="font-mono text-[13px]" data-testid="ft-painel">
          <Link href={`/admin/h/${id}/quatro-semanas`} className="text-accent underline-offset-4 hover:underline">
            abrir ou encerrar no painel da edição →
          </Link>
        </p>
      )}
    </header>
  );

  if (!ft) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6" data-testid="quatro-semanas-page">
        {header}
        <p className="border-[1.5px] border-line px-5 py-6 text-[15px] text-muted" data-testid="ft-fechado">
          {isOrganizer
            ? "As 4 semanas depois ainda não abriram. Abra no painel da edição pra os times entrarem."
            : "A organização ainda não abriu as 4 semanas depois desta edição."}
        </p>
      </div>
    );
  }

  const now = new Date();
  const [grid, canSee, myTeams] = await Promise.all([
    followThroughGrid(ft, now),
    canSeeFollowThroughGrid(me, id),
    me ? myFollowThroughTeams(id, me.username, ft, now) : Promise.resolve([]),
  ]);
  const starts = parseDbDate(ft.startsAt);
  const closed = !!ft.closedAt;
  const earlyClose = closed && ft.closedReason !== null && ft.closedReason !== CLOSED_BY_PERIOD;
  const joinable = myTeams.filter((t) => t.canJoin);
  const joined = myTeams.filter((t) => t.joined);
  const status = closed
    ? "encerrado"
    : grid.phase === "antes"
      ? `começa em ${starts ? dayLabel(starts) : ""}`
      : `semana ${grid.currentWeek ?? 1} de ${ft.weeks} · ${starts ? periodLabel(starts, ft.weeks) : ""}`;
  const endDay = starts ? dayLabel(new Date(periodEnd(starts, ft.weeks).getTime() - 86_400_000)) : "";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6" data-testid="quatro-semanas-page">
      {header}

      <section className="flex flex-col gap-1" data-testid="ft-status">
        <p className="font-mono text-[13px] tracking-widest text-accent uppercase">{status}</p>
        <p className="text-[15px] text-muted">
          {closed && !earlyClose
            ? `As ${ft.weeks} semanas fecharam em ${endDay}.`
            : `${ft.weeks} semanas de acompanhamento · cada semana vale uma atualização no diário do time.`}
        </p>
        {earlyClose && <p className="text-[15px] text-muted">encerrado antes do prazo: {ft.closedReason}</p>}
      </section>

      <section className="flex flex-col gap-1 border-[1.5px] border-line px-4 py-3" data-testid="ft-agregado">
        {grid.teams.length === 0 ? (
          <p className="text-[15px] text-muted" data-testid="ft-vazio">
            Nenhum time entrou ainda.
          </p>
        ) : (
          <p className="text-[15px]">
            {grid.teams.length} {grid.teams.length === 1 ? "time" : "times"}
            {grid.phase === "antes"
              ? ` · começa em ${starts ? dayLabel(starts) : ""}`
              : grid.phase === "durante"
                ? ` · ${grid.aggregate.postedThisWeek} ${grid.aggregate.postedThisWeek === 1 ? "postou" : "postaram"} esta semana`
                : ` · ${grid.aggregate.completed} completaram as ${ft.weeks} semanas`}
          </p>
        )}
      </section>

      {joinable.length > 0 && (
        <FollowThroughJoin
          hackathonId={id}
          teams={joinable.map((t) => ({ teamId: t.teamId, name: t.name }))}
        />
      )}

      {joined.length > 0 && !closed && grid.phase === "durante" && grid.currentWeek !== null && (
        <section className="flex flex-col gap-2" data-testid="ft-minha-semana">
          <h2 className={h2}>sua semana</h2>
          {joined.map((t) => {
            const mine = grid.teams.find((g) => g.teamId === t.teamId);
            const posted = mine ? mine.weeks[grid.currentWeek! - 1] !== null : false;
            return posted ? (
              <p key={t.teamId} className="border-[1.5px] border-accent bg-mint px-4 py-3 font-mono text-[13px] text-accent" data-testid="ft-postou">
                {`${t.name} já postou a atualização da semana ${grid.currentWeek}.`}
              </p>
            ) : (
              <Link
                key={t.teamId}
                href={`/p/${t.teamId}`}
                className="flex min-h-11 items-center justify-between gap-3 border-[1.5px] border-accent px-4 py-3 font-mono text-[13px] text-accent transition hover:bg-mint"
                data-testid="ft-postar"
              >
                <span className="break-words">{`postar a atualização da semana ${grid.currentWeek} · ${t.name}`}</span>
                <span aria-hidden>→</span>
              </Link>
            );
          })}
        </section>
      )}

      {canSee && grid.teams.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="ft-grade">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={h2}>grade dos times</h2>
            <p className="font-mono text-[11px] text-muted">{`semanas 1 a ${ft.weeks}`}</p>
          </div>
          <ul className="flex flex-col divide-y divide-line border-[1.5px] border-line">
            {grid.teams.map((t) => (
              <li key={t.teamId} className="flex min-w-0 items-center gap-3 px-3 py-2.5" data-testid="ft-time">
                <div className="min-w-0 flex-1">
                  <Link href={`/p/${t.teamId}`} className="font-semibold break-words hover:text-accent">
                    {t.teamName}
                  </Link>
                  <p className="font-mono text-[11px] break-words text-muted">
                    {t.complete ? `${ft.weeks} de ${ft.weeks} · completou` : `${t.done} de ${ft.weeks}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {t.weeks.map((postId, i) => {
                    const n = i + 1;
                    const current = grid.currentWeek === n;
                    return postId !== null ? (
                      <Link
                        key={n}
                        href={`/post/${postId}`}
                        aria-label={`semana ${n} de ${t.teamName}: atualização`}
                        data-testid="ft-semana"
                        data-week={n}
                        data-done="1"
                        className="inline-flex h-8 w-8 items-center justify-center border-[1.5px] border-accent bg-mint font-mono text-[12px] text-accent hover:underline"
                      >
                        {n}
                      </Link>
                    ) : (
                      <span
                        key={n}
                        aria-label={`semana ${n} de ${t.teamName}: sem atualização`}
                        data-testid="ft-semana"
                        data-week={n}
                        data-done="0"
                        className={`inline-flex h-8 w-8 items-center justify-center border font-mono text-[12px] ${
                          current ? "border-dashed border-line text-foreground" : "border-line-soft text-muted"
                        }`}
                      >
                        {n}
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
          <p className="font-mono text-[11px] text-muted">a grade por time é do time e de quem organiza a edição</p>
        </section>
      )}

      {!canSee && grid.teams.length > 0 && (
        <p className="font-mono text-[12px] text-muted" data-testid="ft-privado">
          A grade por time é do time e da organização. Aqui ficam só os números.
        </p>
      )}

      {grid.phase === "depois" && grid.aggregate.completed > 0 && (
        <section className="flex flex-col gap-2" data-testid="ft-completaram">
          <h2 className={h2}>quem completou</h2>
          <ul className="flex flex-col divide-y divide-line border-[1.5px] border-line">
            {grid.teams
              .filter((t) => t.complete)
              .map((t) => (
                <li key={t.teamId} className="px-4 py-2.5">
                  <Link href={`/p/${t.teamId}`} className="font-semibold break-words hover:text-accent">
                    {t.teamName}
                  </Link>
                  {t.projectTitle && <p className="font-mono text-[11px] break-words text-muted">{t.projectTitle}</p>}
                </li>
              ))}
          </ul>
        </section>
      )}

      {!me && (
        <p className="font-mono text-[13px]" data-testid="ft-anon">
          <Link href={`/sign-up?redirect_url=${encodeURIComponent(`/h/${id}/quatro-semanas`)}`} className="text-accent hover:underline">
            crie sua conta pra entrar com o seu time →
          </Link>
        </p>
      )}

      <Link href={`/h/${id}`} className="w-fit py-3 font-mono text-xs text-muted transition hover:text-accent">
        {"← voltar pra edição"}
      </Link>
    </div>
  );
}
