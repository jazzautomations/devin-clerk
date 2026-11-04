import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { collectDossierQuietly } from "@/lib/dossier";
import { EntryError, myEntry, saveDraft, submitEntry } from "@/lib/entries";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

// spec 034 — entrega do projeto do MEU time na edição.
// GET  → rascunho + status + versões + o que falta
// PATCH → autosave do rascunho (campo avaliado depois do prazo = 403;
//         afterNotes "depois do hackathon" e a vitrine (inspiration,
//         howBuilt, challenges, learned, coverUrl, media, role) passam
//         sempre; role é o papel de quem salva — spec 046)
// POST → enviar: valida obrigatórios e grava versão imutável; com repositório
//        do GitHub, lê os commits pro dossiê do organizador (migration 029)
//        depois da resposta. Corpo opcional = os campos ainda não salvos: o
//        rascunho é gravado junto, no limite do envio (não no do autosave).

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
  const text = await req.text().catch(() => "");
  let draft: unknown = null;
  if (text.trim()) {
    try {
      draft = JSON.parse(text);
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) return json({ error: "JSON inválido" }, 400);
  }
  try {
    if (draft) await saveDraft(g.entry.teamId, g.member, draft as Record<string, unknown>);
    const { entry, version } = await submitEntry(g.entry.teamId, g.member);
    // dossiê: lê o GitHub depois da resposta (GitHub lento não segura a
    // confirmação no prazo); falha fica registrada no dossiê
    const teamId = g.entry.teamId;
    try {
      after(() => collectDossierQuietly(teamId));
    } catch {
      // fora de escopo de request (script): roda solto, sem segurar a resposta
      void collectDossierQuietly(teamId);
    }
    return json({ entry, version }, 201);
  } catch (e) {
    return fail(e);
  }
}
