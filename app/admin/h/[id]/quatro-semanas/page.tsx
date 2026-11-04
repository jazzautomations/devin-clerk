import Link from "next/link";
import { notFound } from "next/navigation";
import { parseDbDate } from "@/lib/buildWeeks";
import { toBrtInput } from "@/lib/eventTime";
import {
  CLOSED_BY_PERIOD,
  dayLabel,
  demoMeetupTitle,
  followThroughGrid,
  getFollowThrough,
  periodEnd,
  periodLabel,
} from "@/lib/followThrough";
import { getHackathon } from "@/lib/hackathons";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { FollowThroughAdmin } from "@/components/FollowThroughAdmin";

// Painel das 4 semanas depois (spec 046, onda 5, migration 052): abrir, ver
// quem entrou e encerrar antes do prazo com motivo. A aba no painel da edição
// é do encontros-na-edicao (dono do AdminTabs nesta onda).

const h2 = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";

export default async function FollowThroughAdminPage({ params }: PageProps<"/admin/h/[id]/quatro-semanas">) {
  const { id } = await params;
  const member = await currentMember();
  if (!(await canManageEdition(member, id))) notFound();
  const h = await getHackathon(id);
  if (!h) notFound();
  const ft = await getFollowThrough(id);
  const now = new Date();
  const grid = ft ? await followThroughGrid(ft, now) : null;
  const starts = ft ? parseDbDate(ft.startsAt) : null;
  const closed = !!ft?.closedAt;
  const earlyClose = closed && ft?.closedReason !== CLOSED_BY_PERIOD;
  const demo = ft?.demoMeetupId ? await demoMeetupTitle(ft.demoMeetupId) : null;

  return (
    <div className="flex flex-col gap-6" data-testid="ft-admin-page">
      <div className="flex flex-col gap-1">
        <h2 className="text-[1.6rem] leading-none font-extrabold tracking-[-0.03em]">4 semanas depois</h2>
        <p className="max-w-2xl text-[14px] text-muted">
          O acompanhamento pós-edição: os times que entregaram entram e cada semana vale uma atualização no diário do
          projeto. Quem fecha todas as semanas leva o selo quatro semanas.
        </p>
        <p className="font-mono text-[13px]" data-testid="ft-admin-publico">
          <Link href={`/h/${id}/quatro-semanas`} className="text-accent underline-offset-4 hover:underline">
            ver a página dos times →
          </Link>
        </p>
      </div>

      {ft && (
        <section className="flex flex-col gap-2 border-[1.5px] border-line px-4 py-3" data-testid="ft-admin-status">
          <p className="font-mono text-[13px] tracking-widest text-accent uppercase">
            {closed ? "encerrado" : grid?.phase === "antes" ? "aberto, ainda não começou" : "aberto"}
          </p>
          <p className="font-mono text-[13px] text-muted">
            {starts ? periodLabel(starts, ft.weeks) : ""}
            {` · ${ft.weeks} semanas · horário de Brasília`}
          </p>
          {closed && (
            <p className="text-[14px] text-muted" data-testid="ft-admin-motivo-final">
              {earlyClose ? `Encerrado antes do prazo: ${ft.closedReason}` : "Encerrado no fim das semanas."}
            </p>
          )}
          {demo && (
            <p className="font-mono text-[13px]" data-testid="ft-admin-demo">
              <Link href={`/agenda/${ft.demoMeetupId}`} className="text-accent underline-offset-4 hover:underline">
                demo day de fechamento: {demo} →
              </Link>
            </p>
          )}
        </section>
      )}

      {grid && grid.teams.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="ft-admin-times">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className={h2}>times inscritos</h3>
            <p className="font-mono text-[11px] text-muted">
              {`${grid.aggregate.teams} ${grid.aggregate.teams === 1 ? "time" : "times"} · ${grid.aggregate.completed} completaram`}
            </p>
          </div>
          <ul className="flex flex-col divide-y divide-line border-[1.5px] border-line">
            {grid.teams.map((t) => (
              <li key={t.teamId} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/p/${t.teamId}`} className="font-semibold break-words hover:text-accent">
                    {t.teamName}
                  </Link>
                  <p className="font-mono text-[11px] break-words text-muted">{`${t.done} de ${ft!.weeks} semanas`}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {t.weeks.map((postId, i) =>
                    postId !== null ? (
                      <Link
                        key={i}
                        href={`/post/${postId}`}
                        aria-label={`semana ${i + 1} de ${t.teamName}: atualização`}
                        className="inline-flex h-7 w-7 items-center justify-center border-[1.5px] border-accent bg-mint font-mono text-[11px] text-accent hover:underline"
                      >
                        {i + 1}
                      </Link>
                    ) : (
                      <span
                        key={i}
                        aria-label={`semana ${i + 1} de ${t.teamName}: sem atualização`}
                        className="inline-flex h-7 w-7 items-center justify-center border border-line-soft font-mono text-[11px] text-muted"
                      >
                        {i + 1}
                      </span>
                    ),
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!ft && (
        <p className="font-mono text-[13px] text-muted" data-testid="ft-admin-sem-times">
          Nenhum time entrou ainda.
        </p>
      )}

      <FollowThroughAdmin
        hackathonId={id}
        open={!!ft}
        closed={closed}
        startsAtInput={ft ? toBrtInput(ft.startsAt) : ""}
        weeks={ft?.weeks ?? 4}
      />

      {ft && starts && !closed && grid && grid.phase === "durante" && (
        <p className="font-mono text-[12px] text-muted" data-testid="ft-admin-fim">
          {`fecha em ${dayLabel(new Date(periodEnd(starts, ft.weeks).getTime() - 86_400_000))}, no fim da semana ${ft.weeks}.`}
        </p>
      )}
    </div>
  );
}
