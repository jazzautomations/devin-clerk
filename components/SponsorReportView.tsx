import Link from "next/link";
import { NPS_ROLE_LABEL } from "@/lib/nps";
import type { Bucket, SponsorReport } from "@/lib/sponsorReport";

// Relatório do patrocinador — só apresentação (server component puro, sem
// banco): a página calcula o relatório e passa pronto. Imprime limpo
// (print:hidden nos controles, quebra evitada dentro das seções).

const h3 = "font-mono text-[12px] tracking-widest text-muted uppercase";
const section = "flex flex-col gap-3 break-inside-avoid";
const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const fmtDate = (iso: string) => {
  const d = new Date(iso.includes("T") || iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d).replace(",", "");
};

function Bars({ buckets, base }: { buckets: Bucket[]; base: number }) {
  if (buckets.length === 0) return <p className="font-mono text-[13px] text-muted">sem dado ainda</p>;
  const max = Math.max(base, ...buckets.map((b) => b.n), 1);
  return (
    <ul className="flex flex-col gap-1.5">
      {buckets.map((b) => (
        <li key={b.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[14px]">
          <span className="min-w-0 truncate">{b.label}</span>
          <span className="font-mono text-[13px] tabular-nums">{b.n}</span>
          <span className="col-span-2 h-1.5 bg-mint">
            <span className="block h-full bg-accent" style={{ width: `${Math.round((b.n / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <div className="flex flex-col gap-1 border-[1.5px] border-line p-3" data-testid={testId}>
      <span className="text-[28px] leading-none font-extrabold tracking-[-0.03em] tabular-nums">{value}</span>
      <span className="font-mono text-[12px] text-muted">{label}</span>
    </div>
  );
}

export function SponsorReportView({
  report: r,
  csvHref,
  actions,
}: {
  report: SponsorReport;
  csvHref: string;
  actions?: React.ReactNode;
}) {
  const nps = r.nps.overall;
  return (
    <article className="flex flex-col gap-8" data-testid="sponsor-report">
      <header className="flex flex-col gap-4 border-b-2 border-line pb-5">
        <div className="flex flex-wrap items-center gap-4">
          {r.sponsor.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- logo remoto da marca; next/image exigiria remotePatterns
            <img src={r.sponsor.logoUrl} alt={`logo de ${r.sponsor.name}`} className="h-12 max-w-[180px] object-contain" />
          )}
          <div className="min-w-0">
            <p className={h3}>relatório do patrocinador · {r.sponsor.tier}</p>
            <h2 className="text-[clamp(1.5rem,4vw,2.2rem)] leading-none font-extrabold tracking-[-0.03em] break-words">
              {r.sponsor.name}
            </h2>
          </div>
        </div>
        <p className="text-[14px] text-muted">
          {r.edition.name} · gerado em {fmtDate(r.generatedAt)}. Números agregados e sem dado pessoal; contato só de
          quem aceitou compartilhar com a marca.
        </p>
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          {actions}
          <a href={csvHref} className="btn-ghost rounded-[6px]" download>
            baixar CSV
          </a>
        </div>
      </header>

      <section className={section}>
        <h3 className={h3}>funil da edição</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="inscritos" value={r.funnel.inscritos} testId="rep-inscritos" />
          <Stat label="aprovados" value={r.funnel.aprovados} testId="rep-aprovados" />
          <Stat label="confirmados" value={r.funnel.confirmados ?? "—"} testId="rep-confirmados" />
          <Stat label="presentes" value={r.funnel.presentes} testId="rep-presentes" />
        </div>
        {r.funnel.confirmados === null && (
          <p className="font-mono text-[12px] text-muted">confirmação de presença (RSVP) desligada nesta edição</p>
        )}
      </section>

      <section className={section}>
        <h3 className={h3}>desafios e prêmios da marca</h3>
        {r.challenges.length === 0 ? (
          <p className="font-mono text-[13px] text-muted">nenhum desafio ligado à marca. Peça à organização pra vincular o desafio nesta edição.</p>
        ) : (
          <ul className="border-b border-line">
            {r.challenges.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line py-2">
                <span className="min-w-0 font-semibold break-words">{c.title}</span>
                {c.prize && <span className="font-mono text-[13px] text-lendario">prêmio: {c.prize}</span>}
              </li>
            ))}
          </ul>
        )}
        {r.categories.length > 0 && (
          <p className="text-[14px] text-muted">Categorias: {r.categories.map((c) => c.name).join(" · ")}</p>
        )}
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section className={section}>
          <h3 className={h3}>perfil dos aprovados ({r.profile.base})</h3>
          <Bars buckets={r.profile.personas} base={r.profile.base} />
          {r.profile.institutions.map((q) => (
            <div key={q.question} className="flex flex-col gap-2 pt-2">
              <p className="text-[14px] font-semibold break-words">{q.question}</p>
              <Bars buckets={q.buckets} base={r.profile.base} />
            </div>
          ))}
          <p className="font-mono text-[12px] text-muted">faixa com menos de 3 pessoas entra em &quot;outros&quot;</p>
        </section>
        <section className={section}>
          <h3 className={h3}>stack dos projetos (times por tecnologia)</h3>
          <Bars buckets={r.stack} base={0} />
        </section>
      </div>

      <section className={section}>
        <h3 className={h3}>times no desafio ({r.teamCount})</h3>
        {!r.teamsVisible ? (
          <p className="text-[14px] text-muted">
            Os projetos aparecem aqui depois do prazo de entrega. Até agora {r.teamCount}{" "}
            {r.teamCount === 1 ? "time enviou" : "times enviaram"} pro desafio.
          </p>
        ) : r.teams.length === 0 ? (
          <p className="font-mono text-[13px] text-muted">nenhum time entrou no desafio</p>
        ) : (
          <ul className="border-b border-line" data-testid="rep-teams">
            {r.teams.map((t) => (
              <li key={t.teamId} className="flex flex-col gap-1.5 border-t border-line py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link href={`/p/${t.teamId}`} className="min-w-0 font-semibold break-words underline-offset-4 hover:underline">
                    {t.title}
                  </Link>
                  <span className="font-mono text-[12px] text-muted">
                    {t.teamName} · {t.challenges.join(", ")}
                  </span>
                </div>
                {t.tagline && <p className="text-[14px] break-words text-muted">{t.tagline}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
                  {t.repoUrl && (
                    <a href={t.repoUrl} className="break-all text-accent underline-offset-4 hover:underline">
                      repo
                    </a>
                  )}
                  {t.demoUrl && (
                    <a href={t.demoUrl} className="break-all text-accent underline-offset-4 hover:underline">
                      demo
                    </a>
                  )}
                  <span>júri {t.juryAvg ?? "—"}</span>
                  <span>votos {t.communityVotes}</span>
                  <span>
                    palco {t.liveVotes}
                    {t.liveAvg !== null ? ` · média ${t.liveAvg}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-8 md:grid-cols-3">
        <section className={section}>
          <h3 className={h3}>vencedores da marca</h3>
          {r.winners.length === 0 ? (
            <p className="font-mono text-[13px] text-muted">resultado ainda não publicado</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {r.winners.map((w) => (
                <li key={`${w.categoryName}-${w.teamId}`} className="text-[14px] break-words">
                  <span className="font-mono text-lendario">{w.place}º</span> {w.title ?? w.teamName}
                  <span className="block font-mono text-[12px] text-muted">{w.categoryName}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={section}>
          <h3 className={h3}>votos do público</h3>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="comunidade" value={r.votes.community} />
            <Stat label="palco" value={r.votes.live} />
          </div>
          {!r.votes.liveQuorumMet && (
            <p className="font-mono text-[12px] text-muted">média do palco só com quórum de votos</p>
          )}
        </section>
        <section className={section}>
          <h3 className={h3}>nota do júri no desafio</h3>
          {r.jury.visible ? (
            <Stat label={`média 1–5 · ${r.jury.judgedTeams} times avaliados`} value={r.jury.avg ?? "—"} testId="rep-jury" />
          ) : (
            <p className="text-[14px] text-muted">Sigilosa até a organização publicar o resultado.</p>
          )}
        </section>
      </div>

      <section className={section}>
        <h3 className={h3}>NPS da edição ({nps.responses} respostas)</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="NPS geral" value={nps.nps ?? "—"} testId="rep-nps" />
          {r.nps.byRole
            .filter((g) => g.stats)
            .map((g) => (
              <Stat key={g.role} label={NPS_ROLE_LABEL[g.role]} value={g.stats!.nps ?? "—"} />
            ))}
        </div>
      </section>

      <section className={section}>
        <h3 className={h3}>talentos que compartilharam contato ({r.talents.length})</h3>
        {r.talents.length === 0 ? (
          <p className="text-[14px] text-muted">
            Ninguém compartilhou ainda. O QR do estande leva ao opt-in — só quem aceita aparece aqui.
          </p>
        ) : (
          <ul className="border-b border-line" data-testid="rep-talents">
            {r.talents.map((t) => (
              <li key={`${t.email}-${t.sharedAt}`} className="flex flex-col gap-1 border-t border-line py-3">
                <span className="font-semibold break-words">{t.name ?? t.email}</span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
                  <a href={`mailto:${t.email}`} className="break-all text-accent">
                    {t.email}
                  </a>
                  {t.linkedin && <span className="break-all">{t.linkedin}</span>}
                  {t.github && <span className="break-all">{t.github}</span>}
                  {t.project && <span className="break-words">projeto: {t.project}</span>}
                  <span className="text-muted">desde {fmtDate(t.sharedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
