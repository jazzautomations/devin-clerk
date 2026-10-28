"use client";

import { useState } from "react";
import type { Post } from "@/lib/posts";
import { PostCard } from "@/components/PostCard";
import { PostComposer } from "@/components/PostComposer";

// Lista de posts com a caixa de postar em cima: /feed, /dashboard, mural da
// edição (spec 028) e mural da comunidade (migration 027). Cada post é um
// PostCard (migration 034); a conversa mora em /post/[id].

export type FeedPost = Post;

export function FeedSection({
  initialPosts,
  canPost = true,
  me = null,
  isAdmin = false,
  hackathonId = null,
  editionLabel = null,
  communitySlug = null,
}: {
  initialPosts: Post[];
  canPost?: boolean;
  /** @ de quem lê (null = sem conta) */
  me?: string | null;
  isAdmin?: boolean;
  hackathonId?: string | null;
  editionLabel?: string | null;
  /** mural da comunidade (migration 027): posta e recarrega com o escopo */
  communitySlug?: string | null;
}) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  // o PostCard decide "é meu" pelo id ou pelo @; o id sai do próprio feed
  const viewer = me
    ? { id: posts.find((p) => p.username === me)?.memberId ?? 0, username: me, role: isAdmin ? "admin" : "member" }
    : null;
  const context = { hackathonId, communitySlug };

  return (
    <div className="flex flex-col gap-4">
      {canPost && (
        <PostComposer
          hackathonId={hackathonId}
          communitySlug={communitySlug}
          editionLabel={editionLabel}
          onPosted={(p) => setPosts((ps) => [p, ...ps])}
        />
      )}

      {hackathonId && !canPost && <p className="font-mono text-[12px] text-muted">{"só inscritos postam no mural"}</p>}
      {communitySlug && !canPost && (
        <p className="font-mono text-[12px] text-muted">quem está na comunidade posta no mural</p>
      )}

      {posts.length === 0 ? (
        <p className="border-[1.5px] border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {hackathonId
            ? "mural vazio — seja o primeiro a postar da edição"
            : communitySlug
              ? "mural vazio. Conte o que a comunidade está construindo."
              : "feed vazio — seja o primeiro a postar o que tá construindo"}
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {posts.map((p) => (
            <li key={p.id} className="py-4">
              <PostCard
                post={p}
                me={viewer}
                context={context}
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
