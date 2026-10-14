import db from "@/lib/db";
import { unregister } from "@/lib/registrations";

// Direitos do titular (LGPD art. 18): exportar e excluir. Genérico de
// propósito — descobre pelo catálogo do Postgres toda coluna que referencia
// members(id), então tabela nova de qualquer feature entra sozinha.
//
// Exclusão = apagar o conteúdo pessoal + anonimizar a linha de members (que
// fica, pra contagens agregadas da edição e pra referências de quem *fez*
// algo — aprovou, publicou, marcou check-in — continuarem válidas).

type MemberRef = { table: string; column: string };

// linhas "da pessoa" (apagadas na exclusão). Outras colunas que apontam pra
// members são ator de ação sobre terceiros (grantedBy, reviewedBy…) e ficam
// apontando pra linha anonimizada.
const OWNER_COLUMNS = new Set(["memberId", "judgeMemberId"]);
// mantidas (anonimizadas pela linha de members) pra não distorcer o agregado
const KEEP_TABLES = new Set(["registrations", "members"]);

async function memberRefs(): Promise<MemberRef[]> {
  return db
    .prepare(
      `SELECT cl.relname AS "table", att.attname AS "column"
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_class ref ON ref.oid = con.confrelid
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
       JOIN pg_namespace ns ON ns.oid = cl.relnamespace
       WHERE con.contype = 'f' AND ref.relname = 'members'
         AND ns.nspname = current_schema()
       ORDER BY 1, 2`,
    )
    .all<MemberRef>();
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function exportMemberData(memberId: number) {
  const member = await db.prepare("SELECT * FROM members WHERE id = ?").get<Record<string, unknown>>(memberId);
  if (!member) return null;
  const data: Record<string, unknown[]> = {};
  for (const { table, column } of await memberRefs()) {
    const rows = await db
      .prepare(`SELECT * FROM ${ident(table)} WHERE ${ident(column)} = ?`)
      .all(memberId);
    if (rows.length) data[`${table}.${column}`] = rows;
  }
  data["team_members.username"] = await db
    .prepare("SELECT * FROM team_members WHERE username = ?")
    .all(member.username);
  data["registration_answers"] = await db
    .prepare(
      `SELECT a.* FROM registration_answers a
       JOIN registrations r ON r.id = a.registrationId WHERE r.memberId = ?`,
    )
    .all(memberId);
  return { exportedAt: new Date().toISOString(), member, data };
}

/** apaga conteúdo pessoal e anonimiza o membro; devolve o clerkId antigo */
export async function deleteMemberData(memberId: number): Promise<string | null> {
  const member = await db
    .prepare("SELECT id, clerkId, username FROM members WHERE id = ?")
    .get<{ id: number; clerkId: string; username: string }>(memberId);
  if (!member || member.clerkId.startsWith("deleted:")) return null;
  const refs = await memberRefs();
  const anon = `removido-${memberId}`;

  await db.transaction(async () => {
    // inscrições: pedido/fila sai de vez; aprovado em edição que ainda não
    // começou libera a vaga pelo cancelamento normal (promove a fila); só
    // edição em andamento/encerrada guarda a linha anonimizada (contagem)
    const regs = await db
      .prepare(
        `SELECT r.hackathonId, r.status, to_ts(h.startsAt) > now() AS future
         FROM registrations r JOIN hackathons h ON h.id = r.hackathonId
         WHERE r.memberId = ?`,
      )
      .all<{ hackathonId: string; status: string; future: boolean }>(memberId);
    for (const r of regs) {
      if (r.status === "approved" && !r.future) continue;
      if (r.status === "approved") await unregister(memberId, r.hackathonId);
      else await db.prepare("DELETE FROM registrations WHERE memberId = ? AND hackathonId = ?").run(memberId, r.hackathonId);
    }
    // dependentes sem cascade dos posts da pessoa
    await db.prepare("DELETE FROM likes WHERE postId IN (SELECT id FROM posts WHERE memberId = ?)").run(memberId);
    await db
      .prepare("DELETE FROM post_comments WHERE postId IN (SELECT id FROM posts WHERE memberId = ?)")
      .run(memberId);
    await db
      .prepare(
        `DELETE FROM registration_answers WHERE registrationId IN
           (SELECT id FROM registrations WHERE memberId = ?)`,
      )
      .run(memberId);
    for (const { table, column } of refs) {
      if (!OWNER_COLUMNS.has(column) || KEEP_TABLES.has(table)) continue;
      await db.prepare(`DELETE FROM ${ident(table)} WHERE ${ident(column)} = ?`).run(memberId);
    }
    await db.prepare("UPDATE team_members SET username = ? WHERE username = ?").run(anon, member.username);
    await db
      .prepare(
        `UPDATE members SET
           clerkId = ?, username = ?, name = NULL, email = ?, bio = NULL,
           skills = '[]', github = NULL, linkedin = NULL, twitter = NULL,
           website = NULL, headline = NULL, persona = NULL, personas = '[]',
           avatarUrl = NULL, openTo = NULL, phone = NULL, whatsappOptIn = 0,
           whatsappOptInAt = NULL, role = 'member'
         WHERE id = ?`,
      )
      .run(`deleted:${memberId}`, anon, `${anon}@removido.invalid`, memberId);
  })();
  return member.clerkId;
}
