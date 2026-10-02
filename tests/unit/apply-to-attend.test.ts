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

const xpOf = (memberId: number) =>
  (db.prepare("SELECT xp FROM members WHERE id = ?").get(memberId) as {
    xp: number;
  }).xp;

const regRow = (memberId: number, hackathonId: string) =>
  db
    .prepare(
      "SELECT status, reviewedAt FROM registrations WHERE memberId = ? AND hackathonId = ?",
    )
    .get(memberId, hackathonId) as
    | { status: string; reviewedAt: string | null }
    | undefined;

beforeEach(() => {
  db.prepare("DELETE FROM registrations").run();
  db.prepare("DELETE FROM member_cards").run();
  db.prepare("DELETE FROM member_badges").run();
  db.prepare(
    `INSERT OR IGNORE INTO hackathons
       (id, name, organizer, startsAt, format, registrationUrl, tags, requiresApproval)
     VALUES (?, 'Edição Curada', 'Hack Inova', '2099-01-01', 'online',
             'https://x.dev', '[]', 1)`,
  ).run(CURATED);
  db.prepare("UPDATE hackathons SET requiresApproval = 1 WHERE id = ?").run(
    CURATED,
  );
});

describe("register em edição curada (spec 032)", () => {
  it("pedido entra pending — sem carta, sem XP e sem badge debut", () => {
    const m = makeMember("cur1");
    const res = register(m, CURATED);
    expect(res.status).toBe("pending");
    expect(res.created).toBe(true);
    expect(getRegistrationStatus(m, CURATED)).toBe("pending");
    // recompensa NÃO existe ainda
    expect(getMemberCard(m, CURATED)).toBeNull();
    expect(xpOf(m)).toBe(0);
    expect(
      checkBadges(m)
        .map((b) => b.id)
        .filter((b) => b === "debut"),
    ).toEqual([]);
    const row = regRow(m, CURATED)!;
    expect(row.status).toBe("pending");
    expect(row.reviewedAt).toBeNull();
  });

  it("re-POST é idempotente: segue pending sem duplicar linha", () => {
    const m = makeMember("cur2");
    register(m, CURATED);
    const again = register(m, CURATED);
    expect(again.status).toBe("pending");
    expect(again.created).toBe(false);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) n FROM registrations WHERE memberId = ? AND hackathonId = ?",
        )
        .get(m, CURATED),
    ).toEqual({ n: 1 });
  });

  it("edição aberta segue instantânea — status approved no register", () => {
    const m = makeMember("cur3");
    const res = register(m, OPEN);
    expect(res.status).toBe("approved");
    expect(res.created).toBe(true);
    expect(getHackathon(OPEN)!.requiresApproval).toBe(false);
  });

  it("pendente não conta como inscrito em nenhum gate/leitura", () => {
    const m = makeMember("cur4");
    register(m, CURATED);
    // gates leem getRegistrationIds — pendente fica de fora
    expect(getRegistrationIds(m)).toEqual([]);
    // lista/contagem pública da edição omite pendente
    expect(getRegistrationsByHackathon(CURATED)).toHaveLength(0);
    // checkBadges disparado por OUTRA ação não ganha debut por pendente
    const badges = checkBadges(m).map((b) => b.id);
    expect(badges).not.toContain("debut");
    // "campanhas" públicas e o arco do builder ignoram pendente
    const lb = listLeaderboard("xp", 100).find((x) => x.id === m);
    expect(lb?.campaigns ?? 0).toBe(0);
    expect(getMemberArc("u_cur4")).toHaveLength(0);
  });
});

describe("reviewRegistration — a curadoria decide", () => {
  it("approve efetiva: approved + reviewedAt + recompensa completa UMA vez", () => {
    const m = makeMember("cur5");
    register(m, CURATED);
    const res = reviewRegistration(m, CURATED, "approve");
    if (res?.status !== "approved") throw new Error("esperava approved");
    expect(res.rewarded).toBe(true);
    expect(res.cardSerial).toBe(1);
    expect(xpOf(m)).toBe(XP.register);
    expect(getMemberCard(m, CURATED)?.serial).toBe(1);
    expect(getMemberBadges(m).map((b) => b.id)).toContain("debut");
    const row = regRow(m, CURATED)!;
    expect(row.status).toBe("approved");
    expect(row.reviewedAt).toBeTruthy();
    // gates abrem depois da aprovação
    expect(getRegistrationIds(m)).toEqual([CURATED]);
    expect(getRegistrationsByHackathon(CURATED).map((r) => r.username)).toEqual([
      "u_cur5",
    ]);
    // re-approve é no-op — nunca paga XP duplo
    const again = reviewRegistration(m, CURATED, "approve");
    if (again?.status !== "approved") throw new Error("esperava approved");
    expect(again.rewarded).toBe(false);
    expect(xpOf(m)).toBe(XP.register);
  });

  it("reject marca rejected + reviewedAt, sem recompensa; re-approve recompensa", () => {
    const m = makeMember("cur6");
    register(m, CURATED);
    const rej = reviewRegistration(m, CURATED, "reject");
    expect(rej!.status).toBe("rejected");
    expect(getRegistrationStatus(m, CURATED)).toBe("rejected");
    expect(regRow(m, CURATED)!.reviewedAt).toBeTruthy();
    expect(xpOf(m)).toBe(0);
    expect(getMemberCard(m, CURATED)).toBeNull();
    expect(getRegistrationIds(m)).toEqual([]);
    // re-POST não reabre — rejected fica (decisão é do admin)
    const repost = register(m, CURATED);
    expect(repost.status).toBe("rejected");
    expect(repost.created).toBe(false);
    // admin muda de ideia → recompensa acontece na transição
    const ap = reviewRegistration(m, CURATED, "approve");
    if (ap?.status !== "approved") throw new Error("esperava approved");
    expect(ap.rewarded).toBe(true);
    expect(xpOf(m)).toBe(XP.register);
  });

  it("sem inscrição na edição → null (rota mapeia 404)", () => {
    const m = makeMember("cur7");
    expect(reviewRegistration(m, CURATED, "approve")).toBeNull();
    expect(reviewRegistration(m, CURATED, "reject")).toBeNull();
  });

  it("revogar aprovado vira rejected sem estornar carta/XP pagos", () => {
    const m = makeMember("cur8");
    register(m, CURATED);
    reviewRegistration(m, CURATED, "approve");
    const rej = reviewRegistration(m, CURATED, "reject");
    expect(rej!.status).toBe("rejected");
    // histórico honesto: recompensa já paga fica; gates fecham de novo
    expect(getMemberCard(m, CURATED)?.serial).toBe(1);
    expect(getRegistrationIds(m)).toEqual([]);
  });
});

describe("listRegistrants — fila do admin", () => {
  it("inclui memberId/status/reviewedAt e põe pendentes primeiro", () => {
    const a = makeMember("curA");
    const b = makeMember("curB");
    register(a, CURATED);
    register(b, CURATED);
    reviewRegistration(a, CURATED, "approve");
    const list = listRegistrants(CURATED);
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
  it("updateHackathon liga/desliga; edição aberta com inscritos não reescreve status", () => {
    const m = makeMember("cur9");
    register(m, OPEN);
    expect(getHackathon(OPEN)!.requiresApproval).toBe(false);
    const h = updateHackathon(OPEN, { requiresApproval: true });
    expect(h!.requiresApproval).toBe(true);
    // inscrição aprovada existente segue approved — flag não retroage
    expect(getRegistrationStatus(m, OPEN)).toBe("approved");
    // mas o próximo pedido entra como pendente
    const m2 = makeMember("cur10");
    expect(register(m2, OPEN).status).toBe("pending");
    updateHackathon(OPEN, { requiresApproval: false });
    const m3 = makeMember("cur11");
    expect(register(m3, OPEN).status).toBe("approved");
  });
});
