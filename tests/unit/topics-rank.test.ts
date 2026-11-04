import { describe, expect, it } from "vitest";
import { hotScore, parseDbTime, parsePeriod, parseReplySort, parseSort, parseTopicInput, rankHot, timeAgo, TopicError } from "@/lib/topics";

// Ranking "em alta" dos tópicos (migration 058): sinal(score)·log10(max(|score|,1))
// menos 1 ponto a cada 12 horas. Puro, sem banco.

const NOW = new Date("2026-10-28T12:00:00Z");
const ago = (h: number) => {
  const d = new Date(NOW.getTime() - h * 3_600_000);
  return d.toISOString().slice(0, 19).replace("T", " ");
};

describe("hotScore", () => {
  it("score 0 e 1 valem o mesmo; 10 votos valem 1 ponto; negativo afunda", () => {
    expect(hotScore(0, ago(0), NOW)).toBe(0);
    expect(hotScore(1, ago(0), NOW)).toBe(0);
    expect(hotScore(10, ago(0), NOW)).toBeCloseTo(1);
    expect(hotScore(100, ago(0), NOW)).toBeCloseTo(2);
    expect(hotScore(-10, ago(0), NOW)).toBeCloseTo(-1);
  });

  it("perde 1 ponto a cada 12 horas", () => {
    expect(hotScore(0, ago(12), NOW)).toBeCloseTo(-1);
    expect(hotScore(10, ago(24), NOW)).toBeCloseTo(-1);
  });

  it("data no futuro (relógio torto) não ganha bônus", () => {
    expect(hotScore(0, ago(-5), NOW)).toBe(0);
  });

  it("aceita Date e texto do banco", () => {
    expect(hotScore(10, new Date(NOW.getTime() - 12 * 3_600_000), NOW)).toBeCloseTo(0);
    expect(parseDbTime("2026-10-28 12:00:00").toISOString()).toBe("2026-10-28T12:00:00.000Z");
  });
});

describe("rankHot", () => {
  it("novo sem voto passa um de ontem com 10 votos; 100 votos de 6 h passam os dois", () => {
    const items = [
      { id: 1, score: 10, createdAt: ago(30) },
      { id: 2, score: 0, createdAt: ago(1) },
      { id: 3, score: 100, createdAt: ago(6) },
      { id: 4, score: -5, createdAt: ago(1) },
    ];
    expect(rankHot(items, NOW).map((t) => t.id)).toEqual([3, 2, 4, 1]);
  });

  it("empate desempata pelo mais novo e depois pelo id; não muda o array original", () => {
    const items = [
      { id: 1, score: 0, createdAt: ago(2) },
      { id: 2, score: 0, createdAt: ago(2) },
      { id: 3, score: 1, createdAt: ago(1) },
    ];
    const copy = [...items];
    expect(rankHot(items, NOW).map((t) => t.id)).toEqual([3, 2, 1]);
    expect(items).toEqual(copy);
  });
});

describe("parâmetros", () => {
  it("ordem, período e ordem das respostas caem no padrão quando vêm errados", () => {
    expect(parseSort("novos")).toBe("novos");
    expect(parseSort("xxx")).toBe("em-alta");
    expect(parseSort(null)).toBe("em-alta");
    expect(parsePeriod("mes")).toBe("mes");
    expect(parsePeriod("ano")).toBe("semana");
    expect(parseReplySort("novas")).toBe("novas");
    expect(parseReplySort("x")).toBe("melhores");
  });

  it("timeAgo fala em minutos, horas e dias", () => {
    expect(timeAgo(ago(0), NOW)).toBe("agora");
    expect(timeAgo(ago(0.5), NOW)).toBe("há 30 min");
    expect(timeAgo(ago(3), NOW)).toBe("há 3 h");
    expect(timeAgo(ago(50), NOW)).toBe("há 2 d");
    expect(timeAgo(ago(24 * 60), NOW)).toMatch(/2026/);
  });
});

describe("parseTopicInput", () => {
  const err = (raw: unknown) => {
    try {
      parseTopicInput(raw);
    } catch (e) {
      expect(e).toBeInstanceOf(TopicError);
      return (e as TopicError).message;
    }
    return null;
  };

  it("título de 5 a 140, corpo até 10000, flair até 24", () => {
    expect(err({ title: "oi" })).toMatch(/pelo menos 5/);
    expect(err({ title: "x".repeat(141) })).toMatch(/140/);
    expect(err({ title: "título ok", body: "x".repeat(10001) })).toMatch(/10000/);
    expect(err({ title: "título ok", flair: "x".repeat(25) })).toMatch(/24/);
    expect(parseTopicInput({ title: "  título   com  espaço ", flair: "  dúvida " })).toEqual({
      kind: "discussao",
      title: "título com espaço",
      body: "",
      flair: "dúvida",
      options: [],
    });
  });

  it("tipo inválido dá erro; enquete pede 2 a 6 opções sem repetir", () => {
    expect(err({ title: "título ok", kind: "meme" })).toMatch(/Tipo/);
    expect(err({ title: "qual stack?", kind: "enquete", options: ["a"] })).toMatch(/2 a 6/);
    expect(err({ title: "qual stack?", kind: "enquete", options: ["a", "b", "c", "d", "e", "f", "g"] })).toMatch(/2 a 6/);
    expect(err({ title: "qual stack?", kind: "enquete", options: ["Next", "next"] })).toMatch(/repetida/);
    expect(parseTopicInput({ title: "qual stack?", kind: "enquete", options: ["Next", " ", "Remix"] }).options).toEqual(["Next", "Remix"]);
  });
});
