import db from "@/lib/db";
import { parseEventTime } from "@/lib/eventTime";
import { hostedSql } from "@/lib/hackathons";

// Fonte única de evidência (spec 046, evidencia-e-lgpd). Selo, nível, bicho,
// depoimento, liga e os números do perfil leem DAQUI, pra nenhum número
// descolar do registro. Só leitura: cada fato sai de uma tabela que já existe.
//
// Regra antifarm: fato só conta em edição ELEGÍVEL —
//   - roda no HackaHub (hostedSql),
//   - tem pelo menos EVIDENCE_MIN_CHECKINS check-ins distintos,
//   - é global (communityId NULL) ou de comunidade verificada e não escondida.
// Isso fecha o ciclo "crio comunidade, crio edição, me aprovo, faço check-in
// em mim e me dou prêmio". E presença, entrega e prêmio não contam pra quem é
// ou já foi organizador da mesma edição.
//
// Fatos ({kind, hackathonId, teamId?, at}; at = "YYYY-MM-DD HH:MM:SS" UTC):
//   presenca  check-in da inscrição aprovada (1 por edição)
//   entrega   time com versão enviada e travado (ou edição encerrada); 1 por time
//   premio    prize_winners do time; 1 por categoria
//   mentoria  mentor, jurado ou staff em edição encerrada (1 por edição; quem
//             também organizou fica só com "organizou")
//   organizou organizador em edição publicada e encerrada
//   duvida    resposta em dúvida resolvida de outra pessoa; 1 por dúvida, até
//             DUVIDA_MAX_PER_EDITION por edição
//   voltou    cada edição com presença além da primeira

export const EVIDENCE_MIN_CHECKINS = 15;
export const DUVIDA_MAX_PER_EDITION = 10;

export const FACT_KINDS = ["presenca", "entrega", "premio", "mentoria", "organizou", "duvida", "voltou"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export type Fact = { kind: FactKind; hackathonId: string; teamId?: number; at: string };

export type FactWindow = { since?: Date | string; until?: Date | string };

/** fim efetivo da edição (mesma fronteira de isOver em lib/hackathons.ts) */
const editionEndSql = (a: string) => `to_ts(COALESCE(${a}.endsAt, ${a}.registrationDeadline, ${a}.startsAt))`;
const editionOverSql = (a: string) => `${editionEndSql(a)} < now()`;
const utcText = (expr: string) => `to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

/**
 * Fragmento SQL: ids das edições elegíveis (uma coluna, "id"). Use como
 * `x.hackathonId IN (${eligibleEditionsSql})`. Aliases internos prefixados
 * com ev_ pra não colidir com a query de fora.
 */
export const eligibleEditionsSql = `SELECT ev_h.id FROM hackathons ev_h
  LEFT JOIN communities ev_c ON ev_c.id = ev_h.communityId
  WHERE ${hostedSql("ev_h")}
    AND (ev_h.communityId IS NULL OR (ev_c.verified = 1 AND ev_c.hidden = 0))
    AND (SELECT COUNT(DISTINCT ev_r.memberId) FROM registrations ev_r
           JOIN checkins ev_k ON ev_k.registrationId = ev_r.id
          WHERE ev_r.hackathonId = ev_h.id AND ev_r.status = 'approved') >= ${EVIDENCE_MIN_CHECKINS}`;

/** a edição conta pra evidência? */
export async function eligibleEdition(hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS y WHERE ?::text IN (${eligibleEditionsSql})`)
    .get<{ y: number }>(hackathonId);
  return !!row;
}

// quem é OU JÁ FOI organizador: tirar o papel depois do evento não destrava
// os fatos (edition_role_revocations guarda o histórico)
const notOrganizer = (hackathonCol: string) =>
  `NOT EXISTS (SELECT 1 FROM edition_roles ev_o
     WHERE ev_o.hackathonId = ${hackathonCol} AND ev_o.memberId = @m AND ev_o.role = 'organizador')
   AND NOT EXISTS (SELECT 1 FROM edition_role_revocations ev_rv
     WHERE ev_rv.hackathonId = ${hackathonCol} AND ev_rv.memberId = @m AND ev_rv.role = 'organizador')`;

type Row = { hackathonId: string; teamId: number | null; at: string };

async function presencas(m: number): Promise<Row[]> {
  return db
    .prepare(
      `SELECT r.hackathonId AS "hackathonId", NULL::int AS "teamId", k.at AS "at"
       FROM registrations r JOIN checkins k ON k.registrationId = r.id
       WHERE r.memberId = @m AND r.status = 'approved'
         AND r.hackathonId IN (${eligibleEditionsSql})
         AND ${notOrganizer("r.hackathonId")}`,
    )
    .all<Row>({ m });
}

async function entregas(m: number): Promise<Row[]> {
  // travado = prazo + tolerância passou e não há reabertura vigente (isLocked
  // em lib/entries.ts); edição encerrada vale como travado (modo sem prazo)
  return db
    .prepare(
      `SELECT t.hackathonId AS "hackathonId", t.id AS "teamId", MAX(ps.submittedAt) AS "at"
       FROM teams t
       JOIN team_members tm ON tm.teamId = t.id
       JOIN members mm ON mm.username = tm.username
       JOIN project_submissions ps ON ps.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE mm.id = @m
         AND t.hackathonId IN (${eligibleEditionsSql})
         AND ${notOrganizer("t.hackathonId")}
         AND (
           (to_ts(h.submissionDeadline) + make_interval(mins => h.submissionGraceMinutes) < now()
             AND COALESCE(to_ts(t.reopenedUntil) <= now(), true))
           OR ${editionOverSql("h")}
         )
       GROUP BY t.hackathonId, t.id`,
    )
    .all<Row>({ m });
}

async function premios(m: number): Promise<Row[]> {
  return db
    .prepare(
      `SELECT pc.hackathonId AS "hackathonId", t.id AS "teamId", pw.createdAt AS "at"
       FROM prize_winners pw
       JOIN prize_categories pc ON pc.id = pw.categoryId
       JOIN teams t ON t.id = pw.teamId AND t.hackathonId = pc.hackathonId
       JOIN team_members tm ON tm.teamId = t.id
       JOIN members mm ON mm.username = tm.username
       WHERE mm.id = @m
         AND pc.hackathonId IN (${eligibleEditionsSql})
         AND ${notOrganizer("pc.hackathonId")}`,
    )
    .all<Row>({ m });
}

async function papeis(m: number, kind: "mentoria" | "organizou"): Promise<Row[]> {
  const where =
    kind === "organizou"
      ? `er.role = 'organizador' AND h.publishedAt IS NOT NULL`
      : `er.role IN ('mentor', 'jurado', 'staff') AND ${notOrganizer("er.hackathonId")}`;
  return db
    .prepare(
      `SELECT er.hackathonId AS "hackathonId", NULL::int AS "teamId",
              MIN(${utcText(editionEndSql("h"))}) AS "at"
       FROM edition_roles er JOIN hackathons h ON h.id = er.hackathonId
       WHERE er.memberId = @m AND ${where}
         AND ${editionOverSql("h")}
         AND er.hackathonId IN (${eligibleEditionsSql})
       GROUP BY er.hackathonId`,
    )
    .all<Row>({ m });
}

async function duvidas(m: number): Promise<Row[]> {
  return db
    .prepare(
      `SELECT x.hackathonId AS "hackathonId", NULL::int AS "teamId", x.at AS "at" FROM (
         SELECT q.hackathonId, MIN(a.createdAt) AS at,
                ROW_NUMBER() OVER (PARTITION BY q.hackathonId ORDER BY MIN(a.createdAt), q.id) AS rn
         FROM answers a JOIN questions q ON q.id = a.questionId
         WHERE a.memberId = @m AND q.resolvedAt IS NOT NULL AND q.memberId <> @m
           AND q.hackathonId IN (${eligibleEditionsSql})
         GROUP BY q.hackathonId, q.id
       ) x WHERE x.rn <= ${DUVIDA_MAX_PER_EDITION}`,
    )
    .all<Row>({ m });
}

const toMs = (v: Date | string) => (v instanceof Date ? v.getTime() : (parseEventTime(v)?.getTime() ?? NaN));

/** todos os fatos verificados do membro, em ordem cronológica */
export async function factsFor(memberId: number, opts: FactWindow = {}): Promise<Fact[]> {
  const [pres, ent, prem, ment, org, duv] = await Promise.all([
    presencas(memberId),
    entregas(memberId),
    premios(memberId),
    papeis(memberId, "mentoria"),
    papeis(memberId, "organizou"),
    duvidas(memberId),
  ]);
  const mk = (kind: FactKind, r: Row): Fact =>
    r.teamId == null ? { kind, hackathonId: r.hackathonId, at: r.at } : { kind, hackathonId: r.hackathonId, teamId: r.teamId, at: r.at };
  const byAt = (a: { at: string }, b: { at: string }) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  // "voltou" olha a história inteira (antes do recorte): a 2ª presença é
  // "voltou" mesmo quando a 1ª está fora da janela pedida
  const voltou = [...pres].sort(byAt).slice(1);
  const all: Fact[] = [
    ...pres.map((r) => mk("presenca", r)),
    ...voltou.map((r) => mk("voltou", r)),
    ...ent.map((r) => mk("entrega", r)),
    ...prem.map((r) => mk("premio", r)),
    ...ment.map((r) => mk("mentoria", r)),
    ...org.map((r) => mk("organizou", r)),
    ...duv.map((r) => mk("duvida", r)),
  ];
  const since = opts.since !== undefined ? toMs(opts.since) : -Infinity;
  const until = opts.until !== undefined ? toMs(opts.until) : Infinity;
  return all
    .filter((f) => {
      const t = toMs(f.at);
      return Number.isNaN(t) ? opts.since === undefined && opts.until === undefined : t >= since && t <= until;
    })
    .sort((a, b) => byAt(a, b) || FACT_KINDS.indexOf(a.kind) - FACT_KINDS.indexOf(b.kind));
}

/** contagem por tipo (todo tipo presente, zero quando não há) */
export async function countFacts(memberId: number, opts: FactWindow = {}): Promise<Record<FactKind, number>> {
  const out = Object.fromEntries(FACT_KINDS.map((k) => [k, 0])) as Record<FactKind, number>;
  for (const f of await factsFor(memberId, opts)) out[f.kind]++;
  return out;
}

export type SharedTeam = { hackathonId: string; hackathonName: string; teamId: number; teamName: string };

/**
 * Edições em que os dois foram do mesmo time, da mais recente pra mais
 * antiga. team_members guarda o @, então o vínculo é pelo @ atual de cada um
 * (trocar de @ renomeia em team_members junto).
 */
export async function sameTeam(a: number, b: number): Promise<SharedTeam[]> {
  if (a === b) return [];
  return db
    .prepare(
      `SELECT t.hackathonId AS "hackathonId", h.name AS "hackathonName", t.id AS "teamId", t.name AS "teamName"
       FROM teams t
       JOIN hackathons h ON h.id = t.hackathonId
       JOIN team_members ta ON ta.teamId = t.id
       JOIN members ma ON ma.username = ta.username AND ma.id = ?
       JOIN team_members tb ON tb.teamId = t.id
       JOIN members mb ON mb.username = tb.username AND mb.id = ?
       ORDER BY to_ts(h.startsAt) DESC NULLS LAST, t.id DESC`,
    )
    .all<SharedTeam>(a, b);
}

/** "vocês fizeram time no X" (null quando nunca fizeram) */
export async function sharedTeamsLabel(a: number, b: number): Promise<string | null> {
  const teams = await sameTeam(a, b);
  if (!teams.length) return null;
  const [first, second] = teams;
  if (teams.length === 1) return `vocês fizeram time no ${first.hackathonName}`;
  if (teams.length === 2) return `vocês fizeram time no ${first.hackathonName} e no ${second.hackathonName}`;
  return `vocês fizeram time no ${first.hackathonName} e em mais ${teams.length - 1} edições`;
}
