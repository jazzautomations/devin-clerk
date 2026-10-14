import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  createLead,
  LEAD_DEDUPE_MS,
  LEAD_INTERESTS,
  listLeads,
} from "@/lib/leads";

// lib de leads — spec 022. Schema próprio no módulo (pattern deploys/sponsors),
// o import acima já garante a tabela no :memory:.

beforeEach(async () => {
  await db.prepare("DELETE FROM leads").run();
});

describe("createLead — validação", () => {
  it("cria com defaults: message null, createdAt ISO, created=true", async () => {
    const { lead, created } = await createLead({
      company: "Oracle",
      email: "DevRel@Oracle.com",
      interest: "desafio",
    });
    expect(created).toBe(true);
    expect(lead.id).toBeGreaterThan(0);
    expect(lead.company).toBe("Oracle");
    expect(lead.email).toBe("devrel@oracle.com"); // normalizado lowercase
    expect(lead.interest).toBe("desafio");
    expect(lead.message).toBeNull();
    expect(Date.parse(lead.createdAt)).not.toBeNaN();
  });

  it("cria com message e cada interest da whitelist", async () => {
    for (const interest of LEAD_INTERESTS) {
      const { lead } = await createLead({
        company: `Co ${interest}`,
        email: `${interest}@co.dev`,
        interest,
        message: "quero conversar",
      });
      expect(lead.interest).toBe(interest);
      expect(lead.message).toBe("quero conversar");
    }
  });

  it("company obrigatória — vazio/branco/ausente lança erro", async () => {
    for (const company of ["", "   "]) {
      await expect(createLead({ company, email: "a@b.dev", interest: "outro" }),
      ).rejects.toThrow();
    }
    await expect(createLead({
        company: undefined as never,
        email: "a@b.dev",
        interest: "outro",
      }),
    ).rejects.toThrow();
  });

  it("e-mail malformado lança erro", async () => {
    for (const email of ["", "sem-arroba", "a@b", "a b@c.dev", "@x.dev"]) {
      await expect(createLead({ company: "Co", email, interest: "outro" }),
      ).rejects.toThrow();
    }
  });

  it("interest fora da whitelist lança erro", async () => {
    await expect(createLead({
        company: "Co",
        email: "a@b.dev",
        interest: "parceria" as never,
      }),
    ).rejects.toThrow();
  });
});

describe("createLead — dedupe por (empresa, e-mail) na janela", () => {
  it("mesmo e-mail+empresa dentro da janela retorna o existente, sem inserir", async () => {
    const first = await createLead({
      company: "Oracle",
      email: "a@oracle.com",
      interest: "desafio",
    });
    const second = await createLead({
      company: "oracle", // case-insensitive no par
      email: "A@oracle.com",
      interest: "talento", // interesse diferente continua dedupe
    });
    expect(second.created).toBe(false);
    expect(second.lead.id).toBe(first.lead.id);
    expect(await listLeads()).toHaveLength(1);
  });

  it("mesmo e-mail com empresa diferente cria lead novo", async () => {
    await createLead({ company: "Oracle", email: "a@x.dev", interest: "outro" });
    const { created, lead } = await createLead({
      company: "Nubank",
      email: "a@x.dev",
      interest: "outro",
    });
    expect(created).toBe(true);
    expect(await listLeads()).toHaveLength(2);
    expect(lead.company).toBe("Nubank");
  });

  it("fora da janela (createdAt mais antigo que 10min) cria lead novo", async () => {
    const first = await createLead({
      company: "Oracle",
      email: "a@oracle.com",
      interest: "desafio",
    });
    const stale = new Date(Date.now() - LEAD_DEDUPE_MS - 1000).toISOString();
    await db.prepare("UPDATE leads SET createdAt = ? WHERE id = ?").run(
      stale,
      first.lead.id,
    );
    const { created, lead } = await createLead({
      company: "Oracle",
      email: "a@oracle.com",
      interest: "desafio",
    });
    expect(created).toBe(true);
    expect(lead.id).not.toBe(first.lead.id);
    expect(await listLeads()).toHaveLength(2);
  });
});

describe("listLeads", () => {
  it("lista em ordem decrescente de chegada", async () => {
    await createLead({ company: "A", email: "a@a.dev", interest: "outro" });
    await createLead({ company: "B", email: "b@b.dev", interest: "edicao" });
    const list = await listLeads();
    expect(list.map((l) => l.company)).toEqual(["B", "A"]);
  });

  it("banco vazio retorna lista vazia", async () => {
    expect(await listLeads()).toEqual([]);
  });
});

describe("createLead — aviso pros admins (spec 039)", () => {
  it("lead novo notifica cada admin; retry deduplicado não notifica de novo", async () => {
    await db.prepare("DELETE FROM notifications").run();
    await db.prepare("INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_adm_lead', 'adm_lead', 'adm@t.dev', 'admin')").run();
    const input = { company: "Faculdade X", email: "coord@x.edu.br", interest: "organizar" as const, message: "março, 100 pessoas" };
    await createLead(input);
    await createLead(input);
    const rows = await db
      .prepare("SELECT n.text, n.href FROM notifications n JOIN members m ON m.id = n.memberId WHERE m.username = 'adm_lead'")
      .all<{ text: string; href: string }>();
    expect(rows).toEqual([{ text: "Faculdade X quer organizar uma edição", href: "/admin#leads" }]);
  });
});
