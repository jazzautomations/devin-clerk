import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  canSeeMetrics,
  formatAvg,
  formatHours,
  formatPct,
  getNetworkMetrics,
  TESTIMONIAL_GOAL,
  type MetricWeek,
  type Ratio,
} from "@/lib/metrics";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "métricas da rede", robots: { index: false } };

// Painel de métricas da rede (spec 046, metricas-e-checkpoint). Só o admin
// global vê; qualquer outra pessoa leva 404. Só leitura: os números saem de
// lib/metrics.ts, direto das tabelas.

type Cell = { main: string; sub?: string };
type Row = { key: string; label: string; hint: string; cells: Cell[] };

const ratioCell = (r: Ratio | null): Cell =>
  r && r.den > 0 ? { main: formatPct(r), sub: `${r.num} de ${r.den}` } : { main: "—" };

const GOAL_PCT = `${Math.round(TESTIMONIAL_GOAL * 100)}%`;
const GOAL = `meta ${GOAL_PCT}`;

export default async function MetricasPage() {
  const me = await currentMember();
  if (!canSeeMetrics(me)) notFound();
  const m = await getNetworkMetrics();
  const last = m.weeks.length - 1;

  const uso: Row[] = [
    {
      key: "ativos",
      label: "Ativos na semana",
      hint: "Entrou logada, postou, comentou ou seguiu alguém na semana.",
      cells: m.active.map((n) => ({ main: String(n) })),
    },
    {
      key: "seguem",
      label: "Ativos que seguem alguém",
      hint: "Dos ativos da semana, quem segue pelo menos uma pessoa.",
      cells: m.following.map(ratioCell),
    },
  ];

  const conversa: Row[] = [
    {
      key: "posts",
      label: "Posts",
      hint: "Publicados na semana, em qualquer mural.",
      cells: m.posts.map((p) => ({ main: String(p.posts) })),
    },
    {
      key: "posts-comentados",
      label: "Posts com resposta",
      hint: "Posts da semana com comentário de outra pessoa.",
      cells: m.posts.map((p) => ratioCell(p.commented)),
    },
    {
      key: "reacoes-por-post",
      label: "Reações por post",
      hint: "Média nos posts da semana.",
      cells: m.posts.map((p) => ({
        main: formatAvg(p.reactionsPerPost),
        sub: p.posts > 0 ? `${p.reactions} no total` : undefined,
      })),
    },
    {
      key: "reacoes-alem-de-curti",
      label: "Reações além de curti",
      hint: "Parte das reações que é ajudou, quero testar ou aprendi.",
      cells: m.posts.map((p) => ratioCell(p.otherReactions)),
    },
  ];

  const moderacao: Row[] = [
    {
      key: "denuncias-global",
      label: "Denúncias abertas na fila global",
      hint: "Perfil, comunidade inteira e o que não é de um mural. Retrato do fim da semana.",
      cells: m.openReports.map((q) => ({ main: String(q.global) })),
    },
    {
      key: "denuncias-comunidade",
      label: "Abertas nas filas de comunidade",
      hint: "Somando todas as comunidades.",
      cells: m.openReports.map((q) => ({ main: String(q.comunidade) })),
    },
    {
      key: "denuncias-edicao",
      label: "Abertas nas filas de edição",
      hint: "Somando todas as edições.",
      cells: m.openReports.map((q) => ({ main: String(q.edicao) })),
    },
    {
      key: "tempo-resolver",
      label: "Tempo até resolver",
      hint: "Mediana entre abrir e resolver, nas denúncias resolvidas na semana.",
      cells: m.resolution.map((r) => ({
        main: formatHours(r.hours),
        sub: r.resolved > 0 ? `${r.resolved} resolvida${r.resolved > 1 ? "s" : ""}` : undefined,
      })),
    },
  ];

  const volta: Row[] = [
    {
      key: "volta-14-dias",
      label: "Voltou 14 dias depois",
      hint: "Quem fez check-in numa edição que terminou na semana e entrou de novo 14 dias ou mais depois do fim. Edição recente ainda não entra.",
      cells: m.retention.map(ratioCell),
    },
  ];

  const t = m.testimonials;
  const testimonialNote = !t
    ? "O depoimento de time ainda não está no ar."
    : t.teams === 0
      ? "Nenhum time em edição encerrada nos últimos 60 dias."
      : `${t.teams} time${t.teams > 1 ? "s" : ""} de edições encerradas nos últimos 60 dias.`;
  const written = t && t.teams > 0 ? t.written : null;
  const hitGoal = written?.pct != null && written.pct >= TESTIMONIAL_GOAL;

  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-10 overflow-x-clip px-4 py-12 sm:px-6 sm:py-16"
      data-testid="metrics-page"
    >
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href="/admin" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← painel do organizador
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Métricas da rede</h1>
        <p className="max-w-[62ch] text-[15px] text-muted">
          As últimas 4 semanas, de segunda a domingo no horário de Brasília. Cada número sai de uma consulta no banco. Só o
          admin vê esta página.
        </p>
      </header>

      <div className="window paper hard" data-testid="metrics-checkpoint">
        <div className="tbar">
          <span className="title">checkpoint da onda 3</span>
          <span className="dots" aria-hidden>
            <b />
            <b />
            <b />
          </span>
        </div>
        <div className="flex flex-col gap-4 p-3 sm:p-4">
          <div className="ink-grid grid-cols-1 sm:grid-cols-3">
            <Stat
              testId="checkpoint-wau"
              label="ativos esta semana"
              value={String(m.active[last] ?? 0)}
              sub={last > 0 ? `semana passada: ${m.active[last - 1]}` : undefined}
            />
            <Stat
              testId="checkpoint-follow"
              label="ativos que seguem alguém"
              value={formatPct(m.following[last])}
              sub={m.following[last]?.den ? `${m.following[last].num} de ${m.following[last].den}` : "ninguém ativo ainda"}
            />
            <Stat
              testId="checkpoint-depoimento"
              label="times com depoimento"
              value={formatPct(written)}
              sub={written ? `${written.num} de ${written.den} times` : testimonialNote}
              goal={hitGoal ? `bateu a meta de ${GOAL_PCT}` : GOAL}
              hit={hitGoal}
            />
          </div>
          <p className="font-sans text-[15px] leading-snug font-semibold">
            A Onda 3 começa quando o fundador olhar estes números depois da próxima edição.
          </p>
        </div>
      </div>

      <MetricTable title="Uso" weeks={m.weeks} rows={uso} />
      <MetricTable title="Conversa" weeks={m.weeks} rows={conversa} />

      <section className="flex flex-col gap-3" aria-labelledby="metricas-agora" data-testid="metrics-now">
        <h2 id="metricas-agora" className="eyebrow uppercase tracking-widest">
          retrato de agora
        </h2>
        <p className="max-w-[62ch] text-[14px] text-muted">
          Estes não têm histórico por semana: valem pro dia de hoje.
        </p>
        <div className="ink-grid grid-cols-1 sm:grid-cols-3">
          <Stat
            testId="now-depoimento-escrito"
            label="times com depoimento escrito"
            value={formatPct(written)}
            sub={testimonialNote}
            goal={GOAL}
          />
          <Stat
            testId="now-depoimento-aceito"
            label="times com depoimento aceito"
            value={formatPct(t && t.teams > 0 ? t.accepted : null)}
            sub={t && t.teams > 0 ? `${t.accepted.num} de ${t.accepted.den}` : "Aceito é o que aparece no perfil."}
            goal={GOAL}
          />
          <Stat
            testId="now-perfil-aberto"
            label="contas com perfil aberto"
            value={formatPct(m.publicProfile)}
            sub={
              m.publicProfile
                ? `${m.publicProfile.num} de ${m.publicProfile.den} contas`
                : "O perfil aberto ainda não está no ar."
            }
          />
        </div>
      </section>

      <MetricTable title="Moderação" weeks={m.weeks} rows={moderacao} />
      <MetricTable title="Volta depois do evento" weeks={m.weeks} rows={volta} />

      <p className="max-w-[62ch] border-t-[1.5px] border-line pt-4 font-mono text-[12px] leading-relaxed text-muted">
        O banco guarda só o último acesso de cada pessoa. Nas semanas antigas, quem só leu e voltou depois sai da conta,
        então ali o número de ativos é piso.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  goal,
  hit,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  goal?: string;
  hit?: boolean;
  testId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-3" data-testid={testId}>
      <span className="font-mono text-[12px] text-muted">{label}</span>
      <span className="font-display text-[2.25rem] leading-none font-extrabold tracking-[-0.04em]" data-testid={`${testId}-value`}>
        {value}
      </span>
      {sub && <span className="font-mono text-[12px] break-words text-muted">{sub}</span>}
      {goal && (
        <span
          className={`mt-1 self-start border-[1.5px] px-1.5 font-mono text-[11px] ${
            hit ? "border-accent text-accent" : "border-line text-foreground"
          }`}
        >
          {goal}
        </span>
      )}
    </div>
  );
}

function MetricTable({ title, weeks, rows }: { title: string; weeks: MetricWeek[]; rows: Row[] }) {
  const id = `metricas-${title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]+/g, "-")}`;
  return (
    <section className="flex flex-col gap-3" aria-labelledby={id}>
      <h2 id={id} className="eyebrow uppercase tracking-widest">
        {title}
      </h2>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b-2 border-line">
            {weeks.map((w) => (
              <th key={w.start} scope="col" className="px-2 pb-1.5 text-left align-bottom font-mono text-[11px] font-medium text-muted">
                {w.partial ? (
                  <>
                    <span className="block text-accent">esta semana</span>
                    <span className="block">desde {w.label}</span>
                  </>
                ) : (
                  <span className="block">semana {w.label}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        {rows.map((r) => (
          <tbody key={r.key} data-testid={`metric-${r.key}`}>
            <tr>
              <th scope="colgroup" colSpan={weeks.length} className="px-0 pt-4 pb-1.5 text-left font-normal">
                <span className="block text-[15px] font-bold tracking-[-0.01em]">{r.label}</span>
                <span className="mt-0.5 block max-w-[62ch] text-[13px] leading-snug text-muted">{r.hint}</span>
              </th>
            </tr>
            <tr className="border-y-[1.5px] border-line">
              {r.cells.map((c, i) => (
                <td
                  key={weeks[i]?.start ?? i}
                  className={`px-2 py-2 align-top ${i > 0 ? "border-l-[1.5px] border-line-soft" : ""} ${
                    weeks[i]?.partial ? "bg-mint/50" : ""
                  }`}
                >
                  <span className="block font-mono text-[17px] leading-tight font-bold">{c.main}</span>
                  {c.sub && <span className="block font-mono text-[11px] break-words text-muted">{c.sub}</span>}
                </td>
              ))}
            </tr>
          </tbody>
        ))}
      </table>
    </section>
  );
}
