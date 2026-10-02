import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  createSubmission,
  getSubmission,
  listPendingSubmissions,
  reviewSubmission,
  slugify,
  SUBMISSION_DEDUPE_MS,
} from "@/lib/submissions";

// lib de indicações — spec 026. Schema próprio no módulo (pattern
// leads/deploys/sponsors), o import já garante a tabela no :memory:.

const comunidadeCount = () =>
  (
    db
      .prepare("SELECT COUNT(*) n FROM hackathons WHERE source = 'comunidade'")
      .get() as { n: number }
  ).n;

beforeEach(() => {
  db.prepare("DELETE FROM event_submissions").run();
  db.prepare("DELETE FROM hackathons WHERE source = 'comunidade'").run();
});

describe("createSubmission — validação", () => {
  it("cria com defaults: format online, opcionais null, status pending", () => {
    const { submission, created } = createSubmission({
      name: "Hackathon do Bairro",
      url: "https://evento.dev/hack",
    });
    expect(created).toBe(true);
    expect(submission.id).toBeGreaterThan(0);
    expect(submission.name).toBe("Hackathon do Bairro");
    expect(submission.url).toBe("https://evento.dev/hack");
    expect(submission.format).toBe("online");
    expect(submission.startsAt).toBeNull();
    expect(submission.location).toBeNull();
    expect(submission.note).toBeNull();
    expect(submission.status).toBe("pending");
    expect(submission.reviewedAt).toBeNull();
    expect(Date.parse(submission.createdAt)).not.toBeNaN();
  });

  it("guarda opcionais válidos (startsAt, location, format, note)", () => {
    const { submission } = createSubmission({
      name: "Hack UFABC",
      url: "https://ufabc.dev/hack",
      startsAt: "2027-03-14",
      location: "Santo André, SP",
      format: "presencial",
      note: "org: UTFPR",
    });
    expect(submission.startsAt).toBe("2027-03-14");
    expect(submission.location).toBe("Santo André, SP");
    expect(submission.format).toBe("presencial");
    expect(submission.note).toBe("org: UTFPR");
  });

  it("name obrigatório — vazio/branco/ausente lança erro", () => {
    for (const name of ["", "   "]) {
      expect(() =>
        createSubmission({ name, url: "https://a.dev" }),
      ).toThrow();
    }
    expect(() =>
      createSubmission({ name: undefined as never, url: "https://a.dev" }),
    ).toThrow();
  });

  it("url obrigatória e só http(s) — malformada/javascript:/ftp lança", () => {
    for (const url of [
      "",
      "   ",
      "sem-scheme.dev",
      "javascript:alert(1)",
      "ftp://files.dev/x",
      "https://",
    ]) {
      expect(() =>
        createSubmission({ name: "X", url }),
      ).toThrow();
    }
    expect(() =>
      createSubmission({ name: "X", url: undefined as never }),
    ).toThrow();
    // http também vale (spec: http(s))
    const { created } = createSubmission({
      name: "Legado",
      url: "http://old.dev/hack",
    });
    expect(created).toBe(true);
  });

  it("format fora da whitelist lança erro", () => {
    expect(() =>
      createSubmission({
        name: "X",
        url: "https://a.dev",
        format: "remoto" as never,
      }),
    ).toThrow();
  });

  it("startsAt malformado lança; campo não-string em opcionais lança", () => {
    expect(() =>
      createSubmission({
        name: "X",
        url: "https://a.dev",
        startsAt: "em março talvez",
      }),
    ).toThrow();
    expect(() =>
      createSubmission({
        name: "X",
        url: "https://a.dev",
        location: 42 as never,
      }),
    ).toThrow();
  });
});

describe("createSubmission — dedupe por url na janela de 24h", () => {
  it("mesma url (case-insensitive) dentro da janela retorna existente", () => {
    const first = createSubmission({
      name: "Hack A",
      url: "https://Evento.dev/Hack",
    });
    const second = createSubmission({
      name: "Outro nome",
      url: "https://evento.dev/hack",
      format: "presencial",
    });
    expect(second.created).toBe(false);
    expect(second.submission.id).toBe(first.submission.id);
    expect(listPendingSubmissions()).toHaveLength(1);
  });

  it("fora da janela (createdAt mais antigo que 24h) cria indicação nova", () => {
    const first = createSubmission({
      name: "Hack A",
      url: "https://a.dev/hack",
    });
    const stale = new Date(
      Date.now() - SUBMISSION_DEDUPE_MS - 1000,
    ).toISOString();
    db.prepare("UPDATE event_submissions SET createdAt = ? WHERE id = ?").run(
      stale,
      first.submission.id,
    );
    const { created, submission } = createSubmission({
      name: "Hack A",
      url: "https://a.dev/hack",
    });
    expect(created).toBe(true);
    expect(submission.id).not.toBe(first.submission.id);
  });
});

describe("listPendingSubmissions — fila de curadoria", () => {
  it("lista só pending, mais antiga primeiro (FIFO)", () => {
    createSubmission({ name: "A", url: "https://a.dev" });
    const b = createSubmission({ name: "B", url: "https://b.dev" });
    createSubmission({ name: "C", url: "https://c.dev" });
    reviewSubmission(b.submission.id, "reject");
    const list = listPendingSubmissions();
    expect(list.map((s) => s.name)).toEqual(["A", "C"]);
  });

  it("fila vazia retorna []", () => {
    expect(listPendingSubmissions()).toEqual([]);
  });
});

describe("slugify", () => {
  it("minúsculas, sem diacríticos, não-alfanum vira hífen, corta em 60", () => {
    expect(slugify("Hackathon de IA na Saúde — Édição 2!")).toBe(
      "hackathon-de-ia-na-saude-edicao-2",
    );
    expect(slugify("  ESPAÇOS   múltiplos  ")).toBe("espacos-multiplos");
    expect(slugify("x".repeat(80))).toHaveLength(60);
  });
});

describe("reviewSubmission — curadoria", () => {
  const seed = (over: Record<string, unknown> = {}) =>
    createSubmission({
      name: "Hackathon Comunitário",
      url: "https://comunidade.dev/hack",
      startsAt: "2027-05-10",
      format: "hibrido",
      location: "Recife, PE",
      ...over,
    }).submission;

  it("reject marca rejected + reviewedAt e NÃO cria hackathon", () => {
    const s = seed();
    const res = reviewSubmission(s.id, "reject");
    expect(res?.submission.status).toBe("rejected");
    expect(res?.submission.reviewedAt).not.toBeNull();
    expect(res?.hackathon).toBeUndefined();
    expect(comunidadeCount()).toBe(0);
    expect(listPendingSubmissions()).toHaveLength(0);
  });

  it("approve cria hackathon (id slug nome+ano, source/organizer comunidade) e marca approved", () => {
    const s = seed();
    const res = reviewSubmission(s.id, "approve");
    expect(res?.submission.status).toBe("approved");
    expect(res?.submission.reviewedAt).not.toBeNull();
    const h = res?.hackathon;
    expect(h?.id).toBe("hackathon-comunitario-2027");
    expect(h?.name).toBe("Hackathon Comunitário");
    expect(h?.organizer).toBe("comunidade");
    expect(h?.format).toBe("hibrido");
    expect(h?.location).toBe("Recife, PE");
    expect(h?.registrationUrl).toBe("https://comunidade.dev/hack");
    expect(h?.active).toBe(true);
    // source marca a terceira origem
    const row = db
      .prepare("SELECT source FROM hackathons WHERE id = ?")
      .get("hackathon-comunitario-2027") as { source: string };
    expect(row.source).toBe("comunidade");
    expect(comunidadeCount()).toBe(1);
  });

  it("approve usa 'org: Nome' da nota como organizer", () => {
    const s = seed({ note: "vi no meetup. org: PUC Campinas" });
    const res = reviewSubmission(s.id, "approve");
    expect(res?.hackathon?.organizer).toBe("PUC Campinas");
  });

  it("approve sem startsAt nasce com data sentinela e slug sem ano", () => {
    const s = seed({ name: "Hack Sem Data", startsAt: undefined });
    const res = reviewSubmission(s.id, "approve");
    expect(res?.hackathon?.id).toBe("hack-sem-data");
    expect(res?.hackathon?.startsAt).toBe("2099-12-31T00:00:00.000Z");
  });

  it("conflito de slug ganha sufixo numérico", () => {
    const a = seed();
    const b = seed({ url: "https://outro.dev/mesmo-nome" });
    const ra = reviewSubmission(a.id, "approve");
    const rb = reviewSubmission(b.id, "approve");
    expect(ra?.hackathon?.id).toBe("hackathon-comunitario-2027");
    expect(rb?.hackathon?.id).toBe("hackathon-comunitario-2027-2");
    expect(comunidadeCount()).toBe(2);
  });

  it("id inexistente retorna null (rota → 404)", () => {
    expect(reviewSubmission(99999, "approve")).toBeNull();
    expect(reviewSubmission(99999, "reject")).toBeNull();
  });

  it("re-revisão é no-op idempotente — não duplica hackathon", () => {
    const s = seed();
    reviewSubmission(s.id, "approve");
    const again = reviewSubmission(s.id, "approve");
    expect(again?.submission.status).toBe("approved");
    expect(comunidadeCount()).toBe(1);
    const rejectAfter = reviewSubmission(s.id, "reject");
    expect(rejectAfter?.submission.status).toBe("approved"); // terminal
  });
});

describe("getSubmission", () => {
  it("retorna a linha ou null", () => {
    const { submission } = createSubmission({
      name: "X",
      url: "https://x.dev",
    });
    expect(getSubmission(submission.id)?.name).toBe("X");
    expect(getSubmission(424242)).toBeNull();
  });
});
