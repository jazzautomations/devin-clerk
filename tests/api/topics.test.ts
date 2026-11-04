import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block, mute } from "@/lib/blocks";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";
import { RATE_LIMITS, resetRateLimits } from "@/lib/ratelimit";
import { countTopics, hotTopics, listTopics, notifyTopicReply, type TopicReply } from "@/lib/topics";

// Tópicos da comunidade (spec 046 onda 1, migration 058): guardas, votos,
// ordenação, enquete, resposta aceita, moderação, notificação agrupada,
// denúncia na fila única, bloqueio e LGPD. Um bloco por item do aceite.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
  clerkClient: async () => ({ users: { deleteUser: async () => ({}) } }),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string; role: string };
async function member(role = "member"): Promise<M> {
  const tag = `tp${seq++}`;
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
async function join(communityId: number, m: M, r: "dono" | "organizador" | "membro" = "membro") {
  await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, ?)").run(communityId, m.id, r);
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string, body?: unknown, url = "http://t/") =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const sctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const rctx = (id: number, replyId: number | string) => ({ params: Promise.resolve({ id: String(id), replyId: String(replyId) }) });

async function routes() {
  const [list, one, replies, reply, vote, replyVote, poll, accept, reports] = await Promise.all([
    import("@/app/api/communities/[slug]/topics/route"),
    import("@/app/api/topics/[id]/route"),
    import("@/app/api/topics/[id]/replies/route"),
    import("@/app/api/topics/[id]/replies/[replyId]/route"),
    import("@/app/api/topics/[id]/vote/route"),
    import("@/app/api/topics/[id]/replies/[replyId]/vote/route"),
    import("@/app/api/topics/[id]/poll/route"),
    import("@/app/api/topics/[id]/accept/route"),
    import("@/app/api/reports/route"),
  ]);
  return { list, one, replies, reply, vote, replyVote, poll, accept, reports };
}

async function newTopic(slug: string, by: M, body: Record<string, unknown> = {}): Promise<number> {
  const { list } = await routes();
  as(by);
  const res = await list.POST(req("POST", { title: "Tópico de teste", body: "corpo", ...body }), sctx(slug));
  expect(res.status).toBe(201);
  return (await res.json()).topic.id;
}
async function newReply(topicId: number, by: M, body: string, parentId: number | null = null): Promise<TopicReply> {
  const { replies } = await routes();
  as(by);
  const res = await replies.POST(req("POST", { body, parentId }), ctx(topicId));
  expect(res.status).toBe(201);
  return (await res.json()).reply;
}
const scoreOf = async (topicId: number) =>
  (await db.prepare("SELECT score FROM community_topics WHERE id = ?").get<{ score: number }>(topicId))!.score;
const xpOf = async (id: number) => (await db.prepare("SELECT xp FROM members WHERE id = ?").get<{ xp: number }>(id))!.xp;
const notes = (memberId: number) =>
  db.prepare("SELECT type, text, href, actorId FROM notifications WHERE memberId = ? ORDER BY id").all<{ type: string; text: string; href: string; actorId: number | null }>(memberId);

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("guardas", () => {
  it("deslogado: 401 JSON em todas as rotas", async () => {
    const r = await routes();
    await community("tp-guard-anon");
    const all = [
      await r.list.GET(req("GET"), sctx("tp-guard-anon")),
      await r.list.POST(req("POST", { title: "Tópico de teste" }), sctx("tp-guard-anon")),
      await r.one.GET(req("GET"), ctx(1)),
      await r.one.PATCH(req("PATCH", { locked: true }), ctx(1)),
      await r.one.DELETE(req("DELETE"), ctx(1)),
      await r.replies.POST(req("POST", { body: "oi" }), ctx(1)),
      await r.vote.POST(req("POST", { value: 1 }), ctx(1)),
      await r.replyVote.POST(req("POST", { value: 1 }), rctx(1, 1)),
      await r.poll.POST(req("POST", { optionId: 1 }), ctx(1)),
      await r.accept.POST(req("POST", { replyId: 1 }), ctx(1)),
    ];
    for (const res of all) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("não-membro lê mas não abre tópico, não responde e não vota (403); quem só segue também não", async () => {
    const r = await routes();
    const c = await community("tp-guard-nm");
    const [dono, fora, seguidor] = [await member(), await member(), await member()];
    await join(c, dono, "dono");
    await db.prepare("INSERT INTO community_follows (communityId, memberId) VALUES (?, ?)").run(c, seguidor.id);
    const t = await newTopic("tp-guard-nm", dono);
    for (const who of [fora, seguidor]) {
      as(who);
      expect((await r.list.GET(req("GET"), sctx("tp-guard-nm"))).status).toBe(200);
      expect((await r.one.GET(req("GET"), ctx(t))).status).toBe(200);
      const created = await r.list.POST(req("POST", { title: "quero postar" }), sctx("tp-guard-nm"));
      expect(created.status).toBe(403);
      expect((await created.json()).error).toMatch(/Só quem é da comunidade/);
      expect((await r.replies.POST(req("POST", { body: "oi" }), ctx(t))).status).toBe(403);
      expect((await r.vote.POST(req("POST", { value: 1 }), ctx(t))).status).toBe(403);
    }
    const lista = await (await r.list.GET(req("GET"), sctx("tp-guard-nm"))).json();
    expect(lista.canPost).toBe(false);
  });

  it("comunidade escondida: 404 pra quem não é admin, admin vê", async () => {
    const r = await routes();
    const c = await community("tp-guard-hid");
    const [dono, admin] = [await member(), await member("admin")];
    await join(c, dono, "dono");
    const t = await newTopic("tp-guard-hid", dono);
    await db.prepare("UPDATE communities SET hidden = 1 WHERE id = ?").run(c);
    as(dono);
    expect((await r.list.GET(req("GET"), sctx("tp-guard-hid"))).status).toBe(404);
    expect((await r.one.GET(req("GET"), ctx(t))).status).toBe(404);
    as(admin);
    expect((await r.one.GET(req("GET"), ctx(t))).status).toBe(200);
  });

  it("validação: título curto, enquete sem opção e id inválido", async () => {
    const r = await routes();
    const c = await community("tp-guard-val");
    const a = await member();
    await join(c, a);
    as(a);
    expect((await r.list.POST(req("POST", { title: "oi" }), sctx("tp-guard-val"))).status).toBe(400);
    expect((await r.list.POST(req("POST", { title: "Qual stack?", kind: "enquete", options: ["só uma"] }), sctx("tp-guard-val"))).status).toBe(400);
    expect((await r.one.GET(req("GET"), ctx("1e9"))).status).toBe(404);
    expect((await r.one.GET(req("GET"), ctx(999999))).status).toBe(404);
  });
});

describe("criar e responder em 3 níveis", () => {
  it("cria, responde em árvore, conta respostas e atualiza a última atividade", async () => {
    const r = await routes();
    const c = await community("tp-tree");
    const [a, b, d] = [await member(), await member(), await member()];
    for (const m of [a, b, d]) await join(c, m);
    const t = await newTopic("tp-tree", a, { title: "Como vocês fazem deploy?", body: "**sério**", flair: "dúvida" });
    await db.prepare("UPDATE community_topics SET lastActivityAt = '2020-01-01 00:00:00' WHERE id = ?").run(t);
    const n1 = await newReply(t, b, "nível 1");
    const n2 = await newReply(t, d, "nível 2", n1.id);
    const n3 = await newReply(t, a, "nível 3", n2.id);
    expect([n1.depth, n2.depth, n3.depth]).toEqual([1, 2, 3]);
    expect(n3.parentId).toBe(n2.id);

    as(b);
    const got = await (await r.one.GET(req("GET"), ctx(t))).json();
    expect(got.topic).toMatchObject({ title: "Como vocês fazem deploy?", body: "**sério**", flair: "dúvida", replyCount: 3, isMember: true, mine: false });
    expect(got.topic.lastActivityAt).not.toBe("2020-01-01 00:00:00");
    expect(got.replies).toHaveLength(1);
    expect(got.replies[0].children[0].children[0].body).toBe("nível 3");
  });

  it("resposta a uma de nível 6 vira irmã dela; pai de outro tópico dá 400", async () => {
    const r = await routes();
    const c = await community("tp-deep");
    const [a, b] = [await member(), await member()];
    await join(c, a);
    await join(c, b);
    const t = await newTopic("tp-deep", a);
    const outro = await newTopic("tp-deep", a, { title: "Outro tópico" });
    let parent: number | null = null;
    const chain: TopicReply[] = [];
    for (let i = 1; i <= 6; i++) {
      const rep = await newReply(t, i % 2 ? b : a, `nível ${i}`, parent);
      chain.push(rep);
      parent = rep.id;
    }
    expect(chain[5].depth).toBe(6);
    const fundo = await newReply(t, a, "mais fundo", chain[5].id);
    expect(fundo.depth).toBe(6);
    expect(fundo.parentId).toBe(chain[4].id);
    as(a);
    expect((await r.replies.POST(req("POST", { body: "x", parentId: chain[0].id }), ctx(outro))).status).toBe(400);
    expect((await r.replies.POST(req("POST", { body: "   " }), ctx(t))).status).toBe(400);
  });

  it("notifica o autor do tópico e o da resposta respondida, com link pra resposta, agrupando por hora", async () => {
    const c = await community("tp-notify");
    const [autor, b, d] = [await member(), await member(), await member()];
    for (const m of [autor, b, d]) await join(c, m);
    const t = await newTopic("tp-notify", autor, { title: "Tópico avisado" });
    const r1 = await newReply(t, b, "primeira");
    let an = await notes(autor.id);
    expect(an).toHaveLength(1);
    expect(an[0]).toMatchObject({ type: "topic-reply", actorId: b.id, href: `/comunidade/tp-notify/t/${t}#r-${r1.id}` });
    expect(an[0].text).toContain(`@${b.username} respondeu seu tópico`);

    // resposta filha avisa quem escreveu a resposta (b), não de novo o autor
    const r2 = await newReply(t, autor, "resposta à b", r1.id);
    expect(await notes(b.id)).toMatchObject([{ text: expect.stringContaining(`@${autor.username} respondeu você`), href: `/comunidade/tp-notify/t/${t}#r-${r2.id}` }]);

    // segunda resposta direta na mesma hora: a notificação do autor vira "novas respostas"
    const r3 = await newReply(t, d, "terceira");
    an = await notes(autor.id);
    expect(an).toHaveLength(1);
    expect(an[0]).toMatchObject({ text: 'Novas respostas em "Tópico avisado"', href: `/comunidade/tp-notify/t/${t}#r-${r3.id}`, actorId: null });

    // lida: a próxima abre notificação nova
    await db.prepare("UPDATE notifications SET read = 1 WHERE memberId = ?").run(autor.id);
    await newReply(t, b, "quarta");
    expect(await notes(autor.id)).toHaveLength(2);
  });

  it("notifyTopicReply pula quem silenciou ou bloqueou quem respondeu", async () => {
    const [a, b] = [await member(), await member()];
    await mute(a.id, b.id);
    expect(await notifyTopicReply(a.id, b, { id: 1, slug: "x", title: "t" }, "oi", 1)).toBe("skipped");
    expect(await notifyTopicReply(a.id, a, { id: 1, slug: "x", title: "t" }, "oi", 1)).toBe("skipped");
  });
});

describe("votos", () => {
  it("votar, trocar e desfazer; score na transação; sem XP; não vota no próprio", async () => {
    const r = await routes();
    const c = await community("tp-vote");
    const [a, b, d] = [await member(), await member(), await member()];
    for (const m of [a, b, d]) await join(c, m);
    const t = await newTopic("tp-vote", a);
    const xp0 = [await xpOf(a.id), await xpOf(b.id)];
    as(b);
    expect(await (await r.vote.POST(req("POST", { value: 1 }), ctx(t))).json()).toEqual({ score: 1, myVote: 1 });
    as(d);
    expect(await (await r.vote.POST(req("POST", { value: 1 }), ctx(t))).json()).toEqual({ score: 2, myVote: 1 });
    as(b);
    expect(await (await r.vote.POST(req("POST", { value: -1 }), ctx(t))).json()).toEqual({ score: 0, myVote: -1 });
    expect(await (await r.vote.POST(req("POST", { value: 0 }), ctx(t))).json()).toEqual({ score: 1, myVote: 0 });
    expect(await scoreOf(t)).toBe(1);
    expect((await r.vote.POST(req("POST", { value: 5 }), ctx(t))).status).toBe(400);
    as(a);
    const own = await r.vote.POST(req("POST", { value: 1 }), ctx(t));
    expect(own.status).toBe(400);
    expect([await xpOf(a.id), await xpOf(b.id)]).toEqual(xp0);

    // resposta: mesmas regras, alvo de outro tópico dá 404
    const rep = await newReply(t, b, "resposta votável");
    as(a);
    expect(await (await r.replyVote.POST(req("POST", { value: 1 }), rctx(t, rep.id))).json()).toEqual({ score: 1, myVote: 1 });
    as(b);
    expect((await r.replyVote.POST(req("POST", { value: 1 }), rctx(t, rep.id))).status).toBe(400);
    const outro = await newTopic("tp-vote", a, { title: "Outro tópico" });
    as(d);
    expect((await r.replyVote.POST(req("POST", { value: 1 }), rctx(outro, rep.id))).status).toBe(404);
    as(b);
    const lista = await (await r.one.GET(req("GET"), ctx(t))).json();
    expect(lista.replies[0]).toMatchObject({ score: 1, myVote: 0, mine: true });
    expect(lista.topic.myVote).toBe(0);
  });

  it("rate limit: 300 votos por hora", async () => {
    const r = await routes();
    expect(RATE_LIMITS["topic-vote"]).toEqual({ limit: 300, windowMs: 3_600_000 });
    expect(RATE_LIMITS["topic-create"].limit).toBe(10);
    expect(RATE_LIMITS["topic-reply"].limit).toBe(60);
    const c = await community("tp-rl");
    const [a, b] = [await member(), await member()];
    await join(c, a);
    await join(c, b);
    as(a);
    for (let i = 0; i < 10; i++) expect((await r.list.POST(req("POST", { title: `Tópico número ${i}` }), sctx("tp-rl"))).status).toBe(201);
    const over = await r.list.POST(req("POST", { title: "o décimo primeiro" }), sctx("tp-rl"));
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("ordenação e filtros", () => {
  it("em alta, novos, top por período, sem resposta, flair e busca; fixados no topo", async () => {
    const c = await community("tp-sort");
    const [a, b] = [await member(), await member()];
    await join(c, a);
    await join(c, b);
    const ins = async (title: string, score: number, hoursAgo: number, extra: { replyCount?: number; kind?: string; flair?: string } = {}) => {
      const row = await db
        .prepare(
          `INSERT INTO community_topics (communityId, memberId, title, score, replyCount, kind, flair, createdAt, lastActivityAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, sqlite_now(?), sqlite_now(?)) RETURNING id`,
        )
        .get<{ id: number }>(c, a.id, title, score, extra.replyCount ?? 0, extra.kind ?? "discussao", extra.flair ?? null, `-${hoursAgo} hours`, `-${hoursAgo} hours`);
      return row!.id;
    };
    const velhoBom = await ins("velho com 100 votos", 100, 24 * 20, { replyCount: 3 });
    const ontem = await ins("de ontem com 10", 10, 30, { replyCount: 2, flair: "Ideia" });
    const novo = await ins("novinho sem voto", 0, 1, { flair: "ideia" });
    const pergunta = await ins("pergunta respondida sem aceite", 2, 5, { replyCount: 4, kind: "pergunta" });

    const ids = async (opts: Parameters<typeof listTopics>[2]) => (await listTopics(c, b.id, opts)).topics.map((t) => t.id);
    expect(await ids({ sort: "novos" })).toEqual([novo, pergunta, ontem, velhoBom]);
    expect(await ids({ sort: "em-alta" })).toEqual([novo, pergunta, ontem, velhoBom]);
    expect(await ids({ sort: "top", period: "semana" })).toEqual([ontem, pergunta, novo]);
    expect(await ids({ sort: "top", period: "sempre" })).toEqual([velhoBom, ontem, pergunta, novo]);
    expect(await ids({ sort: "sem-resposta" })).toEqual([novo, pergunta]);
    expect(await ids({ sort: "novos", flair: "IDEIA" })).toEqual([novo, ontem]);
    expect(await ids({ sort: "novos", q: "SEM VOTO" })).toEqual([novo]);
    expect(await ids({ sort: "novos", q: "voto" })).toEqual([novo, velhoBom]);
    expect(await ids({ sort: "novos", q: "%" })).toEqual([]);

    // aceitar a resposta tira a pergunta do sem-resposta
    const rep = await db.prepare("INSERT INTO topic_replies (topicId, memberId, body) VALUES (?, ?, 'resolve') RETURNING id").get<{ id: number }>(pergunta, b.id);
    await db.prepare("UPDATE community_topics SET acceptedReplyId = ? WHERE id = ?").run(rep!.id, pergunta);
    expect(await ids({ sort: "sem-resposta" })).toEqual([novo]);

    // fixado sai da lista e vai pro topo
    await db.prepare("UPDATE community_topics SET pinnedAt = sqlite_now() WHERE id = ?").run(velhoBom);
    const withPin = await listTopics(c, b.id, { sort: "novos" });
    expect(withPin.pinned.map((t) => t.id)).toEqual([velhoBom]);
    expect(withPin.topics.map((t) => t.id)).not.toContain(velhoBom);

    expect((await hotTopics(c, b.id, 2)).map((t) => t.id)).toEqual([novo, pergunta]);
    expect(await countTopics(c)).toBe(4);

    // a rota devolve os flairs em uso
    const r = await routes();
    as(b);
    const body = await (await r.list.GET(req("GET", undefined, "http://t/?ordem=novos&flair=ideia"), sctx("tp-sort"))).json();
    expect(body.topics.map((t: { id: number }) => t.id)).toEqual([novo, ontem]);
    expect(body.flairs).toHaveLength(1);
    expect(body.canPost).toBe(true);
  });

  it("autor bloqueado (dois sentidos) ou silenciado some da lista; bloqueado dá 404 no tópico", async () => {
    const r = await routes();
    const c = await community("tp-block");
    const [a, b, d] = [await member(), await member(), await member()];
    for (const m of [a, b, d]) await join(c, m);
    const ta = await newTopic("tp-block", a, { title: "Tópico da A" });
    const td = await newTopic("tp-block", d, { title: "Tópico da D" });
    await block(a.id, b.id);
    await mute(b.id, d.id);
    const seen = (await listTopics(c, b.id, { sort: "novos" })).topics.map((t) => t.id);
    expect(seen).not.toContain(ta);
    expect(seen).not.toContain(td);
    as(b);
    expect((await r.one.GET(req("GET"), ctx(ta))).status).toBe(404);
    expect((await r.replies.POST(req("POST", { body: "oi" }), ctx(ta))).status).toBe(404);
    // silenciado ainda abre pelo link
    expect((await r.one.GET(req("GET"), ctx(td))).status).toBe(200);

    // resposta de quem eu silenciei vira marcador e os filhos ficam
    const rd = await newReply(ta, d, "resposta da D");
    await newReply(ta, a, "resposta da A pra D", rd.id);
    as(b);
    await db.prepare("DELETE FROM member_blocks").run();
    const got = await (await r.one.GET(req("GET"), ctx(ta))).json();
    expect(got.replies[0]).toMatchObject({ hidden: true, body: "", author: null });
    expect(got.replies[0].children[0].body).toBe("resposta da A pra D");
  });
});

describe("enquete", () => {
  it("voto único por pessoa (votar de novo troca), só membro, trancar encerra", async () => {
    const r = await routes();
    const c = await community("tp-poll");
    const [a, b, d, fora] = [await member(), await member(), await member(), await member()];
    await join(c, a, "dono");
    await join(c, b);
    await join(c, d);
    const t = await newTopic("tp-poll", a, { title: "Qual stack no próximo?", kind: "enquete", options: ["Next", "Remix", "Astro"] });
    as(b);
    const g = await (await r.one.GET(req("GET"), ctx(t))).json();
    const [next, remix] = g.topic.poll.options;
    expect(g.topic.poll).toMatchObject({ total: 0, myOptionId: null, closed: false });
    let res = await r.poll.POST(req("POST", { optionId: next.id }), ctx(t));
    expect((await res.json()).poll).toMatchObject({ total: 1, myOptionId: next.id });
    res = await r.poll.POST(req("POST", { optionId: remix.id }), ctx(t));
    const poll = (await res.json()).poll;
    expect(poll.total).toBe(1);
    expect(poll.myOptionId).toBe(remix.id);
    expect(poll.options.map((o: { votes: number }) => o.votes)).toEqual([0, 1, 0]);
    const rows = await db.prepare("SELECT COUNT(*)::int AS n FROM topic_poll_votes WHERE topicId = ?").get<{ n: number }>(t);
    expect(rows!.n).toBe(1);
    as(d);
    await r.poll.POST(req("POST", { optionId: next.id }), ctx(t));
    expect((await r.poll.POST(req("POST", { optionId: 999999 }), ctx(t))).status).toBe(400);
    as(fora);
    expect((await r.poll.POST(req("POST", { optionId: next.id }), ctx(t))).status).toBe(403);
    as(a);
    await r.one.PATCH(req("PATCH", { locked: true }), ctx(t));
    as(d);
    expect((await r.poll.POST(req("POST", { optionId: remix.id }), ctx(t))).status).toBe(403);
    const closed = await (await r.one.GET(req("GET"), ctx(t))).json();
    expect(closed.topic.poll).toMatchObject({ total: 2, closed: true, myOptionId: next.id });
  });
});

describe("resposta aceita", () => {
  it("só o autor da pergunta marca; selo resolveu; resposta removida deixa de resolver", async () => {
    const r = await routes();
    const c = await community("tp-accept");
    const [a, b, mod] = [await member(), await member(), await member()];
    await join(c, a);
    await join(c, b);
    await join(c, mod, "organizador");
    const t = await newTopic("tp-accept", a, { title: "Como sobe o Postgres?", kind: "pergunta" });
    const disc = await newTopic("tp-accept", a, { title: "Uma discussão" });
    const rep = await newReply(t, b, "docker compose up");
    as(b);
    expect((await r.accept.POST(req("POST", { replyId: rep.id }), ctx(t))).status).toBe(403);
    as(a);
    expect((await r.accept.POST(req("POST", { replyId: rep.id }), ctx(disc))).status).toBe(400);
    expect(await (await r.accept.POST(req("POST", { replyId: rep.id }), ctx(t))).json()).toEqual({ acceptedReplyId: rep.id });
    const got = await (await r.one.GET(req("GET"), ctx(t))).json();
    expect(got.topic.resolved).toBe(true);
    expect(got.replies[0].accepted).toBe(true);
    as(mod);
    await r.reply.DELETE(req("DELETE"), rctx(t, rep.id));
    as(a);
    expect((await (await r.one.GET(req("GET"), ctx(t))).json()).topic.resolved).toBe(false);
  });
});

describe("moderação", () => {
  it("organizador fixa (até 3) e tranca; membro leva 403; trancado ninguém responde", async () => {
    const r = await routes();
    const c = await community("tp-mod");
    const [dono, org, m1] = [await member(), await member(), await member()];
    await join(c, dono, "dono");
    await join(c, org, "organizador");
    await join(c, m1);
    const ts = [];
    for (let i = 0; i < 4; i++) ts.push(await newTopic("tp-mod", m1, { title: `Tópico fixável ${i}` }));
    as(m1);
    for (const patch of [{ pinned: true }, { locked: true }]) {
      const res = await r.one.PATCH(req("PATCH", patch), ctx(ts[0]));
      expect(res.status).toBe(403);
    }
    as(org);
    for (let i = 0; i < 3; i++) expect((await r.one.PATCH(req("PATCH", { pinned: true }), ctx(ts[i]))).status).toBe(200);
    const quarto = await r.one.PATCH(req("PATCH", { pinned: true }), ctx(ts[3]));
    expect(quarto.status).toBe(409);
    expect((await r.one.PATCH(req("PATCH", { pinned: false }), ctx(ts[2]))).status).toBe(200);
    expect((await r.one.PATCH(req("PATCH", { pinned: true }), ctx(ts[3]))).status).toBe(200);

    const lock = await r.one.PATCH(req("PATCH", { locked: true }), ctx(ts[0]));
    expect((await lock.json()).topic.locked).toBe(true);
    as(m1);
    const blocked = await r.replies.POST(req("POST", { body: "posso?" }), ctx(ts[0]));
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toMatch(/trancado/);

    // flair: autor e moderação trocam; título só o autor
    as(org);
    expect((await r.one.PATCH(req("PATCH", { flair: "anúncio" }), ctx(ts[1]))).status).toBe(200);
    expect((await r.one.PATCH(req("PATCH", { title: "mudei o título" }), ctx(ts[1]))).status).toBe(403);
    as(m1);
    const edited = await (await r.one.PATCH(req("PATCH", { title: "Título novo do autor", body: "corpo novo" }), ctx(ts[1]))).json();
    expect(edited.topic).toMatchObject({ title: "Título novo do autor", body: "corpo novo", flair: "anúncio" });
    expect(edited.topic.editedAt).toBeTruthy();
  });

  it("remoção mantém a árvore: tópico e resposta viram marcador, filhos ficam", async () => {
    const r = await routes();
    const c = await community("tp-remove");
    const [dono, a, b] = [await member(), await member(), await member()];
    await join(c, dono, "dono");
    await join(c, a);
    await join(c, b);
    const t = await newTopic("tp-remove", a, { title: "Tópico polêmico", body: "texto ruim" });
    const r1 = await newReply(t, b, "resposta ruim");
    const r2 = await newReply(t, a, "resposta à ruim", r1.id);
    as(a);
    expect((await r.reply.DELETE(req("DELETE"), rctx(t, r1.id))).status).toBe(403);
    as(dono);
    expect(await (await r.reply.DELETE(req("DELETE"), rctx(t, r1.id))).json()).toEqual({ result: "removed" });
    as(a);
    let got = await (await r.one.GET(req("GET"), ctx(t))).json();
    expect(got.replies[0]).toMatchObject({ id: r1.id, removed: true, body: "", author: null });
    expect(got.replies[0].children[0].id).toBe(r2.id);
    expect(got.topic.replyCount).toBe(1);
    // responder a uma removida não rola
    expect((await r.replies.POST(req("POST", { body: "x", parentId: r1.id }), ctx(t))).status).toBe(400);

    as(dono);
    expect(await (await r.one.DELETE(req("DELETE"), ctx(t))).json()).toEqual({ result: "removed" });
    // moderação ainda lê o texto removido
    got = await (await r.one.GET(req("GET"), ctx(t))).json();
    expect(got.topic).toMatchObject({ removed: true, body: "texto ruim" });
    as(b);
    got = await (await r.one.GET(req("GET"), ctx(t))).json();
    expect(got.topic).toMatchObject({ removed: true, body: "" });
    expect(got.replies[0].children[0].body).toBe("resposta à ruim");
    expect((await r.replies.POST(req("POST", { body: "e agora?" }), ctx(t))).status).toBe(403);
    expect((await listTopics(c, b.id, { sort: "novos" })).topics).toHaveLength(0);
    expect((await listTopics(c, dono.id, { sort: "novos", includeRemoved: true })).topics[0].removed).toBe(true);
    expect(await countTopics(c)).toBe(0);
  });

  it("autor apaga: sem resposta some, com resposta vira [apagado]; resposta com filha também", async () => {
    const r = await routes();
    const c = await community("tp-del");
    const [a, b] = [await member(), await member()];
    await join(c, a);
    await join(c, b);
    const sozinho = await newTopic("tp-del", a, { title: "Ninguém respondeu" });
    as(a);
    expect(await (await r.one.DELETE(req("DELETE"), ctx(sozinho))).json()).toEqual({ result: "deleted" });
    expect(await db.prepare("SELECT id FROM community_topics WHERE id = ?").get(sozinho)).toBeUndefined();

    const t = await newTopic("tp-del", a, { title: "Com conversa", body: "meu texto" });
    const rb = await newReply(t, b, "resposta da b");
    const ra = await newReply(t, a, "resposta da a", rb.id);
    as(b);
    expect(await (await r.reply.DELETE(req("DELETE"), rctx(t, rb.id))).json()).toEqual({ result: "soft" });
    as(a);
    expect(await (await r.reply.DELETE(req("DELETE"), rctx(t, ra.id))).json()).toEqual({ result: "deleted" });
    expect(await (await r.one.DELETE(req("DELETE"), ctx(t))).json()).toEqual({ result: "soft" });
    as(b);
    const got = await (await r.one.GET(req("GET"), ctx(t))).json();
    expect(got.topic).toMatchObject({ deleted: true, body: "", author: null, title: "[apagado]" });
    expect(got.replies[0]).toMatchObject({ deleted: true, body: "", author: null, children: [] });
  });

  it("autor edita a própria resposta; outro leva 403", async () => {
    const r = await routes();
    const c = await community("tp-edit");
    const [a, b] = [await member(), await member()];
    await join(c, a);
    await join(c, b);
    const t = await newTopic("tp-edit", a);
    const rb = await newReply(t, b, "texto com erro");
    as(a);
    expect((await r.reply.PATCH(req("PATCH", { body: "mudei" }), rctx(t, rb.id))).status).toBe(403);
    as(b);
    const res = await (await r.reply.PATCH(req("PATCH", { body: "texto certo" }), rctx(t, rb.id))).json();
    expect(res.reply).toMatchObject({ body: "texto certo", mine: true });
    expect(res.reply.editedAt).toBeTruthy();
  });
});

describe("denúncia", () => {
  it("tópico e resposta vão pra fila da comunidade e quem denuncia bloqueia o autor", async () => {
    const r = await routes();
    const c = await community("tp-report");
    const [dono, a, b] = [await member(), await member(), await member()];
    await join(c, dono, "dono");
    await join(c, a);
    await join(c, b);
    const t = await newTopic("tp-report", a, { title: "Tópico denunciável", body: "spam spam" });
    const rep = await newReply(t, a, "resposta denunciável");
    as(b);
    let res = await r.reports.POST(req("POST", { targetType: "topic", targetId: String(t), reason: "spam ou propaganda" }));
    expect(res.status).toBe(201);
    expect((await res.json()).blocked).toBe(a.username);
    await db.prepare("DELETE FROM member_blocks").run();
    res = await r.reports.POST(req("POST", { targetType: "topic_reply", targetId: String(rep.id), reason: "spam ou propaganda" }));
    expect(res.status).toBe(201);
    const rows = await db
      .prepare(`SELECT "targetType", "communityId", snapshot FROM reports WHERE "reporterId" = ? ORDER BY id`)
      .all<{ targetType: string; communityId: number; snapshot: string }>(b.id);
    expect(rows).toEqual([
      { targetType: "topic", communityId: c, snapshot: `@${a.username}: Tópico denunciável\nspam spam` },
      { targetType: "topic_reply", communityId: c, snapshot: `@${a.username}: resposta denunciável` },
    ]);
    as(dono);
    const fila = await (await r.reports.GET(new Request(`http://t/?comunidade=tp-report`))).json();
    const hrefs = (fila.reports as { href: string }[]).map((x) => x.href).sort();
    expect(hrefs).toEqual([`/comunidade/tp-report/t/${t}`, `/comunidade/tp-report/t/${t}#r-${rep.id}`].sort());
  });
});

describe("LGPD", () => {
  it("excluir a conta: conteúdo com resposta de outra pessoa vira [apagado], o resto some, votos saem e o score é refeito", async () => {
    const c = await community("tp-lgpd");
    const [ana, bia] = [await member(), await member()];
    await join(c, ana);
    await join(c, bia);
    const comConversa = await newTopic("tp-lgpd", ana, { title: "Tópico da Ana", body: "dados da Ana", flair: "pessoal" });
    const semConversa = await newTopic("tp-lgpd", ana, { title: "Tópico sozinho" });
    const daBia = await newTopic("tp-lgpd", bia, { title: "Tópico da Bia", kind: "enquete", options: ["sim", "não"] });
    const rb = await newReply(comConversa, bia, "resposta da Bia");
    const raPai = await newReply(daBia, ana, "Ana com filha");
    await newReply(daBia, bia, "filha da Bia", raPai.id);
    const raSolta = await newReply(daBia, ana, "Ana sem filha");
    const r = await routes();
    as(ana);
    await r.vote.POST(req("POST", { value: 1 }), ctx(daBia));
    await r.replyVote.POST(req("POST", { value: -1 }), rctx(comConversa, rb.id));
    const opt = (await db.prepare("SELECT id FROM topic_poll_options WHERE topicId = ? ORDER BY position LIMIT 1").get<{ id: number }>(daBia))!.id;
    await r.poll.POST(req("POST", { optionId: opt }), ctx(daBia));
    expect(await scoreOf(daBia)).toBe(1);

    const exp = await exportMemberData(ana.id);
    expect(Object.keys(exp!.data)).toEqual(expect.arrayContaining(["community_topics.memberId", "topic_replies.memberId", "topic_votes.memberId"]));

    await deleteMemberData(ana.id);
    const t1 = await db.prepare("SELECT title, body, flair, memberId, deletedAt FROM community_topics WHERE id = ?").get<Record<string, unknown>>(comConversa);
    expect(t1).toMatchObject({ title: "[apagado]", body: "", flair: null, memberId: null });
    expect(t1!.deletedAt).toBeTruthy();
    expect(await db.prepare("SELECT id FROM community_topics WHERE id = ?").get(semConversa)).toBeUndefined();
    const pai = await db.prepare("SELECT body, memberId, deletedAt FROM topic_replies WHERE id = ?").get<Record<string, unknown>>(raPai.id);
    expect(pai).toMatchObject({ body: "", memberId: null });
    expect(await db.prepare("SELECT id FROM topic_replies WHERE id = ?").get(raSolta.id)).toBeUndefined();
    expect(await scoreOf(daBia)).toBe(0);
    expect((await db.prepare("SELECT score FROM topic_replies WHERE id = ?").get<{ score: number }>(rb.id))!.score).toBe(0);
    expect((await db.prepare("SELECT COUNT(*)::int AS n FROM topic_poll_votes WHERE memberId = ?").get<{ n: number }>(ana.id))!.n).toBe(0);
    expect((await db.prepare("SELECT replyCount FROM community_topics WHERE id = ?").get<{ replyCount: number }>(daBia))!.replyCount).toBe(1);
    // a conversa da Bia continua de pé
    as(bia);
    const got = await (await r.one.GET(req("GET"), ctx(comConversa))).json();
    expect(got.replies[0].body).toBe("resposta da Bia");
  });
});
