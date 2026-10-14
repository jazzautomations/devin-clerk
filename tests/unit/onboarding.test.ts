import { describe, expect, it } from "vitest";
import { onboardingNext, parseIntents, profileCompleteness, safeRedirect, shortText } from "@/lib/onboarding";

const next = { id: "hack-inova-alphaville-2026", name: "Hack Inova Alphaville" };
const help = { id: "hack-inova-alphaville-2026", name: "Hack Inova Alphaville", kind: "mentor" as const };
const base = { intents: [], redirectUrl: null, nextEdition: next, helpEdition: help };

describe("onboardingNext — próximo passo por intenção", () => {
  it("participar → próxima edição aberta", () => {
    expect(onboardingNext({ ...base, intents: ["participar"] }).href).toBe(`/h/${next.id}`);
  });
  it("participar sem edição aberta → radar", () => {
    expect(onboardingNext({ ...base, intents: ["participar"], nextEdition: null }).href).toBe("/radar");
  });
  it("sem intenção marcada conta como participar", () => {
    expect(onboardingNext(base).href).toBe(`/h/${next.id}`);
  });
  it("organizar → contato do /organizar", () => {
    expect(onboardingNext({ ...base, intents: ["organizar"] }).href).toBe("/organizar#contato");
  });
  it("mentorar → candidatura aberta", () => {
    expect(onboardingNext({ ...base, intents: ["mentorar"] }).href).toBe(`/h/${next.id}/candidatura/mentor`);
  });
  it("mentorar sem candidatura aberta → painel", () => {
    expect(onboardingNext({ ...base, intents: ["mentorar"], helpEdition: null }).href).toBe("/dashboard");
  });
  it("patrocinar → /organizar#patrocinio", () => {
    expect(onboardingNext({ ...base, intents: ["patrocinar"] }).href).toBe("/organizar#patrocinio");
  });
  it("participar ganha de organizar quando as duas estão marcadas", () => {
    expect(onboardingNext({ ...base, intents: ["organizar", "participar"] }).href).toBe(`/h/${next.id}`);
  });
  it("redirect_url tem prioridade sobre a intenção", () => {
    const n = onboardingNext({ ...base, intents: ["organizar"], redirectUrl: "/h/hack-x/inscricao" });
    expect(n.href).toBe("/h/hack-x/inscricao");
    expect(n.label).toBe("continuar a inscrição");
  });
  it("redirect_url externo é ignorado (open redirect)", () => {
    expect(onboardingNext({ ...base, intents: ["organizar"], redirectUrl: "https://mal.com" }).href).toBe("/organizar#contato");
  });
});

describe("safeRedirect", () => {
  it("aceita caminho do site", () => {
    expect(safeRedirect("/h/x/inscricao?y=1")).toBe("/h/x/inscricao?y=1");
  });
  it.each(["https://mal.com", "//mal.com", "/\\mal.com", "javascript:alert(1)", "", null, 3, "/bem-vindo", "/sign-up"])("recusa %s", (v) => {
    expect(safeRedirect(v)).toBeNull();
  });
});

describe("validação", () => {
  it("intents só da lista, sem repetição", () => {
    expect(parseIntents(["participar", "participar", "organizar"])).toEqual({ value: ["participar", "organizar"] });
    expect(parseIntents(["hackear"])).toHaveProperty("error");
    expect(parseIntents("participar")).toHaveProperty("error");
  });
  it("texto curto: trim, colapsa espaço, limite e vazio vira null", () => {
    expect(shortText("  Sorocaba,   SP ", 60, "city")).toEqual({ value: "Sorocaba, SP" });
    expect(shortText("   ", 60, "city")).toEqual({ value: null });
    expect(shortText("x".repeat(61), 60, "city")).toHaveProperty("error");
    expect(shortText(12, 60, "city")).toHaveProperty("error");
  });
});

describe("profileCompleteness", () => {
  const vazio = { name: null, headline: null, personas: [], city: null, github: null, linkedin: null, skills: [] };
  it("vazio é 0% e lista o que falta", () => {
    const c = profileCompleteness(vazio);
    expect(c.percent).toBe(0);
    expect(c.missing).toContain("cidade");
  });
  it("completo é 100%", () => {
    expect(
      profileCompleteness({ name: "Bia", headline: "dev", personas: ["dev"], city: "SP", github: null, linkedin: "in/bia", skills: ["ts"] }).percent,
    ).toBe(100);
  });
  it("metade", () => {
    expect(profileCompleteness({ ...vazio, name: "Bia", headline: "dev", personas: ["dev"] }).percent).toBe(50);
  });
});
