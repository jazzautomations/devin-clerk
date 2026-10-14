import { test as base, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// spec 039 — a plataforma é logada. O global-setup entra UMA vez com um
// usuário de teste do Clerk dev (ticket de sign-in pela Backend API, sem
// captcha), passa pelo /bem-vindo e salva o storageState aqui. Specs que
// olham página logada pedem `memberPage`; `page` e `request` continuam
// anônimos, então "anon → 401/cadastro" segue provado do jeito certo.

export const AUTH_FILE = path.join(__dirname, ".auth", "member.json");
export const E2E_MEMBER_EMAIL = "e2e-membro+clerk_test@example.com";

export function clerkSecret(): string {
  if (process.env.CLERK_SECRET_KEY) return process.env.CLERK_SECRET_KEY;
  const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("CLERK_SECRET_KEY="));
  if (!line) throw new Error("CLERK_SECRET_KEY ausente (.env.local)");
  return line.slice("CLERK_SECRET_KEY=".length).replace(/^"|"$/g, "").trim();
}

async function clerk<T>(p: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.clerk.com/v1${p}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${clerkSecret()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Clerk ${p}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** ticket de sign-in de 10 min pro usuário de teste (cria no Clerk dev se faltar) */
export async function signInTicket(email = E2E_MEMBER_EMAIL): Promise<string> {
  const found = await clerk<{ id: string }[]>(`/users?email_address=${encodeURIComponent(email)}`);
  const user =
    found[0] ??
    (await clerk<{ id: string }>("/users", {
      email_address: [email],
      first_name: "Membro",
      last_name: "E2E",
      skip_password_requirement: true,
    }));
  const t = await clerk<{ token: string }>("/sign_in_tokens", { user_id: user.id, expires_in_seconds: 600 });
  return t.token;
}

export const test = base.extend<{ memberPage: Page }>({
  memberPage: async ({ browser, baseURL }, provide) => {
    const ctx = await browser.newContext({ storageState: AUTH_FILE, baseURL });
    const p = await ctx.newPage();
    await provide(p);
    await ctx.close();
  },
});

/**
 * API como membro: a navegação renova o JWT curto do Clerk (__session) e o
 * `request` da página usa os mesmos cookies nos próximos segundos.
 */
export async function memberRequest(p: Page) {
  await p.goto("/dashboard", { waitUntil: "domcontentloaded" });
  return p.request;
}
