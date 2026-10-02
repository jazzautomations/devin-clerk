import Link from "next/link";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { appConfig } from "@/app.config";

export function Header() {
  return (
    <header className="border-b border-line bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-mono text-sm font-semibold tracking-tight"
        >
          <span className="text-accent">{"> "}</span>
          {appConfig.name.toLowerCase()}
          <span className="text-accent">_</span>
        </Link>
        <nav className="flex items-center gap-6 font-mono text-xs tracking-wide">
          <Link
            href="/radar"
            className="text-muted transition hover:text-accent"
          >
            radar
          </Link>
          <Link
            href="/feed"
            className="text-muted transition hover:text-accent"
          >
            feed
          </Link>
          <Link
            href="/membros"
            className="text-muted transition hover:text-accent"
          >
            membros
          </Link>
          <Link
            href="/blog"
            className="text-muted transition hover:text-accent"
          >
            blog
          </Link>
          <Link
            href="/dashboard"
            className="text-muted transition hover:text-accent"
          >
            dashboard
          </Link>
          <Show when="signed-in">
            <Link
              href="/perfil"
              className="text-muted transition hover:text-accent"
            >
              perfil
            </Link>
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="text-muted transition hover:text-accent">
                entrar
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="bg-accent px-4 py-2 font-semibold text-black transition hover:brightness-110">
                criar conta
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </nav>
      </div>
    </header>
  );
}
