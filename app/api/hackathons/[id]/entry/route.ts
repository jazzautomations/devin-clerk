import { auth } from "@clerk/nextjs/server";
import { collectDossierQuietly } from "@/lib/dossier";
import { EntryError, myEntry, saveDraft, submitEntry } from "@/lib/entries";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

// spec 034 — entrega do projeto do MEU time na edição.
// GET  → rascunho + status + versões + o que falta
// PATCH → autosave do rascunho (campo avaliado depois do prazo = 403;
//         afterNotes "depois do hackathon" passa sempre)
// POST → enviar: valida obrigatórios e grava versão imutável; com repositório
//        do GitHub, lê os commits pro dossiê do organizador (migration 029)

type Ctx = { params: Promise<{ id: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function gate(params: Ctx["params"]) {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, res: json({ error: "Unauthorized" }, 401) };
  const member = await getMemberByClerkId(userId);
  if (!member) return { ok: false as const, res: json({ error: "Unauthorized" }, 401) };
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) return { ok: false as const, res: json({ error: "Not found" }, 404) };
  const entry = await myEntry(h.id, member.username);
  if (!entry) return { ok: false as const, res: json({ error: "sem time nesta edição — crie o time primeiro" }, 404) };
  return { ok: true as const, member, entry };
}

function fail(e: unknown): Response {
  if (e instanceof EntryError) {
    return json({ error: e.message, ...(e.missing ? { missing: e.missing } : {}) }, e.status);
  }
  throw e;
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const g = await gate(params);
  if (!g.ok) return g.res;
  return json({ entry: g.entry });
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const g = await gate(params);
  if (!g.ok) return g.res;
  const limited = limitOrNull(req, "entry-draft", g.member.id);
  if (limited) return limited;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "JSON inválido" }, 400);
  try {
    return json({ entry: await saveDraft(g.entry.teamId, g.member, b as Record<string, unknown>) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const g = await gate(params);
  if (!g.ok) return g.res;
  const limited = limitOrNull(req, "entry-submit", g.member.id);
  if (limited) return limited;
  try {
    const { entry, version } = await submitEntry(g.entry.teamId, g.member);
    // dossiê: lê o GitHub depois que a versão já está gravada; falha do
    // GitHub fica registrada no dossiê e nunca derruba o envio
    await collectDossierQuietly(g.entry.teamId);
    return json({ entry, version }, 201);
  } catch (e) {
    return fail(e);
  }
}
