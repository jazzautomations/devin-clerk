import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { memberTeamFor, submitTeam, TeamError } from "@/lib/teams";
import {
  inviteToTeam,
  listMyInvites,
  listPendingTeamInvites,
  respondInvite,
} from "@/lib/teamInvites";
import { listNotifications } from "@/lib/notifications";

// frente N #4 — aceite de membro de time

const HID = "hack-inova-alphaville-2026"; // edição futura ativa (seed)

async function makeMember(username: string): Promise<{ id: number; username: string }> {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(`clerk_${username}`, username, `${username}@t.dev`);
  return (await db.prepare("SELECT id, username FROM members WHERE username = ?").get(username)) as {
    id: number;
    username: string;
  };
}

async function register(memberId: number, status = "approved") {
  await db
    .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
    .run(memberId, HID, status);
}

const status = (e: unknown) => (e instanceof TeamError ? e.status : null);

beforeEach(async () => {
  await db.prepare("DELETE FROM team_invites").run();
  await db.prepare("DELETE FROM team_members").run();
  await db.prepare("DELETE FROM team_projects").run();
  await db.prepare("DELETE FROM teams").run();
  await db.prepare("DELETE FROM notifications").run();
});

describe("convite → aceite", () => {
  it("convidado recebe notificação, não está no time até aceitar; aceitar põe no time e avisa quem convidou", async () => {
    const cap = await makeMember("inv_cap");
    const ana = await makeMember("inv_ana");
    await register(cap.id);
    await register(ana.id);
    const { team, invitedUsernames } = await submitTeam(HID, cap, {
      name: "Convidados",
      memberUsernames: ["@inv_ana"],
    });
    expect(invitedUsernames).toEqual(["inv_ana"]);
    expect(team.members).toEqual(["inv_cap"]);
    expect(await memberTeamFor(HID, "inv_ana")).toBeNull();
    expect(await listPendingTeamInvites(team.id)).toEqual(["inv_ana"]);

    const [n] = await listNotifications(ana.id);
    expect(n).toMatchObject({ type: "team_invite", actorUsername: "inv_cap", href: `/h/${HID}#meu-time`, read: false });
    expect(n.text).toContain("Convidados");

    const [inv] = await listMyInvites(ana.id, HID);
    expect(inv).toMatchObject({ teamName: "Convidados", invitedBy: "inv_cap" });

    const r = await respondInvite(inv.id, ana, "accept");
    expect(r.status).toBe("accepted");
    expect((await memberTeamFor(HID, "inv_ana"))?.members).toEqual(["inv_ana", "inv_cap"]);
    expect(await listPendingTeamInvites(team.id)).toEqual([]);
    expect((await listNotifications(cap.id))[0]).toMatchObject({ type: "team_invite_accepted", actorUsername: "inv_ana" });

    // responder de novo = 409
    await expect(respondInvite(inv.id, ana, "decline")).rejects.toMatchObject({ status: 409 });
  });

  it("recusar não põe no time e avisa quem convidou; reconvidar reabre o convite", async () => {
    const cap = await makeMember("rec_cap");
    const bia = await makeMember("rec_bia");
    await register(cap.id);
    await register(bia.id);
    const { team } = await submitTeam(HID, cap, { name: "Recusados", memberUsernames: ["rec_bia"] });
    const [inv] = await listMyInvites(bia.id, HID);
    expect((await respondInvite(inv.id, bia, "decline")).status).toBe("declined");
    expect(await memberTeamFor(HID, "rec_bia")).toBeNull();
    expect((await listNotifications(cap.id))[0].type).toBe("team_invite_declined");

    const again = await inviteToTeam(HID, cap, ["rec_bia"]);
    expect(again.invited).toEqual(["rec_bia"]);
    expect(await listPendingTeamInvites(team.id)).toEqual(["rec_bia"]);
    // convite pendente repetido não duplica nem renotifica
    const before = (await listNotifications(bia.id)).length;
    expect((await inviteToTeam(HID, cap, ["rec_bia"])).invited).toEqual([]);
    expect((await listNotifications(bia.id)).length).toBe(before);
  });

  it("convite de outra pessoa = 404; aceitar um cancela os outros convites da edição", async () => {
    const a = await makeMember("dup_a");
    const b = await makeMember("dup_b");
    const c = await makeMember("dup_c");
    for (const m of [a, b, c]) await register(m.id);
    await submitTeam(HID, a, { name: "Time A", memberUsernames: ["dup_c"] });
    await submitTeam(HID, b, { name: "Time B", memberUsernames: ["dup_c"] });
    const invites = await listMyInvites(c.id, HID);
    expect(invites.map((i) => i.teamName)).toEqual(["Time A", "Time B"]);

    try {
      await respondInvite(invites[0].id, a, "accept");
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(404);
    }
    await respondInvite(invites[1].id, c, "accept");
    expect((await memberTeamFor(HID, "dup_c"))?.name).toBe("Time B");
    expect(await listMyInvites(c.id, HID)).toEqual([]);
    const st = await db
      .prepare("SELECT status FROM team_invites WHERE id = ?")
      .get<{ status: string }>(invites[0].id);
    expect(st?.status).toBe("cancelled");
  });

  it("aceitar exige continuar aprovado (403) e sem time (409)", async () => {
    const cap = await makeMember("g_cap");
    const out = await makeMember("g_out");
    await register(cap.id);
    await register(out.id);
    await submitTeam(HID, cap, { name: "Gate", memberUsernames: ["g_out"] });
    const [inv] = await listMyInvites(out.id, HID);
    await db.prepare("UPDATE registrations SET status = 'rejected' WHERE memberId = ?").run(out.id);
    await expect(respondInvite(inv.id, out, "accept")).rejects.toMatchObject({ status: 403 });
    expect(await memberTeamFor(HID, "g_out")).toBeNull();
  });

  it("inviteToTeam: só integrante convida; ignora não inscrito e quem já tem time", async () => {
    const cap = await makeMember("i_cap");
    const solo = await makeMember("i_solo");
    const busy = await makeMember("i_busy");
    await makeMember("i_out");
    for (const m of [cap, solo, busy]) await register(m.id);
    await expect(inviteToTeam(HID, solo, ["i_cap"])).rejects.toMatchObject({ status: 404 });
    await submitTeam(HID, cap, { name: "Cap Team" });
    await submitTeam(HID, busy, { name: "Busy Team" });
    const r = await inviteToTeam(HID, cap, ["i_solo", "i_busy", "i_out", "fantasma"]);
    expect(r.invited).toEqual(["i_solo"]);
    expect(r.ignored).toEqual(["i_busy", "i_out", "fantasma"]);
  });
});

describe("membros que já existiam", () => {
  it("linha antiga de team_members (sem convite) continua contando como integrante", async () => {
    const old = await makeMember("legacy_dev");
    await register(old.id);
    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, 'Legado', 0) RETURNING id")
      .get<{ id: number }>(HID);
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, "legacy_dev");
    expect((await memberTeamFor(HID, "legacy_dev"))?.name).toBe("Legado");
    expect(await listPendingTeamInvites(t!.id)).toEqual([]);
  });
});
