import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { getEditionOverview } from "@/lib/editionOverview";
import { getWaitlistPosition, register, unregister } from "@/lib/registrations";
import { listRegistrantsWithAnswers } from "@/lib/registrationForm";

// frente N #1/#2 — visão geral do painel: funil de RSVP + fila de espera

let seq = 0;
async function member() {
  const tag = `ov${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`);
  return row!.id;
}

async function edition(id: string, capacity: number | null, rsvp = 1) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, capacity, rsvpEnabled, source)
       VALUES (?, ?, 'Hack Inova', '2026-12-05T12:00:00Z', 'presencial', 'https://x.dev', ?, ?, 'painel')`,
    )
    .run(id, `Edição ${id}`, capacity, rsvp);
}

describe("getEditionOverview", () => {
  it("conta aprovados, confirmados, recusados, sem resposta, fila e promovidos", async () => {
    const H = "ov-funil";
    await edition(H, null);
    const ins = (m: number, status: string, rsvp: string | null, promoted = false) =>
      db
        .prepare(
          `INSERT INTO registrations (memberId, hackathonId, status, rsvpStatus, promotedAt, waitlistedAt)
           VALUES (?, ?, ?, ?, ?, CASE WHEN ?::text = 'waitlist' THEN datetime('now') END)`,
        )
        .run(m, H, status, rsvp, promoted ? "2026-11-01 10:00:00" : null, status);
    await ins(await member(), "approved", "confirmed");
    await ins(await member(), "approved", "confirmed", true);
    await ins(await member(), "approved", "pending");
    await ins(await member(), "approved", null);
    await ins(await member(), "pending", null);
    await ins(await member(), "waitlist", null);
    await ins(await member(), "waitlist", null);
    // quem recusou/expirou já saiu de registrations (rsvp_releases)
    for (const outcome of ["declined", "declined", "expired"]) {
      await db
        .prepare(
          `INSERT INTO rsvp_releases (registrationId, hackathonId, memberId, outcome) VALUES (?, ?, ?, ?)`,
        )
        .run(900000 + seq, H, await member(), outcome);
    }

    expect(await getEditionOverview(H)).toEqual({
      total: 7,
      pending: 1,
      approved: 4,
      rsvpEnabled: true,
      confirmed: 2,
      declined: 2,
      noResponse: 1,
      expired: 1,
      notInvited: 1,
      waitlist: 2,
      promoted: 1,
    });
  });

  it("edição vazia devolve zeros (sem NaN)", async () => {
    await edition("ov-vazia", null, 0);
    const o = await getEditionOverview("ov-vazia");
    expect(o).toMatchObject({ total: 0, approved: 0, waitlist: 0, promoted: 0, rsvpEnabled: false });
  });

  it("cancelamento promove da fila: contagem da fila cai e promovidos sobe", async () => {
    const H = "ov-fila";
    await edition(H, 1, 0);
    const a = await member();
    const b = await member();
    const c = await member();
    expect((await register(a, H)).status).toBe("approved");
    expect(await register(b, H)).toMatchObject({ status: "waitlist", position: 1 });
    expect(await register(c, H)).toMatchObject({ status: "waitlist", position: 2 });
    expect(await getEditionOverview(H)).toMatchObject({ approved: 1, waitlist: 2, promoted: 0 });

    // posição de cada um na aba inscritos (mesma regra do inscrito)
    const rows = await listRegistrantsWithAnswers(H);
    expect(rows.filter((r) => r.status === "waitlist").map((r) => [r.memberId, Number(r.waitlistPosition)])).toEqual([
      [b, 1],
      [c, 2],
    ]);

    await unregister(a, H);
    expect(await getEditionOverview(H)).toMatchObject({ approved: 1, waitlist: 1, promoted: 1 });
    expect(await getWaitlistPosition(c, H)).toBe(1);
    expect(await getWaitlistPosition(b, H)).toBeNull();
  });
});
