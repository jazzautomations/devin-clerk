import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createPost, listPosts, toggleLike } from "@/lib/posts";
import {
  getRegistrationIds,
  register,
  unregister,
} from "@/lib/registrations";

async function makeMember(clerkId: string): Promise<number> {
  await db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    await db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

describe("registrations", () => {
  it("register é idempotente e unregister remove", async () => {
    const m = await makeMember("r1");
    await register(m, "hack-inova-alphaville-2026");
    await register(m, "hack-inova-alphaville-2026");
    expect(await getRegistrationIds(m)).toEqual(["hack-inova-alphaville-2026"]);
    await unregister(m, "hack-inova-alphaville-2026");
    expect(await getRegistrationIds(m)).toEqual([]);
  });
});

describe("posts", () => {
  it("cria post com link http(s) e rejeita esquema inválido", async () => {
    const m = await makeMember("p1");
    const post = await createPost(m, "fiz uma demo", "https://demo.dev/x");
    expect(post.link).toBe("https://demo.dev/x");
    await expect(createPost(m, "x", "javascript:alert(1)")).rejects.toThrow();
    await expect(createPost(m, "   ")).rejects.toThrow();
  });

  it("like é toggle e likedByMe reflete o autor do like", async () => {
    const a = await makeMember("p2");
    const b = await makeMember("p3");
    const post = await createPost(a, "demo");
    expect(await toggleLike(post.id, b)).toBe(true);
    let feed = await listPosts(10, b);
    expect(feed.find((p) => p.id === post.id)?.likedByMe).toBe(true);
    expect(feed.find((p) => p.id === post.id)?.likeCount).toBe(1);
    expect(await toggleLike(post.id, b)).toBe(false);
    feed = await listPosts(10, b);
    expect(feed.find((p) => p.id === post.id)?.likeCount).toBe(0);
  });

  it("post carrega xp do autor pra chip LV", async () => {
    const a = await makeMember("p4");
    await db.prepare("UPDATE members SET xp = 50 WHERE id = ?").run(a);
    const post = await createPost(a, "demo");
    expect(post.xp).toBe(50);
  });
});
