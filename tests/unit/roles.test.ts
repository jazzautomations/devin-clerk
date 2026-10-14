import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { getOrCreateMember } from "@/lib/members";
import {
  canManageEdition,
  getEditionRoles,
  grantEditionRole,
  hasEditionRole,
  inviteToEdition,
  listEditionTeam,
  listPendingInvites,
  revokeEditionRole,
} from "@/lib/roles";

const H = "hack-inova-alphaville-2026";
const OTHER = "hack-inova-unifacens-2026";

async function member(clerkId: string, email: string) {
  return getOrCreateMember({ id: clerkId, firstName: null, lastName: null, email });
}

beforeEach(async () => {
  await db.prepare("DELETE FROM edition_roles").run();
  await db.prepare("DELETE FROM edition_role_invites").run();
});

describe("papéis por edição (spec 033 US7)", () => {
  it("staff da edição faz check-in só nela; admin global vale em todas", async () => {
    const s = await member("c_staff", "staff@t.dev");
    const admin = { id: -1, role: "admin" };
    await grantEditionRole(H, s.id, "staff", null);
    expect(await hasEditionRole(s, H, "staff")).toBe(true);
    expect(await hasEditionRole(s, OTHER, "staff")).toBe(false);
    expect(await hasEditionRole(s, H, "jurado")).toBe(false);
    expect(await hasEditionRole(admin, OTHER, "jurado")).toBe(true);
    expect(await hasEditionRole(null, H, "staff")).toBe(false);
  });

  it("organizador vale por todos os papéis e gerencia a edição", async () => {
    const o = await member("c_org", "org@t.dev");
    await grantEditionRole(H, o.id, "organizador", null);
    expect(await hasEditionRole(o, H, "jurado")).toBe(true);
    expect(await canManageEdition(o, H)).toBe(true);
    expect(await canManageEdition(o, OTHER)).toBe(false);
  });

  it("grant é idempotente e revoke remove só aquele papel", async () => {
    const m = await member("c_multi", "multi@t.dev");
    await grantEditionRole(H, m.id, "mentor", null);
    await grantEditionRole(H, m.id, "mentor", null);
    await grantEditionRole(H, m.id, "jurado", null);
    expect(await getEditionRoles(H, m.id)).toEqual(["jurado", "mentor"]);
    await revokeEditionRole(H, m.id, "mentor");
    expect(await getEditionRoles(H, m.id)).toEqual(["jurado"]);
    expect((await listEditionTeam(H)).map((e) => e.username)).toContain(m.username);
  });

  it("convite pra e-mail sem conta fica pendente e vira papel no primeiro login", async () => {
    expect(await inviteToEdition(H, "Nova.Jurada@T.dev ", "jurado", null)).toBe("pending");
    expect(await listPendingInvites(H)).toEqual([
      expect.objectContaining({ email: "nova.jurada@t.dev", role: "jurado" }),
    ]);
    const j = await member("c_jurada", "nova.jurada@t.dev");
    expect(await getEditionRoles(H, j.id)).toEqual(["jurado"]);
    expect(await listPendingInvites(H)).toEqual([]);
  });

  it("convite pra quem já tem conta vale na hora; e-mail inválido é recusado", async () => {
    const m = await member("c_exist", "exist@t.dev");
    expect(await inviteToEdition(H, "exist@t.dev", "staff", null)).toBe("granted");
    expect(await getEditionRoles(H, m.id)).toEqual(["staff"]);
    await expect(inviteToEdition(H, "nao-e-email", "staff", null)).rejects.toThrow(/inválido/);
  });
});

describe("admin global por HACKAHUB_ADMIN_EMAILS", () => {
  it("primeiro cadastro NÃO vira admin; e-mail da lista vira (inclusive conta antiga)", async () => {
    vi.stubEnv("HACKAHUB_ADMIN_EMAILS", "");
    try {
      await db.prepare("DELETE FROM members WHERE clerkId LIKE 'c_adm%'").run();
      const first = await member("c_adm1", "primeiro@t.dev");
      expect(first.role).toBe("member");
      vi.stubEnv("HACKAHUB_ADMIN_EMAILS", "dona@t.dev, PRIMEIRO@t.dev");
      const owner = await member("c_adm2", "dona@t.dev");
      expect(owner.role).toBe("admin");
      expect((await member("c_adm1", "primeiro@t.dev")).role).toBe("admin");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
