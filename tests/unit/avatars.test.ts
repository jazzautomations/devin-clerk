import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { getOrCreateMember } from "@/lib/members";
import { createPost, listPosts } from "@/lib/posts";
import { createComment, listComments } from "@/lib/comments";
import { getRegistrationsByHackathon, register } from "@/lib/registrations";
import { listTalent, setOpenTo } from "@/lib/talent";
import { initialsFor } from "@/components/Avatar";

// spec 020 — avatarUrl vem do Clerk (user.imageUrl), sincronizado a cada
// materialização do membro; nunca editável pela plataforma.

const IMG_A = "https://img.clerk.com/avatar-a.png";
const IMG_B = "https://img.clerk.com/avatar-b.png";

function clerkUser(
  id: string,
  imageUrl?: string | null,
): Parameters<typeof getOrCreateMember>[0] {
  return {
    id,
    firstName: "Ada",
    lastName: "L",
    email: `${id}@t.dev`,
    imageUrl: imageUrl ?? null,
  };
}

function makeMember(clerkId: string): number {
  db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

describe("avatars — sync do Clerk no getOrCreateMember", () => {
  it("grava avatarUrl do imageUrl na criação", () => {
    const m = getOrCreateMember(clerkUser("av1", IMG_A));
    expect(m.avatarUrl).toBe(IMG_A);
  });

  it("cria com avatarUrl nulo quando Clerk não tem foto", () => {
    const m = getOrCreateMember(clerkUser("av2"));
    expect(m.avatarUrl).toBeNull();
  });

  it("atualiza avatarUrl quando imageUrl muda", () => {
    getOrCreateMember(clerkUser("av3", IMG_A));
    const m = getOrCreateMember(clerkUser("av3", IMG_B));
    expect(m.avatarUrl).toBe(IMG_B);
    const stored = db
      .prepare("SELECT avatarUrl FROM members WHERE clerkId = 'av3'")
      .get() as { avatarUrl: string | null };
    expect(stored.avatarUrl).toBe(IMG_B);
  });

  it("preenche avatarUrl tardio — membro antigo sem foto", () => {
    getOrCreateMember(clerkUser("av4"));
    const m = getOrCreateMember(clerkUser("av4", IMG_A));
    expect(m.avatarUrl).toBe(IMG_A);
  });

  it("imageUrl nulo não apaga avatar gravado", () => {
    getOrCreateMember(clerkUser("av5", IMG_A));
    const m = getOrCreateMember(clerkUser("av5", null));
    expect(m.avatarUrl).toBe(IMG_A);
  });
});

describe("avatars — joins expõem avatarUrl", () => {
  it("listPosts retorna avatarUrl do autor", () => {
    const id = makeMember("av6");
    db.prepare("UPDATE members SET avatarUrl = ? WHERE id = ?").run(IMG_A, id);
    const post = createPost(id, "post com avatar");
    expect(post.avatarUrl).toBe(IMG_A);
    const found = listPosts(10).find((p) => p.id === post.id);
    expect(found?.avatarUrl).toBe(IMG_A);
  });

  it("listPosts retorna avatarUrl nulo pra membro sem foto", () => {
    const id = makeMember("av7");
    const post = createPost(id, "post sem avatar");
    expect(post.avatarUrl).toBeNull();
  });

  it("listComments retorna avatarUrl do autor", () => {
    const a = makeMember("av8");
    const b = makeMember("av9");
    db.prepare("UPDATE members SET avatarUrl = ? WHERE id = ?").run(IMG_B, b);
    const post = createPost(a, "alvo");
    const c = createComment(post.id, b, "com cara");
    expect(c.avatarUrl).toBe(IMG_B);
    expect(listComments(post.id)[0].avatarUrl).toBe(IMG_B);
  });

  it("getRegistrationsByHackathon retorna avatarUrl do inscrito", () => {
    const id = makeMember("av10");
    db.prepare("UPDATE members SET avatarUrl = ? WHERE id = ?").run(IMG_A, id);
    register(id, "hack-inova-unifacens-2026");
    const r = getRegistrationsByHackathon("hack-inova-unifacens-2026").find(
      (x) => x.username === "u_av10",
    );
    expect(r?.avatarUrl).toBe(IMG_A);
  });

  it("listTalent retorna avatarUrl de quem tá open to", () => {
    const id = makeMember("av11");
    db.prepare("UPDATE members SET avatarUrl = ? WHERE id = ?").run(IMG_B, id);
    setOpenTo(id, ["trampo"]);
    const t = listTalent(100).find((x) => x.username === "u_av11");
    expect(t?.avatarUrl).toBe(IMG_B);
  });
});

describe("avatars — initialsFor (fallback)", () => {
  it("duas palavras do nome viram duas iniciais", () => {
    expect(initialsFor("Ada Lovelace", "ada")).toBe("AL");
  });

  it("nome de uma palavra cai pros 2 primeiros chars", () => {
    expect(initialsFor("Madonna", "mad")).toBe("MA");
  });

  it("sem nome usa o username e limpa símbolos", () => {
    expect(initialsFor(null, "ada_lovelace")).toBe("AD");
    expect(initialsFor(null, "@x")).toBe("X");
  });

  it("vazio total vira '?'", () => {
    expect(initialsFor(null, "")).toBe("?");
    expect(initialsFor("   ", "---")).toBe("?");
  });
});
