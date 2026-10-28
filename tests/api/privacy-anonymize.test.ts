import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import {
  ANONYMIZE,
  KEEP_ON_ANONYMIZE,
  PEER_COLUMNS,
  deleteAction,
  deleteMemberData,
  exportMemberData,
  exportMode,
} from "@/lib/privacy";

// LGPD extensível (spec 046, evidencia-e-lgpd): ANONYMIZE cobre toda coluna
// de members, PEER_COLUMNS apaga relação entre duas pessoas dos dois lados e
// entra no export só como contagem, denúncia é anonimizada e não apagada.

const authMock = vi.fn(async () => ({ userId: null as string | null }));
const deleteUser = vi.fn(async () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  clerkClient: async () => ({ users: { deleteUser } }),
}));

async function memberColumns(): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT column_name AS "c" FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'members' ORDER BY ordinal_position`,
    )
    .all<{ c: string }>();
  return rows.map((r) => r.c);
}

/** coluna de members que ninguém disse o que vira na exclusão */
const unregistered = (cols: string[]) => cols.filter((c) => !(c in ANONYMIZE) && !KEEP_ON_ANONYMIZE.has(c));

describe("colunas de members", () => {
  it("toda coluna de members está em ANONYMIZE ou KEEP_ON_ANONYMIZE", async () => {
    const cols = await memberColumns();
    expect(cols).toEqual(expect.arrayContaining(["city", "institution", "course", "lastSeenAt"]));
    expect(unregistered(cols)).toEqual([]);
  });

  it("a checagem pega coluna nova sem registro (members.foo)", async () => {
    expect(unregistered([...(await memberColumns()), "foo"])).toEqual(["foo"]);
  });

  it("nada fica nas duas listas e nada em ANONYMIZE fica fora da tabela", async () => {
    const cols = new Set(await memberColumns());
    for (const c of Object.keys(ANONYMIZE)) {
      expect(KEEP_ON_ANONYMIZE.has(c)).toBe(false);
      expect(cols.has(c)).toBe(true);
    }
  });
});

describe("regras por coluna", () => {
  it("peer apaga dos dois lados; reporterId anonimiza; ator sobre terceiros fica", () => {
    for (const c of PEER_COLUMNS) expect(deleteAction("qualquer_relacao", c)).toBe("delete");
    expect(deleteAction("qualquer_relacao", "memberId")).toBe("delete");
    expect(deleteAction("reports", "reporterId")).toBe("nullify");
    expect(deleteAction("incidents", "reporterId")).toBe("nullify");
    expect(deleteAction("edition_roles", "grantedBy")).toBe("keep");
    expect(deleteAction("registrations", "memberId")).toBe("keep");
  });

  it("export: peer só como contagem; notificação que eu causei na caixa de outra pessoa fica fora", () => {
    expect(exportMode("member_follows", "followedId")).toBe("count");
    expect(exportMode("testimonials", "authorId")).toBe("count");
    expect(exportMode("member_follows", "memberId")).toBe("rows");
    expect(exportMode("notifications", "actorId")).toBe("skip");
    expect(exportMode("incidents", "updatedBy")).toBe("skip");
  });
});

describe("exclusão e export", () => {
  async function fullMember(tag: string) {
    const r = await db
      .prepare(
        `INSERT INTO members (clerkId, username, email, name, bio, skills, github, linkedin, twitter, website,
           headline, persona, personas, role, avatarUrl, openTo, phone, whatsappOptIn, whatsappOptInAt,
           emailBouncedAt, usernameChangedAt, onboardedAt, intents, city, institution, course, lastSeenAt, xp)
         VALUES (?, ?, ?, 'Ana Dados', 'bio', '["ts"]', 'anagh', 'ana', 'ana_tw', 'https://ana.dev',
           'dev', 'dev', '["dev"]', 'admin', 'https://img/a.png', '["estagio"]', '5511999999999', 1,
           '2025-01-01 00:00:00', '2025-01-01 00:00:00', '2025-01-01 00:00:00', '2025-01-01 00:00:00',
           '["participar"]', 'Recife, PE', 'UFPE', 'Computação', '2025-06-01 00:00:00', 120)
         RETURNING id`,
      )
      .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`);
    return { id: r!.id, username: `u_${tag}`, clerkId: `clerk_${tag}` };
  }

  it("excluir a conta zera city, institution, course, lastSeenAt e toda coluna de ANONYMIZE", async () => {
    const ana = await fullMember("anon1");
    expect(await deleteMemberData(ana.id)).toBe(ana.clerkId);
    const row = (await db.prepare("SELECT * FROM members WHERE id = ?").get<Record<string, unknown>>(ana.id))!;
    expect(row).toMatchObject({ city: null, institution: null, course: null, lastSeenAt: null });
    const anon = `removido-${ana.id}`;
    for (const [col, v] of Object.entries(ANONYMIZE)) {
      const expected = typeof v === "function" ? v({ memberId: ana.id, anon }) : v;
      expect([col, row[col]]).toEqual([col, expected]);
    }
    // o que não é pessoal fica
    expect(row.xp).toBe(120);
    expect(row.createdAt).toBeTruthy();
  });

  it("notificação que a pessoa causou: some do export dela e o @ vira o anonimizado", async () => {
    const ana = await fullMember("anon2");
    const bia = await fullMember("anon3");
    await notify(bia.id, { type: "like", actorUsername: ana.username, text: "curtiu", href: "/feed" });
    const exp = await exportMemberData(ana.id);
    expect(Object.keys(exp!.data)).not.toContain("notifications.actorId");
    await deleteMemberData(ana.id);
    const n = await db.prepare("SELECT actorUsername, actorId FROM notifications WHERE memberId = ?").get(bia.id);
    expect(n).toEqual({ actorUsername: `removido-${ana.id}`, actorId: ana.id });
  });

  it("rota DELETE /api/members/me zera os campos novos", async () => {
    const caio = await fullMember("anon4");
    authMock.mockResolvedValue({ userId: caio.clerkId });
    const { DELETE } = await import("@/app/api/members/me/route");
    const res = await DELETE(new Request("http://t", { method: "DELETE", body: JSON.stringify({ confirm: "excluir" }) }));
    expect(res.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith(caio.clerkId);
    const row = await db
      .prepare("SELECT city, institution, course, lastSeenAt, onboardedAt, intents FROM members WHERE id = ?")
      .get(caio.id);
    expect(row).toEqual({ city: null, institution: null, course: null, lastSeenAt: null, onboardedAt: null, intents: "[]" });
    authMock.mockResolvedValue({ userId: null });
  });

  it("rota de export devolve o lastSeenAt da própria pessoa", async () => {
    const dani = await fullMember("anon5");
    authMock.mockResolvedValue({ userId: dani.clerkId });
    const { GET } = await import("@/app/api/members/me/export/route");
    const res = await GET(new Request("http://t"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.member).toMatchObject({ city: "Recife, PE", lastSeenAt: "2025-06-01 00:00:00" });
    authMock.mockResolvedValue({ userId: null });
  });
});
