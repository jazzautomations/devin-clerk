import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

const authMock = vi.fn(async () => ({ userId: "clerk_priv_api" as string | null }));
const deleteUser = vi.fn(async () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  clerkClient: async () => ({ users: { deleteUser } }),
}));

describe("API de privacidade", () => {
  it("export e exclusão exigem login (401)", async () => {
    authMock.mockResolvedValueOnce({ userId: null }).mockResolvedValueOnce({ userId: null });
    const { GET } = await import("@/app/api/members/me/export/route");
    const { DELETE } = await import("@/app/api/members/me/route");
    expect((await GET(new Request("http://t"))).status).toBe(401);
    expect((await DELETE(new Request("http://t", { method: "DELETE" }))).status).toBe(401);
  });

  it("export baixa JSON; exclusão sem confirmação 400, com confirmação anonimiza e apaga no Clerk", async () => {
    await db
      .prepare("INSERT INTO members (clerkId, username, email, name) VALUES ('clerk_priv_api', 'privapi', 'p@api.dev', 'Priv')")
      .run();
    const { GET } = await import("@/app/api/members/me/export/route");
    const res = await GET(new Request("http://t"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("hackahub-privapi.json");
    expect((await res.json()).member.username).toBe("privapi");

    const { DELETE } = await import("@/app/api/members/me/route");
    const bad = await DELETE(new Request("http://t", { method: "DELETE", body: "{}" }));
    expect(bad.status).toBe(400);
    const ok = await DELETE(new Request("http://t", { method: "DELETE", body: JSON.stringify({ confirm: "excluir" }) }));
    expect(ok.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith("clerk_priv_api");
    const row = await db.prepare("SELECT name, clerkId FROM members WHERE username LIKE 'removido-%' AND email LIKE '%removido.invalid'").all();
    expect(row.length).toBeGreaterThan(0);
  });
});
