import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import "@/lib/submissions"; // schema próprio: event_submissions no :memory:

// Spec 026 — POST /api/submissions é PÚBLICO (indicar não exige login);
// GET /api/submissions e POST /api/admin/submissions/[id] são admin-only.
// Este arquivo roda com auth() mockado como admin — o POST público não
// olha auth mesmo, então cobre o fluxo inteiro aqui.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_admin" })),
  currentUser: vi.fn(async () => null),
}));

beforeEach(() => {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_admin','admin_sub','a@t.dev','admin')",
  ).run();
  db.prepare("DELETE FROM event_submissions").run();
  db.prepare("DELETE FROM hackathons WHERE source = 'comunidade'").run();
});

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const countSubs = () =>
  (db.prepare("SELECT COUNT(*) n FROM event_submissions").get() as {
    n: number;
  }).n;

async function seedViaApi(over: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/submissions/route");
  const res = await POST(
    req("POST", {
      name: "Hack Indicado",
      url: `https://indicado-${Date.now()}-${Math.random()}.dev`,
      ...over,
    }),
  );
  return res;
}

describe("POST /api/submissions — porta pública", () => {
  it("indicação válida → 201 com submission pending", async () => {
    const res = await seedViaApi({
      startsAt: "2027-06-01",
      format: "presencial",
      location: "Curitiba, PR",
      note: "org: Uni X",
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.submission.status).toBe("pending");
    expect(data.submission.format).toBe("presencial");
    expect(data.submission.note).toBe("org: Uni X");
    expect(countSubs()).toBe(1);
  });

  it("400 sem name/url, url não-http(s), format inválido, sem body", async () => {
    const { POST } = await import("@/app/api/submissions/route");
    const base = { name: "Hack", url: "https://ok.dev" };
    expect((await POST(req("POST", { ...base, name: "" }))).status).toBe(400);
    expect((await POST(req("POST", { ...base, url: "" }))).status).toBe(400);
    expect(
      (await POST(req("POST", { ...base, url: "javascript:x()" }))).status,
    ).toBe(400);
    expect(
      (await POST(req("POST", { ...base, format: "remoto" }))).status,
    ).toBe(400);
    expect((await POST(req("POST"))).status).toBe(400);
    expect(countSubs()).toBe(0);
  });

  it("honeypot `company` preenchido → 201 silencioso sem gravar", async () => {
    const { POST } = await import("@/app/api/submissions/route");
    const res = await POST(
      req("POST", {
        name: "Bot Hack",
        url: "https://spam.dev/hack",
        company: "Spam Farm Inc",
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).ok).toBe(true);
    expect(countSubs()).toBe(0);
  });

  it("mesma url em <24h → 200 idempotente sem duplicar", async () => {
    const { POST } = await import("@/app/api/submissions/route");
    const body = { name: "Hack Dup", url: "https://dup.dev/hack" };
    expect((await POST(req("POST", body))).status).toBe(201);
    const second = await POST(req("POST", { ...body, name: "Nome Diverso" }));
    expect(second.status).toBe(200);
    expect((await second.json()).deduped).toBe(true);
    expect(countSubs()).toBe(1);
  });
});

describe("GET /api/submissions — fila admin", () => {
  it("admin recebe 200 com as pendentes", async () => {
    await seedViaApi({ name: "Pendente A" });
    await seedViaApi({ name: "Pendente B" });
    const { GET } = await import("@/app/api/submissions/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.submissions).toHaveLength(2);
    expect(data.submissions[0].status).toBe("pending");
  });
});

describe("POST /api/admin/submissions/[id] — curadoria", () => {
  it("approve → 200, hackathon source='comunidade' criado e submission approved", async () => {
    const created = await (await seedViaApi({ startsAt: "2027-06-01" })).json();
    const { POST } = await import("@/app/api/admin/submissions/[id]/route");
    const res = await POST(
      req("POST", { action: "approve" }),
      params(String(created.submission.id)),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.submission.status).toBe("approved");
    expect(data.hackathon.id).toBe("hack-indicado-2027");
    expect(data.hackathon.active).toBe(true);
    const row = db
      .prepare("SELECT source, organizer FROM hackathons WHERE id = ?")
      .get("hack-indicado-2027") as { source: string; organizer: string };
    expect(row.source).toBe("comunidade");
    expect(row.organizer).toBe("comunidade");
    // e sai da fila
    const { GET } = await import("@/app/api/submissions/route");
    const list = await (await GET()).json();
    expect(list.submissions).toHaveLength(0);
  });

  it("reject → 200, submission rejected, nenhum hackathon", async () => {
    const created = await (await seedViaApi()).json();
    const { POST } = await import("@/app/api/admin/submissions/[id]/route");
    const res = await POST(
      req("POST", { action: "reject" }),
      params(String(created.submission.id)),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).submission.status).toBe("rejected");
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM hackathons WHERE source = 'comunidade'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
  });

  it("404 id inexistente; 400 action inválida/ausente", async () => {
    const created = await (await seedViaApi()).json();
    const { POST } = await import("@/app/api/admin/submissions/[id]/route");
    expect(
      (await POST(req("POST", { action: "approve" }), params("99999"))).status,
    ).toBe(404);
    expect(
      (
        await POST(
          req("POST", { action: "publicar" }),
          params(String(created.submission.id)),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(req("POST", {}), params(String(created.submission.id))))
        .status,
    ).toBe(400);
    expect(
      (await POST(req("POST"), params(String(created.submission.id)))).status,
    ).toBe(400);
  });
});
