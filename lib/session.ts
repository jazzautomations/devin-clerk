import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
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

/** membro logado (materializa no primeiro acesso) ou null deslogado */
export const currentMember = cache(async (): Promise<Member | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const existing = await getMemberByClerkId(userId);
  if (existing && recentlySynced(userId)) return promoteListedAdmin(existing);
  const user = await currentUser();
  const member = await getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? existing?.email ?? "",
    imageUrl: user?.imageUrl ?? null,
  });
  markSynced(userId);
  return member;
});
