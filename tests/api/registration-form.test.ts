import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { createQuestion } from "@/lib/registrationForm";
import { getRegistrationStatus, setEditionCapacity } from "@/lib/registrations";

// spec 033 US1 — formulário de inscrição + consentimento + vagas pela API.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(async () => null),
}));

type AuthResult = Awaited<ReturnType<typeof auth>>;
const asUser = (id: string | null) => vi.mocked(auth).mockResolvedValue({ userId: id } as AuthResult);

const ED = "form-api";

const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: ED }) };

async function idOf(clerkId: string) {
  return (await db.prepare("SELECT id FROM members WHERE clerkId = ?").get<{ id: number }>(clerkId))!.id;
}

beforeEach(async () => {
  for (const [c, u, role] of [
    ["clerk_f_usr", "f_usr", "member"],
    ["clerk_f_usr2", "f_usr2", "member"],
    ["clerk_f_org", "f_org", "member"],
    ["clerk_f_out", "f_out", "member"],
  ]) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES (?, ?, ?, ?)")
      .run(c, u, `${u}@t.dev`, role);
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags)
       VALUES (?, 'Form API', 'Hack Inova', '2099-05-01', 'online', 'https://x.dev', '[]')`,
    )
    .run(ED);
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM edition_questions WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM consents WHERE hackathonId = ?").run(ED);
  await db.prepare("UPDATE hackathons SET capacity = NULL WHERE id = ?").run(ED);
  await db
    .prepare("INSERT OR IGNORE INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')")
    .run(ED, await idOf("clerk_f_org"));
});

describe("POST /api/hackathons/[id]/register — formulário", () => {
  it("anon → 401 JSON", async () => {
    asUser(null);
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(req("POST", { consent: true }), ctx);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("sem consentimento → 400 consent_required", async () => {
    asUser("clerk_f_usr");
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(req("POST", {}), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("consent_required");
    expect(await getRegistrationStatus(await idOf("clerk_f_usr"), ED)).toBeNull();
  });

  it("obrigatória vazia → 400 e nada gravado", async () => {
    asUser("clerk_f_usr");
    const q = await createQuestion(ED, { kind: "short_text", label: "Curso", required: true });
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(req("POST", { consent: true, answers: { [q.id]: "" } }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.questionId).toBe(q.id);
    expect(await getRegistrationStatus(await idOf("clerk_f_usr"), ED)).toBeNull();
  });

  it("respostas válidas → 200 approved, grava IP do x-forwarded-for", async () => {
    asUser("clerk_f_usr");
    const q = await createQuestion(ED, { kind: "single", label: "Camiseta", required: true, options: ["P", "M"] });
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(
      req("POST", { consent: true, answers: { [q.id]: "M" } }, { "x-forwarded-for": "177.10.0.1, 10.0.0.1" }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("approved");
    const c = await db
      .prepare("SELECT ip FROM consents WHERE memberId = ? AND hackathonId = ?")
      .get<{ ip: string }>(await idOf("clerk_f_usr"), ED);
    expect(c?.ip).toBe("177.10.0.1");
  });

  it("edição cheia → 201 waitlist com posição; DELETE do aprovado promove", async () => {
    await setEditionCapacity(ED, 1);
    const { POST, DELETE } = await import("@/app/api/hackathons/[id]/register/route");
    asUser("clerk_f_usr");
    expect((await POST(req("POST", { consent: true }), ctx)).status).toBe(200);
    asUser("clerk_f_usr2");
    const res = await POST(req("POST", { consent: true }), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ registered: false, status: "waitlist", position: 1 });
    asUser("clerk_f_usr");
    const del = await DELETE(req("DELETE"), ctx);
    expect((await del.json()).promoted).toBe(1);
    expect(await getRegistrationStatus(await idOf("clerk_f_usr2"), ED)).toBe("approved");
  });
});

describe("admin do formulário — /api/admin/hackathons/[id]/questions", () => {
  it("anon 401, membro sem papel 403, organizador cria/edita/arquiva", async () => {
    const { GET, POST } = await import("@/app/api/admin/hackathons/[id]/questions/route");
    const item = await import("@/app/api/admin/hackathons/[id]/questions/[questionId]/route");

    asUser(null);
    expect((await POST(req("POST", { kind: "short_text", label: "x" }), ctx)).status).toBe(401);
    asUser("clerk_f_out");
    expect((await POST(req("POST", { kind: "short_text", label: "x" }), ctx)).status).toBe(403);

    asUser("clerk_f_org");
    const bad = await POST(req("POST", { kind: "single", label: "T", options: [] }), ctx);
    expect(bad.status).toBe(400);
    const created = await POST(req("POST", { kind: "short_text", label: "Curso", required: true }), ctx);
    expect(created.status).toBe(201);
    const { question } = await created.json();

    const qctx = { params: Promise.resolve({ id: ED, questionId: String(question.id) }) };
    const patched = await item.PATCH(req("PATCH", { label: "Curso atual" }), qctx);
    expect(patched.status).toBe(200);
    expect((await patched.json()).question.label).toBe("Curso atual");
    expect((await item.PATCH(req("PATCH", { archived: true }), qctx)).status).toBe(200);

    const list = await (await GET(req("GET"), ctx)).json();
    expect(list.questions[0].archived).toBe(true);
  });

  it("capacidade: organizador define; valor inválido → 400", async () => {
    const { PUT } = await import("@/app/api/admin/hackathons/[id]/capacity/route");
    asUser("clerk_f_out");
    expect((await PUT(req("PUT", { capacity: 10 }), ctx)).status).toBe(403);
    asUser("clerk_f_org");
    expect((await PUT(req("PUT", { capacity: -1 }), ctx)).status).toBe(400);
    expect((await PUT(req("PUT", { capacity: "dez" }), ctx)).status).toBe(400);
    const ok = await PUT(req("PUT", { capacity: 10 }), ctx);
    expect(ok.status).toBe(200);
    expect((await ok.json()).capacity).toBe(10);
    expect((await (await PUT(req("PUT", { capacity: null }), ctx)).json()).capacity).toBeNull();
  });

  it("CSV de inscritos: organizador baixa com uma coluna por pergunta", async () => {
    const q = await createQuestion(ED, { kind: "short_text", label: "Universidade" });
    asUser("clerk_f_usr");
    const reg = await import("@/app/api/hackathons/[id]/register/route");
    await reg.POST(req("POST", { consent: true, answers: { [q.id]: "Anhembi" } }), ctx);

    const { GET } = await import("@/app/api/admin/hackathons/[id]/registrations/route");
    asUser("clerk_f_out");
    expect((await GET(new Request("http://t/x?format=csv"), ctx)).status).toBe(403);
    asUser("clerk_f_org");
    const res = await GET(new Request("http://t/x?format=csv"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text.split("\n")[0]).toContain("Universidade");
    expect(text).toContain("Anhembi");
  });
});
