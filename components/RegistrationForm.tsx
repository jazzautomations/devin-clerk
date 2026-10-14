"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EditionQuestion } from "@/lib/registrationForm";

type Value = string | string[] | boolean | undefined;

const field =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 text-[16px] text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

// spec 033 US1 — formulário de inscrição da edição. Mobile-first: uma coluna,
// campos de 16px (sem zoom no iOS), escolhas como alvos grandes de toque.
// O que já está no perfil (nome, e-mail, GitHub) só aparece como resumo.
export function RegistrationForm({
  hackathonId,
  questions,
  consentText,
  signedIn,
  requiresApproval,
  full,
}: {
  hackathonId: string;
  questions: EditionQuestion[];
  consentText: string;
  signedIn: boolean;
  requiresApproval: boolean;
  full: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<number, Value>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; questionId: number | null } | null>(null);

  const set = (id: number, v: Value) => setValues((s) => ({ ...s, [id]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) {
      setError({ text: "marque o aceite dos termos pra concluir", questionId: null });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, answers: values }),
      });
      if (res.status === 401) {
        router.push(`/sign-in?redirect_url=${encodeURIComponent(`/h/${hackathonId}/inscricao`)}`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const qid = typeof data?.questionId === "number" ? data.questionId : null;
        setError({ text: typeof data?.error === "string" ? data.error : "não deu certo, tente de novo", questionId: qid });
        if (qid) document.getElementById(`q-${qid}`)?.scrollIntoView({ block: "center" });
        return;
      }
      router.push(`/h/${hackathonId}?inscricao=${data?.status ?? "ok"}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const cta = full
    ? "entrar na fila de espera"
    : requiresApproval
      ? "enviar pedido de lugar"
      : "concluir inscrição";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" data-testid="registration-form">
      <ol className="flex flex-col gap-6">
        {questions.map((q, i) => {
          const invalid = error?.questionId === q.id;
          const v = values[q.id];
          return (
            <li key={q.id} id={`q-${q.id}`} className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="flex items-baseline gap-2.5 text-[17px] leading-snug font-bold">
                <span className="font-mono text-[13px] font-medium text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 break-words">
                  {q.label}
                  {q.required ? (
                    <span className="ml-1 text-orange" aria-label="obrigatória">*</span>
                  ) : (
                    <span className="ml-2 font-mono text-[12px] font-normal text-muted">opcional</span>
                  )}
                </span>
              </p>
              {q.kind === "short_text" && (
                <input
                  aria-label={q.label}
                  aria-invalid={invalid}
                  className={field}
                  maxLength={200}
                  value={typeof v === "string" ? v : ""}
                  onChange={(e) => set(q.id, e.target.value)}
                />
              )}
              {q.kind === "long_text" && (
                <textarea
                  aria-label={q.label}
                  aria-invalid={invalid}
                  className={`${field} min-h-28`}
                  maxLength={2000}
                  value={typeof v === "string" ? v : ""}
                  onChange={(e) => set(q.id, e.target.value)}
                />
              )}
              {(q.kind === "single" || q.kind === "yes_no") && (
                <div role="radiogroup" aria-label={q.label} className="flex flex-wrap gap-2">
                  {(q.kind === "yes_no" ? ["sim", "não"] : q.options).map((o) => {
                    const on = v === o;
                    return (
                      <label
                        key={o}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[6px] border-[1.5px] px-3.5 py-2 text-[15px] ${
                          on ? "border-accent bg-mint font-semibold text-accent" : "border-line"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          className="accent-[#047a43]"
                          checked={on}
                          onChange={() => set(q.id, o)}
                        />
                        {o}
                      </label>
                    );
                  })}
                </div>
              )}
              {q.kind === "multi" && (
                <div role="group" aria-label={q.label} className="flex flex-wrap gap-2">
                  {q.options.map((o) => {
                    const list = Array.isArray(v) ? v : [];
                    const on = list.includes(o);
                    return (
                      <label
                        key={o}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[6px] border-[1.5px] px-3.5 py-2 text-[15px] ${
                          on ? "border-accent bg-mint font-semibold text-accent" : "border-line"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="accent-[#047a43]"
                          checked={on}
                          onChange={() => set(q.id, on ? list.filter((x) => x !== o) : [...list, o])}
                        />
                        {o}
                      </label>
                    );
                  })}
                </div>
              )}
              {invalid && <p className="font-mono text-[13px] text-orange">{error?.text}</p>}
            </li>
          );
        })}
      </ol>

      <ConsentBox text={consentText} checked={consent} onChange={setConsent} />

      {error && error.questionId === null && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error.text === "consent_required" ? "marque o aceite dos termos pra concluir" : error.text}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn w-full rounded-[6px] disabled:opacity-60">
        {busy ? "enviando…" : signedIn ? cta : `entrar e ${cta}`}
      </button>
    </form>
  );
}

// caixa de consentimento LGPD (FR-002): termos + política + finalidade com
// organização e parceiros nomeados. Nunca vem marcada.
export function ConsentBox({
  text,
  checked,
  onChange,
  tone = "paper",
}: {
  text: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tone?: "paper" | "dark";
}) {
  const link = tone === "dark" ? "underline text-band" : "underline text-accent";
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 text-[13px] leading-snug ${
        tone === "dark" ? "text-mint" : "border-[1.5px] border-line bg-mint/50 p-3.5 text-foreground"
      }`}
    >
      <input
        type="checkbox"
        name="consent"
        className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        {text}{" "}
        <Link href="/legal/termos" target="_blank" className={link}>
          termos
        </Link>{" "}
        ·{" "}
        <Link href="/legal/privacidade" target="_blank" className={link}>
          privacidade
        </Link>
      </span>
    </label>
  );
}
