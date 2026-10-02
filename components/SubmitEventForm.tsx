"use client";

import { useState } from "react";

// Form de indicação de hackathon (spec 026) — POST público em
// /api/submissions. Honeypot `company` escondido: bot que preenche
// recebe 201 e nada grava. Sucesso é honesto: vai pra curadoria.

const inputCls =
  "w-full border border-line bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none";

const labelCls =
  "font-mono text-[10px] tracking-widest text-muted uppercase";

export function SubmitEventForm() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [location, setLocation] = useState("");
  const [format, setFormat] = useState("online");
  const [note, setNote] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<
    "idle" | "saving" | "done" | "error"
  >("idle");
  const [error, setError] = useState("");

  async function submit() {
    setStatus("saving");
    setError("");
    const res = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        url,
        startsAt: startsAt || null,
        location,
        format,
        note,
        company,
      }),
    }).catch(() => null);
    // 201 criou · 200 dedupe (já tá na fila) — os dois são "recebido"
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
        {"// recebido — vai pra curadoria antes de entrar no radar."}
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
        <label htmlFor="sub-name" className="flex flex-col gap-1.5">
          <span className={labelCls}>nome do evento</span>
          <input
            id="sub-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Hackathon da Faculdade X"
            className={inputCls}
          />
        </label>
        <label htmlFor="sub-url" className="flex flex-col gap-1.5">
          <span className={labelCls}>link oficial</span>
          <input
            id="sub-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className={inputCls}
          />
        </label>
        <label htmlFor="sub-starts" className="flex flex-col gap-1.5">
          <span className={labelCls}>quando começa (opcional)</span>
          <input
            id="sub-starts"
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={inputCls}
          />
        </label>
        <label htmlFor="sub-location" className="flex flex-col gap-1.5">
          <span className={labelCls}>onde (opcional)</span>
          <input
            id="sub-location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="São Paulo, SP"
            className={inputCls}
          />
        </label>
      </div>
      <label htmlFor="sub-format" className="flex flex-col gap-1.5">
        <span className={labelCls}>formato</span>
        <select
          id="sub-format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className={inputCls}
        >
          <option value="online">online</option>
          <option value="presencial">presencial</option>
          <option value="hibrido">híbrido</option>
        </select>
      </label>
      <label htmlFor="sub-note" className="flex flex-col gap-1.5">
        <span className={labelCls}>nota pra curadoria (opcional)</span>
        <textarea
          id="sub-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="quem organiza, onde tu viu, o que vale olhar…"
          className={inputCls}
        />
      </label>
      {/* honeypot — invisível pra humano; bot que preenche é ignorado */}
      <input
        type="text"
        name="company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
      />
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "saving" || !name || !url}
          className="shrink-0 bg-accent px-6 py-3 font-mono text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {status === "saving" ? "…" : "indicar pro radar →"}
        </button>
        {status === "error" && (
          <p className="font-mono text-xs text-red-400">{`// ${error}`}</p>
        )}
      </div>
    </form>
  );
}
