import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { getMembership } from "@/lib/communities";
import {
  canEditChallenge,
  canJudgeChallenge,
  canSeeChallenge,
  formatDeadline,
  getOpenChallenge,
  myProjectTeams,
  PLACE_LABELS,
  timeLeft,
  visibleEntries,
  type OpenChallengeEntry,
} from "@/lib/openChallenges";
import { currentMember } from "@/lib/session";
import { EntryForm } from "./EntryForm";
import { RemoveButton, ReportButton } from "./Moderation";
import { ResultForm } from "./ResultForm";

// /desafios/[id] (migration 053): o que construir, regras, prêmio, prazo, a
// entrega da pessoa e, depois do prazo, todas as entregas e o resultado.

type Props = { params: Promise<{ id: string }> };

async function load(raw: string) {
  const id = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  const [member, c] = await Promise.all([currentMember(), getOpenChallenge(id)]);
  if (!member || !c || !(await canSeeChallenge(member, c))) return null;
  return { member, c };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await load((await params).id);
  return { title: r ? r.c.title : "desafio", robots: { index: false } };
}

const PHASE_LABEL = { rascunho: "rascunho", aberto: "aberto", encerrado: "encerrado", resultado: "resultado saiu" } as const;
const h2 = "text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]";

function EntryLinks({ e }: { e: OpenChallengeEntry }) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px]">
      {e.teamId && e.projectTitle && (
        <Link href={`/p/${e.teamId}`} className="text-accent underline-offset-4 hover:underline">
          projeto: {e.projectTitle}
        </Link>
      )}
      {e.repoUrl && (
        <a href={e.repoUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline-offset-4 hover:underline">
          repo
        </a>
      )}
      {e.demoUrl && (
        <a href={e.demoUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline-offset-4 hover:underline">
          demo
        </a>
      )}
    </span>
  );
}

type EntryAction = { challengeId: number; viewerId: number; moderates: boolean };

function EntryItem({ e, testId, act }: { e: OpenChallengeEntry; testId: string; act: EntryAction }) {
  return (
    <li className="flex flex-col gap-2 border-t border-line py-4" data-testid={testId} id={`entrega-${e.id}`}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {e.place && <span className="chip bare bg-foreground! text-band!">{PLACE_LABELS[e.place]}</span>}
        <Link href={`/u/${e.username}`} className="flex min-w-0 items-center gap-2 font-bold underline-offset-4 hover:underline">
          <Avatar username={e.username} name={e.name} avatarUrl={e.avatarUrl} />
          <span className="truncate">{e.name ?? `@${e.username}`}</span>
        </Link>
      </span>
      <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-line text-[#2b2b2b]">{e.summary}</p>
      <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <EntryLinks e={e} />
        {act.moderates ? (
          <RemoveButton
            url={`/api/open-challenges/${act.challengeId}/entries/${e.id}`}
            confirmText="Tirar esta entrega do ar? Ela some da lista e do resultado, e quem entregou é avisado."
            testId="entrega-tirar"
          />
        ) : (
          e.memberId !== act.viewerId && (
            <ReportButton targetType="desafio_entrega" targetId={e.id} targetLabel="esta entrega" authorUsername={e.username} />
          )
        )}
      </span>
    </li>
  );
}

export default async function DesafioPage({ params }: Props) {
  const r = await load((await params).id);
  if (!r) notFound();
  const { member, c } = r;
  const [canEdit, canJudge, role, teams] = await Promise.all([
    canEditChallenge(member, c),
    canJudgeChallenge(member, c),
    getMembership(c.communityId, member.id),
    myProjectTeams(member.username),
  ]);
  // quem julga vê todas; o resto não vê entrega de quem tem bloqueio com ela
  const v = await visibleEntries(c, member.id, { canJudge });
  const live = !c.removedAt && c.status !== "rascunho";
  const act: EntryAction = { challengeId: c.id, viewerId: member.id, moderates: canEdit };
  const organizes = member.id === c.createdBy || role === "dono" || role === "organizador";
  const podium = (v.entries ?? []).filter((e) => e.place).sort((a, b) => a.place! - b.place!);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 overflow-x-clip px-4 py-10 sm:px-6 sm:py-14" data-testid="desafio-page">
      <header className="flex flex-col gap-4 border-b-2 border-line pb-8">
        <Link href="/desafios" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← desafios
        </Link>
        <p className="font-mono text-[13px] text-muted">
          <Link href={`/comunidade/${c.communitySlug}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
            {c.communityName}
          </Link>
          {c.sponsorName && <span data-testid="desafio-sponsor"> · patrocinado por {c.sponsorName}</span>}
        </p>
        <h1 className="text-[clamp(2rem,6vw,3.25rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">{c.title}</h1>
        <div className="flex flex-wrap items-center gap-2" data-testid="desafio-status">
          <span
            className={`chip bare ${
              c.phase === "aberto" ? "border-accent! bg-mint! text-accent!" : c.phase === "resultado" ? "bg-foreground! text-band!" : ""
            }`}
          >
            {PHASE_LABEL[c.phase]}
          </span>
          <span className="font-mono text-[13px]">
            prazo {formatDeadline(c.deadline)} <span className="text-muted">(Brasília)</span>
          </span>
          {c.phase === "aberto" && <span className="font-mono text-[13px] text-accent">{timeLeft(c.deadline)}</span>}
        </div>
        {live && (canEdit || member.id !== c.createdBy) && (
          <div className="flex flex-wrap gap-4" data-testid="desafio-moderacao">
            {canEdit ? (
              <RemoveButton
                url={`/api/open-challenges/${c.id}`}
                confirmText="Tirar este desafio do ar? Ele some de /desafios e para de receber entregas."
                testId="desafio-tirar"
              />
            ) : (
              <ReportButton targetType="desafio" targetId={c.id} targetLabel="este desafio" authorUsername={c.creatorUsername} />
            )}
          </div>
        )}
      </header>

      {c.removedAt && (
        <p className="border-[1.5px] border-dashed border-orange px-5 py-4 text-[15px]" data-testid="desafio-fora-do-ar">
          Fora do ar. Só a organização da comunidade vê esta página.
        </p>
      )}

      {c.phase === "rascunho" && (
        <div className="flex flex-col items-start gap-3 border-[1.5px] border-dashed border-line p-5" data-testid="desafio-rascunho">
          <p className="text-[15px]">Rascunho. Só a organização da comunidade vê esta página.</p>
          {canEdit && (
            <Link href={`/comunidade/${c.communitySlug}/desafios/novo?rascunho=${c.id}`} className="btn-ghost">
              continuar editando
            </Link>
          )}
        </div>
      )}

      {c.prize && (
        <div className="flex flex-col gap-1 border-[1.5px] border-line bg-mint px-5 py-4" data-testid="desafio-premio">
          <span className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">prêmio</span>
          <span className="text-[18px] font-bold break-words">{c.prize}</span>
        </div>
      )}

      {podium.length > 0 && (
        <section aria-labelledby="resultado-title" className="flex flex-col gap-4" data-testid="desafio-resultado">
          <h2 id="resultado-title" className={h2}>
            Resultado
          </h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {podium.map((e) => (
              <li key={e.id} className={`flex min-w-0 flex-col gap-2 border-[1.5px] border-line p-4 ${e.place === 1 ? "bg-foreground text-background" : ""}`}>
                <span className={`font-mono text-[12px] ${e.place === 1 ? "text-band" : "text-accent"}`}>{PLACE_LABELS[e.place!]}</span>
                <Link href={`/u/${e.username}`} className="truncate text-[17px] font-extrabold tracking-[-0.02em] underline-offset-4 hover:underline">
                  {e.name ?? `@${e.username}`}
                </Link>
                {e.projectTitle && <span className="truncate text-[14px] opacity-80">{e.projectTitle}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="brief-title" className="flex flex-col gap-3">
        <h2 id="brief-title" className={h2}>
          O que construir
        </h2>
        <p className="text-[16px] leading-relaxed break-words whitespace-pre-line" data-testid="desafio-brief">
          {c.brief}
        </p>
      </section>

      {c.rules && (
        <section aria-labelledby="regras-title" className="flex flex-col gap-3">
          <h2 id="regras-title" className={h2}>
            Regras
          </h2>
          <p className="text-[15px] leading-relaxed break-words whitespace-pre-line text-[#2b2b2b]">{c.rules}</p>
        </section>
      )}

      {c.phase === "aberto" && !c.removedAt && (
        <section aria-labelledby="entregar-title" className="flex flex-col gap-4 border-t-2 border-line pt-8" id="entregar">
          <h2 id="entregar-title" className={h2}>
            {v.mine ? "Sua entrega" : "Entregar"}
          </h2>
          <p className="font-mono text-[13px] text-muted" data-testid="desafio-contagem">
            {v.count} {v.count === 1 ? "entrega" : "entregas"} até agora. As entregas aparecem aqui quando o prazo acabar.
          </p>
          {organizes ? (
            <p className="border-[1.5px] border-line px-4 py-4 text-[15px] text-muted" data-testid="desafio-organiza">
              Quem organiza a comunidade não entrega no desafio dela.
            </p>
          ) : (
            <EntryForm
              challengeId={c.id}
              teams={teams}
              mine={
                v.mine
                  ? { teamId: v.mine.teamId, repoUrl: v.mine.repoUrl, demoUrl: v.mine.demoUrl, summary: v.mine.summary }
                  : null
              }
            />
          )}
        </section>
      )}

      {(c.phase === "encerrado" || c.phase === "resultado") && (
        <section aria-labelledby="entregas-title" className="flex flex-col gap-4 border-t-2 border-line pt-8">
          <h2 id="entregas-title" className={h2}>
            Entregas <span className="font-mono text-[15px] font-normal text-muted">{v.count}</span>
          </h2>
          {c.phase === "encerrado" && !c.removedAt && canJudge && (v.entries?.length ?? 0) > 0 && (
            <ResultForm
              challengeId={c.id}
              entries={(v.entries ?? []).map((e) => ({ id: e.id, label: e.name ?? `@${e.username}`, project: e.projectTitle }))}
            />
          )}
          {c.phase === "encerrado" && !canJudge && v.count > 0 && (
            <p className="font-mono text-[13px] text-muted" data-testid="desafio-aguardando">
              Prazo encerrado. O resultado sai aqui quando {c.creatorUsername ? `@${c.creatorUsername}` : "a organização"} escolher os três
              primeiros.
            </p>
          )}
          {(v.entries?.length ?? 0) > 0 ? (
            <ul className="flex flex-col border-b border-line" data-testid="desafio-entregas">
              {v.entries!.map((e) => (
                <EntryItem key={e.id} e={e} testId="desafio-entrega" act={act} />
              ))}
            </ul>
          ) : (
            v.count === 0 && (
              <p className="border-[1.5px] border-line px-4 py-4 text-[15px] text-muted" data-testid="desafio-sem-entregas">
                Ninguém entregou neste desafio.
              </p>
            )
          )}
        </section>
      )}
    </section>
  );
}
