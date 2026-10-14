import { chromium, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { AUTH_FILE, signInTicket } from "./auth";

// spec 039 — entra com o membro de teste, passa pelo onboarding (o banco do
// e2e é zerado a cada rodada, então o membro nasce sem onboardedAt) e
// salva a sessão pros specs que olham a plataforma logada.
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto(`/sign-in?__clerk_ticket=${await signInTicket()}`, { waitUntil: "networkidle" });
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 60_000 });
  // primeira página logada: o proxy manda pro /bem-vindo (e o membro nasce).
  // Rodada sem reset do banco: o membro já passou e cai direto no painel.
  await page.goto("/dashboard");
  await page.waitForURL(/\/(bem-vindo|dashboard)/, { timeout: 30_000 });
  if (page.url().includes("/bem-vindo")) {
    await page.getByTestId("onboarding-continue").waitFor();
    const res = await page.request.patch("/api/onboarding", { data: { finish: true } });
    if (!res.ok()) throw new Error(`onboarding do membro de teste falhou: ${res.status()}`);
  }
  await page.goto("/dashboard");
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await ctx.storageState({ path: AUTH_FILE });
  await browser.close();
}
