import Link from "next/link";
import type { ReactNode } from "react";

// spec 039 — cartão público mínimo (perfil /u e projeto /p) pra quem não
// tem conta: o bastante pro link do LinkedIn renderizar e convencer; o
// resto é de quem entra. O CTA volta pra esta mesma página depois do login.
export function PublicCard({
  kind,
  title,
  subtitle,
  facts,
  path,
  children,
  extra,
  cta,
}: {
  kind: "perfil" | "projeto" | "comunidade";
  title: string;
  subtitle?: string | null;
  facts: [string, string][];
  path: string;
  children?: ReactNode;
  /** bloco depois dos fatos (ex.: próximos hackathons da comunidade) */
  extra?: ReactNode;
  /** texto do botão; o padrão é o do perfil/projeto */
  cta?: string;
}) {
  const LABEL = { perfil: "PERFIL", projeto: "PROJETO", comunidade: "COMUNIDADE" } as const;
  const REST = {
    perfil: "Trajetória, projetos, cartas e links ficam pra quem tem conta.",
    projeto: "A história, a demo e o código aparecem aqui quando a edição abre os projetos.",
    comunidade: "Membros, mural, avisos e os hackathons que já rolaram ficam pra quem entra.",
  } as const;
  const CTA = {
    perfil: "entrar pra ver o perfil completo",
    projeto: "criar conta no HackaHub",
    comunidade: "entrar na comunidade",
  } as const;
  const back = encodeURIComponent(path);
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16" data-testid="public-card">
      <article className="border-2 border-line">
        <p className="flex items-center justify-between border-b-2 border-line bg-foreground px-4 py-1.5">
          <span className="pix text-[19px] leading-none text-band">{LABEL[kind]}</span>
          <span className="pix text-[19px] leading-none text-background">HACKAHUB</span>
        </p>
        <div className="flex flex-col gap-3 px-5 pt-6 pb-5">
          {children}
          <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">{title}</h1>
          {subtitle && <p className="text-[17px] leading-snug text-[#2b2b2b]">{subtitle}</p>}
        </div>
        {facts.length > 0 && (
          <dl className="border-t border-line text-[14.5px]">
            {facts.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-3 border-b border-line-soft px-5 py-2.5 last:border-b-0">
                <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {extra}
      </article>
      <div className="flex flex-col gap-3 border-[1.5px] border-line p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[15px] text-muted">
          {REST[kind]}
        </p>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Link href={`/sign-up?redirect_url=${back}`} className="btn" data-testid="public-card-cta">
            {cta ?? CTA[kind]} →
          </Link>
          <Link href={`/sign-in?redirect_url=${back}`} className="font-mono text-[12.5px] text-accent underline-offset-4 hover:underline">
            já tenho conta · entrar
          </Link>
        </div>
      </div>
    </section>
  );
}
