"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Post } from "@/lib/posts";
import { PostCard, type PostCardMe } from "@/components/PostCard";
import { PostComposer } from "@/components/PostComposer";
import type { TimelineTab } from "@/lib/timeline";

// A timeline do /feed (spec 046, onda 2). A primeira página vem do servidor
// (lib/timeline.timelinePage); aqui ficam só as coisas de interação: a caixa
// de postar, o "carregar mais" por cursor (?antes=) e o "N posts novos".
//
// O "N posts novos" é um GET /api/feed?aba=&desde=<id do topo> a cada 60s, e
// só com a aba visível: em background não gasta request. Clicar recarrega a
// primeira página e troca a lista. Sem WebSocket, sem push.
//
// Cronológico sempre: nada reordena por reação, seguidor ou tempo de tela.

export function TimelineList({
  aba,
  initialPosts,
  initialNext,
  me,
  canPost,
  children,
}: {
  aba: TimelineTab;
  initialPosts: Post[];
  initialNext: number | null;
  /** quem lê, pro PostCard saber o que é dele */
  me: PostCardMe;
  canPost: boolean;
  /** estado vazio: quem lista decide o texto (e as sugestões) */
  children?: ReactNode;
}) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [next, setNext] = useState<number | null>(initialNext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [novos, setNovos] = useState(0);
  // o id do topo, pro poll saber o que é "novo" (ref fora do render)
  const topId = posts[0]?.id ?? null;
  const topRef = useRef<number | null>(topId);
  useEffect(() => {
    topRef.current = topId;
  }, [topId]);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const top = topRef.current;
      if (!alive || document.visibilityState !== "visible" || !top) return;
      const res = await fetch(`/api/feed?aba=${aba}&desde=${top}`).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json().catch(() => null);
      if (alive && typeof data?.novos === "number") setNovos(data.novos);
    };
    const timer = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [aba]);

  async function loadMore() {
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/feed?aba=${aba}&antes=${next}`).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res?.status === 401 ? "Entre pra ver a timeline." : "Não deu pra carregar. Tente de novo.");
    const data = await res.json().catch(() => null);
    const more = Array.isArray(data?.posts) ? (data.posts as Post[]) : [];
    setPosts((ps) => {
      const seen = new Set(ps.map((p) => p.id));
      return [...ps, ...more.filter((p) => !seen.has(p.id))];
    });
    setNext(typeof data?.next === "number" ? data.next : null);
  }

  async function loadNewest() {
    setBusy(true);
    const res = await fetch(`/api/feed?aba=${aba}`).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("Não deu pra carregar. Tente de novo.");
    const data = await res.json().catch(() => null);
    if (Array.isArray(data?.posts)) setPosts(data.posts as Post[]);
    setNext(typeof data?.next === "number" ? data.next : null);
    setNovos(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="timeline" data-aba={aba}>
      {canPost && (aba === "seguindo" || aba === "tudo") && (
        <PostComposer onPosted={(p) => setPosts((ps) => [p, ...ps])} />
      )}

      {novos > 0 && (
        <button
          type="button"
          onClick={loadNewest}
          disabled={busy}
          className="btn-ghost min-h-[44px]! self-start rounded-[6px] font-mono text-[14px]!"
          data-testid="timeline-new-posts"
          aria-live="polite"
        >
          {novos === 1 ? "1 post novo" : `${novos} posts novos`}
        </button>
      )}

      {posts.length === 0 ? (
        children
      ) : (
        <ul className="divide-y divide-line border-y border-line" data-testid="timeline-posts">
          {posts.map((p) => (
            <li key={p.id} className="py-4">
              <PostCard
                post={p}
                me={me}
                onChange={(updated) => setPosts((ps) => ps.map((x) => (x.id === updated.id ? updated : x)))}
                onRemoved={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))}
                onAuthorHidden={(username) => setPosts((ps) => ps.filter((x) => x.username !== username))}
              />
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}

      {next !== null && posts.length > 0 && (
        <button
          type="button"
          onClick={loadMore}
          disabled={busy}
          className="btn-ghost min-h-[44px]! self-start rounded-[6px] font-mono text-[14px]!"
          data-testid="timeline-more"
        >
          {busy ? "carregando…" : "carregar mais"}
        </button>
      )}
    </div>
  );
}
