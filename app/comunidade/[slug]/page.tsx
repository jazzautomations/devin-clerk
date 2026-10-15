import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Avatar } from "@/components/Avatar";
import { CommunityLogo } from "@/components/CommunityLogo";
import { communityPlace } from "@/components/CommunityRows";
import { EditionRows } from "@/components/EditionRows";
import { FeedSection } from "@/components/FeedSection";
import { PublicCard } from "@/components/PublicCard";
import { JoinButton, ModerationToggles, NoticeForm, OrganizersPanel, ReportLink } from "@/components/CommunityActions";
import {
  getCommunityItem,
  getMembership,
  listCommunityInvites,
  listCommunityMembers,
  listNotices,
  podiumFor,
} from "@/lib/communities";
import { parseEventTime } from "@/lib/eventTime";
import { getCommunityHackathons } from "@/lib/hackathons";
import { listPosts } from "@/lib/posts";
import { getRegistrationIds } from "@/lib/registrations";
import { absoluteUrl } from "@/lib/seo";
import { currentMember } from "@/lib/session";

// /comunidade/[slug]. Sem conta: cartão mínimo pra divulgação (nome,
// descrição, cidade, membros, próximos hackathons e o CTA que cadastra e
// volta). Com conta: a comunidade inteira — avisos, hackathons (próximos e
// passados com pódio), mural e membros. Dono/organizador edita, abre
// hackathon e escreve aviso; o dono chama organizadores.

const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });
const fmtData = (v: string) => {
  const d = parseEventTime(v);
  return d ? fmtDia.format(d) : "";
};
const ROLE_LABEL = { dono: "dono", organizador: "organiza", membro: "membro" } as const;
const PLACE = ["", "1º", "2º", "3º"];

export async function generateMetadata({ params }: PageProps<"/comunidade/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCommunityItem(slug);
  if (!c || c.hidden) return { title: "comunidade não encontrada" };
  const description = c.description ?? `${c.name} no HackaHub: ${communityPlace(c)}, ${c.members} membros.`;
  return {
    title: c.name,
    description,
    alternates: { canonical: `/comunidade/${c.slug}` },
    openGraph: { title: c.name, description, url: absoluteUrl(`/comunidade/${c.slug}`) },
  };
}

export default async function CommunityPage({ params, searchParams }: PageProps<"/comunidade/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const c = await getCommunityItem(slug);
  const { userId } = await auth();
  const member = userId ? await currentMember() : null;
  if (!c || (c.hidden && member?.role !== "admin")) notFound();
  const now = new Date();
  const { upcoming, past, drafts } = await getCommunityHackathons(c.id, now);

  // ---- sem conta: cartão mínimo ----
  if (!member) {
    return (
      <PublicCard
        kind="comunidade"
        title={c.name}
        subtitle={c.description}
        path={`/comunidade/${c.slug}`}
        facts={[
          ["onde", communityPlace(c)],
          // zero não é prova de nada: a linha some até alguém entrar
          ...(c.members > 0 ? ([["membros", String(c.members)]] as [string, string][]) : []),
          ...(c.verified ? ([["selo", "verificada pelo HackaHub"]] as [string, string][]) : []),
        ]}
        extra={
          upcoming.length > 0 ? (
            <div className="border-t-2 border-line px-5 py-4" data-testid="public-community-upcoming">
              <p className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">próximos hackathons</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {upcoming.slice(0, 3).map((h) => (
                  <li key={h.id} className="text-[15px]">
                    <Link href={`/h/${h.id}`} className="font-bold underline-offset-4 hover:underline">
                      {h.name}
                    </Link>{" "}
                    <span className="font-mono text-[12.5px] text-muted">
                      · {fmtData(h.startsAt)} · {h.location ?? "online"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
      >
        <CommunityLogo name={c.name} logoUrl={c.logoUrl} size="md" />
      </PublicCard>
    );
  }

  // ---- logado ----
  const role = await getMembership(c.id, member.id);
  const isAdmin = member.role === "admin";
  const canManage = isAdmin || role === "dono" || role === "organizador";
  const isOwner = isAdmin || role === "dono";
  const [members, notices, posts, podium, invites, registeredIds] = await Promise.all([
    listCommunityMembers(c.id),
    listNotices(c.id, 5),
    listPosts(30, member.id, { communityId: c.id }),
    podiumFor(past.map((h) => h.id)),
    isOwner ? listCommunityInvites(c.id) : Promise.resolve([]),
    getRegistrationIds(member.id),
  ]);
  const organizers = members.filter((m) => m.role === "organizador");
  const owners = members.filter((m) => m.role === "dono");
  const links = (
    [
      ["site", c.website],
      ["instagram", c.instagram],
      ["linkedin", c.linkedin],
      ["discord", c.discord],
      ["grupo", c.groupUrl],
    ] as const
  ).filter(([, v]) => !!v) as [string, string][];
  const justCreated = sp.criada === "1" && canManage;

  return (
    <div className="overflow-x-clip" data-testid="community-page">
      {c.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- capa remota informada pela comunidade (https validado)
        <img src={c.coverUrl} alt="" referrerPolicy="no-referrer" className="h-[140px] w-full border-b-2 border-line object-cover sm:h-[220px]" />
      )}
      <header className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-8 pb-8 sm:px-6 sm:pt-12">
        {c.hidden && (
          <p className="border-[1.5px] border-orange px-4 py-2 font-mono text-[13px] text-orange">escondida pela moderação: só o admin vê esta página</p>
        )}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <CommunityLogo name={c.name} logoUrl={c.logoUrl} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="tag">COMUNIDADE</p>
                {c.verified && <span className="chip bare border-accent! bg-mint! text-accent!">verificada</span>}
                {role && <span className="chip bare bg-foreground! text-band!">{role === "membro" ? "você está aqui" : `você ${ROLE_LABEL[role]}`}</span>}
              </div>
              <h1 className="mt-3 text-[clamp(2.2rem,6vw,4rem)] leading-[0.95] font-extrabold tracking-[-0.045em] break-words">{c.name}</h1>
              <p className="mt-2 font-mono text-[13px] text-muted">
                {communityPlace(c)} · {c.members} {c.members === 1 ? "membro" : "membros"}
                {c.hackathons > 0 && ` · ${c.hackathons} ${c.hackathons === 1 ? "hackathon" : "hackathons"}`}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:items-end">
            {role !== "dono" && <JoinButton slug={c.slug} member={!!role} />}
            {canManage && (
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Link href={`/comunidade/${c.slug}/hackathon/novo`} className="btn min-h-[44px]!" data-testid="community-new-hackathon">
                  abrir hackathon →
                </Link>
                <Link href={`/comunidade/${c.slug}/editar`} className="btn-ghost min-h-[44px]!" data-testid="community-edit">
                  editar
                </Link>
              </div>
            )}
          </div>
        </div>
        {c.description && <p className="max-w-[60ch] text-[17px] leading-relaxed text-[#1e1e1e]">{c.description}</p>}
        {links.length > 0 && (
          <ul className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[13px]">
            {links.map(([label, href]) => (
              <li key={label}>
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline-offset-4 hover:underline">
                  {label} ↗
                </a>
              </li>
            ))}
          </ul>
        )}
        {justCreated && (
          <div className="flex flex-col gap-3 border-2 border-line bg-mint p-5 sm:p-6" data-testid="community-created">
            <p className="text-[20px] font-extrabold tracking-[-0.02em]">Comunidade criada.</p>
            <ol className="flex flex-col gap-1.5 text-[15px]">
              <li>
                <b>1.</b> Abra o primeiro hackathon.{" "}
                <Link href={`/comunidade/${c.slug}/hackathon/novo`} className="text-accent underline underline-offset-4">
                  abrir agora
                </Link>
              </li>
              <li>
                <b>2.</b> Chame quem organiza junto (lá embaixo, em membros).
              </li>
              <li>
                <b>3.</b> Mande o link da página pro seu grupo: {absoluteUrl(`/comunidade/${c.slug}`).replace(/^https?:\/\//, "")}
              </li>
            </ol>
          </div>
        )}
      </header>

      <div className="mx-auto grid max-w-6xl gap-14 px-4 pb-10 sm:px-6 lg:grid-cols-[1.6fr_1fr] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-14">
          {/* hackathons */}
          <section id="hackathons" aria-labelledby="hk-title" className="flex scroll-mt-24 flex-col gap-4">
            <h2 id="hk-title" className="text-[clamp(1.5rem,3vw,2rem)] leading-none font-extrabold tracking-[-0.035em]">
              Hackathons
            </h2>
            {canManage && drafts.length > 0 && (
              <ul className="flex flex-col gap-2" data-testid="community-drafts">
                {drafts.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 border-[1.5px] border-dashed border-line px-4 py-3">
                    <span className="min-w-0">
                      <span className="chip bare mr-2">rascunho</span>
                      <span className="font-bold">{h.name}</span>
                      <span className="ml-2 font-mono text-[12.5px] text-muted">{fmtData(h.startsAt)}</span>
                    </span>
                    <Link href={`/admin/h/${h.id}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
                      terminar e publicar →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {upcoming.length > 0 ? (
              <EditionRows hackathons={upcoming} registeredIds={registeredIds} now={now} testId="community-upcoming" />
            ) : (
              <p className="border-[1.5px] border-line px-4 py-4 text-[15px] text-muted">
                Nenhum hackathon marcado.{canManage ? " Abra o primeiro e a comunidade recebe o aviso quando você publicar." : " Quando sair, você recebe o aviso."}
              </p>
            )}
            {past.length > 0 && (
              <div className="flex flex-col gap-2" data-testid="community-past">
                <h3 className="mt-2 font-mono text-[13px] tracking-[0.08em] uppercase">já rolaram</h3>
                <ul className="border-b border-line">
                  {past.map((h) => {
                    const top = podium.filter((p) => p.hackathonId === h.id);
                    return (
                      <li key={h.id} className="flex flex-col gap-1.5 border-t border-line py-3">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <Link href={`/h/${h.id}`} className="font-bold underline-offset-4 hover:underline">
                            {h.name}
                          </Link>
                          <span className="font-mono text-[12.5px] text-muted">{fmtData(h.startsAt)}</span>
                        </span>
                        {top.length > 0 && (
                          <span className="flex flex-wrap gap-1.5">
                            {top.map((p) => (
                              <Link key={p.teamId} href={`/p/${p.teamId}`} className="chip bare hover:bg-mint">
                                {PLACE[p.placement]} {p.title ?? p.teamName}
                              </Link>
                            ))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          {/* mural */}
          <section id="mural" aria-labelledby="mural-title" className="flex scroll-mt-24 flex-col gap-4">
            <h2 id="mural-title" className="text-[clamp(1.5rem,3vw,2rem)] leading-none font-extrabold tracking-[-0.035em]">
              Mural
            </h2>
            <FeedSection initialPosts={posts} canPost={!!role} me={member.username} isAdmin={isAdmin} communitySlug={c.slug} />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-12">
          {/* avisos */}
          <section id="avisos" aria-labelledby="avisos-title" className="flex scroll-mt-24 flex-col gap-4">
            <h2 id="avisos-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
              Avisos
            </h2>
            {canManage && <NoticeForm slug={c.slug} />}
            {notices.length > 0 ? (
              <ul className="border-b border-line" data-testid="community-notices">
                {notices.map((n) => (
                  <li key={n.id} className="flex flex-col gap-1 border-t border-line py-3">
                    <p className="font-bold">{n.title}</p>
                    <p className="text-[14.5px] leading-relaxed whitespace-pre-line text-[#2b2b2b]">{n.body}</p>
                    <p className="font-mono text-[12px] text-muted">
                      {n.username ? `@${n.username} · ` : ""}
                      {fmtData(n.createdAt.replace(" ", "T") + "Z")}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-[13px] text-muted">nenhum aviso ainda.</p>
            )}
          </section>

          {/* membros */}
          <section id="membros" aria-labelledby="membros-title" className="flex scroll-mt-24 flex-col gap-4">
            <h2 id="membros-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
              Membros <span className="font-mono text-[15px] font-normal text-muted">{c.members}</span>
            </h2>
            {owners.length === 0 && (
              <p className="font-mono text-[12.5px] text-muted">sem dono: a equipe do HackaHub cuida desta comunidade.</p>
            )}
            {isOwner && (
              <OrganizersPanel
                slug={c.slug}
                organizers={organizers.map((o) => ({ memberId: o.memberId, username: o.username, name: o.name }))}
                invites={invites}
              />
            )}
            {members.length > 0 ? (
              <ul className="flex flex-col" data-testid="community-members">
                {members.slice(0, 60).map((m) => (
                  <li key={m.memberId} className="border-t border-line first:border-t-0">
                    <Link href={`/u/${m.username}`} className="flex items-center gap-3 py-2 hover:bg-mint">
                      <Avatar username={m.username} name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{m.name ?? `@${m.username}`}</span>
                      {m.role !== "membro" && <span className="chip bare shrink-0">{ROLE_LABEL[m.role]}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-[13px] text-muted">ninguém entrou ainda. Seja a primeira pessoa.</p>
            )}
          </section>

          {(isAdmin || !canManage) && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              {isAdmin && <ModerationToggles slug={c.slug} hidden={c.hidden} verified={c.verified} />}
              {!canManage && <ReportLink slug={c.slug} />}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
