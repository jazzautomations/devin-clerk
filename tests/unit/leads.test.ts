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

beforeEach(() => {
  db.prepare("DELETE FROM leads").run();
});

describe("createLead — validação", () => {
  it("cria com defaults: message null, createdAt ISO, created=true", () => {
    const { lead, created } = createLead({
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

  it("cria com message e cada interest da whitelist", () => {
    for (const interest of LEAD_INTERESTS) {
      const { lead } = createLead({
        company: `Co ${interest}`,
        email: `${interest}@co.dev`,
        interest,
        message: "quero conversar",
      });
      expect(lead.interest).toBe(interest);
      expect(lead.message).toBe("quero conversar");
    }
  });

  it("company obrigatória — vazio/branco/ausente lança erro", () => {
    for (const company of ["", "   "]) {
      expect(() =>
        createLead({ company, email: "a@b.dev", interest: "outro" }),
      ).toThrow();
    }
    expect(() =>
      createLead({
        company: undefined as never,
        email: "a@b.dev",
        interest: "outro",
      }),
    ).toThrow();
  });

  it("e-mail malformado lança erro", () => {
    for (const email of ["", "sem-arroba", "a@b", "a b@c.dev", "@x.dev"]) {
      expect(() =>
        createLead({ company: "Co", email, interest: "outro" }),
      ).toThrow();
    }
  });

  it("interest fora da whitelist lança erro", () => {
    expect(() =>
      createLead({
        company: "Co",
        email: "a@b.dev",
        interest: "parceria" as never,
      }),
    ).toThrow();
  });
});

describe("createLead — dedupe por (empresa, e-mail) na janela", () => {
  it("mesmo e-mail+empresa dentro da janela retorna o existente, sem inserir", () => {
    const first = createLead({
      company: "Oracle",
      email: "a@oracle.com",
      interest: "desafio",
    });
    const second = createLead({
      company: "oracle", // case-insensitive no par
      email: "A@oracle.com",
      interest: "talento", // interesse diferente continua dedupe
    });
    expect(second.created).toBe(false);
    expect(second.lead.id).toBe(first.lead.id);
    expect(listLeads()).toHaveLength(1);
  });

  it("mesmo e-mail com empresa diferente cria lead novo", () => {
    createLead({ company: "Oracle", email: "a@x.dev", interest: "outro" });
    const { created, lead } = createLead({
      company: "Nubank",
      email: "a@x.dev",
      interest: "outro",
    });
    expect(created).toBe(true);
    expect(listLeads()).toHaveLength(2);
    expect(lead.company).toBe("Nubank");
  });

  it("fora da janela (createdAt mais antigo que 10min) cria lead novo", () => {
    const first = createLead({
      company: "Oracle",
      email: "a@oracle.com",
      interest: "desafio",
    });
    const stale = new Date(Date.now() - LEAD_DEDUPE_MS - 1000).toISOString();
    db.prepare("UPDATE leads SET createdAt = ? WHERE id = ?").run(
      stale,
      first.lead.id,
    );
    const { created, lead } = createLead({
      company: "Oracle",
      email: "a@oracle.com",
      interest: "desafio",
    });
    expect(created).toBe(true);
    expect(lead.id).not.toBe(first.lead.id);
    expect(listLeads()).toHaveLength(2);
  });
});

describe("listLeads", () => {
  it("lista em ordem decrescente de chegada", () => {
    createLead({ company: "A", email: "a@a.dev", interest: "outro" });
    createLead({ company: "B", email: "b@b.dev", interest: "edicao" });
    const list = listLeads();
    expect(list.map((l) => l.company)).toEqual(["B", "A"]);
  });

  it("banco vazio retorna lista vazia", () => {
    expect(listLeads()).toEqual([]);
  });
});
