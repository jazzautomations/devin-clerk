"use client";

import { useState } from "react";
import { FollowButton } from "@/components/FollowButton";
import { userMessage } from "@/lib/apiError";

// Ações de "quem eu conheci" (spec 046, onda 5): seguir e convidar pro meu
// time, com o convite de time da Onda 3 (team_invites). A lista é privada:
// ninguém vê quem você conheceu.

export function ConnectionActions({
  username,
  hackathonId,
  following,
}: {
  username: string;
  hackathonId: string;
  following: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "none">("idle");
  const [error, setError] = useState<string | null>(null);

  async function invite() {
    setState("busy");
    setError(null);
    const res = await fetch(`/api/hackathons/${hackathonId}/team/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username] }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res) {
      setState("idle");
      return setError("Sem conexão. Tente de novo.");
    }
    if (!res.ok) {
      setState("idle");
      return setError(userMessage(res, data, "Não deu certo. Tente de novo."));
    }
    const invited = (data as { invited?: string[] } | null)?.invited ?? [];
    setState(invited.length > 0 ? "sent" : "none");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FollowButton username={username} following={following} compact />
      <button
        type="button"
        onClick={invite}
        disabled={state === "busy" || state === "sent"}
        className="inline-flex min-h-[44px] items-center rounded-[6px] border-[1.5px] border-line px-3 font-mono text-[12.5px] transition hover:border-foreground hover:bg-mint disabled:opacity-60"
        data-testid="conexao-convidar"
      >
        {state === "sent" ? "convite enviado" : state === "none" ? "já tem time" : "convidar pro meu time"}
      </button>
      {error && (
        <span role="alert" className="font-mono text-[12px] text-orange">
          {error}
        </span>
      )}
    </div>
  );
}
