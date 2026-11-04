import { describe, expect, it } from "vitest";
import { detectIntent } from "@/lib/copilot/retrieve";
import { EVALUATION_REPLY, isEvaluationAsk, postFilterSummary, SUMMARY_WORDS_MAX } from "@/lib/copilot/guard";

// Copilot do arquivo (spec 046, onda 6): as partes puras — detecção de
// intenção por palavras-chave, a guarda de avaliação (IA nunca dá nota) e
// o pós-filtro do resumo do LLM.

describe("detectIntent", () => {
  it("'já fizeram isso?' e variantes → similar", () => {
    expect(detectIntent("Já fizeram app de carona universitária?", false)).toBe("similar");
    expect(detectIntent("já fizeram isso?", false)).toBe("similar");
    expect(detectIntent("alguém já criou um bot de presença?", false)).toBe("similar");
    expect(detectIntent("existe projeto de saúde mental?", false)).toBe("similar");
    expect(detectIntent("quero fazer um app de vaquinha", false)).toBe("similar");
  });

  it("'quem usou X' → stack", () => {
    expect(detectIntent("Quem já usou Supabase?", false)).toBe("stack");
    expect(detectIntent("quais projetos usam React Native?", false)).toBe("stack");
    expect(detectIntent("alguém sabe Arduino?", false)).toBe("stack");
    expect(detectIntent("tem projeto feito com Next.js?", false)).toBe("stack");
  });

  it("'quem ganhou' → edicao", () => {
    expect(detectIntent("Quem ganhou a última Hack Inova?", false)).toBe("edicao");
    expect(detectIntent("quem foram os campeões?", false)).toBe("edicao");
    expect(detectIntent("quem ficou no pódio da edição passada?", false)).toBe("edicao");
    // mesmo dentro da edição, "quem ganhou" continua sendo sobre vencedores
    expect(detectIntent("quem ganhou o desafio da patrocinadora?", true)).toBe("edicao");
  });

  it("regras da edição só com edição no contexto", () => {
    expect(detectIntent("qual o prazo de entrega?", true)).toBe("regras");
    expect(detectIntent("que horas é o pitch?", true)).toBe("regras");
    expect(detectIntent("tem desafio de patrocinador?", true)).toBe("regras");
    expect(detectIntent("qual a idade mínima?", true)).toBe("regras");
    // fora da edição, as mesmas palavras não ativam 'regras'
    expect(detectIntent("qual o prazo de entrega?", false)).not.toBe("regras");
    expect(detectIntent("tem desafio de patrocinador?", false)).not.toBe("regras");
  });

  it("sem padrão → busca", () => {
    expect(detectIntent("carona universitária", false)).toBe("busca");
    expect(detectIntent("blockchain", false)).toBe("busca");
  });
});

describe("isEvaluationAsk — IA nunca avalia", () => {
  it("pedido de nota/palpite é avaliação", () => {
    expect(isEvaluationAsk("minha ideia é boa?")).toBe(true);
    expect(isEvaluationAsk("dá nota pro meu projeto?")).toBe(true);
    expect(isEvaluationAsk("que nota você dá pra essa ideia?")).toBe(true);
    expect(isEvaluationAsk("vou ganhar o hackathon?")).toBe(true);
    expect(isEvaluationAsk("qual a chance de ganhar?")).toBe(true);
    expect(isEvaluationAsk("o que você acha da minha ideia?")).toBe(true);
    expect(isEvaluationAsk("vale a pena fazer um app de dieta?")).toBe(true);
    expect(isEvaluationAsk("avalia meu pitch")).toBe(true);
  });

  it("pergunta de arquivo NÃO é avaliação", () => {
    expect(isEvaluationAsk("quem ganhou a última Hack Inova?")).toBe(false);
    expect(isEvaluationAsk("já fizeram app de carona?")).toBe(false);
    expect(isEvaluationAsk("quem já usou Supabase?")).toBe(false);
    expect(isEvaluationAsk("qual o prazo de entrega?")).toBe(false);
    expect(isEvaluationAsk("qual o prêmio do desafio?")).toBe(false);
  });
});

describe("postFilterSummary — pós-filtro do resumo do LLM", () => {
  it("resumo limpo com citação válida passa", () => {
    expect(postFilterSummary("Já fizeram algo parecido [1] e outro time usou a stack [2].", 3)).toBe(
      "Já fizeram algo parecido [1] e outro time usou a stack [2].",
    );
  });

  it("citação [n] além dos fatos descarta o resumo", () => {
    expect(postFilterSummary("Veja o projeto [9] que ganhou.", 3)).toBeNull();
    expect(postFilterSummary("Veja [0] e [1].", 3)).toBeNull();
    expect(postFilterSummary("Veja [4].", 4)).toBe("Veja [4].");
  });

  it("nota numérica e a palavra 'nota' descartam o resumo", () => {
    expect(postFilterSummary("O projeto merece nota 8/10.", 3)).toBeNull();
    expect(postFilterSummary("Eu daria 8,5/10 pra ideia [1].", 3)).toBeNull();
    expect(postFilterSummary("A nota dele foi alta [1].", 3)).toBeNull();
  });

  it("estouro de palavras descarta o resumo", () => {
    const longo = Array.from({ length: SUMMARY_WORDS_MAX + 1 }, (_, i) => `p${i}`).join(" ");
    expect(postFilterSummary(longo, 3)).toBeNull();
    const limite = Array.from({ length: SUMMARY_WORDS_MAX }, (_, i) => `p${i}`).join(" ");
    expect(postFilterSummary(limite, 3)).toBe(limite);
  });

  it("vazio e espaços → null", () => {
    expect(postFilterSummary("", 3)).toBeNull();
    expect(postFilterSummary("   \n  ", 3)).toBeNull();
  });

  it("a resposta fixa é a da spec", () => {
    expect(EVALUATION_REPLY).toBe(
      "Eu não avalio ideia nem projeto. Isso é com o júri e com você. Olha o que já foi feito parecido:",
    );
  });
});
