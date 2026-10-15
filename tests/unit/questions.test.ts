import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  answerQuestion,
  askQuestion,
  canModerateQuestions,
  canUseQuestions,
  listQuestions,
  setQuestionResolved,
} from "@/lib/questions";
import { grantEditionRole } from "@/lib/roles";

// spec 033 US3 / FR-004 — canal de dúvidas da edição.

const H = "duvidas-unit";
let seq = 0;
async function member(role = "member") {
  const tag = `dq${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, role) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, role);
  return { id: row!.id, role, username: `u_${tag}` };
}
async function registered(status: string) {
  const m = await member();
  await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)").run(m.id, H, status);
  return m;
}

beforeEach(async () => {
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, source)
       VALUES (?, 'Dúvidas Unit', 'Hack Inova', '2027-01-01', 'presencial', 'https://x.dev', 'painel')`,
    )
    .run(H);
});

describe("acesso", () => {
  it("inscritos approved/pending e papéis usam; rejected/anon/estranho não", async () => {
    expect(await canUseQuestions(await registered("approved"), H)).toBe(true);
    expect(await canUseQuestions(await registered("pending"), H)).toBe(true);
    expect(await canUseQuestions(await registered("rejected"), H)).toBe(false);
    expect(await canUseQuestions(await member(), H)).toBe(false);
    expect(await canUseQuestions(null, H)).toBe(false);
    const staff = await member();
    await grantEditionRole(H, staff.id, "staff", null);
    expect(await canUseQuestions(staff, H)).toBe(true);
    expect(await canModerateQuestions(staff, H)).toBe(false);
  });

  it("mentor, organizador e admin moderam; inscrito não", async () => {
    const mentor = await member();
    await grantEditionRole(H, mentor.id, "mentor", null);
    const org = await member();
    await grantEditionRole(H, org.id, "organizador", null);
    expect(await canModerateQuestions(mentor, H)).toBe(true);
    expect(await canModerateQuestions(org, H)).toBe(true);
    expect(await canModerateQuestions(await member("admin"), H)).toBe(true);
    expect(await canModerateQuestions(await registered("approved"), H)).toBe(false);
  });
});

describe("thread", () => {
  it("pergunta, resposta notifica o autor, resolvida vai pro fim", async () => {
    const ana = await registered("approved");
    const mentor = await member();
    await grantEditionRole(H, mentor.id, "mentor", null);
    const q1 = await askQuestion(H, ana.id, "  tem estacionamento?  ");
    const q2 = await askQuestion(H, ana.id, "pode time de 5?");
    await answerQuestion(H, q1, mentor, "sim, portão 2");
    const notif = await db
      .prepare("SELECT type, href FROM notifications WHERE memberId = ?")
      .all<{ type: string; href: string }>(ana.id);
    expect(notif).toEqual([{ type: "answer", href: `/h/${H}/duvidas#q${q1}` }]);

    await setQuestionResolved(H, q2, mentor.id, true);
    const list = (await listQuestions(H)).filter((q) => q.memberId === ana.id);
    expect(list.map((q) => q.id)).toEqual([q1, q2]);
    expect(list[0].body).toBe("tem estacionamento?");
    expect(list[0].answers.map((a) => a.body)).toEqual(["sim, portão 2"]);
    expect(list[1].resolvedAt).not.toBeNull();

    await setQuestionResolved(H, q2, mentor.id, false);
    expect((await listQuestions(H)).find((q) => q.id === q2)!.resolvedAt).toBeNull();
  });

  it("resposta do próprio autor não notifica; corpo vazio é recusado", async () => {
    const ana = await registered("approved");
    const q = await askQuestion(H, ana.id, "x?");
    await answerQuestion(H, q, ana, "achei, era no edital");
    expect(await db.prepare("SELECT 1 FROM notifications WHERE memberId = ?").all(ana.id)).toHaveLength(0);
    await expect(askQuestion(H, ana.id, "   ")).rejects.toThrow();
  });

  it("resolver dúvida de outra edição é no-op", async () => {
    const ana = await registered("approved");
    const q = await askQuestion(H, ana.id, "x?");
    expect(await setQuestionResolved("outra-edicao", q, ana.id, true)).toBe(false);
  });
});
