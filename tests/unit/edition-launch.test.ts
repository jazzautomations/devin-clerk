import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { announceEditionLaunch } from "@/lib/editionLaunch";

// Edição da Hack Inova que entra no ar pela primeira vez avisa a comunidade
// inteira (notificação + fila de e-mail) — e só uma vez.

let n = 0;
async function member() {
  n++;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_launch_${n}`, `launch${n}`, `launch${n}@exemplo.com`);
  return r!.id;
}
async function edition(id: string, organizer: string, active: number) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
       VALUES (?, ?, ?, '2026-12-05T09:00:00-03:00', 'presencial', '', '[]', ?, 'painel')`,
    )
    .run(id, `Edição ${id}`, organizer, active);
}
const notes = async (id: string) =>
  Number(
    (await db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'edicao_nova' AND href = ?").get<{ n: number }>(`/h/${id}`))?.n,
  );

describe("anúncio de edição nova pra comunidade", () => {
  beforeEach(async () => {
    await member();
    await member();
  });

  it("edição Hack Inova publicada avisa todo membro, uma vez só", async () => {
    await edition("launch-hi", "Hack Inova", 1);
    const total = Number((await db.prepare("SELECT COUNT(*) n FROM members").get<{ n: number }>())?.n);
    const r = await announceEditionLaunch("launch-hi");
    expect(r?.notified).toBe(total);
    expect(r?.queued).toBeGreaterThan(0);
    expect(await notes("launch-hi")).toBe(total);
    expect(await announceEditionLaunch("launch-hi")).toBeNull();
    expect(await notes("launch-hi")).toBe(total);
  });

  it("rascunho e evento de outro organizador não anunciam", async () => {
    await edition("launch-draft", "Hack Inova", 0);
    await edition("launch-outro", "Comunidade X", 1);
    expect(await announceEditionLaunch("launch-draft")).toBeNull();
    expect(await announceEditionLaunch("launch-outro")).toBeNull();
    expect(await notes("launch-draft")).toBe(0);
    expect(await notes("launch-outro")).toBe(0);
  });
});
