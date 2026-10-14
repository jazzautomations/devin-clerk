"use client";

import { ErrorScreen } from "@/components/ErrorScreen";
import "./globals.css";

// erro no próprio layout raiz (Header, Clerk, banco fora no primeiro
// render): substitui o documento inteiro, então traz <html>/<body> e o CSS
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <title>Algo quebrou — HackaHub</title>
        <header className="border-b-2 border-line px-4 py-4 sm:px-6">
          {/* recarga completa: o layout raiz quebrou, o roteador não serve */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="text-[18px] font-extrabold tracking-[-0.02em] uppercase">
            HackaHub
          </a>
        </header>
        <main className="flex-1">
          <ErrorScreen error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
