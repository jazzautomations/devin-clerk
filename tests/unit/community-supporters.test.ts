import { describe, expect, it } from "vitest";
import { parseSupporterInput, SUPPORTER_LIMITS } from "@/lib/communitySupporters";
import { isLeadInterest, LEAD_INTEREST_LABELS, MARCA_INTERESTS } from "@/lib/leadInterests";
import { isSupportKind, SUPPORT_KIND_LABELS, SUPPORT_KINDS } from "@/lib/supportKinds";

// Apoiadores da comunidade (migration 028): validação pura do cadastro e o
// contrato fechado dos tipos de apoio.

describe("tipos de apoio", () => {
  it("inclui apoio que não é dinheiro e todo tipo tem rótulo", () => {
    expect(SUPPORT_KINDS).toEqual(["dinheiro", "espaco", "comida", "premio", "mentoria", "divulgacao", "outro"]);
    for (const k of SUPPORT_KINDS) expect(SUPPORT_KIND_LABELS[k]).toBeTruthy();
    expect(SUPPORT_KIND_LABELS.espaco).toBe("espaço");
  });

  it("isSupportKind só aceita a whitelist", () => {
    expect(isSupportKind("comida")).toBe(true);
    expect(isSupportKind("Comida")).toBe(false);
    expect(isSupportKind("alcance")).toBe(false);
    expect(isSupportKind(null)).toBe(false);
  });

  it("lead de comunidade existe, mas não aparece no form do /empresas", () => {
    expect(isLeadInterest("comunidade")).toBe(true);
    expect(LEAD_INTEREST_LABELS.comunidade).toBe("apoiar uma comunidade");
    expect(MARCA_INTERESTS).not.toContain("comunidade");
    expect(MARCA_INTERESTS).not.toContain("organizar");
    expect(MARCA_INTERESTS).toContain("desafio");
  });
});

describe("parseSupporterInput", () => {
  const ok = { name: "  Padaria   do Centro ", kind: "comida" };

  it("normaliza o nome e deixa link, logo e descrição opcionais", () => {
    const r = parseSupporterInput(ok);
    expect(r).toEqual({ value: { name: "Padaria do Centro", kind: "comida", description: null, url: null, logoUrl: null } });
    const full = parseSupporterInput({
      ...ok,
      url: "https://padaria.com.br",
      logoUrl: "https://padaria.com.br/logo.png",
      description: " pão de queijo no coffee break ",
    });
    expect(full).toEqual({
      value: {
        name: "Padaria do Centro",
        kind: "comida",
        description: "pão de queijo no coffee break",
        url: "https://padaria.com.br/",
        logoUrl: "https://padaria.com.br/logo.png",
      },
    });
    expect(parseSupporterInput({ ...ok, url: "", logoUrl: "  ", description: "" })).toMatchObject({
      value: { url: null, logoUrl: null, description: null },
    });
  });

  it("recusa nome curto/longo, tipo fora da lista e descrição longa", () => {
    expect(parseSupporterInput({ kind: "comida" })).toHaveProperty("error");
    expect(parseSupporterInput({ name: "A", kind: "comida" })).toHaveProperty("error");
    expect(parseSupporterInput({ name: "x".repeat(SUPPORTER_LIMITS.name + 1), kind: "comida" })).toHaveProperty("error");
    expect(parseSupporterInput({ name: "Loja", kind: "alcance" })).toHaveProperty("error");
    expect(parseSupporterInput({ name: "Loja" })).toHaveProperty("error");
    expect(parseSupporterInput({ ...ok, description: "x".repeat(SUPPORTER_LIMITS.description + 1) })).toHaveProperty("error");
    expect(parseSupporterInput({ ...ok, description: 42 })).toHaveProperty("error");
  });

  it("link e logo só https, sem javascript: nem credencial na URL", () => {
    expect(parseSupporterInput({ ...ok, url: "http://padaria.com.br" })).toHaveProperty("error");
    expect(parseSupporterInput({ ...ok, url: "javascript:alert(1)" })).toHaveProperty("error");
    expect(parseSupporterInput({ ...ok, logoUrl: "http://padaria.com.br/logo.png" })).toHaveProperty("error");
    expect(parseSupporterInput({ ...ok, logoUrl: "data:image/png;base64,AAAA" })).toHaveProperty("error");
    expect(parseSupporterInput({ ...ok, url: "https://user:senha@padaria.com.br" })).toHaveProperty("error");
    expect(parseSupporterInput({ ...ok, url: "https://localhost" })).toHaveProperty("error");
  });
});
