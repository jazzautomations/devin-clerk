import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import "@/lib/leads"; // schema próprio: tabela leads no :memory:

// POST /api/leads — spec 022. Rota PÚBLICA (porta comercial, sem auth):
// honeypot `website` → 201 sem gravar; válido → 201; dedupe → 200.

beforeEach(() => {
  db.prepare("DELETE FROM leads").run();
});

const req = (body?: unknown) =>
  new Request("http://t/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const countLeads = () =>
  (db.prepare("SELECT COUNT(*) n FROM leads").get() as { n: number }).n;

describe("POST /api/leads — público", () => {
  it("lead válido → 201 com o lead criado", async () => {
    const { POST } = await import("@/app/api/leads/route");
    const res = await POST(
      req({
        company: "Oracle",
        email: "devrel@oracle.com",
        interest: "desafio",
        message: "quero a jornada do paciente",
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.lead.company).toBe("Oracle");
    expect(data.lead.email).toBe("devrel@oracle.com");
    expect(data.lead.interest).toBe("desafio");
    expect(data.lead.message).toBe("quero a jornada do paciente");
    expect(countLeads()).toBe(1);
  });

  it("400 sem company, e-mail inválido, interest fora da whitelist, sem body", async () => {
    const { POST } = await import("@/app/api/leads/route");
    const base = { company: "Co", email: "a@b.dev", interest: "talento" };
    expect((await POST(req({ ...base, company: "" }))).status).toBe(400);
    expect((await POST(req({ ...base, company: "  " }))).status).toBe(400);
    expect((await POST(req({ ...base, email: "nope" }))).status).toBe(400);
    expect((await POST(req({ ...base, interest: "parceria" }))).status).toBe(
      400,
    );
    expect((await POST(req({ company: "Co" }))).status).toBe(400);
    expect((await POST(req())).status).toBe(400);
    expect(countLeads()).toBe(0);
  });

  it("honeypot `website` preenchido → 201 silencioso sem gravar", async () => {
    const { POST } = await import("@/app/api/leads/route");
    const res = await POST(
      req({
        company: "Bot Farm",
        email: "bot@farm.dev",
        interest: "outro",
        website: "https://spam.dev",
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(countLeads()).toBe(0);
  });

  it("mesmo e-mail+empresa na janela → 200 idempotente, sem duplicar", async () => {
    const { POST } = await import("@/app/api/leads/route");
    const body = { company: "Oracle", email: "a@oracle.com", interest: "edicao" };
    const first = await POST(req(body));
    expect(first.status).toBe(201);
    const second = await POST(req(body));
    expect(second.status).toBe(200);
    const data = await second.json();
    expect(data.lead.company).toBe("Oracle");
    expect(countLeads()).toBe(1);
  });
});
