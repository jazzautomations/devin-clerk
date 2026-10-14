import Link from "next/link";
import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { AuthShow } from "@/components/AuthShow";
import { appConfig } from "@/app.config";
import { NotificationBell } from "@/components/NotificationBell";
import { DesktopNav, MobileMenu } from "@/components/HeaderNav";

// spec 039 — header enxuto: marca, 4 portas (hackathons, projetos,
// comunidade, organizar) pra quem tem conta; pra quem não tem, o que
// explica o produto. E a ação do momento — criar conta pra quem chega,
// "meu painel" pra quem já tá dentro. Feed, talento e blog moram no rodapé.
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background">
      <div className="relative mx-auto flex h-[60px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:h-[72px] lg:gap-8">
        <Link
          href="/"
          aria-label={`${appConfig.name} — início`}
          className="flex shrink-0 items-center gap-2.5 whitespace-nowrap"
        >
          <span aria-hidden className="h-[11px] w-[11px] shrink-0 border-[1.5px] border-line bg-band" />
          <span className="text-[18px] font-extrabold tracking-[-0.02em] uppercase">{appConfig.name}</span>
          <span className="hidden font-mono text-xs text-muted sm:inline">/hack inova</span>
        </Link>

        <AuthShow when="signed-in">
          <DesktopNav variant="in" />
        </AuthShow>
        <AuthShow when="signed-out">
          <DesktopNav variant="out" />
        </AuthShow>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <AuthShow when="signed-out">
            <SignInButton mode="modal">
              <button className="hidden py-2 text-[15px] font-medium underline-offset-4 hover:underline sm:inline">
                entrar
              </button>
            </SignInButton>
            {/* cadastro novo passa pelo /bem-vindo (o proxy manda) e cai no painel */}
            <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="btn min-h-[40px]! px-3.5! py-1.5! text-[14px]!">criar conta</button>
            </SignUpButton>
          </AuthShow>
          <AuthShow when="signed-in">
            <Link
              href="/dashboard"
              className="hidden min-h-[40px] items-center border-[1.5px] border-line px-3.5 text-[14px] font-semibold hover:bg-foreground hover:text-background sm:inline-flex"
            >
              meu painel
            </Link>
            <NotificationBell />
            <UserButton />
          </AuthShow>
          <AuthShow when="signed-out">
            <MobileMenu variant="out">
              <SignInButton mode="modal">
                <button className="btn-ghost min-h-[40px]! px-4! text-[14px]!">entrar</button>
              </SignInButton>
            </MobileMenu>
          </AuthShow>
          <AuthShow when="signed-in">
            <MobileMenu variant="in">
              <Link href="/dashboard" className="btn min-h-[40px]! px-4! text-[14px]!">
                meu painel
              </Link>
              <Link href="/perfil" className="btn-ghost min-h-[40px]! px-4! text-[14px]!">
                editar perfil
              </Link>
            </MobileMenu>
          </AuthShow>
        </div>
      </div>
    </header>
  );
}
