"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

// erro numa aba do painel da edição: o layout com as abas continua, então
// o organizador troca de aba sem perder o lugar no dia do evento
export default function EditionPanelError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorScreen
      error={error}
      retry={retry}
      title="Essa aba não carregou"
      text="As outras abas continuam funcionando. Tente de novo. Se continuar, envie o código abaixo pra equipe do HackaHub."
      home={false}
    />
  );
}
