"use client";

import Link from "next/link";
import { useState } from "react";

type Post = {
  id: number;
  body: string;
  link: string | null;
  createdAt: string;
  username: string;
  name: string | null;
  headline: string | null;
};

const fmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function FeedSection({ initialPosts }: { initialPosts: Post[] }) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<"idle" | "posting" | "error">("idle");

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 border border-line bg-surface p-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="O que tu construiu? Posta a demo, o que quebrou, o que aprendeu…"
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
            {"// erro ao postar — link precisa começar com http(s)"}
          </p>
        )}
      </div>

      {posts.length === 0 ? (
        <p className="border border-dashed border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {"// feed vazio — seja o primeiro a postar o que tá construindo"}
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {posts.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/u/${p.username}`}
                    className="font-mono text-sm text-accent hover:underline"
                  >
                    @{p.username}
                  </Link>
                  {p.headline && (
                    <span className="font-mono text-xs text-muted">
                      {p.headline}
                    </span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-muted">
                  {fmt.format(new Date(p.createdAt + "Z"))}
                </span>
              </div>
              <p className="text-sm leading-relaxed">{p.body}</p>
              {p.link && (
                <a
                  href={p.link}
                  target="_blank"
                  rel="noopener"
                  className="w-fit border border-line px-2.5 py-1 font-mono text-xs text-muted transition hover:border-accent/50 hover:text-accent"
                >
                  {p.link.replace(/^https?:\/\//, "").slice(0, 60)} ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
