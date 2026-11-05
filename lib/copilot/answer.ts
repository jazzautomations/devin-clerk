import { postFilterSummary } from "@/lib/copilot/guard";
import type { CopilotFact } from "@/lib/copilot/retrieve";

// Resumo via LLM do copilot (spec 046, onda 6: copilot-do-arquivo).
//
// OPCIONAL e desligado por padrão: sem COPILOT_LLM_URL + COPILOT_LLM_KEY a
// feature funciona inteira só com os fatos (e qualquer erro/timeout aqui
// cai pro mesmo modo, nunca quebra a resposta). O provedor é compatível
// com a API de chat da OpenAI (URL completa do endpoint, bearer key e
// modelo por env — prod/stage usam OpenRouter). Timeout de 15s.
//
// O resumo sai daqui só depois do pós-filtro (guard.ts): citação [n]
// inexistente, nota ou texto longo demais = null.

export const PROMPT_VERSION = "copilot-arquivo-v1";

// Prompt de sistema versionado. Mudou o comportamento do resumo → troca a
// versão acima, pra métrica de helpful conseguir comparar antes/depois.
const SYSTEM_PROMPT = `Você é o copilot do arquivo do HackaHub, a comunidade de hackathon do Brasil.
Responda em português do Brasil, direto, sem emoji, com no máximo ${120} palavras.
Use SOMENTE os fatos numerados abaixo — nada de conhecimento externo, dedução ou opinião.
Cite cada fato usado no formato [n], com o número do fato.
NUNCA dê nota, ranking, parecer ou previsão sobre ideia, projeto ou time: avaliar é papel do júri e da própria pessoa.
Se os fatos não respondem a pergunta, diga "não achei no arquivo" e sugira abrir os links citados.`;

export function copilotLlmConfigured(): boolean {
  return Boolean(process.env.COPILOT_LLM_URL && process.env.COPILOT_LLM_KEY);
}

/**
 * Resume a resposta em cima dos fatos. Devolve o texto já pós-filtrado ou
 * null (LLM desligada, erro, timeout ou resumo rejeitado pelo filtro).
 */
export async function summarizeFacts(question: string, facts: CopilotFact[]): Promise<string | null> {
  if (!copilotLlmConfigured() || !facts.length) return null;
  const lista = facts.map((f) => `[${f.n}] ${f.tipo} — ${f.titulo} (${f.href}): ${f.trecho}`).join("\n");
  try {
    const res = await fetch(process.env.COPILOT_LLM_URL!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.COPILOT_LLM_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.COPILOT_LLM_MODEL ?? "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Pergunta: ${question}\n\nFatos do arquivo:\n${lista}` },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    return postFilterSummary(text, facts.length);
  } catch {
    return null;
  }
}
