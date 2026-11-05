"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";
import type { Post } from "@/lib/posts";
import { MentionField } from "@/components/MentionField";

/** espaço do mural da comunidade (migration 057): o que a pessoa pode postar */
export type ComposerSpace = { id: number; slug: string; name: string };

// Caixa de postar (migration 034): texto até 500 e link opcional. Com
// hackathonId posta no mural da edição; com communitySlug, no da comunidade.
// Link do próprio HackaHub (/p/12, /h/x, /u/x, /comunidade/x) vira card.
// Menção @ (migration 039): digitar @ abre o autocomplete de quem existe;
// # vira tag na leitura. initialBody é o atalho de /tag/[tag] ("#x ").
// Citação (migration 049): a opção "não aceitar citação" viaja como
// allowQuote = false e vale pro post que está nascendo.

export function PostComposer({
  hackathonId = null,
  communitySlug = null,
  editionLabel = null,
  initialBody = "",
  spaces = null,
  spaceSlug = null,
  onPosted,
}: {
  hackathonId?: string | null;
  communitySlug?: string | null;
  editionLabel?: string | null;
  /** texto já preenchido (página de tag: "#nextjs ") */
  initialBody?: string;
  /** espaços em que a pessoa pode postar (mural da comunidade, migration 057) */
  spaces?: ComposerSpace[] | null;
  /** espaço pré-selecionado (página /s/[space]); sem ele cai no geral */
  spaceSlug?: string | null;
  onPosted: (post: Post) => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [link, setLink] = useState("");
  // espaço escolhido no seletor: o da página, o geral ou o primeiro da lista
  const [spaceId, setSpaceId] = useState<number | null>(() => {
    if (!spaces?.length) return null;
    return (spaces.find((s) => s.slug === spaceSlug) ?? spaces.find((s) => s.slug === "geral") ?? spaces[0]).id;
  });
  // marcado = o post nasce sem aceitar citação (allowQuote = false)
  const [noQuote, setNoQuote] = useState(false);
  const [status, setStatus] = useState<"idle" | "posting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function post() {
    setStatus("posting");
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body,
        link: link || undefined,
        hackathonId: hackathonId ?? undefined,
        communitySlug: communitySlug ?? undefined,
        spaceId: spaceId ?? undefined,
        allowQuote: !noQuote,
      }),
    }).catch(() => null);
    if (res?.ok) {
      const { post } = await res.json();
      onPosted(post as Post);
      setBody("");
      setLink("");
      setNoQuote(false);
      setStatus("idle");
      setError(null);
      return;
    }
    const data = res ? await res.json().catch(() => null) : null;
    setError(res ? userMessage(res, data, "não deu pra postar. Tente de novo.") : "Sem conexão. Tente de novo.");
    setStatus("error");
  }

  return (
    <div className="card flex flex-col gap-3 p-4" data-testid="post-composer">
      {hackathonId && (
        <p className="font-mono text-[12px] text-accent">
          {"postando no mural: "}
          {editionLabel ?? hackathonId}
        </p>
      )}
      {communitySlug && spaces && spaces.length > 0 && (
        <label className="flex items-center gap-2 font-mono text-[12px] text-muted" data-testid="composer-space">
          em
          <select
            value={spaceId ?? ""}
            onChange={(e) => setSpaceId(Number(e.target.value))}
            aria-label="espaço do mural"
            className="border-[1.5px] border-line bg-background px-2 py-1.5 font-mono text-[12px] text-foreground focus:border-accent focus:outline-none"
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.slug}
              </option>
            ))}
          </select>
        </label>
      )}
      <MentionField
        value={body}
        onChange={setBody}
        rows={3}
        maxLength={500}
        ariaLabel="o que você está construindo"
        placeholder="O que você está construindo? Poste a demo, o que quebrou, o que aprendeu…"
        className="w-full resize-none border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none"
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          aria-label="link do projeto ou da demo"
          placeholder="link do projeto/demo (opcional)"
          className="w-full border-[1.5px] border-line bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none"
        />
        <button
          onClick={post}
          disabled={status === "posting" || !body.trim()}
          className="shrink-0 border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
        >
          {status === "posting" ? "postando…" : "postar →"}
        </button>
      </div>
      <label className="flex min-h-[32px] items-center gap-2 font-mono text-[12px] text-muted" data-testid="composer-no-quote">
        <input
          type="checkbox"
          checked={noQuote}
          onChange={(e) => setNoQuote(e.target.checked)}
          className="h-4 w-4 accent-[#047a43]"
        />
        não aceitar citação
      </label>
      {status === "error" && (
        <p role="alert" className="font-mono text-xs text-orange">
          {error ?? "não deu pra postar. Tente de novo."}
        </p>
      )}
    </div>
  );
}
