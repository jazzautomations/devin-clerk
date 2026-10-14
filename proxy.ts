import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { decideAccess, ONBOARDED_COOKIE } from "@/lib/access";

// spec 039 — acesso por ALLOWLIST (lib/access): a landing explica o
// produto, a plataforma é pra quem tem conta. Página privada sem sessão →
// /sign-up com redirect_url (volta pra onde a pessoa ia); API privada sem
// sessão → 401 JSON (as rotas continuam checando sessão por conta própria).
//
// Onboarding (/bem-vindo) sem custo de banco por request: o cookie
// hh_onb guarda o userId que já passou (ou pulou) o onboarding neste
// navegador. Sem ele, a 1ª página logada cai no /bem-vindo, que consulta
// o banco UMA vez: membro já onboarded só ganha o cookie e volta.
export default clerkMiddleware(async (auth, req) => {
  const path = req.nextUrl.pathname;
  const { userId } = await auth();
  const decision = decideAccess(path, {
    signedIn: !!userId,
    onboarded: !!userId && req.cookies.get(ONBOARDED_COOKIE)?.value === userId,
  });
  if (decision === "next") return;
  if (decision === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const back = path + req.nextUrl.search;
  const target = decision === "signup" ? "/sign-up" : "/bem-vindo";
  const url = new URL(target, req.url);
  url.search = `?redirect_url=${encodeURIComponent(back)}`;
  return NextResponse.redirect(url, 307);
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
