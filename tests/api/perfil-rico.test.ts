import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block } from "@/lib/blocks";
import { countFacts } from "@/lib/evidence";
import { deleteMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";
import { canModeratePost, deletePost, listPostIds, listPosts } from "@/lib/posts";
import { listLeaderboard } from "@/lib/members";
import { listPins, numberLabel, profileNumbers, pinnedProjects, testimonialStats } from "@/lib/profileFacts";
import { AREA_KEYS, areasFromJson, areaLabel, parseAreas } from "@/lib/areas";
import {
  RECADO_MAX,
  canWriteRecado,
  cleanRecado,
  listRecados,
  sameTextProfiles,
  writeRecado,
} from "@/lib/recados";
import { listTalent } from "@/lib/talent";
import { acceptTestimonial, writeTestimonial } from "@/lib/testimonials";

// Perfil rico (migration 041): números de fato, opt-in do perfil aberto,
// áreas de ajuda, fixados, filtros de /membros e /talento e o recado no
// perfil (escopo novo de PostScope) com anti-corrente, moderação e LGPD.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

const PAST = "hack-inova-unifacens-2026"; // agosto/2026: começou e acabou
const TEAM_TEXT = "Time do perfil rico";

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(extra: Record<string, unknown> = {}): Promise<M> {
  const tag = `pr${seq++}`;
  const cols = Object.keys(extra);
  const values = Object.values(extra);
  const row = await db
    .prepare(
      `INSERT INTO members (clerkId, username, email, name${cols.length ? `, ${cols.join(", ")}` : ""})
       VALUES (?, ?, ?, ?${cols.map(() => ", ?").join("")}) RETURNING id`,
    )
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, ...values);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const json = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const userCtx = (username: string) => ({ params: Promise.resolve({ username }) });
const idCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const routes = async () => ({
  me: await import("@/app/api/members/me/route"),
  recados: await import("@/app/api/members/[username]/recados/route"),
  like: await import("@/app/api/posts/[id]/like/route"),
});

/** n pessoas com check-in aprovado: a edição passa na regra antifarm */
async function makeEligible(hackathonId: string, n = 15) {
  for (let i = 0; i < n; i++) {
    const p = await member();
    const r = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
      .get<{ id: number }>(p.id, hackathonId);
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
  }
}

/** presença do membro na edição (entra na conta de edição elegível) */
async function attend(m: M, hackathonId: string) {
  const r = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
    .get<{ id: number }>(m.id, hackathonId);
  await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
  return r!.id;
}

async function team(hackathonId: string, people: M[], name = TEAM_TEXT) {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, name);
  for (const p of people) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, p.username);
  return t!.id;
}

const memberRow = async (id: number) =>
  (await db
    .prepare(
      `SELECT helpOffer, helpWant, publicProfile, recadosFrom FROM members WHERE id = ?`,
    )
    .get<{ helpOffer: string; helpWant: string; publicProfile: number; recadosFrom: string }>(id))!;

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("áreas de ajuda (lib/areas)", () => {
  it("é subconjunto de PERSONAS e tem rótulo de ajuda", () => {
    expect(AREA_KEYS).toEqual(["dev", "design", "produto", "dados", "empreendedor"]);
    expect(areaLabel("empreendedor")).toBe("negócio e pitch");
    expect(areaLabel("mentor")).toBeNull();
  });

  it("parseAreas rejeita chave desconhecida, repetida vira uma e o teto é 4", () => {
    expect(parseAreas(["dev", "dev", "design"])).toEqual({ value: ["dev", "design"] });
    expect(parseAreas(["mentor"])).toHaveProperty("error");
    expect(parseAreas(["dev", "design", "produto", "dados", "empreendedor"])).toHaveProperty("error");
    expect(parseAreas("dev")).toHaveProperty("error");
  });

  it("areasFromJson ignora JSON torto e chave que não existe mais", () => {
    expect(areasFromJson('["dev","mentor"]')).toEqual(["dev"]);
    expect(areasFromJson("nao é json")).toEqual([]);
    expect(areasFromJson(null)).toEqual([]);
  });
});

describe("números do perfil", () => {
  it("os quatro números batem com countFacts", async () => {
    await makeEligible(PAST);
    const eu = await member();
    await attend(eu, PAST);
    const t = await team(PAST, [eu]);
    await db
      .prepare("INSERT INTO project_submissions (teamId, version, submittedAt, snapshot) VALUES (?, 1, datetime('now'), '{}')")
      .run(t);
    const cat = await db
      .prepare("INSERT INTO prize_categories (hackathonId, kind, name, position) VALUES (?, 'geral', 'geral', 1) RETURNING id")
      .get<{ id: number }>(PAST);
    await db.prepare("INSERT INTO prize_winners (categoryId, teamId, place) VALUES (?, ?, 1)").run(cat!.id, t);
    await db
      .prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'mentor')")
      .run(PAST, eu.id);

    const facts = await countFacts(eu.id);
    const n = await profileNumbers(eu.id);
    expect(n).toEqual({
      presenca: facts.presenca,
      entrega: facts.entrega,
      premio: facts.premio,
      papel: facts.mentoria + facts.organizou,
    });
    expect(n.presenca).toBe(1);
    expect(n.entrega).toBe(1);
    expect(n.premio).toBe(1);
    expect(n.papel).toBe(1);
  });

  it("zero vira travessão, nunca 0 competindo com quem tem fato", () => {
    expect(numberLabel(0)).toBe("—");
    expect(numberLabel(3)).toBe("3");
  });
});

describe("PATCH /api/members/me (perfil rico)", () => {
  it("deslogado é 401 JSON", async () => {
    const { me } = await routes();
    const res = await me.PATCH(json("PATCH", { publicProfile: true }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("grava áreas de ajuda, perfil aberto e quem deixa recado", async () => {
    const eu = await member();
    as(eu);
    const { me } = await routes();
    const res = await me.PATCH(
      json("PATCH", { helpOffer: ["dev", "design"], helpWant: ["produto"], publicProfile: true, recadosFrom: "todos" }),
    );
    expect(res.status).toBe(200);
    const row = await memberRow(eu.id);
    expect(areasFromJson(row.helpOffer)).toEqual(["dev", "design"]);
    expect(areasFromJson(row.helpWant)).toEqual(["produto"]);
    expect(Number(row.publicProfile)).toBe(1);
    expect(row.recadosFrom).toBe("todos");
  });

  it("área fora da lista, cinco áreas, publicProfile não booleano e recadosFrom inválido dão 400", async () => {
    const eu = await member();
    as(eu);
    const { me } = await routes();
    for (const body of [
      { helpOffer: ["mentor"] },
      { helpWant: ["dev", "design", "produto", "dados", "empreendedor"] },
      { publicProfile: "sim" },
      { recadosFrom: "amigos" },
      { helpOffer: "dev" },
    ]) {
      const res = await me.PATCH(json("PATCH", body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // nada foi gravado pela metade
    const row = await memberRow(eu.id);
    expect(row.helpOffer).toBe("[]");
    expect(Number(row.publicProfile)).toBe(0);
    expect(row.recadosFrom).toBe("conexoes");
  });

  it("quarto fixado é 400 e pin de projeto alheio é 400", async () => {
    const eu = await member();
    const outro = await member();
    const meus: number[] = [];
    for (let i = 0; i < 4; i++) meus.push(await team(PAST, [eu], `Meu ${i}`));
    const alheio = await team(PAST, [outro], "Alheio");
    as(eu);
    const { me } = await routes();
    expect((await me.PATCH(json("PATCH", { pins: meus }))).status).toBe(400);
    expect((await me.PATCH(json("PATCH", { pins: [alheio] }))).status).toBe(400);
    const ok = await me.PATCH(json("PATCH", { pins: [meus[2], meus[0]] }));
    expect(ok.status).toBe(200);
    expect(await listPins(eu.id)).toEqual([meus[2], meus[0]]);
  });

  it("sem fixados o perfil mostra premiados e depois os mais recentes", async () => {
    const eu = await member();
    const recente = await team(PAST, [eu], "Recente");
    const campeao = await team(PAST, [eu], "Campeao");
    await db.prepare("UPDATE teams SET placement = 1 WHERE id = ?").run(campeao);
    const { projects, pinned } = await pinnedProjects(eu.id, eu.username);
    expect(pinned).toBe(false);
    expect(projects[0].teamId).toBe(campeao);
    expect(projects.map((p) => p.teamId)).toContain(recente);
  });
});

describe("recados no perfil", () => {
  it("deslogado é 401", async () => {
    const alvo = await member();
    const { recados } = await routes();
    const res = await recados.POST(json("POST", { body: "oi" }), userCtx(alvo.username));
    expect(res.status).toBe(401);
  });

  it("perfil inexistente é 404", async () => {
    const eu = await member();
    as(eu);
    const { recados } = await routes();
    const res = await recados.POST(json("POST", { body: "oi" }), userCtx("ninguem_aqui"));
    expect(res.status).toBe(404);
  });

  it("texto vazio ou acima de 280 é 400", async () => {
    const eu = await member();
    const alvo = await member({ recadosFrom: "todos" });
    as(eu);
    const { recados } = await routes();
    expect((await recados.POST(json("POST", { body: "   " }), userCtx(alvo.username))).status).toBe(400);
    expect((await recados.POST(json("POST", { body: "x".repeat(RECADO_MAX + 1) }), userCtx(alvo.username))).status).toBe(400);
    expect(cleanRecado("  oi\n\n\n")).toBe("oi");
  });

  it("sem laço, 'conexoes' barra com 403; 'ninguem' barra todo mundo", async () => {
    const eu = await member();
    const semLaco = await member();
    const fechado = await member({ recadosFrom: "ninguem" });
    as(eu);
    const { recados } = await routes();
    const r1 = await recados.POST(json("POST", { body: "oi" }), userCtx(semLaco.username));
    expect(r1.status).toBe(403);
    expect((await r1.json()).error).toMatch(/laço/);
    expect((await recados.POST(json("POST", { body: "oi" }), userCtx(fechado.username))).status).toBe(403);
  });

  it("mesma comunidade, mesma edição com check-in e seguir mútuo liberam o recado", async () => {
    const eu = await member();
    const daComunidade = await member();
    const daEdicao = await member();
    const mutual = await member();
    // comunidade: a seed traz hack-inova; entram os dois
    const com = await db.prepare("SELECT id FROM communities LIMIT 1").get<{ id: number }>();
    for (const m of [eu, daComunidade]) {
      await db.prepare("INSERT INTO community_members (communityId, memberId) VALUES (?, ?)").run(com!.id, m.id);
    }
    await makeEligible(PAST);
    await attend(eu, PAST);
    await attend(daEdicao, PAST);
    for (const [a, b] of [
      [eu.id, mutual.id],
      [mutual.id, eu.id],
    ]) {
      await db.prepare("INSERT INTO member_follows (memberId, followedId) VALUES (?, ?)").run(a, b);
    }
    as(eu);
    const { recados } = await routes();
    for (const alvo of [daComunidade, daEdicao, mutual]) {
      const res = await recados.POST(json("POST", { body: `recado pra ${alvo.username}` }), userCtx(alvo.username));
      expect(res.status, alvo.username).toBe(201);
    }
  });

  it("recadosFrom 'todos' libera qualquer conta ativa; bloqueio vale como 404", async () => {
    const eu = await member();
    const aberto = await member({ recadosFrom: "todos" });
    const bloqueou = await member({ recadosFrom: "todos" });
    await block(bloqueou.id, eu.id);
    as(eu);
    const { recados } = await routes();
    expect((await recados.POST(json("POST", { body: "oi" }), userCtx(aberto.username))).status).toBe(201);
    expect((await recados.POST(json("POST", { body: "oi" }), userCtx(bloqueou.username))).status).toBe(404);
  });

  it("1 por minuto pra mesma pessoa e 10 por hora", async () => {
    const eu = await member();
    const alvo = await member({ recadosFrom: "todos" });
    as(eu);
    const { recados } = await routes();
    expect((await recados.POST(json("POST", { body: "primeiro" }), userCtx(alvo.username))).status).toBe(201);
    const rapido = await recados.POST(json("POST", { body: "segundo" }), userCtx(alvo.username));
    expect(rapido.status).toBe(429);
    expect(rapido.headers.get("Retry-After")).toBeTruthy();
    // 10/h: cada recado pra um perfil diferente (o 1/min é por par)
    for (let i = 0; i < 9; i++) {
      const outro = await member({ recadosFrom: "todos" });
      const res = await recados.POST(json("POST", { body: `recado ${i}` }), userCtx(outro.username));
      expect(res.status, `recado ${i}`).toBe(201);
    }
    const decimo = await member({ recadosFrom: "todos" });
    expect((await recados.POST(json("POST", { body: "decimo primeiro" }), userCtx(decimo.username))).status).toBe(429);
  });

  it("mesmo texto pra mais de 5 perfis em 1h é corrente: 429", async () => {
    const eu = await member();
    as(eu);
    const { recados } = await routes();
    const texto = "passa no meu perfil, tenho novidade";
    for (let i = 0; i < 5; i++) {
      const alvo = await member({ recadosFrom: "todos" });
      const res = await recados.POST(json("POST", { body: texto }), userCtx(alvo.username));
      expect(res.status, `perfil ${i}`).toBe(201);
    }
    expect(await sameTextProfiles(eu.id, texto)).toBe(5);
    const sexto = await member({ recadosFrom: "todos" });
    const res = await recados.POST(json("POST", { body: texto }), userCtx(sexto.username));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/mesmo recado/i);
  });

  it("recado avisa a pessoa e não aparece no feed global nem na atividade do autor", async () => {
    const eu = await member();
    const alvo = await member({ recadosFrom: "todos" });
    const post = await writeRecado(await reload(eu), await reload(alvo), "recado direto pela lib");
    const notif = await db
      .prepare("SELECT type, text, href, actorId FROM notifications WHERE memberId = ? AND type = 'recado'")
      .get<{ type: string; text: string; href: string; actorId: number }>(alvo.id);
    expect(notif?.actorId).toBe(eu.id);
    expect(notif?.href).toBe(`/u/${alvo.username}?recados=todos`);
    expect(notif?.text).toContain("deixou um recado");

    const global = await listPosts(50, eu.id);
    expect(global.map((p) => p.id)).not.toContain(post.id);
    expect(await listPostIds({ kind: "member", id: eu.id }, eu.id)).not.toContain(post.id);
    expect(await listPostIds({ kind: "solto" }, eu.id)).not.toContain(post.id);
    const doPerfil = await listRecados(alvo.id, eu.id);
    expect(doPerfil.map((p) => p.id)).toEqual([post.id]);
    expect(doPerfil[0].profileId).toBe(alvo.id);
  });

  it("dono apaga qualquer recado, o autor apaga o seu e terceiro não apaga nada", async () => {
    const autor = await member();
    const dono = await member({ recadosFrom: "todos" });
    const terceiro = await member();
    const post = await writeRecado(await reload(autor), await reload(dono), "recado do autor");
    expect(await canModeratePost({ id: terceiro.id, role: "member" }, { ...post })).toBe(false);
    expect(await deletePost(post.id, { id: terceiro.id, role: "member" })).toBe(false);
    // o dono do perfil apaga o recado de outra pessoa
    expect(await deletePost(post.id, { id: dono.id, role: "member" })).toBe(true);
    const outro = await writeRecado(await reload(autor), await reload(dono), "outro recado");
    expect(await deletePost(outro.id, { id: autor.id, role: "member" })).toBe(true);
  });

  it("reação em recado é recusada", async () => {
    const autor = await member();
    const dono = await member({ recadosFrom: "todos" });
    const terceiro = await member();
    const post = await writeRecado(await reload(autor), await reload(dono), "recado sem like");
    as(terceiro);
    const { like } = await routes();
    const res = await like.POST(json("POST", { kind: "curti" }), idCtx(post.id));
    expect(res.status).toBe(400);
  });

  it("quem o autor bloqueou não vê o recado", async () => {
    const autor = await member();
    const dono = await member({ recadosFrom: "todos" });
    const leitor = await member();
    const post = await writeRecado(await reload(autor), await reload(dono), "recado que some");
    await block(autor.id, leitor.id);
    const vistos = await listRecados(dono.id, leitor.id);
    expect(vistos.map((p) => p.id)).not.toContain(post.id);
  });

  it("canWriteRecado devolve o motivo, não só o booleano", async () => {
    const eu = await member();
    const fechado = await member({ recadosFrom: "ninguem" });
    expect(await canWriteRecado(await reload(eu), await reload(fechado))).toEqual({ ok: false, reason: "ninguem" });
    expect(await canWriteRecado(await reload(eu), await reload(eu))).toEqual({ ok: false, reason: "ninguem" });
  });
});

describe("LGPD do perfil rico", () => {
  it("excluir a conta zera áreas, perfil aberto e recados, e leva os recados dos dois lados", async () => {
    const autor = await member();
    const dono = await member({ recadosFrom: "todos" });
    as(dono);
    const { me } = await routes();
    await me.PATCH(json("PATCH", { helpOffer: ["dev"], helpWant: ["design"], publicProfile: true }));
    const recado = await writeRecado(await reload(autor), await reload(dono), "recado no perfil do dono");

    await deleteMemberData(dono.id);
    const row = await memberRow(dono.id);
    expect(row.helpOffer).toBe("[]");
    expect(row.helpWant).toBe("[]");
    expect(Number(row.publicProfile)).toBe(0);
    expect(row.recadosFrom).toBe("conexoes");
    // quem recebeu saiu: o recado sai junto (profileId em PEER_COLUMNS)
    expect(await db.prepare("SELECT 1 FROM posts WHERE id = ?").get(recado.id)).toBeUndefined();

    const autor2 = await member();
    const dono2 = await member({ recadosFrom: "todos" });
    const recado2 = await writeRecado(await reload(autor2), await reload(dono2), "recado do autor que sai");
    await deleteMemberData(autor2.id);
    expect(await db.prepare("SELECT 1 FROM posts WHERE id = ?").get(recado2.id)).toBeUndefined();
  });
});

describe("filtros de /membros e /talento", () => {
  it("oferece, quer, cidade e faculdade filtram, e combinam com q", async () => {
    const dev = await member({ helpOffer: '["dev"]', city: "Sorocaba, SP", institution: "USP" });
    const design = await member({ helpOffer: '["design"]', helpWant: '["dev"]', institution: "UFSCar" });
    const semArea = await member();
    const usernames = async (filter: Parameters<typeof listLeaderboard>[3]) =>
      (await listLeaderboard("xp", 100, undefined, filter)).map((m) => m.username);

    const porDesign = await usernames({ oferece: "design" });
    expect(porDesign).toContain(design.username);
    expect(porDesign).not.toContain(dev.username);
    expect(porDesign).not.toContain(semArea.username);
    const porQuer = await usernames({ quer: "dev" });
    expect(porQuer).toContain(design.username);
    expect(porQuer).not.toContain(dev.username);
    const porFaculdade = await usernames({ faculdade: "usp" });
    expect(porFaculdade).toContain(dev.username);
    expect(porFaculdade).not.toContain(design.username);
    const porCidade = await usernames({ cidade: "sorocaba" });
    expect(porCidade).toContain(dev.username);
    expect(porCidade).not.toContain(design.username);
    expect(await usernames({ oferece: "dev", faculdade: "ufscar" })).not.toContain(dev.username);
    expect(await usernames({})).toEqual(expect.arrayContaining([dev.username, design.username, semArea.username]));
    // chave inválida não vira SQL: o padrão é null e o filtro não vale
    expect(await usernames({ oferece: "mentor" })).toEqual([]);
    const comQ = await listLeaderboard("xp", 100, "pr", { oferece: "dev" });
    expect(comQ.map((m) => m.username)).toContain(dev.username);
    expect(comQ.map((m) => m.username)).not.toContain(semArea.username);
  });

  it("/talento mostra a contagem de depoimentos e o primeiro trecho", async () => {
    await makeEligible(PAST);
    const autor = await member();
    const alvo = await member({ openTo: "trampo" });
    await attend(autor, PAST);
    await attend(alvo, PAST);
    await team(PAST, [autor, alvo], `Time depoimento ${seq++}`);
    const t = await writeTestimonial(autor.id, alvo.id, PAST, "Fechou o front inteiro e ainda cuidou do pitch no palco.");
    await acceptTestimonial(t.id, alvo.id, t.body);

    const stats = await testimonialStats([alvo.id]);
    expect(stats.get(alvo.id)?.count).toBe(1);
    const talent = await listTalent(100);
    const entry = talent.find((x) => x.username === alvo.username)!;
    expect(entry.testimonials).toBe(1);
    expect(entry.testimonial).toContain("Fechou o front");
  });
});

describe("migration 041", () => {
  it("sobe num banco que já tem members.city e cria o escopo de recado", async () => {
    const cols = await db
      .prepare(
        `SELECT column_name AS c FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'members'`,
      )
      .all<{ c: string }>();
    const names = cols.map((c) => c.c);
    expect(names).toEqual(expect.arrayContaining(["city", "institution", "course", "helpOffer", "helpWant", "publicProfile", "recadosFrom"]));
    const postCols = await db
      .prepare(
        `SELECT column_name AS c FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'posts'`,
      )
      .all<{ c: string }>();
    expect(postCols.map((c) => c.c)).toContain("profileId");
    const pins = await db
      .prepare(
        `SELECT column_name AS c FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'member_pins'`,
      )
      .all<{ c: string }>();
    expect(pins.map((c) => c.c).sort()).toEqual(["memberId", "position", "teamId"]);
  });

  it("recado não aceita escopo de edição nem de comunidade", async () => {
    const eu = await member();
    const dono = await member();
    await expect(
      db
        .prepare("INSERT INTO posts (memberId, body, profileId, hackathonId) VALUES (?, 'x', ?, ?)")
        .run(eu.id, dono.id, PAST),
    ).rejects.toThrow();
  });
});

/** membro com os campos do perfil rico já normalizados (Member) */
async function reload(m: M) {
  const { getMemberByClerkId } = await import("@/lib/members");
  return (await getMemberByClerkId(m.clerkId))!;
}
