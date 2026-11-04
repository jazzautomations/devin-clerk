import db from "@/lib/db";
import { hiddenAuthorSql } from "@/lib/blocks";
import { limitOrNull } from "@/lib/ratelimit";
import { toLikePattern } from "@/lib/search";
import { currentMember } from "@/lib/session";

// Autocomplete de @ (spec 046, onda 2, migration 039). GET ?q=ab
// - logada: deslogado é 401 JSON (nunca redirect);
// - 120 consultas por hora por membro (balde "suggest"): o campo consulta a
//   cada 200ms de pausa na digitação;
// - q de 2 a 20 caracteres; fora disso 400 (o campo só abre com 2+);
// - até 8 pessoas, quem eu sigo na frente, sem bloqueados (dois sentidos),
//   sem silenciados e sem conta excluída. Devolve só o necessário pro
//   combobox: username, name e avatarUrl.

const MAX = 8;
const MIN_Q = 2;
const MAX_Q = 20;

export async function GET(req: Request) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "suggest", me.id);
  if (limited) return limited;

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < MIN_Q || q.length > MAX_Q) {
    return Response.json({ error: `Busque com ${MIN_Q} caracteres ou mais.` }, { status: 400 });
  }
  const any = toLikePattern(q);
  const prefix = any?.slice(1) ?? null;

  const people = await db
    .prepare(
      `SELECT m.username, m.name, m.avatarUrl
       FROM members m
       WHERE (m.username LIKE @prefix ESCAPE '\\' OR m.name LIKE @prefix ESCAPE '\\'
              OR m.username LIKE @any ESCAPE '\\' OR m.name LIKE @any ESCAPE '\\')
         AND m.clerkId NOT LIKE 'deleted:%'
         AND ${hiddenAuthorSql("m.id")}
       ORDER BY
         CASE WHEN EXISTS (SELECT 1 FROM member_follows f WHERE f.memberId = @me AND f.followedId = m.id)
           THEN 0 ELSE 1 END,
         CASE WHEN m.username LIKE @prefix ESCAPE '\\' OR m.name LIKE @prefix ESCAPE '\\'
           THEN 0 ELSE 1 END,
         m.username ASC
       LIMIT @limit::int`,
    )
    .all<{ username: string; name: string | null; avatarUrl: string | null }>({
      me: me.id,
      any,
      prefix,
      limit: MAX,
    });
  return Response.json({ people });
}
