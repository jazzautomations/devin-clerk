import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { CommunityLogo } from "@/components/CommunityLogo";
import { parseEventTime } from "@/lib/eventTime";
import { formatDbTime } from "@/lib/format";
import { rateLimit, RATE_LIMITS } from "@/lib/ratelimit";
import {
  isEmptyResult,
  isSearchType,
  parseSearchQuery,
  SEARCH_LABELS,
  SEARCH_Q_MAX,
  SEARCH_TYPES,
  searchAll,
  type SearchCommunity,
  type SearchHackathon,
  type SearchPerson,
  type SearchPost,
  type SearchProject,
  type SearchResults,
  type SearchType,
} from "@/lib/search";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "buscar", robots: { index: false } };

// /busca (logada): um campo só pra pessoas, projetos, posts, comunidades e
// hackathons (lib/search.ts, migration 042). Sem ?tipo= mostra 5 de cada
// seção com "ver todos"; com ?tipo= mostra 20 e "mais" (?antes=). A página
// gasta o mesmo balde "search" do /api/search.

const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });
const FORMAT: Record<string, string> = { online: "online", presencial: "presencial", hibrido: "híbrido" };

function eventDay(v: string): string {
  const d = parseEventTime(v);
  return d ? day.format(d).replace(/\./g, "") : v;
}

function href(q: string, tipo?: SearchType | null, antes?: string | null): string {
  const sp = new URLSearchParams({ q });
  if (tipo) sp.set("tipo", tipo);
  if (antes) sp.set("antes", antes);
  return `/busca?${sp.toString()}`;
}

const row = "group flex min-w-0 items-start gap-3 px-4 py-3.5 transition hover:bg-mint";
const meta = "font-mono text-[12px] leading-snug text-muted";

function PersonRow({ p }: { p: SearchPerson }) {
  return (
    <Link href={`/u/${p.username}`} className={row}>
      <Avatar username={p.username} name={p.name} avatarUrl={p.avatarUrl} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate font-bold tracking-[-0.02em] group-hover:text-accent">{p.name ?? `@${p.username}`}</span>
          <span className={`${meta} break-all`}>@{p.username}</span>
        </span>
        {p.headline && <span className={`${meta} line-clamp-1 break-words`}>{p.headline}</span>}
      </span>
    </Link>
  );
}

function ProjectRow({ p }: { p: SearchProject }) {
  return (
    <Link href={`/p/${p.teamId}`} className={row}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-bold tracking-[-0.02em] break-words group-hover:text-accent">{p.title}</span>
        {p.tagline && <span className="line-clamp-2 text-[14px] leading-snug break-words text-[#2b2b2b]">{p.tagline}</span>}
        <span className={`${meta} break-words`}>
          {p.teamName} · {p.hackathonName}
        </span>
      </span>
    </Link>
  );
}

function PostRow({ p }: { p: SearchPost }) {
  const where = p.communityName ?? p.hackathonName;
  return (
    <Link href={`/post/${p.id}`} className={row} data-testid="busca-post">
      <Avatar username={p.username} name={p.name} avatarUrl={p.avatarUrl} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`${meta} break-words`}>
          @{p.username}
          {where ? ` em ${where}` : ""} · {formatDbTime(p.createdAt)}
        </span>
        <span data-testid="busca-trecho" className="text-[14px] leading-snug break-words group-hover:text-accent">{p.excerpt}</span>
      </span>
    </Link>
  );
}

function CommunityRow({ c }: { c: SearchCommunity }) {
  return (
    <Link href={`/comunidade/${c.slug}`} className={row}>
      <CommunityLogo name={c.name} logoUrl={c.logoUrl} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-bold tracking-[-0.02em] break-words group-hover:text-accent">{c.name}</span>
          {c.verified && <span className="border border-line bg-mint px-1.5 font-mono text-[11px] text-accent">verificada</span>}
        </span>
        <span className={meta}>{c.online ? "online" : (c.city ?? "")}</span>
        {c.description && <span className="line-clamp-2 text-[14px] leading-snug break-words text-[#2b2b2b]">{c.description}</span>}
      </span>
    </Link>
  );
}

function HackathonRow({ h }: { h: SearchHackathon }) {
  return (
    <Link href={`/h/${h.id}`} className={row}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-bold tracking-[-0.02em] break-words group-hover:text-accent">{h.name}</span>
        <span className={`${meta} break-words`}>
          {h.organizer} · {eventDay(h.startsAt)} · {h.location && h.format !== "online" ? h.location : FORMAT[h.format] ?? h.format}
        </span>
        {h.hosted && <span className="self-start font-mono text-[11px] text-accent">roda no HackaHub</span>}
      </span>
    </Link>
  );
}

function Items({ tipo, r }: { tipo: SearchType; r: SearchResults }) {
  const s = r.sections;
  switch (tipo) {
    case "pessoas":
      return s.pessoas?.items.map((p) => <li key={p.id}><PersonRow p={p} /></li>);
    case "projetos":
      return s.projetos?.items.map((p) => <li key={p.teamId}><ProjectRow p={p} /></li>);
    case "posts":
      return s.posts?.items.map((p) => <li key={p.id}><PostRow p={p} /></li>);
    case "comunidades":
      return s.comunidades?.items.map((c) => <li key={c.id}><CommunityRow c={c} /></li>);
    case "hackathons":
      return s.hackathons?.items.map((h) => <li key={h.id}><HackathonRow h={h} /></li>);
  }
}

export default async function BuscaPage({ searchParams }: PageProps<"/busca">) {
  const me = await currentMember();
  if (!me) redirect("/sign-up?redirect_url=%2Fbusca");
  const sp = await searchParams;
  const raw = typeof sp.q === "string" ? sp.q : "";
  const tipo = typeof sp.tipo === "string" && isSearchType(sp.tipo) ? sp.tipo : null;
  const antes = typeof sp.antes === "string" ? sp.antes : null;
  const parsed = raw.trim() ? parseSearchQuery(raw) : null;
  const q = parsed?.ok ? parsed.q : raw.trim().slice(0, SEARCH_Q_MAX);

  let result: SearchResults | null = null;
  let notice: string | null = parsed && !parsed.ok ? parsed.error : null;
  if (parsed?.ok) {
    const lim = rateLimit(`search:${me.id}`, RATE_LIMITS.search);
    if (lim.ok) result = await searchAll(parsed.q, me.id, { tipo, antes });
    else notice = `Muitas buscas seguidas. Tente de novo em ${Math.ceil(lim.retryAfterSec / 60)} min.`;
  }
  const empty = result ? isEmptyResult(result) : false;
  const shown = result ? (tipo ? [tipo] : SEARCH_TYPES.filter((t) => (result.sections[t]?.items.length ?? 0) > 0)) : [];

  const chip = (active: boolean) =>
    `shrink-0 rounded-[6px] border-[1.5px] px-3 py-1.5 transition ${
      active ? "border-line bg-foreground text-band" : "border-line text-foreground hover:bg-mint"
    }`;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <p className="tag self-start">BUSCA</p>
        <h1 className="text-[clamp(2.2rem,6vw,3.4rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">
          {result ? <span className="break-words">“{q}”</span> : "Buscar"}
        </h1>
        {!result && (
          <p className="max-w-[52ch] text-[16px] leading-relaxed text-[#2b2b2b]">
            Pessoas, projetos, posts, comunidades e hackathons. Dá pra procurar pelo @ de alguém.
          </p>
        )}
      </header>

      <form action="/busca" role="search" className="flex gap-2">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={SEARCH_Q_MAX}
          autoFocus={!result}
          placeholder="nome, @, projeto, tema…"
          aria-label="buscar"
          data-testid="busca-campo"
          className="w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-4 py-2.5 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button type="submit" className="btn shrink-0 rounded-[6px]">
          buscar
        </button>
      </form>

      {notice && (
        <p role="status" data-testid="busca-aviso" className="border-l-4 border-orange pl-3 font-mono text-[13px] text-orange">
          {notice}
        </p>
      )}

      {result && (
        <nav aria-label="tipo de resultado" className="-mt-2 flex flex-wrap gap-2 font-mono text-xs">
          <Link href={href(q)} aria-current={!tipo ? "page" : undefined} className={chip(!tipo)}>
            tudo
          </Link>
          {SEARCH_TYPES.map((t) => (
            <Link key={t} href={href(q, t)} aria-current={tipo === t ? "page" : undefined} className={chip(tipo === t)}>
              {SEARCH_LABELS[t].toLowerCase()}
            </Link>
          ))}
        </nav>
      )}

      {result && empty && (
        <p data-testid="busca-vazio" className="border-[1.5px] border-line px-5 py-8 text-center text-[15px] break-words">
          {`Nada com '${q}'. Tente outra palavra ou veja o `}
          <Link href="/radar" className="text-accent underline underline-offset-4">
            /radar
          </Link>
          .
        </p>
      )}

      {result &&
        !empty &&
        shown.map((t) => {
          const section = result.sections[t];
          if (!section) return null;
          return (
            <section key={t} aria-labelledby={`busca-${t}`} data-testid={`busca-secao-${t}`} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={`busca-${t}`} className="font-mono text-[13px] tracking-[0.08em] uppercase">
                  {SEARCH_LABELS[t]}
                </h2>
                {!tipo && section.next && (
                  <Link href={href(q, t)} className="font-mono text-[12px] text-accent underline underline-offset-4">
                    ver todos →
                  </Link>
                )}
              </div>
              {section.items.length > 0 ? (
                <ul className="divide-y divide-line border-[1.5px] border-line bg-background">
                  <Items tipo={t} r={result} />
                </ul>
              ) : (
                <p className="font-mono text-[13px] text-muted">{`Nada aqui com '${q}'.`}</p>
              )}
              {tipo && section.next && (
                <Link href={href(q, t, section.next)} className="btn-ghost self-start rounded-[6px]" data-testid="busca-mais">
                  mais
                </Link>
              )}
            </section>
          );
        })}
    </section>
  );
}
