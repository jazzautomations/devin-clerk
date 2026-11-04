"use client";

import { useState } from "react";

// spec 020 + spec 046 (onda 4) — identidade visual do membro. avatarUrl é a
// única coisa que as listas leem: é a foto do Clerk ou, pra quem escolheu, o
// SVG do bicho (/api/mascote/…). Sem nada (ou se a imagem falhar) cai pro
// bloco de iniciais — nunca <img> quebrado nem texto-só.
// <img> simples de propósito: dispensa remotePatterns no next.config e o
// Clerk só emite URLs https.

export function initialsFor(
  name: string | null | undefined,
  username: string,
): string {
  const clean = (name ?? "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const src = parts[0] ?? username;
  const letters = src.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
  return letters || "?";
}

/** o avatar é o bicho (rota pública do SVG), não a foto do Clerk */
export function isBichoAvatar(avatarUrl: string | null | undefined): boolean {
  return !!avatarUrl && avatarUrl.startsWith("/api/mascote/");
}

const SIZES = {
  sm: "h-6 w-6 text-[11px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-16 w-16 text-xl",
} as const;

export type AvatarSize = keyof typeof SIZES;

export function Avatar({
  username,
  name,
  avatarUrl,
  size = "sm",
  className = "",
}: {
  username: string;
  name?: string | null;
  avatarUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(false);
  const base = `shrink-0 rounded ${SIZES[size]} ${className}`;
  if (avatarUrl && !falhou) {
    const bicho = isBichoAvatar(avatarUrl);
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar remoto do Clerk ou SVG do bicho; next/image exigiria remotePatterns só pra isso
      <img
        data-avatar={bicho ? "bicho" : "foto"}
        src={avatarUrl}
        alt=""
        loading="lazy"
        onError={() => setFalhou(true)}
        // o bicho é voxel: fica inteiro no quadro, sobre a banda, sem corte
        className={`${base} border border-line ${bicho ? "bg-band object-contain" : "object-cover"}`}
      />
    );
  }
  return (
    <span
      data-avatar="iniciais"
      aria-hidden
      className={`${base} inline-flex select-none items-center justify-center border-[1.5px] border-line bg-band font-mono font-semibold text-foreground`}
    >
      {initialsFor(name, username)}
    </span>
  );
}
