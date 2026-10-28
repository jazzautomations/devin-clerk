import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isoWeekBrt } from "@/lib/digest";

// O resumo conta com execuções seguintes na mesma semana pra tentar de novo
// 'falhou' (429/5xx/rede) e 'enviando' largado há mais de 1h. Este teste
// segura o crontab: mais de uma execução por ambiente, a última pelo menos
// 2h depois da primeira e todas na mesma semana ISO de Brasília.

const lines = readFileSync(join(process.cwd(), "deploy/crontab.txt"), "utf8")
  .split("\n")
  .filter((l) => !l.startsWith("#") && l.includes("digest.sh"));

function hoursOf(env: "prod" | "stage") {
  const line = lines.find((l) => l.includes(`digest.sh ${env} `));
  expect(line, `linha do digest ${env}`).toBeTruthy();
  const [min, hour, dom, mon, dow] = line!.trim().split(/\s+/);
  expect([dom, mon, dow]).toEqual(["*", "*", "1"]);
  expect(min).toMatch(/^\d+$/);
  const m = /^(\d+)-(\d+)$/.exec(hour);
  const hours = m
    ? Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i)
    : hour.split(",").map(Number);
  return { min: Number(min), hours };
}

describe("crontab do resumo semanal", () => {
  for (const env of ["prod", "stage"] as const) {
    it(`${env}: tenta de novo na mesma segunda, dentro da semana`, () => {
      const { min, hours } = hoursOf(env);
      expect(hours.length).toBeGreaterThanOrEqual(3);
      // 'enviando' só é retomado depois de 1h: precisa de execução >= 2h depois
      expect(Math.max(...hours) - Math.min(...hours)).toBeGreaterThanOrEqual(2);
      const first = new Date(Date.UTC(2031, 2, 10, Math.min(...hours), min)); // segunda
      const last = new Date(Date.UTC(2031, 2, 10, Math.max(...hours), min));
      expect(first.getUTCDay()).toBe(1);
      expect(isoWeekBrt(last)).toBe(isoWeekBrt(first));
    });
  }
});
