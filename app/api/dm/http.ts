import { currentMember } from "@/lib/session";
import { DmError, getThreadFor, type ThreadRow, type DmPeer } from "@/lib/dm";
import { getMemberByUsername, resolveUsernameRedirect, type Member } from "@/lib/members";

// Pedaços comuns das rotas de DM (migration 056). Não é rota: o Next só
// serve arquivos route.ts.

export type IdCtx = { params: Promise<{ id: string }> };

export const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });

export function errorResponse(e: unknown): Response {
  if (e instanceof DmError) {
    const headers: Record<string, string> = {};
    if (e.status === 429 && e.retryAfterSec) headers["Retry-After"] = String(e.retryAfterSec);
    return Response.json({ error: e.message }, { status: e.status, headers });
  }
  throw e;
}

/** resolve @ (com redirect de @ antigo); null = não existe ou conta excluída */
export async function resolveMember(raw: unknown): Promise<Member | null> {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  if (!handle || handle.length > 64) return null;
  const found = await getMemberByUsername(handle);
  if (found) return found;
  const moved = await resolveUsernameRedirect(handle);
  return moved ? getMemberByUsername(moved) : null;
}

/**
 * Membro logado + id de thread válido + participante. Thread alheia e id
 * inválido dão 404 (nunca 403 — a existência da conversa não é revelada).
 */
export async function threadGuard(ctx: IdCtx): Promise<{ response: Response } | { me: Member; thread: ThreadRow; peer: DmPeer }> {
  const me = await currentMember();
  if (!me) return { response: unauthorized() };
  const raw = (await ctx.params).id;
  const id = /^\d{1,12}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return { response: Response.json({ error: "Não encontrado." }, { status: 404 }) };
  const found = await getThreadFor(me.id, id);
  if (!found) return { response: Response.json({ error: "Não encontrado." }, { status: 404 }) };
  return { me, thread: found.thread, peer: found.peer };
}
