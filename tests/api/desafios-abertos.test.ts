import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import {
  challengePhase,
  listOpenChallenges,
  parseEntryInput,
  parseOpenChallengeInput,
  parsePlaces,
  timeLeft,
} from "@/lib/openChallenges";
import { deleteMemberData } from "@/lib/privacy";
import { RATE_LIMITS, resetRateLimits } from "@/lib/ratelimit";

// Desafios abertos (migration 053): criar (403 membro comum, 3/dia), rascunho
// e publicar (avisa membros e seguidores uma vez), entregar (prazo, time
// alheio, quem organiza, https), entregas escondidas até o prazo, resultado
// (só quem criou, só depois do prazo, uma vez, avisa cada participante).

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const HACK = "hack-inova-alphaville-2026"; // seedado no bootstrap do db

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(role = "member"): Promise<M> {
  const tag = `da${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, role) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, role);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
async function community(owner: M, extra: { hidden?: number } = {}) {
  const slug = `desafio-${seq++}`;
  const c = await db
    .prepare("INSERT INTO communities (slug, name, createdBy, hidden) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`, owner.id, extra.hidden ?? 0);
  await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'dono')").run(c!.id, owner.id);
  return { id: c!.id, slug };
}
async function addRole(communityId: number, m: M, role: "organizador" | "membro") {
  await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, ?)").run(communityId, m.id, role);
}
async function team(usernames: string[], withProject = true) {
  const t = await db.prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id").get<{ id: number }>(HACK, `Time ${seq++}`);
  for (const u of usernames) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, u);
  if (withProject) await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, ?)").run(t!.id, `Projeto ${t!.id}`);
  return t!.id;
}

const future = (days = 7) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 16); // parede "UTC" lida como Brasília: ainda futuro
};
const req = (method: string, body?: unknown, url = "http://t") =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const idCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const routes = {
  list: () => import("@/app/api/open-challenges/route"),
  one: () => import("@/app/api/open-challenges/[id]/route"),
  entry: () => import("@/app/api/open-challenges/[id]/entry/route"),
  result: () => import("@/app/api/open-challenges/[id]/result/route"),
};
const body = (slug: string, extra: Record<string, unknown> = {}) => ({
  community: slug,
  title: "Fila do bandejão",
  brief: "Um app que mostra a fila do bandejão em tempo real.",
  rules: "Solo ou em time.",
  prize: "R$ 500",
  deadline: future(),
  ...extra,
});
async function create(slug: string, extra: Record<string, unknown> = {}) {
  const { POST } = await routes.list();
  const res = await POST(req("POST", body(slug, extra)));
  return { res, data: (await res.json()) as { challenge: { id: number; status: string; phase: string; deadline: string }; notified: number; error?: string } };
}
/** desafio aberto com o prazo já vencido, direto no banco */
async function closeNow(id: number) {
  await db.prepare("UPDATE open_challenges SET deadline = ? WHERE id = ?").run("2020-01-01T10:00:00-03:00", id);
}
const notes = (memberId: number, type: string) =>
  db.prepare("SELECT text, href, actorId FROM notifications WHERE memberId = ? AND type = ? ORDER BY id").all<{
    text: string;
    href: string;
    actorId: number;
  }>(memberId, type);

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("validação pura", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  it("desafio: título, descrição e prazo obrigatórios; prazo entre 1 h e 1 ano; prazo sai com offset de Brasília", () => {
    expect(parseOpenChallengeInput({ brief: "x", deadline: "2026-11-10T23:59" }, now)).toEqual({ error: "Dê um título ao desafio." });
    expect(parseOpenChallengeInput({ title: "x", deadline: "2026-11-10T23:59" }, now)).toEqual({ error: "Escreva o que é pra construir." });
    expect(parseOpenChallengeInput({ title: "x", brief: "y" }, now)).toEqual({ error: "Escolha o prazo de entrega." });
    expect(parseOpenChallengeInput({ title: "x", brief: "y", deadline: "2026-10-28T09:30" }, now)).toEqual({
      error: "O prazo precisa ser pelo menos 1 hora à frente.",
    });
    expect(parseOpenChallengeInput({ title: "x", brief: "y", deadline: "2028-01-01T10:00" }, now)).toEqual({
      error: "O prazo vai até 1 ano à frente.",
    });
    expect(parseOpenChallengeInput({ title: "x".repeat(101), brief: "y", deadline: "2026-11-10T23:59" }, now)).toEqual({
      error: "Título até 100 caracteres.",
    });
    expect(parseOpenChallengeInput({ title: "x", brief: "y".repeat(3001), deadline: "2026-11-10T23:59" }, now)).toEqual({
      error: "Descrição até 3000 caracteres.",
    });
    expect(parseOpenChallengeInput({ title: "x", brief: "y", prize: "p".repeat(201), deadline: "2026-11-10T23:59" }, now)).toEqual({
      error: "Prêmio até 200 caracteres.",
    });
    const ok = parseOpenChallengeInput({ title: "  Fila   do bandejão ", brief: "y", sponsorName: " ", deadline: "2026-11-10T23:59" }, now);
    expect(ok).toEqual({
      value: { title: "Fila do bandejão", brief: "y", rules: null, prize: null, sponsorName: null, deadline: "2026-11-10T23:59:00-03:00" },
    });
  });

  it("entrega: resumo obrigatório, projeto ou repo, links só https", () => {
    expect(parseEntryInput({ repoUrl: "https://github.com/a/b" })).toEqual({ error: "Conte em poucas linhas o que você fez." });
    expect(parseEntryInput({ summary: "fiz" })).toEqual({ error: "Escolha um projeto seu do HackaHub ou cole o link do repo." });
    expect(parseEntryInput({ summary: "fiz", repoUrl: "http://github.com/a/b" })).toEqual({ error: "O repo precisa de link https://" });
    expect(parseEntryInput({ summary: "fiz", repoUrl: "javascript:alert(1)" })).toEqual({ error: "O repo precisa de link https://" });
    expect(parseEntryInput({ summary: "fiz", teamId: 3, demoUrl: "ftp://x.com" })).toEqual({ error: "A demo precisa de link https://" });
    expect(parseEntryInput({ summary: "fiz", teamId: "abc" })).toEqual({ error: "Projeto inválido." });
    expect(parseEntryInput({ summary: "x".repeat(1001), teamId: 3 })).toEqual({ error: "Resumo até 1000 caracteres." });
    expect(parseEntryInput({ summary: " fiz ", teamId: "3" })).toEqual({ value: { teamId: 3, repoUrl: null, demoUrl: null, summary: "fiz" } });
  });

  it("colocações: 1º obrigatório, sem lugar nem entrega repetida", () => {
    expect(parsePlaces(undefined)).toEqual({ error: "Escolha pelo menos o 1º lugar." });
    expect(parsePlaces([{ entryId: 1, place: 2 }])).toEqual({ error: "Escolha pelo menos o 1º lugar." });
    expect(parsePlaces([{ entryId: 1, place: 4 }])).toEqual({ error: "Colocação inválida." });
    expect(parsePlaces([{ entryId: 1, place: 1 }, { entryId: 2, place: 1 }])).toEqual({ error: "Cada colocação vai pra uma entrega só." });
    expect(parsePlaces([{ entryId: 1, place: 1 }, { entryId: 1, place: 2 }])).toEqual({ error: "Uma entrega leva uma colocação só." });
    expect(parsePlaces([{ entryId: 1, place: 1 }, { entryId: 2, place: 3 }])).toEqual({
      value: [
        { entryId: 1, place: 1 },
        { entryId: 2, place: 3 },
      ],
    });
  });

  it("encerrado é calculado pelo prazo, sem cron", () => {
    expect(challengePhase({ status: "aberto", deadline: "2026-10-28T08:59:00-03:00" }, now)).toBe("encerrado");
    expect(challengePhase({ status: "aberto", deadline: "2026-10-28T09:01:00-03:00" }, now)).toBe("aberto");
    expect(challengePhase({ status: "rascunho", deadline: "2020-01-01" }, now)).toBe("rascunho");
    expect(challengePhase({ status: "resultado", deadline: "2020-01-01" }, now)).toBe("resultado");
    expect(timeLeft("2026-10-28T09:30:00-03:00", now)).toBe("falta menos de 1 hora");
    expect(timeLeft("2026-10-28T14:00:00-03:00", now)).toBe("faltam 5 h");
    expect(timeLeft("2026-11-04T09:00:00-03:00", now)).toBe("faltam 7 dias");
    expect(timeLeft("2026-10-27T09:00:00-03:00", now)).toBe("prazo encerrado");
  });
});

describe("criar", () => {
  it("401 deslogado, 403 membro comum e quem é de fora, 404 comunidade escondida, 201 dono e organizador", async () => {
    const dono = await member();
    const c = await community(dono);
    const comum = await member();
    await addRole(c.id, comum, "membro");
    const fora = await member();
    const org = await member();
    await addRole(c.id, org, "organizador");

    expect((await create(c.slug)).res.status).toBe(401);
    as(comum);
    expect((await create(c.slug)).res.status).toBe(403);
    as(fora);
    expect((await create(c.slug)).res.status).toBe(403);
    expect((await create("nao-existe")).res.status).toBe(404);
    as(dono);
    const a = await create(c.slug);
    expect(a.res.status).toBe(201);
    expect(a.data.challenge).toMatchObject({ status: "rascunho", phase: "rascunho" });
    as(org);
    expect((await create(c.slug, { publish: true })).res.status).toBe(201);

    const donoEsc = await member();
    const esc = await community(donoEsc, { hidden: 1 });
    as(donoEsc);
    expect((await create(esc.slug)).res.status).toBe(404);
  });

  it("400 sem comunidade ou com campo inválido; 3 por dia por membro (chave open-challenges)", async () => {
    const dono = await member();
    const c = await community(dono);
    as(dono);
    const { POST } = await routes.list();
    expect((await POST(req("POST", { title: "x" }))).status).toBe(400);
    expect((await create(c.slug, { deadline: "2020-01-01T10:00" })).res.status).toBe(400);
    expect((await create(c.slug, { title: "" })).data.error).toBe("Dê um título ao desafio.");
    expect(RATE_LIMITS["open-challenges"]).toEqual({ limit: 3, windowMs: 24 * 60 * 60 * 1000 });
    for (let i = 0; i < 3; i++) expect((await create(c.slug)).res.status).toBe(201);
    const blocked = await create(c.slug);
    expect(blocked.res.status).toBe(429);
  });
});

describe("rascunho e publicar", () => {
  it("rascunho não aparece pra ninguém fora da organização; publicar avisa membros e seguidores uma vez", async () => {
    const dono = await member();
    const c = await community(dono);
    const membro = await member();
    await addRole(c.id, membro, "membro");
    const seguidor = await member();
    await db.prepare("INSERT INTO community_follows (communityId, memberId) VALUES (?, ?)").run(c.id, seguidor.id);
    const fora = await member();

    as(dono);
    const { data } = await create(c.slug, { sponsorName: "Padaria Pão Quente" });
    const id = data.challenge.id;
    const one = await routes.one();

    as(membro);
    expect((await one.GET(req("GET"), idCtx(id))).status).toBe(404);
    expect((await one.PATCH(req("PATCH", { publish: true }), idCtx(id))).status).toBe(404);
    expect((await listOpenChallenges()).open.map((x) => x.id)).not.toContain(id);
    expect(await notes(membro.id, "desafio_aberto")).toEqual([]);

    as(dono);
    const edit = await one.PATCH(req("PATCH", { ...body(c.slug), title: "Fila do RU", sponsorName: "Padaria Pão Quente" }), idCtx(id));
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as { challenge: { title: string } }).challenge.title).toBe("Fila do RU");

    const pub = await one.PATCH(req("PATCH", { publish: true }), idCtx(id));
    expect(pub.status).toBe(200);
    expect(((await pub.json()) as { notified: number }).notified).toBe(2);
    for (const m of [membro, seguidor]) {
      expect(await notes(m.id, "desafio_aberto")).toEqual([
        { text: `Comunidade ${c.slug} abriu o desafio "Fila do RU", patrocinado por Padaria Pão Quente.`, href: `/desafios/${id}`, actorId: dono.id },
      ]);
    }
    expect(await notes(dono.id, "desafio_aberto")).toEqual([]);
    expect(await notes(fora.id, "desafio_aberto")).toEqual([]);

    // publicado: não edita, não publica de novo, não apaga
    expect((await one.PATCH(req("PATCH", { publish: true }), idCtx(id))).status).toBe(409);
    expect((await one.PATCH(req("PATCH", body(c.slug)), idCtx(id))).status).toBe(409);
    expect((await one.DELETE(req("DELETE"), idCtx(id))).status).toBe(409);
    expect((await notes(membro.id, "desafio_aberto")).length).toBe(1);

    as(fora);
    const seen = await one.GET(req("GET"), idCtx(id));
    expect(seen.status).toBe(200);
    expect(((await seen.json()) as { challenge: { sponsorName: string } }).challenge.sponsorName).toBe("Padaria Pão Quente");
    expect((await one.PATCH(req("PATCH", { publish: true }), idCtx(id))).status).toBe(403);
  });

  it("rascunho com prazo vencido não publica; apagar rascunho", async () => {
    const dono = await member();
    const c = await community(dono);
    as(dono);
    const { data } = await create(c.slug);
    await closeNow(data.challenge.id);
    const one = await routes.one();
    const r = await one.PATCH(req("PATCH", { publish: true }), idCtx(data.challenge.id));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/prazo já passou/);
    expect((await one.DELETE(req("DELETE"), idCtx(data.challenge.id))).status).toBe(200);
    expect((await one.GET(req("GET"), idCtx(data.challenge.id))).status).toBe(404);
  });

  it("id inválido e comunidade escondida dão 404; GET deslogado 401", async () => {
    const dono = await member();
    const c = await community(dono);
    as(dono);
    const { data } = await create(c.slug, { publish: true });
    const one = await routes.one();
    expect((await one.GET(req("GET"), idCtx("abc"))).status).toBe(404);
    expect((await one.GET(req("GET"), idCtx(999999))).status).toBe(404);
    await db.prepare("UPDATE communities SET hidden = 1 WHERE id = ?").run(c.id);
    const outro = await member();
    as(outro);
    expect((await one.GET(req("GET"), idCtx(data.challenge.id))).status).toBe(404);
    expect((await listOpenChallenges()).open.map((x) => x.id)).not.toContain(data.challenge.id);
    const admin = await member("admin");
    as(admin);
    expect((await one.GET(req("GET"), idCtx(data.challenge.id))).status).toBe(200);
    as(null);
    expect((await one.GET(req("GET"), idCtx(data.challenge.id))).status).toBe(401);
  });
});

describe("entregar", () => {
  async function openChallenge() {
    const dono = await member();
    const c = await community(dono);
    as(dono);
    const { data } = await create(c.slug, { publish: true });
    return { dono, c, id: data.challenge.id };
  }
  const submit = async (id: number, b: unknown) => (await routes.entry()).POST(req("POST", b), idCtx(id));

  it("membro logado entrega com repo ou com projeto do próprio time e pode atualizar", async () => {
    const { id } = await openChallenge();
    const ana = await member();
    as(ana);
    const r = await submit(id, { repoUrl: "https://github.com/ana/fila", summary: "fiz a fila" });
    expect(r.status).toBe(201);
    const t = await team([ana.username]);
    const r2 = await submit(id, { teamId: t, demoUrl: "https://fila.example.com", summary: "agora com o projeto do time" });
    expect(r2.status).toBe(201);
    const rows = await db.prepare("SELECT teamId, repoUrl, demoUrl, summary FROM open_challenge_entries WHERE challengeId = ?").all(id);
    expect(rows).toEqual([{ teamId: t, repoUrl: null, demoUrl: "https://fila.example.com/", summary: "agora com o projeto do time" }]);
  });

  it("teamId de time alheio (ou sem projeto) dá 403", async () => {
    const { id } = await openChallenge();
    const ana = await member();
    const beto = await member();
    const doBeto = await team([beto.username]);
    const semProjeto = await team([ana.username], false);
    as(ana);
    const r = await submit(id, { teamId: doBeto, summary: "peguei o do beto" });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("Esse projeto não é de um time seu.");
    expect((await submit(id, { teamId: semProjeto, summary: "sem projeto" })).status).toBe(403);
    expect((await submit(id, { teamId: 999999, summary: "não existe" })).status).toBe(403);
  });

  it("entrega depois do prazo dá 400, e tirar entrega também", async () => {
    const { id } = await openChallenge();
    const ana = await member();
    as(ana);
    expect((await submit(id, { repoUrl: "https://github.com/a/b", summary: "a tempo" })).status).toBe(201);
    await closeNow(id);
    const late = await submit(id, { repoUrl: "https://github.com/a/b", summary: "atrasado" });
    expect(late.status).toBe(400);
    expect(((await late.json()) as { error: string }).error).toBe("O prazo deste desafio acabou. Não dá mais pra entregar.");
    // corpo inválido depois do prazo também responde o prazo
    expect((await submit(id, {})).status).toBe(400);
    expect((await (await routes.entry()).DELETE(req("DELETE"), idCtx(id))).status).toBe(400);
    const row = await db.prepare("SELECT summary FROM open_challenge_entries WHERE challengeId = ?").get<{ summary: string }>(id);
    expect(row?.summary).toBe("a tempo");
  });

  it("quem organiza a comunidade não entrega; rascunho não recebe entrega; 401 deslogado", async () => {
    const { dono, c, id } = await openChallenge();
    const org = await member();
    await addRole(c.id, org, "organizador");
    as(dono);
    expect((await submit(id, { repoUrl: "https://github.com/a/b", summary: "eu mesmo" })).status).toBe(403);
    as(org);
    expect((await submit(id, { repoUrl: "https://github.com/a/b", summary: "org" })).status).toBe(403);
    as(dono);
    const draft = await create(c.slug);
    const ana = await member();
    as(ana);
    expect((await submit(draft.data.challenge.id, { repoUrl: "https://github.com/a/b", summary: "x" })).status).toBe(404);
    as(null);
    expect((await submit(id, { repoUrl: "https://github.com/a/b", summary: "x" })).status).toBe(401);
  });

  it("conta excluída não entrega (canNetwork)", async () => {
    const { id } = await openChallenge();
    const ana = await member();
    await db.prepare("UPDATE members SET clerkId = ? WHERE id = ?").run(`deleted:${ana.id}`, ana.id);
    // a sessão de quem excluiu não existe mais: currentMember não acha a conta
    as({ clerkId: `deleted:${ana.id}` });
    const r = await submit(id, { repoUrl: "https://github.com/a/b", summary: "x" });
    expect([401, 403]).toContain(r.status);
  });

  it("entregas ficam escondidas até o prazo: antes só contagem e a própria; depois todas", async () => {
    const { dono, id } = await openChallenge();
    const ana = await member();
    const beto = await member();
    as(ana);
    await submit(id, { repoUrl: "https://github.com/ana/x", summary: "da ana" });
    as(beto);
    await submit(id, { repoUrl: "https://github.com/beto/x", summary: "do beto" });
    const one = await routes.one();
    type View = { entryCount: number; entries: { summary: string }[] | null; mine: { summary: string } | null };

    as(ana);
    let v = (await (await one.GET(req("GET"), idCtx(id))).json()) as View;
    expect(v.entryCount).toBe(2);
    expect(v.entries).toBeNull();
    expect(v.mine?.summary).toBe("da ana");
    // nem quem criou vê antes do prazo
    as(dono);
    v = (await (await one.GET(req("GET"), idCtx(id))).json()) as View;
    expect(v.entries).toBeNull();
    expect(v.mine).toBeNull();

    await closeNow(id);
    const curioso = await member();
    as(curioso);
    v = (await (await one.GET(req("GET"), idCtx(id))).json()) as View;
    expect(v.entries?.map((e) => e.summary)).toEqual(["da ana", "do beto"]);
  });

  it("tirar a própria entrega antes do prazo", async () => {
    const { id } = await openChallenge();
    const ana = await member();
    as(ana);
    const entry = await routes.entry();
    expect((await entry.DELETE(req("DELETE"), idCtx(id))).status).toBe(404);
    await submit(id, { repoUrl: "https://github.com/ana/x", summary: "da ana" });
    expect((await entry.DELETE(req("DELETE"), idCtx(id))).status).toBe(200);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM open_challenge_entries WHERE challengeId = ?").get(id)).toEqual({ n: 0 });
  });
});

describe("resultado", () => {
  async function closedWithEntries() {
    const dono = await member();
    const c = await community(dono);
    as(dono);
    const { data } = await create(c.slug, { publish: true });
    const id = data.challenge.id;
    const people = [await member(), await member(), await member(), await member()];
    for (const p of people) {
      as(p);
      await (await routes.entry()).POST(req("POST", { repoUrl: `https://github.com/${p.username}/x`, summary: `de ${p.username}` }), idCtx(id));
    }
    const entries = await db
      .prepare("SELECT id, memberId FROM open_challenge_entries WHERE challengeId = ? ORDER BY id")
      .all<{ id: number; memberId: number }>(id);
    return { dono, c, id, people, entries };
  }
  const post = async (id: number, places: unknown) => (await routes.result()).POST(req("POST", { places }), idCtx(id));

  it("só depois do prazo; só quem criou (ou dono da comunidade); publica uma vez e avisa cada participante", async () => {
    const { dono, c, id, people, entries } = await closedWithEntries();
    const places = [
      { entryId: entries[1].id, place: 1 },
      { entryId: entries[0].id, place: 2 },
      { entryId: entries[3].id, place: 3 },
    ];
    as(dono);
    const early = await post(id, places);
    expect(early.status).toBe(400);
    expect(((await early.json()) as { error: string }).error).toBe("O resultado sai depois do prazo de entrega.");

    await closeNow(id);
    as(people[0]);
    expect((await post(id, places)).status).toBe(403);
    const org = await member();
    await addRole(c.id, org, "organizador");
    as(org);
    expect((await post(id, places)).status).toBe(403);

    as(dono);
    expect((await post(id, [{ entryId: 999999, place: 1 }])).status).toBe(400);
    // o 400 acima desfez tudo: o desafio continua esperando resultado
    expect(await db.prepare("SELECT status FROM open_challenges WHERE id = ?").get(id)).toEqual({ status: "aberto" });
    const ok = await post(id, places);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { notified: number; challenge: { phase: string } })).toMatchObject({
      notified: 4,
      challenge: { phase: "resultado" },
    });
    expect((await post(id, places)).status).toBe(409);

    expect(await notes(people[1].id, "desafio_resultado")).toEqual([
      { text: `Saiu o resultado de "Fila do bandejão": sua entrega ficou em 1º lugar.`, href: `/desafios/${id}`, actorId: dono.id },
    ]);
    expect((await notes(people[0].id, "desafio_resultado"))[0].text).toMatch(/2º lugar/);
    expect((await notes(people[3].id, "desafio_resultado"))[0].text).toMatch(/3º lugar/);
    expect((await notes(people[2].id, "desafio_resultado"))[0].text).toBe(`Saiu o resultado de "Fila do bandejão". Veja quem levou.`);

    const curioso = await member();
    as(curioso);
    const v = (await (await (await routes.one()).GET(req("GET"), idCtx(id))).json()) as {
      entries: { memberId: number; place: number | null }[];
    };
    expect(v.entries.map((e) => [e.memberId, e.place])).toEqual([
      [people[1].id, 1],
      [people[0].id, 2],
      [people[3].id, 3],
      [people[2].id, null],
    ]);
    const { closed } = await listOpenChallenges({ communityId: c.id });
    expect(closed.map((x) => [x.id, x.phase])).toEqual([[id, "resultado"]]);
  });

  it("dono da comunidade publica o resultado de desafio criado por organizador", async () => {
    const dono = await member();
    const c = await community(dono);
    const org = await member();
    await addRole(c.id, org, "organizador");
    as(org);
    const { data } = await create(c.slug, { publish: true });
    const ana = await member();
    as(ana);
    await (await routes.entry()).POST(req("POST", { repoUrl: "https://github.com/a/b", summary: "x" }), idCtx(data.challenge.id));
    await closeNow(data.challenge.id);
    const e = await db.prepare("SELECT id FROM open_challenge_entries WHERE challengeId = ?").get<{ id: number }>(data.challenge.id);
    as(dono);
    expect((await post(data.challenge.id, [{ entryId: e!.id, place: 1 }])).status).toBe(200);
  });
});

describe("listagem e LGPD", () => {
  it("abertos pelo prazo mais próximo; filtro por comunidade; GET da rota", async () => {
    const dono = await member();
    const c = await community(dono);
    as(dono);
    const longe = await create(c.slug, { publish: true, deadline: future(20), title: "Longe" });
    const perto = await create(c.slug, { publish: true, deadline: future(2), title: "Perto" });
    const { open } = await listOpenChallenges({ communityId: c.id });
    expect(open.map((x) => x.title)).toEqual(["Perto", "Longe"]);
    expect(open.map((x) => x.id)).toEqual([perto.data.challenge.id, longe.data.challenge.id]);
    const { GET } = await routes.list();
    const r = (await (await GET(req("GET", undefined, `http://t/api/open-challenges?comunidade=${c.slug}`))).json()) as {
      open: { title: string }[];
    };
    expect(r.open.map((x) => x.title)).toEqual(["Perto", "Longe"]);
    const none = (await (await GET(req("GET", undefined, "http://t/api/open-challenges?comunidade=nao-existe"))).json()) as {
      open: unknown[];
    };
    expect(none.open).toEqual([]);
    as(null);
    expect((await GET(req("GET"))).status).toBe(401);
  });

  it("excluir a conta apaga a entrega; o desafio de quem criou fica", async () => {
    const dono = await member();
    const c = await community(dono);
    as(dono);
    const { data } = await create(c.slug, { publish: true });
    const ana = await member();
    as(ana);
    await (await routes.entry()).POST(req("POST", { repoUrl: "https://github.com/a/b", summary: "x" }), idCtx(data.challenge.id));
    await deleteMemberData(ana.id);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM open_challenge_entries WHERE memberId = ?").get(ana.id)).toEqual({ n: 0 });
    await deleteMemberData(dono.id);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM open_challenges WHERE id = ?").get(data.challenge.id)).toEqual({ n: 1 });
  });
});
