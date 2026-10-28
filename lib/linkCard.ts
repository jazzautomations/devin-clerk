import db from "@/lib/db";
import { isBlockedEither } from "@/lib/blocks";
import { getCommunityBySlug } from "@/lib/communities";
import { getProjectView } from "@/lib/entriesPublic";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByUsername } from "@/lib/members";
import { PROD_SITE_URL } from "@/lib/site";

// Card de link interno no post (migration 034). Quando o link do post é do
// próprio HackaHub (caminho relativo ou o mesmo host) e aponta pra um
// projeto, uma edição, um perfil ou uma comunidade, o post mostra um card
// com título e linha de apoio. Link externo continua link simples: nada de
// buscar página de fora.
//
// O card respeita o que quem lê pode ver: projeto sem conteúdo aberto,
// edição fora do ar, comunidade escondida e perfil de quem bloqueou (ou foi
// bloqueado) viram null, e o post mostra só o link.

export type LinkCardKind = "projeto" | "edicao" | "perfil" | "comunidade";

export type LinkCard = {
  kind: LinkCardKind;
  title: string;
  subtitle: string | null;
  href: string;
};

export type InternalTarget =
  | { kind: "projeto"; teamId: number }
  | { kind: "edicao"; id: string }
  | { kind: "perfil"; username: string }
  | { kind: "comunidade"; slug: string };

function siteHosts(): string[] {
  const hosts = new Set<string>();
  for (const u of [process.env.NEXT_PUBLIC_SITE_URL, PROD_SITE_URL]) {
    if (!u) continue;
    try {
      hosts.add(new URL(u).host.toLowerCase());
    } catch {
      // SITE_URL torto não vira host aceito
    }
  }
  return [...hosts];
}

/**
 * Parte pura: o link aponta pra uma página interna com card? Aceita caminho
 * relativo ("/p/12") e URL absoluta do mesmo host. Query e âncora são
 * ignoradas.
 */
export function parseInternalLink(url: string, hosts: string[] = siteHosts()): InternalTarget | null {
  const raw = url.trim();
  if (!raw) return null;
  let path: string;
  if (raw.startsWith("/")) {
    if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
    path = raw;
  } else {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!hosts.includes(u.host.toLowerCase())) return null;
    path = u.pathname;
  }
  path = path.split(/[?#]/)[0].replace(/\/+$/, "");
  let seg: string;
  try {
    seg = decodeURIComponent(path);
  } catch {
    return null;
  }
  const m = /^\/(p|h|u|comunidade)\/([^/]+)$/.exec(seg);
  if (!m) return null;
  const [, kind, key] = m;
  if (kind === "p") return /^\d{1,9}$/.test(key) ? { kind: "projeto", teamId: Number(key) } : null;
  if (kind === "h") return /^[a-z0-9-]{1,120}$/i.test(key) ? { kind: "edicao", id: key } : null;
  if (kind === "u") return /^[a-z0-9_.-]{1,40}$/i.test(key) ? { kind: "perfil", username: key } : null;
  return /^[a-z0-9-]{1,80}$/i.test(key) ? { kind: "comunidade", slug: key } : null;
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });

function editionDate(startsAt: string): string | null {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(startsAt) ? startsAt : `${startsAt.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : dateFmt.format(d);
}

const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;

/** card do link interno pra quem lê (meId null = sem conta), ou null */
export async function resolveInternalLink(url: string, meId: number | null): Promise<LinkCard | null> {
  const target = parseInternalLink(url);
  if (!target) return null;
  switch (target.kind) {
    case "projeto": {
      const viewer = meId
        ? ((await db
            .prepare("SELECT id, role, username FROM members WHERE id = ?")
            .get<{ id: number; role: string; username: string }>(meId)) ?? null)
        : null;
      const view = await getProjectView(target.teamId, viewer);
      if (!view || !view.showContent) return null;
      return {
        kind: "projeto",
        title: view.title,
        subtitle: join([view.teamName, view.hackathonName]),
        href: `/p/${view.teamId}`,
      };
    }
    case "edicao": {
      const h = await getHackathon(target.id);
      if (!h || !h.active || h.communityHidden) return null;
      return {
        kind: "edicao",
        title: h.name,
        subtitle: join([editionDate(h.startsAt), h.location, h.communityName]),
        href: `/h/${h.id}`,
      };
    }
    case "perfil": {
      const m = await getMemberByUsername(target.username);
      if (!m || m.clerkId.startsWith("deleted:")) return null;
      if (meId && (await isBlockedEither(meId, m.id))) return null;
      return {
        kind: "perfil",
        title: m.name ?? `@${m.username}`,
        subtitle: join([`@${m.username}`, m.headline]),
        href: `/u/${m.username}`,
      };
    }
    case "comunidade": {
      const c = await getCommunityBySlug(target.slug);
      if (!c || c.hidden) return null;
      return {
        kind: "comunidade",
        title: c.name,
        subtitle: join([c.online ? "online" : c.city, c.verified ? "verificada" : null]),
        href: `/comunidade/${c.slug}`,
      };
    }
  }
}
