import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEKS,
  brtWeekday,
  dayLabel,
  periodEnd,
  periodLabel,
  phaseOf,
  weekOfPost,
  weekWindow,
  weekWindows,
} from "@/lib/followThrough";

// Janelas das 4 semanas depois (spec 046, onda 5, migration 052). Tudo puro:
// semana 1 começa em startsAt e cada semana dura 7 dias exatos (o Brasil não
// tem mais horário de verão desde 2019, então a hora de parede em Brasília se
// repete). Post fora da janela não conta.

const DAY = 86_400_000;
/** segunda 09:00 em Brasília */
const T0 = new Date("2026-11-02T12:00:00Z");

describe("janelas", () => {
  it("a semana 1 começa no início do período e cada uma dura 7 dias", () => {
    expect(weekWindow(T0, 1)).toEqual({ week: 1, from: T0, to: new Date("2026-11-09T12:00:00Z") });
    expect(weekWindow(T0, 4).from).toEqual(new Date("2026-11-23T12:00:00Z"));
    expect(weekWindows(T0, 4).map((w) => w.week)).toEqual([1, 2, 3, 4]);
    expect(periodEnd(T0, 4)).toEqual(new Date("2026-11-30T12:00:00Z"));
  });

  it("o padrão são 4 semanas", () => {
    expect(DEFAULT_WEEKS).toBe(4);
  });

  it("weekOfPost acha a semana e devolve null fora do período", () => {
    expect(weekOfPost(T0, 4, new Date(T0.getTime() - 1))).toBeNull();
    expect(weekOfPost(T0, 4, T0)).toBe(1);
    expect(weekOfPost(T0, 4, new Date(T0.getTime() + 7 * DAY - 1))).toBe(1);
    expect(weekOfPost(T0, 4, new Date(T0.getTime() + 7 * DAY))).toBe(2);
    expect(weekOfPost(T0, 4, new Date(T0.getTime() + 28 * DAY - 1))).toBe(4);
    expect(weekOfPost(T0, 4, new Date(T0.getTime() + 28 * DAY))).toBeNull();
  });

  it("a virada da semana é a mesma hora de parede em Brasília, não a meia-noite", () => {
    // o período começa segunda 09:00 BRT (12:00 UTC): a semana 4 começa às
    // 09:00 BRT de 23/11, ou seja, 12:00 UTC
    expect(weekOfPost(T0, 4, new Date("2026-11-23T11:59:00Z"))).toBe(3);
    expect(weekOfPost(T0, 4, new Date("2026-11-23T12:00:00Z"))).toBe(4);
  });

  it("fase: antes, durante e depois", () => {
    const ft = { startsAt: "2026-11-02 12:00:00", weeks: 4 };
    expect(phaseOf(ft, new Date("2026-11-01T12:00:00Z"))).toBe("antes");
    expect(phaseOf(ft, T0)).toBe("durante");
    expect(phaseOf(ft, new Date("2026-11-29T12:00:00Z"))).toBe("durante");
    expect(phaseOf(ft, new Date("2026-11-30T12:00:00Z"))).toBe("depois");
  });

  it("o lembrete é de quinta no horário de Brasília", () => {
    expect(brtWeekday(new Date("2026-11-05T12:00:00Z"))).toBe(4);
    // quinta 00:30 UTC ainda é quarta em Brasília
    expect(brtWeekday(new Date("2026-11-05T00:30:00Z"))).toBe(3);
    // sexta 00:30 UTC é quinta em Brasília
    expect(brtWeekday(new Date("2026-11-06T00:30:00Z"))).toBe(4);
  });

  it("rótulos em dia/mês de Brasília", () => {
    expect(dayLabel(T0)).toBe("02/11");
    expect(periodLabel(T0, 4)).toBe("02/11 a 29/11");
  });
});
