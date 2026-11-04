import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block } from "@/lib/blocks";
import { createPost, deletePost, getPost, hydratePosts, listPostIds, repostPost, shareCount, shareTarget, unrepostPost } from "@/lib/posts";
import type { Post } from "@/lib/posts";
import { resetRateLimits } from "@/lib/ratelimit";
import { timelinePage } from "@/lib/timeline";

// Repost e citação (spec 046, onda 4, migration 049). Um bloco por item do
// aceite: repost de quem eu sigo, próprio post 400, citação com allowQuote=0
// 403, apagar o original, a mesma origem uma vez por página, e as regras de
// borda (bloqueio 404, comunidade escondida 400, recado, rate limit). Repost
// não dá XP (plano 046).

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string; role: string };
async function member(role = "member"): Promise<M> {
  const tag = `rp${seq++}`;
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
async function edition(id: string, active = 1) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source, location)
       VALUES (?, ?, 'Org', '2026-03-05T09:00:00-03:00', 'presencial', '', '[]', ?, 'painel', 'Recife, PE')`,
    )
    .run(id, `Edição ${id}`, active);
}
async function follow(a: number, b: number) {
  await db.prepare("INSERT INTO member_follows (memberId, followedId) VALUES (?, ?)").run(a, b);
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
const notes = (memberId: number) =>
  db
    .prepare("SELECT type, text, href, actorId FROM notifications WHERE memberId = ? ORDER BY id")
    .all<{ type: string; text: string; href: string; actorId: number }>(memberId);
const xpOf = async (id: number) => (await db.prepare("SELECT xp FROM members WHERE id = ?").get<{ xp: number }>(id))!.xp;

async function routes() {
  const [repost, posts, one] = await Promise.all([
    import("@/app/api/posts/[id]/repost/route"),
    import("@/app/api/posts/route"),
    import("@/app/api/posts/[id]/route"),
  ]);
  return { repost, posts, one };
}

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("migration 049", () => {
  it("roda de novo sem quebrar e o índice único barra dois reposts do mesmo par", async () => {
    const sql = readFileSync(join(process.cwd(), "migrations/049_repost.sql"), "utf8");
    await db.exec(sql);
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "post compartilhável");
    const first = await createPost(b.id, "", null, null, null, null, null, { repostOfId: p.id });
    expect(first.body).toBe("");
    expect(first.repostOfId).toBe(p.id);
    await expect(createPost(b.id, "", null, null, null, null, null, { repostOfId: p.id })).rejects.toThrow();
  });

  it("allowQuote nasce 1 e o repost/citação guardam o alvo", async () => {
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "aceito citação");
    expect(p.allowQuote).toBe(true);
    const q = await createPost(b.id, "comentando", null, null, null, null, null, { quoteOfId: p.id });
    expect(q.quoteOfId).toBe(p.id);
    expect(q.allowQuote).toBe(true);
    const fechado = await createPost(a.id, "sem citação", null, null, null, null, null, { allowQuote: false });
    expect(fechado.allowQuote).toBe(false);
  });

  it("repost e citação não podem conviver no mesmo post", async () => {
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "origem");
    await expect(
      createPost(b.id, "", null, null, null, null, null, { repostOfId: p.id, quoteOfId: p.id }),
    ).rejects.toThrow("Post inválido");
  });
});

describe("repost (aceite 1 e 2)", () => {
  it("B reposta o post de A: quem segue B vê o original e A recebe 1 aviso; repost não dá XP", async () => {
    const { repost } = await routes();
    const [a, b, c] = [await member(), await member(), await member()];
    const p = await createPost(a.id, "olha o que eu construí");
    await follow(c.id, b.id);
    const xp0 = await xpOf(b.id);

    as(b);
    const res = await repost.POST(json("POST"), ctx(p.id));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reposted).toBe(true);
    expect(body.shareCount).toBe(1);
    expect(body.post.repostOfId).toBe(p.id);
    expect(body.post.body).toBe("");
    expect(await xpOf(b.id)).toBe(xp0);

    expect(await notes(a.id)).toEqual([
      { type: "repost", text: `@${b.username} compartilhou seu post`, href: `/post/${p.id}`, actorId: b.id },
    ]);

    const page = await timelinePage(c.id, "seguindo");
    expect(page.posts).toHaveLength(1);
    const shown = page.posts[0];
    expect(shown.repostOfId).toBe(p.id);
    expect(shown.repostOf?.id).toBe(p.id);
    expect(shown.repostOf?.body).toBe("olha o que eu construí");
    expect(shown.repostOf?.sharedBy).toEqual([b.username]);
  });

  it("repostar o próprio post dá 400; deslogado 401; inexistente 404", async () => {
    const { repost } = await routes();
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "meu");
    expect((await repost.POST(json("POST"), ctx(p.id))).status).toBe(401);
    as(a);
    const own = await repost.POST(json("POST"), ctx(p.id));
    expect(own.status).toBe(400);
    expect((await own.json()).error).toBe("Você não pode repostar o próprio post");
    as(b);
    expect((await repost.POST(json("POST"), ctx(999999))).status).toBe(404);
    expect((await repost.POST(json("POST"), ctx("abc"))).status).toBe(404);
  });

  it("repostar um repost reposta o original (o repost não tem conteúdo próprio)", async () => {
    const { repost } = await routes();
    const [a, b, c] = [await member(), await member(), await member()];
    const p = await createPost(a.id, "origem");
    as(b);
    const repostB = (await (await repost.POST(json("POST"), ctx(p.id))).json()).post;
    as(c);
    const res = await repost.POST(json("POST"), ctx(repostB.id));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.post.repostOfId).toBe(p.id);
    expect(await shareCount(p.id)).toBe(2);
  });

  it("é idempotente: dois POSTs = 1 repost, 1 aviso, contador 1", async () => {
    const { repost } = await routes();
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "corrida de clique");
    as(b);
    const first = await repost.POST(json("POST"), ctx(p.id));
    const second = await repost.POST(json("POST"), ctx(p.id));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).created).toBe(false);
    expect(await shareCount(p.id)).toBe(1);
    expect((await notes(a.id)).filter((n) => n.type === "repost")).toHaveLength(1);
  });

  it("DELETE tira o repost, o contador volta e o original continua", async () => {
    const { repost } = await routes();
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "vai e volta");
    as(b);
    await repost.POST(json("POST"), ctx(p.id));
    const del = await repost.DELETE(json("DELETE"), ctx(p.id));
    expect(del.status).toBe(200);
    const body = await del.json();
    expect(body.reposted).toBe(false);
    expect(body.removed).toBe(true);
    expect(body.shareCount).toBe(0);
    expect(await getPost(p.id, b.id)).not.toBeNull();
    // desfazer duas vezes não explode
    expect((await repost.DELETE(json("DELETE"), ctx(p.id))).status).toBe(200);
  });

  it("comunidade escondida e recado dão 400; post de quem te bloqueou dá 404", async () => {
    const { repost } = await routes();
    const [a, b] = [await member(), await member()];
    const esc = await community("rp-escondida", 1);
    const escondido = await createPost(a.id, "na escondida", null, null, esc);
    as(b);
    const r1 = await repost.POST(json("POST"), ctx(escondido.id));
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe("Este post não está disponível pra compartilhar.");

    // recado no perfil de outra pessoa não se espalha
    const recado = await createPost(a.id, "recado", null, null, null, b.id);
    const r2 = await repost.POST(json("POST"), ctx(recado.id));
    expect(r2.status).toBe(400);
    expect((await r2.json()).error).toBe("Recado não pode ser compartilhado.");

    const p = await createPost(a.id, "bloqueado");
    await block(a.id, b.id);
    expect((await repost.POST(json("POST"), ctx(p.id))).status).toBe(404);
    expect(await getPost(p.id, b.id)).toBeNull();
  });

  it("rate limit do repost: 31ª em 1h é 429", async () => {
    const { repost } = await routes();
    const [a, b] = [await member(), await member()];
    as(b);
    const ids: number[] = [];
    for (let i = 0; i < 30; i++) {
      ids.push((await createPost(a.id, `post ${i}`)).id);
      expect((await repost.POST(json("POST"), ctx(ids[i]))).status).toBe(201);
    }
    const extra = await createPost(a.id, "o 31º");
    expect((await repost.POST(json("POST"), ctx(extra.id))).status).toBe(429);
  });

  it("post de mural de edição repostado mantém o chip da origem", async () => {
    const [a, b] = [await member(), await member()];
    await edition("rp-ed-mural");
    const p = await createPost(a.id, "mural da edição", null, "rp-ed-mural");
    const r = await repostPost(p, b);
    expect(r.created).toBe(true);
    const shown = (await hydratePosts([r.post.id], b.id))[0];
    expect(shown.repostOf?.hackathonId).toBe("rp-ed-mural");
    expect(shown.repostOf?.hackathonName).toBe("Edição rp-ed-mural");
    expect(shown.repostOfId).toBe(p.id);
  });
});

describe("citação (aceite 3)", () => {
  it("citar com allowQuote=0 dá 403 com a mensagem", async () => {
    const { posts } = await routes();
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "não aceito citação", null, null, null, null, null, { allowQuote: false });
    as(b);
    const res = await posts.POST(json("POST", { body: "vou citar mesmo assim", quoteOfId: p.id }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("A pessoa não aceita citação neste post");
  });

  it("citação tem corpo obrigatório e avisa o autor; a caixa traz o original", async () => {
    const { posts } = await routes();
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "olha isso");
    as(b);
    expect((await posts.POST(json("POST", { body: "  ", quoteOfId: p.id }))).status).toBe(400);
    const res = await posts.POST(json("POST", { body: "concordo demais", quoteOfId: p.id }));
    expect(res.status).toBe(201);
    const quote = (await res.json()).post;
    expect(quote.quoteOfId).toBe(p.id);
    expect(quote.quoteOf?.body).toBe("olha isso");
    expect(quote.body).toBe("concordo demais");
    expect(await notes(a.id)).toEqual([
      { type: "quote", text: `@${b.username} citou seu post`, href: `/post/${quote.id}`, actorId: b.id },
    ]);
    // o original não muda de contagem nem ganha repost
    expect(quote.repostOfId).toBeNull();
    expect(await shareCount(p.id)).toBe(0);
  });

  it("citar um repost cita o original; citação de post inexistente dá 404", async () => {
    const { posts } = await routes();
    const [a, b, c] = [await member(), await member(), await member()];
    const p = await createPost(a.id, "origem");
    const repost = await repostPost(p, b);
    as(c);
    const res = await posts.POST(json("POST", { body: "citando o boost", quoteOfId: repost.post.id }));
    expect(res.status).toBe(201);
    expect((await res.json()).post.quoteOfId).toBe(p.id);
    expect((await posts.POST(json("POST", { body: "x", quoteOfId: 999999 }))).status).toBe(404);
    expect((await posts.POST(json("POST", { body: "x", quoteOfId: "abc" }))).status).toBe(404);
  });

  it("apagar o original deixa a citação com 'post apagado' e leva os reposts junto", async () => {
    const [a, b, c] = [await member(), await member(), await member()];
    const p = await createPost(a.id, "vai sumir");
    const quote = await createPost(b.id, "minha citação", null, null, null, null, null, { quoteOfId: p.id });
    const repost = await repostPost(p, c);
    // reação no repost: o cascade do original não pode travar nela
    await db.prepare("INSERT INTO likes (postId, memberId, kind) VALUES (?, ?, 'curti')").run(repost.post.id, a.id);
    expect(await deletePost(p.id, a)).toBe(true);

    expect(await db.prepare("SELECT 1 FROM posts WHERE id = ?").get(repost.post.id)).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM likes WHERE postId = ?").get(repost.post.id)).toBeUndefined();
    const after = (await hydratePosts([quote.id], b.id))[0];
    expect(after.body).toBe("minha citação");
    expect(after.quoteOfId).toBeNull();
    expect(after.quoteOf).toBeNull();
  });

  it("o autor liga e desliga a citação pelo PATCH; quem não é autor não mexe", async () => {
    const { one } = await routes();
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "aberto");
    as(a);
    const off = await one.PATCH(json("PATCH", { allowQuote: false }), ctx(p.id));
    expect(off.status).toBe(200);
    const offPost = (await off.json()).post;
    expect(offPost.allowQuote).toBe(false);
    expect(offPost.body).toBe("aberto");
    expect(offPost.editedAt).toBeNull();
    const on = await one.PATCH(json("PATCH", { allowQuote: true }), ctx(p.id));
    expect((await on.json()).post.allowQuote).toBe(true);
    expect((await one.PATCH(json("PATCH", { allowQuote: "sim" }), ctx(p.id))).status).toBe(400);
    as(b);
    expect((await one.PATCH(json("PATCH", { allowQuote: false }), ctx(p.id))).status).toBe(403);
  });

  it("PATCH sem nada dá 400 e o corpo com allowQuote continua editando o texto", async () => {
    const { one } = await routes();
    const a = await member();
    const p = await createPost(a.id, "versão 1");
    as(a);
    expect((await one.PATCH(json("PATCH", {}), ctx(p.id))).status).toBe(400);
    const res = await one.PATCH(json("PATCH", { body: "versão 2", allowQuote: false }), ctx(p.id));
    const post = (await res.json()).post;
    expect(post.body).toBe("versão 2");
    expect(post.allowQuote).toBe(false);
    expect(post.editedAt).not.toBeNull();
  });

  it("o POST /api/posts com allowQuote=false nasce sem aceitar citação", async () => {
    const { posts } = await routes();
    const a = await member();
    as(a);
    const res = await posts.POST(json("POST", { body: "fechado pra citação", allowQuote: false }));
    expect(res.status).toBe(201);
    expect((await res.json()).post.allowQuote).toBe(false);
    const aberto = await posts.POST(json("POST", { body: "aberto" }));
    expect((await aberto.json()).post.allowQuote).toBe(true);
  });
});

describe("timeline (aceite 5)", () => {
  it("a mesma origem aparece uma vez por página, com '@a e @b compartilharam'", async () => {
    const [a, b, c, leitor] = [await member(), await member(), await member(), await member()];
    const p = await createPost(a.id, "a origem");
    await repostPost(p, b);
    await repostPost(p, c);
    await follow(leitor.id, b.id);
    await follow(leitor.id, c.id);
    const page = await timelinePage(leitor.id, "seguindo");
    expect(page.posts).toHaveLength(1);
    const shown = page.posts[0];
    expect(shown.repostOfId).toBe(p.id);
    expect([...shown.repostOf!.sharedBy].sort()).toEqual([b.username, c.username].sort());
  });

  it("o original e o repost dele não se repetem; o repost mais novo representa", async () => {
    const [a, leitor] = [await member(), await member()];
    const p = await createPost(a.id, "eu escrevi");
    await follow(leitor.id, a.id);
    expect((await timelinePage(leitor.id, "seguindo")).posts.map((x) => x.id)).toEqual([p.id]);
    const r = await repostPost(p, leitor);
    const page = await timelinePage(leitor.id, "seguindo");
    expect(page.posts).toHaveLength(1);
    expect(page.posts[0].id).toBe(r.post.id);
    expect(page.posts[0].repostOf?.id).toBe(p.id);
  });

  it("repost de quem eu bloqueei depois não aparece mais", async () => {
    const [a, b, leitor] = [await member(), await member(), await member()];
    const p = await createPost(a.id, "some depois");
    const r = await repostPost(p, b);
    await follow(leitor.id, b.id);
    expect((await timelinePage(leitor.id, "seguindo")).posts).toHaveLength(1);
    await block(leitor.id, b.id);
    expect((await timelinePage(leitor.id, "seguindo")).posts).toHaveLength(0);
    // o repost de quem eu bloqueei não existe pra mim
    expect(await getPost(r.post.id, leitor.id)).toBeNull();

    // meu repost de post de quem me bloqueou: o repost fica, o original não vem
    const meu = await repostPost(p, leitor);
    await block(a.id, leitor.id);
    expect(await listPostIds({ kind: "member", id: leitor.id }, leitor.id)).toEqual([]);
    const shell = await getPost(meu.post.id, leitor.id);
    expect(shell?.repostOfId).toBe(p.id);
    expect(shell?.repostOf).toBeNull();
  });

  it("o cursor continua funcionando com reposts no meio", async () => {
    const [a, b, leitor] = [await member(), await member(), await member()];
    await follow(leitor.id, a.id);
    await follow(leitor.id, b.id);
    const posts: Post[] = [];
    for (let i = 0; i < 5; i++) posts.push(await createPost(a.id, `post ${i}`));
    await repostPost(posts[0], b);
    const origins = (ps: Post[]) => ps.map((p) => p.repostOfId ?? p.id);
    const first = await timelinePage(leitor.id, "seguindo", null, 3);
    expect(first.posts).toHaveLength(3);
    expect(new Set(origins(first.posts)).size).toBe(3);
    expect(first.next).not.toBeNull();
    const second = await timelinePage(leitor.id, "seguindo", first.next, 3);
    expect(second.posts.length).toBeGreaterThan(0);
    // a mesma origem não se repete dentro de uma página
    expect(new Set(origins(second.posts)).size).toBe(second.posts.length);
    // as duas páginas juntas cobrem os 5 posts, sem perder nenhum
    const all = new Set([...origins(first.posts), ...origins(second.posts)]);
    expect([...all].sort((x, y) => x - y)).toEqual(posts.map((p) => p.id).sort((x, y) => x - y));
  });
});

describe("helpers", () => {
  it("shareTarget resolve o original e recusa espaço fora do ar", async () => {
    const [a, b] = [await member(), await member()];
    await edition("rp-ed-off", 0);
    const inativa = await createPost(a.id, "edição fora do ar", null, "rp-ed-off");
    const t1 = await shareTarget(inativa.id, b.id);
    expect(t1.ok).toBe(false);
    if (!t1.ok) expect(t1.status).toBe(400);

    const p = await createPost(a.id, "ok");
    const t2 = await shareTarget(p.id, b.id);
    expect(t2.ok).toBe(true);
    if (t2.ok) expect(t2.post.id).toBe(p.id);
  });

  it("unrepostPost devolve o contador e não mexe no que não é meu", async () => {
    const [a, b, c] = [await member(), await member(), await member()];
    const p = await createPost(a.id, "contador");
    await repostPost(p, b);
    expect(await shareCount(p.id)).toBe(1);
    const res = await unrepostPost(p.id, c.id);
    expect(res.removed).toBe(false);
    expect(res.shareCount).toBe(1);
    const mine = await unrepostPost(p.id, b.id);
    expect(mine.removed).toBe(true);
    expect(mine.shareCount).toBe(0);
  });

  it("hydratePosts marca repostedByMe e shareCount de quem repostou", async () => {
    const [a, b] = [await member(), await member()];
    const p = await createPost(a.id, "quem repostou");
    expect((await hydratePosts([p.id], b.id))[0].repostedByMe).toBe(false);
    await repostPost(p, b);
    const [paraB, paraA] = await Promise.all([hydratePosts([p.id], b.id), hydratePosts([p.id], a.id)]);
    expect(paraB[0].repostedByMe).toBe(true);
    expect(paraB[0].shareCount).toBe(1);
    expect(paraA[0].repostedByMe).toBe(false);
    expect(paraA[0].sharedBy).toEqual([b.username]);
  });
});
