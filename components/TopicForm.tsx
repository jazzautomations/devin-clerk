"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { userMessage } from "@/lib/apiError";
import { TOPIC_KINDS, TOPIC_KIND_LABEL, TOPIC_LIMITS, type TopicKind } from "@/lib/topicsShared";

// Novo tópico (migration 058): tipo, título, texto, flair e, na enquete,
// de 2 a 6 opções. Manda pra POST /api/communities/[slug]/topics e abre o
// tópico criado.

const KIND_HINT: Record<TopicKind, string> = {
  discussao: "Uma ideia, uma opinião, um assunto pra conversar.",
  pergunta: "Você marca a resposta que resolveu.",
  enquete: "Cada pessoa vota numa opção.",
  mostra: "Projeto, demo ou o que saiu do último hackathon.",
};

const field =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 text-[15px] focus:border-accent focus:outline-none";

export function TopicForm({ slug, flairs }: { slug: string; flairs: string[] }) {
  const router = useRouter();
  const ids = useId();
  const [kind, setKind] = useState<TopicKind>("discussao");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [flair, setFlair] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < TOPIC_LIMITS.titleMin) return setError(`O título precisa de pelo menos ${TOPIC_LIMITS.titleMin} caracteres.`);
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (kind === "enquete" && opts.length < TOPIC_LIMITS.pollMin) return setError("Enquete precisa de pelo menos 2 opções.");
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/communities/${slug}/topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, title, body, flair: flair.trim() || null, options: kind === "enquete" ? opts : undefined }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      setBusy(false);
      return setError(res ? userMessage(res, data, "Não deu pra abrir o tópico. Tente de novo.") : "Sem conexão. Tente de novo.");
    }
    router.push(data.topic.href);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" data-testid="topic-form">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-mono text-[12px] tracking-[0.06em] text-muted uppercase">tipo</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TOPIC_KINDS.map((k) => (
            <label
              key={k}
              className={`flex min-h-[64px] cursor-pointer flex-col gap-0.5 border-[1.5px] px-3 py-2.5 transition ${
                kind === k ? "border-foreground bg-mint" : "border-line-soft hover:border-foreground"
              }`}
            >
              <span className="flex items-center gap-2 text-[15px] font-bold">
                <input
                  type="radio"
                  name={`${ids}-kind`}
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="accent-[var(--accent)]"
                  data-testid={`topic-kind-${k}`}
                />
                {TOPIC_KIND_LABEL[k]}
              </span>
              <span className="pl-6 text-[13px] text-muted">{KIND_HINT[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between font-mono text-[12px] text-muted">
          <span className="tracking-[0.06em] uppercase">título</span>
          <span className="tabular-nums">
            {title.length}/{TOPIC_LIMITS.title}
          </span>
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TOPIC_LIMITS.title}
          required
          className={`${field} text-[17px] font-bold`}
          placeholder={kind === "pergunta" ? "Como vocês sobem o banco no fim de semana do hackathon?" : "Do que se trata, numa linha"}
          data-testid="topic-title"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">texto {kind === "enquete" ? "(opcional)" : ""}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={TOPIC_LIMITS.body}
          rows={7}
          className={`${field} min-h-[160px] resize-y leading-relaxed`}
          placeholder="Conte o contexto. Aceita **negrito**, listas, `código` e links."
          data-testid="topic-body"
        />
      </label>

      {kind === "enquete" && (
        <fieldset className="flex flex-col gap-2" data-testid="topic-poll-editor">
          <legend className="mb-2 font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
            opções ({TOPIC_LIMITS.pollMin} a {TOPIC_LIMITS.pollMax})
          </legend>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 shrink-0 font-mono text-[13px] text-muted">{i + 1}.</span>
              <input
                value={o}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
                maxLength={TOPIC_LIMITS.pollLabel}
                className={field}
                aria-label={`opção ${i + 1}`}
                data-testid="topic-poll-option"
              />
              {options.length > TOPIC_LIMITS.pollMin && (
                <button
                  type="button"
                  onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  aria-label={`tirar opção ${i + 1}`}
                  className="h-10 w-10 shrink-0 border-[1.5px] border-line-soft font-mono text-[14px] text-muted hover:border-foreground hover:text-foreground"
                >
                  x
                </button>
              )}
            </div>
          ))}
          {options.length < TOPIC_LIMITS.pollMax && (
            <button
              type="button"
              onClick={() => setOptions([...options, ""])}
              className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline"
              data-testid="topic-poll-add"
            >
              + opção
            </button>
          )}
        </fieldset>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">flair (opcional)</span>
        <input
          value={flair}
          onChange={(e) => setFlair(e.target.value)}
          maxLength={TOPIC_LIMITS.flair}
          list={`${ids}-flairs`}
          className={`${field} max-w-[280px]`}
          placeholder="ideia, dúvida, vaga…"
          data-testid="topic-flair"
        />
        {flairs.length > 0 && (
          <datalist id={`${ids}-flairs`}>
            {flairs.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        )}
      </label>

      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t-[1.5px] border-line pt-5">
        <button type="submit" disabled={busy} className="btn min-h-[44px]! rounded-[6px] disabled:opacity-60" data-testid="topic-submit">
          {busy ? "publicando…" : "publicar tópico"}
        </button>
        <Link href={`/comunidade/${slug}/t`} className="font-mono text-[13px] text-muted hover:underline">
          cancelar
        </Link>
      </div>
    </form>
  );
}
