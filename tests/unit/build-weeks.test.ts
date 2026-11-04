import { describe, expect, it } from "vitest";
import { FORGIVE_PER_MONTH, parseDbDate, summarizeWeeks, weekIndex, weekKey, weeksFromDates } from "@/lib/buildWeeks";

// Semanas construindo (spec 046, onda 3, migration 044). Contador
// CUMPLATIVO que nunca zera, com folga de 2 semanas vazias por mês corrido na
// sequência. Semana é ISO no horário de Brasília (segunda 00:00 BRT).

const now = new Date("2026-10-28T12:00:00Z"); // quarta, 09:00 em Brasília
const W0 = weekIndex(now); // semana de 26/10/2026
/** semana `k` semanas antes da semana de agora */
const w = (k: number) => W0 - k;

describe("chave da semana", () => {
  it("segunda a domingo caem na mesma semana, na parede de Brasília", () => {
    expect(weekIndex(new Date("2026-10-26T12:00:00Z"))).toBe(weekIndex(new Date("2026-11-01T12:00:00Z")));
    // domingo 23:00 BRT ainda é a semana que começou na segunda anterior
    expect(weekIndex(new Date("2026-11-02T02:00:00Z"))).toBe(weekIndex(new Date("2026-10-26T12:00:00Z")));
    expect(weekIndex(new Date("2026-11-02T12:00:00Z"))).not.toBe(weekIndex(new Date("2026-10-26T12:00:00Z")));
  });

  it("weekKey é a semana ISO do resumo semanal", () => {
    expect(weekKey(new Date("2026-10-28T12:00:00Z"))).toBe("2026-W44");
    expect(weekKey(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01");
  });

  it("parseDbDate entende o TEXT do schema e ISO", () => {
    expect(parseDbDate("2026-10-28 12:00:00")?.toISOString()).toBe("2026-10-28T12:00:00.000Z");
    expect(parseDbDate("2026-10-28T12:00:00Z")?.toISOString()).toBe("2026-10-28T12:00:00.000Z");
    expect(parseDbDate("lixo")).toBeNull();
  });
});

describe("weeksFromDates", () => {
  it("deduplica a mesma semana e ordena", () => {
    const weeks = weeksFromDates(["2026-10-27 10:00:00", "2026-10-26 09:00:00", "2026-10-13 10:00:00", null, "", "lixo"]);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toBeLessThan(weeks[1]);
  });
});

describe("summarizeWeeks", () => {
  it("sem nada construído o contador é zero", () => {
    expect(summarizeWeeks([], now)).toEqual({ total: 0, sequencia: 0 });
  });

  it("semanas seguidas: total e sequência andam juntos", () => {
    expect(summarizeWeeks([w(3), w(2), w(1), w(0)], now)).toEqual({ total: 4, sequencia: 4 });
  });

  it("a semana em curso vazia não quebra a sequência (ela ainda não acabou)", () => {
    expect(summarizeWeeks([w(3), w(2), w(1)], now)).toEqual({ total: 3, sequencia: 3 });
  });

  it("uma semana vazia no meio é perdoada", () => {
    expect(summarizeWeeks([w(4), w(2), w(0)], now)).toEqual({ total: 3, sequencia: 3 });
  });

  it("duas semanas vazias seguidas ainda entram na folga", () => {
    expect(summarizeWeeks([w(3), w(0)], now)).toEqual({ total: 2, sequencia: 2 });
  });

  it("acima da folga do mês a sequência para, mas o total fica", () => {
    // outubro tem 4 semanas vazias entre a de agora e a de 28/09
    const r = summarizeWeeks([w(5)], now);
    expect(r.total).toBe(1);
    expect(r.sequencia).toBe(0);
  });

  it(`a folga é de ${FORGIVE_PER_MONTH} semanas vazias por mês corrido: dois meses somam`, () => {
    // novembro perdoa a semana de agora, outubro perdoa duas: 3 vazias no total
    const novembro = new Date("2026-11-03T12:00:00Z");
    const N0 = weekIndex(novembro);
    expect(summarizeWeeks([N0 - 1, N0 - 4], novembro)).toEqual({ total: 2, sequencia: 2 });
    // a mesma distância sem a atividade do meio: outubro estoura a folga
    expect(summarizeWeeks([N0 - 4], novembro)).toEqual({ total: 1, sequencia: 0 });
  });

  it("contador cumulativo: somar uma semana antiga só aumenta o total", () => {
    const base = [w(2), w(1), w(0)];
    const antes = summarizeWeeks(base, now);
    const depois = summarizeWeeks([...base, w(12)], now);
    expect(depois.total).toBe(antes.total + 1);
    expect(depois.sequencia).toBe(antes.sequencia);
  });

  it("uma semana só (o próprio evento) é total 1 e sequência 1", () => {
    expect(summarizeWeeks([w(0)], now)).toEqual({ total: 1, sequencia: 1 });
  });
});
