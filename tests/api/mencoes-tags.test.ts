import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block, mute } from "@/lib/blocks";
import { createComment, listComments, updateComment } from "@/lib/comments";
import { deleteMemberData } from "@/lib/privacy";
import { createPost, deletePost, hydratePosts, updatePost } from "@/lib/posts";
import { resetRateLimits } from "@/lib/ratelimit";
import { hackathonsByTag, peopleBySkill, postIdsByTag, sqlTechTag } from "@/lib/tags";

// Menções @ e tags # (spec 046, onda 2, migration 039). Um bloco por item do
// aceite: notificação uma vez por menção, edição que não repete o aviso, @ que
// não existe ou que bloqueou o autor (não vira link nem aviso), #NextJS e
// #next.js na mesma tag, o sexto @ fora do limite, autocomplete (401/400/429,
// bloqueio e prioridade de quem eu sigo) e a página da tag juntando post,
// projeto, pessoa e hackathon.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string; role: string };
async function member(fields: { username?: string; skills?: string[]; role?: string } = {}): Promise<M> {
  const tag = `mt${seq++}`;
  const username = fields.username ?? `u_${tag}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, skills, role) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(
      `clerk_${tag}`,
      username,
      `${tag}@t.dev`,
      `Pessoa ${tag}`,
      JSON.stringify(fields.skills ?? []),
      fields.role ?? "member",
    );
  return { id: row!.id, clerkId: `clerk_${tag}`, username, role: fields.role ?? "member" };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};

const notes = (memberId: number) =>
  db
    .prepare("SELECT type, text, href, actorId FROM notifications WHERE memberId = ? ORDER BY id")
    .all<{ type: string; text: string; href: string; actorId: number }>(memberId);
const mentionRows = (postId: number) =>
  db
    .prepare(`SELECT "memberId", "commentId" FROM post_mentions WHERE "postId" = ? ORDER BY "memberId"`)
    .all<{ memberId: number; commentId: number | null }>(postId);
const tagRows = (postId: number) =>
  db.prepare(`SELECT tag FROM post_tags WHERE "postId" = ? ORDER BY tag`).all<{ tag: string }>(postId);

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("menção", () => {
  it("post com @ avisa uma vez, vira link e grava a menção", async () => {
    const a = await member();
    const b = await member();
    const post = await createPost(a.id, `oi @${b.username}, olha a demo`);
    const rows = await mentionRows(post.id);
    expect(rows).toEqual([{ memberId: b.id, commentId: null }]);
    expect(post.mentionedUsernames).toEqual([b.username]);
    const n = await notes(b.id);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      type: "mention",
      text: `@${a.username} mencionou você`,
      href: `/post/${post.id}`,
      actorId: a.id,
    });
    // o autor não é avisado de si mesmo
    expect(await notes(a.id)).toHaveLength(0);
  });

  it("editar não avisa de novo, nem tirando e pondo o @ de volta", async () => {
    const a = await member();
    const b = await member();
    const post = await createPost(a.id, `oi @${b.username}`);
    await updatePost(post.id, a, { body: `oi @${b.username}, corrigido` });
    expect(await notes(b.id)).toHaveLength(1);
    // some com a menção: a linha sai do índice
    await updatePost(post.id, a, { body: "sem menção agora" });
    expect(await mentionRows(post.id)).toEqual([]);
    expect((await notes(b.id)).length).toBe(1);
    // volta com ela: aviso continua sendo um só
    await updatePost(post.id, a, { body: `voltei @${b.username}` });
    expect(await mentionRows(post.id)).toEqual([{ memberId: b.id, commentId: null }]);
    expect(await notes(b.id)).toHaveLength(1);
  });

  it("@ de quem não existe não vira link nem aviso", async () => {
    const a = await member();
    const post = await createPost(a.id, "oi @ninguem_aqui_nessa_rede");
    expect(post.mentionedUsernames).toEqual([]);
    expect(await mentionRows(post.id)).toEqual([]);
  });

  it("menção a quem bloqueou o autor não é gravada nem avisa", async () => {
    const a = await member();
    const b = await member();
    await block(b.id, a.id);
    const post = await createPost(a.id, `oi @${b.username}`);
    expect(await mentionRows(post.id)).toEqual([]);
    expect(post.mentionedUsernames).toEqual([]);
    expect(await notes(b.id)).toHaveLength(0);
    // bloqueio do próprio autor também vale
    const c = await member();
    await block(a.id, c.id);
    const outro = await createPost(a.id, `oi @${c.username}`);
    expect(await mentionRows(outro.id)).toEqual([]);
    expect(await notes(c.id)).toHaveLength(0);
  });

  it("o sexto @ do mesmo post não notifica", async () => {
    const a = await member();
    const people = await Promise.all([1, 2, 3, 4, 5, 6].map(() => member()));
    const body = people.map((p) => `@${p.username}`).join(" ");
    const post = await createPost(a.id, body);
    expect(await mentionRows(post.id)).toHaveLength(5);
    for (const [i, p] of people.entries()) {
      expect((await notes(p.id)).length, `pessoa ${i + 1}`).toBe(i < 5 ? 1 : 0);
    }
  });

  it("comentário menciona e leva direto pro comentário", async () => {
    const a = await member();
    const b = await member();
    const post = await createPost(a.id, "post sem menção");
    const c = await createComment(post.id, a.id, `@${b.username} o que achou?`);
    expect(c.mentionedUsernames).toEqual([b.username]);
    const n = await notes(b.id);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ type: "mention", href: `/post/${post.id}#c-${c.id}` });
    // a lista da conversa também traz quem existe (vira link na tela)
    const list = await listComments(post.id, b.id);
    expect(list[0].mentionedUsernames).toEqual([b.username]);
    // editar o comentário não repete o aviso
    await updateComment(c.id, a.id, `@${b.username} o que achou, de verdade?`);
    expect(await notes(b.id)).toHaveLength(1);
  });

  it("menção de comentário a quem bloqueou não é gravada", async () => {
    const a = await member();
    const b = await member();
    const post = await createPost(a.id, "post");
    await block(b.id, a.id);
    const c = await createComment(post.id, a.id, `oi @${b.username}`);
    expect(c.mentionedUsernames).toEqual([]);
    expect(await mentionRows(post.id)).toEqual([]);
  });

  it("silenciado continua mencionado e não é avisado (o aviso é social)", async () => {
    const a = await member();
    const b = await member();
    await mute(b.id, a.id);
    const post = await createPost(a.id, `oi @${b.username}`);
    expect(post.mentionedUsernames).toEqual([b.username]);
    expect(await notes(b.id)).toHaveLength(0);
  });

  it("excluir a conta e apagar o post levam as menções junto", async () => {
    const a = await member();
    const b = await member();
    const post = await createPost(a.id, `oi @${b.username}`);
    await deleteMemberData(b.id);
    expect(await mentionRows(post.id)).toEqual([]);
    const outro = await member();
    const p2 = await createPost(a.id, `oi @${outro.username}`);
    expect(await mentionRows(p2.id)).toHaveLength(1);
    await deletePost(p2.id, a);
    expect(await mentionRows(p2.id)).toEqual([]);
  });
});

describe("tag", () => {
  it("#NextJS e #next.js caem na mesma tag e a página acha os dois posts", async () => {
    const a = await member();
    const um = await createPost(a.id, "primeiro com #NextJS");
    const dois = await createPost(a.id, "segundo com #next.js");
    expect((await tagRows(um.id)).map((r) => r.tag)).toEqual(["nextjs"]);
    expect((await tagRows(dois.id)).map((r) => r.tag)).toEqual(["nextjs"]);
    const found = await postIdsByTag("nextjs", a.id);
    expect(found.map((p) => p.id)).toEqual([dois.id, um.id]);
    // a forma canônica é a mesma: /tag/Next.js acha o mesmo
    expect((await postIdsByTag("Next.js", a.id)).map((p) => p.id)).toEqual([dois.id, um.id]);
    // cursor
    expect((await postIdsByTag("nextjs", a.id, um.id)).map((p) => p.id)).toEqual([]);
  });

  it("editar o post reescreve as tags (a que saiu não fica)", async () => {
    const a = await member();
    const post = await createPost(a.id, "#react e #ia");
    expect((await tagRows(post.id)).map((r) => r.tag)).toEqual(["ia", "react"]);
    await updatePost(post.id, a, { body: "#react só" });
    expect((await tagRows(post.id)).map((r) => r.tag)).toEqual(["react"]);
    expect(await postIdsByTag("ia", a.id)).toEqual([]);
  });

  it("tag de comentário não entra no índice do post", async () => {
    const a = await member();
    const post = await createPost(a.id, "sem tag no corpo");
    await createComment(post.id, a.id, "comentário com #ia");
    expect(await tagRows(post.id)).toEqual([]);
  });

  it("post de autor bloqueado some da tag e a tag vazia devolve nada", async () => {
    const a = await member();
    const b = await member();
    const post = await createPost(b.id, "post do bloqueado #ia");
    expect((await postIdsByTag("ia", a.id)).map((p) => p.id)).toEqual([post.id]);
    await block(a.id, b.id);
    expect(await postIdsByTag("ia", a.id)).toEqual([]);
    expect(await postIdsByTag("tagquenaoexiste", a.id)).toEqual([]);
  });

  it("pessoas com a skill na tag: Next.js casa com #nextjs, no SQL", async () => {
    const a = await member();
    const dev = await member({ skills: ["Next.js", "Postgres"] });
    const outro = await member({ skills: ["Figma"] });
    await member({ skills: [] });
    const found = await peopleBySkill("nextjs", a.id);
    expect(found.map((p) => p.username)).toEqual([dev.username]);
    expect(found.some((p) => p.username === outro.username)).toBe(false);
    // o SQL normaliza como normalizeTech (apelido incluso)
    const sql = await db.prepare(`SELECT ${sqlTechTag("'Next.js'")} AS t`).get<{ t: string }>();
    expect(sql!.t).toBe("nextjs");
    const acento = await db
      .prepare(`SELECT ${sqlTechTag("'Visão  Computacional'")} AS t`)
      .get<{ t: string }>();
    expect(acento!.t).toBe("visao-computacional");
  });

  it("pessoas excluídas e bloqueadas ficam fora da tag", async () => {
    const a = await member();
    const dev = await member({ skills: ["Rust"] });
    await block(a.id, dev.id);
    expect(await peopleBySkill("rust", a.id)).toEqual([]);
    const gone = await member({ skills: ["Rust"] });
    await deleteMemberData(gone.id);
    expect((await peopleBySkill("rust", a.id)).map((p) => p.username)).not.toContain(gone.username);
  });

  it("hackathons abertos com a tag", async () => {
    const id = `h-tags-${seq++}`;
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
         VALUES (?, 'Hack da Tag', 'Org', '2030-12-01 09:00:00', 'online', 'https://exemplo.dev', ?, 1, 'painel')`,
      )
      .run(id, JSON.stringify(["IA", "saúde"]));
    const found = await hackathonsByTag("ia");
    expect(found.map((h) => h.id)).toContain(id);
    expect((await hackathonsByTag("saude")).map((h) => h.id)).toContain(id);
    expect((await hackathonsByTag("blockchain")).map((h) => h.id)).not.toContain(id);
  });

  it("hydratePosts devolve mentionedUsernames só de quem o leitor vê", async () => {
    const a = await member();
    const b = await member();
    const post = await createPost(a.id, `oi @${b.username}`);
    const [mine] = await hydratePosts([post.id], a.id);
    expect(mine.mentionedUsernames).toEqual([b.username]);
    await block(a.id, b.id);
    const [depois] = await hydratePosts([post.id], a.id);
    expect(depois.mentionedUsernames).toEqual([]);
  });
});

describe("autocomplete de @", () => {
  const route = () => import("@/app/api/members/suggest/route");
  const get = async (qs: string) => (await route()).GET(new Request(`http://t/api/members/suggest?${qs}`));

  it("deslogado é 401 JSON", async () => {
    const res = await get("q=ana");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("q curto é 400 e quem eu sigo vem primeiro", async () => {
    const me = await member();
    as(me);
    expect((await get("q=a")).status).toBe(400);
    expect((await get("q=")).status).toBe(400);
    const seguido = await member({ username: `zz_seguido_${seq++}` });
    const outro = await member({ username: `zz_outro_${seq++}` });
    await db
      .prepare("INSERT INTO member_follows (memberId, followedId) VALUES (?, ?)")
      .run(me.id, seguido.id);
    const res = await get(`q=zz_`);
    expect(res.status).toBe(200);
    const { people } = (await res.json()) as { people: { username: string; name: string | null; avatarUrl: string | null }[] };
    const usernames = people.map((p) => p.username);
    expect(usernames).toContain(seguido.username);
    expect(usernames).toContain(outro.username);
    expect(usernames.indexOf(seguido.username)).toBeLessThan(usernames.indexOf(outro.username));
    expect(Object.keys(people[0]).sort()).toEqual(["avatarUrl", "name", "username"]);
  });

  it("bloqueado (dois sentidos), silenciado e conta excluída ficam fora", async () => {
    const me = await member();
    as(me);
    const prefix = `qq${seq++}`;
    const livre = await member({ username: `${prefix}_livre` });
    const bloqueado = await member({ username: `${prefix}_bloq` });
    const mebloqueou = await member({ username: `${prefix}_mebloq` });
    const silenciado = await member({ username: `${prefix}_mudo` });
    const excluido = await member({ username: `${prefix}_fora` });
    await block(me.id, bloqueado.id);
    await block(mebloqueou.id, me.id);
    await mute(me.id, silenciado.id);
    await deleteMemberData(excluido.id);
    const { people } = (await (await get(`q=${prefix}`)).json()) as { people: { username: string }[] };
    const usernames = people.map((p) => p.username);
    expect(usernames).toEqual([livre.username]);
  });

  it("no máximo 8 e 429 depois de 120 consultas na hora", async () => {
    const me = await member();
    as(me);
    const prefix = `rr${seq++}`;
    for (let i = 0; i < 10; i++) await member({ username: `${prefix}_${i}` });
    const { people } = (await (await get(`q=${prefix}`)).json()) as { people: unknown[] };
    expect(people).toHaveLength(8);
    let last = 200;
    for (let i = 0; i < 130; i++) {
      const res = await get(`q=${prefix}`);
      last = res.status;
      if (last === 429) {
        expect(res.headers.get("retry-after")).toBeTruthy();
        break;
      }
    }
    expect(last).toBe(429);
  });
});
