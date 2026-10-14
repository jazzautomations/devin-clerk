import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getMemberByClerkId } from "@/lib/members";
import { safeRedirect } from "@/lib/onboarding";
import { onboardedCookie } from "@/lib/access";

// spec 039 — membro que JÁ passou pelo onboarding mas está num navegador
// sem o cookie: o /bem-vindo manda pra cá, a gente grava o cookie e devolve
// a pessoa pra onde ela ia. Uma consulta ao banco por navegador.
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberByClerkId(userId);
  const url = new URL(req.url);
  const back = safeRedirect(url.searchParams.get("redirect_url")) ?? "/dashboard";
  if (!member?.onboardedAt) {
    return NextResponse.redirect(new URL(`/bem-vindo?redirect_url=${encodeURIComponent(back)}`, req.url), 307);
  }
  const res = NextResponse.redirect(new URL(back, req.url), 307);
  res.headers.append("Set-Cookie", onboardedCookie(userId));
  return res;
}
