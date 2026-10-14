import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { teamFeedbackFor, teamName, type FeedbackCriterion } from "@/lib/juryFeedback";

// Feedback do júri pro time (roadmap 037 #9): só membro do time, logado,
// depois do resultado publicado e da liberação. Notas por critério ao lado
// da média da edição e comentários anônimos. Nada é indexado.

type Props = { params: Promise<{ teamId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = Number((await params).teamId);
  const team = Number.isInteger(id) && id > 0 ? await teamName(id) : null;
  return { title: team ? `feedback do júri — ${team}` : "feedback do júri", robots: { index: false, follow: false } };
}

const h2 = "font-mono text-xs tracking-[0.06em] text-muted uppercase";
const fmt = (n: number | null) => (n === null ? "–" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }));

function Shell({ teamId, children }: { teamId: number; children: React.ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16">
      {children}
      <Link href={`/p/${teamId}`} className="w-fit font-mono text-xs text-muted transition hover:text-accent">
        {"← voltar pro projeto"}
      </Link>
    </section>
  );
}

function Notice({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div data-testid="feedback-locked" className="flex flex-col gap-3 border-[1.5px] border-line px-5 py-5">
      <p className="tag self-start uppercase">feedback do júri</p>
      <h1 className="text-[clamp(1.6rem,5vw,2.2rem)] leading-tight font-extrabold tracking-[-0.03em]">{title}</h1>
      <p className="text-muted">{text}</p>
      {action}
    </div>
  );
}

function Bar({ value, tone }: { value: number | null; tone: "team" | "edition" }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="relative block h-2 w-full border border-line bg-background" aria-hidden>
      <span className={`absolute inset-y-0 left-0 ${tone === "team" ? "bg-accent" : "bg-muted"}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

function CriterionBlock({ c }: { c: FeedbackCriterion }) {
  const diff = c.team !== null && c.edition !== null ? c.team - c.edition : null;
  return (
    <li className="flex flex-col gap-3 border-b border-line py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="min-w-0 text-lg font-extrabold tracking-[-0.02em] break-words">{c.label}</h3>
        <span className="font-mono text-[12px] text-muted">peso {c.weight}</span>
      </div>
      <div className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-x-3 gap-y-2 font-mono text-[13px]">
        <span>seu time</span>
        <Bar value={c.team} tone="team" />
        <span className="text-right text-accent">{fmt(c.team)}</span>
        <span className="text-muted">média edição</span>
        <Bar value={c.edition} tone="edition" />
        <span className="text-right text-muted">{fmt(c.edition)}</span>
      </div>
      {diff !== null && (
        <p className="font-mono text-[12px] text-muted">
          {Math.abs(diff) < 0.05
            ? "na média da edição"
            : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))} ${diff > 0 ? "acima" : "abaixo"} da média`}
        </p>
      )}
      {c.comments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {c.comments.map((t, i) => (
            <li key={i} className="border-l-[3px] border-accent bg-mint px-3 py-2 whitespace-pre-line break-words">
              {t}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function TeamFeedbackPage({ params }: Props) {
  const { teamId: raw } = await params;
  const teamId = Number(raw);
  // time inexistente é 404 pra todo mundo (o nome do time já é público na ficha)
  if (!Number.isInteger(teamId) || teamId <= 0 || !(await teamName(teamId))) notFound();
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  const res = await teamFeedbackFor(member, teamId);

  if (res.status === "not_found") notFound();
  if (res.status === "unauthorized") {
    return (
      <Shell teamId={teamId}>
        <Notice
          title="Entre pra ver o feedback"
          text="O feedback do júri é só pro time. Entre com a conta de quem é do time."
          action={
            <Link href={`/sign-in?redirect_url=${encodeURIComponent(`/p/${teamId}/feedback`)}`} className="btn self-start">
              entrar
            </Link>
          }
        />
      </Shell>
    );
  }
  if (res.status === "forbidden") {
    return (
      <Shell teamId={teamId}>
        <Notice title="Feedback só do time" text="Só quem é do time vê o feedback do júri sobre o projeto." />
      </Shell>
    );
  }
  if (res.status === "hidden") {
    return (
      <Shell teamId={teamId}>
        <Notice
          title="Feedback ainda não liberado"
          text={`A organização do ${res.hackathonName} libera o feedback do júri depois de publicar o resultado. Você recebe um aviso quando sair.`}
        />
      </Shell>
    );
  }

  const f = res.feedback;
  const empty = f.judges === 0 && f.general.length === 0 && f.criteria.every((c) => c.comments.length === 0);
  return (
    <Shell teamId={teamId}>
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">feedback do júri</p>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.035em] break-words">
          {f.teamName}
        </h1>
        <p className="font-mono text-sm text-muted">
          <Link href={`/h/${f.hackathonId}`} className="text-accent hover:underline">
            {f.hackathonName}
          </Link>
          {" · "}
          {f.judges} {f.judges === 1 ? "jurado avaliou" : "jurados avaliaram"} · comentários anônimos
        </p>
      </div>

      {empty ? (
        <p className="border-[1.5px] border-line px-5 py-4 font-mono text-xs text-muted">
          o júri não deixou nota nem comentário pro seu time
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 border-[1.5px] border-line">
            <div className="flex flex-col gap-1 border-r border-line p-4">
              <span className="font-mono text-[11px] tracking-widest text-muted uppercase">nota do time</span>
              <span className="pix text-4xl text-accent">{fmt(f.weighted.team)}</span>
            </div>
            <div className="flex flex-col gap-1 p-4">
              <span className="font-mono text-[11px] tracking-widest text-muted uppercase">média da edição</span>
              <span className="pix text-4xl">{fmt(f.weighted.edition)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className={h2}>por critério · escala de 1 a 5</h2>
            <ul className="flex flex-col border-t-[1.5px] border-line">
              {f.criteria.map((c) => (
                <CriterionBlock key={c.id} c={c} />
              ))}
            </ul>
          </div>

          {f.general.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className={h2}>comentários gerais</h2>
              <ul className="flex flex-col gap-2">
                {f.general.map((t, i) => (
                  <li key={i} className="border-[1.5px] border-line px-4 py-3 whitespace-pre-line break-words">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
