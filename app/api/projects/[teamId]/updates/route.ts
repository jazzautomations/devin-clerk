import { limitOrNull } from "@/lib/ratelimit";
import {
  createProjectUpdate,
  projectDiary,
  ProjectUpdateFailure,
  teamExists,
  PROJECT_DIARY_PAGE_SIZE,
} from "@/lib/projectUpdates";
import { currentMember } from "@/lib/session";

// Diário do projeto (spec 046, onda 3, migration 044).
// GET  → atualizações do projeto, mais nova primeiro, cursor ?antes= (leitura
//        pública: a página do projeto é pública, igual /p).
// POST → integrante do time posta: 401 deslogado, 404 time inexistente,
//        403 quem não é do time, 400 texto vazio/longo, 429 limite
//        (project-updates, 10/dia). Avisa quem segue o projeto (1 por dia).

type Ctx = { params: Promise<{ teamId: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function teamIdOf(params: Ctx["params"]): Promise<number | null> {
  const n = Number((await params).teamId);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const teamId = await teamIdOf(ctx.params);
  if (teamId === null || !(await teamExists(teamId))) return json({ error: "Not found" }, 404);
  const me = await currentMember();
  const raw = new URL(req.url).searchParams.get("antes");
  const antes = raw !== null && Number.isSafeInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
  const { posts, next } = await projectDiary(teamId, me?.id ?? null, antes, PROJECT_DIARY_PAGE_SIZE);
  return json({ posts, next });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const me = await currentMember();
  if (!me) return json({ error: "Unauthorized" }, 401);
  const teamId = await teamIdOf(ctx.params);
  if (teamId === null || !(await teamExists(teamId))) return json({ error: "Not found" }, 404);
  const limited = limitOrNull(req, "project-updates", me.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    const post = await createProjectUpdate(teamId, { id: me.id, username: me.username }, body?.body, body?.link);
    return json({ post }, 201);
  } catch (e) {
    if (e instanceof ProjectUpdateFailure) return json({ error: e.message }, e.status);
    throw e;
  }
}
