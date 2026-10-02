"use client";

import { useState } from "react";

const input =
  "w-full border border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none";

// sponsor = marca pagante do CRM (spec 019) — cadastro uma vez, vínculo via API
export function SponsorForm() {
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
    const res = await fetch("/api/admin/sponsors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        url: opt("url"),
        tier: f.get("tier"),
        contactEmail: opt("contactEmail"),
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
          marca (a empresa que paga)
        </span>
        <input
          name="name"
          required
          className={input}
          placeholder="Oracle"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">tier</span>
        <select name="tier" defaultValue="sponsor" className={input}>
          <option value="apoio">apoio</option>
          <option value="sponsor">sponsor</option>
          <option value="master">master</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          site (opcional — vira link na página da edição)
        </span>
        <input
          name="url"
          type="url"
          className={input}
          placeholder="https://oracle.com"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          contato comercial (opcional)
        </span>
        <input
          name="contactEmail"
          type="email"
          className={input}
          placeholder="devrel@oracle.com"
        />
      </label>
      <div className="flex items-end sm:col-span-2">
        <button
          type="submit"
          disabled={status === "saving"}
          className="bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {status === "saving" ? "salvando…" : "cadastrar sponsor →"}
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
export function SponsorToggle({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/admin/sponsors/${id}`, {
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
