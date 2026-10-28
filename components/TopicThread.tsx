"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/Avatar";
import { ReportDialog } from "@/components/ReportDialog";
import { VoteButtons } from "@/components/VoteButtons";
import { userMessage } from "@/lib/apiError";
import type { TopicDetail, TopicPoll, TopicReply } from "@/lib/topics";
import { TOPIC_KIND_LABEL, TOPIC_LIMITS, timeAgo, type ReplySort } from "@/lib/topicsShared";

// Página do tópico (migration 058): o tópico com votos, enquete, árvore de
// respostas com recuo (no celular o recuo é pequeno e a linha vertical
// mostra o galho), responder no lugar, colapsar galho, ordenar respostas,
// marcar a que resolveu (autor da pergunta) e moderação (dono, organizador,
// admin). O markdown chega pronto do servidor (html); depois de cada ação a
// página é recarregada pelo router.refresh().

export type ThreadTopic = TopicDetail & { html: string };
export type ThreadReply = Omit<TopicReply, "children"> & { html: string; children: ThreadReply[] };
type Me = { id: number; username: string };

const field =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] leading-relaxed focus:border-accent focus:outline-none";
const linkBtn = "min-h-[32px] font-mono text-[12.5px] text-muted underline-offset-4 transition hover:text-foreground hover:underline disabled:opacity-50";

function useApi() {
  const router = useRouter();
  const [pending, start] = useTransition();
  async function call(url: string, method: string, body?: unknown, then: "refresh" | string = "refresh"): Promise<string | null> {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    if (!res) return "Sem conexão. Tente de novo.";
    const data = await res.json().catch(() => null);
    if (!res.ok) return userMessage(res, data, "Não deu certo. Tente de novo.");
    start(() => (then === "refresh" ? router.refresh() : router.push(then)));
    return null;
  }
  return { call, pending };
}

function countAll(list: ThreadReply[]): number {
  return list.reduce((n, r) => n + 1 + countAll(r.children), 0);
}

function Composer({
  onSend,
  onCancel,
  placeholder = "Escreva sua resposta",
  initial = "",
  submitLabel = "responder",
  autoFocus = false,
  testId = "reply-composer",
}: {
  onSend: (body: string) => Promise<string | null>;
  onCancel?: () => void;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  testId?: string;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setError("Escreva alguma coisa.");
    setBusy(true);
    setError(null);
    const err = await onSend(body);
    setBusy(false);
    if (err) return setError(err);
    setBody("");
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid={testId}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={TOPIC_LIMITS.reply}
        rows={3}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={`${field} min-h-[88px] resize-y`}
        data-testid="reply-body"
      />
      {error && (
        <p role="alert" className="font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-60" data-testid="reply-send">
          {busy ? "enviando…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={linkBtn}>
            cancelar
          </button>
        )}
      </div>
    </form>
  );
}

function Poll({ topicId, poll, canVote }: { topicId: number; poll: TopicPoll; canVote: boolean }) {
  const [state, setState] = useState(poll);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = canVote && !state.closed;
  async function vote(optionId: number) {
    if (!open || busy || optionId === state.myOptionId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/topics/${topicId}/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId }),
    }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) return setError(res ? userMessage(res, data, "Não deu pra votar.") : "Sem conexão.");
    setState(data.poll as TopicPoll);
  }
  return (
    <div className="flex flex-col gap-2" data-testid="topic-poll">
      <ul className="flex flex-col gap-2">
        {state.options.map((o) => {
          const pct = state.total ? Math.round((o.votes / state.total) * 100) : 0;
          const mine = state.myOptionId === o.id;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => vote(o.id)}
                disabled={!open || busy}
                aria-pressed={mine}
                className={`relative flex min-h-[44px] w-full items-center justify-between gap-3 overflow-hidden border-[1.5px] px-3 py-2 text-left transition ${
                  mine ? "border-foreground" : "border-line-soft"
                } ${open ? "hover:border-foreground" : "cursor-default"}`}
                data-testid="poll-option"
              >
                <span aria-hidden="true" className={`absolute inset-y-0 left-0 ${mine ? "bg-band/45" : "bg-mint"}`} style={{ width: `${pct}%` }} />
                <span className="relative min-w-0 text-[15px] font-semibold break-words">
                  {o.label}
                  {mine && <span className="ml-2 font-mono text-[11px] font-normal text-accent uppercase">seu voto</span>}
                </span>
                <span className="relative shrink-0 font-mono text-[12.5px] tabular-nums">
                  {pct}% · {o.votes}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="font-mono text-[12px] text-muted" data-testid="poll-total">
        {state.total} {state.total === 1 ? "voto" : "votos"}
        {state.closed ? " · enquete encerrada" : canVote ? (state.myOptionId ? " · toque em outra opção pra trocar" : " · toque numa opção pra votar") : " · só quem é da comunidade vota"}
      </p>
      {error && (
        <p role="alert" className="font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}

function ReplyNode({
  r,
  topic,
  me,
  canReply,
  collapsed,
  toggle,
}: {
  r: ThreadReply;
  topic: ThreadTopic;
  me: Me;
  canReply: boolean;
  collapsed: Set<number>;
  toggle: (id: number) => void;
}) {
  const router = useRouter();
  const { call, pending } = useApi();
  const [mode, setMode] = useState<"idle" | "reply" | "edit">("idle");
  const [error, setError] = useState<string | null>(null);
  const isCollapsed = collapsed.has(r.id);
  const gone = r.removed || r.deleted || r.hidden;
  const base = `/api/topics/${topic.id}/replies/${r.id}`;
  const canAccept = topic.mine && topic.kind === "pergunta" && !gone && !topic.removed;

  async function act(url: string, method: string, body?: unknown, ask?: string) {
    if (ask && !confirm(ask)) return;
    setError(null);
    const err = await call(url, method, body);
    if (err) setError(err);
  }

  const placeholder = r.removed ? "[removido pela moderação]" : r.deleted ? "[apagado]" : r.hidden ? "[resposta de alguém que você bloqueou ou silenciou]" : null;
  const voteReason = !topic.isMember ? "Entre na comunidade pra votar." : r.mine ? "Essa é sua." : gone ? "Saiu do ar." : null;

  return (
    <li id={`r-${r.id}`} className="scroll-mt-24" data-testid="reply" data-reply-id={r.id} data-depth={r.depth}>
      <div className={`flex flex-col gap-1.5 py-2.5 target:bg-mint ${r.accepted ? "border-[1.5px] border-accent bg-[#f1faf5] px-2.5" : ""}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => toggle(r.id)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? "abrir galho" : "fechar galho"}
            className="flex h-6 w-6 shrink-0 items-center justify-center border-[1.5px] border-line-soft font-mono text-[12px] leading-none hover:border-foreground"
            data-testid="reply-collapse"
          >
            {isCollapsed ? "+" : "−"}
          </button>
          {r.author ? (
            <Link href={`/u/${r.author.username}`} className="flex min-w-0 items-center gap-1.5 hover:text-accent">
              <Avatar username={r.author.username} name={r.author.name} avatarUrl={r.author.avatarUrl} size="sm" />
              <span className="truncate text-[14px] font-bold">{r.author.name ?? `@${r.author.username}`}</span>
            </Link>
          ) : (
            <span className="font-mono text-[12.5px] text-muted">[sem autor]</span>
          )}
          <span className="font-mono text-[11.5px] text-muted">
            {timeAgo(r.createdAt)}
            {r.editedAt ? " · editado" : ""}
          </span>
          {r.accepted && <span className="border-[1.5px] border-accent bg-mint px-1.5 font-mono text-[11px] text-accent uppercase">resolveu</span>}
          {isCollapsed && (
            <span className="font-mono text-[11.5px] text-muted">
              {r.score} {Math.abs(r.score) === 1 ? "ponto" : "pontos"}
              {r.children.length > 0 && ` · ${countAll(r.children)} escondidas`}
            </span>
          )}
        </div>

        {!isCollapsed && (
          <>
            {mode === "edit" ? (
              <Composer
                initial={r.body}
                submitLabel="salvar"
                autoFocus
                onCancel={() => setMode("idle")}
                testId="reply-edit"
                onSend={async (body) => {
                  const err = await call(base, "PATCH", { body });
                  if (!err) setMode("idle");
                  return err;
                }}
              />
            ) : placeholder ? (
              <p className="font-mono text-[13px] text-muted italic" data-testid="reply-placeholder">
                {placeholder}
              </p>
            ) : null}
            {mode !== "edit" && r.html && (
              <div
                className={`blog-body text-[15px] leading-relaxed break-words ${r.removed ? "border-l-2 border-orange pl-2 opacity-70" : ""}`}
                data-testid="reply-text"
                dangerouslySetInnerHTML={{ __html: r.html }}
              />
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <VoteButtons endpoint={`${base}/vote`} score={r.score} myVote={r.myVote} disabledReason={voteReason} orientation="horizontal" label="resposta" />
              {canReply && !gone && (
                <button type="button" onClick={() => setMode(mode === "reply" ? "idle" : "reply")} className={linkBtn} data-testid="reply-open">
                  responder
                </button>
              )}
              {canAccept && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(`/api/topics/${topic.id}/accept`, "POST", { replyId: r.accepted ? null : r.id })}
                  className={`${linkBtn} ${r.accepted ? "" : "text-accent!"}`}
                  data-testid="reply-accept"
                >
                  {r.accepted ? "desmarcar" : "marcar que resolveu"}
                </button>
              )}
              {r.mine && !r.removed && (
                <>
                  <button type="button" onClick={() => setMode("edit")} className={linkBtn} data-testid="reply-edit-open">
                    editar
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => act(base, "DELETE", undefined, "Apagar sua resposta? Se alguém respondeu embaixo, fica [apagado] no lugar.")}
                    className={linkBtn}
                    data-testid="reply-delete"
                  >
                    apagar
                  </button>
                </>
              )}
              {topic.canModerate && !r.mine && !r.removed && !r.deleted && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(base, "DELETE", undefined, "Remover esta resposta? Fica [removido pela moderação] e as respostas embaixo continuam.")}
                  className={`${linkBtn} hover:text-orange!`}
                  data-testid="reply-remove"
                >
                  remover
                </button>
              )}
              {!r.mine && r.author && !gone && (
                <ReportDialog targetType="topic_reply" targetId={r.id} targetLabel="esta resposta" authorUsername={r.author.username} onReported={() => router.refresh()} />
              )}
            </div>
            {error && (
              <p role="alert" className="font-mono text-[12.5px] text-orange">
                {error}
              </p>
            )}
            {mode === "reply" && (
              <div className="pt-1">
                <Composer
                  autoFocus
                  placeholder={r.author ? `Responder @${r.author.username}` : "Escreva sua resposta"}
                  onCancel={() => setMode("idle")}
                  onSend={async (body) => {
                    const err = await call(`/api/topics/${topic.id}/replies`, "POST", { body, parentId: r.id });
                    if (!err) setMode("idle");
                    return err;
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
      {!isCollapsed && r.children.length > 0 && (
        <ul className="ml-2.5 border-l-[1.5px] border-line-soft pl-2 sm:ml-3 sm:pl-4" data-testid="reply-children">
          {r.children.map((c) => (
            <ReplyNode key={c.id} r={c} topic={topic} me={me} canReply={canReply} collapsed={collapsed} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TopicThread({ topic, replies, me, sort, flairs = [] }: { topic: ThreadTopic; replies: ThreadReply[]; me: Me; sort: ReplySort; flairs?: string[] }) {
  const router = useRouter();
  const { call, pending } = useApi();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: topic.title, body: topic.body });
  const [flairEdit, setFlairEdit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slug = topic.communitySlug;
  const base = `/api/topics/${topic.id}`;
  const canReply = topic.isMember && !topic.locked && !topic.removed;
  const total = countAll(replies);

  const toggle = (id: number) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function act(method: string, body?: unknown, ask?: string, after?: () => void, then?: string) {
    if (ask && !confirm(ask)) return;
    setError(null);
    const err = await call(base, method, body, then);
    if (err) return setError(err);
    after?.();
  }

  const voteReason = !topic.isMember ? "Entre na comunidade pra votar." : topic.mine ? "Esse é seu." : topic.removed || topic.deleted ? "Saiu do ar." : null;

  return (
    <div className="flex min-w-0 flex-col gap-8" data-testid="topic-thread">
      <article className="flex min-w-0 gap-3 sm:gap-5" data-testid="topic">
        <VoteButtons endpoint={`${base}/vote`} score={topic.score} myVote={topic.myVote} disabledReason={voteReason} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {topic.pinned && <span className="border-[1.5px] border-foreground bg-foreground px-1.5 font-mono text-[11px] text-band uppercase">fixado</span>}
            {topic.locked && <span className="border-[1.5px] border-line px-1.5 font-mono text-[11px] uppercase" data-testid="topic-locked">trancado</span>}
            {topic.resolved && <span className="border-[1.5px] border-accent bg-mint px-1.5 font-mono text-[11px] text-accent uppercase">resolveu</span>}
            <span className="font-mono text-[11px] text-muted uppercase">{TOPIC_KIND_LABEL[topic.kind]}</span>
            {topic.flair && <span className="border border-line-soft bg-[#f3f3f3] px-1.5 font-mono text-[11.5px]" data-testid="topic-flair">{topic.flair}</span>}
          </div>

          {editing ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                act("PATCH", draft, undefined, () => setEditing(false));
              }}
              data-testid="topic-edit"
            >
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={TOPIC_LIMITS.title} className={`${field} text-[18px] font-bold`} aria-label="título" />
              <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} maxLength={TOPIC_LIMITS.body} rows={6} className={`${field} resize-y`} aria-label="texto" />
              <div className="flex gap-3">
                <button type="submit" disabled={pending} className="btn rounded-[6px]">
                  salvar
                </button>
                <button type="button" onClick={() => setEditing(false)} className={linkBtn}>
                  cancelar
                </button>
              </div>
            </form>
          ) : (
            <h1 className={`text-[clamp(1.6rem,4.5vw,2.4rem)] leading-[1.05] font-extrabold tracking-[-0.035em] break-words ${topic.removed || topic.deleted ? "text-muted" : ""}`} data-testid="topic-title">
              {topic.title}
            </h1>
          )}

          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12.5px] text-muted">
            {topic.author ? (
              <Link href={`/u/${topic.author.username}`} className="flex min-w-0 items-center gap-1.5 text-foreground hover:text-accent">
                <Avatar username={topic.author.username} name={topic.author.name} avatarUrl={topic.author.avatarUrl} size="sm" />
                <span className="truncate">@{topic.author.username}</span>
              </Link>
            ) : (
              <span>[apagado]</span>
            )}
            <span aria-hidden="true">·</span>
            <span>{timeAgo(topic.createdAt)}</span>
            {topic.editedAt && <span>· editado</span>}
          </p>

          {topic.removed && (
            <p className="border-[1.5px] border-orange px-3 py-2 font-mono text-[13px] text-orange" data-testid="topic-removed">
              [removido pela moderação]{topic.canModerate ? " Só a moderação vê o texto abaixo." : ""}
            </p>
          )}
          {topic.deleted && <p className="font-mono text-[13px] text-muted italic">[apagado] Quem escreveu apagou. A conversa ficou.</p>}

          {!editing && topic.html && (
            <div className="blog-body max-w-[68ch] text-[16px] leading-relaxed break-words" data-testid="topic-body" dangerouslySetInnerHTML={{ __html: topic.html }} />
          )}

          {topic.poll && <Poll topicId={topic.id} poll={topic.poll} canVote={topic.isMember && !topic.removed} />}

          {topic.resolved && topic.acceptedReplyId && (
            <a href={`#r-${topic.acceptedReplyId}`} className="self-start border-[1.5px] border-accent bg-mint px-3 py-2 font-mono text-[13px] text-accent hover:underline" data-testid="topic-resolved-link">
              resolvido · ver a resposta
            </a>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft pt-2">
            {topic.mine && !topic.removed && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraft({ title: topic.title, body: topic.body });
                    setEditing(true);
                  }}
                  className={linkBtn}
                  data-testid="topic-edit-open"
                >
                  editar
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act("DELETE", undefined, "Apagar seu tópico? Se alguém já respondeu, fica [apagado] no lugar e a conversa continua.", undefined, `/comunidade/${slug}/t`)}
                  className={linkBtn}
                  data-testid="topic-delete"
                >
                  apagar
                </button>
              </>
            )}
            {!topic.mine && topic.author && !topic.removed && (
              <ReportDialog targetType="topic" targetId={topic.id} targetLabel="este tópico" authorUsername={topic.author.username} onReported={() => router.push(`/comunidade/${slug}/t`)} />
            )}
          </div>

          {topic.canModerate && (
            <div className="flex flex-col gap-2 border-[1.5px] border-dashed border-line px-3 py-2.5" data-testid="topic-mod">
              <p className="font-mono text-[11px] tracking-[0.06em] text-muted uppercase">moderação</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {!topic.removed && (
                  <button type="button" disabled={pending} onClick={() => act("PATCH", { pinned: !topic.pinned })} className={linkBtn} data-testid="topic-pin">
                    {topic.pinned ? "soltar" : "fixar no topo"}
                  </button>
                )}
                <button type="button" disabled={pending} onClick={() => act("PATCH", { locked: !topic.locked })} className={linkBtn} data-testid="topic-lock">
                  {topic.locked ? "destrancar" : "trancar"}
                </button>
                {!topic.removed && (
                  <button type="button" onClick={() => setFlairEdit(flairEdit === null ? (topic.flair ?? "") : null)} className={linkBtn} data-testid="topic-flair-open">
                    trocar flair
                  </button>
                )}
                {!topic.removed && !topic.mine && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => act("DELETE", undefined, "Remover este tópico? Some da lista, fica [removido pela moderação] e as respostas continuam.")}
                    className={`${linkBtn} hover:text-orange!`}
                    data-testid="topic-remove"
                  >
                    remover
                  </button>
                )}
              </div>
              {flairEdit !== null && (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act("PATCH", { flair: flairEdit.trim() || null }, undefined, () => setFlairEdit(null));
                  }}
                >
                  <input
                    value={flairEdit}
                    onChange={(e) => setFlairEdit(e.target.value)}
                    maxLength={TOPIC_LIMITS.flair}
                    list="topic-flairs"
                    aria-label="flair"
                    className={`${field} max-w-[220px] py-1.5`}
                    data-testid="topic-flair-input"
                  />
                  <datalist id="topic-flairs">
                    {flairs.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                  <button type="submit" disabled={pending} className="btn rounded-[6px]">
                    salvar
                  </button>
                </form>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="font-mono text-[12.5px] text-orange">
              {error}
            </p>
          )}
        </div>
      </article>

      <section aria-labelledby="respostas-title" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b-[1.5px] border-line pb-2">
          <h2 id="respostas-title" className="text-[22px] leading-none font-extrabold tracking-[-0.03em]">
            {total} {total === 1 ? "resposta" : "respostas"}
          </h2>
          <nav aria-label="ordem das respostas" className="flex gap-1 font-mono text-[12.5px]">
            {(["melhores", "novas"] as const).map((s) => (
              <Link
                key={s}
                href={`/comunidade/${slug}/t/${topic.id}${s === "novas" ? "?ordem=novas" : ""}`}
                aria-current={sort === s ? "true" : undefined}
                className={`border-[1.5px] px-2.5 py-1 ${sort === s ? "border-foreground bg-foreground text-background" : "border-line-soft hover:border-foreground"}`}
                scroll={false}
              >
                {s}
              </Link>
            ))}
          </nav>
        </div>

        {topic.locked ? (
          <p className="border-[1.5px] border-line bg-[#f3f3f3] px-3 py-2.5 font-mono text-[13px]" data-testid="topic-locked-note">
            Tópico trancado. A conversa fica aqui, mas ninguém responde mais.
          </p>
        ) : topic.removed ? null : canReply ? (
          <Composer
            placeholder="Escreva sua resposta"
            testId="topic-reply-composer"
            onSend={(body) => call(`${base}/replies`, "POST", { body })}
          />
        ) : (
          <p className="border-[1.5px] border-line-soft px-3 py-2.5 text-[14.5px] text-muted" data-testid="topic-join-hint">
            Entre na comunidade pra responder e votar.{" "}
            <Link href={`/comunidade/${slug}`} className="text-accent underline underline-offset-4">
              ir pra comunidade
            </Link>
          </p>
        )}

        {replies.length > 0 ? (
          <ul className="flex min-w-0 flex-col divide-y divide-line-soft" data-testid="reply-tree">
            {replies.map((r) => (
              <ReplyNode key={r.id} r={r} topic={topic} me={me} canReply={canReply} collapsed={collapsed} toggle={toggle} />
            ))}
          </ul>
        ) : (
          <p className="font-mono text-[13px] text-muted" data-testid="replies-empty">
            Ninguém respondeu ainda.{canReply ? " Puxa a conversa." : ""}
          </p>
        )}
      </section>
    </div>
  );
}
