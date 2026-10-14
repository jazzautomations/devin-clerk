import { notFound } from "next/navigation";
import { JudgeScoreForm } from "@/components/JudgeScoreForm";
import { FeedbackReleaseToggle, JuryAssignments, JuryCriteria, PublishResultsButton } from "@/components/JuryOrganizer";
import { isFeedbackReleased } from "@/lib/juryFeedback";
import {
  getRanking,
  isPublished,
  judgeAssignments,
  juryProgress,
  listAssignments,
  listCriteria,
  listJudges,
  listJuryTeams,
  type Criterion,
  type RankingRow,
} from "@/lib/jury";
import { canManageEdition, getEditionRoles } from "@/lib/roles";
import { formatCertDate } from "@/lib/certificates";
import { formatBrt, type JudgedVersion } from "@/lib/entries";
import { currentMember } from "@/lib/session";

// Aba júri (spec 033 US5). Organização: rubrica, atribuição, progresso,
// ranking e publicação. Jurado: só os projetos atribuídos a ele, com as
// próprias notas — sem ranking nem nota de colega antes da publicação.

const h2 = "font-mono text-[12px] tracking-widest text-muted uppercase";

export default async function JuryPage({ params }: PageProps<"/admin/h/[id]/juri">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member) notFound();
  const [manage, roles, criteria, published, feedbackReleased] = await Promise.all([
    canManageEdition(member, id),
    getEditionRoles(id, member.id),
    listCriteria(id),
    isPublished(id),
    isFeedbackReleased(id),
  ]);
  const isJudge = roles.includes("jurado");
  if (!manage && !isJudge) notFound();

  const mine = isJudge ? await judgeAssignments(id, member.id) : [];
  const org = manage
    ? await Promise.all([listJudges(id), listJuryTeams(id), listAssignments(id), juryProgress(id), getRanking(id)])
    : null;
  // jurado vê o ranking só depois de publicado
  const publicRanking = !manage && published ? await getRanking(id) : null;

  return (
    <div className="flex flex-col gap-10">
      {published && (
        <p className="border-[1.5px] border-accent bg-mint px-4 py-3 font-mono text-[13px] text-accent">
          resultado publicado em {formatCertDate(published.publishedAt)} · o pódio já está no arquivo da edição
        </p>
      )}

      {org && (
        <>
          <section className="flex flex-col gap-4">
            <h2 className={h2}>rubrica</h2>
            <JuryCriteria hackathonId={id} criteria={criteria} />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className={h2}>jurados × projetos</h2>
            <JuryAssignments
              hackathonId={id}
              judges={org[0]}
              teams={org[1]}
              assignments={org[2]}
            />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className={h2}>progresso</h2>
            <Progress progress={org[3]} hasCriteria={criteria.length > 0} />
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className={h2}>ranking {published ? "" : "· só a organização vê"}</h2>
              <PublishResultsButton hackathonId={id} published={!!published} disabled={!org[4].some((r) => r.rank !== null)} />
            </div>
            <Ranking ranking={org[4]} criteria={criteria} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className={h2}>feedback pros times</h2>
            <p className="max-w-2xl text-muted">
              Cada time vê, logado, as próprias notas por critério ao lado da média da edição e os comentários
              que os jurados escreveram pro time — sem nome de jurado. A nota interna não vai. Só aparece com o
              resultado publicado e a liberação ligada; dá pra recolher a qualquer momento.
            </p>
            <FeedbackReleaseToggle hackathonId={id} released={feedbackReleased} published={!!published} />
          </section>
        </>
      )}

      {isJudge && (
        <section className="flex flex-col gap-4">
          <h2 className={h2}>tuas avaliações · {mine.length} {mine.length === 1 ? "projeto" : "projetos"}</h2>
          {criteria.length === 0 ? (
            <p className="text-muted">A organização ainda não definiu os critérios.</p>
          ) : mine.length === 0 ? (
            <p className="text-muted">Nenhum projeto atribuído a ti ainda.</p>
          ) : (
            <ul className="flex flex-col gap-5">
              {mine.map((a) => (
                <li key={a.id}>
                  <JudgeScoreForm
                    hackathonId={id}
                    team={{ id: a.id, name: a.name, title: a.title }}
                    criteria={criteria.map((c) => ({ id: c.id, label: c.label }))}
                    initial={a.scores}
                    initialComment={a.comment}
                    initialFeedback={a.feedback}
                    initialGeneral={a.generalFeedback}
                    locked={!!published}
                  />
                  {a.judged && <JudgedSnapshot judged={a.judged} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {publicRanking && (
        <section className="flex flex-col gap-4">
          <h2 className={h2}>resultado</h2>
          <Ranking ranking={publicRanking} criteria={criteria} />
        </section>
      )}
    </div>
  );
}

function Progress({
  progress,
  hasCriteria,
}: {
  progress: Awaited<ReturnType<typeof juryProgress>>;
  hasCriteria: boolean;
}) {
  if (progress.expected === 0) {
    return <p className="text-muted">Nenhuma atribuição ainda.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg">
        <span className="pix text-3xl">{progress.done}</span> de{" "}
        <span className="pix text-3xl">{progress.expected}</span> avaliações completas
        {progress.missing > 0 && <span className="text-orange"> · faltam {progress.missing}</span>}
        {!hasCriteria && <span className="text-muted"> (defina os critérios)</span>}
      </p>
      <ul className="divide-y divide-line border-y border-line font-mono text-[13px]">
        {progress.byJudge.map((j) => (
          <li key={j.memberId} className="flex items-center justify-between gap-3 py-2">
            <span className="truncate">@{j.username}</span>
            <span className={j.complete === j.assigned ? "text-accent" : "text-muted"}>
              {j.complete}/{j.assigned}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ranking({ ranking, criteria }: { ranking: RankingRow[]; criteria: Criterion[] }) {
  if (ranking.length === 0) return <p className="text-muted">Nenhum time na edição ainda.</p>;
  return (
    <ol className="flex flex-col border-t-[1.5px] border-line">
      {ranking.map((r) => (
        <li key={r.teamId} className="grid grid-cols-[3rem_1fr_auto] items-start gap-3 border-b border-line py-3">
          <span className={`pix text-3xl leading-none ${r.rank !== null && r.rank <= 3 ? "text-accent" : "text-muted"}`}>
            {r.rank ?? "–"}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-extrabold tracking-[-0.02em] break-words">
              {r.title ?? r.name}
              {r.tied && (
                <span className="ml-2 border border-orange px-1.5 py-0.5 align-middle font-mono text-[11px] font-normal text-orange uppercase">
                  empate
                </span>
              )}
            </p>
            <p className="font-mono text-[12px] break-words text-muted">
              {r.title && r.title !== r.name ? `${r.name} · ` : ""}
              {r.judges} {r.judges === 1 ? "jurado" : "jurados"}
              {criteria.map((c) => ` · ${c.label} ${r.perCriterion[c.id]?.toFixed(1) ?? "–"}`).join("")}
            </p>
          </div>
          <span className="font-mono text-lg">{r.weighted === null ? "–" : r.weighted.toFixed(2)}</span>
        </li>
      ))}
    </ol>
  );
}

// spec 034 — o jurado avalia a versão enviada até o prazo (snapshot), não o
// rascunho atual do time
function JudgedSnapshot({ judged }: { judged: JudgedVersion }) {
  const s = judged.snapshot;
  const links = [
    ["repositório", s.repoUrl],
    ["vídeo", s.videoUrl],
    ["demo", s.demoUrl],
    ["slides", s.slidesUrl],
    ...s.links.map((l) => [l.label, l.url] as const),
  ].filter((x): x is [string, string] => !!x[1]);
  return (
    <details className="border-x-[1.5px] border-b-[1.5px] border-line px-4 py-3">
      <summary className="cursor-pointer font-mono text-[12px] text-accent">
        versão avaliada · v{judged.version} enviada em {formatBrt(judged.submittedAt)}
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-[14px]">
        {s.tagline && <p className="font-semibold break-words">{s.tagline}</p>}
        {s.description && <p className="whitespace-pre-line break-words text-muted">{s.description}</p>}
        {s.priorWork && (
          <p className="break-words">
            <span className="font-mono text-[12px] text-muted">trabalho anterior: </span>
            {s.priorWork}
          </p>
        )}
        {s.technologies.length > 0 && <p className="font-mono text-[12px] break-words text-muted">{s.technologies.join(" · ")}</p>}
        {s.aiUsage && (
          <p className="break-words">
            <span className="font-mono text-[12px] text-muted">uso de IA: </span>
            {s.aiUsage}
          </p>
        )}
        {links.length > 0 && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
            {links.map(([l, u]) => (
              <a key={u} href={u} target="_blank" rel="noopener" className="break-all text-accent hover:underline">
                {l} ↗
              </a>
            ))}
          </p>
        )}
      </div>
    </details>
  );
}
