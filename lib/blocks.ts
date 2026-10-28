import db from "@/lib/db";

// Bloquear e silenciar (migration 032). Ninguém é avisado de nenhum dos dois.
//
// - Bloquear vale nos dois sentidos pra quem lê: eu não vejo a pessoa e ela
//   não me vê. Quem foi bloqueado recebe 404 no /u de quem bloqueou. Bloquear
//   desfaz o seguir pessoa nos dois sentidos (member_follows, migration 033).
// - Silenciar só esconde pra mim: posts e notificações da pessoa somem, ela
//   continua vendo tudo e nada muda do lado dela.
//
// As próximas ondas filtram timeline, menção, autocomplete, sugestões, vagas,
// encontros e DM com hiddenIdsFor (lista em memória) ou hiddenAuthorSql
// (fragmento SQL), e checam contato com isBlockedEither.

export type SafetyPerson = {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

/** bloqueia (idempotente); devolve true se a linha é nova */
export async function block(memberId: number, blockedId: number): Promise<boolean> {
  if (memberId === blockedId) throw new Error("não dá pra bloquear a si mesmo");
  return db.transaction(async () => {
    const res = await db
      .prepare("INSERT OR IGNORE INTO member_blocks (memberId, blockedId) VALUES (?, ?)")
      .run(memberId, blockedId);
    // seguir pessoa (migration 033): bloquear desfaz o seguir dos dois lados
    await db
      .prepare(
        `DELETE FROM member_follows
         WHERE (memberId = ? AND followedId = ?) OR (memberId = ? AND followedId = ?)`,
      )
      .run(memberId, blockedId, blockedId, memberId);
    return res.changes > 0;
  })();
}

export async function unblock(memberId: number, blockedId: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM member_blocks WHERE memberId = ? AND blockedId = ?").run(memberId, blockedId);
  return res.changes > 0;
}

export async function mute(memberId: number, mutedId: number): Promise<boolean> {
  if (memberId === mutedId) throw new Error("não dá pra silenciar a si mesmo");
  const res = await db
    .prepare("INSERT OR IGNORE INTO member_mutes (memberId, mutedId) VALUES (?, ?)")
    .run(memberId, mutedId);
  return res.changes > 0;
}

export async function unmute(memberId: number, mutedId: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM member_mutes WHERE memberId = ? AND mutedId = ?").run(memberId, mutedId);
  return res.changes > 0;
}

/** algum dos dois bloqueou o outro */
export async function isBlockedEither(a: number, b: number): Promise<boolean> {
  if (a === b) return false;
  const row = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM member_blocks
         WHERE (memberId = ? AND blockedId = ?) OR (memberId = ? AND blockedId = ?)) AS x`,
    )
    .get<{ x: boolean }>(a, b, b, a);
  return Boolean(row?.x);
}

/** owner bloqueou viewer: o /u de owner dá 404 pra viewer */
export async function isBlockedBy(viewerId: number, ownerId: number): Promise<boolean> {
  if (viewerId === ownerId) return false;
  const row = await db
    .prepare("SELECT EXISTS (SELECT 1 FROM member_blocks WHERE memberId = ? AND blockedId = ?) AS x")
    .get<{ x: boolean }>(ownerId, viewerId);
  return Boolean(row?.x);
}

/** o que eu fiz com essa pessoa (estado do menu no perfil) */
export async function relationTo(meId: number, otherId: number): Promise<{ blocked: boolean; muted: boolean }> {
  const row = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM member_blocks WHERE memberId = @me AND blockedId = @o) AS blocked,
              EXISTS (SELECT 1 FROM member_mutes WHERE memberId = @me AND mutedId = @o) AS muted`,
    )
    .get<{ blocked: boolean; muted: boolean }>({ me: meId, o: otherId });
  return { blocked: Boolean(row?.blocked), muted: Boolean(row?.muted) };
}

/**
 * Quem eu não devo ver. blocked junta os dois sentidos (quem eu bloqueei e
 * quem me bloqueou); muted é só quem eu silenciei.
 */
export async function hiddenIdsFor(meId: number): Promise<{ blocked: number[]; muted: number[] }> {
  const [blocked, muted] = await Promise.all([
    db
      .prepare(
        `SELECT blockedId AS id FROM member_blocks WHERE memberId = ?
         UNION SELECT memberId AS id FROM member_blocks WHERE blockedId = ?`,
      )
      .all<{ id: number }>(meId, meId),
    db.prepare("SELECT mutedId AS id FROM member_mutes WHERE memberId = ?").all<{ id: number }>(meId),
  ]);
  return { blocked: blocked.map((r) => Number(r.id)), muted: muted.map((r) => Number(r.id)) };
}

/**
 * Fragmento SQL pra filtrar autor bloqueado (dois sentidos) ou silenciado.
 * `col` é a coluna do autor (ex.: "p.memberId") e `param` o nome do
 * parâmetro nomeado com o id de quem lê (ex.: "me" → @me). Com @me = -1
 * (deslogado) o filtro não esconde nada.
 */
export function hiddenAuthorSql(col: string, param = "me"): string {
  return `NOT EXISTS (SELECT 1 FROM member_blocks hb
      WHERE (hb.memberId = @${param} AND hb.blockedId = ${col}) OR (hb.memberId = ${col} AND hb.blockedId = @${param}))
    AND NOT EXISTS (SELECT 1 FROM member_mutes hm WHERE hm.memberId = @${param} AND hm.mutedId = ${col})`;
}

/** /perfil/bloqueados: quem eu bloqueei e quem eu silenciei, mais recente primeiro */
export async function listMySafety(meId: number): Promise<{ blocked: SafetyPerson[]; muted: SafetyPerson[] }> {
  const q = (table: "member_blocks" | "member_mutes", col: "blockedId" | "mutedId") =>
    db
      .prepare(
        `SELECT m.id, m.username, m.name, m.avatarUrl, x.createdAt
         FROM ${table} x JOIN members m ON m.id = x.${col}
         WHERE x.memberId = ? ORDER BY x.createdAt DESC, m.id DESC`,
      )
      .all<SafetyPerson>(meId);
  const [blocked, muted] = await Promise.all([q("member_blocks", "blockedId"), q("member_mutes", "mutedId")]);
  return { blocked, muted };
}
