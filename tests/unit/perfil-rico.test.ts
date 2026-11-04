import { describe, expect, it } from "vitest";
import { AREA_KEYS, areaLabel, areasFromJson, isAreaKey, MAX_AREAS, parseAreas } from "@/lib/areas";
import { PERSONAS } from "@/lib/personas";
import {
  PROFILE_NUMBER_LABELS,
  numberLabel,
  type ProfileNumbers,
} from "@/lib/profileFacts";
import {
  RECADOS_FROM,
  RECADO_MAX,
  RECADO_SAME_TEXT_PROFILES,
  cleanRecado,
  isRecadosFrom,
  isRecado,
  recadoClosedText,
} from "@/lib/recados";

// Parte pura do perfil rico (migration 041): as áreas de ajuda são um
// subconjunto de PERSONAS, o zero do perfil é travessão e o recado é texto
// puro de até 280 com três modos de quem escreve.

describe("áreas de ajuda", () => {
  it("toda área existe em PERSONAS — nada de vocabulário paralelo", () => {
    const personas = new Set<string>(PERSONAS.map((p) => p.key));
    for (const k of AREA_KEYS) expect(personas.has(k)).toBe(true);
  });

  it("rótulo de ajuda difere do de identidade só onde precisa", () => {
    expect(areaLabel("empreendedor")).toBe("negócio e pitch");
    expect(areaLabel("dev")).toBe("desenvolvimento");
    expect(areaLabel("investidor")).toBeNull();
    expect(isAreaKey("design")).toBe(true);
    expect(isAreaKey("DESIGN")).toBe(false);
  });

  it("parseAreas aceita até quatro chaves e recusa o resto", () => {
    expect(MAX_AREAS).toBe(4);
    expect(parseAreas([])).toEqual({ value: [] });
    expect(parseAreas(["dados", "dev", "dados"])).toEqual({ value: ["dados", "dev"] });
    expect(parseAreas(["dev", "design", "produto", "dados"])).toEqual({
      value: ["dev", "design", "produto", "dados"],
    });
    expect(parseAreas(["dev", "design", "produto", "dados", "empreendedor"])).toHaveProperty("error");
    expect(parseAreas(["investidor"])).toHaveProperty("error");
    expect(parseAreas(null)).toHaveProperty("error");
  });

  it("areasFromJson não confia no banco", () => {
    expect(areasFromJson('["dev"]')).toEqual(["dev"]);
    expect(areasFromJson('{"dev":true}')).toEqual([]);
    expect(areasFromJson("['dev']")).toEqual([]);
    expect(areasFromJson("")).toEqual([]);
    expect(areasFromJson('["dev","dev","design"]')).toEqual(["dev", "design"]);
  });
});

describe("faixa dos quatro números", () => {
  const numbers: ProfileNumbers = { presenca: 0, entrega: 2, premio: 0, papel: 1 };

  it("zero vira travessão", () => {
    expect(numberLabel(numbers.presenca)).toBe("—");
    expect(numberLabel(numbers.entrega)).toBe("2");
  });

  it("cada número leva pra uma aba que existe no perfil", () => {
    const abas = PROFILE_NUMBER_LABELS.map((n) => n.aba);
    expect(abas).toEqual(["trajetoria", "projetos", "trajetoria", "trajetoria"]);
    expect(PROFILE_NUMBER_LABELS.map((n) => n.key)).toEqual(["presenca", "entrega", "premio", "papel"]);
  });
});

describe("recado", () => {
  it("é texto puro de até 280, sem espaço nas pontas", () => {
    expect(RECADO_MAX).toBe(280);
    expect(cleanRecado("  oi  ")).toBe("oi");
    expect(cleanRecado("linha\n\n\n\noutra")).toBe("linha\n\noutra");
    expect(() => cleanRecado("")).toThrow();
    expect(() => cleanRecado("   ")).toThrow();
    expect(() => cleanRecado(42)).toThrow();
    expect(() => cleanRecado("x".repeat(RECADO_MAX + 1))).toThrow();
    // conta caractere (code point), não byte
    expect(cleanRecado("é".repeat(RECADO_MAX))).toHaveLength(RECADO_MAX);
  });

  it("quem pode escrever: três modos, e 'conexoes' é o padrão do banco", () => {
    expect(RECADOS_FROM).toEqual(["conexoes", "todos", "ninguem"]);
    expect(isRecadosFrom("conexoes")).toBe(true);
    expect(isRecadosFrom("amigos")).toBe(false);
    expect(isRecadosFrom(null)).toBe(false);
  });

  it("a tela explica o motivo de estar fechado", () => {
    expect(recadoClosedText("ninguem")).toMatch(/desligados/);
    expect(recadoClosedText("conexoes")).toMatch(/laço/);
    expect(recadoClosedText("bloqueado")).toMatch(/não encontrada/);
  });

  it("só post de perfil é recado; o resto do mural não é", () => {
    expect(isRecado({ profileId: 7 })).toBe(true);
    expect(isRecado({ profileId: null })).toBe(false);
    expect(RECADO_SAME_TEXT_PROFILES).toBe(5);
  });
});
