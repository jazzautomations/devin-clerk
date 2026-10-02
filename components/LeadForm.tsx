"use client";

import { useState } from "react";
import {
  LEAD_INTEREST_LABELS,
  LEAD_INTERESTS,
  type LeadInterest,
} from "@/lib/leadInterests";

// Form de lead da porta comercial (spec 022) — POST público em /api/leads.
// Honeypot `website` escondido: bot que preenche recebe 201 e nada grava.

const inputCls =
  "w-full border border-line bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none";

export function LeadForm() {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [interest, setInterest] = useState<LeadInterest>("desafio");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<
    "idle" | "saving" | "done" | "error"
  >("idle");
  const [error, setError] = useState("");

  async function submit() {
    setStatus("saving");
    setError("");
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, email, interest, message, website }),
    }).catch(() => null);
    if (res?.ok) {
      setStatus("done");
    } else {
      setStatus("error");
      const data = await res?.json().catch(() => null);
      setError(
        typeof data?.error === "string" ? data.error : "algo deu errado",
      );
    }
  }

  if (status === "done") {
    return (
      <p className="border border-accent/40 bg-accent/10 px-4 py-3 font-mono text-xs text-accent">
        {"// recebido — a gente te chama pra conversar em até 2 dias úteis."}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="lead-company" className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
            nome da empresa
          </span>
          <input
            id="lead-company"
            type="text"
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Inc."
            className={inputCls}
          />
        </label>
        <label htmlFor="lead-email" className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
            e-mail
          </span>
          <input
            id="lead-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com"
            className={inputCls}
          />
        </label>
      </div>
      <label htmlFor="lead-interest" className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
          interesse
        </span>
        <select
          id="lead-interest"
          value={interest}
          onChange={(e) => setInterest(e.target.value as LeadInterest)}
          className={inputCls}
        >
          {LEAD_INTERESTS.map((i) => (
            <option key={i} value={i}>
              {LEAD_INTEREST_LABELS[i]}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="lead-message" className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
          mensagem (opcional)
        </span>
        <textarea
          id="lead-message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="contexto, edição que tu tem em mente, budget…"
          className={inputCls}
        />
      </label>
      {/* honeypot — invisível pra humano, bot preenche e é ignorado */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
      />
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "saving" || !company || !email}
          className="shrink-0 bg-accent px-6 py-3 font-mono text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {status === "saving" ? "…" : "quero conversar →"}
        </button>
        {status === "error" && (
          <p className="font-mono text-xs text-red-400">
            {`// ${error}`}
          </p>
        )}
      </div>
    </form>
  );
}
