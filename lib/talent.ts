import db from "@/lib/db";
import { getMemberProjects } from "@/lib/archive";
import { testimonialStats } from "@/lib/profileFacts";
import type { MemberFilter } from "@/lib/members";
import { toLikePattern } from "@/lib/search";
import {
  isOpenToValue,
  OPEN_TO,
  parseOpenTo,
  type OpenToValue,
} from "@/lib/openTo";

// re-exporta o vocabulário puro — lib/talent é a porta de entrada do domínio
export { OPEN_TO, isOpenToValue, parseOpenTo, type OpenToValue };

/**
 * Grava o opt-in comercial do membro. Valida contra a whitelist (throw em
 * valor fora dela), deduplica, normaliza caixa. [] grava NULL — o membro
 * sai do diretório.
 */
export async function setOpenTo(memberId: number, values: string[]): Promise<OpenToValue[]> {
  const clean: OpenToValue[] = [];
  for (const raw of values) {
    const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!v) continue;
    if (!isOpenToValue(v)) throw new Error(`openTo inválido: ${v}`);
    if (!clean.includes(v)) clean.push(v);
  }
  await db.prepare("UPDATE members SET openTo = ? WHERE id = ?").run(
    clean.length ? clean.join(",") : null,
    memberId,
  );
  return clean;
}

export async function getOpenTo(memberId: number): Promise<OpenToValue[]> {
  const row = await db
    .prepare("SELECT openTo FROM members WHERE id = ?")
    .get(memberId) as { openTo: string | null } | undefined;
  return parseOpenTo(row?.openTo);
}

export type TalentEntry = {
  memberId: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  persona: string | null;
  skills: string[];
  github: string | null;
  xp: number;
  openTo: OpenToValue[];
  /** projetos entregues = times vinculados no arquivo de edições */
  projects: number;
  /** melhor colocação (menor placement > 0) com a edição — null sem pódio */
  best: {
    placement: number;
    hackathonId: string;
    hackathonName: string;
  } | null;
  /** depoimentos de time aceitos que contam (perfil rico, migration 041) */
  testimonials: number;
  /** primeiro trecho de depoimento aceito, pro cartão */
  testimonial: string | null;
};

/** `design` → `%"design"%`: a chave mora num JSON de strings */
function areaKeyPattern(key: string | null | undefined): string | null {
  const clean = typeof key === "string" ? key.trim() : "";
  return clean ? `%"${clean.replace(/[^a-z_]/g, "")}"%` : null;
}

// diretório público: só quem optou (openTo não nulo nem vazio), xp desc com
// desempate por username — mérito primeiro, igual ao /membros. A prova
// (projetos + melhor colocação) vem do arquivo real via getMemberProjects.
// ?oferece=, ?quer=, ?cidade= e ?faculdade= (migration 041) combinam com q.
export async function listTalent(limit = 100, q?: string, filter: MemberFilter = {}): Promise<TalentEntry[]> {
  const rows = await db
    .prepare(
      `SELECT m.id, m.username, m.name, m.avatarUrl, m.headline, m.persona,
              m.skills, m.github, m.xp, m.openTo
       FROM members m
       WHERE m.openTo IS NOT NULL AND m.openTo != ''
         AND (@q::text IS NULL
              OR m.username LIKE @q ESCAPE '\\'
              OR m.name LIKE @q ESCAPE '\\'
              OR m.headline LIKE @q ESCAPE '\\'
              OR m.skills LIKE @q ESCAPE '\\')
         AND (@oferece::text IS NULL OR m.helpOffer LIKE @oferece)
         AND (@quer::text IS NULL OR m.helpWant LIKE @quer)
         AND (@cidade::text IS NULL OR m.city LIKE @cidade ESCAPE '\\')
         AND (@faculdade::text IS NULL OR m.institution LIKE @faculdade ESCAPE '\\')
       ORDER BY m.xp DESC, m.username ASC
       LIMIT @limit`,
    )
    .all({
      q: toLikePattern(q),
      oferece: areaKeyPattern(filter.oferece),
      quer: areaKeyPattern(filter.quer),
      cidade: toLikePattern(filter.cidade),
      faculdade: toLikePattern(filter.faculdade),
      limit,
    }) as {
    id: number;
    username: string;
    name: string | null;
    avatarUrl: string | null;
    headline: string | null;
    persona: string | null;
    skills: string;
    github: string | null;
    xp: number;
    openTo: string;
  }[];

  // contagem e primeiro trecho de depoimento em uma consulta pra lista toda
  const stats = await testimonialStats(rows.map((r) => r.id));

  return Promise.all(rows.map(async (r) => {
    const delivered = await getMemberProjects(r.username);
    const best = delivered
      .filter((p) => p.placement > 0)
      .sort((a, b) => a.placement - b.placement)[0];
    const dep = stats.get(r.id);
    return {
      memberId: r.id,
      username: r.username,
      name: r.name,
      avatarUrl: r.avatarUrl,
      headline: r.headline,
      persona: r.persona,
      skills: JSON.parse(r.skills || "[]") as string[],
      github: r.github,
      xp: r.xp,
      openTo: parseOpenTo(r.openTo),
      projects: delivered.length,
      best: best
        ? {
            placement: best.placement,
            hackathonId: best.hackathonId,
            hackathonName: best.hackathonName,
          }
        : null,
      testimonials: dep?.count ?? 0,
      testimonial: dep?.first ?? null,
    };
  }));
}
