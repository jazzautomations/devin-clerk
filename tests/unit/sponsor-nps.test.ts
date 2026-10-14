import { describe, expect, it } from "vitest";
import { computeNps, editionEnd, npsPhase, npsWindow, pickRole, summarize, validateNpsAnswer, NpsError } from "@/lib/nps";
import { kAnonymize, sponsorReportCsv, type SponsorReport } from "@/lib/sponsorReport";

// Frente O (migration 017) — partes puras: anonimato do agregado, NPS,
// janela da pesquisa e CSV do relatório.

describe("kAnonymize — faixa pequena vira 'outros'", () => {
  it("funde quem tem menos de 3 e ordena por contagem", () => {
    const out = kAnonymize(
      new Map([
        ["USP", 5],
        ["Unicamp", 3],
        ["Faculdade X", 1],
        ["Faculdade Y", 2],
      ]),
    );
    expect(out).toEqual([
      { label: "USP", n: 5 },
      { label: "Unicamp", n: 3 },
      { label: "outros", n: 3 },
    ]);
  });

  it("corta no top e manda o resto pra 'outros'; vazio fica vazio", () => {
    const m = new Map(Array.from({ length: 5 }, (_, i) => [`t${i}`, 10 - i] as [string, number]));
    expect(kAnonymize(m, 1, 2)).toEqual([
      { label: "t0", n: 10 },
      { label: "t1", n: 9 },
      { label: "outros", n: 8 + 7 + 6 },
    ]);
    expect(kAnonymize(new Map())).toEqual([]);
  });
});

describe("computeNps", () => {
  it("promotores 9–10, neutros 7–8, detratores 0–6", () => {
    const s = computeNps([10, 9, 8, 7, 6, 0, 10]);
    expect(s).toMatchObject({ responses: 7, promoters: 3, passives: 2, detractors: 2 });
    expect(s.nps).toBe(Math.round(((3 - 2) / 7) * 100));
    expect(s.dist[10]).toBe(2);
    expect(s.dist[0]).toBe(1);
  });

  it("sem resposta = nps null", () => {
    expect(computeNps([]).nps).toBeNull();
    expect(computeNps([10, 10]).nps).toBe(100);
    expect(computeNps([0, 3]).nps).toBe(-100);
  });
});

describe("summarize — painel anônimo", () => {
  const row = (role: "participante" | "jurado", score: number, worked: string | null = null) => ({
    role,
    score,
    worked,
    improve: null,
  });

  it("papel com menos de 3 respostas esconde a nota e tira o rótulo do comentário", () => {
    const s = summarize(
      [row("participante", 10, "b"), row("participante", 9, "a"), row("participante", 3), row("jurado", 2, "rubrica confusa")],
      { participante: 10, jurado: 2 },
    );
    const part = s.byRole.find((r) => r.role === "participante")!;
    const jur = s.byRole.find((r) => r.role === "jurado")!;
    expect(part.stats?.responses).toBe(3);
    expect(part.invited).toBe(10);
    expect(jur.stats).toBeNull();
    expect(jur.responses).toBe(1);
    expect(s.overall.responses).toBe(4);
    const juryComment = s.comments.find((c) => c.worked === "rubrica confusa")!;
    expect(juryComment.role).toBeNull();
    // nada que identifique: só papel, nota e texto
    for (const c of s.comments) expect(Object.keys(c).sort()).toEqual(["improve", "role", "score", "worked"]);
    // ordem por papel → nota → texto, nunca por chegada
    expect(s.comments.map((c) => c.worked)).toEqual(["a", "b", "rubrica confusa"]);
  });
});

describe("janela da pesquisa", () => {
  it("abre no fim da edição e fecha 7 dias depois por padrão", () => {
    const w = npsWindow({ startsAt: "2026-10-10 12:00:00", endsAt: "2026-10-11 21:00:00", npsClosesAt: null });
    expect(w.opensAt?.toISOString()).toBe("2026-10-11T21:00:00.000Z");
    expect(w.closesAt?.toISOString()).toBe("2026-10-18T21:00:00.000Z");
    expect(w.custom).toBe(false);
    expect(npsPhase(w, new Date("2026-10-11T20:00:00Z"))).toBe("antes");
    expect(npsPhase(w, new Date("2026-10-12T00:00:00Z"))).toBe("aberta");
    expect(npsPhase(w, new Date("2026-10-19T00:00:00Z"))).toBe("encerrada");
  });

  it("prazo do organizador vale; data sem hora = fim do dia em Brasília", () => {
    const w = npsWindow({ startsAt: "2026-10-10", endsAt: null, npsClosesAt: "2026-10-12 12:00:00" });
    expect(w.custom).toBe(true);
    expect(w.closesAt?.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(editionEnd({ startsAt: "2026-10-10", endsAt: null })?.toISOString()).toBe("2026-10-11T03:00:00.000Z");
  });
});

describe("pickRole e validação da resposta", () => {
  it("o papel mais de dentro ganha; organizador não é papel do NPS", () => {
    expect(pickRole(["participante", "mentor"])).toBe("mentor");
    expect(pickRole(["patrocinador", "staff"])).toBe("staff");
    expect(pickRole([])).toBeNull();
  });

  it("nota inteira 0–10, textos opcionais com limite", () => {
    expect(validateNpsAnswer({ score: 0 })).toEqual({ score: 0, worked: null, improve: null });
    expect(validateNpsAnswer({ score: 10, worked: "  café  ", improve: "" })).toEqual({
      score: 10,
      worked: "café",
      improve: null,
    });
    for (const bad of [null, [], { score: 11 }, { score: -1 }, { score: 7.5 }, { score: "9" }, { score: 9, worked: 3 }]) {
      expect(() => validateNpsAnswer(bad)).toThrow(NpsError);
    }
    expect(() => validateNpsAnswer({ score: 9, improve: "x".repeat(2001) })).toThrow(/longo/);
  });
});

describe("CSV do relatório", () => {
  it("seções com aspas e defesa contra fórmula; talentos só os do opt-in", () => {
    const r = {
      generatedAt: "2026-10-14T00:00:00.000Z",
      edition: { id: "h", name: "Edição, 1", startsAt: "2026-10-10" },
      sponsor: { hackathonId: "h", sponsorId: "s", name: "=Marca", tier: "master", logoUrl: null, url: null, position: 1 },
      challenges: [{ id: "c", title: "Desafio", prize: "R$ 1 mil" }],
      categories: [],
      funnel: { inscritos: 10, aprovados: 8, confirmados: null, presentes: 5 },
      profile: { base: 8, personas: [{ label: "desenvolvedor", n: 6 }], institutions: [] },
      stack: [{ label: "Next.js", n: 2 }],
      teamsVisible: true,
      teamCount: 1,
      teams: [],
      winners: [],
      votes: { community: 0, live: 0, liveQuorumMet: false },
      jury: { visible: false, avg: null, judgedTeams: 0 },
      nps: { overall: computeNps([10]), byRole: [] },
      talents: [{ name: "Ana", email: "ana@x.dev", linkedin: null, github: null, project: null, sharedAt: "2026-10-12 10:00:00" }],
    } satisfies SponsorReport;
    const csv = sponsorReportCsv(r);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("secao,item,valor,detalhe1,detalhe2,detalhe3,detalhe4");
    expect(csv).toContain('edicao,"Edição, 1"');
    expect(csv).toContain("patrocinador,'=Marca,master");
    expect(csv).toContain("funil,confirmados,RSVP desligado");
    expect(csv).toContain("juri,media_no_desafio,sigiloso até a publicação");
    expect(lines.filter((l) => l.startsWith("talento,"))).toEqual(["talento,Ana,ana@x.dev,,,,2026-10-12 10:00:00"]);
  });
});
