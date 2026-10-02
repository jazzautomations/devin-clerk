import { describe, expect, it } from "vitest";
import { eventRegion, getRegions } from "@/lib/regions";

// região do card — heurística sobre o texto livre que o scraper traz
// ("Belém, PA", "Santa Casa, São Paulo", "Mumbai, Índia"). Nunca inventa:
// sem reconhecer, cai em "exterior" ou "online" conforme o formato.

describe("eventRegion", () => {
  const h = (location: string | null, format = "presencial") =>
    eventRegion({ location, format });

  it("extrai UF do sufixo 'Cidade, UF'", () => {
    expect(h("Belém, PA")).toBe("PA");
    expect(h("Fortaleza, CE")).toBe("CE");
    expect(h("Alphaville, SP")).toBe("SP");
  });

  it("reconhece cidade conhecida mesmo sem sigla", () => {
    expect(h("São Paulo")).toBe("SP");
    expect(h("Santa Casa, São Paulo")).toBe("SP");
    expect(h("Centro de Eventos do Ceará, Fortaleza")).toBe("CE");
    expect(h("Hospital das Clínicas, São Paulo")).toBe("SP");
  });

  it("reconhece nome de estado por extenso", () => {
    expect(h("Evento Online — Ceará")).toBe("CE");
    expect(h("Unisinos, Rio Grande do Sul")).toBe("RS");
  });

  it("online é bucket próprio (location 'Online' ou null + formato online)", () => {
    expect(h("Online", "online")).toBe("online");
    expect(h("Online")).toBe("online");
    expect(h(null, "online")).toBe("online");
  });

  it("não inventa: estrangeiro e null sem formato online viram 'exterior'", () => {
    expect(h("Mumbai, Índia")).toBe("exterior");
    expect(h("Lisboa, Portugal")).toBe("exterior");
    expect(h("New York, NY")).toBe("exterior"); // NY não é UF BR
    expect(h(null, "presencial")).toBe("exterior");
  });

  it("brasil genérico (scraper que só dá país) tem bucket próprio", () => {
    expect(h("Brazil")).toBe("brasil");
    expect(h("Brasil — presencial")).toBe("brasil");
  });

  it("UF no fim vence cidade do nome (São Paulo, PA seria Pará)", () => {
    expect(h("Festival São Paulo, MA")).toBe("MA");
  });
});

describe("getRegions", () => {
  it("ordena UFs alfabéticas e manda buckets pro fim", () => {
    const regions = getRegions([
      { location: "Mumbai", format: "presencial" },
      { location: "Recife, PE", format: "presencial" },
      { location: "Online", format: "online" },
      { location: "Belém, PA", format: "hibrido" },
      { location: "Brazil", format: "presencial" },
    ]);
    expect(regions).toEqual(["PA", "PE", "online", "brasil", "exterior"]);
  });

  it("deduplica e omite buckets vazios", () => {
    expect(
      getRegions([
        { location: "Alphaville, SP", format: "presencial" },
        { location: "São Paulo", format: "presencial" },
      ]),
    ).toEqual(["SP"]);
  });
});
