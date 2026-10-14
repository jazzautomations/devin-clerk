"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// formulário do jurado (spec 033 US5): nota 1–5 por critério + nota
// interna pra organização. Só aparece pra projeto atribuído; a API confere
// de novo. roadmap 037 #9: comentário pro time por critério e geral — o time
// lê depois da publicação, sem o nome do jurado.

const area =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none";

export function JudgeScoreForm({
  hackathonId,
  team,
  criteria,
  initial,
  initialComment,
  initialFeedback = {},
  initialGeneral = null,
  locked,
}: {
  hackathonId: string;
  team: { id: number; name: string; title: string | null };
  criteria: { id: number; label: string }[];
  initial: Record<number, number>;
  initialComment: string | null;
  initialFeedback?: Record<number, string>;
  initialGeneral?: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<number, number>>(initial);
  const [comment, setComment] = useState(initialComment ?? "");
  const [feedback, setFeedback] = useState<Record<number, string>>(initialFeedback);
  const [general, setGeneral] = useState(initialGeneral ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const complete = criteria.every((c) => scores[c.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError("");
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/juri/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: team.id,
        scores: criteria
          .filter((c) => scores[c.id])
          .map((c) => ({ criterionId: c.id, score: scores[c.id], feedback: feedback[c.id] ?? "" })),
        comment,
        feedback: general,
      }),
    });
    if (res.ok) {
      setStatus("saved");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "não deu pra salvar");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-[1.5px] border-line p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xl font-extrabold tracking-[-0.02em] break-words">{team.title ?? team.name}</h3>
        <span className={`font-mono text-[12px] ${complete ? "text-accent" : "text-muted"}`}>
          {complete ? "avaliado" : "pendente"}
        </span>
      </div>
      {team.title && team.title !== team.name && <p className="-mt-3 font-mono text-[12px] text-muted">{team.name}</p>}
      <fieldset disabled={locked} className="flex flex-col gap-3">
        {criteria.map((c) => (
          <div key={c.id} className="flex flex-col gap-2 border-b border-line pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 font-medium break-words">{c.label}</span>
              <div role="radiogroup" aria-label={c.label} className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = scores[c.id] === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${c.label}: ${n}`}
                      onClick={() => setScores((s) => ({ ...s, [c.id]: n }))}
                      className={`h-10 w-10 rounded-[6px] border-[1.5px] font-mono text-sm ${
                        on ? "border-accent bg-accent text-white" : "border-line hover:border-accent"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-muted">comentário pro time sobre {c.label} (opcional, anônimo)</span>
              <textarea
                value={feedback[c.id] ?? ""}
                onChange={(e) => setFeedback((f) => ({ ...f, [c.id]: e.target.value }))}
                maxLength={2000}
                rows={2}
                aria-label={`comentário pro time: ${c.label}`}
                className={area}
              />
            </label>
          </div>
        ))}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">feedback geral pro time (opcional, anônimo)</span>
          <textarea
            value={general}
            onChange={(e) => setGeneral(e.target.value)}
            maxLength={2000}
            rows={3}
            className={area}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">nota interna pra organização (o time não vê)</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            rows={2}
            className={area}
          />
        </label>
      </fieldset>
      {locked ? (
        <p className="font-mono text-[12px] text-muted">Resultado publicado: notas travadas.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={status === "saving" || Object.keys(scores).length === 0}
            className="btn disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "saving" ? "salvando…" : "salvar notas"}
          </button>
          {status === "saved" && <span className="font-mono text-[12px] text-accent">salvo</span>}
          {error && (
            <span role="alert" className="font-mono text-[12px] text-orange">
              {error}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
