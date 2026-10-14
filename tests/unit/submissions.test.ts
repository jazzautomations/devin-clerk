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

const comunidadeCount = async () =>
  (
    await db
      .prepare("SELECT COUNT(*) n FROM hackathons WHERE source = 'comunidade'")
      .get() as { n: number }
  ).n;

beforeEach(async () => {
  await db.prepare("DELETE FROM event_submissions").run();
  await db.prepare("DELETE FROM hackathons WHERE source = 'comunidade'").run();
});

describe("createSubmission — validação", () => {
  it("cria com defaults: format online, opcionais null, status pending", async () => {
    const { submission, created } = await createSubmission({
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

  it("guarda opcionais válidos (startsAt, location, format, note)", async () => {
    const { submission } = await createSubmission({
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

  it("name obrigatório — vazio/branco/ausente lança erro", async () => {
    for (const name of ["", "   "]) {
      await expect(createSubmission({ name, url: "https://a.dev" }),
      ).rejects.toThrow();
    }
    await expect(createSubmission({ name: undefined as never, url: "https://a.dev" }),
    ).rejects.toThrow();
  });

  it("url obrigatória e só http(s) — malformada/javascript:/ftp lança", async () => {
    for (const url of [
      "",
      "   ",
      "sem-scheme.dev",
      "javascript:alert(1)",
      "ftp://files.dev/x",
      "https://",
    ]) {
      await expect(createSubmission({ name: "X", url }),
      ).rejects.toThrow();
    }
    await expect(createSubmission({ name: "X", url: undefined as never }),
    ).rejects.toThrow();
    // http também vale (spec: http(s))
    const { created } = await createSubmission({
      name: "Legado",
      url: "http://old.dev/hack",
    });
    expect(created).toBe(true);
  });

  it("format fora da whitelist lança erro", async () => {
    await expect(createSubmission({
        name: "X",
        url: "https://a.dev",
        format: "remoto" as never,
      }),
    ).rejects.toThrow();
  });

  it("startsAt malformado lança; campo não-string em opcionais lança", async () => {
    await expect(createSubmission({
        name: "X",
        url: "https://a.dev",
        startsAt: "em março talvez",
      }),
    ).rejects.toThrow();
    await expect(createSubmission({
        name: "X",
        url: "https://a.dev",
        location: 42 as never,
      }),
    ).rejects.toThrow();
  });
});

describe("createSubmission — dedupe por url na janela de 24h", () => {
  it("mesma url (case-insensitive) dentro da janela retorna existente", async () => {
    const first = await createSubmission({
      name: "Hack A",
      url: "https://Evento.dev/Hack",
    });
    const second = await createSubmission({
      name: "Outro nome",
      url: "https://evento.dev/hack",
      format: "presencial",
    });
    expect(second.created).toBe(false);
    expect(second.submission.id).toBe(first.submission.id);
    expect(await listPendingSubmissions()).toHaveLength(1);
  });

  it("fora da janela (createdAt mais antigo que 24h) cria indicação nova", async () => {
    const first = await createSubmission({
      name: "Hack A",
      url: "https://a.dev/hack",
    });
    const stale = new Date(
      Date.now() - SUBMISSION_DEDUPE_MS - 1000,
    ).toISOString();
    await db.prepare("UPDATE event_submissions SET createdAt = ? WHERE id = ?").run(
      stale,
      first.submission.id,
    );
    const { created, submission } = await createSubmission({
      name: "Hack A",
      url: "https://a.dev/hack",
    });
    expect(created).toBe(true);
    expect(submission.id).not.toBe(first.submission.id);
  });
});

describe("listPendingSubmissions — fila de curadoria", () => {
  it("lista só pending, mais antiga primeiro (FIFO)", async () => {
    await createSubmission({ name: "A", url: "https://a.dev" });
    const b = await createSubmission({ name: "B", url: "https://b.dev" });
    await createSubmission({ name: "C", url: "https://c.dev" });
    await reviewSubmission(b.submission.id, "reject");
    const list = await listPendingSubmissions();
    expect(list.map((s) => s.name)).toEqual(["A", "C"]);
  });

  it("fila vazia retorna []", async () => {
    expect(await listPendingSubmissions()).toEqual([]);
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
  const seed = async (over: Record<string, unknown> = {}) =>
    (await createSubmission({
      name: "Hackathon Comunitário",
      url: "https://comunidade.dev/hack",
      startsAt: "2027-05-10",
      format: "hibrido",
      location: "Recife, PE",
      ...over,
    })).submission;

  it("reject marca rejected + reviewedAt e NÃO cria hackathon", async () => {
    const s = await seed();
    const res = await reviewSubmission(s.id, "reject");
    expect(res?.submission.status).toBe("rejected");
    expect(res?.submission.reviewedAt).not.toBeNull();
    expect(res?.hackathon).toBeUndefined();
    expect(await comunidadeCount()).toBe(0);
    expect(await listPendingSubmissions()).toHaveLength(0);
  });

  it("approve cria hackathon (id slug nome+ano, source/organizer comunidade) e marca approved", async () => {
    const s = await seed();
    const res = await reviewSubmission(s.id, "approve");
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
    const row = await db
      .prepare("SELECT source FROM hackathons WHERE id = ?")
      .get("hackathon-comunitario-2027") as { source: string };
    expect(row.source).toBe("comunidade");
    expect(await comunidadeCount()).toBe(1);
  });

  it("approve usa 'org: Nome' da nota como organizer", async () => {
    const s = await seed({ note: "vi no meetup. org: PUC Campinas" });
    const res = await reviewSubmission(s.id, "approve");
    expect(res?.hackathon?.organizer).toBe("PUC Campinas");
  });

  it("approve sem startsAt nasce com data sentinela e slug sem ano", async () => {
    const s = await seed({ name: "Hack Sem Data", startsAt: undefined });
    const res = await reviewSubmission(s.id, "approve");
    expect(res?.hackathon?.id).toBe("hack-sem-data");
    expect(res?.hackathon?.startsAt).toBe("2099-12-31T00:00:00.000Z");
  });

  it("conflito de slug ganha sufixo numérico", async () => {
    const a = await seed();
    const b = await seed({ url: "https://outro.dev/mesmo-nome" });
    const ra = await reviewSubmission(a.id, "approve");
    const rb = await reviewSubmission(b.id, "approve");
    expect(ra?.hackathon?.id).toBe("hackathon-comunitario-2027");
    expect(rb?.hackathon?.id).toBe("hackathon-comunitario-2027-2");
    expect(await comunidadeCount()).toBe(2);
  });

  it("id inexistente retorna null (rota → 404)", async () => {
    expect(await reviewSubmission(99999, "approve")).toBeNull();
    expect(await reviewSubmission(99999, "reject")).toBeNull();
  });

  it("re-revisão é no-op idempotente — não duplica hackathon", async () => {
    const s = await seed();
    await reviewSubmission(s.id, "approve");
    const again = await reviewSubmission(s.id, "approve");
    expect(again?.submission.status).toBe("approved");
    expect(await comunidadeCount()).toBe(1);
    const rejectAfter = await reviewSubmission(s.id, "reject");
    expect(rejectAfter?.submission.status).toBe("approved"); // terminal
  });
});

describe("getSubmission", () => {
  it("retorna a linha ou null", async () => {
    const { submission } = await createSubmission({
      name: "X",
      url: "https://x.dev",
    });
    expect((await getSubmission(submission.id))?.name).toBe("X");
    expect(await getSubmission(424242)).toBeNull();
  });
});
