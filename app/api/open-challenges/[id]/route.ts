import {
  canEditChallenge,
  canJudgeChallenge,
  deleteDraft,
  getOpenChallenge,
  parseOpenChallengeInput,
  publishOpenChallenge,
  removeChallenge,
  requireOpenChallenge,
  updateDraft,
  visibleEntries,
} from "@/lib/openChallenges";

type Ctx = { params: Promise<{ id: string }> };

// GET: o desafio e as entregas que quem pede pode ver (antes do prazo só a
// contagem e a própria). PATCH: edita o rascunho e/ou publica ({publish:
// true}). DELETE: apaga o rascunho; publicado não muda, mas a moderação
// (dono, organizador, admin) tira do ar: some das listas e a linha fica.

export async function GET(_req: Request, { params }: Ctx) {
  const g = await requireOpenChallenge((await params).id);
  if ("response" in g) return g.response;
  const [canEdit, canJudge] = await Promise.all([canEditChallenge(g.member, g.challenge), canJudgeChallenge(g.member, g.challenge)]);
  const v = await visibleEntries(g.challenge, g.member.id, { canJudge });
  return Response.json({ challenge: g.challenge, entryCount: v.count, entries: v.entries, mine: v.mine, canEdit, canJudge });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await requireOpenChallenge((await params).id);
  if ("response" in g) return g.response;
  if (!(await canEditChallenge(g.member, g.challenge))) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (g.challenge.status !== "rascunho") {
    return Response.json({ error: "Desafio publicado não muda: quem já está construindo leu essas regras." }, { status: 409 });
  }
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  // só {publish: true} publica o rascunho como está; com campos, salva antes
  const onlyPublish = b?.publish === true && Object.keys(b).every((k) => k === "publish");
  if (!onlyPublish) {
    const parsed = parseOpenChallengeInput(b);
    if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
    if (!(await updateDraft(g.challenge.id, parsed.value))) {
      return Response.json({ error: "Esse rascunho já foi publicado." }, { status: 409 });
    }
  }
  let notified: number | null = null;
  if (b?.publish === true) {
    notified = await publishOpenChallenge(g.challenge.id, g.member);
    if (notified === null) {
      return Response.json({ error: "O prazo já passou. Escolha um prazo novo e publique." }, { status: 400 });
    }
  }
  return Response.json({ challenge: await getOpenChallenge(g.challenge.id), notified });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await requireOpenChallenge((await params).id);
  if ("response" in g) return g.response;
  if (!(await canEditChallenge(g.member, g.challenge))) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (g.challenge.status === "rascunho") {
    if (!(await deleteDraft(g.challenge.id))) return Response.json({ error: "Esse rascunho já foi publicado." }, { status: 409 });
    return Response.json({ ok: true, removed: "rascunho" });
  }
  if (!(await removeChallenge(g.challenge.id, g.member.id))) {
    return Response.json({ error: "Esse desafio já está fora do ar." }, { status: 409 });
  }
  return Response.json({ ok: true, removed: "publicado" });
}
