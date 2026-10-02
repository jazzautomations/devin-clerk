import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createPost, listPosts, toggleLike } from "@/lib/posts";
import {
  getRegistrationIds,
  register,
  unregister,
} from "@/lib/registrations";

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

describe("registrations", () => {
  it("register é idempotente e unregister remove", () => {
    const m = makeMember("r1");
    register(m, "hack-inova-alphaville-2026");
    register(m, "hack-inova-alphaville-2026");
    expect(getRegistrationIds(m)).toEqual(["hack-inova-alphaville-2026"]);
    unregister(m, "hack-inova-alphaville-2026");
    expect(getRegistrationIds(m)).toEqual([]);
  });
});

describe("posts", () => {
  it("cria post com link http(s) e rejeita esquema inválido", () => {
    const m = makeMember("p1");
    const post = createPost(m, "fiz uma demo", "https://demo.dev/x");
    expect(post.link).toBe("https://demo.dev/x");
    expect(() => createPost(m, "x", "javascript:alert(1)")).toThrow();
    expect(() => createPost(m, "   ")).toThrow();
  });

  it("like é toggle e likedByMe reflete o autor do like", () => {
    const a = makeMember("p2");
    const b = makeMember("p3");
    const post = createPost(a, "demo");
    expect(toggleLike(post.id, b)).toBe(true);
    let feed = listPosts(10, b);
    expect(feed.find((p) => p.id === post.id)?.likedByMe).toBe(true);
    expect(feed.find((p) => p.id === post.id)?.likeCount).toBe(1);
    expect(toggleLike(post.id, b)).toBe(false);
    feed = listPosts(10, b);
    expect(feed.find((p) => p.id === post.id)?.likeCount).toBe(0);
  });

  it("post carrega xp do autor pra chip LV", () => {
    const a = makeMember("p4");
    db.prepare("UPDATE members SET xp = 50 WHERE id = ?").run(a);
    const post = createPost(a, "demo");
    expect(post.xp).toBe(50);
  });
});
