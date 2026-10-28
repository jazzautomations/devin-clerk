import db from "@/lib/db";
import { parseEventTime } from "@/lib/eventTime";
import { cancelRegistration, dropFromEdition, RegistrationError } from "@/lib/registrations";

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
// mantidas (anonimizadas pela linha de members) pra não distorcer o agregado:
// a nota do júri e o voto do público seguem no ranking publicado, a resposta
// do NPS na média e o certificado continua verificável pelo código. O texto
// livre dessas linhas é apagado (FREE_TEXT).
const KEEP_TABLES = new Set([
  "registrations",
  "members",
  "scores",
  "live_votes",
  "votes",
  "nps_responses",
  "certificates",
]);
const FREE_TEXT: Record<string, { column: string; fields: string[] }> = {
  scores: { column: "judgeMemberId", fields: ["comment", "feedback"] },
  nps_responses: { column: "memberId", fields: ["worked", "improve"] },
};
// export: referências que NÃO entram (ator sobre dado de terceiros — quem
// tratou uma denúncia não recebe a denúncia no próprio export) e colunas
// internas omitidas (nota interna da organização sobre a denúncia).
// Bloqueio e silêncio (032): o lado de quem foi bloqueado/silenciado não
// entra (a pessoa nunca fica sabendo); a denúncia entra só com o que a pessoa
// escreveu, sem a nota de quem resolveu. Quem foi denunciado também não fica
// sabendo pelo export (reports.targetMemberId), e notificação que a pessoa
// gerou pra outra é dado da outra (notifications.actorId).
const EXPORT_SKIP = new Set([
  "incidents.updatedBy",
  "member_blocks.blockedId",
  "member_mutes.mutedId",
  "reports.resolvedBy",
  "reports.targetMemberId",
  "notifications.actorId",
]);
const EXPORT_OMIT: Record<string, string[]> = {
  incidents: ["internalNote", "updatedBy"],
  reports: ["snapshot", "resolvedBy", "resolution"],
};

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
    if (EXPORT_SKIP.has(`${table}.${column}`)) continue;
    const rows = await db
      .prepare(`SELECT * FROM ${ident(table)} WHERE ${ident(column)} = ?`)
      .all<Record<string, unknown>>(memberId);
    const omit = EXPORT_OMIT[table] ?? [];
    if (rows.length) {
      data[`${table}.${column}`] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !omit.includes(k))));
    }
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
    // começou libera a vaga pelo cancelamento normal (promove a fila e tira
    // a pessoa do time, que segue podendo entregar); edição em andamento ou
    // encerrada guarda a linha anonimizada (contagem, arquivo, certificado).
    // "Começou" usa o mesmo parser das datas da edição (horário de Brasília).
    const now = Date.now();
    const regs = await db
      .prepare(
        `SELECT r.hackathonId, r.status, h.startsAt
         FROM registrations r JOIN hackathons h ON h.id = r.hackathonId
         WHERE r.memberId = ?`,
      )
      .all<{ hackathonId: string; status: string; startsAt: string }>(memberId);
    for (const r of regs) {
      const start = parseEventTime(r.startsAt);
      const future = !start || start.getTime() > now;
      if (r.status === "approved" && !future) continue;
      if (r.status === "approved") {
        try {
          await cancelRegistration(memberId, r.hackathonId, new Date(now), "conta_excluida");
          continue;
        } catch (e) {
          // check-in na véspera: a presença fica, anonimizada
          if (e instanceof RegistrationError) continue;
          throw e;
        }
      }
      await db.prepare("DELETE FROM registrations WHERE memberId = ? AND hackathonId = ?").run(memberId, r.hackathonId);
      if (future) await dropFromEdition(memberId, r.hackathonId, "conta_excluida");
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
    // denúncia de conduta feita pela pessoa: anonimiza o autor (e o contato
    // que ela deixou), mas a denúncia fica — apagar sumiria com o registro
    // de um incidente que pode envolver outras pessoas (frente L)
    await db
      .prepare("UPDATE incidents SET reporterId = NULL, contact = NULL WHERE reporterId = ?")
      .run(memberId);
    // denúncia da fila única (032): mesma regra, fica sem autor
    await db.prepare("UPDATE reports SET reporterId = NULL WHERE reporterId = ?").run(memberId);
    for (const { table, column } of refs) {
      if (!OWNER_COLUMNS.has(column) || KEEP_TABLES.has(table)) continue;
      await db.prepare(`DELETE FROM ${ident(table)} WHERE ${ident(column)} = ?`).run(memberId);
    }
    for (const [table, { column, fields }] of Object.entries(FREE_TEXT)) {
      await db
        .prepare(`UPDATE ${ident(table)} SET ${fields.map((f) => `${ident(f)} = NULL`).join(", ")} WHERE ${ident(column)} = ?`)
        .run(memberId);
    }
    await db.prepare("UPDATE team_members SET username = ? WHERE username = ?").run(anon, member.username);
    // inscrição mantida pela contagem não aparece mais na lista pública
    await db.prepare("UPDATE registrations SET publicListing = 0 WHERE memberId = ?").run(memberId);
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
