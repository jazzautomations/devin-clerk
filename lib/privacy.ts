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
//
// CONVENÇÕES PRA QUEM CRIA TABELA OU COLUNA (toda feature, na mesma PR):
// - Coluna pessoal nova em members: registre em ANONYMIZE (com o valor de
//   apagado: NULL, '[]', 0…) ou, se não for pessoal, em KEEP_ON_ANONYMIZE.
//   tests/api/privacy-anonymize.test.ts percorre o information_schema e
//   falha se a coluna não estiver em nenhum dos dois.
// - Tabela de relação entre duas pessoas: memberId pro dono da linha e um
//   nome de PEER_COLUMNS pro outro lado (seguir = followedId, bloqueio =
//   blockedId, depoimento = authorId…). Se qualquer um dos dois excluir a
//   conta, a linha some. authorId cobre texto escrito por uma pessoa sobre a
//   outra: saiu um lado, o texto sai junto. No export, quem aparece do outro
//   lado (linhas em que a pessoa é o peer) entra só como contagem, sem @ de
//   terceiros.
// - Denúncia guarda quem denunciou em reporterId e NÃO é apagada: o autor
//   vira NULL (igual a incidents), porque a denúncia pode envolver terceiros.
// - Coluna nova que aponta pra members fora dessas regras (grantedBy,
//   reviewedBy…) é ator sobre dado de terceiros e fica apontando pra linha
//   anonimizada.

type MemberRef = { table: string; column: string };

// linhas "da pessoa" (apagadas na exclusão). Outras colunas que apontam pra
// members são ator de ação sobre terceiros (grantedBy, reviewedBy…) e ficam
// apontando pra linha anonimizada.
const OWNER_COLUMNS = new Set(["memberId", "judgeMemberId"]);
/** o "outro lado" de uma relação entre duas pessoas: apagada se qualquer lado sai */
export const PEER_COLUMNS = new Set(["followedId", "peerId", "recipientId", "blockedId", "mutedId", "authorId"]);
/** quem denunciou: anonimizado (SET NULL), a denúncia fica */
const REPORTER_COLUMNS = new Set(["reporterId"]);

type AnonValue = string | number | null | ((ctx: { memberId: number; anon: string }) => string);

/**
 * O que cada coluna de members vira na exclusão. Toda coluna pessoal nova em
 * members entra aqui na mesma PR (o teste de colunas obriga).
 */
export const ANONYMIZE: Record<string, AnonValue> = {
  clerkId: ({ memberId }) => `deleted:${memberId}`,
  username: ({ anon }) => anon,
  email: ({ anon }) => `${anon}@removido.invalid`,
  name: null,
  bio: null,
  skills: "[]",
  github: null,
  linkedin: null,
  twitter: null,
  website: null,
  headline: null,
  persona: null,
  personas: "[]",
  role: "member",
  avatarUrl: null,
  openTo: null,
  phone: null,
  whatsappOptIn: 0,
  whatsappOptInAt: null,
  emailBouncedAt: null,
  usernameChangedAt: null,
  onboardedAt: null,
  intents: "[]",
  city: null,
  institution: null,
  course: null,
  lastSeenAt: null,
};

/** colunas de members que ficam como estão na exclusão (não são pessoais) */
export const KEEP_ON_ANONYMIZE = new Set(["id", "createdAt", "xp"]);
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
const EXPORT_SKIP = new Set(["incidents.updatedBy", "notifications.actorId"]);
const EXPORT_OMIT: Record<string, string[]> = { incidents: ["internalNote", "updatedBy"] };

/** o que a exclusão faz com as linhas em que o membro aparece em table.column */
export function deleteAction(table: string, column: string): "delete" | "nullify" | "keep" {
  if (REPORTER_COLUMNS.has(column)) return "nullify";
  if (KEEP_TABLES.has(table)) return "keep";
  return OWNER_COLUMNS.has(column) || PEER_COLUMNS.has(column) ? "delete" : "keep";
}

/** como table.column entra no export: linhas, só contagem (peer) ou fora */
export function exportMode(table: string, column: string): "rows" | "count" | "skip" {
  if (EXPORT_SKIP.has(`${table}.${column}`)) return "skip";
  return PEER_COLUMNS.has(column) ? "count" : "rows";
}

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
  const data: Record<string, unknown> = {};
  for (const { table, column } of await memberRefs()) {
    const mode = exportMode(table, column);
    if (mode === "skip") continue;
    if (mode === "count") {
      // quem me segue, quem escreveu sobre mim: só quantos, nunca quem
      const c = await db
        .prepare(`SELECT COUNT(*)::int AS n FROM ${ident(table)} WHERE ${ident(column)} = ?`)
        .get<{ n: number }>(memberId);
      if (c && c.n > 0) data[`${table}.${column}`] = { count: c.n };
      continue;
    }
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
    // notificação que a pessoa causou na caixa de outra: o @ congelado sai
    // de onde aparece (o texto mostrado, o actorUsername e o link pro perfil
    // antigo). Casa por actorId e, nas linhas antigas sem id, pelo @ atual ou
    // por um @ antigo dela (username_redirects, antes do loop que o apaga).
    // @ como regex (o @ é [a-z0-9_], mas @ legado pode ter outro caractere)
    const handleRe = String.raw`regexp_replace(actorUsername, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')`;
    await db
      .prepare(
        `UPDATE notifications SET
           text = regexp_replace(text, '@' || ${handleRe} || '(?![a-z0-9_])', '@' || ?::text, 'g'),
           href = CASE WHEN href ~ ('^/u/' || ${handleRe} || '([/?#]|$)') THEN NULL ELSE href END,
           actorUsername = ?::text,
           actorId = ?::int
         WHERE actorUsername IS NOT NULL
           AND (actorId = ?::int OR (actorId IS NULL AND actorUsername IN
             (SELECT ?::text UNION SELECT "oldUsername" FROM username_redirects WHERE "memberId" = ?::int)))`,
      )
      .run(anon, anon, memberId, memberId, member.username, memberId);
    for (const { table, column } of refs) {
      const action = deleteAction(table, column);
      if (action === "nullify") {
        await db.prepare(`UPDATE ${ident(table)} SET ${ident(column)} = NULL WHERE ${ident(column)} = ?`).run(memberId);
      } else if (action === "delete") {
        await db.prepare(`DELETE FROM ${ident(table)} WHERE ${ident(column)} = ?`).run(memberId);
      }
    }
    for (const [table, { column, fields }] of Object.entries(FREE_TEXT)) {
      await db
        .prepare(`UPDATE ${ident(table)} SET ${fields.map((f) => `${ident(f)} = NULL`).join(", ")} WHERE ${ident(column)} = ?`)
        .run(memberId);
    }
    await db.prepare("UPDATE team_members SET username = ? WHERE username = ?").run(anon, member.username);
    // inscrição mantida pela contagem não aparece mais na lista pública
    await db.prepare("UPDATE registrations SET publicListing = 0 WHERE memberId = ?").run(memberId);
    const cols = Object.keys(ANONYMIZE);
    const ctx = { memberId, anon };
    await db
      .prepare(`UPDATE members SET ${cols.map((c) => `${ident(c)} = ?`).join(", ")} WHERE id = ?`)
      .run(
        ...cols.map((c) => {
          const v = ANONYMIZE[c];
          return typeof v === "function" ? v(ctx) : v;
        }),
        memberId,
      );
  })();
  return member.clerkId;
}
