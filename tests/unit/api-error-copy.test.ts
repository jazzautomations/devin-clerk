import { describe, expect, it } from "vitest";
import { userMessage } from "@/lib/apiError";
import { cleanTags, displayTag } from "@/lib/radarTags";
import { OPEN_TO, openToLabel } from "@/lib/openTo";
import { ticketWhere } from "@/lib/ticketEmail";
import { rsvpInappText, WHAT_TO_BRING } from "@/lib/rsvpMessages";
import { privacyEmail } from "@/lib/legal";

// auditoria 041 pacote E — copy que chega na tela: erro de API em PT-BR,
// tags do radar limpas, "disponível para" sem gíria, e-mail sem promessa
// que não vale pra toda edição.

const res = (status: number) => ({ status });

describe("userMessage", () => {
  it("troca os códigos em inglês por frase de gente", () => {
    expect(userMessage(res(401), { error: "Unauthorized" }, "x")).toMatch(/sessão expirou/);
    expect(userMessage(res(403), { error: "Forbidden" }, "x")).toMatch(/não tem acesso/);
    expect(userMessage(res(404), { error: "Not found" }, "x")).toMatch(/recarregue/i);
    expect(userMessage(res(400), { error: "Bad request" }, "fallback")).toBe("fallback");
  });

  it("mensagem própria da rota em PT-BR passa direto (400, 409, 429)", () => {
    expect(userMessage(res(400), { error: "dê um título ao desafio" }, "x")).toBe("dê um título ao desafio");
    expect(userMessage(res(429), { error: "muitas requisições. Tente de novo em 30s." }, "x")).toMatch(/30s/);
    expect(userMessage(res(404), { error: "patrocinador não encontrado nesta edição" }, "x")).toMatch(/patrocinador/);
  });

  it("5xx e corpo vazio caem no fallback", () => {
    expect(userMessage(res(500), { error: "TypeError: boom" }, "tente de novo")).toBe("tente de novo");
    expect(userMessage(res(400), null, "tente de novo")).toBe("tente de novo");
  });
});

describe("tags do radar", () => {
  it("descarta prêmio e pedaço de tema, traduz o resto", () => {
    expect(displayTag("premio-$1,000")).toBeNull();
    expect(displayTag("premio-₹ 1,000")).toBeNull();
    expect(displayTag("low")).toBeNull();
    expect(displayTag("open")).toBeNull();
    expect(displayTag("enterprise")).toBeNull();
    expect(displayTag("beginner")).toBe("iniciante");
    expect(displayTag("machine")).toBe("ia");
    expect(displayTag("robotic")).toBe("automação");
    expect(displayTag("web3")).toBe("web3");
  });

  it("junta duplicadas depois de traduzir (health e saude viram uma só)", () => {
    expect(cleanTags(["health", "saude", "premio-$100", "beginner", "low"])).toEqual(["saúde", "iniciante"]);
  });
});

describe("disponível para", () => {
  it("empresa vê 'emprego'; o valor salvo continua 'trampo'", () => {
    expect(OPEN_TO).toContain("trampo");
    expect(openToLabel("trampo")).toBe("emprego");
    expect(openToLabel("mentoria")).toBe("mentoria");
  });
});

describe("e-mails do participante", () => {
  it("ingresso de edição presencial sem local diz 'a confirmar', não 'online'", () => {
    expect(ticketWhere(null, "presencial")).toBe("local a confirmar na página da edição");
    expect(ticketWhere(null, "hibrido")).toBe("local a confirmar na página da edição");
    expect(ticketWhere(null, "online")).toBe("online");
    expect(ticketWhere("Sorocaba, SP", "presencial")).toBe("Sorocaba, SP");
  });

  it("D-1 não afirma nada do local que não vale pra toda edição", () => {
    expect(WHAT_TO_BRING.join(" ")).not.toMatch(/ar-condicionado/);
  });

  it("RSVP em 'você'", () => {
    const text = rsvpInappText({
      kind: "invite",
      hackathonId: "h",
      hackathonName: "Edição",
      firstName: null,
      when: "sáb",
      location: null,
      deadline: "07/11",
      rsvpUrl: "http://x",
    } as never);
    expect(text).toBe("Edição: confirme sua presença até 07/11");
  });
});

describe("contato de privacidade", () => {
  it("só usa e-mail válido do env", () => {
    expect(privacyEmail({})).toBeNull();
    expect(privacyEmail({ HACKAHUB_PRIVACY_EMAIL: "lixo" })).toBeNull();
    expect(privacyEmail({ HACKAHUB_PRIVACY_EMAIL: " privacidade@x.dev " })).toBe("privacidade@x.dev");
  });
});
