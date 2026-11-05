"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";

// spec 039 — nav enxuta do header: as portas + estado ativo. No < lg vira
// botão "menu" com painel (fecha no Esc, no clique e quando a rota muda).

type NavLink = { href: string; label: string; match: readonly string[] };

// logado: as portas da plataforma. O feed é a primeira (spec 046, onda 2:
// a timeline é o lugar de abrir todo dia) e a busca fecha a lista.
const NAV_IN: NavLink[] = [
  { href: "/feed", label: "feed", match: ["/feed", "/post/"] },
  { href: "/radar", label: "hackathons", match: ["/radar", "/h/"] },
  { href: "/desafios", label: "desafios", match: ["/desafios"] },
  { href: "/comunidades", label: "comunidades", match: ["/comunidades", "/comunidade/"] },
  { href: "/projetos", label: "projetos", match: ["/projetos", "/p/"] },
  // spec 046 onda 3: vagas de time e quem procura time
  { href: "/times", label: "times", match: ["/times"] },
  { href: "/membros", label: "pessoas", match: ["/membros", "/u/"] },
  { href: "/organizar", label: "organizar", match: ["/organizar"] },
  { href: "/busca", label: "buscar", match: ["/busca"] },
  // copilot do arquivo (spec 046 onda 6): "já fizeram isso?" com citação
  { href: "/copilot", label: "copilot", match: ["/copilot"] },
];
// sem conta (spec 039): a plataforma é logada, então o header leva pro que
// explica o produto — landing por seção, /organizar e /empresas
const NAV_OUT: NavLink[] = [
  { href: "/radar", label: "radar", match: ["/radar"] },
  { href: "/#comunidades", label: "comunidades", match: [] },
  { href: "/organizar", label: "organizar", match: ["/organizar"] },
  { href: "/empresas", label: "patrocinar", match: ["/empresas"] },
];
const linksFor = (v: "in" | "out") => (v === "in" ? NAV_IN : NAV_OUT);

function isActive(pathname: string, match: readonly string[]) {
  return match.some((m) => (m.endsWith("/") ? pathname.startsWith(m) : pathname === m || pathname.startsWith(`${m}/`)));
}

export function DesktopNav({ variant }: { variant: "in" | "out" }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Navegação principal" className="hidden min-w-0 items-center gap-4 lg:flex xl:gap-6">
      {linksFor(variant).map((l) => {
        const active = isActive(pathname, l.match);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 py-2 text-[15px] font-medium whitespace-nowrap decoration-[1.5px] underline-offset-[6px] hover:underline ${
              active ? "underline decoration-accent decoration-2" : ""
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileMenu({ variant, children }: { variant: "in" | "out"; children?: ReactNode }) {
  const pathname = usePathname() ?? "/";
  // aberto "na rota X": trocou de rota, fecha sozinho sem efeito colateral
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAt(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpenAt(open ? null : pathname)}
        className="flex h-10 items-center gap-2 border-[1.5px] border-line px-3 font-mono text-[13px] font-medium"
      >
        <span aria-hidden className="flex w-4 flex-col gap-[3px]">
          <span className={`h-[2px] bg-foreground transition-transform ${open ? "translate-y-[5px] rotate-45" : ""}`} />
          <span className={`h-[2px] bg-foreground ${open ? "opacity-0" : ""}`} />
          <span className={`h-[2px] bg-foreground transition-transform ${open ? "-translate-y-[5px] -rotate-45" : ""}`} />
        </span>
        {open ? "fechar" : "menu"}
      </button>
      <div
        id={id}
        hidden={!open}
        className="absolute inset-x-0 top-full border-b-2 border-line bg-background"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpenAt(null);
        }}
      >
        <nav aria-label="Navegação principal (menu)" className="mx-auto max-w-6xl px-4 sm:px-6">
          <ul>
            {linksFor(variant).map((l, i) => {
              const active = isActive(pathname, l.match);
              return (
                <li key={l.href} className="border-t border-line-soft first:border-t-0">
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className="flex items-baseline gap-3 py-3.5 text-[24px] leading-none font-extrabold tracking-[-0.03em]"
                  >
                    <span className="font-mono text-[12px] font-medium tracking-normal text-accent">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={active ? "underline decoration-accent decoration-2 underline-offset-4" : ""}>
                      {l.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {children && <div className="flex flex-wrap items-center gap-3 border-t border-line py-4">{children}</div>}
        </nav>
      </div>
    </div>
  );
}
