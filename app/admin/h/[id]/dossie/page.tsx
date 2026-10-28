import Link from "next/link";
import { notFound } from "next/navigation";
import { DossierRefresh } from "@/components/DossierRefresh";
import { formatDay, listDossiers, type Declaration, type Phase, type TeamDossier } from "@/lib/dossier";
import { formatBrt, formatBrtTime, toDbTime } from "@/lib/entries";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";

// Aba dossiê (roadmap 037 #10, migration 029): por projeto, a linha do tempo
// dos commits contra a janela do evento e a declaração do time. Só
// organizador/admin da edição. O dossiê só sinaliza; quem decide é a
// organização.

const h2 = "font-mono text-[12px] tracking-widest text-muted uppercase";
const PHASE: Record<Phase, { label: string; bar: string; text: string }> = {
  antes: { label: "antes do início", bar: "bg-orange", text: "text-orange" },
  durante: { label: "durante", bar: "bg-accent", text: "text-accent" },
  depois: { label: "depois do prazo", bar: "bg-muted", text: "text-muted" },
};

const full = (v: string | null) => (v ? `${formatDay(v)} ${formatBrtTime(v)}` : "");

function Answer({ q, yes, detail }: { q: string; yes: boolean | null; detail: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-mono text-[12px] text-muted">{q}</dt>
      <dd className="min-w-0 text-[14px] break-words whitespace-pre-line">
        <span className="font-mono text-[13px]">{yes === null ? "não respondeu" : yes ? "sim" : "não"}</span>
        {detail && <span className="text-muted"> · {detail}</span>}
      </dd>
    </div>
  );
}

function DeclarationBlock({ d }: { d: Declaration }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2" data-testid="dossie-declaracao">
      <Answer q="já existia algo antes do evento?" yes={d.priorExisted} detail={d.priorWork} />
      <Answer q="usou IA? como?" yes={d.usedAi} detail={d.aiUsage} />
    </dl>
  );
}

function TimelineBlock({ c }: { c: NonNullable<TeamDossier["collection"]> }) {
  const t = c.timeline;
  const parts: [Phase, number][] = [
    ["antes", t.before],
    ["durante", t.during],
    ["depois", t.after],
  ];
  const sum = t.before + t.during + t.after;
  return (
    <div className="flex flex-col gap-3" data-testid="dossie-linha">
      <div
        className="flex h-3 w-full overflow-hidden border-[1.5px] border-line"
        role="img"
        aria-label={`commits: ${t.before} antes do início, ${t.during} durante, ${t.after} depois do prazo`}
      >
        {parts
          .filter(([, n]) => n > 0)
          .map(([p, n]) => (
            <span key={p} className={PHASE[p].bar} style={{ width: `${(n / sum) * 100}%` }} />
          ))}
      </div>
      <dl className="grid grid-cols-3 gap-2 font-mono text-[12px]">
        {parts.map(([p, n]) => (
          <div key={p} className="flex min-w-0 flex-col">
            <dt className="text-muted">{PHASE[p].label}</dt>
            <dd className={`pix text-2xl ${n > 0 ? PHASE[p].text : ""}`} data-testid={`dossie-${p}`}>
              {n}
            </dd>
          </div>
        ))}
      </dl>
      <p className="font-mono text-[12px] break-words text-muted">
        {t.firstCommitAt && <>primeiro commit {full(t.firstCommitAt)} · </>}
        {c.repoCreatedAt && <>repositório criado {formatDay(c.repoCreatedAt)} · </>}
        {c.totalCommits} {c.totalCommits === 1 ? "commit" : "commits"}
        {c.defaultBranch && ` no ${c.defaultBranch}`}
      </p>
      {c.truncated && (
        <p className="font-mono text-[12px] text-muted" data-testid="dossie-grande">
          Repositório grande: {t.counted} commits lidos (os mais novos e os mais antigos) de {c.totalCommits}. Os{" "}
          {t.inferred} do meio entram na conta pela data dos vizinhos
          {t.estimated ? "; o início ou o prazo cai entre eles, então a divisão é estimativa." : "."}
        </p>
      )}
    </div>
  );
}

function TeamCard({ hackathonId, t }: { hackathonId: string; t: TeamDossier }) {
  const c = t.collection;
  const signals = c?.collectedAt ? c.timeline.signals : [];
  return (
    <li className="flex flex-col gap-4 border-b border-line py-5" data-testid={`dossie-time-${t.teamId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-extrabold tracking-[-0.02em] break-words">{t.teamName}</p>
          <p className="font-mono text-[12px] break-words text-muted">
            {t.title ? (
              <Link href={`/p/${t.teamId}`} className="hover:text-accent">
                {t.title}
              </Link>
            ) : (
              "sem projeto"
            )}
            {" · "}
            {t.submitted ? "versão enviada" : "rascunho"}
          </p>
        </div>
        {t.repoUrl ? (
          <a
            href={t.repoUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="max-w-full font-mono text-[12px] break-all text-accent hover:underline"
          >
            {c?.repoFullName ?? t.repoUrl.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        ) : (
          <span className="font-mono text-[12px] text-muted">sem repositório</span>
        )}
      </div>

      <DeclarationBlock d={t.declaration} />

      {!t.repoUrl ? (
        <p className="text-[14px] text-muted">
          O time não informou repositório. Sem código público não tem linha do tempo; vale perguntar ao time.
        </p>
      ) : (
        <>
          {!c && <p className="text-[14px] text-muted">Repositório ainda não lido.</p>}
          {c?.error && (
            <p role="status" className="font-mono text-[13px] text-orange" data-testid="dossie-erro">
              {c.error.message}
              {c.collectedAt && ` Mostrando a leitura de ${formatBrt(c.collectedAt)}.`}
            </p>
          )}
          {c?.stale && (
            <p className="font-mono text-[13px] text-orange">
              Esta leitura é de outro link ({c.repoUrl}). O time trocou o repositório: atualize.
            </p>
          )}
          {c && c.collectedAt && c.timeline.counted > 0 && <TimelineBlock c={c} />}
          {c && c.collectedAt && (
            <div className="flex flex-col gap-2">
              <h3 className="font-mono text-[12px] text-muted">sinais</h3>
              {signals.length === 0 ? (
                <p className="text-[14px] text-muted" data-testid="dossie-sem-sinal">
                  Nenhum sinal: os commits caem dentro da janela do evento.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5" data-testid="dossie-sinais">
                  {signals.map((s) => (
                    <li key={s.key} className="border-l-[3px] border-orange pl-3 text-[14px] break-words">
                      {s.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {c && c.commits.length > 0 && (
            <details className="border-[1.5px] border-line">
              <summary className="cursor-pointer px-3 py-2 font-mono text-[12px]">
                ver commits lidos ({c.commits.length})
              </summary>
              <ol className="flex flex-col border-t border-line font-mono text-[12px]">
                {c.commits.map((m) => (
                  <li key={m.sha} className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 last:border-b-0">
                    <span className="text-muted">{full(m.date)}</span>
                    <span className={PHASE[m.phase].text}>{PHASE[m.phase].label}</span>
                    {c.repoFullName ? (
                      <a
                        href={`https://github.com/${c.repoFullName}/commit/${m.sha}`}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-accent hover:underline"
                      >
                        {m.sha.slice(0, 7)}
                      </a>
                    ) : (
                      <span>{m.sha.slice(0, 7)}</span>
                    )}
                    <span className="text-muted">{m.author}</span>
                    <span className="w-full break-words">{m.message}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
          <div className="flex flex-col gap-1">
            {c && (
              <p className="font-mono text-[12px] text-muted">
                {c.collectedAt ? `lido em ${formatBrt(c.collectedAt)}` : `tentativa em ${formatBrt(c.attemptedAt)}`}
              </p>
            )}
            <DossierRefresh hackathonId={hackathonId} teamId={t.teamId} />
          </div>
        </>
      )}
    </li>
  );
}

export default async function DossierPanel({ params }: PageProps<"/admin/h/[id]/dossie">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await canManageEdition(member, id))) notFound();
  const { window, teams } = await listDossiers(id);
  const withRepo = teams.filter((t) => t.repoUrl).length;
  const flagged = teams.filter((t) => (t.collection?.collectedAt ? t.collection.timeline.signals.length : 0) > 0).length;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3 border-[1.5px] border-line bg-mint p-4" data-testid="dossie-aviso">
        <h2 className={h2}>dossiê de evidência</h2>
        <p className="max-w-3xl text-[15px]">
          O dossiê só sinaliza. Ninguém é desclassificado nem perde nota por ele: a decisão é da organização, depois de
          conversar com o time.
        </p>
        <p className="max-w-3xl text-[14px] text-muted">
          A linha do tempo compara os commits do repositório público com a janela do evento. As datas vêm do git e quem
          commita pode editá-las. O HackaHub lê o GitHub quando o time envia a entrega, e de novo quando você clica em
          atualizar.
        </p>
        <p className="font-mono text-[12px] text-muted" data-testid="dossie-janela">
          janela: {window.start ? formatBrt(toDbTime(window.start)) : "sem início"} até{" "}
          {window.end ? formatBrt(toDbTime(window.end)) : "sem prazo"} · horário de Brasília
        </p>
      </section>

      <dl className="grid grid-cols-3 border-t-[1.5px] border-l-[1.5px] border-line">
        {(
          [
            ["times", teams.length],
            ["com repositório", withRepo],
            ["com sinal", flagged],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-1 border-r-[1.5px] border-b-[1.5px] border-line p-3 sm:p-4">
            <dt className="font-mono text-[11px] tracking-widest break-words text-muted uppercase">{k}</dt>
            <dd className="pix text-3xl">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className={h2}>projetos</h2>
        {teams.length === 0 ? (
          <p className="text-muted" data-testid="dossie-vazio">
            Nenhum time ainda. O dossiê aparece aqui quando os times montarem a entrega.
          </p>
        ) : (
          <ul className="flex flex-col border-t-[1.5px] border-line">
            {teams.map((t) => (
              <TeamCard key={t.teamId} hackathonId={id} t={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
