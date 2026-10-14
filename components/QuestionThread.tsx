"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";
import { useRouter } from "next/navigation";
import type { Question } from "@/lib/questions";

// spec 033 US3 — thread de dúvidas. Inscrito pergunta; organização/mentor
// (canModerate) respondem e marcam resolvida. Datas chegam formatadas.
export function QuestionThread({
  hackathonId,
  questions,
  canAsk,
  canModerate,
}: {
  hackathonId: string;
  questions: (Question & { when: string })[];
  canAsk: boolean;
  canModerate: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/hackathons/${hackathonId}/questions`;

  async function call(url: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(userMessage(res, data, "não deu pra enviar. Tente de novo."));
      return false;
    }
    router.refresh();
    return true;
  }

  const field =
    "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";
  const open = questions.filter((q) => !q.resolvedAt).length;

  return (
    <div className="flex flex-col gap-6">
      {canAsk && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (draft.trim() && (await call(base, "POST", { body: draft }))) setDraft("");
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[12px] tracking-widest text-muted uppercase">sua dúvida</span>
            <textarea
              className={field}
              rows={3}
              maxLength={2000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Pode time de 5 pessoas? Tem tomada no local?"
            />
          </label>
          <button type="submit" className="btn w-fit rounded-[6px] disabled:opacity-50" disabled={busy || !draft.trim()}>
            perguntar
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}

      <p className="font-mono text-[12px] tracking-widest text-muted uppercase">
        {questions.length === 0 ? "nenhuma dúvida ainda" : `${open} aberta${open === 1 ? "" : "s"} · ${questions.length} no total`}
      </p>
      <ol className="flex flex-col border-b border-line">
        {questions.map((q) => (
          <QuestionItem
            key={q.id}
            q={q}
            canModerate={canModerate}
            busy={busy}
            onAnswer={(body) => call(`${base}/${q.id}/answers`, "POST", { body })}
            onResolve={(resolved) => call(`${base}/${q.id}`, "PATCH", { resolved })}
          />
        ))}
      </ol>
    </div>
  );
}

function QuestionItem({
  q,
  canModerate,
  busy,
  onAnswer,
  onResolve,
}: {
  q: Question & { when: string };
  canModerate: boolean;
  busy: boolean;
  onAnswer: (body: string) => Promise<boolean>;
  onResolve: (resolved: boolean) => Promise<boolean>;
}) {
  const [reply, setReply] = useState("");
  const resolved = Boolean(q.resolvedAt);
  return (
    <li id={`q${q.id}`} data-testid="question" className="flex scroll-mt-24 flex-col gap-3 border-t border-line py-5">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-muted">
        <span className="text-foreground">@{q.username}</span>
        <time>{q.when}</time>
        <span className={resolved ? "chip bare border-accent text-accent" : "chip bare"}>
          {resolved ? "resolvida" : "aberta"}
        </span>
      </p>
      <p className="text-[16px] leading-relaxed font-semibold break-words whitespace-pre-line">{q.body}</p>
      {q.answers.length > 0 && (
        <ul className="flex flex-col gap-3 border-l-4 border-accent pl-4">
          {q.answers.map((a) => (
            <li key={a.id} className="flex flex-col gap-1">
              <p className="font-mono text-[12px] text-accent">@{a.username} · equipe da edição</p>
              <p className="text-[15px] leading-relaxed break-words whitespace-pre-line">{a.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canModerate && (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label="responder"
            className="w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[14px] focus:border-accent focus:outline-none"
            rows={2}
            maxLength={2000}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="responder…"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn min-h-0! rounded-[6px] px-3! py-1.5! text-[13px]! disabled:opacity-50"
              disabled={busy || !reply.trim()}
              onClick={async () => {
                if (await onAnswer(reply)) setReply("");
              }}
            >
              responder
            </button>
            <button
              type="button"
              className="btn-ghost min-h-0! rounded-[6px] px-3! py-1.5! text-[13px]! disabled:opacity-50"
              disabled={busy}
              onClick={() => onResolve(!resolved)}
            >
              {resolved ? "reabrir" : "marcar resolvida"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
