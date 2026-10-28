import db from "@/lib/db";
import { cleanUrl } from "@/lib/communities";
import { isSupportKind, type SupportKind } from "@/lib/supportKinds";

// Apoiadores da comunidade (migration 028). Diferente do patrocínio por
// edição (lib/editionSponsors.ts): aqui é quem apoia a comunidade como um
// todo, com apoio que pode não ser dinheiro. Dono/organizador cadastra,
// ordena e remove (guardas em lib/communityAuth.ts); a página pública mostra
// "Quem apoia" só quando tem alguém. Nada é inventado: lista vazia some.

export const SUPPORTER_LIMITS = { name: 80, description: 160, perCommunity: 40 } as const;

export type CommunitySupporter = {
  id: number;
  communityId: number;
  name: string;
  logoUrl: string | null;
  url: string | null;
  kind: SupportKind;
  description: string | null;
  position: number;
};

export type SupporterInput = {
  name: string;
  logoUrl: string | null;
  url: string | null;
  kind: SupportKind;
  description: string | null;
};

const COLS = `id, communityId, name, logoUrl, url, kind, description, position`;

/** valida o corpo de cadastrar apoiador: nome, tipo, link e logo https */
export function parseSupporterInput(b: Record<string, unknown>): { value: SupporterInput } | { error: string } {
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2) return { error: "Diga o nome de quem apoia." };
  if (name.length > SUPPORTER_LIMITS.name) return { error: `Nome: até ${SUPPORTER_LIMITS.name} caracteres.` };
  if (!isSupportKind(b.kind)) return { error: "Escolha o tipo de apoio." };
  let description: string | null = null;
  if (b.description !== undefined && b.description !== null) {
    if (typeof b.description !== "string") return { error: "descrição inválida" };
    const d = b.description.trim().replace(/\s+/g, " ");
    if (d.length > SUPPORTER_LIMITS.description) {
      return { error: `Descrição: até ${SUPPORTER_LIMITS.description} caracteres.` };
    }
    description = d || null;
  }
  const url = cleanUrl(b.url, { httpsOnly: true });
  if ("error" in url) return { error: `${url.error} (link)` };
  const logo = cleanUrl(b.logoUrl, { httpsOnly: true });
  if ("error" in logo) return { error: `${logo.error} (logo)` };
  return { value: { name, kind: b.kind, description, url: url.value, logoUrl: logo.value } };
}

export async function listSupporters(communityId: number): Promise<CommunitySupporter[]> {
  return db
    .prepare(`SELECT ${COLS} FROM community_supporters WHERE communityId = ? ORDER BY position, id`)
    .all<CommunitySupporter>(communityId);
}

export class SupporterError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * cadastra no fim da lista. A linha da comunidade fica travada (FOR UPDATE)
 * até o fim: dois cadastros ao mesmo tempo não passam juntos pelo limite nem
 * pelo nome repetido. O índice único em (communityId, lower(name)) da 028 é a
 * rede de baixo.
 */
export async function addSupporter(communityId: number, input: SupporterInput, by: number): Promise<CommunitySupporter> {
  return db.transaction(async () => {
    await db.prepare("SELECT id FROM communities WHERE id = ? FOR UPDATE").get(communityId);
    const n = await db
      .prepare("SELECT COUNT(*)::int AS n FROM community_supporters WHERE communityId = ?")
      .get<{ n: number }>(communityId);
    if (Number(n?.n ?? 0) >= SUPPORTER_LIMITS.perCommunity) {
      throw new SupporterError(`A página mostra até ${SUPPORTER_LIMITS.perCommunity} apoiadores. Tire um pra colocar outro.`, 409);
    }
    const dup = await db
      .prepare("SELECT 1 AS x FROM community_supporters WHERE communityId = ? AND lower(name) = lower(?)")
      .get(communityId, input.name);
    if (dup) throw new SupporterError(`${input.name} já está na lista.`, 409);
    const row = await db
      .prepare(
        `INSERT INTO community_supporters (communityId, name, logoUrl, url, kind, description, createdBy, position)
         VALUES (@communityId, @name, @logoUrl, @url, @kind, @description, @by,
           (SELECT COALESCE(MAX(position), 0) + 1 FROM community_supporters WHERE communityId = @communityId))
         RETURNING ${COLS}`,
      )
      .get<CommunitySupporter>({ communityId, ...input, by })
      .catch((e: unknown) => {
        if ((e as { code?: string })?.code === "23505") throw new SupporterError(`${input.name} já está na lista.`, 409);
        throw e;
      });
    return row!;
  })();
}

/** remove. false = o id não é desta comunidade (ou já saiu) */
export async function removeSupporter(communityId: number, id: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM community_supporters WHERE id = ? AND communityId = ?").run(id, communityId);
  return res.changes > 0;
}

/**
 * Nova ordem: a lista tem que ter exatamente os apoiadores desta comunidade
 * (nem a mais, nem a menos). Id de outra comunidade é recusado inteiro.
 */
export async function reorderSupporters(communityId: number, ids: number[]): Promise<CommunitySupporter[]> {
  return db.transaction(async () => {
    await db.prepare("SELECT id FROM communities WHERE id = ? FOR UPDATE").get(communityId);
    const current = await listSupporters(communityId);
    const have = new Set(current.map((s) => s.id));
    if (ids.length !== have.size || new Set(ids).size !== ids.length || ids.some((id) => !have.has(id))) {
      throw new SupporterError("A ordem precisa ter todos os apoiadores da comunidade, uma vez cada.");
    }
    for (const [i, id] of ids.entries()) {
      await db.prepare("UPDATE community_supporters SET position = ? WHERE id = ? AND communityId = ?").run(i + 1, id, communityId);
    }
    return listSupporters(communityId);
  })();
}
