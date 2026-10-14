"use client";

import { useState } from "react";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "saving" | "done" | "error"
  >("idle");

  async function subscribe() {
    setStatus("saving");
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, website: "" }),
    });
    setStatus(res.ok ? "done" : "error");
  }

  if (status === "done") {
    return (
      <p className="border-[1.5px] border-line bg-mint px-4 py-3 font-mono text-xs text-accent">
        {"dentro. primeira edição sai essa semana."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && subscribe()}
        placeholder="teu@email.com"
        className="w-full border-[1.5px] border-line bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none"
      />
      <input
        type="text"
        name="website"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
      />
      <button
        onClick={subscribe}
        disabled={status === "saving" || !email}
        className="shrink-0 border-[1.5px] border-line bg-foreground px-6 py-3 text-[15px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
      >
        {status === "saving" ? "…" : "assinar →"}
      </button>
      {status === "error" && (
        <p className="font-mono text-xs text-orange">{"e-mail inválido"}</p>
      )}
    </div>
  );
}
