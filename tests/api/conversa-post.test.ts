import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { block } from "@/lib/blocks";
import { createComment, listComments } from "@/lib/comments";
import { canModeratePost, createPost, getPost, hydratePosts, listPostIds, listPosts } from "@/lib/posts";
import { deleteMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";
import { grantEditionRole } from "@/lib/roles";

// Conversa no post (spec 046, migration 034): reações, respostas em 1 nível,
// edição, denúncia pela fila única, card de link interno, moderação no lugar
// certo e notificação que leva ao post. Um bloco por item do aceite.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string; role: string };
async function member(role = "member"): Promise<M> {
  const tag = `cp${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, role) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, role);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}`, role };
}
async function community(slug: string, hidden = 0) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name, city, hidden) VALUES (?, ?, 'Recife, PE', ?) RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`, hidden);
  return c!.id;
}
async function role(communityId: number, memberId: number, r: "dono" | "organizador" | "membro") {
  await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, ?)").run(communityId, memberId, r);
}
async function edition(id: string, active = 1) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source, location)
       VALUES (?, ?, 'Org', '2026-03-05T09:00:00-03:00', 'presencial', '', '[]', ?, 'painel', 'Recife, PE')`,
    )
    .run(id, `Edição ${id}`, active);
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
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const cctx = (id: number, commentId: number | string) => ({ params: Promise.resolve({ id: String(id), commentId: String(commentId) }) });

async function routes() {
  const [one, like, comments, comment, posts, reports] = await Promise.all([
    import("@/app/api/posts/[id]/route"),
    import("@/app/api/posts/[id]/like/route"),
    import("@/app/api/posts/[id]/comments/route"),
    import("@/app/api/posts/[id]/comments/[commentId]/route"),
    import("@/app/api/posts/route"),
    import("@/app/api/reports/route"),
  ]);
  return { one, like, comments, comment, posts, reports };
}
const notes = (memberId: number) =>
  db
    .prepare("SELECT type, text, href, actorId FROM notifications WHERE memberId = ? ORDER BY id")
    .all<{ type: string; text: string; href: string; actorId: number }>(memberId);
const xpOf = async (id: number) => (await db.prepare("SELECT xp FROM members WHERE id = ?").get<{ xp: number }>(id))!.xp;

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("migration 034", () => {
  it("DELETE FROM posts leva reações, comentários e respostas (cascade); rodar de novo não quebra", async () => {
    const sql = readFileSync(join(process.cwd(), "migrations/034_conversa_post.sql"), "utf8");
    await db.exec(sql);
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "post que vai sumir");
    await db.prepare("INSERT INTO likes (postId, memberId, kind) VALUES (?, ?, 'ajudou')").run(p.id, b.id);
    const top = await createComment(p.id, b.id, "topo");
    await createComment(p.id, a.id, "resposta", top.id);
    await db.prepare("DELETE FROM posts WHERE id = ?").run(p.id);
    const left = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM likes WHERE postId = ?) AS l, (SELECT COUNT(*) FROM post_comments WHERE postId = ?) AS c`,
      )
      .get<{ l: number; c: number }>(p.id, p.id);
    expect(left).toEqual({ l: 0, c: 0 });
  });

  it("kind só aceita os 4 tipos e o like antigo vira 'curti'", async () => {
    const [a, b, c] = [await member(), await member(), await member()];
    const p = await createPost(a.id, "tipos");
    await db.prepare("INSERT INTO likes (postId, memberId) VALUES (?, ?)").run(p.id, b.id);
    expect((await db.prepare("SELECT kind FROM likes WHERE postId = ?").get<{ kind: string }>(p.id))!.kind).toBe("curti");
    await expect(db.prepare("INSERT INTO likes (postId, memberId, kind) VALUES (?, ?, 'amei')").run(p.id, c.id)).rejects.toThrow();
  });
});

describe("reações (aceite 2 e 3)", () => {
  it("reagir, tirar e reagir de novo: 1 notificação com link do post e 0 XP", async () => {
    const { like } = await routes();
    const [autor, leitor] = [await member(), await member()];
    const p = await createPost(autor.id, "olha a demo");
    const xp0 = [await xpOf(autor.id), await xpOf(leitor.id)];
    as(leitor);
    let res = await like.POST(json("POST", { kind: "ajudou" }), ctx(p.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("ajudou");
    expect(body.reactions).toEqual({ curti: 0, ajudou: 1, quero_testar: 0, aprendi: 0 });
    res = await like.POST(json("POST", { kind: null }), ctx(p.id));
    expect((await res.json()).kind).toBeNull();
    res = await like.POST(json("POST", { kind: "aprendi" }), ctx(p.id));
    expect((await res.json()).likeCount).toBe(1);
    const n = await notes(autor.id);
    expect(n).toEqual([
      { type: "reaction", text: `@${leitor.username} reagiu ao seu post: ajudou`, href: `/post/${p.id}`, actorId: leitor.id },
    ]);
    expect([await xpOf(autor.id), await xpOf(leitor.id)]).toEqual(xp0);
  });

  it("sem corpo é 'curti'; trocar o tipo substitui (uma por pessoa)", async () => {
    const { like } = await routes();
    const [autor, leitor] = [await member(), await member()];
    const p = await createPost(autor.id, "x");
    as(leitor);
    expect((await (await like.POST(new Request("http://t", { method: "POST" }), ctx(p.id))).json()).kind).toBe("curti");
    await like.POST(json("POST", { kind: "quero_testar" }), ctx(p.id));
    const [post] = await hydratePosts([p.id], leitor.id);
    expect(post.reactions).toEqual({ curti: 0, ajudou: 0, quero_testar: 1, aprendi: 0 });
    expect(post.myReaction).toBe("quero_testar");
    expect(post.likedByMe).toBe(true);
    expect(post.likeCount).toBe(1);
  });

  it("próprio post dá 400; tipo inválido dá 400; deslogado 401; post inexistente 404", async () => {
    const { like } = await routes();
    const [autor, leitor] = [await member(), await member()];
    const p = await createPost(autor.id, "meu");
    expect((await like.POST(json("POST", {}), ctx(p.id))).status).toBe(401);
    as(autor);
    const own = await like.POST(json("POST", { kind: "curti" }), ctx(p.id));
    expect(own.status).toBe(400);
    expect((await own.json()).error).toBe("Você não pode reagir ao próprio post");
    as(leitor);
    expect((await like.POST(json("POST", { kind: "amei" }), ctx(p.id))).status).toBe(400);
    expect((await like.POST(json("POST", {}), ctx(999999))).status).toBe(404);
    expect((await like.POST(json("POST", {}), ctx("abc"))).status).toBe(404);
  });

  it("reagir ou comentar em post de quem te bloqueou dá 404", async () => {
    const { like, comments } = await routes();
    const [autor, leitor] = [await member(), await member()];
    const p = await createPost(autor.id, "fechado");
    await block(autor.id, leitor.id);
    as(leitor);
    expect((await like.POST(json("POST", {}), ctx(p.id))).status).toBe(404);
    expect((await comments.POST(json("POST", { body: "oi" }), ctx(p.id))).status).toBe(404);
    expect((await comments.GET(json("GET"), ctx(p.id))).status).toBe(404);
    expect(await getPost(p.id, leitor.id)).toBeNull();
  });

  it("rate limit da reação: 61ª em 1h é 429", async () => {
    const { like } = await routes();
    const [autor, leitor] = [await member(), await member()];
    const p = await createPost(autor.id, "spam");
    as(leitor);
    for (let i = 0; i < 60; i++) await like.POST(json("POST", { kind: i % 2 ? null : "curti" }), ctx(p.id));
    expect((await like.POST(json("POST", {}), ctx(p.id))).status).toBe(429);
  });
});

describe("comentários e respostas (aceite 1 e 3)", () => {
  it("comentário notifica o autor com âncora; resposta notifica quem foi respondido; 0 XP", async () => {
    const { comments } = await routes();
    const [autor, ana, bia] = [await member(), await member(), await member()];
    const p = await createPost(autor.id, "conversa");
    const xp0 = await xpOf(ana.id);
    as(ana);
    const r1 = await comments.POST(json("POST", { body: "como fez o deploy?" }), ctx(p.id));
    expect(r1.status).toBe(201);
    const top = (await r1.json()).comment;
    expect(top.parentId).toBeNull();
    expect(top.replies).toEqual([]);
    expect(await xpOf(ana.id)).toBe(xp0);
    expect(await notes(autor.id)).toEqual([
      { type: "comment", text: `@${ana.username} comentou no seu post`, href: `/post/${p.id}#c-${top.id}`, actorId: ana.id },
    ]);
    as(bia);
    const r2 = await comments.POST(json("POST", { body: "foi na VPS", parentId: top.id }), ctx(p.id));
    expect(r2.status).toBe(201);
    const reply = (await r2.json()).comment;
    expect(reply.parentId).toBe(top.id);
    expect((await notes(ana.id))[0]).toEqual({
      type: "reply",
      text: `@${bia.username} respondeu seu comentário`,
      href: `/post/${p.id}#c-${reply.id}`,
      actorId: bia.id,
    });
    expect((await notes(autor.id)).map((n) => n.href)).toEqual([`/post/${p.id}#c-${top.id}`, `/post/${p.id}#c-${reply.id}`]);
  });

  it("resposta a resposta, a comentário de outro post ou inexistente dá 400", async () => {
    const { comments } = await routes();
    const [autor, ana] = [await member(), await member()];
    const p = await createPost(autor.id, "um");
    const q = await createPost(autor.id, "dois");
    const top = await createComment(p.id, autor.id, "topo");
    const reply = await createComment(p.id, autor.id, "resp", top.id);
    const other = await createComment(q.id, autor.id, "outro post");
    as(ana);
    for (const parentId of [reply.id, other.id, 999999, "x"]) {
      const res = await comments.POST(json("POST", { body: "oi", parentId }), ctx(p.id));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Resposta inválida");
    }
  });

  it("listComments: topo com replies[] em ordem; sem autor bloqueado ou silenciado", async () => {
    const [autor, ana, chato] = [await member(), await member(), await member()];
    const p = await createPost(autor.id, "lista");
    const t1 = await createComment(p.id, ana.id, "primeiro");
    const t2 = await createComment(p.id, chato.id, "do chato");
    await createComment(p.id, autor.id, "resposta 1", t1.id);
    await createComment(p.id, chato.id, "resposta do chato", t1.id);
    await createComment(p.id, ana.id, "resposta ao chato", t2.id);
    const all = await listComments(p.id);
    expect(all.map((c) => [c.body, c.replies!.map((r) => r.body)])).toEqual([
      ["primeiro", ["resposta 1", "resposta do chato"]],
      ["do chato", ["resposta ao chato"]],
    ]);
    await db.prepare("INSERT INTO member_mutes (memberId, mutedId) VALUES (?, ?)").run(autor.id, chato.id);
    const mine = await listComments(p.id, autor.id);
    expect(mine.map((c) => [c.body, c.replies!.map((r) => r.body)])).toEqual([["primeiro", ["resposta 1"]]]);
    // contagem do card segue o mesmo filtro
    expect((await hydratePosts([p.id], autor.id))[0].commentCount).toBe(2);
    expect((await hydratePosts([p.id], null))[0].commentCount).toBe(5);
  });

  it("PATCH do comentário só pro autor e marca editedAt; DELETE autor ou quem modera o post", async () => {
    const { comment } = await routes();
    const [autor, ana, bia] = [await member(), await member(), await member()];
    const p = await createPost(autor.id, "x");
    const c = await createComment(p.id, ana.id, "erro de digitaçao");
    const r = await createComment(p.id, bia.id, "resposta", c.id);
    as(bia);
    expect((await comment.PATCH(json("PATCH", { body: "mudei" }), cctx(p.id, c.id))).status).toBe(403);
    expect((await comment.DELETE(json("DELETE"), cctx(p.id, c.id))).status).toBe(403);
    as(ana);
    const ok = await comment.PATCH(json("PATCH", { body: "erro de digitação" }), cctx(p.id, c.id));
    expect(ok.status).toBe(200);
    const edited = (await ok.json()).comment;
    expect(edited.body).toBe("erro de digitação");
    expect(edited.editedAt).toBeTruthy();
    expect((await comment.PATCH(json("PATCH", { body: "  " }), cctx(p.id, c.id))).status).toBe(400);
    // comentário de outro post na URL é 404
    const q = await createPost(autor.id, "outro");
    expect((await comment.PATCH(json("PATCH", { body: "x" }), cctx(q.id, c.id))).status).toBe(404);
    // autor do post modera os comentários do próprio post; resposta sai junto
    as(autor);
    expect((await comment.DELETE(json("DELETE"), cctx(p.id, c.id))).status).toBe(200);
    expect(await db.prepare("SELECT 1 FROM post_comments WHERE id IN (?, ?)").get(c.id, r.id)).toBeUndefined();
  });
});

describe("edição do post (aceite 4)", () => {
  it("PATCH só pro autor, com as validações do createPost; editedAt aparece", async () => {
    const { one } = await routes();
    const [autor, outro] = [await member(), await member()];
    const p = await createPost(autor.id, "versão 1");
    expect(p.editedAt).toBeNull();
    as(outro);
    expect((await one.PATCH(json("PATCH", { body: "invadi" }), ctx(p.id))).status).toBe(403);
    as(autor);
    expect((await one.PATCH(json("PATCH", { body: "" }), ctx(p.id))).status).toBe(400);
    const bad = await one.PATCH(json("PATCH", { body: "ok", link: "javascript:alert(1)" }), ctx(p.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Link inválido");
    const res = await one.PATCH(json("PATCH", { body: "versão 2", link: "https://demo.dev" }), ctx(p.id));
    expect(res.status).toBe(200);
    const post = (await res.json()).post;
    expect(post.body).toBe("versão 2");
    expect(post.link).toBe("https://demo.dev");
    expect(post.editedAt).toBeTruthy();
    expect((await one.PATCH(json("PATCH", { body: "x" }), ctx(999999))).status).toBe(404);
  });

  it("GET /api/posts/[id] devolve o post hidratado; 401 deslogado", async () => {
    const { one } = await routes();
    const a = await member();
    const p = await createPost(a.id, "lido");
    expect((await one.GET(json("GET"), ctx(p.id))).status).toBe(401);
    as(a);
    const res = await one.GET(json("GET"), ctx(p.id));
    expect((await res.json()).post).toMatchObject({ id: p.id, body: "lido", canModerate: true, myReaction: null });
  });

  it("POST /api/posts não dá XP e devolve o post com reactions e canModerate", async () => {
    const { posts } = await routes();
    const a = await member();
    const xp0 = await xpOf(a.id);
    as(a);
    const res = await posts.POST(json("POST", { body: "novo post" }));
    expect(res.status).toBe(201);
    const { post } = await res.json();
    expect(post).toMatchObject({ body: "novo post", reactions: { curti: 0, ajudou: 0, quero_testar: 0, aprendi: 0 }, canModerate: true });
    expect(await xpOf(a.id)).toBe(xp0);
  });
});

describe("quem apaga (aceite 5 e 6)", () => {
  it("organizador da comunidade apaga post do mural dela (200) e não de outra (403)", async () => {
    const { one } = await routes();
    const [org, autor] = [await member(), await member()];
    const c1 = await community("cp-mural-a");
    const c2 = await community("cp-mural-b");
    await role(c1, org.id, "organizador");
    await role(c1, autor.id, "membro");
    await role(c2, autor.id, "membro");
    const p1 = await createPost(autor.id, "no mural A", null, null, c1);
    const p2 = await createPost(autor.id, "no mural B", null, null, c2);
    as(org);
    expect((await hydratePosts([p1.id], org.id))[0].canModerate).toBe(true);
    expect((await hydratePosts([p2.id], org.id))[0].canModerate).toBe(false);
    expect((await one.DELETE(json("DELETE"), ctx(p2.id))).status).toBe(403);
    expect((await one.DELETE(json("DELETE"), ctx(p1.id))).status).toBe(200);
    expect(await db.prepare("SELECT 1 FROM posts WHERE id = ?").get(p1.id)).toBeUndefined();
  });

  it("organizador e staff da edição apagam no mural dela; mentor não; admin apaga qualquer um", async () => {
    const [staff, mentor, admin, autor] = [await member(), await member(), await member("admin"), await member()];
    await edition("cp-ed-mural");
    await grantEditionRole("cp-ed-mural", staff.id, "staff", null);
    await grantEditionRole("cp-ed-mural", mentor.id, "mentor", null);
    const p = await createPost(autor.id, "mural da edição", null, "cp-ed-mural");
    const space = { memberId: autor.id, communityId: null, hackathonId: "cp-ed-mural" };
    expect(await canModeratePost(staff, space)).toBe(true);
    expect(await canModeratePost(mentor, space)).toBe(false);
    expect(await canModeratePost(admin, { ...space, hackathonId: null })).toBe(true);
    expect(await canModeratePost(null, space)).toBe(false);
    const [asStaff] = await hydratePosts([p.id], staff.id);
    const [asMentor] = await hydratePosts([p.id], mentor.id);
    expect([asStaff.canModerate, asMentor.canModerate]).toEqual([true, false]);
  });

  it("apagar post com reação e comentário funciona (cascade)", async () => {
    const { one } = await routes();
    const [autor, ana] = [await member(), await member()];
    const p = await createPost(autor.id, "com conversa");
    await db.prepare("INSERT INTO likes (postId, memberId, kind) VALUES (?, ?, 'aprendi')").run(p.id, ana.id);
    const c = await createComment(p.id, ana.id, "boa");
    await createComment(p.id, autor.id, "valeu", c.id);
    as(ana);
    expect((await one.DELETE(json("DELETE"), ctx(p.id))).status).toBe(403);
    as(autor);
    expect((await one.DELETE(json("DELETE"), ctx(p.id))).status).toBe(200);
    expect(await db.prepare("SELECT 1 FROM post_comments WHERE postId = ?").get(p.id)).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM likes WHERE postId = ?").get(p.id)).toBeUndefined();
    expect((await one.DELETE(json("DELETE"), ctx(p.id))).status).toBe(404);
  });

  it("excluir a conta apaga os posts com reações e comentários de outros (cascade, sem DELETE manual)", async () => {
    const [autor, ana] = [await member(), await member()];
    const p = await createPost(autor.id, "vai com a conta");
    await db.prepare("INSERT INTO likes (postId, memberId) VALUES (?, ?)").run(p.id, ana.id);
    await createComment(p.id, ana.id, "comentário de outra pessoa");
    await deleteMemberData(autor.id);
    expect(await db.prepare("SELECT 1 FROM posts WHERE id = ?").get(p.id)).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM post_comments WHERE postId = ?").get(p.id)).toBeUndefined();
  });
});

describe("card de link interno (aceite 7)", () => {
  it("link pra projeto visível vira card; de projeto invisível, não; externo fica link", async () => {
    const autor = await member();
    await edition("cp-ed-proj");
    const visivel = (await createTeam("cp-ed-proj", { name: "Time Radar", placement: 0, project: { title: "Radar do SUS" } })).team.id;
    const semProjeto = (await createTeam("cp-ed-proj", { name: "Time Sem Nada", placement: 0 })).team.id;
    const a = await createPost(autor.id, "olha", `/p/${visivel}`);
    const b = await createPost(autor.id, "olha", `/p/${semProjeto}`);
    const c = await createPost(autor.id, "olha", "https://github.com/x/y");
    const [pa, pb, pc] = await hydratePosts([a.id, b.id, c.id], autor.id);
    expect(pa.linkCard).toEqual({ kind: "projeto", title: "Radar do SUS", subtitle: "Time Radar · Edição cp-ed-proj", href: `/p/${visivel}` });
    expect(pb.linkCard).toBeNull();
    expect(pc.linkCard).toBeNull();
    expect(pc.link).toBe("https://github.com/x/y");
  });

  it("comunidade escondida, edição fora do ar e perfil bloqueado não viram card", async () => {
    const [autor, leitor, bloqueado] = [await member(), await member(), await member()];
    await community("cp-escondida", 1);
    await community("cp-aberta");
    await edition("cp-ed-off", 0);
    await block(bloqueado.id, leitor.id);
    const links = ["/comunidade/cp-escondida", "/comunidade/cp-aberta", "/h/cp-ed-off", `/u/${bloqueado.username}`, `/u/${autor.username}`];
    const ids = [];
    for (const l of links) ids.push((await createPost(autor.id, "link", l)).id);
    const cards = (await hydratePosts(ids, leitor.id)).map((p) => p.linkCard?.kind ?? null);
    expect(cards).toEqual([null, "comunidade", null, null, "perfil"]);
  });
});

describe("denúncia pelo menu (aceite 8)", () => {
  it("denunciar post do mural cria linha em reports com communityId", async () => {
    const { reports } = await routes();
    const [dono, autor, fiscal] = [await member(), await member(), await member()];
    const c = await community("cp-denuncia");
    await role(c, dono.id, "dono");
    await role(c, autor.id, "membro");
    const p = await createPost(autor.id, "spam no mural", null, null, c);
    as(fiscal);
    const res = await reports.POST(json("POST", { targetType: "post", targetId: String(p.id), reason: "spam ou propaganda" }));
    expect(res.status).toBe(201);
    const row = await db
      .prepare(`SELECT "communityId", "targetMemberId" FROM reports WHERE "targetType" = 'post' AND "targetId" = ?`)
      .get<{ communityId: number; targetMemberId: number }>(String(p.id));
    expect(row).toEqual({ communityId: c, targetMemberId: autor.id });
  });
});

describe("listPostIds e hydratePosts (contrato)", () => {
  it("ids em id DESC com cursor, por escopo, sem comunidade escondida e sem autor bloqueado", async () => {
    const [a, b, eu] = [await member(), await member(), await member()];
    const esc = await community("cp-ids-esc", 1);
    const ok = await community("cp-ids-ok");
    await edition("cp-ids-ed");
    const p1 = await createPost(a.id, "global 1");
    const p2 = await createPost(b.id, "global do b");
    const p3 = await createPost(a.id, "na escondida", null, null, esc);
    const p4 = await createPost(a.id, "na aberta", null, null, ok);
    const p5 = await createPost(a.id, "na edição", null, "cp-ids-ed");
    await block(eu.id, b.id);
    const global = await listPostIds({ kind: "global" }, eu.id, { limit: 200 });
    expect(global).toEqual(expect.arrayContaining([p5.id, p4.id, p1.id]));
    expect(global).not.toContain(p3.id);
    expect(global).not.toContain(p2.id);
    expect([...global].sort((x, y) => y - x)).toEqual(global);
    expect(await listPostIds({ kind: "member", id: a.id }, eu.id, { limit: 3 })).toEqual([p5.id, p4.id, p1.id]);
    expect(await listPostIds({ kind: "member", id: a.id }, eu.id, { antes: p4.id, limit: 10 })).toEqual([p1.id]);
    expect(await listPostIds({ kind: "hackathon", id: "cp-ids-ed" }, null)).toEqual([p5.id]);
    expect(await listPostIds({ kind: "community", id: ok }, null)).toEqual([p4.id]);
    // hydratePosts devolve na ordem dos ids pedidos
    expect((await hydratePosts([p1.id, p5.id, p4.id], eu.id)).map((p) => p.id)).toEqual([p1.id, p5.id, p4.id]);
    expect(await hydratePosts([], eu.id)).toEqual([]);
    // listPosts mantém a assinatura antiga
    expect((await listPosts(50, null, { communityId: ok })).map((p) => p.id)).toEqual([p4.id]);
  });

  it("getPost: comunidade escondida só pro admin", async () => {
    const [a, admin] = [await member(), await member("admin")];
    const esc = await community("cp-get-esc", 1);
    const p = await createPost(a.id, "escondido", null, null, esc);
    expect(await getPost(p.id, a.id)).toBeNull();
    expect((await getPost(p.id, admin.id))?.id).toBe(p.id);
  });
});
