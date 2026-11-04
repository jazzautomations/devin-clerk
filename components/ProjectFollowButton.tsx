"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Seguir projeto (spec 046, onda 3, migration 044). Otimista como o seguir
// pessoa (033): troca na hora e volta se a API recusar. Quem decide se o
// botão aparece é a página (integrante do time não segue o próprio projeto).

export function ProjectFollowButton({
  teamId,
  following: initial,
  followers,
  showCount,
  className = "",
}: {
  teamId: number;
  following: boolean;
  /** contagem de quem segue — só o time vê o número */
  followers: number;
  showCount: boolean;
  className?: string;
}) {
  const [following, setFollowing] = useState(initial);
  const [count, setCount] = useState(followers);
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    const next = !following;
    setHot(false);
    setFollowing(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/projects/${teamId}/follow`, { method: next ? "POST" : "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res) {
      setFollowing(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      return setError("Sem conexão. Tente de novo.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setFollowing(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      return setError(userMessage(res, data, "Não deu certo. Tente de novo."));
    }
    if (data && typeof data.following === "boolean") setFollowing(data.following);
  }

  const label = following ? (hot ? "deixar de seguir" : "seguindo o projeto") : "seguir o projeto";
  const tone = following
    ? hot
      ? "border-orange! bg-background! text-orange!"
      : "border-accent! bg-mint! text-accent!"
    : "";

  return (
    <div className={`flex flex-col items-start gap-1.5 ${className}`} data-testid="project-follow">
      <button
        type="button"
        onClick={toggle}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        onFocus={(e) => setHot(e.currentTarget.matches(":focus-visible"))}
        onBlur={() => setHot(false)}
        aria-pressed={following}
        aria-busy={busy || undefined}
        className={`${following ? "btn-ghost" : "btn"} min-h-[44px]! rounded-[6px] font-mono font-semibold ${tone}`}
        data-testid="project-follow-button"
      >
        {label}
      </button>
      <p className="font-mono text-[12px] text-muted" data-testid="project-followers">
        {showCount
          ? `${count} ${count === 1 ? "pessoa acompanha" : "pessoas acompanham"} este projeto`
          : following
            ? "você acompanha este projeto"
            : "atualização nova cai na sua timeline"}
      </p>
      {error && (
        <p role="alert" className="max-w-[32ch] font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}
