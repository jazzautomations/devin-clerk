import Link from "next/link";
import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { CommunityUpdates } from "@/components/CommunityUpdates";
import { FeedSection } from "@/components/FeedSection";
import { communityUpdatesPage, followsAnyCommunity } from "@/lib/follows";
import { getOrCreateMember } from "@/lib/members";
import { listPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "feed",
  description:
    "O que a comunidade tá construindo — demos, projetos e bastidores dos hackathons, postados por devs, empreendedores e marcas.",
  alternates: { canonical: "/feed" },
};

// abas: "minhas comunidades" (mural, avisos e hackathons das comunidades que
// a pessoa segue ou de que é membro) é o padrão de quem tem alguma; "tudo" é
// o feed de sempre. ?aba= escolhe, ?pagina= pagina as comunidades.
type Aba = "comunidades" | "tudo";
const tabHref = (aba: Aba, pagina = 1) => `/feed?aba=${aba}${pagina > 1 ? `&pagina=${pagina}` : ""}`;

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
  const hasCommunities = member ? await followsAnyCommunity(member.id) : false;
  const aba: Aba = !member
    ? "tudo"
    : sp.aba === "tudo" || sp.aba === "comunidades"
      ? sp.aba
      : hasCommunities
        ? "comunidades"
        : "tudo";
  const pagina = Number(typeof sp.pagina === "string" ? sp.pagina : "1");
  const [posts, updates] = await Promise.all([
    aba === "tudo" ? listPosts(50, member?.id ?? null) : Promise.resolve([]),
    aba === "comunidades" && member ? communityUpdatesPage(member.id, pagina) : Promise.resolve(null),
  ]);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 [&>*]:max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"feed"}
        </p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          O que a comunidade tá construindo
        </h1>
        <p className="max-w-xl text-muted">
          Devs, empreendedores, investidores, professores e marcas — demos,
          projetos e bastidores dos hackathons.{" "}
          {!member && (
            <Link href="/sign-up" className="link-inline">
              crie sua conta pra postar
            </Link>
          )}
        </p>
      </div>

      <div className="grid max-w-none! gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-14">
        <div className="flex min-w-0 flex-col gap-6">
          {member && (
            <nav aria-label="O que mostrar no feed" className="flex flex-wrap gap-2" data-testid="feed-tabs">
              {(
                [
                  ["comunidades", "minhas comunidades"],
                  ["tudo", "tudo"],
                ] as const
              ).map(([key, label]) => (
                <Link
                  key={key}
                  href={tabHref(key)}
                  aria-current={aba === key ? "page" : undefined}
                  className={`chip bare min-h-[40px] px-4! text-[13px]! ${aba === key ? "bg-foreground! text-band!" : "hover:bg-mint"}`}
                  data-testid={`feed-tab-${key}`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          )}
          {aba === "tudo" && (
            <FeedSection
              initialPosts={posts}
              canPost={Boolean(member)}
              me={member?.username ?? null}
              isAdmin={member?.role === "admin"}
            />
          )}
          {updates && updates.items.length > 0 && (
            <div className="flex flex-col gap-4">
              <CommunityUpdates items={updates.items} testId="feed-community-updates" />
              {(updates.page > 1 || updates.hasMore) && (
                <nav aria-label="Páginas" className="flex flex-wrap justify-between gap-3 font-mono text-[13px]" data-testid="feed-pages">
                  {updates.page > 1 ? (
                    <Link href={tabHref("comunidades", updates.page - 1)} className="text-accent underline-offset-4 hover:underline">
                      ← mais novas
                    </Link>
                  ) : (
                    <span />
                  )}
                  {updates.hasMore && (
                    <Link href={tabHref("comunidades", updates.page + 1)} className="text-accent underline-offset-4 hover:underline" data-testid="feed-next-page">
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
                {!hasCommunities
                  ? "Você ainda não segue nenhuma comunidade."
                  : updates.page > 1
                    ? "Não tem mais nada aqui."
                    : "Nada novo nas suas comunidades ainda."}
              </p>
              <p className="text-[15px] text-muted">
                {!hasCommunities
                  ? "Entre ou siga uma comunidade e o mural, os avisos e os hackathons dela aparecem aqui."
                  : "Quando alguém postar no mural, sair aviso ou abrir hackathon, aparece aqui."}
              </p>
              {!hasCommunities ? (
                <Link href="/comunidades" className="cta-link go text-[16px]">
                  Achar comunidades
                </Link>
              ) : updates.page > 1 ? (
                <Link href={tabHref("comunidades")} className="cta-link go text-[16px]">
                  Voltar pro começo
                </Link>
              ) : (
                <Link href={tabHref("tudo")} className="cta-link go text-[16px]">
                  Ver o feed inteiro
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
