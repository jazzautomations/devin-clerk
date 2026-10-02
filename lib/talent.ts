import db from "@/lib/db";
import { getMemberProjects } from "@/lib/archive";
import {
  isOpenToValue,
  OPEN_TO,
  parseOpenTo,
  type OpenToValue,
} from "@/lib/openTo";

// re-exporta o vocabulário puro — lib/talent é a porta de entrada do domínio
export { OPEN_TO, isOpenToValue, parseOpenTo, type OpenToValue };

// migração idempotente — openTo vive aqui e não no schema principal de
// lib/db.ts (trabalho paralelo naquele arquivo); mesmo pattern do bloco
// memberCols no rodapé de lib/db.ts
const memberCols = (
  db.prepare("PRAGMA table_info(members)").all() as { name: string }[]
).map((c) => c.name);
if (!memberCols.includes("openTo")) {
  db.exec("ALTER TABLE members ADD COLUMN openTo TEXT");
}
// avatarUrl é de lib/members — mesmo guard aqui pra import isolado
if (!memberCols.includes("avatarUrl")) {
  db.exec("ALTER TABLE members ADD COLUMN avatarUrl TEXT");
}

/**
 * Grava o opt-in comercial do membro. Valida contra a whitelist (throw em
 * valor fora dela), deduplica, normaliza caixa. [] grava NULL — o membro
 * sai do diretório.
 */
export function setOpenTo(memberId: number, values: string[]): OpenToValue[] {
  const clean: OpenToValue[] = [];
  for (const raw of values) {
    const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!v) continue;
    if (!isOpenToValue(v)) throw new Error(`openTo inválido: ${v}`);
    if (!clean.includes(v)) clean.push(v);
  }
  db.prepare("UPDATE members SET openTo = ? WHERE id = ?").run(
    clean.length ? clean.join(",") : null,
    memberId,
  );
  return clean;
}

export function getOpenTo(memberId: number): OpenToValue[] {
  const row = db
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
};

// diretório público: só quem optou (openTo não nulo nem vazio), xp desc com
// desempate por username — mérito primeiro, igual ao /membros. A prova
// (projetos + melhor colocação) vem do arquivo real via getMemberProjects.
export function listTalent(limit = 100): TalentEntry[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.username, m.name, m.avatarUrl, m.headline, m.persona,
              m.skills, m.github, m.xp, m.openTo
       FROM members m
       WHERE m.openTo IS NOT NULL AND m.openTo != ''
       ORDER BY m.xp DESC, m.username ASC
       LIMIT ?`,
    )
    .all(limit) as {
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

  return rows.map((r) => {
    const delivered = getMemberProjects(r.username);
    const best = delivered
      .filter((p) => p.placement > 0)
      .sort((a, b) => a.placement - b.placement)[0];
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
    };
  });
}
