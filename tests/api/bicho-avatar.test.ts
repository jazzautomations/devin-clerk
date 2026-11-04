import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { EVIDENCE_MIN_CHECKINS } from "@/lib/evidence";
import { getOrCreateMember } from "@/lib/members";
import { bichoDoMembro, estagioDoMembro, itemEstados, syncUnlocks, unlockedItems } from "@/lib/mascote/evolucao";
import { hashMascote } from "@/lib/mascote/isometrico";
import { pecaItem } from "@/lib/mascote/itens";
import { configFromSeed } from "@/lib/mascote/semente";
import { PADRAO } from "@/lib/mascote/validar";
import { createPost, listPosts } from "@/lib/posts";
import { deleteMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";
import type { MascoteConfig } from "@/lib/mascote/tipos";

// Bicho como avatar e evolução por fato (spec 046, onda 4, migration 047):
// quem entra sem foto nasce com o bicho, o login seguinte não sobrescreve, a
// troca muda o avatar em toda lista sem query nova, o fato destrava item e o
// like não destrava nada. Exclusão de conta volta ao padrão.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
  clerkClient: async () => ({ users: { deleteUser: vi.fn(async () => ({})) } }),
}));

const FOTO_A = "https://img.clerk.com/foto-a.png";
const FOTO_B = "https://img.clerk.com/foto-b.png";

let seq = 0;
async function member(extra: { avatarUrl?: string | null; clerkImageUrl?: string | null } = {}) {
  const tag = `bav${seq++}`;
  const row = await db
    .prepare(
      `INSERT INTO members (clerkId, username, email, name, avatarUrl, clerkImageUrl)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, extra.avatarUrl ?? null, extra.clerkImageUrl ?? null);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const meRoute = () => import("@/app/api/members/me/route");
const mascoteRoute = () => import("@/app/api/members/me/mascote/route");
const svgRoute = () => import("@/app/api/mascote/m/[id]/route");
const patch = (body: unknown) =>
  new Request("http://t/api/members/me", { method: "PATCH", body: JSON.stringify(body) });
const putMascote = (body: unknown) =>
  new Request("http://t/api/members/me/mascote", { method: "PUT", body: JSON.stringify(body) });

const row = async (id: number) =>
  (await db
    .prepare(`SELECT avatarKind, avatarUrl, clerkImageUrl, mascoteItens FROM members WHERE id = ?`)
    .get<{ avatarKind: string; avatarUrl: string | null; clerkImageUrl: string | null; mascoteItens: string | null }>(id))!;

const BICHO = /^\/api\/mascote\/m\/\d+\?e=(filhote|jovem|adulto)(&i=[a-z,]+)?&v=[0-9a-z]+$/;

const bom: MascoteConfig = { ...PADRAO, especie: "patinho", corPrincipal: "amarelo", nome: "Quack" };

/** edição elegível: roda no HackaHub, publicada e com 15 check-ins distintos */
async function eligibleEdition(id: string) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source, publishedAt)
       VALUES (?, 'Hack AV', 'Org', '2025-03-01T09:00:00-03:00', '2025-03-02T18:00:00-03:00', 'presencial', '', '[]', 1, 'painel', '2025-01-01 00:00:00')`,
    )
    .run(id);
  for (let i = 0; i < EVIDENCE_MIN_CHECKINS; i++) await checkin((await member()).id, id);
}
async function checkin(memberId: number, hackathonId: string) {
  const r = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
    .get<{ id: number }>(memberId, hackathonId);
  await db.prepare("INSERT INTO checkins (registrationId, at) VALUES (?, '2025-03-01 12:00:00')").run(r!.id);
}

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("nascimento e sync do Clerk", () => {
  it("membro novo sem foto real nasce com o bicho como avatar", async () => {
    const m = await getOrCreateMember({
      id: `clerk_novo_bicho_${seq}`,
      firstName: "Sem",
      lastName: "Foto",
      email: `semfoto${seq}@t.dev`,
      imageUrl: null,
      hasImage: false,
    });
    expect(m.avatarKind).toBe("bicho");
    expect(m.avatarUrl).toMatch(BICHO);
    // recém-nascido não tem fato: filhote, sem item
    expect(m.avatarUrl).toContain("e=filhote");
    expect((await row(m.id)).avatarUrl).toBe(m.avatarUrl);
  });

  it("com foto real continua com a foto", async () => {
    const m = await getOrCreateMember({
      id: `clerk_novo_foto_${seq}`,
      firstName: "Com",
      lastName: "Foto",
      email: `comfoto${seq}@t.dev`,
      imageUrl: FOTO_A,
      hasImage: true,
    });
    expect(m.avatarKind).toBe("foto");
    expect(m.avatarUrl).toBe(FOTO_A);
    expect(m.clerkImageUrl).toBe(FOTO_A);
  });

  it("sem hasImage (chamada antiga) mantém o comportamento anterior", async () => {
    const m = await getOrCreateMember({
      id: `clerk_antigo_${seq}`,
      firstName: "Anti",
      lastName: "Go",
      email: `antigo${seq}@t.dev`,
      imageUrl: null,
    });
    expect(m.avatarKind).toBe("foto");
    expect(m.avatarUrl).toBeNull();
  });

  it("o login seguinte não sobrescreve o bicho, mas atualiza a reserva da foto", async () => {
    const m = await member();
    as(m);
    expect((await (await meRoute()).PATCH(patch({ avatarKind: "bicho" }))).status).toBe(200);
    const comBicho = (await row(m.id)).avatarUrl!;
    expect(comBicho).toMatch(BICHO);

    // Clerk manda uma foto nova (e o e-mail é o mesmo membro)
    const again = await getOrCreateMember({
      id: m.clerkId,
      firstName: "Pessoa",
      lastName: "Teste",
      email: (await db.prepare("SELECT email FROM members WHERE id = ?").get<{ email: string }>(m.id))!.email,
      imageUrl: FOTO_B,
      hasImage: true,
    });
    expect(again.avatarKind).toBe("bicho");
    expect(again.avatarUrl).toBe(comBicho);
    expect((await row(m.id)).clerkImageUrl).toBe(FOTO_B);
  });
});

describe("PATCH /api/members/me avatarKind", () => {
  it("deslogado: 401 JSON", async () => {
    const res = await (await meRoute()).PATCH(patch({ avatarKind: "bicho" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("valor inválido: 400", async () => {
    const m = await member();
    as(m);
    const res = await (await meRoute()).PATCH(patch({ avatarKind: "voxel" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/foto ou bicho/);
  });

  it("bicho → foto volta pra foto do Clerk", async () => {
    const m = await member({ avatarUrl: FOTO_A, clerkImageUrl: FOTO_A });
    as(m);
    await (await meRoute()).PATCH(patch({ avatarKind: "bicho" }));
    expect((await row(m.id)).avatarUrl).toMatch(BICHO);
    const res = await (await meRoute()).PATCH(patch({ avatarKind: "foto" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ avatar: { avatarKind: "foto", avatarUrl: FOTO_A } });
    expect((await row(m.id)).avatarUrl).toBe(FOTO_A);
  });

  it("as listas leem o avatar novo sem query nova", async () => {
    const m = await member();
    as(m);
    const post = await createPost(m.id, "post do bicho");
    const antes = (await listPosts(50)).find((p) => p.id === post.id);
    expect(antes?.avatarUrl).toBeNull();

    await (await meRoute()).PATCH(patch({ avatarKind: "bicho" }));
    const depois = (await listPosts(50)).find((p) => p.id === post.id);
    expect(depois?.avatarUrl).toMatch(BICHO);
  });
});

describe("rota pública do SVG com estágio e itens", () => {
  const getSvg = async (id: string, q = "") =>
    (await svgRoute()).GET(new Request(`http://t/api/mascote/m/${id}${q}`), { params: Promise.resolve({ id }) });

  it("a URL do avatar abre o mesmo SVG, com cache imutável", async () => {
    const m = await member();
    as(m);
    await (await meRoute()).PATCH(patch({ avatarKind: "bicho" }));
    const url = (await row(m.id)).avatarUrl!;
    const q = url.slice(`/api/mascote/m/${m.id}`.length);
    const res = await getSvg(String(m.id), q);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const hash = new URL(`http://t${url}`).searchParams.get("v")!;
    expect(res.headers.get("ETag")).toBe(`"${hash}"`);
    expect((await res.text()).startsWith("<svg")).toBe(true);
  });

  it("item desconhecido e estágio inválido na URL são ignorados", async () => {
    const m = await member();
    const base = configFromSeed(m.id);
    const esperado = `"${hashMascote(base)}"`;
    const res = await getSvg(String(m.id), "?e=ovo&i=dragao,coroa&v=zzz");
    expect(res.headers.get("ETag")).toBe(esperado);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("o hash da URL do avatar casa com o do SVG (itens e estágio)", async () => {
    const m = await member();
    const config = configFromSeed(m.id);
    const itens = [pecaItem("cracha"), pecaItem("mochila")];
    const hash = hashMascote(config, { itens, estagio: "jovem" });
    const res = await getSvg(String(m.id), `?e=jovem&i=cracha,mochila&v=${hash}`);
    expect(res.headers.get("ETag")).toBe(`"${hash}"`);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });
});

describe("evolução por fato", () => {
  it("sem fato: filhote, nenhum item, sem item na lista", async () => {
    const m = await member();
    expect(await unlockedItems(m.id)).toEqual([]);
    expect(await estagioDoMembro(m.id)).toEqual({ estagio: "filhote", fatos: 0 });
    const estados = await itemEstados(m.id);
    expect(estados).toHaveLength(10);
    expect(estados.every((e) => !e.unlocked)).toBe(true);
    expect(estados[0].destrava).toMatch(/check-in/);
  });

  it("like e post não destravam nada", async () => {
    const autor = await member();
    const outro = await member();
    const post = await createPost(autor.id, "post curtido");
    const { toggleLike } = await import("@/lib/posts");
    await toggleLike(post.id, outro.id);
    await toggleLike(post.id, autor.id);
    expect(await unlockedItems(autor.id)).toEqual([]);
    expect(await unlockedItems(outro.id)).toEqual([]);
  });

  it("check-in em edição elegível destrava o crachá e sobe o estágio", async () => {
    await eligibleEdition("bav-ed-1");
    const m = await member();
    await checkin(m.id, "bav-ed-1");
    expect(await unlockedItems(m.id)).toEqual(["cracha"]);
    expect(await estagioDoMembro(m.id)).toEqual({ estagio: "jovem", fatos: 1 });
    const bicho = await bichoDoMembro(m.id);
    expect(bicho.itens).toEqual(["cracha"]);
    expect(bicho.pecas.map((p) => p.id)).toEqual(["cracha"]);
    expect(bicho.src).toContain("i=cracha");
  });

  it("syncUnlocks: 1 notificação, avatarUrl novo e a segunda passada não repete", async () => {
    await eligibleEdition("bav-ed-2");
    const m = await member();
    as(m);
    // primeiro o bicho como avatar (filhote, sem item), depois o fato
    await (await meRoute()).PATCH(patch({ avatarKind: "bicho" }));
    const antes = (await row(m.id)).avatarUrl!;
    expect(antes).toContain("e=filhote");
    await checkin(m.id, "bav-ed-2");

    const r1 = await syncUnlocks(m.id);
    expect(r1.novos).toEqual(["cracha"]);
    expect(r1.estagio).toBe("jovem");
    expect(r1.avatarAtualizado).toBe(true);
    const depois = (await row(m.id)).avatarUrl!;
    expect(depois).not.toBe(antes);
    expect(depois).toContain("e=jovem");
    expect(depois).toContain("i=cracha");

    const notifs = await db
      .prepare("SELECT text, href FROM notifications WHERE memberId = ? AND type = 'mascote_item'")
      .all<{ text: string; href: string }>(m.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].href).toBe("/perfil#bicho");
    expect(notifs[0].text).toMatch(/crach/i);
    expect(notifs[0].text).toMatch(/check-in/);

    const r2 = await syncUnlocks(m.id);
    expect(r2.novos).toEqual([]);
    expect(r2.avatarAtualizado).toBe(false);
    expect(
      (await db.prepare("SELECT COUNT(*)::int AS n FROM notifications WHERE memberId = ? AND type = 'mascote_item'").get<{ n: number }>(m.id))!.n,
    ).toBe(1);
  });

  it("quem usa a foto não tem o avatar mexido pelo sync", async () => {
    await eligibleEdition("bav-ed-3");
    const m = await member({ avatarUrl: FOTO_A, clerkImageUrl: FOTO_A });
    await checkin(m.id, "bav-ed-3");
    const r = await syncUnlocks(m.id);
    expect(r.novos).toEqual(["cracha"]);
    expect(r.avatarAtualizado).toBe(false);
    expect((await row(m.id)).avatarUrl).toBe(FOTO_A);
  });
});

describe("PUT /api/members/me/mascote com itens", () => {
  it("item travado: 400 e nada gravado", async () => {
    const m = await member();
    as(m);
    const res = await (await mascoteRoute()).PUT(putMascote({ config: bom, itens: ["mochila"] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/mochila/);
    expect(data.error).toMatch(/entregue um projeto/);
    expect((await row(m.id)).mascoteItens).toBeNull();
  });

  it("item destravado: grava, veste e regrava o avatarUrl de quem usa o bicho", async () => {
    await eligibleEdition("bav-ed-4");
    const m = await member();
    await checkin(m.id, "bav-ed-4");
    as(m);
    await (await meRoute()).PATCH(patch({ avatarKind: "bicho" }));
    const res = await (await mascoteRoute()).PUT(putMascote({ config: bom, itens: ["cracha"] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.itens).toEqual(["cracha"]);
    expect(data.avatarUrl).toContain("i=cracha");
    expect((await row(m.id)).mascoteItens).toBe('["cracha"]');
    expect(await bichoDoMembro(m.id)).toMatchObject({ escolhidos: ["cracha"], itens: ["cracha"] });
  });

  it("lista vazia volta pros itens mais recentes", async () => {
    await eligibleEdition("bav-ed-5");
    const m = await member();
    await checkin(m.id, "bav-ed-5");
    as(m);
    await (await mascoteRoute()).PUT(putMascote({ config: bom, itens: ["cracha"] }));
    const res = await (await mascoteRoute()).PUT(putMascote({ config: bom, itens: [] }));
    expect(res.status).toBe(200);
    expect((await row(m.id)).mascoteItens).toBeNull();
    expect((await bichoDoMembro(m.id)).itens).toEqual(["cracha"]);
  });
});

describe("LGPD", () => {
  it("excluir a conta zera avatarKind, clerkImageUrl e mascoteItens", async () => {
    const m = await member();
    as(m);
    await (await meRoute()).PATCH(patch({ avatarKind: "bicho" }));
    await (await mascoteRoute()).PUT(putMascote({ config: bom }));
    await deleteMemberData(m.id);
    expect(await row(m.id)).toEqual({
      avatarKind: "foto",
      avatarUrl: null,
      clerkImageUrl: null,
      mascoteItens: null,
    });
  });
});
