// logo da comunidade: imagem por URL (https, validada na API) ou o bloco
// com as iniciais no visual da casa — nunca <img> quebrado sem fallback.
export function CommunityLogo({
  name,
  logoUrl,
  size = "md",
}: {
  name: string;
  logoUrl: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const box = size === "lg" ? "h-20 w-20 text-[34px]" : size === "md" ? "h-14 w-14 text-[25px]" : "h-10 w-10 text-[19px]";
  const initials =
    name
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w[0] ?? ""))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- logo remoto informado pela comunidade (https validado); next/image exigiria remotePatterns abertos
      <img
        src={logoUrl}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        className={`${box} shrink-0 border-[1.5px] border-line bg-background object-cover`}
      />
    );
  }
  return (
    <span aria-hidden className={`pix ${box} grid shrink-0 place-items-center bg-foreground leading-none text-band`}>
      {initials}
    </span>
  );
}
