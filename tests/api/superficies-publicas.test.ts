import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { empresaStats, STAT_FLOOR, visibleStats } from "@/lib/empresasStats";
import { listMyContactShares, revokeContact, shareContact } from "@/lib/sponsorContacts";

// auditoria 041 pacote E — /empresas sem "membros 0" nem radar contado como
// edição; /perfil lista os contatos compartilhados com marca; PATCH do
// perfil devolve o nome da conquista, não o id.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  clerkClient: vi.fn(),
}));

let seq = 0;
async function member(clerkId?: string): Promise<number> {
  const tag = `sp${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(clerkId ?? `clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`);
  return row!.id;
}
// source 'painel' = roda no HackaHub; fonte do radar = evento externo
async function edition(id: string, organizer: string, active = 1, source = "painel") {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, active, source)
       VALUES (?, ?, ?, '2027-01-01', 'presencial', 'https://x.dev', ?, ?)`,
    )
    .run(id, `Ed ${id}`, organizer, active, source);
}

beforeEach(() => {
  clerk.uid = null;
});
afterEach(() => vi.restoreAllMocks());

describe("/empresas — números da casa e com piso", () => {
  it("abaixo do piso, o número não aparece", () => {
    expect(
      visibleStats([
        { key: "membros", label: "membros", n: 0 },
        { key: "edicoes", label: "edições", n: STAT_FLOOR.edicoes },
        { key: "projetos", label: "projetos", n: 1 },
      ]).map((s) => s.key),
    ).toEqual(["edicoes"]);
  });

  it("conta só edições que rodam no HackaHub e membros que não excluíram a conta", async () => {
    // o boot roda o seed (edições reais da Hack Inova): mede a partir dele
    const base = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM hackathons h WHERE h.source IN ('seed', 'painel')
                   AND (h.active = 1 OR EXISTS (SELECT 1 FROM registrations r WHERE r.hackathonId = h.id)
                        OR EXISTS (SELECT 1 FROM teams t WHERE t.hackathonId = h.id))) AS e,
                (SELECT COUNT(*) FROM members WHERE clerkId NOT LIKE 'deleted:%') AS m`,
      )
      .get<{ e: number; m: number }>();
    const e0 = Number(base?.e ?? 0);
    const m0 = Number(base?.m ?? 0);
    await edition("hi-1", "Hack Inova");
    await edition("hi-2", "Comunidade de Sorocaba");
    await edition("hi-rascunho", "Hack Inova", 0);
    // o nome do organizador não decide: "Hack Inova" raspado do radar é externo
    await edition("hi-radar", "Hack Inova", 1, "sympla");
    for (let i = 0; i < 5; i++) await edition(`devpost-${i}`, "Devpost", 1, "devpost");
    for (let i = m0; i < STAT_FLOOR.membros; i++) await member();
    await db.prepare("UPDATE members SET clerkId = 'deleted:' || id WHERE id = (SELECT MAX(id) FROM members)").run();
    const stats = await empresaStats();
    // rascunho vazio (active=0, sem inscrição) e evento do Devpost ficam de fora
    expect(stats.find((s) => s.key === "edicoes")?.n).toBe(e0 + 2);
    // um excluído derruba pra 49: abaixo do piso, some
    expect(stats.find((s) => s.key === "membros")).toBeUndefined();
    await member();
    expect((await empresaStats()).find((s) => s.key === "membros")?.n).toBe(STAT_FLOOR.membros);
  });
});

describe("/perfil — contato com marcas", () => {
  it("lista só os compartilhamentos ativos, com marca e edição; revogado some", async () => {
    await edition("hi-marca", "Hack Inova");
    await db.prepare("INSERT INTO sponsors (id, name) VALUES ('mk-a', 'Marca A'), ('mk-b', 'Marca B')").run();
    await db
      .prepare("INSERT INTO edition_sponsors (hackathonId, sponsorId) VALUES ('hi-marca','mk-a'), ('hi-marca','mk-b')")
      .run();
    const me = await member();
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, 'hi-marca', 'approved')")
      .run(me);
    await shareContact("hi-marca", "mk-a", me);
    await shareContact("hi-marca", "mk-b", me);
    expect((await listMyContactShares(me)).map((c) => c.sponsorName).sort()).toEqual(["Marca A", "Marca B"]);
    await revokeContact("hi-marca", "mk-b", me);
    const left = await listMyContactShares(me);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ hackathonId: "hi-marca", hackathonName: "Ed hi-marca", sponsorId: "mk-a" });
    expect(await listMyContactShares(await member())).toEqual([]);
  });
});

describe("PATCH /api/members/me", () => {
  it("conquista nova vem pelo nome e erro de validação em PT-BR", async () => {
    clerk.uid = "clerk_badge_me";
    const me = await member("clerk_badge_me");
    await edition("hi-badge", "Hack Inova");
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, 'hi-badge', 'approved')")
      .run(me);
    const { PATCH } = await import("@/app/api/members/me/route");
    const patch = (body: unknown) =>
      PATCH(
        new Request("http://t/api/members/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const bad = await patch({ openTo: ["vip"] });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("opção de disponibilidade inválida");
    const ok = await (await patch({ bio: "oi" })).json();
    // primeira inscrição aprovada = conquista "debut", que se chama "1ª campanha"
    expect(ok.newBadges).toContain("1ª campanha");
    expect(ok.newBadges).not.toContain("debut");
  });
});
