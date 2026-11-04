"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";
import type { Post } from "@/lib/posts";
import { PostCard, type PostCardMe } from "@/components/PostCard";

// Diário do projeto (spec 046, onda 3, migration 044). O time posta a
// atualização aqui mesmo, na página do projeto: texto até 1000 e link
// opcional. Quem não é do time lê (e pode seguir o projeto pra ser avisado).
// O card é o PostCard de sempre — este componente só lista e pagina.

const MAX = 1000;

export function ProjectDiary({
  teamId,
  me,
  canPost,
  initialPosts,
  initialNext,
  pageSize,
}: {
  teamId: number;
  me: PostCardMe;
  /** integrante do time: só ele vê a caixa de postar */
  canPost: boolean;
  initialPosts: Post[];
  /** cursor da próxima página (?antes=), null = acabou */
  initialNext: number | null;
  pageSize: number;
}) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [next, setNext] = useState<number | null>(initialNext);
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    if (!body.trim() || posting) return;
    setPosting(true);
    setError(null);
    const res = await fetch(`/api/projects/${teamId}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, link: link.trim() || undefined }),
    }).catch(() => null);
    setPosting(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(userMessage(res, data, "Não deu pra publicar. Tente de novo."));
    setPosts((cur) => [data.post as Post, ...cur]);
    setBody("");
    setLink("");
  }

  async function more() {
    if (next === null || loading) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/projects/${teamId}/updates?antes=${next}`).catch(() => null);
    setLoading(false);
    if (!res?.ok) return setError("Não deu pra carregar mais. Tente de novo.");
    const data = await res.json().catch(() => null);
    if (!data) return setError("Não deu pra carregar mais. Tente de novo.");
    setPosts((cur) => [...cur, ...(data.posts as Post[])]);
    setNext((data.next as number | null) ?? null);
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="diario-titulo" data-testid="project-diary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="diario-titulo" className="font-display text-[22px] leading-tight font-extrabold tracking-[-0.02em]">
          Diário do projeto
        </h2>
        <p className="font-mono text-[12px] text-muted">
          {posts.length === 0 ? "nada por aqui ainda" : `${posts.length} ${posts.length === 1 ? "atualização" : "atualizações"}`}
        </p>
      </div>

      {canPost && (
        <div className="flex flex-col gap-2 border-[1.5px] border-line p-4" data-testid="diary-composer">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[12px] text-muted">
              o que mudou · {body.length}/{MAX}
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={MAX}
              aria-label="atualização do projeto"
              placeholder="O que vocês construíram desde a última atualização?"
              className="w-full resize-y rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              aria-label="link da atualização"
              placeholder="link da demo ou do commit (opcional)"
              className="w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={post}
              disabled={posting || !body.trim()}
              className="btn shrink-0 rounded-[6px] disabled:opacity-50"
            >
              {posting ? "publicando…" : "publicar →"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}

      {posts.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line-soft border-[1.5px] border-line">
          {posts.map((p) => (
            <li key={p.id} className="min-w-0 px-4 py-4">
              <PostCard
                post={p}
                me={me}
                onChange={(next) => setPosts((cur) => cur.map((x) => (x.id === next.id ? next : x)))}
                onRemoved={(id) => setPosts((cur) => cur.filter((x) => x.id !== id))}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-[1.5px] border-line px-5 py-6 font-mono text-xs text-muted" data-testid="diary-empty">
          {canPost
            ? "O diário começa na primeira atualização. Conte o que vocês construíram depois do evento."
            : "O time ainda não escreveu no diário. Quem segue o projeto é avisado na primeira atualização."}
        </p>
      )}

      {next !== null && (
        <button
          type="button"
          onClick={more}
          disabled={loading}
          className="w-fit border-[1.5px] border-line px-4 py-2.5 font-mono text-sm text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {loading ? "carregando…" : `mais atualizações (${pageSize} por vez)`}
        </button>
      )}
    </section>
  );
}
