"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 font-mono text-sm text-foreground focus:border-accent focus:outline-none";

// prazo da pesquisa NPS (datetime-local em Brasília); vazio = fim + 7 dias
export function NpsCloseForm({ hackathonId, value }: { hackathonId: string; value: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(closesAt: string | null) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/nps`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closesAt }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: data?.error ?? "não deu certo" });
    setMsg({ ok: true, text: "Prazo salvo." });
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(String(new FormData(e.currentTarget).get("closesAt") ?? "") || null);
      }}
      className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
    >
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="font-mono text-[12px] tracking-widest text-muted uppercase">pesquisa fecha em (Brasília)</span>
        <input name="closesAt" type="datetime-local" defaultValue={value} className={input} />
      </label>
      <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-60">
        salvar prazo
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void save(null)}
        className="font-mono text-[13px] text-muted underline-offset-4 hover:underline disabled:opacity-60"
      >
        voltar pro padrão
      </button>
      {msg && (
        <p role="status" className={`font-mono text-[13px] sm:col-span-3 ${msg.ok ? "text-accent" : "text-orange"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
