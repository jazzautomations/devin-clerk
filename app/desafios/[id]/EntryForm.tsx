"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Entrega da própria pessoa (POST/DELETE /api/open-challenges/[id]/entry).
// Projeto do HackaHub (time em que a pessoa está) ou repo; resumo sempre.

type Team = { teamId: number; teamName: string; projectTitle: string; hackathonName: string };
type Mine = { teamId: number | null; repoUrl: string | null; demoUrl: string | null; summary: string };

const label = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";
const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";

export function EntryForm({ challengeId, teams, mine }: { challengeId: number; teams: Team[]; mine: Mine | null }) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(mine?.teamId ? String(mine.teamId) : "");
  const [repoUrl, setRepoUrl] = useState(mine?.repoUrl ?? "");
  const [demoUrl, setDemoUrl] = useState(mine?.demoUrl ?? "");
  const [summary, setSummary] = useState(mine?.summary ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/open-challenges/${challengeId}/entry`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify({ teamId: teamId || null, repoUrl, demoUrl, summary }) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: userMessage(res, data, "Não deu pra salvar. Tente de novo.") });
        return;
      }
      if (method === "DELETE") {
        setTeamId("");
        setRepoUrl("");
        setDemoUrl("");
        setSummary("");
      }
      setMsg({ ok: true, text: method === "POST" ? "Entrega salva. Dá pra mudar até o prazo." : "Entrega retirada." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Sem conexão. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      data-testid="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send("POST");
      }}
    >
      {teams.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className={label}>projeto seu no HackaHub (opcional)</span>
          <select className={input} value={teamId} onChange={(e) => setTeamId(e.target.value)} data-testid="entry-team">
            <option value="">nenhum, vou mandar o repo</option>
            {teams.map((t) => (
              <option key={t.teamId} value={t.teamId}>
                {t.projectTitle} · {t.hackathonName}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>repo{teams.length > 0 ? " (se não escolheu projeto)" : ""}</span>
          <input
            className={`${input} font-mono`}
            type="url"
            inputMode="url"
            maxLength={300}
            placeholder="https://github.com/voce/projeto"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>demo (opcional)</span>
          <input
            className={`${input} font-mono`}
            type="url"
            inputMode="url"
            maxLength={300}
            placeholder="https://"
            value={demoUrl}
            onChange={(e) => setDemoUrl(e.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={label}>o que você fez</span>
        <textarea
          className={`${input} resize-y`}
          rows={4}
          required
          maxLength={1000}
          placeholder="O problema que atacou, como resolveu e o que ficou faltando."
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <span className="self-end font-mono text-[12px] text-muted">{summary.length}/1000</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn" disabled={busy || !summary.trim()} data-testid="entry-submit">
          {mine ? "salvar entrega" : "entregar"}
        </button>
        {mine && (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            data-testid="entry-withdraw"
            onClick={() => {
              if (window.confirm("Tirar sua entrega deste desafio?")) void send("DELETE");
            }}
          >
            tirar entrega
          </button>
        )}
      </div>
      {msg && (
        <p role="status" className={`font-mono text-[13px] ${msg.ok ? "text-accent" : "text-orange"}`} data-testid="entry-msg">
          {msg.text}
        </p>
      )}
    </form>
  );
}
