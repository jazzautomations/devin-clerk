import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  getRegistrationsByHackathon,
  getRegistrationIds,
  getRegistrationStatus,
  listRegistrants,
  register,
  reviewRegistration,
} from "@/lib/registrations";
import { updateHackathon } from "@/lib/admin";
import { getHackathon } from "@/lib/hackathons";
import { checkBadges, getMemberBadges, getMemberCard } from "@/lib/xp";
import { getMemberArc } from "@/lib/archive";
import { listLeaderboard } from "@/lib/members";
import { XP } from "@/lib/game";

// spec 032 — "pedir lugar": edição curada guarda o pedido como pending e a
// recompensa (carta/XP/badges) só existe na transição pra approved.

const OPEN = "hack-inova-alphaville-2026"; // seed ativa, aberta
const CURATED = "curada-ut";

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

const xpOf = async (memberId: number) =>
  (await db.prepare("SELECT xp FROM members WHERE id = ?").get(memberId) as {
    xp: number;
  }).xp;

const regRow = async (memberId: number, hackathonId: string) =>
  await db
    .prepare(
      "SELECT status, reviewedAt FROM registrations WHERE memberId = ? AND hackathonId = ?",
    )
    .get(memberId, hackathonId) as
    | { status: string; reviewedAt: string | null }
    | undefined;

beforeEach(async () => {
  await db.prepare("DELETE FROM registrations").run();
  await db.prepare("DELETE FROM member_cards").run();
  await db.prepare("DELETE FROM member_badges").run();
  await db.prepare(
    `INSERT OR IGNORE INTO hackathons
       (id, name, organizer, startsAt, format, registrationUrl, tags, requiresApproval, source)
     VALUES (?, 'Edição Curada', 'Hack Inova', '2099-01-01', 'online',
             'https://x.dev', '[]', 1, 'painel')`,
  ).run(CURATED);
  await db.prepare("UPDATE hackathons SET requiresApproval = 1 WHERE id = ?").run(
    CURATED,
  );
});

describe("register em edição curada (spec 032)", () => {
  it("pedido entra pending — sem carta, sem XP e sem badge debut", async () => {
    const m = await makeMember("cur1");
    const res = await register(m, CURATED);
    expect(res.status).toBe("pending");
    expect(res.created).toBe(true);
    expect(await getRegistrationStatus(m, CURATED)).toBe("pending");
    // recompensa NÃO existe ainda
    expect(await getMemberCard(m, CURATED)).toBeNull();
    expect(await xpOf(m)).toBe(0);
    expect(
      (await checkBadges(m))
        .map((b) => b.id)
        .filter((b) => b === "debut"),
    ).toEqual([]);
    const row = (await regRow(m, CURATED))!;
    expect(row.status).toBe("pending");
    expect(row.reviewedAt).toBeNull();
  });

  it("re-POST é idempotente: segue pending sem duplicar linha", async () => {
    const m = await makeMember("cur2");
    await register(m, CURATED);
    const again = await register(m, CURATED);
    expect(again.status).toBe("pending");
    expect(again.created).toBe(false);
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) n FROM registrations WHERE memberId = ? AND hackathonId = ?",
        )
        .get(m, CURATED),
    ).toEqual({ n: 1 });
  });

  it("edição aberta segue instantânea — status approved no register", async () => {
    const m = await makeMember("cur3");
    const res = await register(m, OPEN);
    expect(res.status).toBe("approved");
    expect(res.created).toBe(true);
    expect((await getHackathon(OPEN))!.requiresApproval).toBe(false);
  });

  it("pendente não conta como inscrito em nenhum gate/leitura", async () => {
    const m = await makeMember("cur4");
    await register(m, CURATED);
    // gates leem getRegistrationIds — pendente fica de fora
    expect(await getRegistrationIds(m)).toEqual([]);
    // lista/contagem pública da edição omite pendente
    expect(await getRegistrationsByHackathon(CURATED)).toHaveLength(0);
    // checkBadges disparado por OUTRA ação não ganha debut por pendente
    const badges = (await checkBadges(m)).map((b) => b.id);
    expect(badges).not.toContain("debut");
    // "campanhas" públicas e o arco do builder ignoram pendente
    const lb = (await listLeaderboard("xp", 100)).find((x) => x.id === m);
    expect(lb?.campaigns ?? 0).toBe(0);
    expect(await getMemberArc("u_cur4")).toHaveLength(0);
  });
});

describe("reviewRegistration — a curadoria decide", () => {
  it("approve efetiva: approved + reviewedAt + recompensa completa UMA vez", async () => {
    const m = await makeMember("cur5");
    await register(m, CURATED);
    const res = await reviewRegistration(m, CURATED, "approve");
    if (res?.status !== "approved") throw new Error("esperava approved");
    expect(res.rewarded).toBe(true);
    expect(res.cardSerial).toBe(1);
    expect(await xpOf(m)).toBe(XP.register);
    expect((await getMemberCard(m, CURATED))?.serial).toBe(1);
    expect((await getMemberBadges(m)).map((b) => b.id)).toContain("debut");
    const row = (await regRow(m, CURATED))!;
    expect(row.status).toBe("approved");
    expect(row.reviewedAt).toBeTruthy();
    // gates abrem depois da aprovação
    expect(await getRegistrationIds(m)).toEqual([CURATED]);
    // lista pública é opt-in (frente N #6): aprovado sem opt-in não aparece
    expect(await getRegistrationsByHackathon(CURATED)).toEqual([]);
    await db.prepare("UPDATE registrations SET publicListing = 1 WHERE memberId = ?").run(m);
    expect((await getRegistrationsByHackathon(CURATED)).map((r) => r.username)).toEqual([
      "u_cur5",
    ]);
    // re-approve é no-op — nunca paga XP duplo
    const again = await reviewRegistration(m, CURATED, "approve");
    if (again?.status !== "approved") throw new Error("esperava approved");
    expect(again.rewarded).toBe(false);
    expect(await xpOf(m)).toBe(XP.register);
  });

  it("reject marca rejected + reviewedAt, sem recompensa; re-approve recompensa", async () => {
    const m = await makeMember("cur6");
    await register(m, CURATED);
    const rej = await reviewRegistration(m, CURATED, "reject");
    expect(rej!.status).toBe("rejected");
    expect(await getRegistrationStatus(m, CURATED)).toBe("rejected");
    expect((await regRow(m, CURATED))!.reviewedAt).toBeTruthy();
    expect(await xpOf(m)).toBe(0);
    expect(await getMemberCard(m, CURATED)).toBeNull();
    expect(await getRegistrationIds(m)).toEqual([]);
    // re-POST não reabre — rejected fica (decisão é do admin)
    const repost = await register(m, CURATED);
    expect(repost.status).toBe("rejected");
    expect(repost.created).toBe(false);
    // admin muda de ideia → recompensa acontece na transição
    const ap = await reviewRegistration(m, CURATED, "approve");
    if (ap?.status !== "approved") throw new Error("esperava approved");
    expect(ap.rewarded).toBe(true);
    expect(await xpOf(m)).toBe(XP.register);
  });

  it("sem inscrição na edição → null (rota mapeia 404)", async () => {
    const m = await makeMember("cur7");
    expect(await reviewRegistration(m, CURATED, "approve")).toBeNull();
    expect(await reviewRegistration(m, CURATED, "reject")).toBeNull();
  });

  it("revogar aprovado vira rejected sem estornar carta/XP pagos", async () => {
    const m = await makeMember("cur8");
    await register(m, CURATED);
    await reviewRegistration(m, CURATED, "approve");
    const rej = await reviewRegistration(m, CURATED, "reject");
    expect(rej!.status).toBe("rejected");
    // histórico honesto: recompensa já paga fica; gates fecham de novo
    expect((await getMemberCard(m, CURATED))?.serial).toBe(1);
    expect(await getRegistrationIds(m)).toEqual([]);
  });
});

describe("listRegistrants — fila do admin", () => {
  it("inclui memberId/status/reviewedAt e põe pendentes primeiro", async () => {
    const a = await makeMember("curA");
    const b = await makeMember("curB");
    await register(a, CURATED);
    await register(b, CURATED);
    await reviewRegistration(a, CURATED, "approve");
    const list = await listRegistrants(CURATED);
    expect(list).toHaveLength(2);
    expect(list[0].username).toBe("u_curB"); // pendente primeiro
    expect(list[0].status).toBe("pending");
    expect(list[1].status).toBe("approved");
    expect(list[1].memberId).toBe(a);
    expect(list[1].reviewedAt).toBeTruthy();
    expect(list[0].email).toBe("curA@t.dev".replace("curA", "curB"));
  });
});

describe("flag requiresApproval (admin)", () => {
  it("updateHackathon liga/desliga; edição aberta com inscritos não reescreve status", async () => {
    const m = await makeMember("cur9");
    await register(m, OPEN);
    expect((await getHackathon(OPEN))!.requiresApproval).toBe(false);
    const h = await updateHackathon(OPEN, { requiresApproval: true });
    expect(h!.requiresApproval).toBe(true);
    // inscrição aprovada existente segue approved — flag não retroage
    expect(await getRegistrationStatus(m, OPEN)).toBe("approved");
    // mas o próximo pedido entra como pendente
    const m2 = await makeMember("cur10");
    expect((await register(m2, OPEN)).status).toBe("pending");
    await updateHackathon(OPEN, { requiresApproval: false });
    const m3 = await makeMember("cur11");
    expect((await register(m3, OPEN)).status).toBe("approved");
  });
});
