"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EditionQuestion } from "@/lib/registrationForm";
import {
  EMPTY_TERMS,
  TermsAcceptBoxes,
  TermsPersonalFields,
  ageOnDay,
  termsPayload,
  type TermsConfig,
  type TermsValue,
} from "@/components/EventTermsFields";

type Value = string | string[] | boolean | undefined;

// códigos de erro das APIs de inscrição/candidatura → texto pra pessoa
const ERROR_TEXT: Record<string, string> = {
  consent_required: "marque o aceite dos termos pra concluir",
  kind_closed: "esse tipo de candidatura fechou nesta edição",
  conflict_participant: "você está inscrito como participante nesta edição; quem compete não ajuda na mesma",
  duplicate: "você já se candidatou a esse tipo nesta edição",
  already_has_role: "você já tem esse papel nesta edição",
  edition_over: "edição encerrada",
  registration_closed: "as inscrições desta edição estão encerradas",
  not_found: "esta edição não recebe inscrição pelo HackaHub",
  birth_date_required: "informe sua data de nascimento",
  birth_date_invalid: "data de nascimento inválida",
  guardian_required: "menor de 18 precisa informar o nome completo do responsável legal",
  guardian_email_invalid: "informe um e-mail válido do responsável legal",
  guardian_email_same: "o e-mail do responsável precisa ser diferente do seu",
  guardian_consent_required: "confirme que seu responsável legal autorizou a participação",
  conduct_required: "aceite o código de conduta da edição pra concluir",
  conduct_outdated: "o código de conduta foi atualizado; recarregue a página",
};

export function errorText(code: string): string {
  if (code.startsWith("conflict_role:")) {
    return "você se candidatou pra ajudar nesta edição; quem ajuda não se inscreve como participante na mesma";
  }
  return ERROR_TEXT[code] ?? code;
}

const field =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 text-[16px] text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none aria-invalid:border-orange";

const isEmpty = (v: Value) =>
  v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);

// chave de cada erro no estado: "q-<id>" (pergunta), "birthDate", "consent",
// "conduct" e "form" (erro geral do servidor)
type Errors = Record<string, string>;

// primeiro controle focável do campo com erro (pergunta, data, caixa de aceite)
function focusField(key: string) {
  const el = document.querySelector<HTMLElement>(
    key.startsWith("q-") ? `#${key} input, #${key} textarea` : `[data-field="${key}"]`,
  );
  el?.focus();
  el?.scrollIntoView({ block: "center" });
}

// spec 033 US1 — formulário de inscrição da edição. Mobile-first: uma coluna,
// campos de 16px (sem zoom no iOS), escolhas como alvos grandes de toque.
// O que já está no perfil (nome, e-mail, GitHub) só aparece como resumo.
// Frente E: o mesmo formulário serve a candidatura (voluntário/mentor/
// jurado) — `target` troca endpoint, texto do botão e destino.
// Validação: tudo de uma vez no envio (lista do que falta + foco no
// primeiro), e o erro de cada campo some quando ele muda.
export function RegistrationForm({
  hackathonId,
  questions,
  consentText,
  signedIn,
  requiresApproval = false,
  full = false,
  target,
  terms,
}: {
  hackathonId: string;
  questions: EditionQuestion[];
  consentText: string;
  signedIn: boolean;
  requiresApproval?: boolean;
  full?: boolean;
  target?: { submitUrl: string; cta: string; pagePath: string };
  /** frente L — termos do evento (só na inscrição de participante) */
  terms?: TermsConfig;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<number, Value>>({});
  const [consent, setConsent] = useState(false);
  const [listed, setListed] = useState(false);
  const [tv, setTv] = useState<TermsValue>(EMPTY_TERMS);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const clear = (...keys: string[]) =>
    setErrors((e) => {
      if (!keys.some((k) => k in e) && !("form" in e)) return e;
      const next = { ...e };
      for (const k of [...keys, "form"]) delete next[k];
      return next;
    });
  const set = (id: number, v: Value) => {
    setValues((s) => ({ ...s, [id]: v }));
    clear(`q-${id}`);
  };
  const patchTerms = (p: Partial<TermsValue>) => {
    setTv((s) => ({ ...s, ...p }));
    clear(...Object.keys(p));
  };

  function validate(): Errors {
    const out: Errors = {};
    for (const q of questions) {
      if (q.required && isEmpty(values[q.id])) out[`q-${q.id}`] = `responda: ${q.label}`;
    }
    if (terms) {
      const age = ageOnDay(tv.birthDate, terms.eventDay);
      if (age === null) out.birthDate = "informe sua data de nascimento";
      else if (age < terms.minAge) {
        out.birthDate = `Esta edição é para quem tem ${terms.minAge} anos ou mais na data do evento.`;
      }
    }
    if (!consent) out.consent = "marque o aceite dos termos pra concluir";
    if (terms && !tv.conduct) out.conduct = "aceite o código de conduta da edição pra concluir";
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local = validate();
    if (Object.keys(local).length > 0) {
      setErrors(local);
      focusField(Object.keys(local)[0]);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch(target?.submitUrl ?? `/api/hackathons/${hackathonId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: true,
          answers: values,
          ...(target ? {} : { publicListing: listed }),
          ...(terms ? { terms: termsPayload(terms, tv) } : {}),
        }),
      });
      if (res.status === 401) {
        router.push(`/sign-in?redirect_url=${encodeURIComponent(target?.pagePath ?? `/h/${hackathonId}/inscricao`)}`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const qid = typeof data?.questionId === "number" ? data.questionId : null;
        const text =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.error === "string"
              ? errorText(data.error)
              : res.status === 429
                ? "muitas tentativas seguidas. Espere alguns minutos e tente de novo."
                : "não deu certo. Tente de novo.";
        const key = qid ? `q-${qid}` : "form";
        setErrors({ [key]: text });
        if (qid) focusField(key);
        return;
      }
      if (target) {
        router.refresh();
        return;
      }
      router.push(`/h/${hackathonId}?inscricao=${data?.status ?? "ok"}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const cta = target
    ? target.cta
    : full
    ? "entrar na fila de espera"
    : requiresApproval
      ? "enviar pedido de lugar"
      : "concluir inscrição";

  const list = Object.entries(errors);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" data-testid="registration-form">
      <ol className="flex flex-col gap-6">
        {questions.map((q, i) => {
          const errId = `q-${q.id}-err`;
          const err = errors[`q-${q.id}`];
          const a11y = {
            "aria-invalid": err ? true : undefined,
            "aria-describedby": err ? errId : undefined,
            "aria-required": q.required || undefined,
          };
          const v = values[q.id];
          return (
            <li key={q.id} id={`q-${q.id}`} className="flex flex-col gap-2 border-t border-line pt-4">
              <p id={`q-${q.id}-label`} className="flex items-baseline gap-2.5 text-[17px] leading-snug font-bold">
                <span className="font-mono text-[13px] font-medium text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 break-words">
                  {q.label}
                  {q.required ? (
                    <>
                      <span className="ml-1 text-orange" aria-hidden="true">*</span>
                      <span className="sr-only"> (obrigatória)</span>
                    </>
                  ) : (
                    <span className="ml-2 font-mono text-[12px] font-normal text-muted">opcional</span>
                  )}
                </span>
              </p>
              {q.kind === "short_text" && (
                <input
                  aria-labelledby={`q-${q.id}-label`}
                  {...a11y}
                  className={field}
                  maxLength={200}
                  value={typeof v === "string" ? v : ""}
                  onChange={(e) => set(q.id, e.target.value)}
                />
              )}
              {q.kind === "long_text" && (
                <textarea
                  aria-labelledby={`q-${q.id}-label`}
                  {...a11y}
                  className={`${field} min-h-28`}
                  maxLength={2000}
                  value={typeof v === "string" ? v : ""}
                  onChange={(e) => set(q.id, e.target.value)}
                />
              )}
              {(q.kind === "single" || q.kind === "yes_no") && (
                <div role="radiogroup" aria-labelledby={`q-${q.id}-label`} {...a11y} className="flex flex-wrap gap-2">
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
                <div
                  role="group"
                  aria-labelledby={`q-${q.id}-label`}
                  aria-describedby={a11y["aria-describedby"]}
                  className="flex flex-wrap gap-2">
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
              {err && (
                <p id={errId} className="font-mono text-[13px] text-orange">
                  {err}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {terms && (
        <TermsPersonalFields cfg={terms} value={tv} onChange={patchTerms} birthDateError={errors.birthDate} />
      )}

      <ConsentBox
        text={consentText}
        checked={consent}
        onChange={(v) => {
          setConsent(v);
          clear("consent");
        }}
        invalid={!!errors.consent}
      />
      {!target && <PublicListingBox checked={listed} onChange={setListed} />}

      {terms && <TermsAcceptBoxes cfg={terms} value={tv} onChange={patchTerms} conductInvalid={!!errors.conduct} />}

      <div role="alert" className="empty:hidden">
        {list.length === 1 && (
          <p className="font-mono text-[13px] text-orange">{list[0][1]}</p>
        )}
        {list.length > 1 && (
          <div className="flex flex-col gap-1 border-[1.5px] border-orange p-3 font-mono text-[13px] text-orange">
            <p>falta pra concluir:</p>
            <ul className="list-disc pl-5">
              {list.map(([k, t]) => (
                <li key={k}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <button type="submit" disabled={busy} className="btn w-full rounded-[6px] disabled:opacity-60">
        {busy ? "enviando…" : signedIn ? cta : `entrar e ${cta}`}
      </button>
    </form>
  );
}

// frente N #6 — aparecer na lista pública de inscritos é opt-in separado do
// aceite (que só cobre organizar o evento). Nunca vem marcada.
export function PublicListingBox({
  checked,
  onChange,
  tone = "paper",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  tone?: "paper" | "dark";
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 text-[13px] leading-snug ${
        tone === "dark" ? "text-mint" : "border-[1.5px] border-line p-3.5 text-foreground"
      }`}
    >
      <input
        type="checkbox"
        name="publicListing"
        data-testid="public-listing-optin"
        className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        {"Opcional: quero aparecer na lista pública de inscritos desta edição (@usuário e foto). Dá pra desligar depois."}
      </span>
    </label>
  );
}

// caixa de consentimento LGPD (FR-002): termos + política + finalidade com
// organização e parceiros nomeados. Nunca vem marcada.
export function ConsentBox({
  text,
  checked,
  onChange,
  tone = "paper",
  invalid = false,
}: {
  text: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tone?: "paper" | "dark";
  invalid?: boolean;
}) {
  const link = tone === "dark" ? "underline text-band" : "underline text-accent";
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 text-[13px] leading-snug ${
        tone === "dark"
          ? "text-mint"
          : `border-[1.5px] ${invalid ? "border-orange" : "border-line"} bg-mint/50 p-3.5 text-foreground`
      }`}
    >
      <input
        type="checkbox"
        name="consent"
        data-field="consent"
        aria-required="true"
        aria-invalid={invalid || undefined}
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
