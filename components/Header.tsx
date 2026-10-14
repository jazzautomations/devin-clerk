import Link from "next/link";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { appConfig } from "@/app.config";
import { NotificationBell } from "@/components/NotificationBell";

const links = [
  { href: "/radar", label: "radar" },
  { href: "/feed", label: "feed" },
  { href: "/membros", label: "membros" },
  { href: "/projetos", label: "projetos" },
  { href: "/talento", label: "talento" },
  { href: "/blog", label: "blog" },
];

const navLink =
  "py-2 text-[14px] font-medium text-foreground decoration-[1.5px] underline-offset-4 hover:underline";

export function Header() {
  return (
    <header className="z-40 border-b border-line bg-background lg:sticky lg:top-0">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-1 px-4 py-3 sm:px-6 lg:min-h-[72px] lg:flex-nowrap lg:py-0">
        <Link
          href="/"
          aria-label={`${appConfig.name} — início`}
          className="flex items-center gap-2.5 whitespace-nowrap"
        >
          <span
            aria-hidden
            className="h-[11px] w-[11px] shrink-0 border-[1.5px] border-line bg-band"
          />
          <span className="text-[18px] font-extrabold tracking-[-0.02em] uppercase">
            {appConfig.name}
          </span>
          <span className="hidden font-mono text-xs text-muted sm:inline">/hack inova</span>
        </Link>

        <div className="flex items-center gap-3 lg:order-last">
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className={navLink}>entrar</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="btn min-h-[36px]! px-3! py-1! text-[14px]!">
                criar conta
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <NotificationBell />
            <UserButton />
          </Show>
        </div>

        <nav
          aria-label="Navegação principal"
          className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-x-5 overflow-x-auto px-4 whitespace-nowrap [scrollbar-width:none] sm:mx-0 sm:w-full sm:flex-wrap sm:px-0 lg:ml-auto lg:w-auto [&::-webkit-scrollbar]:hidden"
        >
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={navLink}>
              {l.label}
            </Link>
          ))}
          <Link href="/dashboard" className={navLink}>
            painel
          </Link>
          <Show when="signed-in">
            <Link href="/perfil" className={navLink}>
              perfil
            </Link>
          </Show>
        </nav>
      </div>
    </header>
  );
}
