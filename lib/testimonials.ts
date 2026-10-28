import db from "@/lib/db";
import { isBlockedEither } from "@/lib/blocks";
import { eligibleEdition, sameTeam } from "@/lib/evidence";
import { canNetwork } from "@/lib/network";
import { notify, notifyOnce } from "@/lib/notifications";
import { canHandleReport, getReport } from "@/lib/reports";

// Depoimento de time (migration 037, aposta da spec 044 §1.2).
//
// - Só escreve quem foi do mesmo time da pessoa numa edição que já começou
//   (sameTeam de lib/evidence.ts). Sem time em comum: 403. Com bloqueio em
//   qualquer sentido: 404, igual a quem não existe.
// - Texto puro, 40 a 600 caracteres. Quem mostra escapa (React) e nunca
//   transforma link em <a>.
// - A pessoa aceita, recusa ou, depois de aceitar, esconde. Recusar e
//   esconder não avisam o autor: pra ele continua "enviado".
// - Editar um aceito volta pra pendente: ninguém troca o texto depois de
//   aprovado. Editar recusado ou oculto não avisa ninguém e não muda o status.
//   Por isso aceitar (e mostrar de novo) leva o texto que a tela mostrou: se
//   o autor trocou no meio, dá 409 e a pessoa relê.
// - O aviso "escreveu sobre você" sai uma vez por par a cada
//   RENOTIFY_DAYS: apagar e reescrever não vira canal de cobrança.
// - Denúncia de depoimento vai pra edição; quem trata a denúncia (ou o admin)
//   tira do ar com takeDownTestimonial (status "removido"). Removido some pros
//   dois lados, o dono não traz de volta e o autor não reescreve.
// - Edição fora da regra antifarm (eligibleEdition de lib/evidence.ts:
//   menos de 15 check-ins, comunidade não verificada) aceita depoimento e ele
//   aparece no perfil, mas não entra em countAccepted, que é o número que
//   talento, cartão e bicho usam.
// - Conta excluída leva o texto junto (authorId em PEER_COLUMNS).
// - Quem aparece pra outra pessoa passa por canNetwork, dos dois lados.
// - Depoimento nunca dá XP, badge nem item do bicho (spec 043).

export const TESTIMONIAL_MIN = 40;
export const TESTIMONIAL_MAX = 600;

export const TESTIMONIAL_STATUSES = ["pendente", "aceito", "recusado", "oculto", "removido"] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

/** janela do aviso "escreveu sobre você" por par (autor, pessoa) */
export const RENOTIFY_DAYS = 30;

export const TEXT_CHANGED = "O texto mudou. Recarregue a página.";

export const NOT_TEAMMATE = "Depoimento aqui só vem de quem fez time com a pessoa";

export class TestimonialError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export type TestimonialPerson = { id: number; username: string; name: string | null; avatarUrl: string | null };

export type Testimonial = {
  id: number;
  memberId: number;
  authorId: number;
  hackathonId: string;
  hackathonName: string;
  teamId: number | null;
  body: string;
  status: TestimonialStatus;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  author: TestimonialPerson;
  /** quem recebe */
  member: TestimonialPerson;
};

type Row = Omit<Testimonial, "author" | "member"> & {
  aUsername: string;
  aName: string | null;
  aAvatarUrl: string | null;
  mUsername: string;
  mName: string | null;
  mAvatarUrl: string | null;
};

const SELECT = `SELECT t.id, t.memberId, t.authorId, t.hackathonId, h.name AS "hackathonName", t.teamId, t.body, t.status,
    t.createdAt, t.updatedAt, t.acceptedAt,
    a.username AS "aUsername", a.name AS "aName", a.avatarUrl AS "aAvatarUrl",
    m.username AS "mUsername", m.name AS "mName", m.avatarUrl AS "mAvatarUrl"
  FROM team_testimonials t
  JOIN hackathons h ON h.id = t.hackathonId
  JOIN members a ON a.id = t.authorId
  JOIN members m ON m.id = t.memberId`;

const BLOCKED_PAIR = (x: string, y: string) => `EXISTS (SELECT 1 FROM member_blocks tb
  WHERE (tb.memberId = ${x} AND tb.blockedId = ${y}) OR (tb.memberId = ${y} AND tb.blockedId = ${x}))`;

/** os dois lados ativos e sem bloqueio entre eles */
const LIVE = `a.clerkId NOT LIKE 'deleted:%' AND m.clerkId NOT LIKE 'deleted:%' AND NOT ${BLOCKED_PAIR("t.authorId", "t.memberId")}`;

function toTestimonial(r: Row): Testimonial {
  return {
    id: Number(r.id),
    memberId: Number(r.memberId),
    authorId: Number(r.authorId),
    hackathonId: r.hackathonId,
    hackathonName: r.hackathonName,
    teamId: r.teamId == null ? null : Number(r.teamId),
    body: r.body,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    acceptedAt: r.acceptedAt,
    author: { id: Number(r.authorId), username: r.aUsername, name: r.aName, avatarUrl: r.aAvatarUrl },
    member: { id: Number(r.memberId), username: r.mUsername, name: r.mName, avatarUrl: r.mAvatarUrl },
  };
}

/** texto limpo (quebra de linha normalizada, sem espaço nas pontas) ou erro 400 */
export function cleanBody(raw: unknown): string {
  if (typeof raw !== "string") throw new TestimonialError("Escreva o depoimento.", 400);
  const body = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  // contagem por caractere (code point), igual ao char_length do CHECK
  const n = [...body].length;
  if (n < TESTIMONIAL_MIN) throw new TestimonialError(`Escreva pelo menos ${TESTIMONIAL_MIN} caracteres.`, 400);
  if (n > TESTIMONIAL_MAX) throw new TestimonialError(`Até ${TESTIMONIAL_MAX} caracteres.`, 400);
  return body;
}

export async function getTestimonial(id: number): Promise<Testimonial | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const r = await db.prepare(`${SELECT} WHERE t.id = ?`).get<Row>(id);
  return r ? toTestimonial(r) : null;
}

/** edição já começou? Antes disso o time ainda não fez nada junto */
async function editionStarted(hackathonId: string): Promise<boolean> {
  const r = await db
    .prepare("SELECT 1 AS y FROM hackathons WHERE id = ? AND to_ts(startsAt) <= now()")
    .get<{ y: number }>(hackathonId);
  return !!r;
}

/**
 * Pode authorId escrever sobre memberId nessa edição? Devolve o time em
 * comum ou lança TestimonialError (403 sem time, 404 bloqueio ou conta fora).
 */
export async function assertCanWrite(authorId: number, memberId: number, hackathonId: string): Promise<{ teamId: number }> {
  if (authorId === memberId) throw new TestimonialError("Depoimento é sobre outra pessoa.", 400);
  if (!(await canNetwork(authorId, hackathonId))) throw new TestimonialError("Sua conta não pode escrever depoimento.", 403);
  if (!(await canNetwork(memberId, hackathonId))) throw new TestimonialError("Pessoa não encontrada.", 404);
  if (await isBlockedEither(authorId, memberId)) throw new TestimonialError("Pessoa não encontrada.", 404);
  const shared = (await sameTeam(authorId, memberId)).find((s) => s.hackathonId === hackathonId);
  if (!shared || !(await editionStarted(hackathonId))) throw new TestimonialError(NOT_TEAMMATE, 403);
  return { teamId: shared.teamId };
}

/**
 * Escreve e avisa a pessoa. Erros: 400 (texto), 403 (sem time em comum),
 * 404 (bloqueio), 409 (já escreveu sobre ela nessa edição). O rate limit
 * ("testimonials", 5 por dia) fica na rota.
 */
export async function writeTestimonial(
  authorId: number,
  memberId: number,
  hackathonId: string,
  rawBody: unknown,
): Promise<Testimonial> {
  const body = cleanBody(rawBody);
  const { teamId } = await assertCanWrite(authorId, memberId, hackathonId);
  const row = await db
    .prepare(
      `INSERT INTO team_testimonials (memberId, authorId, hackathonId, teamId, body)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (authorId, memberId, hackathonId) DO NOTHING
       RETURNING id`,
    )
    .get<{ id: number }>(memberId, authorId, hackathonId, teamId, body);
  if (!row) throw new TestimonialError("Você já escreveu sobre essa pessoa nessa edição. Dá pra editar em enviados.", 409);
  const t = (await getTestimonial(Number(row.id)))!;
  // apagar e reescrever não avisa de novo: o texto novo espera na caixa
  await notifyOnce(
    memberId,
    {
      type: "testimonial",
      actorId: authorId,
      actorUsername: t.author.username,
      text: `@${t.author.username} escreveu um depoimento sobre você. Aceita?`,
      href: "/perfil/depoimentos",
    },
    RENOTIFY_DAYS,
  );
  return t;
}

/**
 * O autor troca o texto. Aceito volta pra pendente e a pessoa é avisada de
 * novo; pendente segue pendente; recusado e oculto mudam em silêncio.
 */
export async function editTestimonial(id: number, authorId: number, rawBody: unknown): Promise<Testimonial> {
  const t = await getTestimonial(id);
  if (!t || (t.authorId !== authorId && t.memberId !== authorId)) throw new TestimonialError("Depoimento não encontrado.", 404);
  if (t.authorId !== authorId) throw new TestimonialError("Só quem escreveu pode editar.", 403);
  if (t.status === "removido" || (await isBlockedEither(t.authorId, t.memberId))) throw new TestimonialError("Depoimento não encontrado.", 404);
  const body = cleanBody(rawBody);
  if (body === t.body) return t;
  const res = await db
    .prepare(
      // o SET lê o status de antes; o FOR UPDATE segura um aceite no meio
      `UPDATE team_testimonials n
       SET body = @body, updatedAt = sqlite_now(),
           status = CASE WHEN n.status = 'aceito' THEN 'pendente' ELSE n.status END,
           acceptedAt = CASE WHEN n.status = 'aceito' THEN NULL ELSE n.acceptedAt END
       FROM (SELECT id, status AS before FROM team_testimonials WHERE id = @id FOR UPDATE) o
       WHERE n.id = o.id AND n.authorId = @author AND o.before <> 'removido'
       RETURNING o.before AS "before"`,
    )
    .get<{ before: TestimonialStatus }>({ body, id, author: authorId });
  if (!res) throw new TestimonialError("Depoimento não encontrado.", 404);
  if (res.before === "aceito") {
    await notify(t.memberId, {
      type: "testimonial",
      actorId: authorId,
      actorUsername: t.author.username,
      text: `@${t.author.username} editou o depoimento sobre você. Aceita de novo?`,
      href: "/perfil/depoimentos",
    });
  }
  return (await getTestimonial(id))!;
}

/** o autor retira o que escreveu (qualquer status, menos removido) */
export async function deleteTestimonial(id: number, authorId: number): Promise<void> {
  const t = await getTestimonial(id);
  if (!t || (t.authorId !== authorId && t.memberId !== authorId)) throw new TestimonialError("Depoimento não encontrado.", 404);
  if (t.authorId !== authorId) throw new TestimonialError("Só quem escreveu pode apagar. Você pode esconder.", 403);
  // removido fica: a linha é o que impede reescrever o mesmo texto
  if (t.status === "removido") throw new TestimonialError("Depoimento não encontrado.", 404);
  await db.prepare("DELETE FROM team_testimonials WHERE id = ? AND authorId = ? AND status <> 'removido'").run(id, authorId);
}

type Decision = "accept" | "decline" | "hide";

// de onde cada decisão pode sair. Aceitar também traz de volta um recusado
// ou um oculto (a pessoa mudou de ideia).
const FROM: Record<Decision, TestimonialStatus[]> = {
  accept: ["pendente", "recusado", "oculto"],
  decline: ["pendente"],
  hide: ["aceito"],
};
const TO: Record<Decision, TestimonialStatus> = { accept: "aceito", decline: "recusado", hide: "oculto" };

/** seen: o texto que a tela mostrou (obrigatório pra aceitar) */
async function decide(id: number, memberId: number, d: Decision, seen?: unknown): Promise<Testimonial> {
  const t = await getTestimonial(id);
  if (!t || t.status === "removido" || (t.memberId !== memberId && t.authorId !== memberId)) {
    throw new TestimonialError("Depoimento não encontrado.", 404);
  }
  if (t.memberId !== memberId) throw new TestimonialError("Só quem recebeu decide.", 403);
  if (await isBlockedEither(t.authorId, t.memberId)) throw new TestimonialError("Depoimento não encontrado.", 404);
  if (d === "accept" && typeof seen !== "string") throw new TestimonialError(TEXT_CHANGED, 400);
  if (d === "accept" && seen !== t.body) throw new TestimonialError(TEXT_CHANGED, 409);
  if (t.status === TO[d]) return t;
  if (!FROM[d].includes(t.status)) {
    throw new TestimonialError(d === "hide" ? "Só dá pra esconder o que está no perfil." : "Esse depoimento já foi decidido.", 409);
  }
  // o body no WHERE fecha a corrida com um PATCH do autor entre a leitura e aqui
  const res = await db
    .prepare(
      `UPDATE team_testimonials
       SET status = @to, updatedAt = sqlite_now(),
           acceptedAt = CASE WHEN @to::text = 'aceito' THEN sqlite_now() ELSE acceptedAt END
       WHERE id = @id AND memberId = @m AND status = ANY(@from::text[])
         AND (@seen::text IS NULL OR body = @seen::text)`,
    )
    .run({ to: TO[d], id, m: memberId, from: `{${FROM[d].join(",")}}`, seen: d === "accept" ? (seen as string) : null });
  if (res.changes === 0) throw new TestimonialError(d === "accept" ? TEXT_CHANGED : "Esse depoimento mudou. Recarregue a página.", 409);
  return (await getTestimonial(id))!;
}

/**
 * Aceita: vai pro perfil. Não avisa o autor (o perfil já mostra). seenBody é
 * o texto que a pessoa leu; se o autor trocou depois, 409 TEXT_CHANGED.
 */
export function acceptTestimonial(id: number, memberId: number, seenBody: unknown): Promise<Testimonial> {
  return decide(id, memberId, "accept", seenBody);
}
/** recusa em silêncio: o autor continua vendo "enviado" */
export function declineTestimonial(id: number, memberId: number): Promise<Testimonial> {
  return decide(id, memberId, "decline");
}
/** tira um aceito do perfil, sem avisar ninguém */
export function hideTestimonial(id: number, memberId: number): Promise<Testimonial> {
  return decide(id, memberId, "hide");
}

/**
 * Aceitos de memberId, do aceite mais novo pro mais velho. viewerId (quem
 * olha) tira os autores com bloqueio com ele; o dono e o autor nunca veem o
 * que o bloqueio entre os dois escondeu. Autor fora de canNetwork some.
 */
export async function listAccepted(memberId: number, viewerId: number | null = null): Promise<Testimonial[]> {
  const rows = await db
    .prepare(
      `${SELECT}
       WHERE t.memberId = @m AND t.status = 'aceito' AND ${LIVE}
         AND (@v::int IS NULL OR NOT ${BLOCKED_PAIR("@v::int", "t.authorId")})
       ORDER BY to_ts(t.acceptedAt) DESC NULLS LAST, t.id DESC`,
    )
    .all<Row>({ m: memberId, v: viewerId });
  return filterNetwork(rows.map(toTestimonial), "author");
}

/**
 * Quantos aceitos contam: a regra de listAccepted e só de edição elegível
 * (eligibleEdition, antifarm de lib/evidence.ts). É o número de talento, cartão e bicho.
 */
export async function countAccepted(memberId: number, viewerId: number | null = null): Promise<number> {
  const list = await listAccepted(memberId, viewerId);
  if (list.length === 0) return 0;
  const ids = [...new Set(list.map((t) => t.hackathonId))];
  const ok = new Set<string>();
  await Promise.all(
    ids.map(async (h) => {
      if (await eligibleEdition(h)) ok.add(h);
    }),
  );
  return list.filter((t) => ok.has(t.hackathonId)).length;
}

/** pra aceitar: os pendentes de memberId, do mais velho pro mais novo */
export async function listPending(memberId: number): Promise<Testimonial[]> {
  const rows = await db
    .prepare(`${SELECT} WHERE t.memberId = ? AND t.status = 'pendente' AND ${LIVE} ORDER BY t.id ASC`)
    .all<Row>(memberId);
  return filterNetwork(rows.map(toTestimonial), "author");
}

/** os que o dono escondeu do perfil (dá pra mostrar de novo) */
export async function listHidden(memberId: number): Promise<Testimonial[]> {
  const rows = await db
    .prepare(`${SELECT} WHERE t.memberId = ? AND t.status = 'oculto' AND ${LIVE} ORDER BY to_ts(t.updatedAt) DESC, t.id DESC`)
    .all<Row>(memberId);
  return filterNetwork(rows.map(toTestimonial), "author");
}

/**
 * O que authorId escreveu. publicStatus é o que o autor pode saber: "no
 * perfil" só quando aceito; pendente, recusado e oculto aparecem como "enviado".
 */
export type SentTestimonial = Omit<Testimonial, "status"> & { publicStatus: "enviado" | "no perfil" };

export async function listWrittenBy(authorId: number): Promise<SentTestimonial[]> {
  const rows = await db
    .prepare(`${SELECT} WHERE t.authorId = ? AND t.status <> 'removido' AND ${LIVE} ORDER BY t.id DESC`)
    .all<Row>(authorId);
  const list = await filterNetwork(rows.map(toTestimonial), "member");
  return list.map(({ status, ...t }) => ({ ...t, publicStatus: status === "aceito" ? "no perfil" : "enviado" }));
}

async function filterNetwork(list: Testimonial[], side: "author" | "member"): Promise<Testimonial[]> {
  const ids = [...new Set(list.map((t) => t[side].id))];
  const ok = new Set<number>();
  await Promise.all(
    ids.map(async (id) => {
      if (await canNetwork(id)) ok.add(id);
    }),
  );
  return list.filter((t) => ok.has(t[side].id));
}

export type TeammatesToWrite = {
  hackathonId: string;
  hackathonName: string;
  teamId: number;
  teamName: string;
  people: TestimonialPerson[];
};

/**
 * Colegas de time em edições encerradas pra quem memberId ainda não escreveu,
 * agrupados por edição (mais recente primeiro). Sem conta excluída, sem
 * bloqueio e só quem passa em canNetwork.
 */
export async function teammatesToWrite(memberId: number, limit = 6): Promise<TeammatesToWrite[]> {
  const rows = await db
    .prepare(
      `SELECT t.hackathonId AS "hackathonId", h.name AS "hackathonName", t.id AS "teamId", t.name AS "teamName",
              m.id, m.username, m.name, m.avatarUrl
       FROM members me
       JOIN team_members tme ON tme.username = me.username
       JOIN teams t ON t.id = tme.teamId
       JOIN hackathons h ON h.id = t.hackathonId
       JOIN team_members tm ON tm.teamId = t.id AND tm.username <> me.username
       JOIN members m ON m.username = tm.username
       WHERE me.id = @me AND m.clerkId NOT LIKE 'deleted:%'
         AND to_ts(COALESCE(h.endsAt, h.registrationDeadline, h.startsAt)) < now()
         AND NOT ${BLOCKED_PAIR("@me", "m.id")}
         AND NOT EXISTS (SELECT 1 FROM team_testimonials x
           WHERE x.authorId = @me AND x.memberId = m.id AND x.hackathonId = t.hackathonId)
       ORDER BY to_ts(h.startsAt) DESC NULLS LAST, t.id DESC, m.username ASC`,
    )
    .all<{ hackathonId: string; hackathonName: string; teamId: number; teamName: string } & TestimonialPerson>({ me: memberId });
  const ok = new Set<string>();
  await Promise.all(
    rows.map(async (r) => {
      if (await canNetwork(Number(r.id), r.hackathonId)) ok.add(`${r.hackathonId}:${r.id}`);
    }),
  );
  const groups: TeammatesToWrite[] = [];
  for (const r of rows) {
    if (!ok.has(`${r.hackathonId}:${r.id}`)) continue;
    let g = groups.find((x) => x.teamId === Number(r.teamId));
    if (!g) {
      if (groups.length >= Math.max(1, limit)) continue;
      g = { hackathonId: r.hackathonId, hackathonName: r.hackathonName, teamId: Number(r.teamId), teamName: r.teamName, people: [] };
      groups.push(g);
    }
    g.people.push({ id: Number(r.id), username: r.username, name: r.name, avatarUrl: r.avatarUrl });
  }
  return groups;
}

/** "@a", "@a e @b", "@a, @b e @c"; passando de max, "@a, @b e mais 3" */
export function joinHandles(people: { username: string }[], max = Infinity): string {
  const h = people.map((p) => `@${p.username}`);
  if (h.length > max) return `${h.slice(0, max).join(", ")} e mais ${h.length - max}`;
  if (h.length <= 1) return h.join("");
  return `${h.slice(0, -1).join(", ")} e ${h[h.length - 1]}`;
}

/** depois de aceitar: o autor está entre quem o dono ainda pode escrever? */
export async function canWriteBack(memberId: number, authorId: number): Promise<boolean> {
  const groups = await teammatesToWrite(memberId, 50);
  return groups.some((g) => g.people.some((p) => p.id === authorId));
}

/**
 * Quem trata a denúncia (canHandleReport: organização da edição, conduta ou
 * admin) tira o depoimento denunciado do ar. Vira "removido" e todas as
 * denúncias abertas dele saem resolvidas. 404 sem denúncia ou depoimento,
 * 403 sem permissão, 400 se a denúncia não é de depoimento.
 */
export async function takeDownTestimonial(reportId: number, actor: { id: number; role: string }): Promise<Testimonial> {
  const report = await getReport(reportId);
  if (!report) throw new TestimonialError("Denúncia não encontrada.", 404);
  if (!(await canHandleReport(actor, report))) throw new TestimonialError("Forbidden", 403);
  if (report.targetType !== "depoimento") throw new TestimonialError("Essa denúncia não é de depoimento.", 400);
  const id = /^\d{1,12}$/.test(report.targetId) ? Number(report.targetId) : NaN;
  const t = await getTestimonial(id);
  if (!t) throw new TestimonialError("Depoimento não encontrado.", 404);
  await db.transaction(async () => {
    await db.prepare("UPDATE team_testimonials SET status = 'removido', updatedAt = sqlite_now() WHERE id = ?").run(id);
    await db
      .prepare(
        `UPDATE reports SET resolvedAt = sqlite_now(), resolvedBy = ?, resolution = 'tirei o conteúdo do ar'
         WHERE targetType = 'depoimento' AND targetId = ? AND resolvedAt IS NULL`,
      )
      .run(actor.id, String(id));
  })();
  return (await getTestimonial(id))!;
}
