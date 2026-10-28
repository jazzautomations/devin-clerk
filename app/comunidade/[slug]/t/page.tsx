import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JoinButton } from "@/components/CommunityActions";
import { TopicList } from "@/components/TopicList";
import { getCommunityBySlug, getMembership } from "@/lib/communities";
import { currentMember } from "@/lib/session";
import {
  listFlairs,
  listTopics,
  parsePeriod,
  parseSort,
  TOP_PERIOD_LABEL,
  TOP_PERIODS,
  TOPIC_LIMITS,
  TOPIC_SORT_LABEL,
  TOPIC_SORTS,
  type TopicSort,
  type TopPeriod,
} from "@/lib/topics";

export const metadata: Metadata = { title: "tópicos da comunidade", robots: { index: false } };

// /comunidade/[slug]/t — fórum da comunidade (migration 058). Abas de
// ordem, filtro por flair, busca por título e "novo tópico" pra quem é
// membro. Fixados ficam no topo. Exige conta (fora da allowlist do proxy).

export default async function TopicsPage({ params, searchParams }: PageProps<"/comunidade/[slug]/t">) {
  const { slug } = await params;
  const sp = await searchParams;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const sort = parseSort(one(sp.ordem));
  const period = parsePeriod(one(sp.periodo));
  const flair = one(sp.flair)?.trim().slice(0, TOPIC_LIMITS.flair) || null;
  const q = one(sp.q)?.trim().slice(0, TOPIC_LIMITS.q) || null;
  const role = await getMembership(c.id, member.id);
  const canModerate = member.role === "admin" || role === "dono" || role === "organizador";
  const [{ pinned, topics }, flairs] = await Promise.all([
    listTopics(c.id, member.id, { sort, period, flair, q, includeRemoved: canModerate }),
    listFlairs(c.id),
  ]);
  const isMember = role !== null;
  const now = new Date();

  const href = (patch: { ordem?: TopicSort; periodo?: TopPeriod | null; flair?: string | null; q?: string | null }) => {
    const next = new URLSearchParams();
    const o = patch.ordem ?? sort;
    if (o !== "em-alta") next.set("ordem", o);
    const p = patch.periodo === undefined ? (o === "top" ? period : null) : patch.periodo;
    if (o === "top" && p && p !== "semana") next.set("periodo", p);
    const f = patch.flair === undefined ? flair : patch.flair;
    if (f) next.set("flair", f);
    const qq = patch.q === undefined ? q : patch.q;
    if (qq) next.set("q", qq);
    const s = next.toString();
    return `/comunidade/${c.slug}/t${s ? `?${s}` : ""}`;
  };
  const filtered = !!(flair || q);
  const empty = pinned.length === 0 && topics.length === 0;

  return (
    <section className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 overflow-x-clip px-4 py-8 sm:px-6 sm:py-12" data-testid="topics-page">
      <header className="flex flex-col gap-4 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}`} className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {c.name}
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="tag">TÓPICOS</p>
            <h1 className="mt-3 text-[clamp(2.2rem,6vw,3.4rem)] leading-[0.95] font-extrabold tracking-[-0.045em] break-words">Tópicos</h1>
            <p className="mt-2 max-w-[56ch] text-[15px] text-muted">Dúvida, ideia, enquete ou o que você está construindo. Quem é da comunidade abre, responde e vota.</p>
          </div>
          {isMember ? (
            <Link href={`/comunidade/${c.slug}/t/novo`} className="btn min-h-[48px]! shrink-0 self-start px-6! sm:self-auto" data-testid="topic-new">
              novo tópico →
            </Link>
          ) : (
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              <JoinButton slug={c.slug} member={false} />
              <p className="font-mono text-[12px] text-muted">Pra abrir tópico, responder e votar.</p>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <nav aria-label="ordem dos tópicos" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-1 font-mono text-[13px]">
            {TOPIC_SORTS.map((s) => (
              <li key={s}>
                <Link
                  href={href({ ordem: s, periodo: undefined })}
                  aria-current={sort === s ? "page" : undefined}
                  className={`inline-flex min-h-[40px] items-center border-[1.5px] px-3 whitespace-nowrap ${
                    sort === s ? "border-foreground bg-foreground text-background" : "border-line-soft hover:border-foreground"
                  }`}
                  data-testid={`topics-sort-${s}`}
                >
                  {TOPIC_SORT_LABEL[s]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {sort === "top" && (
          <ul className="flex flex-wrap gap-1 font-mono text-[12px]" aria-label="período">
            {TOP_PERIODS.map((p) => (
              <li key={p}>
                <Link
                  href={href({ periodo: p })}
                  aria-current={period === p ? "true" : undefined}
                  className={`inline-flex min-h-[32px] items-center border px-2.5 ${period === p ? "border-accent bg-mint text-accent" : "border-line-soft hover:border-foreground"}`}
                  data-testid={`topics-period-${p}`}
                >
                  {TOP_PERIOD_LABEL[p]}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <form action={`/comunidade/${c.slug}/t`} className="flex min-w-0 gap-2" role="search">
          {sort !== "em-alta" && <input type="hidden" name="ordem" value={sort} />}
          {flair && <input type="hidden" name="flair" value={flair} />}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            maxLength={TOPIC_LIMITS.q}
            placeholder="buscar pelo título"
            aria-label="buscar tópico pelo título"
            className="min-w-0 flex-1 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] focus:border-accent focus:outline-none"
            data-testid="topics-search"
          />
          <button type="submit" className="btn-ghost min-h-[42px]! shrink-0 rounded-[6px]">
            buscar
          </button>
        </form>
        {flairs.length > 0 && (
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="filtrar por flair">
            {flairs.map((f) => {
              const on = flair?.toLowerCase() === f.toLowerCase();
              return (
                <li key={f}>
                  <Link
                    href={href({ flair: on ? null : f })}
                    aria-current={on ? "true" : undefined}
                    className={`inline-block max-w-[200px] truncate border px-2 py-0.5 font-mono text-[12px] ${on ? "border-foreground bg-mint" : "border-line-soft bg-[#f3f3f3] hover:border-foreground"}`}
                    data-testid="topics-flair"
                  >
                    {f}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {filtered && (
          <p className="font-mono text-[12.5px] text-muted">
            {q && <>busca: &quot;{q}&quot; · </>}
            {flair && <>flair: {flair} · </>}
            <Link href={href({ flair: null, q: null })} className="text-accent underline-offset-4 hover:underline">
              limpar
            </Link>
          </p>
        )}
      </div>

      {empty ? (
        <div className="flex flex-col items-start gap-3 border-[1.5px] border-dashed border-line px-5 py-8" data-testid="topics-empty">
          <p className="text-[17px] font-bold">
            {filtered ? "Nada com esse filtro." : sort === "sem-resposta" ? "Tudo respondido por aqui." : "Nenhum tópico ainda. Abra o primeiro: dúvida, ideia ou o que você está construindo."}
          </p>
          {isMember && !filtered && sort !== "sem-resposta" && (
            <Link href={`/comunidade/${c.slug}/t/novo`} className="btn rounded-[6px]">
              abrir tópico
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {pinned.length > 0 && <TopicList topics={pinned} slug={c.slug} meId={member.id} canVote={isMember} now={now} testId="topics-pinned" />}
          {topics.length > 0 ? (
            <TopicList topics={topics} slug={c.slug} meId={member.id} canVote={isMember} now={now} />
          ) : (
            <p className="font-mono text-[13px] text-muted">Fora os fixados, nada por aqui.</p>
          )}
        </div>
      )}
    </section>
  );
}
