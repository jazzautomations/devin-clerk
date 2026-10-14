"use client";

import { useState } from "react";

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
  const [sent, setSent] = useState<{ anonymous: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return setError("escolha o tipo do problema");
    if (description.trim().length < 10) return setError("descreva o que aconteceu (pelo menos 10 caracteres)");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, description, location, occurredAt, contact, anonymous }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) setSent({ anonymous: Boolean(data?.anonymous) });
      else setError(typeof data?.error === "string" ? data.error : "não deu certo, tente de novo");
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
              : "Ele foi enviado sem seu nome e sem contato, então não temos como te responder."
            : "Se precisar, a organização fala com você pelo seu cadastro ou pelo contato informado."}
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="incident-form">
      <label className="flex flex-col gap-1.5">
        <span className={label}>tipo *</span>
        <select className={field} value={kind} onChange={(e) => setKind(e.target.value)} name="kind">
          <option value="">escolha…</option>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>o que aconteceu *</span>
        <textarea
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
        <label className="flex cursor-pointer items-start gap-3 border-[1.5px] border-line p-3.5 text-[14px] leading-snug">
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
      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn w-full rounded-[6px] disabled:opacity-60">
        {busy ? "enviando…" : "enviar relato"}
      </button>
    </form>
  );
}
