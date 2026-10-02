"use client";

import { useState } from "react";

const input =
  "w-full border border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none";

// desafio patrocinado = inventário vendido — sponsor é a marca que paga
export function ChallengeForm({ hackathonId }: { hackathonId: string }) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    const f = new FormData(e.currentTarget);
    const opt = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sponsor: f.get("sponsor"),
        title: f.get("title"),
        prize: opt("prize"),
        description: opt("description"),
      }),
    });
    if (res.ok) {
      setStatus("done");
      (e.target as HTMLFormElement).reset();
      window.location.reload();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "erro ao criar");
      setStatus("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          sponsor (a marca que paga)
        </span>
        <input
          name="sponsor"
          required
          className={input}
          placeholder="Oracle + Enterprise X Ventures"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">desafio</span>
        <input
          name="title"
          required
          className={input}
          placeholder="IA aplicada à saúde"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">prêmio (opcional)</span>
        <input
          name="prize"
          className={input}
          placeholder="R$5k + créditos OCI"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          descrição (opcional)
        </span>
        <input name="description" className={input} />
      </label>
      <div className="flex items-end sm:col-span-2">
        <button
          type="submit"
          disabled={status === "saving"}
          className="bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {status === "saving" ? "criando…" : "lançar desafio →"}
        </button>
        {status === "error" && (
          <span className="ml-4 font-mono text-xs text-red-400">
            {"// "}
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

// desativa/reativa sem apagar — o registro é histórico/contratual
export function ChallengeToggle({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/admin/challenges/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    if (res.ok) window.location.reload();
    else setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="font-mono text-[10px] text-muted uppercase tracking-widest transition hover:text-accent disabled:opacity-50"
    >
      {busy ? "…" : active ? "desativar" : "reativar"}
    </button>
  );
}
