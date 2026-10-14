import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { appConfig } from "@/app.config";
import { getLatestDeployForTeam } from "@/lib/deploys";
import { formatBrt } from "@/lib/entries";
import { getProjectView } from "@/lib/entriesPublic";
import { getMemberByClerkId } from "@/lib/members";
import { hasVoted, voteCountFor } from "@/lib/votes";
import { VoteButton } from "@/components/VoteButton";
import { ShareBar } from "@/components/ShareBar";
import { absoluteUrl } from "@/lib/seo";

// Ficha do projeto (spec 010/030; ordem da spec 034 §5.8): capa · título ·
// tagline · selos · vídeo do time · vídeo do palco · demo ao vivo ·
// descrição · trabalho anterior · tecnologias · desafios · links · time ·
// versão avaliada · depois do hackathon · voto. O conteúdo segue a matriz
// de visibilidade da entrega (lib/entriesPublic).

type Props = { params: Promise<{ teamId: string }> };

function parseTeamId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { teamId } = await params;
  const id = parseTeamId(teamId);
  const data = id === null ? null : await getProjectView(id, null);
  if (!data) return { title: `projeto não encontrado — ${appConfig.name}` };
  const description =
    (data.showContent ? (data.fields?.tagline ?? data.fields?.description) : null) ??
    `projeto de ${data.teamName} no ${data.hackathonName} — arquivo do ${appConfig.name}`;
  return {
    title: data.title,
    description,
    openGraph: { title: data.title, description, siteName: appConfig.name, type: "website" },
  };
}

const h2 = "font-mono text-xs tracking-[0.06em] text-muted uppercase";
const linkBtn =
  "border-[1.5px] border-line px-5 py-3 font-mono text-sm transition hover:text-accent break-all";

export default async function ProjectPage({ params }: Props) {
  const { teamId } = await params;
  const id = parseTeamId(teamId);
  if (id === null) notFound();
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  const data = await getProjectView(id, member);
  if (!data) notFound();

  const [deploy, voteCount, voted] = await Promise.all([
    getLatestDeployForTeam(data.teamId),
    voteCountFor(data.teamId),
    member ? hasVoted(member.id, data.teamId) : Promise.resolve(false),
  ]);
  const live = deploy?.status === "running" ? deploy : null;
  const f = data.fields;
  const place = data.placement;
  const badges = [
    ...(place >= 1 && place <= 3 ? [{ text: `${place}º lugar`, gold: place === 1 }] : []),
    ...data.awards.map((a) => ({ text: a, gold: true })),
    ...(data.finalist && data.phase === "publicado" ? [{ text: "finalista", gold: false }] : []),
    ...(data.phase !== "legado" && data.status === "travado" ? [{ text: "entregue no prazo", gold: false }] : []),
  ];

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 [&>*]:max-w-3xl">
      <div className="flex flex-col gap-3">
        {f?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.logoUrl} alt={`logo de ${data.title}`} className="h-20 w-20 border-[1.5px] border-line object-cover" />
        )}
        <p className="tag self-start uppercase">{"projeto"}</p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] leading-[0.95] font-extrabold tracking-[-0.035em] break-words">
          {data.title}
        </h1>
        {f?.tagline && <p className="text-[19px] leading-snug break-words">{f.tagline}</p>}
        <p className="font-mono text-sm text-muted">
          <Link href={`/h/${data.hackathonId}`} className="text-accent hover:underline">
            {data.hackathonName}
          </Link>
          {" · "}
          {data.teamName}
        </p>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <span
                key={b.text}
                className={`w-fit border px-2 py-1 font-mono text-xs ${
                  b.gold ? "border-lendario bg-lendario/10 text-lendario" : "border-line bg-surface text-muted"
                }`}
              >
                {b.text}
              </span>
            ))}
          </div>
        )}
        <ShareBar
          url={absoluteUrl(`/p/${data.teamId}`)}
          text={`${data.title} — projeto do time ${data.teamName} no ${data.hackathonName}`}
          label="compartilhar projeto"
        />
      </div>

      {data.isDraftPreview && (
        <p className="border-[1.5px] border-orange px-4 py-3 font-mono text-[13px] text-orange">
          prévia do rascunho — só o time e a organização veem isto antes do prazo
        </p>
      )}

      {!data.showContent && (
        <p data-testid="project-hidden" className="border-[1.5px] border-line px-5 py-4 font-mono text-xs text-muted">
          {data.status === "nao_entregue"
            ? "o time não entregou o projeto no prazo"
            : data.phase === "antes"
              ? "projeto em construção — a entrega aparece aqui quando o prazo fechar"
              : "conteúdo liberado depois do resultado do júri"}
        </p>
      )}

      {f && (
        <>
          {(f.videoUrl || data.stageVideoUrl) && (
            <div className="flex flex-wrap gap-3">
              {f.videoUrl && (
                <a href={f.videoUrl} target="_blank" rel="noopener" className={linkBtn}>
                  ▶ vídeo do time →
                </a>
              )}
              {data.stageVideoUrl && (
                <a href={data.stageVideoUrl} target="_blank" rel="noopener" className={linkBtn}>
                  ▶ apresentação no palco →
                </a>
              )}
            </div>
          )}

          {live && (
            <a
              href={`/demo/${live.id}/`}
              className="flex items-center justify-between gap-4 border-[1.5px] border-accent bg-mint px-5 py-4 font-mono text-sm text-accent transition hover:bg-[#c3ebd5]"
            >
              <span>● demo ao vivo — deploy rodando agora</span>
              <span>abrir →</span>
            </a>
          )}

          {f.description ? (
            <p className="max-w-2xl leading-relaxed whitespace-pre-line break-words text-muted">{f.description}</p>
          ) : (
            <p className="border-[1.5px] border-line px-5 py-4 font-mono text-xs text-muted">
              {"sem descrição — o código conta a história"}
            </p>
          )}

          {f.priorWork && (
            <div className="flex flex-col gap-2">
              <h2 className={h2}>trabalho anterior ao evento</h2>
              <p className="whitespace-pre-line break-words text-muted">{f.priorWork}</p>
            </div>
          )}

          {f.technologies.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className={h2}>tecnologias</h2>
              <ul className="flex flex-wrap gap-1.5">
                {f.technologies.map((t) => (
                  <li key={t} className="chip">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.challenges.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className={h2}>desafios patrocinados</h2>
              <ul className="flex flex-col gap-1">
                {data.challenges.map((c) => (
                  <li key={c.id} className="break-words">
                    <span className="font-mono text-[12px] text-accent uppercase">{c.sponsor}</span> · {c.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {f.aiUsage && (
            <div className="flex flex-col gap-2">
              <h2 className={h2}>uso de IA</h2>
              <p className="whitespace-pre-line break-words text-muted">{f.aiUsage}</p>
            </div>
          )}

          {f.repoUrl || f.demoUrl || f.slidesUrl || f.links.length > 0 || f.socialPosts.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {f.repoUrl && (
                <a href={f.repoUrl} target="_blank" rel="noopener" className={linkBtn}>
                  repositório →
                </a>
              )}
              {f.demoUrl && (
                <a href={f.demoUrl} target="_blank" rel="noopener" className={linkBtn}>
                  demo →
                </a>
              )}
              {f.slidesUrl && (
                <a href={f.slidesUrl} target="_blank" rel="noopener" className={linkBtn}>
                  slides →
                </a>
              )}
              {f.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener" className={linkBtn}>
                  {l.label} →
                </a>
              ))}
              {f.socialPosts.map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noopener" className={linkBtn}>
                  post {i + 1} →
                </a>
              ))}
            </div>
          ) : (
            <p className="font-mono text-xs text-muted">{"sem links públicos cadastrados — pergunta pro time"}</p>
          )}
        </>
      )}

      <div className="flex flex-col gap-3">
        <h2 className={h2}>time — {data.teamName}</h2>
        {data.members.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {data.members.map((u) => (
              <li key={u}>
                <Link
                  href={`/u/${u}`}
                  className="block border-[1.5px] border-line bg-surface px-3 py-1.5 font-mono text-xs transition hover:text-accent"
                >
                  @{u}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-[1.5px] border-line px-5 py-4 font-mono text-xs text-muted">
            {"membros ainda não vinculados — o organizador liga o time aos perfis pelo /admin"}
          </p>
        )}
      </div>

      {data.judged && data.showContent && !data.isDraftPreview && (
        <p data-testid="judged-version" className="font-mono text-xs text-muted">
          versão avaliada: v{data.judged.version}, enviada em {formatBrt(data.judged.submittedAt)} (horário de Brasília)
        </p>
      )}

      {data.afterNotes && (
        <div className="flex flex-col gap-2 border-[1.5px] border-line bg-mint p-4">
          <h2 className={h2}>depois do hackathon</h2>
          <p className="whitespace-pre-line break-words">{data.afterNotes}</p>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-6">
        <VoteButton
          teamId={data.teamId}
          initialCount={voteCount}
          initialVoted={voted}
          loggedIn={member !== null}
          own={data.isMember}
        />
        <p className="font-mono text-xs text-muted">{"escolha do povo — a comunidade vota, o júri decide o pódio"}</p>
      </div>

      <Link href={`/h/${data.hackathonId}`} className="w-fit font-mono text-xs text-muted transition hover:text-accent">
        {"← volta pro arquivo da edição"}
      </Link>
    </section>
  );
}
