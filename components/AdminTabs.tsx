"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminTab = { href: string; label: string };
export type AdminTabGroup = { label: string; tabs: AdminTab[] };

// Abas do painel da edição, agrupadas pela fase do evento. A aba aberta tem
// aria-current="page" e sublinhado. No celular a barra rola de lado (uma
// linha só) em vez de empilhar seis linhas de links antes do conteúdo; cada
// alvo tem 44px de altura.
export function AdminTabs({
  base,
  groups,
  extra = [],
}: {
  /** /admin/h/<id> */
  base: string;
  groups: AdminTabGroup[];
  /** links fora dos grupos (relatório de patrocinador, página pública) */
  extra?: (AdminTab & { external?: boolean })[];
}) {
  const pathname = usePathname() ?? "";
  const isActive = (href: string) => {
    const full = `${base}${href}`;
    return href === "" ? pathname === base : pathname === full || pathname.startsWith(`${full}/`);
  };
  const link = (t: AdminTab, muted = false) => {
    const on = isActive(t.href);
    return (
      <Link
        key={t.href}
        href={`${base}${t.href}`}
        aria-current={on ? "page" : undefined}
        className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-1 whitespace-nowrap underline-offset-4 ${
          on
            ? "border-accent font-bold text-foreground"
            : `border-transparent hover:text-accent hover:underline ${muted ? "text-muted" : ""}`
        }`}
      >
        {t.label}
      </Link>
    );
  };

  return (
    <nav
      data-print-hide
      aria-label="abas do painel da edição"
      className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      data-testid="admin-tabs"
    >
      <ul className="flex w-max items-end gap-x-6 font-mono text-[13px] sm:w-auto sm:flex-wrap sm:gap-y-1">
        {groups.map((g) => (
          <li key={g.label} className="flex shrink-0 items-end gap-x-3">
            <span className="pb-3 text-[11px] tracking-widest text-muted uppercase" aria-hidden>
              {g.label}
            </span>
            <ul className="flex items-end gap-x-3" aria-label={g.label}>
              {g.tabs.map((t) => (
                <li key={t.href}>{link(t)}</li>
              ))}
            </ul>
          </li>
        ))}
        {extra.length > 0 && (
          <li className="flex shrink-0 items-end gap-x-3">
            {extra.map((t) =>
              t.external ? (
                <a
                  key={t.href}
                  href={t.href}
                  className="inline-flex min-h-11 items-center whitespace-nowrap text-muted underline-offset-4 hover:underline"
                >
                  {t.label}
                </a>
              ) : (
                link(t)
              ),
            )}
          </li>
        )}
      </ul>
    </nav>
  );
}
