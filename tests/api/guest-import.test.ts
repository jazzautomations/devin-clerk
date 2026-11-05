import db from "@/lib/db";
import { describe, expect, it } from "vitest";
import { importGuests, normalizeGuestEmail, stubClerkId } from "@/lib/guestImport";
import { getOrCreateMember } from "@/lib/members";

const HID = "edicao-teste-import";

async function seedEdition() {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, "startsAt", format, location, "registrationUrl", tags, active, source)
       VALUES (?, 'Edição Import', 'Teste', '2027-01-10T09:00:00-03:00', 'presencial', 'São Paulo', ?, '[]', 1, 'painel')`,
    )
    .run(HID, `/h/${HID}`);
}

describe("import de convidados", () => {
  it("normaliza e rejeita e-mail", () => {
    expect(normalizeGuestEmail("  Foo@Bar.com ")).toBe("foo@bar.com");
    expect(normalizeGuestEmail("sem-arroba")).toBeNull();
    expect(normalizeGuestEmail(null)).toBeNull();
  });

  it("stubClerkId é determinístico e estável", () => {
    expect(stubClerkId("A@B.com")).toBe(stubClerkId("a@b.com"));
    expect(stubClerkId("a@b.com")).toMatch(/^import:[0-9a-f]{24}$/);
  });

  it("cria membro stub e inscrição aprovada, idempotente", async () => {
    await seedEdition();
    const first = await importGuests(HID, [{ email: "convidado1@example.com", name: "Convidado Um" }]);
    expect(first.imported).toHaveLength(1);
    expect(first.imported[0].memberCreated).toBe(true);

    const reg = await db
      .prepare(`SELECT status FROM registrations WHERE "memberId" = ? AND "hackathonId" = ?`)
      .get<{ status: string }>(first.imported[0].memberId, HID);
    expect(reg?.status).toBe("approved");

    const second = await importGuests(HID, [{ email: "CONVIDADO1@example.com" }]);
    expect(second.imported).toHaveLength(1);
    expect(second.imported[0].memberCreated).toBe(false);
    expect(second.imported[0].memberId).toBe(first.imported[0].memberId);
    const n = await db
      .prepare(`SELECT COUNT(*)::int AS n FROM registrations WHERE "hackathonId" = ?`)
      .get<{ n: number }>(HID);
    expect(n!.n).toBe(1);
  });

  it("pula e-mail inválido e repetido na mesma planilha", async () => {
    await seedEdition();
    const r = await importGuests(HID, [
      { email: "ok@example.com" },
      { email: "ok@example.com" },
      { email: "nao-vale" },
    ]);
    expect(r.imported).toHaveLength(1);
    expect(r.skipped.map((s) => s.reason)).toEqual(["repetido na planilha", "e-mail inválido"]);
  });

  it("dry-run não escreve nada", async () => {
    await seedEdition();
    const r = await importGuests(HID, [{ email: "dry@example.com" }], { dryRun: true });
    expect(r.imported[0].memberCreated).toBe(true);
    const m = await db
      .prepare(`SELECT id FROM members WHERE LOWER(email) = 'dry@example.com'`)
      .get();
    expect(m).toBeUndefined();
  });

  it("primeiro login adota o membro importado (claim por e-mail)", async () => {
    await seedEdition();
    const r = await importGuests(HID, [{ email: "claim@example.com", name: "Claim Teste" }]);
    const stubId = r.imported[0].memberId;

    const member = await getOrCreateMember({
      id: "user_claim_123",
      firstName: "Claim",
      lastName: "Teste",
      email: "claim@example.com",
    });
    expect(member.id).toBe(stubId);
    expect(member.clerkId).toBe("user_claim_123");

    const reg = await db
      .prepare(`SELECT status FROM registrations WHERE "memberId" = ? AND "hackathonId" = ?`)
      .get<{ status: string }>(stubId, HID);
    expect(reg?.status).toBe("approved");
  });
});
