// Guarda do copilot (spec 046, onda 6: copilot-do-arquivo).
//
// A regra que não muda: IA nunca dá nota nem escolhe vencedor. Pedido de
// avaliação ("minha ideia é boa?", "vou ganhar?") recebe a resposta fixa e
// os resultados de similar — a pessoa mesma compara. E todo resumo que
// vem do LLM passa pelo pós-filtro antes de aparecer: citação [n]
// inexistente, nota numérica, a palavra "nota" ou texto longo demais =
// resumo descartado, ficam só os fatos.

// Resposta fixa pra pedido de avaliação — texto exato da spec.
export const EVALUATION_REPLY =
  "Eu não avalio ideia nem projeto. Isso é com o júri e com você. Olha o que já foi feito parecido:";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

// padrões de "me avalia / me diz se eu ganho". Propositalmente não pegam
// "ganhou"/"campeões" (passado = intenção edicao) nem "prêmio" (premio da
// edição = intenção regras).
const EVAL_RES = [
  /\bnota\b/, // "dá nota", "que nota você dá"
  /\bavali/, // avalie, avalia, avaliação (da minha ideia)
  /\bjulg/, // julga, julgue
  /\b(vou|vai|da pra|posso|consigo|acho que|sera que)\s+ganhar\b/,
  /\bganhar(iam?|emos|ao|eis)\b/, // futuro/condicional — "quem ganhará"
  /\bquem ganha\b/,
  /\bchances?\b/, // "qual a chance", "chances de ganhar"
  /\b(e|eh|seria|parece|ficou|ta)\s+(boa|bom)\b/, // "minha ideia é boa?"
  /\bvale a pena\b/,
  /\bo que (voce|vc|tu|ce|vocês|voces) acha(m)?\b/,
  /\bme diz se\b/,
  /\bpremio (para|pra) (mim|meu|minha|nosso|a gente)\b/,
];

/** true quando a pessoa pede avaliação/palpite, não fatos do arquivo */
export function isEvaluationAsk(q: string): boolean {
  const f = ` ${fold(q)} `;
  return EVAL_RES.some((re) => re.test(f));
}

export const SUMMARY_WORDS_MAX = 120;

/**
 * Pós-filtro do resumo do LLM. Devolve o texto limpo ou null quando o
 * resumo tem que ser descartado: cita [n] fora de 1..factCount, traz nota
 * numérica ("8/10", "8,5/10") ou a palavra "nota", ou passa de 120
 * palavras. Sem resumo = a resposta fica só com os fatos.
 */
export function postFilterSummary(text: string, factCount: number): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.split(" ").length > SUMMARY_WORDS_MAX) return null;
  const f = fold(t);
  if (/\b\d+(?:[.,]\d+)?\s*\/\s*10\b/.test(f)) return null;
  if (/\bnotas?\b/.test(f)) return null;
  for (const m of t.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > factCount) return null;
  }
  return t;
}
