import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { joinCommunity, leaveCommunity, listMyCommunities, communityNextStep } from "@/lib/communities";
import { announceEditionLaunch } from "@/lib/editionLaunch";
import {
  FEED_PAGE_SIZE,
  communityAudience,
  communityUpdatesPage,
  followCommunity,
  followStates,
  followsAnyCommunity,
  isFollowing,
  listCommunityUpdates,
  updateHref,
} from "@/lib/follows";
import { deleteMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";

// Seguir comunidade (migration 030): membro = segue; o seguir leve é de quem
// não quer ser membro. Rota (401/404/409/429), feed "minhas comunidades"
// (mural + avisos + hackathons publicados, por data, paginado, sem
// escondida), painel, anúncio de hackathon pra quem segue e LGPD.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(): Promise<M> {
  const tag = `fw${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
async function community(slug: string, opts: { hidden?: number; members?: number[] } = {}) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name, city, hidden) VALUES (?, ?, 'Recife, PE', ?) RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`, opts.hidden ?? 0);
  for (const m of opts.members ?? []) {
    await db.prepare("INSERT INTO community_members (communityId, memberId) VALUES (?, ?)").run(c!.id, m);
  }
  return { id: c!.id, slug, name: `Comunidade ${slug}` };
}
async function post(by: number, communityId: number, body: string, at: string) {
  await db
    .prepare("INSERT INTO posts (memberId, body, communityId, createdAt) VALUES (?, ?, ?, ?)")
    .run(by, body, communityId, at);
}
async function notice(by: number, communityId: number, title: string, at: string) {
  await db
    .prepare("INSERT INTO community_notices (communityId, title, body, createdBy, createdAt) VALUES (?, ?, 'corpo', ?, ?)")
    .run(communityId, title, by, at);
}
async function edition(id: string, communityId: number, active: number, publishedAt: string | null) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source, communityId, publishedAt, location)
       VALUES (?, ?, 'Org', '2027-03-05T09:00:00-03:00', 'presencial', '', '[]', ?, 'painel', ?, ?, 'Recife, PE')`,
    )
    .run(id, `Edição ${id}`, active, communityId, publishedAt);
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string) => new Request("http://t", { method });
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const route = () => import("@/app/api/communities/[slug]/follow/route");

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("rota /api/communities/[slug]/follow", () => {
  it("401 deslogado; 404 comunidade escondida ou inexistente", async () => {
    const { POST, DELETE } = await route();
    await community("fw-rota-a");
    expect((await POST(req("POST"), ctx("fw-rota-a"))).status).toBe(401);
    expect((await DELETE(req("DELETE"), ctx("fw-rota-a"))).status).toBe(401);
    const m = await member();
    await community("fw-rota-esc", { hidden: 1 });
    as(m);
    expect((await POST(req("POST"), ctx("fw-rota-esc"))).status).toBe(404);
    expect((await POST(req("POST"), ctx("nao-existe"))).status).toBe(404);
  });

  it("segue (201), de novo é idempotente (200), deixa de seguir; membro não segue de novo (409)", async () => {
    const { POST, DELETE } = await route();
    const m = await member();
    const outro = await member();
    const c = await community("fw-rota-b", { members: [outro.id] });
    as(m);
    const r1 = await POST(req("POST"), ctx(c.slug));
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ following: true, new: true });
    expect((await POST(req("POST"), ctx(c.slug))).status).toBe(200);
    expect(await isFollowing(c.id, m.id)).toBe(true);
    // segue sem virar membro: não conta, não posta
    const role = await db.prepare("SELECT role FROM community_members WHERE communityId = ? AND memberId = ?").get(c.id, m.id);
    expect(role).toBeUndefined();

    const d = await DELETE(req("DELETE"), ctx(c.slug));
    expect(await d.json()).toEqual({ following: false, removed: true });
    expect(await isFollowing(c.id, m.id)).toBe(false);
    expect(await (await DELETE(req("DELETE"), ctx(c.slug))).json()).toEqual({ following: false, removed: false });

    as(outro);
    const r409 = await POST(req("POST"), ctx(c.slug));
    expect(r409.status).toBe(409);
    expect((await r409.json()).error).toMatch(/membro já segue/);
    expect(await isFollowing(c.id, outro.id)).toBe(false);
  });

  it("rate limit por membro: 30 por hora, depois 429 com Retry-After", async () => {
    const { POST } = await route();
    const m = await member();
    await community("fw-rota-rl");
    as(m);
    for (let i = 0; i < 30; i++) expect((await POST(req("POST"), ctx("fw-rota-rl"))).status).toBeLessThan(300);
    const r = await POST(req("POST"), ctx("fw-rota-rl"));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("seguir e ser membro", () => {
  it("entrar na comunidade apaga o seguir leve (membro já segue)", async () => {
    const m = await member();
    const c = await community("fw-join");
    expect(await followCommunity(c.id, m.id)).toBe("followed");
    expect(await followCommunity(c.id, m.id)).toBe("already");
    await joinCommunity(c, m);
    expect(await isFollowing(c.id, m.id)).toBe(false);
    expect(await followCommunity(c.id, m.id)).toBe("member");
    const st = await followStates(m.id);
    expect([...st.member]).toEqual([c.id]);
    expect([...st.following]).toEqual([]);
  });

  it("sair da comunidade não deixa um seguir que a pessoa não escolheu", async () => {
    const m = await member();
    const dono = await member();
    const c = await community("fw-leave", { members: [dono.id] });
    await db.prepare("UPDATE community_members SET role = 'dono' WHERE communityId = ?").run(c.id);
    await joinCommunity(c, m);
    // o follow que commitou depois do DELETE do joinCommunity (cliques em paralelo)
    await db.prepare("INSERT INTO community_follows (communityId, memberId) VALUES (?, ?)").run(c.id, m.id);
    expect(await leaveCommunity(c.id, m.id)).toBe(true);
    expect(await isFollowing(c.id, m.id)).toBe(false);
    expect(await communityAudience(c.id)).toEqual([dono.id]);
    expect((await listMyCommunities(m.id)).map((x) => x.slug)).not.toContain(c.slug);
    // e depois de sair pode seguir de propósito
    expect(await followCommunity(c.id, m.id)).toBe("followed");
  });

  it("membro não ganha linha de seguir: a checagem vai no próprio insert", async () => {
    const m = await member();
    const c = await community("fw-member-follow", { members: [m.id] });
    expect(await followCommunity(c.id, m.id)).toBe("member");
    expect(await isFollowing(c.id, m.id)).toBe(false);
  });

  it("painel lista as seguidas como 'segue', depois das que a pessoa é membro", async () => {
    const m = await member();
    const a = await community("fw-painel-a", { members: [m.id] });
    const b = await community("fw-painel-b");
    const esc = await community("fw-painel-esc", { hidden: 1 });
    await followCommunity(b.id, m.id);
    await followCommunity(esc.id, m.id);
    const mine = await listMyCommunities(m.id);
    expect(mine.map((c) => [c.slug, c.role])).toEqual([
      [a.slug, "membro"],
      [b.slug, "segue"],
    ]);
    // quem segue tem o mesmo próximo passo de membro: ver o mural
    expect(communityNextStep(mine[1])).toMatchObject({ href: `/comunidade/${b.slug}#mural` });
  });

  it("followsAnyCommunity decide a aba padrão: membro conta, seguir conta, escondida não", async () => {
    const m = await member();
    expect(await followsAnyCommunity(m.id)).toBe(false);
    const esc = await community("fw-any-esc", { hidden: 1 });
    await followCommunity(esc.id, m.id);
    expect(await followsAnyCommunity(m.id)).toBe(false);
    const c = await community("fw-any");
    await followCommunity(c.id, m.id);
    expect(await followsAnyCommunity(m.id)).toBe(true);
    const n = await member();
    await community("fw-any-mem", { members: [n.id] });
    expect(await followsAnyCommunity(n.id)).toBe(true);
  });
});

describe("feed minhas comunidades", () => {
  it("junta mural, aviso e hackathon publicado das seguidas e das que é membro, do mais novo pro mais velho", async () => {
    const eu = await member();
    const autor = await member();
    const seguida = await community("fw-feed-seg", { members: [autor.id] });
    const minha = await community("fw-feed-min", { members: [eu.id, autor.id] });
    const alheia = await community("fw-feed-alheia", { members: [autor.id] });
    const escondida = await community("fw-feed-esc", { hidden: 1, members: [autor.id] });
    await followCommunity(seguida.id, eu.id);
    await followCommunity(escondida.id, eu.id);

    await post(autor.id, seguida.id, "post da seguida", "2026-10-01 10:00:00");
    await notice(autor.id, minha.id, "aviso da minha", "2026-10-03 10:00:00");
    await edition("fw-feed-h1", seguida.id, 1, "2026-10-02 10:00:00");
    await edition("fw-feed-rascunho", seguida.id, 0, null);
    await post(autor.id, alheia.id, "post de outra", "2026-10-04 10:00:00");
    await post(autor.id, escondida.id, "post escondido", "2026-10-05 10:00:00");
    // post global e de edição não entram
    await db.prepare("INSERT INTO posts (memberId, body, createdAt) VALUES (?, 'global', '2026-10-06 10:00:00')").run(autor.id);

    const items = await listCommunityUpdates(eu.id);
    expect(items.map((i) => [i.kind, i.title ?? i.body, i.communitySlug])).toEqual([
      ["aviso", "aviso da minha", minha.slug],
      ["hackathon", "Edição fw-feed-h1", seguida.slug],
      ["post", "post da seguida", seguida.slug],
    ]);
    expect(items[0]).toMatchObject({ username: autor.username, communityName: minha.name });
    expect(items[1]).toMatchObject({ location: "Recife, PE", startsAt: "2027-03-05T09:00:00-03:00" });
    expect(items.map(updateHref)).toEqual([`/comunidade/${minha.slug}#avisos`, "/h/fw-feed-h1", `/comunidade/${seguida.slug}#mural`]);

    // deixar de seguir tira a comunidade do feed
    await db.prepare("DELETE FROM community_follows WHERE memberId = ?").run(eu.id);
    expect((await listCommunityUpdates(eu.id)).map((i) => i.communitySlug)).toEqual([minha.slug]);

    // quem não segue nada tem feed vazio
    expect(await listCommunityUpdates((await member()).id)).toEqual([]);
  });

  it("pagina de 20 em 20 sem repetir e sabe quando acabou", async () => {
    const eu = await member();
    const c = await community("fw-pag", { members: [eu.id] });
    const total = FEED_PAGE_SIZE + 5;
    for (let i = 0; i < total; i++) {
      await post(eu.id, c.id, `post ${i}`, `2026-09-${String(1 + (i % 28)).padStart(2, "0")} ${String(10 + Math.floor(i / 28)).padStart(2, "0")}:00:00`);
    }
    const p1 = await communityUpdatesPage(eu.id, 1);
    const p2 = await communityUpdatesPage(eu.id, 2);
    expect(p1.items).toHaveLength(FEED_PAGE_SIZE);
    expect(p1.hasMore).toBe(true);
    expect(p2.items).toHaveLength(5);
    expect(p2.hasMore).toBe(false);
    const ids = [...p1.items, ...p2.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(total);
    // página inválida vira a primeira
    expect((await communityUpdatesPage(eu.id, Number("abc"))).page).toBe(1);
    expect((await communityUpdatesPage(eu.id, -3)).page).toBe(1);
  });
});

describe("anúncio de hackathon publicado", () => {
  it("vai pra membro e pra quem segue, uma vez, sem conta excluída", async () => {
    const membro = await member();
    const seguidor = await member();
    const excluido = await member();
    const ninguem = await member();
    const c = await community("fw-launch", { members: [membro.id] });
    await followCommunity(c.id, seguidor.id);
    await followCommunity(c.id, excluido.id);
    await db.prepare("UPDATE members SET clerkId = 'deleted:x' WHERE id = ?").run(excluido.id);
    expect(await communityAudience(c.id)).toEqual([membro.id, seguidor.id]);

    await edition("fw-launch-1", c.id, 1, null);
    const r = await announceEditionLaunch("fw-launch-1");
    expect(r).toMatchObject({ notified: 2 });
    const notes = await db
      .prepare("SELECT memberId FROM notifications WHERE type = 'edicao_nova' AND href = '/h/fw-launch-1' ORDER BY memberId")
      .all<{ memberId: number }>();
    expect(notes.map((n) => n.memberId)).toEqual([membro.id, seguidor.id]);
    expect(notes.map((n) => n.memberId)).not.toContain(ninguem.id);
    const ann = await db.prepare("SELECT body FROM announcements WHERE hackathonId = 'fw-launch-1'").all<{ body: string }>();
    expect(ann).toHaveLength(1);
    expect(ann[0].body).toContain("porque segue essa comunidade");
    // idempotente por launchAnnouncedAt
    expect(await announceEditionLaunch("fw-launch-1")).toBeNull();
  });
});

describe("LGPD", () => {
  it("excluir a conta apaga o que a pessoa seguia", async () => {
    const m = await member();
    const c = await community("fw-lgpd");
    await followCommunity(c.id, m.id);
    await deleteMemberData(m.id);
    expect(await isFollowing(c.id, m.id)).toBe(false);
  });
});
