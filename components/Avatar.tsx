// spec 020 — identidade visual do membro. avatarUrl vem do Clerk (imageUrl);
// sem foto cai pro bloco de iniciais — nunca <img> quebrado nem texto-só.
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

const SIZES = {
  sm: "h-6 w-6 text-[9px]",
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
  const base = `shrink-0 rounded ${SIZES[size]} ${className}`;
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar remoto do Clerk; next/image exigiria remotePatterns só pra isso
      <img
        data-avatar
        src={avatarUrl}
        alt=""
        loading="lazy"
        className={`${base} border border-line object-cover`}
      />
    );
  }
  return (
    <span
      data-avatar
      aria-hidden
      className={`${base} inline-flex select-none items-center justify-center border border-accent/40 bg-accent/10 font-mono font-semibold text-accent`}
    >
      {initialsFor(name, username)}
    </span>
  );
}
