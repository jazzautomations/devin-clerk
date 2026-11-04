import Link from "next/link";
import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { CommunityUpdates } from "@/components/CommunityUpdates";
import { FollowButton } from "@/components/FollowButton";
import { TimelineList } from "@/components/TimelineList";
import { Avatar } from "@/components/Avatar";
import { communityUpdatesPage, followsAnyCommunity } from "@/lib/follows";
import type { CommunityListItem } from "@/lib/communities";
import { getOrCreateMember } from "@/lib/members";
import { suggestCommunities, suggestPeople, type SuggestPerson } from "@/lib/suggestions";
import {
  isTimelineTab,
  listLiveEditions,
  parseCursor,
  TIMELINE_TAB_LABEL,
  TIMELINE_TABS,
  timelineDefaultTab,
  timelineHref,
  timelinePage,
  type LiveEdition,
  type TimelineTab,
} from "@/lib/timeline";

export const metadata: Metadata = {
  title: "feed",
  description:
    "A timeline do HackaHub: o que as pessoas que você segue, as suas comunidades e as edições de agora estão construindo — em ordem cronológica.",
  alternates: { canonical: "/feed" },
};

// /feed — a página social (spec 046, onda 2). Quatro abas cronológicas:
// seguindo, comunidades, ao vivo e tudo. Aba por ?aba= (link, com
// aria-current); a primeira página vem daqui, o resto por cursor (?antes=) no
// TimelineList. A aba "comunidades" é a lista de novidades da comunidade
// (mural, aviso, hackathon e agenda), paginada por ?pagina=.
const tabHref = (aba: TimelineTab) => timelineHref(aba);
const pageHref = (aba: TimelineTab, pagina: number) =>
  `/feed?aba=${aba}${pagina > 1 ? `&pagina=${pagina}` : ""}`;

const tabClass = (active: boolean) =>
  `chip bare min-h-[40px] px-4! text-[13px]! ${active ? "bg-foreground! text-band!" : "hover:bg-mint"}`;

const REASON_LABEL: Record<SuggestPerson["reason"], string> = {
  time: "fez time com você",
  comunidade: "está numa comunidade sua",
  skill: "tem skill em comum",
  persona: "é da sua persona",
};

function SuggestRow({ p }: { p: SuggestPerson }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3" data-testid={`feed-suggest-${p.username}`}>
      <Link href={`/u/${p.username}`} className="group flex min-w-0 items-center gap-3">
        <Avatar username={p.username} name={p.name} avatarUrl={p.avatarUrl} size="md" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-bold transition group-hover:text-accent">{p.name ?? `@${p.username}`}</span>
          <span className="truncate font-mono text-[12px] text-muted">
            {p.shared ? `${REASON_LABEL[p.reason]} no ${p.shared}` : REASON_LABEL[p.reason]}
          </span>
        </span>
      </Link>
      <FollowButton username={p.username} following={false} compact className="shrink-0" />
    </li>
  );
}

export default async function FeedPage({ searchParams }: PageProps<"/feed">) {
  const sp = await searchParams;
  const { userId } = await auth();
  let member = null;
  if (userId) {
    const user = await currentUser();
    member = await getOrCreateMember({
      id: userId,
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? "",
      imageUrl: user?.imageUrl ?? null,
    });
  }

  const abaParam = typeof sp.aba === "string" ? sp.aba : null;
  const aba: TimelineTab = abaParam && isTimelineTab(abaParam) ? abaParam : await timelineDefaultTab(member?.id ?? null);
  const antes = parseCursor(sp.antes);
  const pagina = Number(typeof sp.pagina === "string" ? sp.pagina : "1");

  const isPostTab = aba !== "comunidades";
  const hasCommunities = member ? await followsAnyCommunity(member.id) : false;
  const [page, updates, live] = await Promise.all([
    isPostTab ? timelinePage(member?.id ?? null, aba, antes) : Promise.resolve(null),
    aba === "comunidades" && member ? communityUpdatesPage(member.id, pagina) : Promise.resolve(null),
    aba === "ao-vivo" ? listLiveEditions() : Promise.resolve([] as LiveEdition[]),
  ]);

  // o vazio da aba seguindo: quem seguir e qual comunidade entrar (só quando
  // a página veio vazia — não paga a consulta em toda visita)
  const emptyFollowing = aba === "seguindo" && !!member && (page?.posts.length ?? 0) === 0;
  const [people, communities] = emptyFollowing
    ? await Promise.all([suggestPeople(member!.id, 6), suggestCommunities(member!.id, 4)])
    : [[] as SuggestPerson[], [] as CommunityListItem[]];

  const viewer = member ? { id: member.id, username: member.username, role: member.role } : null;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 [&>*]:max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">{"feed"}</p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          O que a comunidade tá construindo
        </h1>
        <p className="max-w-xl text-muted">
          Em ordem cronológica, sem algoritmo: quem você segue, as suas comunidades e as edições de agora.{" "}
          {!member && (
            <Link href="/sign-up" className="link-inline">
              crie sua conta pra postar
            </Link>
          )}
        </p>
      </div>

      <div className="grid max-w-none! gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-14">
        <div className="flex min-w-0 flex-col gap-6">
          <nav aria-label="O que mostrar no feed" className="flex flex-wrap gap-2" data-testid="feed-tabs">
            {TIMELINE_TABS.map((key) => (
              <Link
                key={key}
                href={tabHref(key)}
                aria-current={aba === key ? "page" : undefined}
                className={tabClass(aba === key)}
                data-testid={`feed-tab-${key}`}
              >
                {TIMELINE_TAB_LABEL[key]}
              </Link>
            ))}
          </nav>

          {aba === "ao-vivo" && live.length > 0 && (
            <div className="flex flex-col gap-2" data-testid="feed-live-editions">
              <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">rolando agora</p>
              <ul className="flex flex-wrap gap-2">
                {live.map((e) => (
                  <li key={e.id}>
                    <Link href={`/h/${e.id}`} className="chip bare hover:bg-mint">
                      {e.name} →
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {page && (
            <TimelineList
              key={aba}
              aba={aba}
              initialPosts={page.posts}
              initialNext={page.next}
              me={viewer}
              canPost={Boolean(member)}
            >
              {aba === "seguindo" && (
                <div className="flex flex-col gap-4" data-testid="feed-following-empty">
                  <div className="flex flex-col gap-2 border-[1.5px] border-line p-5">
                    <p className="text-[17px] font-bold">Sua timeline aparece quando você segue alguém.</p>
                    <p className="text-[15px] text-muted">
                      {member
                        ? "Siga quem constrói com você: o post de cada pessoa e de cada comunidade que você segue cai aqui, do mais novo pro mais antigo."
                        : "Entre na sua conta, siga quem constrói com você e o post de cada pessoa e comunidade aparece aqui."}
                    </p>
                    {!member && (
                      <Link href="/sign-up" className="cta-link go self-start text-[16px]">
                        criar conta
                      </Link>
                    )}
                  </div>
                  {people.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">quem seguir</p>
                      <ul className="border-b border-line" data-testid="feed-suggest-people">
                        {people.map((p) => (
                          <SuggestRow key={p.id} p={p} />
                        ))}
                      </ul>
                      <Link href="/membros" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
                        ver todas as pessoas →
                      </Link>
                    </div>
                  )}
                  {communities.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">comunidades pra entrar</p>
                      <ul className="border-b border-line" data-testid="feed-suggest-communities">
                        {communities.map((c) => (
                          <li key={c.id} className="border-t border-line py-3">
                            <Link href={`/comunidade/${c.slug}`} className="group flex min-w-0 flex-col">
                              <span className="truncate font-bold transition group-hover:text-accent">{c.name}</span>
                              <span className="truncate font-mono text-[12px] text-muted">
                                {c.city ?? "online"} · {c.members} {c.members === 1 ? "membro" : "membros"}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <Link href="/comunidades" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
                        ver todas as comunidades →
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {aba === "ao-vivo" && (
                <div className="flex flex-col items-start gap-3 border-[1.5px] border-line p-5" data-testid="feed-live-empty">
                  <p className="text-[17px] font-bold">
                    {live.length === 0 ? "Nenhum hackathon rolando agora." : "Nenhum post no mural das edições de agora ainda."}
                  </p>
                  <p className="text-[15px] text-muted">
                    {live.length === 0
                      ? "Quando uma edição do HackaHub estiver acontecendo, o mural dela aparece aqui."
                      : "Quem está na edição posta no mural dela, e o post cai aqui durante o evento."}
                  </p>
                  <Link href="/radar" className="cta-link go text-[16px]">
                    Ver hackathons
                  </Link>
                </div>
              )}

              {aba === "tudo" && (
                <div className="flex flex-col items-start gap-3 border-[1.5px] border-line p-5" data-testid="feed-empty">
                  <p className="text-[17px] font-bold">Ninguém postou ainda.</p>
                  <p className="text-[15px] text-muted">
                    {member ? "Conte o que você está construindo — é o primeiro post do feed." : "Entre pra contar o que você está construindo."}
                  </p>
                  {!member && (
                    <Link href="/sign-up" className="cta-link go text-[16px]">
                      criar conta
                    </Link>
                  )}
                </div>
              )}
            </TimelineList>
          )}

          {updates && updates.items.length > 0 && (
            <div className="flex flex-col gap-4">
              <CommunityUpdates items={updates.items} testId="feed-community-updates" />
              {(updates.page > 1 || updates.hasMore) && (
                <nav aria-label="Páginas" className="flex flex-wrap justify-between gap-3 font-mono text-[13px]" data-testid="feed-pages">
                  {updates.page > 1 ? (
                    <Link href={pageHref("comunidades", updates.page - 1)} className="text-accent underline-offset-4 hover:underline">
                      ← mais novas
                    </Link>
                  ) : (
                    <span />
                  )}
                  {updates.hasMore && (
                    <Link href={pageHref("comunidades", updates.page + 1)} className="text-accent underline-offset-4 hover:underline" data-testid="feed-next-page">
                      mais antigas →
                    </Link>
                  )}
                </nav>
              )}
            </div>
          )}
          {updates && updates.items.length === 0 && (
            <div className="flex flex-col items-start gap-3 border-[1.5px] border-line p-5" data-testid="feed-community-empty">
              <p className="text-[17px] font-bold">
                {!member
                  ? "Suas comunidades aparecem aqui."
                  : !hasCommunities
                    ? "Você ainda não segue nenhuma comunidade."
                    : updates.page > 1
                      ? "Não tem mais nada aqui."
                      : "Nada novo nas suas comunidades ainda."}
              </p>
              <p className="text-[15px] text-muted">
                {!member
                  ? "Entre, siga uma comunidade e o mural, os avisos e os hackathons dela aparecem aqui."
                  : !hasCommunities
                    ? "Entre ou siga uma comunidade e o mural, os avisos e os hackathons dela aparecem aqui."
                    : updates.page > 1
                      ? "Você chegou no fim das novidades das suas comunidades."
                      : "Quando alguém postar no mural, sair aviso ou abrir hackathon, aparece aqui."}
              </p>
              {!member ? (
                <Link href="/sign-up" className="cta-link go text-[16px]">
                  criar conta
                </Link>
              ) : updates.page > 1 ? (
                <Link href={pageHref("comunidades", 1)} className="cta-link go text-[16px]">
                  Voltar pro começo
                </Link>
              ) : (
                <Link href="/comunidades" className="cta-link go text-[16px]">
                  Achar comunidades
                </Link>
              )}
            </div>
          )}
        </div>

        {/* regras da casa — o que cabe no feed */}
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <div className="window hard">
            <div className="tbar">
              <span className="title">FEED.txt — o que postar</span>
              <span className="dots" aria-hidden>
                <b />
                <b />
              </span>
            </div>
            <ol className="tbody gap-3 p-4!">
              {[
                ["Demo", "o que seu time entregou, com link"],
                ["Bastidor", "o que rolou na edição, foto, aprendizado"],
                ["Procuro time", "sua skill e o que falta no time"],
                ["Recado", "carona, mentoria, dúvida da edição"],
              ].map(([t, d], i) => (
                <li key={t} className="grid grid-cols-[28px_1fr] gap-2 font-sans text-[14px]">
                  <span className="font-mono text-accent-on-chrome">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <strong className="font-bold">{t}</strong>{" "}
                    <span className="text-muted">— {d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col gap-2 border-t-2 border-line pt-4">
            <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
              tá numa edição?
            </p>
            <p className="text-[14px] text-muted">
              Cada edição tem mural próprio na página dela. Post de edição
              aparece aqui também, com o selo da edição.
            </p>
            <Link href="/radar" className="cta-link go mt-2 self-start text-[18px]">
              Ver edições
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
