import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getMemberByClerkId, getOrCreateMember, promoteListedAdmin, type Member } from "@/lib/members";

// currentUser() é um GET na API do Clerk (70–100 ms, com limite de taxa).
// Membro que já existe sai do banco; o Clerk só é consultado na primeira
// materialização e, depois, no máximo uma vez a cada 6 h por processo pra
// trazer o avatar novo. cache() junta layout + page do mesmo request.
const SYNC_MS = 6 * 3600 * 1000;
const lastClerkSync = new Map<string, number>();

function recentlySynced(userId: string): boolean {
  const at = lastClerkSync.get(userId);
  return at !== undefined && Date.now() - at < SYNC_MS;
}

function markSynced(userId: string) {
  if (lastClerkSync.size > 5000) lastClerkSync.clear();
  lastClerkSync.set(userId, Date.now());
}

/**
 * members.lastSeenAt (migration 031): quem voltou, pro digest e as métricas.
 * Um UPDATE condicional, sem ler antes: grava "agora" só se o valor salvo
 * tem mais de 1 hora (ou não existe). Falha aqui nunca derruba a página.
 */
export async function touchLastSeen(memberId: number): Promise<boolean> {
  try {
    const r = await db
      .prepare(
        `UPDATE members SET lastSeenAt = datetime('now')
         WHERE id = ? AND (lastSeenAt IS NULL OR to_ts(lastSeenAt) IS NULL
                           OR to_ts(lastSeenAt) < now() - interval '1 hour')`,
      )
      .run(memberId);
    return r.changes > 0;
  } catch (e) {
    console.error("[session] lastSeenAt", e);
    return false;
  }
}

/** membro logado (materializa no primeiro acesso) ou null deslogado */
export const currentMember = cache(async (): Promise<Member | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const existing = await getMemberByClerkId(userId);
  if (existing && recentlySynced(userId)) {
    await touchLastSeen(existing.id);
    return promoteListedAdmin(existing);
  }
  const user = await currentUser();
  const member = await getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? existing?.email ?? "",
    imageUrl: user?.imageUrl ?? null,
  });
  markSynced(userId);
  if (member) await touchLastSeen(member.id);
  return member;
});
