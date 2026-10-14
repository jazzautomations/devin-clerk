"use client";

import { useAuth } from "@clerk/nextjs";
import type { ReactNode } from "react";

// O header vive no layout raiz, que também renderiza o 404 de caminho de
// arquivo (/x.png) — lá o proxy não roda e o <Show> do servidor (auth())
// quebra a página com 500. Decidir no cliente funciona em qualquer rota.
export function AuthShow({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return (when === "signed-in") === !!isSignedIn ? <>{children}</> : null;
}
