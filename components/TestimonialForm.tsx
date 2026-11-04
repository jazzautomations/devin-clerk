"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { userMessage } from "@/lib/apiError";

// Depoimento de time (migration 037). Formulário de escrever ou editar e os
// botões de quem recebe (aceitar, recusar, esconder, mostrar de novo) e de
// quem escreveu (apagar). Texto puro: o que a pessoa digita é o que aparece.

const MIN = 40;
const MAX = 600;

type FormProps = {
  /** @ de quem recebe */
  username: string;
  hackathonId: string;
  /** editar: id do depoimento e o texto atual */
  testimonialId?: number;
  initialBody?: string;
  /** o texto já está no perfil: editar manda de novo pra pessoa aceitar */
  accepted?: boolean;
};

const chars = (s: string) => [...s.trim()].length;

export function TestimonialForm({ username, hackathonId, testimonialId, initialBody = "", accepted = false }: FormProps) {
  const router = useRouter();
  const ids = useId();
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const n = chars(body);
  const editing = testimonialId !== undefined;
  const short = n < MIN;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (short) return setError(`Escreva pelo menos ${MIN} caracteres.`);
    if (n > MAX) return setError(`Até ${MAX} caracteres.`);
    setBusy(true);
    setError(null);
    const res = await fetch(editing ? `/api/testimonials/${testimonialId}` : "/api/testimonials", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing ? { body } : { username, hackathonId, body }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(userMessage(res, data, "Não deu pra enviar. Tente de novo."));
    setDone(editing ? (accepted ? `Salvo. Foi pra @${username} aceitar de novo.` : "Salvo.") : `Enviado. @${username} decide se aparece no perfil.`);
    // novo: sem refresh. A pessoa sai da lista "escrever" no refresh e o
    // aviso de enviado sumia junto; a lista atualiza na próxima visita.
    if (!editing) return setBody("");
    router.refresh();
  }

  if (done && !editing) {
    return (
      <p role="status" className="border-[1.5px] border-accent bg-mint px-4 py-3 font-mono text-[13px] text-accent" data-testid="testimonial-sent">
        {done}
      </p>
    );
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-2" data-testid={editing ? "testimonial-edit-form" : "testimonial-form"}>
      <label htmlFor={`${ids}-body`} className="font-mono text-[12px] text-muted">
        {editing ? "seu depoimento" : `seu depoimento sobre @${username}`}
      </label>
      <textarea
        id={`${ids}-body`}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setDone(null);
        }}
        rows={5}
        maxLength={MAX + 50}
        placeholder="O que essa pessoa fez no time, como foi trabalhar com ela, no que ela é boa."
        aria-describedby={`${ids}-count`}
        className="w-full resize-y border-[1.5px] border-line bg-background px-3 py-2 text-[15px] leading-relaxed text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none"
        data-testid="testimonial-body"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={`${ids}-count`} className={`font-mono text-[12px] ${n > MAX ? "text-orange" : "text-muted"}`} aria-live="polite">
          {short ? `${n} de ${MIN} no mínimo` : `${n}/${MAX}`}
        </p>
        <button type="submit" disabled={busy || short || n > MAX} className="btn min-h-[44px]! rounded-[6px] disabled:opacity-50" data-testid="testimonial-submit">
          {busy ? "enviando…" : editing ? "salvar" : "enviar depoimento"}
        </button>
      </div>
      {editing && accepted && (
        <p className="font-mono text-[12px] text-muted">Ele já está no perfil. Salvar uma mudança manda de novo pra @{username} aceitar.</p>
      )}
      {error && (
        <p role="alert" className="font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
      {done && editing && (
        <p role="status" className="font-mono text-[12.5px] text-accent" data-testid="testimonial-saved">
          {done}
        </p>
      )}
    </form>
  );
}

type Action = "accept" | "decline" | "hide" | "show" | "delete";

const LABEL: Record<Action, string> = {
  accept: "aceitar",
  decline: "recusar",
  hide: "esconder do perfil",
  show: "mostrar de novo",
  delete: "apagar",
};

type ActionsProps = {
  id: number;
  actions: Action[];
  /** texto que a tela mostra: aceitar e mostrar de novo mandam pra API conferir */
  body?: string;
};

export function TestimonialActions({ id, actions, body }: ActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(a: Action) {
    if (busy) return;
    if (a === "delete" && !confirmDelete) return setConfirmDelete(true);
    setBusy(a);
    setError(null);
    const url = a === "delete" ? `/api/testimonials/${id}` : `/api/testimonials/${id}/${a === "show" ? "accept" : a}`;
    const sendsBody = a === "accept" || a === "show";
    const res = await fetch(url, {
      method: a === "delete" ? "DELETE" : "POST",
      ...(sendsBody ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) } : {}),
    }).catch(() => null);
    if (!res) {
      setBusy(null);
      return setError("Sem conexão. Tente de novo.");
    }
    const data = (await res.json().catch(() => null)) as { writeBack?: string | null } | null;
    if (!res.ok) {
      setBusy(null);
      return setError(userMessage(res, data, "Não deu certo. Tente de novo."));
    }
    if (a === "accept") {
      const q = new URLSearchParams({ aba: "aceitar", aceito: "1" });
      if (data?.writeBack) q.set("escrever", data.writeBack);
      router.push(`/perfil/depoimentos?${q.toString()}`);
    }
    router.refresh();
    setBusy(null);
    setConfirmDelete(false);
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => run(a)}
            disabled={busy !== null}
            aria-busy={busy === a || undefined}
            className={`${a === "accept" || a === "show" ? "btn" : "btn-ghost"} min-h-[44px]! rounded-[6px] px-4! font-mono text-[14px]! disabled:opacity-60 ${
              a === "delete" && confirmDelete ? "border-orange! text-orange!" : ""
            }`}
            data-testid={`testimonial-${a}`}
          >
            {busy === a ? "…" : a === "delete" && confirmDelete ? "apagar mesmo" : LABEL[a]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="max-w-[40ch] font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}
