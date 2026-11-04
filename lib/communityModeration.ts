import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import type { Community } from "@/lib/communities";

// Moderação da própria comunidade (migration 046). O dono e os organizadores
// moderam o espaço deles sem depender do admin global: removem e banem membro,
// excluem e transferem a comunidade. Aviso (editar/apagar) mora em
// lib/communities.ts, junto das outras consultas de aviso; a fila de denúncia
// é a de lib/reports.ts (032), filtrada por communityId.
//
// Regras de quem pode o quê:
//   - remover membro: dono e organizador. Organizador não remove organizador
//     (só o dono) e ninguém remove o dono — a posse passa por transferência;
//   - excluir e transferir: só o dono (o admin global entra como dono);
//   - tudo grava em community_mod_log: quem, o quê, quando.

type Actor = { id: number; role: string };
type CommunityRef = Pick<Community, "id" | "slug" | "name">;

export class ModerationError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

/** código da ação no log → o que a tela mostra (PT-BR curto) */
export const MOD_ACTION_LABEL = {
  "notice.edit": "editou um aviso",
  "notice.delete": "apagou um aviso",
  "member.remove": "removeu um membro",
  "member.ban": "removeu e impediu de voltar",
  "member.unban": "liberou a volta de um membro",
  "report.resolve": "resolveu uma denúncia",
  "community.delete": "excluiu a comunidade",
  "community.transfer": "passou a posse da comunidade",
} as const;

export type ModAction = keyof typeof MOD_ACTION_LABEL;

export async function logCommunityAction(
  communityId: number,
  actorId: number | null,
  action: ModAction,
  target: string | null = null,
): Promise<void> {
  await db
    .prepare(`INSERT INTO community_mod_log ("communityId", "actorId", action, target) VALUES (?, ?, ?, ?)`)
    .run(communityId, actorId, action, target?.slice(0, 200) ?? null);
}

export type ModLogEntry = {
  id: number;
  action: string;
  target: string | null;
  createdAt: string;
  username: string | null;
  name: string | null;
};

export async function listCommunityLog(communityId: number, limit = 40): Promise<ModLogEntry[]> {
  return db
    .prepare(
      `SELECT l.id, l.action, l.target, l.createdAt, m.username, m.name
       FROM community_mod_log l LEFT JOIN members m ON m.id = l."actorId"
       WHERE l."communityId" = ? ORDER BY l.id DESC LIMIT ?`,
    )
    .all<ModLogEntry>(communityId, limit);
}

/** o log em uma linha pra tela: "removeu um membro · @fulano" */
export function modLogLine(e: Pick<ModLogEntry, "action" | "target" | "username">): string {
  const what = MOD_ACTION_LABEL[e.action as ModAction] ?? e.action;
  return e.target ? `${what} · ${e.target}` : what;
}

/** @ de quem aparece na fila (autor do conteúdo denunciado), por id */
export async function usernamesByIds(ids: number[]): Promise<Record<number, string>> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  if (unique.length === 0) return {};
  const rows = await db
    .prepare("SELECT id, username FROM members WHERE id = ANY(?::int[])")
    .all<{ id: number; username: string }>(`{${unique.join(",")}}`);
  return Object.fromEntries(rows.map((r) => [Number(r.id), r.username]));
}

// ---------- ban ----------

export async function isBannedFromCommunity(communityId: number, memberId: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM community_bans WHERE "communityId" = ? AND "memberId" = ?`)
    .get(communityId, memberId);
  return Boolean(row);
}

export type CommunityBan = {
  memberId: number;
  username: string;
  name: string | null;
  reason: string | null;
  createdAt: string;
  byUsername: string | null;
};

export async function listCommunityBans(communityId: number, limit = 50): Promise<CommunityBan[]> {
  return db
    .prepare(
      `SELECT b."memberId", m.username, m.name, b.reason, b.createdAt, c.username AS byUsername
       FROM community_bans b JOIN members m ON m.id = b."memberId"
       LEFT JOIN members c ON c.id = b."createdBy"
       WHERE b."communityId" = ? ORDER BY b.createdAt DESC, b."memberId" LIMIT ?`,
    )
    .all<CommunityBan>(communityId, limit);
}

/** libera a volta (o caminho de volta de um ban) */
export async function unbanCommunityMember(community: CommunityRef, actor: Actor, targetId: number): Promise<void> {
  const res = await db
    .prepare(`DELETE FROM community_bans WHERE "communityId" = ? AND "memberId" = ?`)
    .run(community.id, targetId);
  if (res.changes === 0) throw new ModerationError("Essa pessoa não está impedida de voltar.", 404);
  await logCommunityAction(community.id, actor.id, "member.unban", await handleOf(targetId));
}

async function handleOf(memberId: number): Promise<string> {
  const row = await db.prepare("SELECT username FROM members WHERE id = ?").get<{ username: string }>(memberId);
  return row ? `@${row.username}` : `#${memberId}`;
}

// ---------- remover membro ----------

/**
 * Tira a pessoa da comunidade (membros e seguir). Com `ban`, grava também
 * community_bans: entrar e seguir passam a dar 403. Ninguém remove o dono;
 * organizador não remove organizador. O admin global tem poder de dono.
 */
export async function removeCommunityMember(input: {
  community: CommunityRef;
  actor: Actor;
  targetId: number;
  ban?: boolean;
  reason?: string | null;
}): Promise<{ banned: boolean }> {
  const { community, actor, targetId } = input;
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  const [actorRole, targetRole] = await Promise.all([
    roleOf(community.id, actor.id, actor.role),
    roleOf(community.id, targetId, "member"),
  ]);
  if (!targetRole) throw new ModerationError("Essa pessoa não está na comunidade.", 404);
  if (targetRole === "dono") {
    throw new ModerationError("O dono não sai por aqui. Passe a posse pra outra pessoa primeiro.", 403);
  }
  if (targetRole === "organizador" && actorRole !== "dono") {
    throw new ModerationError("Só o dono tira outro organizador.", 403);
  }

  const handle = await handleOf(targetId);
  await db.transaction(async () => {
    await db.prepare("DELETE FROM community_members WHERE communityId = ? AND memberId = ?").run(community.id, targetId);
    await db.prepare("DELETE FROM community_follows WHERE communityId = ? AND memberId = ?").run(community.id, targetId);
    if (input.ban) {
      await db
        .prepare(
          `INSERT INTO community_bans ("communityId", "memberId", reason, "createdBy") VALUES (?, ?, ?, ?)
           ON CONFLICT ("communityId", "memberId") DO UPDATE SET reason = EXCLUDED.reason`,
        )
        .run(community.id, targetId, reason || null, actor.id);
    }
    await logCommunityAction(community.id, actor.id, input.ban ? "member.ban" : "member.remove", handle);
  })();
  // aviso neutro: a pessoa sabe que saiu, sem o texto de quem tirou
  if (targetId !== actor.id) {
    await notify(targetId, {
      type: "community_remove",
      text: `Você não faz mais parte da ${community.name}.`,
      href: "/comunidades",
    });
  }
  return { banned: Boolean(input.ban) };
}

/** papel na comunidade; admin global conta como dono, mesmo sendo membro */
async function roleOf(communityId: number, memberId: number, globalRole: string): Promise<"dono" | "organizador" | "membro" | null> {
  if (globalRole === "admin") return "dono";
  const row = await db
    .prepare("SELECT role FROM community_members WHERE communityId = ? AND memberId = ?")
    .get<{ role: "dono" | "organizador" | "membro" }>(communityId, memberId);
  return row?.role ?? null;
}

// ---------- excluir e transferir ----------

/** exclui de verdade? não: deletedAt + hidden. Some das listas e a página dá 404. */
export async function softDeleteCommunity(community: CommunityRef, actor: Actor): Promise<void> {
  await db.transaction(async () => {
    await db
      .prepare(`UPDATE communities SET "deletedAt" = sqlite_now(), hidden = 1 WHERE id = ? AND "deletedAt" IS NULL`)
      .run(community.id);
    // denúncia contra a comunidade inteira não faz mais sentido: a fila do
    // admin fecha junto (mesma decisão do esconder em lib/communities.ts)
    await db
      .prepare(
        `UPDATE reports SET "resolvedAt" = sqlite_now(), resolution = 'comunidade excluída'
         WHERE "targetType" = 'community' AND "targetId" = ? AND "resolvedAt" IS NULL`,
      )
      .run(String(community.id));
    await logCommunityAction(community.id, actor.id, "community.delete", community.name);
  })();
}

/**
 * Passa a posse pra um organizador: quem recebe vira dono e quem passa fica
 * organizador (a comunidade nunca fica sem dono). Só o dono transfere.
 */
export async function transferCommunity(community: CommunityRef, actor: Actor, targetId: number): Promise<void> {
  if (targetId === actor.id) throw new ModerationError("A comunidade já é sua.", 400);
  const targetRole = await roleOf(community.id, targetId, "member");
  if (!targetRole) throw new ModerationError("Essa pessoa não está na comunidade.", 404);
  if (targetRole === "dono") throw new ModerationError("Essa pessoa já é dona da comunidade.", 400);
  if (targetRole !== "organizador") {
    throw new ModerationError("Escolha um organizador: a posse passa pra quem já organiza com você.", 400);
  }
  const handle = await handleOf(targetId);
  await db.transaction(async () => {
    await db
      .prepare("UPDATE community_members SET role = 'dono' WHERE communityId = ? AND memberId = ?")
      .run(community.id, targetId);
    // o doador continua na comunidade como organizador; admin sem vínculo
    // (comunidade sem dono) não tem linha pra rebaixar
    await db
      .prepare(
        `UPDATE community_members SET role = 'organizador' WHERE communityId = ? AND memberId = ? AND role = 'dono'`,
      )
      .run(community.id, actor.id);
    await logCommunityAction(community.id, actor.id, "community.transfer", handle);
  })();
  await notify(targetId, {
    type: "community_role",
    text: `Você agora é dono da ${community.name} no HackaHub.`,
    href: `/comunidade/${community.slug}`,
  });
}
