"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";
import type { Comment } from "@/lib/comments";
import { levelFor } from "@/lib/game";
import type { Post } from "@/lib/posts";
import { Avatar } from "@/components/Avatar";
import { MentionField } from "@/components/MentionField";
import { formatPostTime, PostCard, type PostCardMe } from "@/components/PostCard";
import { ReportDialog } from "@/components/ReportDialog";
import { RichText } from "@/components/RichText";

// /post/[id]: o card e a conversa. Comentário de topo aceita resposta; a
// resposta de uma resposta vai pro mesmo fio (1 nível só, com o @ na frente).

type Me = NonNullable<PostCardMe>;

const MAX = 1000;
const inputCls =
  "w-full resize-y rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  return { res, data };
}

function Composer({
  label,
  placeholder,
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus = false,
  testId,
}: {
  label: string;
  placeholder: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<string | null>;
  onCancel?: () => void;
  autoFocus?: boolean;
  testId: string;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit(text);
    setBusy(false);
    if (err) setError(err);
    else setText("");
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid={testId}>
      <MentionField
        value={text}
        onChange={setText}
        rows={2}
        maxLength={MAX}
        ariaLabel={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={inputCls}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !text.trim()} className="btn min-h-[40px]! rounded-[6px] px-4! py-2! text-[14px]! disabled:opacity-50">
          {busy ? "enviando…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="font-mono text-[13px] text-muted hover:underline">
            cancelar
          </button>
        )}
        {error && (
          <p role="alert" className="font-mono text-xs text-orange">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

function CommentItem({
  c,
  me,
  canModerate,
  onReply,
  onSaved,
  onRemoved,
  onAuthorHidden,
}: {
  c: Comment;
  me: Me;
  canModerate: boolean;
  onReply: (c: Comment) => void;
  onSaved: (c: Comment) => void;
  onRemoved: (c: Comment) => void;
  onAuthorHidden: (username: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = c.memberId === me.id;

  async function remove() {
    if (!confirm(c.parentId === null ? "Apagar este comentário? As respostas saem junto." : "Apagar esta resposta?")) return;
    const { res, data } = await send(`/api/posts/${c.postId}/comments/${c.id}`, "DELETE");
    if (!res || !res.ok) return setError(res ? userMessage(res, data, "Não deu pra apagar.") : "Sem conexão. Tente de novo.");
    onRemoved(c);
  }

  return (
    <div id={`c-${c.id}`} className="flex scroll-mt-24 flex-col gap-1.5 px-2 py-2 target:bg-mint" data-testid="comment">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Avatar username={c.username} name={c.name} avatarUrl={c.avatarUrl} size="sm" />
        <Link href={`/u/${c.username}`} className="font-mono text-[13px] font-semibold text-accent hover:underline">
          @{c.username}
        </Link>
        <span className="border border-line px-1 font-mono text-[11px] text-muted">LV{levelFor(c.xp).level.n}</span>
        <a href={`#c-${c.id}`} className="font-mono text-[12px] text-muted hover:text-accent">
          {formatPostTime(c.createdAt)}
        </a>
        {c.editedAt && <span className="font-mono text-[12px] text-muted">editado</span>}
      </div>
      {editing ? (
        <Composer
          label="editar comentário"
          placeholder=""
          initial={c.body}
          submitLabel="salvar"
          autoFocus
          testId="comment-edit"
          onCancel={() => setEditing(false)}
          onSubmit={async (text) => {
            const { res, data } = await send(`/api/posts/${c.postId}/comments/${c.id}`, "PATCH", { body: text });
            if (!res || !res.ok) return res ? userMessage(res, data, "Não deu pra salvar.") : "Sem conexão. Tente de novo.";
            onSaved({ ...c, ...(data.comment as Comment), replies: c.replies });
            setEditing(false);
            return null;
          }}
        />
      ) : (
        <RichText body={c.body} mentioned={c.mentionedUsernames} />
      )}
      {!editing && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-muted">
          <button type="button" onClick={() => onReply(c)} className="min-h-[28px] hover:text-accent">
            responder
          </button>
          {mine && (
            <button type="button" onClick={() => setEditing(true)} className="min-h-[28px] hover:text-accent">
              editar
            </button>
          )}
          {(mine || canModerate) && (
            <button type="button" onClick={remove} className="min-h-[28px] hover:text-orange">
              apagar
            </button>
          )}
          {!mine && (
            <ReportDialog
              targetType="comment"
              targetId={c.id}
              targetLabel="este comentário"
              authorUsername={c.username}
              triggerClassName="min-h-[28px] hover:text-orange"
              onReported={(r) => r.blocked && onAuthorHidden(r.blocked)}
            />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="font-mono text-xs text-orange">
          {error}
        </p>
      )}
    </div>
  );
}

export function PostView({ post: initialPost, comments: initial, me, backHref }: { post: Post; comments: Comment[]; me: Me; backHref: string }) {
  const router = useRouter();
  const [post, setPost] = useState(initialPost);
  const [comments, setComments] = useState<Comment[]>(initial);
  const [replyTo, setReplyTo] = useState<{ parentId: number; mention: string | null } | null>(null);
  const [gone, setGone] = useState<string | null>(null);

  const total = comments.reduce((s, c) => s + 1 + (c.replies?.length ?? 0), 0);

  function hideAuthor(username: string) {
    if (username === post.username) {
      setGone(username);
      return;
    }
    setComments((cs) =>
      cs.filter((c) => c.username !== username).map((c) => ({ ...c, replies: (c.replies ?? []).filter((r) => r.username !== username) })),
    );
  }

  function patch(next: Comment) {
    setComments((cs) =>
      cs.map((c) =>
        c.id === next.id ? next : { ...c, replies: (c.replies ?? []).map((r) => (r.id === next.id ? next : r)) },
      ),
    );
  }

  function drop(target: Comment) {
    setComments((cs) =>
      target.parentId === null
        ? cs.filter((c) => c.id !== target.id)
        : cs.map((c) => ({ ...c, replies: (c.replies ?? []).filter((r) => r.id !== target.id) })),
    );
  }

  async function comment(text: string, parentId: number | null): Promise<string | null> {
    const { res, data } = await send(`/api/posts/${post.id}/comments`, "POST", { body: text, parentId });
    if (!res || !res.ok) return res ? userMessage(res, data, "Não deu pra comentar. Tente de novo.") : "Sem conexão. Tente de novo.";
    const c = data.comment as Comment;
    if (parentId === null) setComments((cs) => [...cs, { ...c, replies: [] }]);
    else setComments((cs) => cs.map((x) => (x.id === parentId ? { ...x, replies: [...(x.replies ?? []), c] } : x)));
    setReplyTo(null);
    return null;
  }

  if (gone) {
    return (
      <div className="flex flex-col items-start gap-3 border-[1.5px] border-line p-5" role="status">
        <p className="text-[17px] font-bold">Você não vai mais ver conteúdo de @{gone}.</p>
        <Link href={backHref} className="btn rounded-[6px]">
          voltar
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="border-y-2 border-line py-5">
        <PostCard
          post={post}
          me={me}
          showThreadLink={false}
          onChange={setPost}
          onRemoved={() => router.push(backHref)}
          onAuthorHidden={hideAuthor}
        />
      </div>

      <section aria-labelledby="conversa" className="flex flex-col gap-4">
        <h2 id="conversa" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
          {total === 0 ? "conversa" : `${total} ${total === 1 ? "comentário" : "comentários"}`}
        </h2>
        {comments.length === 0 ? (
          <p className="border-[1.5px] border-dashed border-line px-4 py-5 font-mono text-[13px] text-muted" data-testid="thread-empty">
            Ninguém comentou ainda. Conta o que achou, pergunta como foi feito.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-line-soft border-y border-line" data-testid="thread">
            {comments.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-2">
                <CommentItem
                  c={c}
                  me={me}
                  canModerate={post.canModerate}
                  onReply={(t) => setReplyTo({ parentId: t.id, mention: null })}
                  onSaved={patch}
                  onRemoved={drop}
                  onAuthorHidden={hideAuthor}
                />
                {((c.replies?.length ?? 0) > 0 || replyTo?.parentId === c.id) && (
                  <div className="ml-3 flex flex-col gap-1 border-l-2 border-line pl-3 sm:ml-6" data-testid="replies">
                    {(c.replies ?? []).map((r) => (
                      <CommentItem
                        key={r.id}
                        c={r}
                        me={me}
                        canModerate={post.canModerate}
                        onReply={(t) => setReplyTo({ parentId: c.id, mention: t.username })}
                        onSaved={patch}
                        onRemoved={drop}
                        onAuthorHidden={hideAuthor}
                      />
                    ))}
                    {replyTo?.parentId === c.id && (
                      <div className="px-2 py-2">
                        <Composer
                          key={`${c.id}-${replyTo.mention ?? ""}`}
                          label={`responder @${c.username}`}
                          placeholder={`Responder @${c.username}`}
                          initial={replyTo.mention && replyTo.mention !== me.username ? `@${replyTo.mention} ` : ""}
                          submitLabel="responder"
                          autoFocus
                          testId="reply-form"
                          onCancel={() => setReplyTo(null)}
                          onSubmit={(text) => comment(text, c.id)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        <Composer
          label="comentar no post"
          placeholder="Comenta aí. Feedback concreto ajuda quem postou."
          submitLabel="comentar"
          testId="comment-form"
          onSubmit={(text) => comment(text, null)}
        />
      </section>
    </>
  );
}
