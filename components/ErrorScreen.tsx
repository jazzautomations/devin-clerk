"use client";

import { useEffect } from "react";

// Tela de erro no visual do not-found.tsx. Sem Clerk e sem Header: roda
// também no global-error, quando o próprio layout quebrou. O digest é o
// mesmo da linha request_error no log (instrumentation.ts).
export function ErrorScreen({
  error,
  retry,
  title = "Algo quebrou do nosso lado",
  text = "Tente de novo em alguns segundos. Se continuar, envie o código abaixo pra equipe do HackaHub.",
  home = true,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  text?: string;
  home?: boolean;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section
      data-testid="error-screen"
      className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-20 sm:px-6"
    >
      <p className="pix text-5xl text-orange">erro</p>
      <h1 className="text-[clamp(2rem,6vw,3rem)] leading-none font-extrabold tracking-[-0.035em]">
        {title}
      </h1>
      <p className="max-w-prose text-muted">{text}</p>
      {error.digest && (
        <p className="font-mono text-sm break-all">
          código de referência: <span data-testid="error-digest">{error.digest}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className="btn">
          tentar de novo
        </button>
        {home && (
          // <a> e não <Link>: depois de um erro, a navegação completa
          // recarrega o layout do zero
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/" className="btn-ghost">
            voltar pro início
          </a>
        )}
      </div>
    </section>
  );
}
