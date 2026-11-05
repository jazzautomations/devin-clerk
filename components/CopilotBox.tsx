"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { userMessage } from "@/lib/apiError";

// Copilot do arquivo (spec 046, onda 6: copilot-do-arquivo). A caixa faz a
// pergunta em português, mostra o resumo (quando o LLM está configurado)
// com as citações [n] ancoradas nos cards e a grade de fatos com link.
// "ajudou? sim/não" vota no próprio resultado. O rodapé fixo lembra a
// fronteira: ele só mostra o que existe, nunca avalia.

export type CopilotFactWire = {
  n: number;
  tipo: string;
  titulo: string;
  href: string;
  trecho: string;
};
type CopilotResponse = {
  id: number;
  intent: string;
  facts: CopilotFactWire[];
  summary: string | null;
};

const TIPO_LABEL: Record<string, string> = {
  projeto: "projeto",
  pessoa: "pessoa",
  vencedor: "vencedor",
  desafio: "desafio",
  edicao: "edição",
  agenda: "agenda",
  regra: "regra",
  duvida: "dúvida",
  post: "post",
  comunidade: "comunidade",
  hackathon: "hackathon",
};

export const COPILOT_FOOTER = "O copilot só mostra o que existe no HackaHub. Ele não avalia projeto.";

const GLOBAL_EXAMPLES = [
  "Já fizeram app de carona universitária?",
  "Quem já usou Supabase?",
  "Quem ganhou a última Hack Inova?",
];
const EDITION_EXAMPLES = ["Qual o prazo de entrega?", "Que horas é o pitch?", "Tem desafio de patrocinador?"];

type Props = {
  /** âncora na edição: a intenção regras lê prazo, agenda e desafios dela */
  hackathonId?: string;
  examples?: string[];
};

/** "texto [1] mais [2]" → "texto <a>#cp-1</a> mais <a>#cp-2</a>" */
function CitedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
    const at = m.index!;
    if (at > last) parts.push(text.slice(last, at));
    const n = m[1];
    parts.push(
      <a key={at} href={`#cp-${n}`} className="font-mono text-accent underline decoration-[1.5px] underline-offset-2">
        [{n}]
      </a>,
    );
    last = at + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export function CopilotBox({ hackathonId, examples }: Props) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CopilotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voted, setVoted] = useState(false);
  const exemplos = examples ?? (hackathonId ? EDITION_EXAMPLES : GLOBAL_EXAMPLES);

  async function ask(question: string) {
    const query = question.trim();
    if (busy || query.length < 3) return;
    setQ(query);
    setBusy(true);
    setError(null);
    setVoted(false);
    const r = await fetch("/api/copilot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: query, hackathonId: hackathonId ?? null }),
    }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Sem conexão. Tente de novo.");
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      setRes(null);
      return setError(userMessage(r, data, "Não deu certo. Tente de novo."));
    }
    setRes(data as CopilotResponse);
  }

  async function vote(helpful: boolean) {
    if (!res || voted) return;
    setVoted(true); // otimista: um voto por resposta
    const r = await fetch("/api/copilot/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: res.id, helpful }),
    }).catch(() => null);
    if (!r || !r.ok) setVoted(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(q);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="copilot-box">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={300}
          placeholder="Pergunte ao arquivo"
          aria-label="Pergunte ao arquivo"
          className="min-w-0 flex-1 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 text-[15px]"
          data-testid="copilot-input"
        />
        <button type="submit" disabled={busy || q.trim().length < 3} className="btn shrink-0 rounded-[6px]" data-testid="copilot-ask">
          {busy ? "…" : "perguntar"}
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {exemplos.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => void ask(e)}
            className="chip cursor-pointer text-left"
            data-testid="copilot-example"
          >
            {e}
          </button>
        ))}
      </div>

      {error && (
        <p className="border-[1.5px] border-dashed border-orange px-4 py-3 text-[14px]" role="alert">
          {error}
        </p>
      )}

      {res && (
        <section aria-live="polite" className="flex flex-col gap-4" data-testid="copilot-result">
          {res.summary && (
            <p className="border-[1.5px] border-line bg-mint px-4 py-3.5 text-[15px] leading-relaxed" data-testid="copilot-summary">
              <CitedText text={res.summary} />
            </p>
          )}

          {res.facts.length ? (
            <ol className="flex flex-col divide-y divide-line border-y border-line" data-testid="copilot-facts">
              {res.facts.map((f) => (
                <li key={f.n} id={`cp-${f.n}`} className="group flex scroll-mt-24 items-start gap-3 py-3.5">
                  <span className="mt-0.5 font-mono text-[12px] font-medium text-accent">[{f.n}]</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <a
                        href={f.href}
                        className="font-bold tracking-[-0.02em] break-words underline-offset-4 group-hover:text-accent hover:underline"
                        data-testid="copilot-fact-link"
                      >
                        {f.titulo}
                      </a>
                      <span className="font-mono text-[11px] tracking-[0.04em] text-muted uppercase">
                        {TIPO_LABEL[f.tipo] ?? f.tipo}
                      </span>
                    </div>
                    <p className="text-[13.5px] leading-snug break-words whitespace-pre-line text-[#2b2b2b]">{f.trecho}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="border-[1.5px] border-dashed border-line px-4 py-3.5 text-[14px] text-muted" data-testid="copilot-empty">
              Não achei nada no arquivo sobre isso.
            </p>
          )}

          <div className="flex items-center gap-3 font-mono text-[12.5px]">
            {voted ? (
              <span className="text-muted" data-testid="copilot-voted">
                valeu — anotado.
              </span>
            ) : (
              <>
                <span className="text-muted">ajudou?</span>
                <button type="button" onClick={() => void vote(true)} className="underline underline-offset-4 hover:text-accent" data-testid="copilot-yes">
                  sim
                </button>
                <button type="button" onClick={() => void vote(false)} className="underline underline-offset-4 hover:text-accent" data-testid="copilot-no">
                  não
                </button>
              </>
            )}
          </div>
        </section>
      )}

      <p className="font-mono text-[12px] leading-snug text-muted" data-testid="copilot-footer">
        {COPILOT_FOOTER}
      </p>
    </div>
  );
}
