import { NPS_ROLE_LABEL, NPS_MIN_GROUP, type NpsStats, type NpsSummary } from "@/lib/nps";

// Painel do NPS — só apresentação. Anônimo de propósito: nenhuma linha traz
// nome, @, data ou ordem de chegada (lib/nps summarize).

const h3 = "font-mono text-[12px] tracking-widest text-muted uppercase";

function Dist({ stats }: { stats: NpsStats }) {
  const max = Math.max(...stats.dist, 1);
  return (
    <div className="grid grid-cols-11 items-end gap-1" aria-label="distribuição das notas de 0 a 10">
      {stats.dist.map((n, score) => (
        <div key={score} className="flex flex-col items-center gap-1">
          <span className="font-mono text-[11px] tabular-nums text-muted">{n}</span>
          <span
            className={`block w-full ${score >= 9 ? "bg-accent" : score >= 7 ? "bg-line" : "bg-orange"}`}
            style={{ height: `${Math.max(2, Math.round((n / max) * 64))}px` }}
          />
          <span className="font-mono text-[11px] tabular-nums">{score}</span>
        </div>
      ))}
    </div>
  );
}

function Score({ stats }: { stats: NpsStats }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="text-[44px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">{stats.nps ?? "—"}</span>
      <span className="font-mono text-[12px] text-muted">
        {stats.responses} respostas · {stats.promoters} promotores · {stats.passives} neutros · {stats.detractors}{" "}
        detratores
      </span>
    </div>
  );
}

export function NpsPanelView({ summary }: { summary: NpsSummary }) {
  const { overall, byRole, comments } = summary;
  return (
    <div className="flex flex-col gap-8" data-testid="nps-panel">
      <section className="flex flex-col gap-4 border-[1.5px] border-line p-4 sm:p-5">
        <h3 className={h3}>NPS geral</h3>
        <Score stats={overall} />
        {overall.responses > 0 && <Dist stats={overall} />}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className={h3}>por papel</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {byRole.map((g) => (
            <li key={g.role} className="flex flex-col gap-3 border-[1.5px] border-line p-4" data-testid={`nps-role-${g.role}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{NPS_ROLE_LABEL[g.role]}</span>
                <span className="font-mono text-[12px] text-muted">
                  {g.invited > 0 ? `${g.responses} de ${g.invited} convidados` : `${g.responses} respostas`}
                </span>
              </div>
              {g.stats ? (
                <>
                  <Score stats={g.stats} />
                  <Dist stats={g.stats} />
                </>
              ) : (
                <p className="font-mono text-[12px] text-muted">
                  {g.responses === 0
                    ? "sem resposta ainda"
                    : `menos de ${NPS_MIN_GROUP} respostas — a nota do papel fica escondida pra ninguém ser reconhecido`}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className={h3}>comentários ({comments.length})</h3>
        {comments.length === 0 ? (
          <p className="font-mono text-[13px] text-muted">nenhum comentário ainda</p>
        ) : (
          <ul className="border-b border-line" data-testid="nps-comments">
            {comments.map((c, i) => (
              <li key={i} className="flex flex-col gap-1.5 border-t border-line py-3">
                <span className="font-mono text-[12px] text-muted">
                  {c.role ? NPS_ROLE_LABEL[c.role] : "papel omitido"} · nota {c.score}
                </span>
                {c.worked && (
                  <p className="text-[14px] break-words whitespace-pre-line">
                    <strong className="font-semibold">funcionou:</strong> {c.worked}
                  </p>
                )}
                {c.improve && (
                  <p className="text-[14px] break-words whitespace-pre-line">
                    <strong className="font-semibold">melhorar:</strong> {c.improve}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
