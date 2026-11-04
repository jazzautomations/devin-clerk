import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block, mute } from "@/lib/blocks";
import { deleteMemberData } from "@/lib/privacy";
import { rateLimit, RATE_LIMITS, resetRateLimits } from "@/lib/ratelimit";
import { suggestCommunities, suggestPeople } from "@/lib/suggestions";
import {
  countNewPosts,
  isLive,
  isTimelineTab,
  listLiveEditions,
  parseCursor,
  TIMELINE_PAGE_SIZE,
  TIMELINE_TABS,
  timelineDefaultTab,
  timelinePage,
} from "@/lib/timeline";

// Timeline (spec 046, onda 2, migration 038): cada aba, o cursor por id, o
// que nunca aparece (comunidade escondida, edição fora do ar, bloqueio,
// silêncio), a rota /api/feed (401, 400, 429, ?desde=) e as sugestões do
// estado vazio (time, comunidade, skill, persona — nunca popularidade).

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string };

async function member(fields: { city?: string; skills?: string[]; persona?: string; xp?: number } = {}): Promise<M> {
  const tag = `tl${seq++}`;
  const row = await db
    .prepare(
      "INSERT INTO members (clerkId, username, email, name, city, skills, persona, xp) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .get<{ id: number }>(
      `clerk_${tag}`,
      `u_${tag}`,
      `${tag}@t.dev`,
      `Pessoa ${tag}`,
      fields.city ?? null,
      JSON.stringify(fields.skills ?? []),
      fields.persona ?? null,
      fields.xp ?? 0,
    );
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}

async function follow(a: number, b: number) {
  await db.prepare("INSERT INTO member_follows (memberId, followedId) VALUES (?, ?)").run(a, b);
}

async function community(slug: string, opts: { hidden?: number; members?: number[]; city?: string } = {}) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name, city, hidden) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`, opts.city ?? "Recife, PE", opts.hidden ?? 0);
  for (const m of opts.members ?? []) {
    await db.prepare("INSERT INTO community_members (communityId, memberId) VALUES (?, ?)").run(c!.id, m);
  }
  return { id: c!.id, slug };
}

async function edition(
  id: string,
  opts: { communityId?: number | null; startsAt?: string; endsAt?: string | null; active?: number; source?: string } = {},
) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source, communityId, location)
       VALUES (?, ?, 'Org', ?, ?, 'presencial', '', '[]', ?, ?, ?, 'Recife, PE')`,
    )
    .run(
      id,
      `Edição ${id}`,
      opts.startsAt ?? "2026-11-03T09:00:00-03:00",
      opts.endsAt ?? null,
      opts.active ?? 1,
      opts.source ?? "painel",
      opts.communityId ?? null,
    );
}

async function post(by: number, body: string, opts: { communityId?: number | null; hackathonId?: string | null } = {}) {
  const row = await db
    .prepare("INSERT INTO posts (memberId, body, communityId, hackathonId) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(by, body, opts.communityId ?? null, opts.hackathonId ?? null);
  return row!.id;
}

const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const route = () => import("@/app/api/feed/route");
const get = (qs = "") => new Request(`http://t/api/feed${qs}`);
const ids = (posts: { id: number }[]) => posts.map((p) => p.id);

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("abas da timeline", () => {
  it("seguindo: quem eu sigo, minhas comunidades, minhas edições e os meus posts", async () => {
    const me = await member();
    const seguido = await member();
    const estranho = await member();
    await follow(me.id, seguido.id);
    const minha = await community("tl-minha", { members: [me.id, estranho.id] });
    const outra = await community("tl-outra", { members: [estranho.id] });
    await edition("tl-ed-minha");
    await edition("tl-ed-outra");
    await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, 'tl-ed-minha', 'approved')").run(me.id);

    const doSeguido = await post(seguido.id, "post de quem eu sigo");
    const doEstranho = await post(estranho.id, "post de quem eu não sigo");
    const naMinha = await post(estranho.id, "mural da minha comunidade", { communityId: minha.id });
    const naOutra = await post(estranho.id, "mural de outra comunidade", { communityId: outra.id });
    const naMinhaEdicao = await post(estranho.id, "mural da minha edição", { hackathonId: "tl-ed-minha" });
    const naOutraEdicao = await post(estranho.id, "mural de outra edição", { hackathonId: "tl-ed-outra" });
    const meu = await post(me.id, "post meu");

    const page = await timelinePage(me.id, "seguindo");
    expect(ids(page.posts).sort()).toEqual([doSeguido, naMinha, naMinhaEdicao, meu].sort());
    for (const fora of [doEstranho, naOutra, naOutraEdicao]) expect(ids(page.posts)).not.toContain(fora);
    expect(page.next).toBeNull();
    // cronológico: id DESC
    expect(ids(page.posts)).toEqual([...ids(page.posts)].sort((a, b) => b - a));
  });

  it("comunidades: só o mural das comunidades que eu acompanho (membro ou seguir leve)", async () => {
    const me = await member();
    const outro = await member();
    const membro = await community("tl-com-membro", { members: [me.id, outro.id] });
    const seguida = await community("tl-com-seguida", { members: [outro.id] });
    const alheia = await community("tl-com-alheia", { members: [outro.id] });
    await db.prepare("INSERT INTO community_follows (communityId, memberId) VALUES (?, ?)").run(seguida.id, me.id);
    const a = await post(outro.id, "mural membro", { communityId: membro.id });
    const b = await post(outro.id, "mural seguida", { communityId: seguida.id });
    const c = await post(outro.id, "mural alheia", { communityId: alheia.id });

    const page = await timelinePage(me.id, "comunidades");
    expect(ids(page.posts).sort()).toEqual([a, b].sort());
    expect(ids(page.posts)).not.toContain(c);
  });

  it("ao vivo: mural das edições que rodam agora (hosted), fora da janela não entra", async () => {
    const autor = await member();
    const agora = new Date();
    const ontem = new Date(agora.getTime() - 3 * 86_400_000).toISOString();
    const amanha = new Date(agora.getTime() + 86_400_000).toISOString();
    await edition("tl-live", { startsAt: ontem, endsAt: amanha });
    await edition("tl-futura", { startsAt: amanha, endsAt: null });
    await edition("tl-acabou", { startsAt: "2026-01-02T09:00:00-03:00", endsAt: "2026-01-03T18:00:00-03:00" });
    await edition("tl-externa", { startsAt: ontem, endsAt: amanha, source: "radar" });
    const dentro = await post(autor.id, "mural da edição rolando", { hackathonId: "tl-live" });
    const futura = await post(autor.id, "mural da edição futura", { hackathonId: "tl-futura" });
    const acabou = await post(autor.id, "mural da edição que acabou", { hackathonId: "tl-acabou" });
    const externa = await post(autor.id, "mural de evento do radar", { hackathonId: "tl-externa" });

    const page = await timelinePage(autor.id, "ao-vivo");
    expect(ids(page.posts)).toContain(dentro);
    for (const fora of [futura, acabou, externa]) expect(ids(page.posts)).not.toContain(fora);
    const live = await listLiveEditions();
    expect(live.map((e) => e.id)).toContain("tl-live");
    expect(live.map((e) => e.id)).not.toContain("tl-futura");
    expect(live.map((e) => e.id)).not.toContain("tl-externa");
  });

  it("isLive: do início até o fim; sem fim, um dia de evento", () => {
    const agora = new Date("2026-11-03T15:00:00-03:00");
    expect(isLive({ startsAt: "2026-11-03T09:00:00-03:00", endsAt: "2026-11-04T18:00:00-03:00" }, agora)).toBe(true);
    expect(isLive({ startsAt: "2026-11-03T09:00:00-03:00", endsAt: null }, agora)).toBe(true);
    expect(isLive({ startsAt: "2026-11-04T09:00:00-03:00", endsAt: null }, agora)).toBe(false);
    expect(isLive({ startsAt: "2026-10-30T09:00:00-03:00", endsAt: null }, agora)).toBe(false);
    expect(isLive({ startsAt: "nao-e-data", endsAt: null }, agora)).toBe(false);
  });

  it("tudo: todo post visível, em ordem de id", async () => {
    const autor = await member();
    const a = await post(autor.id, "post solto no tudo");
    const page = await timelinePage(autor.id, "tudo");
    expect(ids(page.posts)).toContain(a);
    expect(ids(page.posts)).toEqual([...ids(page.posts)].sort((x, y) => y - x));
  });
});

describe("cursor e o que nunca aparece", () => {
  it("pagina por cursor (id < antes), 20 por página, sem repetir e sem OFFSET", async () => {
    const me = await member();
    const outro = await member();
    const c = await community("tl-cursor", { members: [me.id, outro.id] });
    const criados: number[] = [];
    for (let i = 0; i < 25; i++) criados.push(await post(outro.id, `post ${i}`, { communityId: c.id }));

    const p1 = await timelinePage(me.id, "comunidades");
    expect(p1.posts).toHaveLength(TIMELINE_PAGE_SIZE);
    expect(p1.next).toBe(p1.posts[p1.posts.length - 1].id);
    const p2 = await timelinePage(me.id, "comunidades", p1.next);
    expect(p2.posts).toHaveLength(5);
    expect(p2.next).toBeNull();
    expect(ids(p1.posts).concat(ids(p2.posts))).toEqual([...criados].sort((a, b) => b - a));
    expect(new Set([...ids(p1.posts), ...ids(p2.posts)]).size).toBe(25);
  });

  it("comunidade escondida, edição inativa e autor bloqueado ou silenciado somem de todas as abas", async () => {
    const me = await member();
    const bloqueado = await member();
    const silenciado = await member();
    const escondida = await community("tl-escondida", { hidden: 1, members: [me.id, bloqueado.id] });
    const minha = await community("tl-minha-abas", { members: [me.id, silenciado.id] });
    await edition("tl-inativa", { active: 0 });
    const agora = new Date();
    await edition("tl-viva-abas", {
      startsAt: new Date(agora.getTime() - 3600_000).toISOString(),
      endsAt: new Date(agora.getTime() + 3600_000).toISOString(),
    });
    await block(me.id, bloqueado.id);
    await mute(me.id, silenciado.id);
    const daEscondida = await post(bloqueado.id, "mural de comunidade escondida", { communityId: escondida.id });
    const daInativa = await post(bloqueado.id, "mural de edição inativa", { hackathonId: "tl-inativa" });
    const doBloqueado = await post(bloqueado.id, "post de quem eu bloqueei");
    const doSilenciado = await post(silenciado.id, "post de quem eu silenciei", { communityId: minha.id });
    const doSilenciadoVivo = await post(silenciado.id, "post silenciado na edição viva", { hackathonId: "tl-viva-abas" });

    for (const aba of TIMELINE_TABS) {
      const page = await timelinePage(me.id, aba);
      for (const fora of [daEscondida, daInativa, doBloqueado, doSilenciado, doSilenciadoVivo]) {
        expect(ids(page.posts), `${aba} mostrou ${fora}`).not.toContain(fora);
      }
    }
  });

  it("deslogado não vê a aba seguindo (mas vê o tudo)", async () => {
    const autor = await member();
    const p = await post(autor.id, "post público do tudo");
    expect((await timelinePage(null, "seguindo")).posts).toEqual([]);
    expect(ids((await timelinePage(null, "tudo")).posts)).toContain(p);
  });
});

describe("aba padrão e contagem de post novo", () => {
  it("segue alguém ou comunidade → seguindo; senão → tudo", async () => {
    const me = await member();
    const outro = await member();
    expect(await timelineDefaultTab(me.id)).toBe("tudo");
    expect(await timelineDefaultTab(null)).toBe("tudo");
    await follow(me.id, outro.id);
    expect(await timelineDefaultTab(me.id)).toBe("seguindo");

    const soComunidade = await member();
    const c = await community("tl-default-com", { members: [outro.id] });
    await db.prepare("INSERT INTO community_follows (communityId, memberId) VALUES (?, ?)").run(c.id, soComunidade.id);
    expect(await timelineDefaultTab(soComunidade.id)).toBe("seguindo");
  });

  it("countNewPosts conta só o que entrou depois do id do topo", async () => {
    const me = await member();
    const outro = await member();
    const c = await community("tl-novos", { members: [me.id, outro.id] });
    const primeiro = await post(outro.id, "post 1", { communityId: c.id });
    expect(await countNewPosts(me.id, "comunidades", primeiro)).toBe(0);
    await post(outro.id, "post 2", { communityId: c.id });
    await post(outro.id, "post 3", { communityId: c.id });
    expect(await countNewPosts(me.id, "comunidades", primeiro)).toBe(2);
    // id inválido não conta nada (e não quebra)
    expect(await countNewPosts(me.id, "comunidades", 0)).toBe(0);
  });
});

describe("GET /api/feed", () => {
  it("401 deslogado", async () => {
    const { GET } = await route();
    const res = await GET(get("?aba=tudo"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("400 pra aba e cursor desconhecidos", async () => {
    const { GET } = await route();
    const me = await member();
    as(me);
    expect((await GET(get("?aba=inventada"))).status).toBe(400);
    expect((await GET(get("?aba=tudo&antes=abc"))).status).toBe(400);
    expect((await GET(get("?aba=tudo&desde=-3"))).status).toBe(400);
  });

  it("sem aba usa a aba padrão e devolve {posts, next}; ?antes= traz a próxima página", async () => {
    const { GET } = await route();
    const me = await member();
    const outro = await member();
    await follow(me.id, outro.id);
    const doSeguido = await post(outro.id, "post de quem eu sigo");
    as(me);

    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: { id: number }[]; next: number | null };
    expect(ids(body.posts)).toContain(doSeguido);
    expect(body).toHaveProperty("next");

    const comAba = (await (await GET(get("?aba=tudo"))).json()) as { posts: { id: number }[]; next: number | null };
    expect(ids(comAba.posts)).toContain(doSeguido);
    const segunda = (await (await GET(get(`?aba=tudo&antes=${comAba.posts[0].id}`))).json()) as { posts: { id: number }[] };
    expect(ids(segunda.posts)).not.toContain(comAba.posts[0].id);
  });

  it("?desde= devolve {novos}", async () => {
    const { GET } = await route();
    const me = await member();
    const outro = await member();
    const c = await community("tl-api-novos", { members: [me.id, outro.id] });
    const base = await post(outro.id, "base", { communityId: c.id });
    await post(outro.id, "novo", { communityId: c.id });
    as(me);
    const res = await GET(get(`?aba=comunidades&desde=${base}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ novos: 1 });
  });

  it("balde feed: 600 por hora por membro", () => {
    const opts = RATE_LIMITS.feed;
    expect(opts).toBeTruthy();
    expect(opts.limit).toBe(600);
    for (let i = 0; i < opts.limit; i++) expect(rateLimit("feed:1", opts).ok).toBe(true);
    const estourou = rateLimit("feed:1", opts);
    expect(estourou.ok).toBe(false);
    expect(estourou.retryAfterSec).toBeGreaterThan(0);
    // outro membro não é afetado
    expect(rateLimit("feed:2", opts).ok).toBe(true);
  });

  it("helpers: isTimelineTab, parseCursor", () => {
    expect(isTimelineTab("seguindo")).toBe(true);
    expect(isTimelineTab("ao-vivo")).toBe(true);
    expect(isTimelineTab("orkut")).toBe(false);
    expect(parseCursor("12")).toBe(12);
    expect(parseCursor(12)).toBe(12);
    expect(parseCursor("0")).toBeNull();
    expect(parseCursor("-1")).toBeNull();
    expect(parseCursor("1.5")).toBeNull();
    expect(parseCursor(null)).toBeNull();
    expect(parseCursor("x")).toBeNull();
  });
});

describe("sugestões do estado vazio", () => {
  it("suggestPeople: time primeiro, depois comunidade, depois skill; sem eu, sem quem sigo", async () => {
    const me = await member({ skills: ["react"], persona: "dev" });
    const doTime = await member();
    const daComunidade = await member();
    const daSkill = await member({ skills: ["react", "sql"] });
    const daPersona = await member({ persona: "dev" });
    const semNada = await member();
    const jaSigo = await member();

    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name) VALUES ('hack-inova-alphaville-2026', ?) RETURNING id")
      .get<{ id: number }>(`Time tl ${seq++}`);
    for (const u of [me.username, doTime.username]) {
      await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, u);
    }
    const c = await community("tl-sug-com", { members: [me.id, daComunidade.id] });
    await follow(me.id, jaSigo.id);

    const out = await suggestPeople(me.id, 6);
    const usernames = out.map((p) => p.username);
    expect(usernames[0]).toBe(doTime.username);
    expect(out[0].reason).toBe("time");
    expect(out[0].shared).toBeTruthy();
    expect(usernames).toContain(daComunidade.username);
    expect(out.find((p) => p.username === daComunidade.username)!.reason).toBe("comunidade");
    expect(usernames).toContain(daSkill.username);
    expect(out.find((p) => p.username === daSkill.username)!.reason).toBe("skill");
    expect(usernames).toContain(daPersona.username);
    expect(out.find((p) => p.username === daPersona.username)!.reason).toBe("persona");
    expect(usernames).not.toContain(me.username);
    expect(usernames).not.toContain(jaSigo.username);
    expect(usernames).not.toContain(semNada.username);
    expect(c.id).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(6);
    // cada pessoa aparece uma vez só
    expect(new Set(usernames).size).toBe(usernames.length);
  });

  it("suggestPeople não ordena por popularidade e some com bloqueado, silenciado e conta excluída", async () => {
    const me = await member({ skills: ["go"] });
    // o de XP alto nasce antes (id menor): se a ordem fosse por XP, ele viria
    // na frente do outro candidato de skill
    const xpAlto = await member({ xp: 999_999, skills: ["go"] });
    const semXp = await member({ skills: ["go"] });
    const bloqueado = await member({ skills: ["go"] });
    const silenciado = await member({ skills: ["go"] });
    const excluido = await member({ skills: ["go"] });
    await block(me.id, bloqueado.id);
    await mute(me.id, silenciado.id);
    await deleteMemberData(excluido.id);

    const out = await suggestPeople(me.id, 6);
    const usernames = out.map((p) => p.username);
    expect(usernames).not.toContain(bloqueado.username);
    expect(usernames).not.toContain(silenciado.username);
    expect(usernames).not.toContain(excluido.username);
    expect(usernames).toContain(xpAlto.username);
    expect(usernames.indexOf(semXp.username)).toBeLessThan(usernames.indexOf(xpAlto.username));
  });

  it("suggestPeople respeita o limite e não devolve mais que o pedido", async () => {
    const me = await member({ persona: "design" });
    for (let i = 0; i < 9; i++) await member({ persona: "design" });
    expect(await suggestPeople(me.id, 3)).toHaveLength(3);
    expect(await suggestPeople(me.id, 6)).toHaveLength(6);
  });

  it("suggestCommunities: cidade do perfil primeiro, sem as que eu já acompanho", async () => {
    const me = await member({ city: "Recife, PE" });
    const outro = await member();
    const perto = await community("tl-sug-perto", { members: [outro.id], city: "Recife, PE" });
    const longe = await community("tl-sug-longe", { members: [outro.id], city: "Manaus, AM" });
    const minha = await community("tl-sug-minha", { members: [me.id] });
    const seguida = await community("tl-sug-seguida", { members: [outro.id] });
    await db.prepare("INSERT INTO community_follows (communityId, memberId) VALUES (?, ?)").run(seguida.id, me.id);

    const out = await suggestCommunities(me.id, 4);
    const slugs = out.map((c) => c.slug);
    // a da cidade vem primeiro; as que eu já acompanho nunca
    expect(slugs[0]).toBe(perto.slug);
    expect(slugs).not.toContain(minha.slug);
    expect(slugs).not.toContain(seguida.slug);
    // cidade antes de estado: se a de longe entrar, é atrás da da cidade
    if (slugs.includes(longe.slug)) expect(slugs.indexOf(perto.slug)).toBeLessThan(slugs.indexOf(longe.slug));
    // sem nada perto do perfil, ainda sugere (as de atividade mais recente)
    expect(out).toHaveLength(4);
    const semCidade = await member();
    expect(await suggestCommunities(semCidade.id, 4)).toHaveLength(4);
  });
});
