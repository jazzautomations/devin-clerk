import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { getEditionRoles, hasEditionRole } from "@/lib/roles";

// Canal de dúvidas da edição (spec 033 US3, FR-004). Lê e escreve quem está
// inscrito (approved/pending) e quem tem papel na edição; organização e
// mentores respondem e marcam resolvida. Substitui o "alguém sabe…" do zap.

type Actor = { id: number; role: string; username?: string };

export async function canUseQuestions(actor: Actor | null, hackathonId: string): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  const reg = await db
    .prepare("SELECT status FROM registrations WHERE hackathonId = ? AND memberId = ?")
    .get<{ status: string }>(hackathonId, actor.id);
  if (reg && (reg.status === "approved" || reg.status === "pending")) return true;
  return (await getEditionRoles(hackathonId, actor.id)).length > 0;
}

/** responder e resolver: organizador e mentor (admin global vale por todos) */
export async function canModerateQuestions(actor: Actor | null, hackathonId: string) {
  return hasEditionRole(actor, hackathonId, "mentor");
}

export function validateQuestionBody(raw: unknown): string {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) throw new Error("escreva a dúvida");
  if (body.length > 2000) throw new Error("até 2000 caracteres");
  return body;
}

export type Answer = {
  id: number;
  username: string;
  name: string | null;
  body: string;
  createdAt: string;
};

export type Question = {
  id: number;
  memberId: number;
  username: string;
  name: string | null;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
  answers: Answer[];
};

/** abertas primeiro; dentro de cada grupo, mais recente primeiro */
export async function listQuestions(hackathonId: string): Promise<Question[]> {
  const [qs, ans] = await Promise.all([
    db
      .prepare(
        `SELECT q.id, q.memberId, m.username, m.name, q.body, q.createdAt, q.resolvedAt
         FROM questions q JOIN members m ON m.id = q.memberId
         WHERE q.hackathonId = ?
         ORDER BY (q.resolvedAt IS NOT NULL), q.id DESC LIMIT 200`,
      )
      .all<Omit<Question, "answers">>(hackathonId),
    db
      .prepare(
        `SELECT a.id, a.questionId, m.username, m.name, a.body, a.createdAt
         FROM answers a
         JOIN questions q ON q.id = a.questionId
         JOIN members m ON m.id = a.memberId
         WHERE q.hackathonId = ? ORDER BY a.id`,
      )
      .all<Answer & { questionId: number }>(hackathonId),
  ]);
  return qs.map((q) => ({
    ...q,
    answers: ans
      .filter((a) => a.questionId === q.id)
      .map((a) => ({ id: a.id, username: a.username, name: a.name, body: a.body, createdAt: a.createdAt })),
  }));
}

export async function getQuestion(hackathonId: string, questionId: number) {
  return db
    .prepare("SELECT id, memberId, body, resolvedAt FROM questions WHERE id = ? AND hackathonId = ?")
    .get<{ id: number; memberId: number; body: string; resolvedAt: string | null }>(questionId, hackathonId);
}

export async function askQuestion(hackathonId: string, memberId: number, body: string) {
  const row = await db
    .prepare("INSERT INTO questions (hackathonId, memberId, body) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, memberId, validateQuestionBody(body));
  return row!.id;
}

/** resposta notifica o autor (notify já pula quando quem responde é o autor) */
export async function answerQuestion(
  hackathonId: string,
  questionId: number,
  author: { id: number; username: string },
  body: string,
): Promise<number> {
  const q = await getQuestion(hackathonId, questionId);
  if (!q) throw new Error("dúvida não encontrada");
  const row = await db
    .prepare("INSERT INTO answers (questionId, memberId, body) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(questionId, author.id, validateQuestionBody(body));
  const h = await db.prepare("SELECT name FROM hackathons WHERE id = ?").get<{ name: string }>(hackathonId);
  await notify(q.memberId, {
    type: "answer",
    actorUsername: author.username,
    text: `@${author.username} respondeu tua dúvida em ${h?.name ?? "uma edição"}`,
    href: `/h/${hackathonId}/duvidas#q${questionId}`,
  });
  return row!.id;
}

export async function setQuestionResolved(
  hackathonId: string,
  questionId: number,
  by: number,
  resolved: boolean,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE questions
       SET resolvedAt = CASE WHEN @resolved::int = 1 THEN COALESCE(resolvedAt, sqlite_now()) END,
           resolvedBy = CASE WHEN @resolved::int = 1 THEN @by::int END
       WHERE id = @id AND hackathonId = @h`,
    )
    .run({ id: questionId, h: hackathonId, by, resolved: resolved ? 1 : 0 });
  return r.changes > 0;
}

export async function countOpenQuestions(hackathonId: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM questions WHERE hackathonId = ? AND resolvedAt IS NULL")
    .get<{ n: number }>(hackathonId);
  return r?.n ?? 0;
}
