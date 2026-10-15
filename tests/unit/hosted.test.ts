import { describe, expect, it } from "vitest";
import { isHostedRow } from "@/lib/hackathons";

// "Roda no HackaHub" (inscrição pela plataforma) × evento externo do radar.
// O nome do organizador não decide mais nada: a Hack Inova é uma comunidade
// como qualquer outra.
describe("isHostedRow", () => {
  it("seed e painel rodam no HackaHub", () => {
    expect(isHostedRow({ source: "seed" })).toBe(true);
    expect(isHostedRow({ source: "painel" })).toBe(true);
  });
  it("fonte do radar, admin (terceiro posto à mão) e sem fonte são externos", () => {
    for (const source of ["devpost", "sympla", "devpost+taikai", "admin", null, undefined]) {
      expect(isHostedRow({ source }), String(source)).toBe(false);
    }
  });
});
