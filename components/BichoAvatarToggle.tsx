"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { userMessage } from "@/lib/apiError";

// Foto ou bicho (spec 046, onda 4, migration 047). A escolha grava
// members."avatarKind": em "bicho" o avatarUrl vira o SVG do bicho e o login
// não sobrescreve mais; em "foto" volta a foto do Clerk (ou as iniciais).

type Kind = "foto" | "bicho";

const OPCOES: { id: Kind; rotulo: string; ajuda: string }[] = [
  { id: "foto", rotulo: "foto", ajuda: "a foto do seu login" },
  { id: "bicho", rotulo: "bicho", ajuda: "o bicho aparece em todo lugar" },
];

export function BichoAvatarToggle({
  inicial,
  bichoUrl,
  fotoUrl,
  username,
  name,
}: {
  inicial: Kind;
  /** URL do SVG do bicho (com estágio, itens e hash) */
  bichoUrl: string;
  /** foto do Clerk; null = iniciais */
  fotoUrl: string | null;
  username: string;
  name?: string | null;
}) {
  const [kind, setKind] = useState<Kind>(inicial);
  const [estado, setEstado] = useState<"livre" | "salvando" | "salvo">("livre");
  const [erro, setErro] = useState<string | null>(null);

  async function trocar(next: Kind) {
    if (next === kind || estado === "salvando") return;
    setEstado("salvando");
    setErro(null);
    const res = await fetch("/api/members/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarKind: next }),
    }).catch(() => null);
    if (!res) {
      setEstado("livre");
      setErro("Sem conexão. Tente de novo.");
      return;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setEstado("livre");
      setErro(userMessage(res, data, "Não deu pra trocar o avatar."));
      return;
    }
    setKind(next);
    setEstado("salvo");
  }

  const atual = kind === "bicho" ? bichoUrl : fotoUrl;

  return (
    <div className="flex flex-col gap-3" data-testid="avatar-toggle">
      <div className="flex items-center gap-3">
        <Avatar username={username} name={name} avatarUrl={atual} size="lg" />
        <div role="radiogroup" aria-label="avatar" className="flex min-w-0 flex-1 flex-col gap-1.5">
          {OPCOES.map((o) => {
            const on = kind === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => trocar(o.id)}
                disabled={estado === "salvando"}
                className={`flex min-h-[44px] items-center gap-2 border-[1.5px] px-3 py-1.5 text-left disabled:opacity-60 ${
                  on ? "border-foreground bg-mint" : "border-line-soft hover:border-line"
                }`}
                data-testid={`avatar-op-${o.id}`}
              >
                <span className="font-mono text-[13px] font-semibold">{o.rotulo}</span>
                <span className="min-w-0 font-mono text-[12px] text-muted">{o.ajuda}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="font-mono text-[12px] text-muted" aria-live="polite" data-testid="avatar-estado">
        {estado === "salvando" ? "salvando…" : estado === "salvo" ? "salvo" : kind === "bicho" ? "usando o bicho" : "usando a foto"}
      </p>
      {erro && (
        <p role="alert" className="font-mono text-[12.5px] text-orange" data-testid="avatar-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
