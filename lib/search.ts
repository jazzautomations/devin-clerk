import db from "@/lib/db";
import { hiddenIdsFor } from "@/lib/blocks";
import { hostedSql } from "@/lib/hackathons";
import { canNetwork } from "@/lib/network";
import { projectVisibleSql } from "@/lib/projects";

// spec 023 — busca server-side (?q=) nas listas públicas.
// Termo cru do usuário → padrão LIKE `%…%` com curingas escapados:
// `%` e `_` do usuário são literais, nunca coringas (ESCAPE '\' no SQL).
export function toLikePattern(q: string | null | undefined): string | null {
  const t = (q ?? "").trim();
  if (!t) return null;
  return `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ——— busca global (spec 046, migration 042) ———
//
// /busca e /api/search procuram em pessoas, projetos, posts, comunidades e
// hackathons com o full-text do Postgres ('portuguese', sem extensão).
// websearch_to_tsquery aceita o que a pessoa digita ("aspas", -fora, or) e
// exige todas as palavras; se um tipo não acha nada assim, a mesma busca
// roda de novo pedindo qualquer uma das palavras ("projeto de saúde" acha o
// projeto que só fala de saúde). Ordem por ts_rank.
//
// O que nunca aparece: comunidade escondida (nem post dela, nem hackathon
// dela), conta excluída, quem eu bloqueei ou me bloqueou (e, nos posts,
// quem eu silenciei), hackathon fora do ar (active = 0) e projeto que o
// /projetos não mostra (projectVisibleSql). Pessoa passa por canNetwork().

export const SEARCH_TYPES = ["pessoas", "projetos", "posts", "comunidades", "hackathons"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const SEARCH_LABELS: Record<SearchType, string> = {
  pessoas: "Pessoas",
  projetos: "Projetos",
  posts: "Posts",
  comunidades: "Comunidades",
  hackathons: "Hackathons",
};

export const SEARCH_Q_MIN = 2;
export const SEARCH_Q_MAX = 80;
/** por seção sem tipo / com ?tipo= */
export const SEARCH_LIMIT_ALL = 5;
export const SEARCH_LIMIT_TYPE = 20;
/** trecho do post na lista */
export const POST_EXCERPT_MAX = 160;

const CFG = "'portuguese'";
const v = (col: string, w?: "A" | "B" | "C") =>
  w ? `setweight(to_tsvector(${CFG}, ${col}), '${w}')` : `to_tsvector(${CFG}, ${col})`;
const c = (a: string, col: string) => `coalesce(${a}.${col}, '')`;

/**
 * O documento de cada tipo. A migration 042 cria o índice GIN com esta mesma
 * expressão (só sem o alias); mudou aqui, mude lá numa migration nova.
 */
export const SEARCH_DOC = {
  posts: (a = "p") => v(c(a, "body")),
  projetos: (a = "tp") =>
    [
      v(c(a, "title"), "A"),
      v(`${c(a, "tagline")} || ' ' || ${c(a, "technologies")}`, "B"),
      v(`${c(a, "description")} || ' ' || ${c(a, "howBuilt")}`, "C"),
    ].join(" || "),
  pessoas: (a = "m") =>
    [v(`${c(a, "name")} || ' ' || ${c(a, "username")}`, "A"), v(c(a, "headline"), "B"), v(c(a, "bio"), "C")].join(" || "),
  comunidades: (a = "co") => [v(c(a, "name"), "A"), v(c(a, "description"), "B")].join(" || "),
  hackathons: (a = "h") => [v(c(a, "name"), "A"), v(c(a, "organizer"), "B"), v(c(a, "description"), "C")].join(" || "),
} satisfies Record<SearchType, (alias?: string) => string>;

export type SearchPerson = {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
};
export type SearchProject = {
  teamId: number;
  title: string;
  tagline: string | null;
  logoUrl: string | null;
  teamName: string;
  hackathonId: string;
  hackathonName: string;
};
export type SearchPost = {
  id: number;
  /** até POST_EXCERPT_MAX caracteres, em volta da primeira palavra achada */
  excerpt: string;
  createdAt: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  communitySlug: string | null;
  communityName: string | null;
  hackathonId: string | null;
  hackathonName: string | null;
};
export type SearchCommunity = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  city: string | null;
  online: boolean;
  logoUrl: string | null;
  verified: boolean;
};
export type SearchHackathon = {
  id: string;
  name: string;
  organizer: string;
  startsAt: string;
  endsAt: string | null;
  format: string;
  location: string | null;
  hosted: boolean;
};

export type SearchItemMap = {
  pessoas: SearchPerson;
  projetos: SearchProject;
  posts: SearchPost;
  comunidades: SearchCommunity;
  hackathons: SearchHackathon;
};

/** `next` = cursor pra pedir a página seguinte (opção `antes`); null = acabou */
export type SearchSection<T> = { items: T[]; next: string | null };
export type SearchSections = { [K in SearchType]?: SearchSection<SearchItemMap[K]> };
export type SearchResults = { q: string; tipo: SearchType | null; sections: SearchSections };

export type SearchOpts = {
  tipo?: SearchType | null;
  /** default: 5 sem tipo, 20 com tipo */
  limit?: number;
  /** cursor devolvido em `next` (só com tipo) */
  antes?: string | null;
};

export function isSearchType(t: unknown): t is SearchType {
  return typeof t === "string" && (SEARCH_TYPES as readonly string[]).includes(t);
}

/** valida o termo: 2 a 80 caracteres depois do trim */
export function parseSearchQuery(raw: unknown): { ok: true; q: string } | { ok: false; error: string } {
  const q = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  const len = [...q].length;
  if (len < SEARCH_Q_MIN) return { ok: false, error: `Digite pelo menos ${SEARCH_Q_MIN} letras.` };
  if (len > SEARCH_Q_MAX) return { ok: false, error: `A busca vai até ${SEARCH_Q_MAX} caracteres.` };
  return { ok: true, q };
}

// cursor opaco: modo (a = todas as palavras, o = qualquer uma) + quantos já vieram
type Mode = "a" | "o";
type Cursor = { mode: Mode; offset: number };
export function parseCursor(raw: string | null | undefined): Cursor | null {
  const m = /^([ao])(\d{1,4})$/.exec(raw ?? "");
  return m ? { mode: m[1] as Mode, offset: Number(m[2]) } : null;
}
const cursor = (mode: Mode, offset: number) => `${mode}${offset}`;

/** palavras do termo (letras e números), sem repetir, no máximo 8 */
export function searchWords(q: string): string[] {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1);
  return [...new Set(words)].slice(0, 8);
}

// tsquery de cada modo + os parâmetros que ele usa
function tsQuery(mode: Mode, q: string): { sql: string; params: Record<string, string> } {
  if (mode === "a") return { sql: `websearch_to_tsquery(${CFG}, @q)`, params: { q } };
  const words = searchWords(q);
  const params: Record<string, string> = {};
  words.forEach((w, i) => (params[`w${i}`] = w));
  const parts = words.map((_, i) => `plainto_tsquery(${CFG}, @w${i})`);
  return { sql: parts.length ? `(${parts.join(" || ")})` : `websearch_to_tsquery(${CFG}, @q)`, params: { q, ...params } };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Trecho do post pra lista: o texto inteiro se couber; senão uma janela de
 * até `max` caracteres (reticências incluídas) que começa um pouco antes da
 * primeira palavra da busca, cortada em espaço.
 */
export function excerpt(text: string, q: string, max = POST_EXCERPT_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  const chars = [...t];
  if (chars.length <= max) return t;
  // índice por caractere (não por unidade UTF-16) pra não partir emoji
  const folded = chars.map((ch) => fold(ch)[0] ?? ch).join("");
  let at = -1;
  for (const w of searchWords(q)) {
    const stem = fold(w).slice(0, Math.max(3, Math.min(w.length, 5)));
    const i = folded.indexOf(stem);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  let start = at > 40 ? at - 40 : 0;
  if (start > 0) {
    const sp = chars.slice(start, at).indexOf(" ");
    if (sp !== -1) start += sp + 1;
  }
  const lead = start > 0 ? "…" : "";
  let end = Math.min(chars.length, start + max - lead.length);
  const tail = end < chars.length ? "…" : "";
  if (tail) {
    end -= 1;
    const back = chars.slice(start, end).lastIndexOf(" ");
    if (back > (end - start) / 2) end = start + back;
  }
  return `${lead}${chars.slice(start, end).join("").trim()}${tail}`;
}

type Ctx = { q: string; blocked: string; hiddenAuthors: string; prefix: string | null };
type Page<T> = { rows: T[]; more: boolean };

const pgArray = (ids: number[]) => `{${ids.join(",")}}`;

async function run<T>(sql: string, params: Record<string, unknown>, limit: number, offset: number): Promise<Page<T>> {
  const rows = await db.prepare(`${sql} LIMIT @limit OFFSET @offset`).all<T>({ ...params, limit: limit + 1, offset });
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

// cada tipo: SQL (com TQ e DOC já resolvidos) + mapeamento da linha
const QUERIES: { [K in SearchType]: (tq: string, ctx: Ctx) => { sql: string; params: Record<string, unknown> } } = {
  pessoas: (tq, ctx) => {
    const doc = SEARCH_DOC.pessoas("m");
    const prefix = ctx.prefix ? `m.username LIKE @prefix ESCAPE '\\'` : "FALSE";
    return {
      sql: `SELECT m.id, m.username, m.name, m.avatarUrl, m.headline,
                   ts_rank(${doc}, ${tq}) + CASE WHEN ${prefix} THEN 1 ELSE 0 END AS score
            FROM members m
            WHERE m.clerkId NOT LIKE 'deleted:%'
              AND NOT (m.id = ANY(@blocked::int[]))
              AND (${doc} @@ ${tq} OR ${prefix})
            ORDER BY score DESC, m.id DESC`,
      params: { blocked: ctx.blocked, prefix: ctx.prefix },
    };
  },
  projetos: (tq) => {
    const doc = SEARCH_DOC.projetos("tp");
    return {
      sql: `SELECT t.id AS teamId, tp.title, tp.tagline, tp.logoUrl, t.name AS teamName,
                   h.id AS hackathonId, h.name AS hackathonName, ts_rank(${doc}, ${tq}) AS score
            FROM teams t
            JOIN team_projects tp ON tp.teamId = t.id
            JOIN hackathons h ON h.id = t.hackathonId
            WHERE ${doc} @@ ${tq}
              AND ${projectVisibleSql("t", "h")}
            ORDER BY score DESC, t.id DESC`,
      params: {},
    };
  },
  posts: (tq, ctx) => {
    const doc = SEARCH_DOC.posts("p");
    return {
      sql: `SELECT p.id, p.body, p.createdAt, m.username, m.name, m.avatarUrl,
                   co.slug AS communitySlug, co.name AS communityName,
                   h.id AS hackathonId, h.name AS hackathonName, ts_rank(${doc}, ${tq}) AS score
            FROM posts p
            JOIN members m ON m.id = p.memberId
            LEFT JOIN communities co ON co.id = p.communityId
            LEFT JOIN hackathons h ON h.id = p.hackathonId
            LEFT JOIN communities hc ON hc.id = h.communityId
            WHERE ${doc} @@ ${tq}
              AND COALESCE(co.hidden, 0) = 0
              AND COALESCE(hc.hidden, 0) = 0
              -- mural de edição fora do ar (rascunho ou tirada do ar) não vaza
              AND (h.id IS NULL OR h.active = 1)
              AND m.clerkId NOT LIKE 'deleted:%'
              AND NOT (p.memberId = ANY(@hiddenAuthors::int[]))
            ORDER BY score DESC, p.id DESC`,
      params: { hiddenAuthors: ctx.hiddenAuthors },
    };
  },
  comunidades: (tq) => {
    const doc = SEARCH_DOC.comunidades("co");
    return {
      sql: `SELECT co.id, co.slug, co.name, co.description, co.city, co.online, co.logoUrl, co.verified,
                   ts_rank(${doc}, ${tq}) AS score
            FROM communities co
            WHERE ${doc} @@ ${tq} AND co.hidden = 0
            ORDER BY score DESC, co.id DESC`,
      params: {},
    };
  },
  hackathons: (tq) => {
    const doc = SEARCH_DOC.hackathons("h");
    return {
      sql: `SELECT h.id, h.name, h.organizer, h.startsAt, h.endsAt, h.format, h.location,
                   ${hostedSql("h")} AS hosted, ts_rank(${doc}, ${tq}) AS score
            FROM hackathons h
            LEFT JOIN communities hc ON hc.id = h.communityId
            WHERE ${doc} @@ ${tq} AND h.active = 1 AND COALESCE(hc.hidden, 0) = 0
            ORDER BY score DESC, h.startsAt DESC, h.id`,
      params: {},
    };
  },
};

type Raw = Record<string, unknown>;

async function mapRows<K extends SearchType>(tipo: K, rows: Raw[], q: string): Promise<SearchItemMap[K][]> {
  switch (tipo) {
    case "pessoas": {
      const people = rows.map((r) => ({
        id: Number(r.id),
        username: String(r.username),
        name: (r.name as string | null) ?? null,
        avatarUrl: (r.avatarUrl as string | null) ?? null,
        headline: (r.headline as string | null) ?? null,
      }));
      // a única porta de quem aparece pra outra pessoa (lib/network.ts)
      const ok = await Promise.all(people.map((p) => canNetwork(p.id)));
      return people.filter((_, i) => ok[i]) as SearchItemMap[K][];
    }
    case "projetos":
      return rows.map((r) => ({
        teamId: Number(r.teamId),
        title: String(r.title),
        tagline: (r.tagline as string | null) ?? null,
        logoUrl: (r.logoUrl as string | null) ?? null,
        teamName: String(r.teamName),
        hackathonId: String(r.hackathonId),
        hackathonName: String(r.hackathonName),
      })) as SearchItemMap[K][];
    case "posts":
      return rows.map((r) => ({
        id: Number(r.id),
        excerpt: excerpt(String(r.body), q),
        createdAt: String(r.createdAt),
        username: String(r.username),
        name: (r.name as string | null) ?? null,
        avatarUrl: (r.avatarUrl as string | null) ?? null,
        communitySlug: (r.communitySlug as string | null) ?? null,
        communityName: (r.communityName as string | null) ?? null,
        hackathonId: (r.hackathonId as string | null) ?? null,
        hackathonName: (r.hackathonName as string | null) ?? null,
      })) as SearchItemMap[K][];
    case "comunidades":
      return rows.map((r) => ({
        id: Number(r.id),
        slug: String(r.slug),
        name: String(r.name),
        description: (r.description as string | null) ?? null,
        city: (r.city as string | null) ?? null,
        online: Number(r.online) === 1,
        logoUrl: (r.logoUrl as string | null) ?? null,
        verified: Number(r.verified) === 1,
      })) as SearchItemMap[K][];
    case "hackathons":
      return rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        organizer: String(r.organizer),
        startsAt: String(r.startsAt),
        endsAt: (r.endsAt as string | null) ?? null,
        format: String(r.format),
        location: (r.location as string | null) ?? null,
        hosted: Boolean(r.hosted),
      })) as SearchItemMap[K][];
  }
  return [];
}

async function searchType<K extends SearchType>(
  tipo: K,
  ctx: Ctx,
  limit: number,
  from: Cursor | null,
): Promise<SearchSection<SearchItemMap[K]>> {
  const attempt = async (mode: Mode, offset: number) => {
    const tq = tsQuery(mode, ctx.q);
    const { sql, params } = QUERIES[tipo](tq.sql, ctx);
    return { mode, offset, page: await run<Raw>(sql, { ...tq.params, ...params }, limit, offset) };
  };
  let r = await attempt(from?.mode ?? "a", from?.offset ?? 0);
  // nada com todas as palavras: tenta com qualquer uma (só na 1ª página)
  if (!from && r.page.rows.length === 0 && searchWords(ctx.q).length > 1) r = await attempt("o", 0);
  return {
    items: await mapRows(tipo, r.page.rows, ctx.q),
    next: r.page.more ? cursor(r.mode, r.offset + r.page.rows.length) : null,
  };
}

/**
 * Busca em tudo. Sem `tipo`: as 5 seções com até 5 itens cada. Com `tipo`:
 * só aquela seção, 20 por página, e `antes` (o `next` da página anterior)
 * continua de onde parou. `q` precisa ter passado por parseSearchQuery.
 */
export async function searchAll(q: string, meId: number | null, opts: SearchOpts = {}): Promise<SearchResults> {
  const tipo = opts.tipo ?? null;
  const limit = opts.limit ?? (tipo ? SEARCH_LIMIT_TYPE : SEARCH_LIMIT_ALL);
  const hidden = meId ? await hiddenIdsFor(meId) : { blocked: [], muted: [] };
  const handle = q.replace(/^@/, "");
  const ctx: Ctx = {
    q,
    blocked: pgArray(hidden.blocked),
    hiddenAuthors: pgArray([...new Set([...hidden.blocked, ...hidden.muted])]),
    // pessoas também pelo começo do @ (toLikePattern escapa % e _)
    prefix: handle.length >= 1 ? (toLikePattern(handle)?.slice(1) ?? null) : null,
  };
  const types = tipo ? [tipo] : [...SEARCH_TYPES];
  const from = tipo ? parseCursor(opts.antes) : null;
  const sections = await Promise.all(types.map((t) => searchType(t, ctx, limit, from)));
  const out: SearchSections = {};
  types.forEach((t, i) => {
    (out as Record<SearchType, unknown>)[t] = sections[i];
  });
  return { q, tipo, sections: out };
}

/** nenhuma seção trouxe nada */
export function isEmptyResult(r: SearchResults): boolean {
  return Object.values(r.sections).every((s) => !s || s.items.length === 0);
}
