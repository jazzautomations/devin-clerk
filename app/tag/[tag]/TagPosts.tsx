"use client";

import { useState } from "react";
import type { Post } from "@/lib/posts";
import { PostCard, type PostCardMe } from "@/components/PostCard";
import { PostComposer } from "@/components/PostComposer";

// Lista de posts de uma tag (spec 046, onda 2, mencoes-e-tags): o card é o
// mesmo do feed e a caixa de postar já vem com "#tag " no começo. Quem posta
// daqui entra na tag sem precisar digitar de novo.

export function TagPosts({
  tag,
  initialPosts,
  me,
  canPost = true,
  emptyText,
}: {
  tag: string;
  initialPosts: Post[];
  me: PostCardMe;
  canPost?: boolean;
  emptyText: string;
}) {
  const [posts, setPosts] = useState(initialPosts);

  return (
    <div className="flex flex-col gap-4">
      {canPost && <PostComposer initialBody={`#${tag} `} onPosted={(p) => setPosts((ps) => [p, ...ps])} />}
      {posts.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-line px-4 py-6 font-mono text-[13px] text-muted" data-testid="tag-posts-empty">
          {emptyText}
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line" data-testid="tag-posts">
          {posts.map((p) => (
            <li key={p.id} className="py-4">
              <PostCard
                post={p}
                me={me}
                onChange={(next) => setPosts((ps) => ps.map((x) => (x.id === next.id ? next : x)))}
                onRemoved={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))}
                onAuthorHidden={(username) => setPosts((ps) => ps.filter((x) => x.username !== username))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
