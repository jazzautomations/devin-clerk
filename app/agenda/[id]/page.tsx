import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Avatar } from "@/components/Avatar";
import { CommunityLogo } from "@/components/CommunityLogo";
import { MeetupManageBar, RsvpButtons, StageDecision, StageRequestForm } from "@/components/MeetupActions";
import { canManageCommunity, getCommunityById } from "@/lib/communities";
import { googleCalendarUrl } from "@/lib/ics";
import {
  EMBED_ALLOW,
  EMBED_SANDBOX,
  MEETUP_KIND_LABEL,
  canSeeMeetup,
  embedSrc,
  fmtMeetupRange,
  getMeetup,
  isEmbedWindow,
  isHost,
  isMeetupOver,
  listHosts,
  listStageRequests,
  meetupEnd,
  meetupIdParam,
  myProjects,
  myRsvp,
  rsvpCounts,
  toDbUtc,
  type Meetup,
} from "@/lib/meetups";
import { absoluteUrl } from "@/lib/seo";
import { currentMember } from "@/lib/session";

// /agenda/[id]. Sem conta: teaser (título, quando, comunidade e o CTA que
// volta pra cá). Com conta: onde, RSVP, contagem, quem conduz, .ics, a live
// embutida na janela do evento e, no demo day, o pedido de palco e a
// programação. O link da sala só aparece pra quem respondeu (e pra quem
// organiza ou conduz).

async function load(rawId: string) {
  const id = meetupIdParam(rawId);
  return id ? getMeetup(id) : null;
}

export async function generateMetadata({ params }: PageProps<"/agenda/[id]">): Promise<Metadata> {
  const { id } = await params;
  const m = await load(id);
  if (!m || !m.publishedAt || m.communityHidden) return { title: "evento não encontrado", robots: { index: false } };
  const description = `${MEETUP_KIND_LABEL[m.kind]} da ${m.communityName}: ${fmtMeetupRange(m)}.`;
  return {
    title: m.title,
    description,
    alternates: { canonical: `/agenda/${m.id}` },
    openGraph: { title: m.title, description, url: absoluteUrl(`/agenda/${m.id}`) },
  };
}

function Teaser({ m, logoUrl }: { m: Meetup; logoUrl: string | null }) {
  const back = encodeURIComponent(`/agenda/${m.id}`);
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16" data-testid="meetup-teaser">
      <article className="border-2 border-line">
        <p className="flex items-center justify-between border-b-2 border-line bg-foreground px-4 py-1.5">
          <span className="pix text-[19px] leading-none text-band">{MEETUP_KIND_LABEL[m.kind].toUpperCase()}</span>
          <span className="pix text-[19px] leading-none text-background">HACKAHUB</span>
        </p>
        <div className="flex flex-col gap-3 px-5 pt-6 pb-5">
          <CommunityLogo name={m.communityName} logoUrl={logoUrl} size="md" />
          <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">{m.title}</h1>
          {m.cancelledAt && <p className="font-mono text-[13px] text-orange">cancelado</p>}
        </div>
        <dl className="border-t border-line text-[14.5px]">
          <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-line-soft px-5 py-2.5">
            <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">quando</dt>
            <dd className="font-semibold" data-testid="meetup-teaser-when">
              {fmtMeetupRange(m)} <span className="font-mono text-[12px] font-normal text-muted">(Brasília)</span>
            </dd>
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-3 px-5 py-2.5">
            <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">comunidade</dt>
            <dd className="font-semibold">
              <Link href={`/comunidade/${m.communitySlug}`} className="underline-offset-4 hover:underline">
                {m.communityName}
              </Link>
            </dd>
          </div>
        </dl>
      </article>
      <div className="flex flex-col gap-3 border-[1.5px] border-line p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[15px] text-muted">Onde, link da sala, quem vai e o arquivo pra agenda ficam pra quem tem conta.</p>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Link href={`/sign-up?redirect_url=${back}`} className="btn" data-testid="meetup-teaser-cta">
            entrar pra responder →
          </Link>
          <Link href={`/sign-in?redirect_url=${back}`} className="font-mono text-[12.5px] text-accent underline-offset-4 hover:underline">
            já tenho conta · entrar
          </Link>
        </div>
      </div>
    </section>
  );
}

const STAGE_LABEL = { pedido: "aguardando", aceito: "aceito", recusado: "não entrou" } as const;

export default async function MeetupPage({ params }: PageProps<"/agenda/[id]">) {
  const { id } = await params;
  const m = await load(id);
  if (!m) notFound();
  const { userId } = await auth();
  const member = userId ? await currentMember() : null;

  // ---- sem conta: teaser (rascunho e comunidade escondida não existem) ----
  if (!member) {
    if (!m.publishedAt || m.communityHidden) notFound();
    const c = await getCommunityById(m.communityId);
    return <Teaser m={m} logoUrl={c?.logoUrl ?? null} />;
  }

  const canManage = await canManageCommunity(member, m.communityId);
  if (!canSeeMeetup(m, member, canManage)) notFound();
  const now = new Date();
  const over = isMeetupOver(m, now);
  const open = !!m.publishedAt && !m.cancelledAt && !over;
  const demo = m.kind === "demo_day";

  const [community, counts, mine, hosts, host, stage, projects, reqHeaders] = await Promise.all([
    getCommunityById(m.communityId),
    rsvpCounts(m.id),
    myRsvp(m.id, member.id),
    listHosts(m.id),
    isHost(m.id, member.id),
    demo ? listStageRequests(m.id) : Promise.resolve([]),
    demo && open ? myProjects(member.username) : Promise.resolve([]),
    headers(),
  ]);
  const seesRoom = !!mine || canManage || host;
  const full = m.capacity != null && counts.vou >= m.capacity;
  const program = stage.filter((s) => s.status === "aceito");
  const myRequests = stage.filter((s) => s.memberId === member.id);
  const pageHost = reqHeaders.get("x-forwarded-host") ?? reqHeaders.get("host") ?? new URL(absoluteUrl("/")).host;
  const live = !m.cancelledAt && !!m.publishedAt && isEmbedWindow(m, now) ? embedSrc(m.embedUrl, pageHost) : null;
  const gcal = googleCalendarUrl({
    startsAt: m.startsAt,
    endsAt: m.endsAt ?? toDbUtc(meetupEnd(m)),
    summary: m.title,
    description: absoluteUrl(`/agenda/${m.id}`),
    location: m.location ?? undefined,
  });

  return (
    <div className="overflow-x-clip" data-testid="meetup-page">
      <header className="mx-auto flex max-w-5xl flex-col gap-5 px-4 pt-8 pb-8 sm:px-6 sm:pt-12">
        <Link href={`/comunidade/${m.communitySlug}/agenda`} className="flex min-w-0 items-center gap-2 self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          <CommunityLogo name={m.communityName} logoUrl={community?.logoUrl ?? null} size="sm" />
          <span className="truncate">agenda da {m.communityName}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <p className="tag">{MEETUP_KIND_LABEL[m.kind].toUpperCase()}</p>
          {!m.publishedAt && <span className="chip bare">rascunho</span>}
          {m.cancelledAt && (
            <span className="chip bare border-orange! text-orange!" data-testid="meetup-cancelled">
              cancelado
            </span>
          )}
          {live && <span className="chip bare border-accent! bg-mint! text-accent!">ao vivo</span>}
          {over && !m.cancelledAt && <span className="chip bare">já rolou</span>}
        </div>
        <h1 className="text-[clamp(2.1rem,6vw,3.8rem)] leading-[0.95] font-extrabold tracking-[-0.045em] break-words" data-testid="meetup-title">
          {m.title}
        </h1>
        <p className="font-mono text-[14px] text-foreground" data-testid="meetup-when">
          {fmtMeetupRange(m)} <span className="text-muted">· horário de Brasília</span>
        </p>
      </header>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 pb-14 sm:px-6 lg:grid-cols-[1.5fr_1fr] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-10">
          {live && (
            <div className="window" data-testid="meetup-embed-frame">
              <div className="tbar">
                <span className="title">ao vivo · {m.title}</span>
                <span className="dots" aria-hidden>
                  <b />
                  <b />
                </span>
              </div>
              <div className="relative aspect-video w-full bg-foreground">
                <iframe
                  src={live}
                  title={`Live: ${m.title}`}
                  sandbox={EMBED_SANDBOX}
                  allow={EMBED_ALLOW}
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  loading="lazy"
                  className="absolute inset-0 h-full w-full border-0"
                />
              </div>
            </div>
          )}
          {!live && m.embedUrl && !over && !m.cancelledAt && (
            <p className="border-[1.5px] border-dashed border-line px-4 py-3 font-mono text-[13px] text-muted" data-testid="meetup-embed-later">
              a live aparece aqui 15 min antes de começar.
            </p>
          )}

          {m.description && (
            <section aria-label="sobre" className="flex flex-col gap-3">
              <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">sobre</h2>
              <p className="max-w-[62ch] text-[16.5px] leading-relaxed break-words whitespace-pre-line text-[#1e1e1e]">{m.description}</p>
            </section>
          )}

          {demo && (
            <section aria-labelledby="prog-title" className="flex flex-col gap-4" data-testid="meetup-program">
              <h2 id="prog-title" className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.035em]">
                Programação
              </h2>
              {program.length > 0 ? (
                <ol className="ink-grid">
                  {program.map((s, i) => (
                    <li key={s.id} className="flex min-w-0 gap-3 p-4">
                      <span className="pix shrink-0 text-[26px] leading-none text-accent">{String(i + 1).padStart(2, "0")}</span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <Link href={`/p/${s.teamId}`} className="font-extrabold break-words underline-offset-4 hover:underline">
                          {s.title}
                        </Link>
                        <span className="font-mono text-[12.5px] text-muted">{s.teamName}</span>
                        <span className="text-[14.5px] break-words text-[#2b2b2b]">{s.pitch}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="border-[1.5px] border-line px-4 py-3 text-[15px] text-muted">
                  Programação em montagem. {open ? "Tem projeto pra mostrar? Peça palco abaixo." : ""}
                </p>
              )}

              {open && (
                <div className="flex flex-col gap-3">
                  <h3 className="font-mono text-[13px] tracking-[0.08em] uppercase">pedir palco</h3>
                  {myRequests.length > 0 && (
                    <ul className="flex flex-col gap-1.5" data-testid="stage-mine">
                      {myRequests.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-2 text-[14.5px]">
                          <span className="font-bold break-words">{s.title}</span>
                          <span className={`chip bare ${s.status === "aceito" ? "border-accent! bg-mint! text-accent!" : ""}`}>{STAGE_LABEL[s.status]}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <StageRequestForm
                    meetupId={m.id}
                    projects={projects.filter((p) => !stage.some((s) => s.teamId === p.teamId))}
                  />
                </div>
              )}

              {canManage && stage.length > 0 && (
                <div className="flex flex-col gap-3" data-testid="stage-queue">
                  <h3 className="font-mono text-[13px] tracking-[0.08em] uppercase">pedidos ({stage.length})</h3>
                  <ul className="border-b border-line">
                    {stage.map((s) => (
                      <li key={s.id} className="flex flex-col gap-2 border-t border-line py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="stage-request">
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-bold break-words">{s.title}</span>
                            <span className="chip bare">{STAGE_LABEL[s.status]}</span>
                          </span>
                          <span className="font-mono text-[12.5px] text-muted">
                            @{s.username} · {s.teamName}
                          </span>
                          <span className="text-[14.5px] break-words">{s.pitch}</span>
                        </span>
                        <StageDecision meetupId={m.id} requestId={s.id} status={s.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>

        {/* no celular, quando/onde e o RSVP vêm antes da descrição */}
        <aside className="order-first flex min-w-0 flex-col gap-8 lg:order-none">
          {canManage && (
            <MeetupManageBar meetupId={m.id} slug={m.communitySlug} published={!!m.publishedAt} cancelled={!!m.cancelledAt} over={over} />
          )}

          <div className="window paper">
            <div className="tbar">
              <span className="title">quando e onde</span>
            </div>
            <dl className="flex flex-col text-[14.5px]">
              <div className="flex flex-col gap-0.5 border-b border-line-soft px-4 py-3">
                <dt className="font-mono text-[11.5px] tracking-[0.06em] text-muted uppercase">quando</dt>
                <dd className="font-semibold">{fmtMeetupRange(m)}</dd>
              </div>
              {m.location && (
                <div className="flex flex-col gap-0.5 border-b border-line-soft px-4 py-3">
                  <dt className="font-mono text-[11.5px] tracking-[0.06em] text-muted uppercase">local</dt>
                  <dd className="font-semibold break-words" data-testid="meetup-location">
                    {m.location}
                  </dd>
                </div>
              )}
              {m.onlineUrl && (
                <div className="flex flex-col gap-0.5 border-b border-line-soft px-4 py-3">
                  <dt className="font-mono text-[11.5px] tracking-[0.06em] text-muted uppercase">sala online</dt>
                  <dd className="min-w-0">
                    {seesRoom ? (
                      <a href={m.onlineUrl} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold break-all text-accent underline underline-offset-4" data-testid="meetup-room">
                        {m.onlineUrl.replace(/^https:\/\//, "")} ↗
                      </a>
                    ) : (
                      <span className="text-muted" data-testid="meetup-room-locked">
                        o link aparece quando você responder.
                      </span>
                    )}
                  </dd>
                </div>
              )}
              <div className="flex flex-col gap-0.5 px-4 py-3">
                <dt className="font-mono text-[11.5px] tracking-[0.06em] text-muted uppercase">quem vai</dt>
                <dd className="font-semibold" data-testid="meetup-counts">
                  {counts.vou} {counts.vou === 1 ? "vai" : "vão"} · {counts.talvez} talvez
                  {m.capacity != null && (
                    <span className="block font-mono text-[12.5px] font-normal text-muted">
                      {full ? "lotado" : `${m.capacity - counts.vou} de ${m.capacity} vagas`}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {open && <RsvpButtons meetupId={m.id} status={mine} full={full} />}
          {!open && m.publishedAt && (
            <p className="font-mono text-[13px] text-muted">{m.cancelledAt ? "evento cancelado: não recebe mais respostas." : "já rolou."}</p>
          )}

          {m.publishedAt && !m.cancelledAt && !over && (
            <div className="flex flex-col gap-2">
              <a href={`/agenda/${m.id}/evento.ics`} className="btn-ghost" data-testid="meetup-ics">
                baixar .ics
              </a>
              <a href={gcal} target="_blank" rel="noopener noreferrer" className="font-mono text-[12.5px] text-accent underline-offset-4 hover:underline">
                pôr no Google Agenda ↗
              </a>
            </div>
          )}

          {hosts.length > 0 && (
            <section aria-label="quem conduz" className="flex flex-col gap-2">
              <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">quem conduz</h2>
              <ul className="flex flex-col" data-testid="meetup-hosts">
                {hosts.map((h) => (
                  <li key={h.memberId} className="border-t border-line first:border-t-0">
                    <Link href={`/u/${h.username}`} className="flex items-center gap-3 py-2 hover:bg-mint">
                      <Avatar username={h.username} name={h.name} avatarUrl={h.avatarUrl} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{h.name ?? `@${h.username}`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
