import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { getRegistrationIds } from "@/lib/registrations";
import {
  memberTeamFor,
  submitTeam,
  TeamError,
  updateTeamProject,
} from "@/lib/teams";
import { XP } from "@/lib/game";
import { awardXp, checkBadges } from "@/lib/xp";

// spec 021 — submissão self-service: o inscrito cria/edita o próprio
// time+projeto; o arquivo deixa de depender do admin pra se preencher.

const toStatus = (e: unknown) => (e instanceof TeamError ? e.status : 400);

function teamHackathonId(teamId: number): string | null {
  const row = db
    .prepare("SELECT hackathonId FROM teams WHERE id = ?")
    .get(teamId) as { hackathonId: string } | undefined;
  return row?.hackathonId ?? null;
}

// meu time na edição — alimenta o formulário "meu time" de /h/[id]
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const team = memberTeamFor(h.id, member.username);
  if (!team) {
    return Response.json({ error: "sem time nesta edição" }, { status: 404 });
  }
  return Response.json({ team });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // time é coisa de quem vai ao evento — mesmo gate do board (012)
  if (!getRegistrationIds(member.id).includes(h.id)) {
    return Response.json({ error: "inscreve-te primeiro" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  if (!b || typeof b.name !== "string" || !b.name.trim()) {
    return Response.json({ error: "name obrigatório" }, { status: 400 });
  }
  try {
    const { team, ignoredUsernames } = submitTeam(h.id, member, {
      name: b.name,
      memberUsernames: Array.isArray(b.memberUsernames)
        ? b.memberUsernames
        : [],
      project: b.project ?? null,
    });
    awardXp(member.id, XP.teamSubmit);
    const newBadges = checkBadges(member.id);
    return Response.json(
      {
        team,
        ignoredUsernames,
        xp: `+${XP.teamSubmit}`,
        newBadges: newBadges.map((b) => b.id),
      },
      { status: 201 },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: toStatus(e) },
    );
  }
}

// integrante edita o projeto do próprio time — {teamId, title?,
// description?, repoUrl?, demoUrl?}; o time precisa ser desta edição
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const b = await req.json().catch(() => null);
  const teamId =
    b && typeof b.teamId === "number" && Number.isInteger(b.teamId)
      ? b.teamId
      : null;
  if (!teamId) {
    return Response.json({ error: "teamId obrigatório" }, { status: 400 });
  }
  // escopo da rota: o time precisa pertencer a ESTA edição
  if (teamHackathonId(teamId) !== h.id) {
    return Response.json({ error: "Time não encontrado" }, { status: 404 });
  }
  try {
    const team = updateTeamProject(teamId, member, {
      title: b.title,
      description: b.description,
      repoUrl: b.repoUrl,
      demoUrl: b.demoUrl,
    });
    return Response.json({ team });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: toStatus(e) },
    );
  }
}
