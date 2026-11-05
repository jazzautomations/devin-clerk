import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { atomFeed, escapeXml, FEED_CACHE_CONTROL, postEntry } from "@/lib/feeds";
import { decideAccess } from "@/lib/access";

// RSS/Atom aberto (rss-aberto): feed do perfil aberto, do diário do
// projeto e do mural da comunidade. Visibilidade (perfil fechado 404,
// projeto fora do arquivo 404, comunidade escondida 404), escopo (post de
// edição nunca entra no feed do perfil) e formato (Atom válido, rel
// alternate, cache). O XML é provado com o parser do próprio Postgres.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
async function member(publicProfile = 0) {
  const tag = `fd${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, \"publicProfile\") VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, publicProfile);
  return { id: row!.id, username: `u_${tag}` };
}
async function community(slug: string, hidden = 0) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name, hidden) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(slug, `Com ${slug}`, hidden);
  return { id: c!.id, slug };
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const uFeed = () => import("@/app/u/[username]/feed.xml/route");
const pFeed = () => import("@/app/p/[teamId]/feed.xml/route");
const cFeed = () => import("@/app/comunidade/[slug]/feed.xml/route");

/** Atom bem-formado? O parser do Postgres é o juiz (XML real, não regex) */
async function parses(xml: string): Promise<boolean> {
  const r = await db.prepare("SELECT xmlparse(document ?) IS NOT NULL AS ok").get<{ ok: boolean }>(xml);
  return !!r?.ok;
}

beforeEach(() => {
  vi.resetModules();
});

describe("/u/[username]/feed.xml", () => {
  it("perfil fechado dá 404; aberto devolve Atom com os posts globais", async () => {
    const fechado = await member(0);
    const aberto = await member(1);
    await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, 'post público de teste')").run(aberto.id);
    const { GET } = await uFeed();
    expect((await GET(new Request("http://t/u/x/feed.xml"), ctx({ username: fechado.username }))).status).toBe(404);
    const res = await GET(new Request("http://t/u/x/feed.xml"), ctx({ username: aberto.username }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/atom+xml");
    expect(res.headers.get("Cache-Control")).toBe(FEED_CACHE_CONTROL);
    const xml = await res.text();
    expect(await parses(xml)).toBe(true);
    expect(xml).toContain("post público de teste");
    expect(xml).toContain(`/u/${aberto.username}/feed.xml`);
  });

  it("post de edição, de comunidade, recado e repost nunca entram; diário do projeto entra", async () => {
    const m = await member(1);
    await db.prepare("INSERT INTO posts (memberId, body, \"hackathonId\") VALUES (?, 'no mural da edição', 'hack-inova-alphaville-2026')").run(m.id);
    const com = await community(`fd-com-${seq}`);
    await db.prepare("INSERT INTO posts (memberId, body, \"communityId\") VALUES (?, 'no mural da comunidade', ?)").run(m.id, com.id);
    await db.prepare("INSERT INTO posts (memberId, body, \"profileId\") VALUES (?, 'recado', ?)").run(m.id, m.id);
    const dela = await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, 'original alheio') RETURNING id").get<{ id: number }>(m.id);
    const outra = await member(1);
    await db.prepare("INSERT INTO posts (memberId, body, \"repostOfId\") VALUES (?, '', ?)").run(m.id, dela!.id);
    // diário: post com teamId (sem hackathonId/communityId)
    const team = await db.prepare("INSERT INTO teams (\"hackathonId\", name) VALUES ('hack-inova-alphaville-2026', 'Time Feed') RETURNING id").get<{ id: number }>();
    await db.prepare("INSERT INTO posts (memberId, body, \"teamId\") VALUES (?, 'atualização do diário', ?)").run(m.id, team!.id);
    const { GET } = await uFeed();
    const xml = await (await GET(new Request("http://t/u/x/feed.xml"), ctx({ username: m.username }))).text();
    expect(xml).not.toContain("no mural da edição");
    expect(xml).not.toContain("no mural da comunidade");
    expect(xml).not.toContain("recado");
    expect(xml).toContain("atualização do diário");
    expect(xml).toContain("original alheio"); // o post global dela entra
    expect(await parses(xml)).toBe(true);
    void outra;
  });

  it("conta excluída (canNetwork) dá 404", async () => {
    const m = await member(1);
    await db.prepare("UPDATE members SET \"clerkId\" = 'deleted:x' WHERE id = ?").run(m.id);
    const { GET } = await uFeed();
    expect((await GET(new Request("http://t/u/x/feed.xml"), ctx({ username: m.username }))).status).toBe(404);
  });
});

describe("/p/[teamId]/feed.xml", () => {
  it("inexistente e edição fora do ar dão 404; no arquivo aberto, o diário vira Atom", async () => {
    const m = await member();
    // edição legada (sem fluxo de entrega): arquivo aberto como as antigas;
    // edição fora do ar: mesmo com projeto não abre pra quem não tem conta
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, "startsAt", format, "registrationUrl", active, source)
         VALUES ('fd-legado', 'Hack Legado', 'T', '2020-01-01', 'presencial', 'https://t.dev', 1, 'seed'),
                ('fd-ar', 'Hack Fora', 'T', '2020-01-01', 'online', 'https://t.dev', 0, 'seed')
         ON CONFLICT (id) DO NOTHING`,
      )
      .run();
    const { createTeam } = await import("@/lib/archive");
    const aberto = (
      await createTeam("fd-legado", { name: "Time Aberto", placement: 0, memberUsernames: [m.username], project: { title: "Projeto Aberto" } })
    ).team.id;
    const foraDoAr = (
      await createTeam("fd-ar", { name: "Time Fora", placement: 0, memberUsernames: [m.username], project: { title: "Projeto Fora" } })
    ).team.id;
    await db.prepare('INSERT INTO posts ("memberId", body, "teamId") VALUES (?, ?, ?)').run(m.id, "diário público do projeto", aberto);
    const { GET } = await pFeed();
    expect((await GET(new Request("http://t/p/x/feed.xml"), ctx({ teamId: "9999" }))).status).toBe(404);
    expect((await GET(new Request("http://t/p/x/feed.xml"), ctx({ teamId: "abc" }))).status).toBe(404);
    expect((await GET(new Request("http://t/p/x/feed.xml"), ctx({ teamId: String(foraDoAr) }))).status).toBe(404);
    const res = await GET(new Request("http://t/p/x/feed.xml"), ctx({ teamId: String(aberto) }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("diário público do projeto");
    expect(xml).toContain(`/p/${aberto}/feed.xml`);
    expect(await parses(xml)).toBe(true);
  });
});

describe("/comunidade/[slug]/feed.xml", () => {
  it("mural vira Atom com posts de todos os espaços; escondida e excluída dão 404", async () => {
    const m = await member();
    const c = await community(`fd-c1-${seq}`);
    const escondida = await community(`fd-c2-${seq}`, 1);
    const excluida = await community(`fd-c3-${seq}`);
    await db.prepare("UPDATE communities SET \"deletedAt\" = sqlite_now() WHERE id = ?").run(excluida.id);
    const geral = await db.prepare("SELECT id FROM community_spaces WHERE \"communityId\" = ? AND slug = 'geral'").get<{ id: number }>(c.id);
    const ajuda = await db.prepare("SELECT id FROM community_spaces WHERE \"communityId\" = ? AND slug = 'ajuda'").get<{ id: number }>(c.id);
    await db.prepare("INSERT INTO posts (memberId, body, \"communityId\", \"spaceId\") VALUES (?, 'post do geral feed', ?, ?)").run(m.id, c.id, geral!.id);
    await db.prepare("INSERT INTO posts (memberId, body, \"communityId\", \"spaceId\") VALUES (?, 'post da ajuda feed', ?, ?)").run(m.id, c.id, ajuda!.id);
    const { GET } = await cFeed();
    const res = await GET(new Request("http://t/comunidade/x/feed.xml"), ctx({ slug: c.slug }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("post do geral feed");
    expect(xml).toContain("post da ajuda feed");
    expect(await parses(xml)).toBe(true);
    expect((await GET(new Request("http://t/x"), ctx({ slug: escondida.slug }))).status).toBe(404);
    expect((await GET(new Request("http://t/x"), ctx({ slug: excluida.slug }))).status).toBe(404);
    expect((await GET(new Request("http://t/x"), ctx({ slug: "nao-existe" }))).status).toBe(404);
  });
});

describe("formato e acesso", () => {
  it("escapeXml escapa os cinco e limpa controle", () => {
    expect(escapeXml(`a<b>&"'"`)).toBe("a&lt;b&gt;&amp;&quot;&apos;&quot;");
    expect(escapeXml("a\x00b\x0Bc")).toBe("abc");
  });

  it("atomFeed monta o documento com os campos certos", async () => {
    const xml = atomFeed({
      title: "T <feed>",
      pageUrl: "https://t.dev/pagina",
      selfUrl: "https://t.dev/feed.xml",
      entries: [
        {
          id: "https://t.dev/post/1",
          title: "título",
          link: "https://t.dev/post/1",
          published: "2026-01-01T00:00:00Z",
          updated: "2026-01-01T00:00:00Z",
          content: "corpo & tal",
          author: "@x",
        },
      ],
    });
    expect(await parses(xml)).toBe(true);
    expect(xml).toContain("<title>T &lt;feed&gt;</title>");
    expect(xml).toContain("corpo &amp; tal");
    expect(xml).toContain('xmlns="http://www.w3.org/2005/Atom"');
    expect(xml).toContain('rel="self"');
  });

  it("postEntry: título da primeira linha, link pro /post e texto puro", () => {
    const e = postEntry({
      id: 42,
      body: "primeira linha do post\nsegunda linha",
      link: "https://demo.dev",
      createdAt: "2026-01-02 03:04:05",
      editedAt: null,
      username: "marina",
    } as never);
    expect(e.title).toBe("primeira linha do post");
    expect(e.link).toContain("/post/42");
    expect(e.published).toBe("2026-01-02T03:04:05Z");
    expect(e.content).toBe("primeira linha do post\nsegunda linha\n\nhttps://demo.dev");
  });

  it("feed.xml está na allowlist pública (leitor de feed não loga)", () => {
    const anon = { signedIn: false, onboarded: false };
    expect(decideAccess("/u/marina/feed.xml", anon)).toBe("next");
    expect(decideAccess("/p/12/feed.xml", anon)).toBe("next");
    expect(decideAccess("/comunidade/hack-inova/feed.xml", anon)).toBe("next");
  });
});
