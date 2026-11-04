import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { FollowButton } from "@/components/FollowButton";
import { HackathonCard } from "@/components/HackathonCard";
import { parseId } from "@/lib/ids";
import { followingIds } from "@/lib/memberFollows";
import { listProjects } from "@/lib/projects";
import { currentMember } from "@/lib/session";
import { hackathonsByTag, normalizeTagParam, peopleBySkill, postIdsByTag } from "@/lib/tags";
import { TagPosts } from "./TagPosts";

// /tag/[tag] (spec 046, onda 2, migration 039): a página da hashtag junta
// posts, projetos, pessoas e hackathons abertos daquela tag. Sem algoritmo:
// post em ordem de chegada, com cursor (?antes=<id>).
//
// Seção vazia some. Quando não há nada na tag, a página diz isso e a caixa de
// postar já vem com "#tag " — a descoberta começa por quem chega primeiro.
// Slug fora da forma canônica (#Next.js, #next.js) responde 308 pra /tag/nextjs.

const PAGE = 20;
const PROJECTS = 4;
const PEOPLE = 12;

type Props = {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ antes?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = normalizeTagParam((await params).tag);
  if (!tag) return { title: "tag" };
  return {
    title: { absolute: `#${tag} no HackaHub` },
    description: `Posts, projetos, pessoas e hackathons com #${tag}.`,
    alternates: { canonical: `/tag/${tag}` },
  };
}

export default async function TagPage({ params, searchParams }: Props) {
  const raw = (await params).tag;
  const tag = normalizeTagParam(raw);
  if (!tag) notFound();
  // forma canônica na URL: #Next.js e #next.js caem no mesmo endereço
  if (raw !== tag) permanentRedirect(`/tag/${tag}`);

  const me = await currentMember();
  if (!me) notFound();

  const antes = parseId((await searchParams).antes ?? null);
  const [posts, projects, people, hackathons, mine] = await Promise.all([
    postIdsByTag(tag, me.id, antes, PAGE + 1),
    listProjects({ tech: tag, meId: me.id, limit: PROJECTS }),
    peopleBySkill(tag, me.id, PEOPLE),
    hackathonsByTag(tag),
    followingIds(me.id),
  ]);
  const page = posts.slice(0, PAGE);
  const nextId = posts.length > PAGE ? page[page.length - 1].id : null;
  const followed = new Set(mine);
  const now = new Date();
  const empty = page.length === 0 && projects.length === 0 && people.length === 0 && hackathons.length === 0;

  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-10 overflow-x-clip px-4 py-10 sm:px-6 sm:py-14"
      data-testid="tag-page"
    >
      <header className="flex flex-col gap-2">
        <p className="tag self-start uppercase">tag</p>
        <h1 className="font-display text-[clamp(2.2rem,7vw,3.4rem)] leading-[0.95] font-extrabold tracking-[-0.035em] break-words">
          #{tag}
        </h1>
        <p className="max-w-xl text-[15px] text-muted">
          Post, projeto, gente e hackathon na mesma tag. A ordem é a de chegada.
        </p>
      </header>

      <section aria-labelledby="tag-posts" className="flex flex-col gap-4">
        <h2 id="tag-posts" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
          posts
        </h2>
        <TagPosts
          tag={tag}
          initialPosts={page}
          me={{ id: me.id, username: me.username, role: me.role }}
          canPost={!antes}
          emptyText={empty ? `Ninguém usou #${tag} ainda. Escreva o primeiro post.` : `Nenhum post com #${tag} ainda.`}
        />
        {nextId !== null && (
          <Link
            href={`/tag/${tag}?antes=${nextId}`}
            className="self-start border-[1.5px] border-line px-4 py-2 font-mono text-[13px] transition hover:border-accent hover:text-accent"
            data-testid="tag-more"
          >
            mais posts →
          </Link>
        )}
      </section>

      {projects.length > 0 && (
        <section aria-labelledby="tag-projetos" className="flex flex-col gap-3" data-testid="tag-projects">
          <h2 id="tag-projetos" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            projetos
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((c) => (
              <li key={c.teamId} className="card flex flex-col gap-2 p-4">
                <Link
                  href={`/p/${c.teamId}`}
                  className="font-display text-lg font-extrabold tracking-[-0.035em] break-words transition hover:text-accent"
                >
                  {c.project.title}
                </Link>
                <p className="font-mono text-xs text-muted">
                  <Link href={`/h/${c.hackathonId}`} className="transition hover:text-accent">
                    {c.hackathonName}
                  </Link>
                  {" · "}
                  {c.teamName}
                </p>
                {c.project.description && <p className="line-clamp-2 text-sm text-muted">{c.project.description}</p>}
                {c.tech.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="feito com">
                    {c.tech.map((t) => (
                      <li key={t.tag}>
                        <Link href={`/projetos?tech=${encodeURIComponent(t.tag)}`} className="tag transition hover:text-accent">
                          {t.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <Link
            href={`/projetos?tech=${encodeURIComponent(tag)}`}
            className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline"
          >
            ver todos os projetos com #{tag} →
          </Link>
        </section>
      )}

      {people.length > 0 && (
        <section aria-labelledby="tag-pessoas" className="flex flex-col gap-3" data-testid="tag-people">
          <h2 id="tag-pessoas" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            pessoas
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {people.map((p) => (
              <li key={p.username} className="flex items-center gap-3 border border-line p-3">
                <Avatar username={p.username} name={p.name} avatarUrl={p.avatarUrl} size="md" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link href={`/u/${p.username}`} className="truncate text-[15px] font-bold transition hover:text-accent">
                    {p.name ?? `@${p.username}`}
                  </Link>
                  <span className="truncate font-mono text-xs text-muted">
                    @{p.username}
                    {p.headline ? ` · ${p.headline}` : ""}
                  </span>
                </div>
                {p.id !== me.id && <FollowButton username={p.username} following={followed.has(p.id)} compact />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hackathons.length > 0 && (
        <section aria-labelledby="tag-hackathons" className="flex flex-col gap-3" data-testid="tag-hackathons">
          <h2 id="tag-hackathons" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            hackathons abertos
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {hackathons.map((h) => (
              <li key={h.id}>
                <HackathonCard hackathon={h} now={now} registered={false} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
