"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// botão "atualizar" do dossiê (migration 029): lê o GitHub de novo pra um
// time. O servidor segura o ritmo (1 min por time, 30 por hora por pessoa).

export function DossierRefresh({ hackathonId, teamId }: { hackathonId: string; teamId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/dossie/${teamId}`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: data?.error ?? "não deu pra atualizar" });
      return;
    }
    setMsg(
      data?.status === "ok"
        ? { ok: true, text: `${data.commits} ${data.commits === 1 ? "commit lido" : "commits lidos"}` }
        : { ok: false, text: data?.message ?? "o GitHub não respondeu" },
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={refresh} disabled={busy} className="btn-ghost disabled:opacity-50">
        {busy ? "lendo o GitHub…" : "atualizar"}
      </button>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`font-mono text-[12px] ${msg.ok ? "text-accent" : "text-orange"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
