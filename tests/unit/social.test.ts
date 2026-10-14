import { describe, expect, it } from "vitest";
import {
  linkedinAddCertificationUrl,
  normalizeSocial,
  profileUrl,
  shareLinks,
} from "@/lib/social";

describe("normalizeSocial — guarda o handle canônico, recusa lixo", () => {
  it("linkedin aceita URL (qualquer subdomínio) ou handle e guarda o slug do /in/", () => {
    expect(normalizeSocial("linkedin", "https://www.linkedin.com/in/maria-silva-123/")).toEqual({ value: "maria-silva-123" });
    expect(normalizeSocial("linkedin", "br.linkedin.com/in/joao.dev?trk=x")).toEqual({ value: "joao.dev" });
    expect(normalizeSocial("linkedin", "@ana-souza")).toEqual({ value: "ana-souza" });
    expect(normalizeSocial("linkedin", "https://evil.com/in/x")).toHaveProperty("error");
    expect(normalizeSocial("linkedin", "javascript:alert(1)")).toHaveProperty("error");
    expect(normalizeSocial("linkedin", "https://linkedin.com/company/acme")).toHaveProperty("error");
  });

  it("github e x: URL ou @handle, com as regras de nome de cada rede", () => {
    expect(normalizeSocial("github", "https://github.com/jazzautomations")).toEqual({ value: "jazzautomations" });
    expect(normalizeSocial("github", "@foo-bar")).toEqual({ value: "foo-bar" });
    expect(normalizeSocial("github", "foo bar")).toHaveProperty("error");
    expect(normalizeSocial("twitter", "https://x.com/hackinova")).toEqual({ value: "hackinova" });
    expect(normalizeSocial("twitter", "twitter.com/@abc_1")).toEqual({ value: "abc_1" });
    expect(normalizeSocial("twitter", "nome-com-hifen")).toHaveProperty("error");
  });

  it("site exige http(s) e nunca aceita outro esquema", () => {
    expect(normalizeSocial("website", "meusite.dev")).toEqual({ value: "https://meusite.dev/" });
    expect(normalizeSocial("website", "http://a.b/c")).toEqual({ value: "http://a.b/c" });
    expect(normalizeSocial("website", "javascript:alert(1)")).toHaveProperty("error");
    expect(normalizeSocial("website", "ftp://x.com")).toHaveProperty("error");
  });

  it("vazio limpa o campo", () => {
    expect(normalizeSocial("linkedin", "   ")).toEqual({ value: "" });
  });
});

describe("profileUrl", () => {
  it("monta o link público de cada rede", () => {
    expect(profileUrl("linkedin", "maria")).toBe("https://www.linkedin.com/in/maria");
    expect(profileUrl("github", "x")).toBe("https://github.com/x");
    expect(profileUrl("twitter", "x")).toBe("https://x.com/x");
    expect(profileUrl("website", "https://a.dev/")).toBe("https://a.dev/");
    // legado: valor antigo gravado como URL completa continua funcionando
    expect(profileUrl("linkedin", "https://www.linkedin.com/in/maria/")).toBe("https://www.linkedin.com/in/maria");
    expect(profileUrl("linkedin", "")).toBeNull();
  });
});

describe("shareLinks", () => {
  it("gera intents com URL e texto codificados", () => {
    const s = shareLinks("https://hackahub.jazzautomations.com.br/u/ana", "Meu perfil & projetos");
    expect(s.linkedin).toBe(
      "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fhackahub.jazzautomations.com.br%2Fu%2Fana",
    );
    expect(s.x).toContain("https://x.com/intent/post?");
    expect(s.x).toContain("text=Meu%20perfil%20%26%20projetos");
    expect(s.whatsapp).toBe(
      "https://wa.me/?text=Meu%20perfil%20%26%20projetos%20https%3A%2F%2Fhackahub.jazzautomations.com.br%2Fu%2Fana",
    );
    expect(s.telegram).toContain("https://t.me/share/url?url=");
  });
});

describe("linkedinAddCertificationUrl", () => {
  it("abre o 'adicionar licença/certificado' do LinkedIn preenchido", () => {
    const u = new URL(
      linkedinAddCertificationUrl({
        name: "Participação — Hack Inova Alphaville",
        organizationName: "Hack Inova",
        issuedAt: "2026-11-15 18:00:00",
        certUrl: "https://hackahub.jazzautomations.com.br/c/ABCDEFGHJK",
        certId: "ABCDEFGHJK",
      }),
    );
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/profile/add");
    expect(u.searchParams.get("startTask")).toBe("CERTIFICATION_NAME");
    expect(u.searchParams.get("name")).toBe("Participação — Hack Inova Alphaville");
    expect(u.searchParams.get("organizationName")).toBe("Hack Inova");
    expect(u.searchParams.get("issueYear")).toBe("2026");
    expect(u.searchParams.get("issueMonth")).toBe("11");
    expect(u.searchParams.get("certId")).toBe("ABCDEFGHJK");
    expect(u.searchParams.get("certUrl")).toBe("https://hackahub.jazzautomations.com.br/c/ABCDEFGHJK");
  });
});
