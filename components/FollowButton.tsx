"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Seguir pessoa (migration 033). Otimista: troca na hora e volta se a API
// recusar, com a mensagem embaixo. Seguindo, o hover ou o foco mostram
// "deixar de seguir" pra deixar claro o que o clique faz. Quem decide se o
// botão aparece (nunca no próprio perfil) é a página.

type Props = {
  username: string;
  following: boolean;
  /** linha de lista: botão mais baixo, mas sempre com 44px de alvo */
  compact?: boolean;
  className?: string;
};

export function FollowButton({ username, following: initial, compact = false, className = "" }: Props) {
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    const next = !following;
    // acabou de clicar: o "deixar de seguir" só volta quando o mouse sair e entrar
    setHot(false);
    setFollowing(next);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/members/${encodeURIComponent(username)}/follow`, {
      method: next ? "POST" : "DELETE",
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      setFollowing(!next);
      return setError("Sem conexão. Tente de novo.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setFollowing(!next);
      return setError(userMessage(res, data, "Não deu certo. Tente de novo."));
    }
    if (data && typeof data.following === "boolean") setFollowing(data.following);
  }

  const label = following ? (hot ? "deixar de seguir" : "seguindo") : "seguir";
  const tone = following
    ? hot
      ? "border-orange! bg-background! text-orange!"
      : "border-accent! bg-mint! text-accent!"
    : "";
  // largura fixa: trocar o rótulo não empurra o resto da linha
  const size = compact ? "min-h-[44px]! w-[10.5rem] px-3! text-[14px]!" : "min-h-[46px]! w-[12rem] px-4!";

  return (
    <div className={`flex flex-col items-start gap-1.5 ${className}`} data-testid={`follow-${username}`}>
      <button
        type="button"
        onClick={toggle}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        onFocus={(e) => setHot(e.currentTarget.matches(":focus-visible"))}
        onBlur={() => setHot(false)}
        aria-pressed={following}
        aria-busy={busy || undefined}
        className={`${following ? "btn-ghost" : "btn"} ${size} ${tone} max-w-full rounded-[6px] font-mono font-semibold`}
        data-testid="follow-button"
      >
        {label}
      </button>
      {error && (
        <p role="alert" className="max-w-[32ch] font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}
