"use client";

import { useRef, useState } from "react";
import { userMessage } from "@/lib/apiError";

const field =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 text-[16px] text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";
const label = "font-mono text-[12px] tracking-widest text-muted uppercase";

// frente L — formulário do canal de denúncia. Anônimo por padrão pra quem
// não está logado; logado escolhe (a caixa de anonimato vem DESMARCADA e
// diz o que muda — nada de empurrar a pessoa pra um lado).
export function IncidentForm({
  hackathonId,
  kinds,
  signedIn,
}: {
  hackathonId: string;
  kinds: { value: string; label: string }[];
  signedIn: boolean;
}) {
  const [kind, setKind] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [contact, setContact] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // qual campo o erro aponta: ganha aria-invalid, aria-describedby e o foco
  const [errorField, setErrorField] = useState<"kind" | "description" | null>(null);
  const [website, setWebsite] = useState("");
  const [sent, setSent] = useState<{ anonymous: boolean } | null>(null);
  const kindRef = useRef<HTMLSelectElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  function fieldError(field: "kind" | "description", msg: string) {
    setError(msg);
    setErrorField(field);
    (field === "kind" ? kindRef : descriptionRef).current?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return fieldError("kind", "escolha o tipo do problema");
    if (description.trim().length < 10) {
      return fieldError("description", "descreva o que aconteceu (pelo menos 10 caracteres)");
    }
    setBusy(true);
    setError(null);
    setErrorField(null);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, description, location, occurredAt, contact, anonymous, website }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) setSent({ anonymous: Boolean(data?.anonymous) });
      else setError(userMessage(res, data, "não deu certo. Tente de novo."));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section role="status" className="flex flex-col gap-2 border-[1.5px] border-line bg-mint p-5" data-testid="incident-sent">
        <p className="text-[17px] font-bold">Relato recebido. Obrigado por avisar.</p>
        <p className="text-[15px] leading-snug">
          A organização foi notificada agora.{" "}
          {sent.anonymous
            ? contact.trim()
              ? "Ele foi enviado sem seu nome; se quiser retorno, usamos o contato que você deixou."
              : "Ele foi enviado sem seu nome e sem contato, então não temos como responder você."
            : "Se precisar, a organização fala com você pelo seu cadastro ou pelo contato informado."}
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="incident-form">
      <label className="flex flex-col gap-1.5">
        <span className={label}>
          tipo <span aria-hidden>*</span>
          <span className="sr-only">(obrigatório)</span>
        </span>
        <select
          ref={kindRef}
          className={field}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          name="kind"
          aria-required="true"
          aria-invalid={errorField === "kind" || undefined}
          aria-describedby={errorField === "kind" ? "incident-error" : undefined}
        >
          <option value="">escolha…</option>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>
          o que aconteceu <span aria-hidden>*</span>
          <span className="sr-only">(obrigatório)</span>
        </span>
        <textarea
          ref={descriptionRef}
          aria-required="true"
          aria-invalid={errorField === "description" || undefined}
          aria-describedby={errorField === "description" ? "incident-error" : undefined}
          className={`${field} min-h-36`}
          maxLength={4000}
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="conte com as suas palavras; não precisa citar nomes se não quiser"
        />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>onde</span>
          <input
            className={field}
            maxLength={200}
            name="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="ex.: sala 3, discord"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>quando</span>
          <input
            className={field}
            maxLength={100}
            name="occurredAt"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            placeholder="ex.: sábado, 15h"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={label}>contato pra retorno · opcional</span>
        <input
          className={field}
          maxLength={200}
          name="contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="e-mail ou telefone, só se quiser resposta"
        />
      </label>
      {signedIn ? (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 border-[1.5px] border-line p-3.5 text-[14px] leading-snug">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />
          <span>
            Enviar anônimo: a organização não vê quem enviou. Sem marcar, o relato vai com o seu perfil, o que ajuda a
            dar retorno.
          </span>
        </label>
      ) : (
        <p className="border-[1.5px] border-line p-3.5 text-[14px] leading-snug" data-testid="incident-anon-note">
          Você não está logado: o relato vai <strong>anônimo</strong>. Não guardamos seu nome nem seu IP. Se quiser
          retorno, deixe um contato acima.
        </p>
      )}
      {/* honeypot: escondido de quem usa o site; robô preenche e o envio é descartado */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          site
          <input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      <p id="incident-error" role="alert" className={error ? "font-mono text-[13px] text-orange" : "sr-only"}>
        {error ?? ""}
      </p>
      <button type="submit" disabled={busy} className="btn w-full rounded-[6px] disabled:opacity-60">
        {busy ? "enviando…" : "enviar relato"}
      </button>
    </form>
  );
}
