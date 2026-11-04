"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";
import type { Post } from "@/lib/posts";
import { MentionField } from "@/components/MentionField";

// Caixa de postar (migration 034): texto até 500 e link opcional. Com
// hackathonId posta no mural da edição; com communitySlug, no da comunidade.
// Link do próprio HackaHub (/p/12, /h/x, /u/x, /comunidade/x) vira card.
// Menção @ (migration 039): digitar @ abre o autocomplete de quem existe;
// # vira tag na leitura. initialBody é o atalho de /tag/[tag] ("#x ").

export function PostComposer({
  hackathonId = null,
  communitySlug = null,
  editionLabel = null,
  initialBody = "",
  onPosted,
}: {
  hackathonId?: string | null;
  communitySlug?: string | null;
  editionLabel?: string | null;
  /** texto já preenchido (página de tag: "#nextjs ") */
  initialBody?: string;
  onPosted: (post: Post) => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [link, setLink] = useState("");
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
      }),
    }).catch(() => null);
    if (res?.ok) {
      const { post } = await res.json();
      onPosted(post as Post);
      setBody("");
      setLink("");
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
      {status === "error" && (
        <p role="alert" className="font-mono text-xs text-orange">
          {error ?? "não deu pra postar. Tente de novo."}
        </p>
      )}
    </div>
  );
}
