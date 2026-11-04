import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { appConfig } from "@/app.config";
import { getLatestDeployForTeam } from "@/lib/deploys";
import { formatBrt, parseDbTime } from "@/lib/entries";
import { anonProjectNote, getProjectView, youtubeId } from "@/lib/entriesPublic";
import { getMemberByClerkId } from "@/lib/members";
import { hasVoted, voteCountFor } from "@/lib/votes";
import { getAudienceResult } from "@/lib/stage";
import { feedbackVisible } from "@/lib/juryFeedback";
import { VoteButton } from "@/components/VoteButton";
import { ShareBar } from "@/components/ShareBar";
import { Avatar } from "@/components/Avatar";
import { absoluteUrl } from "@/lib/seo";
import { renderUserMarkdown } from "@/lib/blog";
import { sponsorLogosForChallenges } from "@/lib/editionSponsors";
import { PublicCard } from "@/components/PublicCard";
import { parseId } from "@/lib/ids";
import { techHref } from "@/lib/techTags";

// Vitrine do projeto (spec 046; base nas specs 010/030/034). A página
// permanente que o time leva pro portfólio: capa, título, tagline, selos,
// demo/repo/vídeo, galeria, a história em seções (O que faz, Inspiração,
// Como foi feito, Desafios, O que aprendemos, Depois do hackathon), "Feito
// com" navegável e "Quem fez". O que o júri avalia segue a matriz de
// visibilidade da entrega (lib/entriesPublic); a história é a atual, e se
// mudou depois da entrega a página avisa e mostra como foi entregue.
// Sem conta: página completa quando o projeto já está no arquivo da edição,
// sem feedback do júri; antes disso, o cartão público.

type Props = {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ versao?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { teamId } = await params;
  const id = parseId(teamId);
  const data = id === null ? null : await getProjectView(id, null);
  if (!data) return { title: `projeto não encontrado — ${appConfig.name}` };
  const description =
    (data.showContent ? (data.fields?.tagline ?? data.fields?.description?.slice(0, 200)) : null) ??
    `projeto de ${data.teamName} no ${data.hackathonName} — arquivo do ${appConfig.name}`;
  return {
    title: data.title,
    description,
    openGraph: { title: data.title, description, siteName: appConfig.name, type: "website" },
  };
}

const h2 = "font-mono text-xs tracking-[0.06em] text-muted uppercase";
const linkBtn =
  "border-[1.5px] border-line px-4 py-2.5 font-mono text-sm transition hover:text-accent break-all";

const monthYear = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });

function Story({ title, text, testId }: { title: string; text: string | null; testId: string }) {
  if (!text?.trim()) return null;
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="font-display text-[22px] leading-tight font-extrabold tracking-[-0.02em]">{title}</h2>
      <p className="whitespace-pre-line break-words text-[16px] leading-relaxed">{text}</p>
    </section>
  );
}

export default async function ProjectPage({ params, searchParams }: Props) {
  const { teamId } = await params;
  const { versao } = await searchParams;
  const id = parseId(teamId);
  if (id === null) notFound();
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  const data = await getProjectView(id, member);
  if (!data) notFound();
  const anon = !userId;
  // sem conta e projeto ainda fora do arquivo: cartão mínimo (spec 039)
  if (anon && !data.openToPublic) {
    const premio = [
      ...(data.placement >= 1 && data.placement <= 3 ? [`${data.placement}º lugar`] : []),
      ...data.awards.filter((a) => !a.startsWith(`${data.placement}º lugar`)),
    ];
    return (
      <PublicCard
        kind="projeto"
        title={data.title}
        subtitle={data.showContent ? (data.fields?.tagline ?? null) : null}
        path={`/p/${data.teamId}`}
        rest={anonProjectNote(data)}
        facts={[
          ["edição", data.hackathonName],
          ["time", data.teamName],
          ...(premio.length ? ([["prêmio", premio.join(" · ")]] as [string, string][]) : []),
        ]}
      />
    );
  }

  const [deploy, voteCount, voted, showFeedback, sponsorLogos, audience] = await Promise.all([
    getLatestDeployForTeam(data.teamId),
    voteCountFor(data.teamId),
    member ? hasVoted(member.id, data.teamId) : Promise.resolve(false),
    // roadmap 037 #9 — atalho só pro time; a página confere de novo
    data.isMember ? feedbackVisible(data.hackathonId) : Promise.resolve(false),
    // roadmap 037 #8 — logo da marca no projeto que entrou no desafio dela
    sponsorLogosForChallenges(data.challenges.map((c) => c.id)),
    // modo palco: nota do público na final ao vivo — selo separado do voto
    // da comunidade (025), só depois da final encerrada
    getAudienceResult(data.teamId),
  ]);
  const live = deploy?.status === "running" ? deploy : null;
  const f = data.fields;
  // "ver como foi entregue": a vitrine e os papéis do snapshot avaliado
  const asDelivered = versao === "entregue" && !!data.delivered;
  const story = asDelivered ? data.delivered : data.showcase;
  const place = data.placement;
  const badges = [
    // "1º lugar · Grande prêmio" já diz a colocação — não repete o selo cru
    ...(place >= 1 && place <= 3 && !data.awards.some((a) => a.startsWith(`${place}º lugar`))
      ? [{ text: `${place}º lugar`, gold: place === 1 }]
      : []),
    ...data.awards.map((a) => ({ text: a, gold: true })),
    ...(data.finalist && data.phase === "publicado" ? [{ text: "finalista", gold: false }] : []),
    ...(audience && audience.position === 1 && !audience.tied ? [{ text: "escolha do público", gold: false }] : []),
    ...(data.phase !== "legado" && data.status === "travado" ? [{ text: "entregue no prazo", gold: false }] : []),
  ];
  const ytId = youtubeId(f?.videoUrl);
  const started = parseDbTime(data.editionStartsAt);
  const hasLinks = !!f && (f.repoUrl || f.demoUrl || f.videoUrl || data.stageVideoUrl || live);
  const extraLinks = !!f && (f.slidesUrl || f.links.length > 0 || f.socialPosts.length > 0);
  const path = `/p/${data.teamId}`;

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16" data-testid="project-page">
      {story?.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- capa por URL https do time; next/image exigiria remotePatterns
        <img
          src={story.coverUrl}
          alt={`capa de ${data.title}`}
          data-testid="project-cover"
          className="aspect-[16/9] w-full border-2 border-line object-cover"
        />
      )}

      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {f?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- logo remoto do time
            <img src={f.logoUrl} alt={`logo de ${data.title}`} className="h-14 w-14 shrink-0 border-[1.5px] border-line object-cover" />
          )}
          <p className="tag uppercase">{"projeto"}</p>
        </div>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] leading-[0.95] font-extrabold tracking-[-0.035em] break-words">
          {data.title}
        </h1>
        {f?.tagline && <p className="text-[19px] leading-snug break-words">{f.tagline}</p>}
        <p className="font-mono text-sm break-words text-muted">
          <Link href={`/h/${data.hackathonId}`} className="text-accent hover:underline">
            {data.hackathonName}
          </Link>
          {started && ` · ${monthYear.format(started)}`}
          {" · "}
          {data.teamName}
        </p>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="project-badges">
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
        {data.judged && data.showContent && !data.isDraftPreview && (
          <p data-testid="judged-version" className="font-mono text-xs text-muted">
            versão avaliada: v{data.judged.version}, enviada em {formatBrt(data.judged.submittedAt)} (horário de Brasília)
          </p>
        )}
        <ShareBar
          url={absoluteUrl(path)}
          text={`${data.title} — projeto do time ${data.teamName} no ${data.hackathonName}`}
          label="compartilhar projeto"
        />
      </header>

      {data.isDraftPreview && (
        <p className="border-[1.5px] border-orange px-4 py-3 font-mono text-[13px] text-orange">
          prévia do rascunho — só o time e a organização veem isto antes do prazo
        </p>
      )}

      {data.updatedAfterDelivery && !asDelivered && (
        <p data-testid="updated-after" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-[1.5px] border-line bg-surface px-4 py-3 font-mono text-[13px]">
          <span>atualizado depois da entrega</span>
          <Link href={`${path}?versao=entregue`} className="text-accent hover:underline">
            ver como foi entregue →
          </Link>
        </p>
      )}
      {asDelivered && (
        <p data-testid="as-delivered" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-[1.5px] border-accent bg-mint px-4 py-3 font-mono text-[13px] text-accent">
          <span>como foi entregue{data.judged ? ` · v${data.judged.version}` : ""}</span>
          <Link href={path} className="hover:underline">
            ver a versão atual →
          </Link>
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
          {hasLinks && (
            <div className="flex flex-wrap gap-2" data-testid="project-actions">
              {live && (
                <a href={`/demo/${live.id}/`} className="btn">
                  ● demo ao vivo
                </a>
              )}
              {f.demoUrl && (
                <a href={f.demoUrl} target="_blank" rel="noopener" className={live ? "btn-ghost" : "btn"}>
                  demo →
                </a>
              )}
              {f.repoUrl && (
                <a href={f.repoUrl} target="_blank" rel="noopener" className="btn-ghost">
                  repositório →
                </a>
              )}
              {f.videoUrl && (
                <a href={f.videoUrl} target="_blank" rel="noopener" className="btn-ghost">
                  ▶ vídeo do time
                </a>
              )}
              {data.stageVideoUrl && (
                <a href={data.stageVideoUrl} target="_blank" rel="noopener" className="btn-ghost">
                  ▶ apresentação no palco
                </a>
              )}
            </div>
          )}

          {ytId && (
            <div className="aspect-video w-full border-2 border-line bg-foreground">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${ytId}`}
                title={`vídeo de ${data.title}`}
                loading="lazy"
                allow="encrypted-media; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                className="h-full w-full"
              />
            </div>
          )}

          {story && story.media.length > 0 && (
            <section className="flex flex-col gap-3" aria-label="galeria" data-testid="project-gallery">
              <h2 className={h2}>galeria</h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {story.media.map((m, i) => (
                  <li key={`${m.url}-${i}`}>
                    <figure className="flex flex-col border-[1.5px] border-line">
                      {/* eslint-disable-next-line @next/next/no-img-element -- imagem por URL https do time */}
                      <img
                        src={m.url}
                        alt={m.caption ?? `imagem ${i + 1} de ${data.title}`}
                        loading="lazy"
                        className="aspect-[4/3] w-full object-cover"
                      />
                      {m.caption && (
                        <figcaption className="border-t border-line px-3 py-2 font-mono text-[12px] break-words text-muted">
                          {m.caption}
                        </figcaption>
                      )}
                    </figure>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {f.description?.trim() && (
            <section className="flex flex-col gap-2" data-testid="story-oquefaz">
              <h2 className="font-display text-[22px] leading-tight font-extrabold tracking-[-0.02em]">O que faz</h2>
              <div
                className="blog-body max-w-2xl break-words"
                // renderer escapa HTML cru; só gera markup de markdown (lib/blog)
                dangerouslySetInnerHTML={{ __html: renderUserMarkdown(f.description) }}
              />
            </section>
          )}
          <Story title="Inspiração" text={story?.inspiration ?? null} testId="story-inspiracao" />
          <Story title="Como foi feito" text={story?.howBuilt ?? null} testId="story-comofoifeito" />
          <Story title="Desafios" text={story?.challenges ?? null} testId="story-desafios" />
          <Story title="O que aprendemos" text={story?.learned ?? null} testId="story-aprendemos" />
        </>
      )}

      {data.showContent && data.afterNotes?.trim() && (
        <section className="flex flex-col gap-2 border-[1.5px] border-line bg-mint p-4" data-testid="story-depois">
          <h2 className="font-display text-[22px] leading-tight font-extrabold tracking-[-0.02em]">Depois do hackathon</h2>
          <p className="whitespace-pre-line break-words">{data.afterNotes}</p>
        </section>
      )}

      {f && (
        <>
          {data.tech.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="built-with">
              <h2 className={h2}>feito com</h2>
              <ul className="flex flex-wrap gap-1.5">
                {data.tech.map((t) => (
                  <li key={t.tag}>
                    <Link href={techHref(t.tag)} className="chip bare transition hover:border-accent hover:text-accent">
                      {t.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.challenges.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className={h2}>desafios patrocinados</h2>
              <ul className="flex flex-col gap-1">
                {data.challenges.map((c) => {
                  const logo = sponsorLogos.get(c.id);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 break-words" data-testid="project-challenge">
                      {logo?.logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- logo remoto da marca; next/image exigiria remotePatterns
                        <img src={logo.logoUrl} alt={`logo de ${logo.name}`} className="h-8 max-w-[120px] object-contain" />
                      )}
                      <span>
                        <span className="font-mono text-[12px] text-accent uppercase">{c.sponsor}</span> · {c.title}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {f.priorWork && (
            <section className="flex flex-col gap-2">
              <h2 className={h2}>trabalho anterior ao evento</h2>
              <p className="whitespace-pre-line break-words text-muted">{f.priorWork}</p>
            </section>
          )}

          {f.aiUsage && (
            <section className="flex flex-col gap-2">
              <h2 className={h2}>uso de IA</h2>
              <p className="whitespace-pre-line break-words text-muted">{f.aiUsage}</p>
            </section>
          )}

          {extraLinks && (
            <section className="flex flex-col gap-2">
              <h2 className={h2}>links</h2>
              <div className="flex flex-wrap gap-2">
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
            </section>
          )}
        </>
      )}

      <section className="flex flex-col gap-3" data-testid="team-credits">
        <h2 className={h2}>quem fez · {data.teamName}</h2>
        {data.credits.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line-soft border-[1.5px] border-line">
            {data.credits.map((c, i) => {
              const role = asDelivered ? c.deliveredRole : c.role;
              return (
                <li key={c.username ?? `oculto-${i}`} className="flex min-w-0 items-center gap-3 px-4 py-3">
                  {c.username ? (
                    <>
                      <Avatar username={c.username} name={c.name} avatarUrl={c.avatarUrl} size="md" />
                      <div className="flex min-w-0 flex-col">
                        <Link href={`/u/${c.username}`} className="font-semibold break-words transition hover:text-accent">
                          {c.name?.trim() || `@${c.username}`}
                        </Link>
                        <span className="font-mono text-[12px] break-words text-muted">
                          {c.name?.trim() ? `@${c.username}` : null}
                          {c.name?.trim() && role ? " · " : null}
                          {role}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border-[1.5px] border-line-soft bg-surface font-mono text-[11px] text-muted">
                        ?
                      </span>
                      <span className="font-mono text-[13px] text-muted">integrante</span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-[1.5px] border-line px-5 py-4 font-mono text-xs text-muted">
            {"integrantes ainda não vinculados — o organizador liga o time aos perfis pelo /admin"}
          </p>
        )}
      </section>

      {showFeedback && (
        <Link
          href={`/p/${data.teamId}/feedback`}
          data-testid="feedback-link"
          className="flex items-center justify-between gap-4 border-[1.5px] border-accent px-5 py-4 font-mono text-sm text-accent transition hover:bg-mint"
        >
          <span>feedback do júri pro seu time · só o time vê</span>
          <span>abrir →</span>
        </Link>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-6">
        {anon ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm" data-testid="anon-vote">
            <span className="text-muted">▲ {voteCount}</span>
            <Link href={`/sign-up?redirect_url=${encodeURIComponent(path)}`} className="text-accent hover:underline">
              crie sua conta pra votar →
            </Link>
          </p>
        ) : (
          <VoteButton
            teamId={data.teamId}
            initialCount={voteCount}
            initialVoted={voted}
            loggedIn={member !== null}
            own={data.isMember}
          />
        )}
        <p className="font-mono text-xs text-muted">{"escolha do povo — a comunidade vota, o júri decide o pódio"}</p>
        {audience && (
          <p data-testid="audience-result" className="w-fit bg-foreground px-3 py-2 font-mono text-xs text-band">
            {`escolha do público na final · ${audience.position}º de ${audience.total}${
              audience.tied ? " (empate)" : ""
            } · média ${audience.avg.toLocaleString("pt-BR")}/5 · ${audience.votes} ${
              audience.votes === 1 ? "voto" : "votos"
            } de quem estava na sala`}
          </p>
        )}
      </div>

      <Link href={`/h/${data.hackathonId}`} className="w-fit py-3 font-mono text-xs text-muted transition hover:text-accent">
        {"← voltar pro arquivo da edição"}
      </Link>
    </article>
  );
}
