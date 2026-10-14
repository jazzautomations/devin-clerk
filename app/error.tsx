"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

// erro de página dentro do layout (header e rodapé continuam)
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
