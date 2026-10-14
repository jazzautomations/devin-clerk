import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId, saveOnboarding, type OnboardingPatch } from "@/lib/members";
import { parsePersonas } from "@/lib/personas";
import { LIMITS, parseIntents, shortText } from "@/lib/onboarding";
import { normalizeSocial } from "@/lib/social";
import { isOpenToValue } from "@/lib/openTo";
import { setOpenTo } from "@/lib/talent";
import { onboardedCookie } from "@/lib/access";

// spec 039 — PATCH /api/onboarding: cada passo do /bem-vindo grava o que
// mandou (valida tudo antes de gravar qualquer coisa); `finish` (concluir
// ou pular) marca onboardedAt e solta o cookie que o proxy lê pra não
// mandar a pessoa de novo pro /bem-vindo.
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberByClerkId(userId);
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  const patch: OnboardingPatch = {};
  if (b.personas !== undefined) {
    const p = parsePersonas(b.personas);
    if ("error" in p) return Response.json({ error: p.error }, { status: 400 });
    patch.personas = p.value;
  }
  if (b.intents !== undefined) {
    const i = parseIntents(b.intents);
    if ("error" in i) return Response.json({ error: i.error }, { status: 400 });
    patch.intents = i.value;
  }
  for (const k of ["name", "headline", "city", "institution", "course"] as const) {
    if (b[k] === undefined) continue;
    const t = shortText(b[k], LIMITS[k], k);
    if ("error" in t) return Response.json({ error: t.error }, { status: 400 });
    // nome vazio não apaga o nome (o resto, opcional, pode limpar)
    if (k === "name" && t.value === null) continue;
    patch[k] = t.value;
  }
  for (const k of ["github", "linkedin"] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== "string") return Response.json({ error: `${k} inválido` }, { status: 400 });
    if (!(b[k] as string).trim()) {
      patch[k] = null;
      continue;
    }
    const n = normalizeSocial(k, b[k] as string);
    if ("error" in n) return Response.json({ error: n.error }, { status: 400 });
    patch[k] = n.value;
  }
  let openTo: string[] | undefined;
  if (b.openTo !== undefined) {
    if (!Array.isArray(b.openTo) || !b.openTo.every(isOpenToValue)) {
      return Response.json({ error: "openTo inválido" }, { status: 400 });
    }
    openTo = b.openTo as string[];
  }
  const finish = b.finish === true;

  await saveOnboarding(member.id, patch, finish);
  if (openTo !== undefined) await setOpenTo(member.id, openTo);

  const res = Response.json({ ok: true, finished: finish });
  if (finish) res.headers.append("Set-Cookie", onboardedCookie(userId));
  return res;
}
