import { beforeEach, describe, expect, it, vi } from "vitest";

// achado currentmember-clerk-api-por-render: o Clerk (HTTP) só entra na
// primeira materialização; o resto vem do banco.
const clerk = vi.hoisted(() => ({
  userId: "user_sessao_1" as string | null,
  currentUser: vi.fn(async () => ({
    firstName: "Ana",
    lastName: "Lima",
    primaryEmailAddress: { emailAddress: "ana.sessao@t.dev" },
    imageUrl: null,
  })),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.userId })),
  currentUser: clerk.currentUser,
}));

import { currentMember } from "@/lib/session";
import { getOrCreateMember } from "@/lib/members";

describe("currentMember", () => {
  beforeEach(() => {
    clerk.currentUser.mockClear();
  });

  it("duas chamadas seguidas criam o membro com uma consulta só ao Clerk", async () => {
    clerk.userId = "user_sessao_1";
    const a = await currentMember();
    const b = await currentMember();
    expect(a?.email).toBe("ana.sessao@t.dev");
    expect(b?.id).toBe(a?.id);
    expect(clerk.currentUser).toHaveBeenCalledTimes(1);
  });

  it("membro que já existe e já sincronizou não chama o Clerk", async () => {
    clerk.userId = "user_sessao_1";
    await currentMember();
    clerk.currentUser.mockClear();
    const m = await currentMember();
    expect(m?.username).toBeTruthy();
    expect(clerk.currentUser).not.toHaveBeenCalled();
  });

  it("deslogado devolve null sem chamar o Clerk", async () => {
    clerk.userId = null;
    expect(await currentMember()).toBeNull();
    expect(clerk.currentUser).not.toHaveBeenCalled();
  });

  it("e-mail que entra na lista de admins promove sem consultar o Clerk", async () => {
    clerk.userId = "user_sessao_2";
    await getOrCreateMember({ id: "user_sessao_2", firstName: "Bia", lastName: null, email: "bia.sessao@t.dev" });
    await currentMember();
    clerk.currentUser.mockClear();
    vi.stubEnv("HACKAHUB_ADMIN_EMAILS", "bia.sessao@t.dev");
    const m = await currentMember();
    vi.unstubAllEnvs();
    expect(m?.role).toBe("admin");
    expect(clerk.currentUser).not.toHaveBeenCalled();
  });
});
