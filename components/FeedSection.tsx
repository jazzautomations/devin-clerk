"use client";

import Link from "next/link";
import { useState } from "react";
import { levelFor } from "@/lib/game";
import { Avatar } from "@/components/Avatar";

export type FeedPost = {
  id: number;
  body: string;
  link: string | null;
  createdAt: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  persona: string | null;
  xp: number;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
};

export type FeedComment = {
  id: number;
  postId: number;
  body: string;
  createdAt: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  persona: string | null;
  xp: number;
};

const fmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function FeedSection({
  initialPosts,
  canPost = true,
  me = null,
  isAdmin = false,
}: {
  initialPosts: FeedPost[];
  canPost?: boolean;
  me?: string | null;
  isAdmin?: boolean;
}) {
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<"idle" | "posting" | "error">("idle");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [threads, setThreads] = useState<Record<number, FeedComment[]>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [sending, setSending] = useState<Record<number, boolean>>({});

  async function post() {
    setStatus("posting");
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, link: link || undefined }),
    });
    if (res.ok) {
      const { post } = await res.json();
      setPosts((p) => [post, ...p]);
      setBody("");
      setLink("");
      setStatus("idle");
    } else {
      setStatus("error");
    }
  }

  async function like(id: number) {
    if (!canPost) return;
    const res = await fetch(`/api/posts/${id}/like`, { method: "POST" });
    if (res.ok) {
      const { liked, likeCount } = await res.json();
      setPosts((ps) =>
        ps.map((p) =>
          p.id === id ? { ...p, likedByMe: liked, likeCount } : p,
        ),
      );
    }
  }

  // thread é lazy: só busca na primeira expansão — depois vive em cache
  async function toggleComments(id: number) {
    const next = !open[id];
    setOpen((o) => ({ ...o, [id]: next }));
    if (next && !threads[id]) {
      const res = await fetch(`/api/posts/${id}/comments`);
      if (res.ok) {
        const { comments } = await res.json();
        setThreads((t) => ({ ...t, [id]: comments }));
      }
    }
  }

  async function comment(id: number) {
    const text = (drafts[id] ?? "").trim();
    if (!text || sending[id]) return;
    setSending((s) => ({ ...s, [id]: true }));
    const res = await fetch(`/api/posts/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    if (res.ok) {
      const { comment: c } = await res.json();
      setThreads((t) => ({ ...t, [id]: [...(t[id] ?? []), c] }));
      setDrafts((d) => ({ ...d, [id]: "" }));
      setPosts((ps) =>
        ps.map((p) =>
          p.id === id ? { ...p, commentCount: p.commentCount + 1 } : p,
        ),
      );
    }
    setSending((s) => ({ ...s, [id]: false }));
  }

  // moderação: autor ou admin; otimista — se o DELETE falhar, refaz o fetch
  async function refreshPosts() {
    const res = await fetch("/api/posts");
    if (res.ok) {
      const { posts: fresh } = await res.json();
      setPosts(fresh);
    }
  }

  async function removePost(id: number) {
    if (!confirm("Apagar esse post? some junto com likes e comentários.")) {
      return;
    }
    setPosts((ps) => ps.filter((p) => p.id !== id));
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (!res.ok) await refreshPosts();
  }

  async function removeComment(postId: number, cid: number) {
    if (!confirm("Apagar esse comentário?")) return;
    setThreads((t) => ({
      ...t,
      [postId]: (t[postId] ?? []).filter((c) => c.id !== cid),
    }));
    setPosts((ps) =>
      ps.map((p) =>
        p.id === postId ? { ...p, commentCount: p.commentCount - 1 } : p,
      ),
    );
    const res = await fetch(`/api/posts/${postId}/comments/${cid}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const r = await fetch(`/api/posts/${postId}/comments`);
      if (r.ok) {
        const { comments } = await r.json();
        setThreads((t) => ({ ...t, [postId]: comments }));
        await refreshPosts();
      }
    }
  }

  const canDelete = (username: string) => isAdmin || username === me;

  return (
    <div className="flex flex-col gap-4">
      {canPost && (
        <div className="flex flex-col gap-3 border border-line bg-surface p-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="O que tu tá construindo? Posta a demo, o que quebrou, o que aprendeu…"
            className="w-full resize-none border border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none"
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="link do projeto/demo (opcional)"
              className="w-full border border-line bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none"
            />
            <button
              onClick={post}
              disabled={status === "posting" || !body.trim()}
              className="shrink-0 bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {status === "posting" ? "postando…" : "postar →"}
            </button>
          </div>
          {status === "error" && (
            <p className="font-mono text-xs text-red-400">
              {"// erro — link precisa começar com http(s)"}
            </p>
          )}
        </div>
      )}

      {posts.length === 0 ? (
        <p className="border border-dashed border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {"// feed vazio — seja o primeiro a postar o que tá construindo"}
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {posts.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Avatar
                    username={p.username}
                    name={p.name}
                    avatarUrl={p.avatarUrl}
                    size="sm"
                    className="self-center"
                  />
                  <Link
                    href={`/u/${p.username}`}
                    className="font-mono text-sm text-accent hover:underline"
                  >
                    {p.name ?? `@${p.username}`}
                  </Link>
                  <span className="font-mono text-xs text-muted">
                    @{p.username}
                  </span>
                  <span className="border border-line px-1.5 font-mono text-[10px] text-muted">
                    LV{levelFor(p.xp).level.n}
                  </span>
                  {p.persona && (
                    <span className="border border-accent/30 bg-accent/10 px-1.5 font-mono text-[10px] text-accent">
                      {p.persona}
                    </span>
                  )}
                  {p.headline && (
                    <span className="font-mono text-xs text-muted">
                      {p.headline}
                    </span>
                  )}
                </div>
                <span className="flex shrink-0 items-baseline gap-2 font-mono text-[10px] text-muted">
                  {fmt.format(new Date(p.createdAt + "Z"))}
                  {canDelete(p.username) && (
                    <button
                      onClick={() => removePost(p.id)}
                      title="apagar post"
                      aria-label="apagar post"
                      className="text-muted transition hover:text-red-400"
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
              <p className="text-sm leading-relaxed">{p.body}</p>
              <div className="flex items-center gap-4">
                {p.link && (
                  <a
                    href={p.link}
                    target="_blank"
                    rel="noopener"
                    className="border border-line px-2.5 py-1 font-mono text-xs text-muted transition hover:border-accent/50 hover:text-accent"
                  >
                    {p.link.replace(/^https?:\/\//, "").slice(0, 60)} ↗
                  </a>
                )}
                <button
                  onClick={() => toggleComments(p.id)}
                  className="font-mono text-xs text-muted transition hover:text-accent"
                >
                  {open[p.id] ? "▾" : "▸"} {p.commentCount}{" "}
                  {p.commentCount === 1 ? "comentário" : "comentários"}
                </button>
                <button
                  onClick={() => like(p.id)}
                  disabled={!canPost}
                  className={`ml-auto font-mono text-xs transition disabled:opacity-60 ${
                    p.likedByMe ? "text-accent" : "text-muted hover:text-accent"
                  }`}
                >
                  {p.likedByMe ? "▲" : "△"} {p.likeCount}
                </button>
              </div>

              {open[p.id] && (
                <div className="flex flex-col gap-3 border-l border-line pl-4">
                  {(threads[p.id] ?? []).map((c) => (
                    <div key={c.id} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Avatar
                          username={c.username}
                          name={c.name}
                          avatarUrl={c.avatarUrl}
                          size="sm"
                          className="self-center"
                        />
                        <Link
                          href={`/u/${c.username}`}
                          className="font-mono text-xs text-accent hover:underline"
                        >
                          @{c.username}
                        </Link>
                        <span className="border border-line px-1 font-mono text-[10px] text-muted">
                          LV{levelFor(c.xp).level.n}
                        </span>
                        {c.persona && (
                          <span className="border border-accent/30 bg-accent/10 px-1 font-mono text-[10px] text-accent">
                            {c.persona}
                          </span>
                        )}
                        <span className="font-mono text-[10px] text-muted">
                          {fmt.format(new Date(c.createdAt + "Z"))}
                        </span>
                        {canDelete(c.username) && (
                          <button
                            onClick={() => removeComment(p.id, c.id)}
                            title="apagar comentário"
                            aria-label="apagar comentário"
                            className="font-mono text-[10px] text-muted transition hover:text-red-400"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed text-muted">
                        {c.body}
                      </p>
                    </div>
                  ))}
                  {canPost ? (
                    <div className="flex gap-2">
                      <input
                        value={drafts[p.id] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") comment(p.id);
                        }}
                        maxLength={1000}
                        placeholder="comenta aí — feedback vale ouro"
                        className="w-full border border-line bg-background px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none"
                      />
                      <button
                        onClick={() => comment(p.id)}
                        disabled={sending[p.id] || !(drafts[p.id] ?? "").trim()}
                        className="shrink-0 bg-accent px-3 py-1.5 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
                      >
                        {sending[p.id] ? "…" : "comentar →"}
                      </button>
                    </div>
                  ) : (
                    <p className="font-mono text-[10px] text-muted/60">
                      {"// cria conta pra comentar"}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
