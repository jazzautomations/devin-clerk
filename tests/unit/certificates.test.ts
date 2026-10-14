import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { grantEditionRole } from "@/lib/roles";
import { addCriterion, assignAll, publishResults, saveScores } from "@/lib/jury";
import {
  attendeesForCertificates,
  getCertificate,
  issueCertificates,
  listMemberCertificates,
  newCertificateCode,
} from "@/lib/certificates";
import { certificatePdf } from "@/lib/certificatePdf";

// certificado verificável — spec 033 US6 / FR-007

const H = "hack-inova-alphaville-2026";

async function memberId(username: string, name: string | null = null): Promise<number> {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
    .run(`clerk_${username}`, username, `${username}@t.dev`, name);
  return (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))!.id;
}

async function register(id: number, status = "approved", checkedIn = true) {
  await db
    .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
    .run(id, H, status);
  if (checkedIn) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO checkins (registrationId)
         SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?`,
      )
      .run(id, H);
  }
}

beforeEach(async () => {
  for (const t of ["checkins", "certificates", "scores", "judge_assignments", "rubric_criteria", "jury_results", "edition_roles"]) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await db.exec(`DELETE FROM registrations WHERE hackathonId = '${H}'`);
  await db.exec(`DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM teams WHERE hackathonId = '${H}'`);
});

describe("código do certificado", () => {
  it("10 caracteres base32 sem ambiguidade, não sequencial", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => newCertificateCode()));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  });
});

describe("emissão", () => {
  it("participação só pra aprovado com check-in; sem presença ou pendente fica fora", async () => {
    const ok = await memberId("cert_ok", "Ana Presente");
    const pend = await memberId("cert_pend");
    const faltou = await memberId("cert_faltou");
    await register(ok);
    await register(pend, "pending");
    await register(faltou, "approved", false);
    expect(await attendeesForCertificates(H)).toEqual([ok]);
    const res = await issueCertificates(H);
    expect(res.created).toBe(1);
    const mine = await listMemberCertificates(ok);
    expect(mine).toEqual([expect.objectContaining({ kind: "participacao", hackathonId: H })]);
    expect(await listMemberCertificates(pend)).toEqual([]);
  });

  it("papéis viram mentoria/jurado/organização e o pódio publicado vira premiação", async () => {
    const mentor = await memberId("cert_mentor");
    const jur = await memberId("cert_jur");
    const org = await memberId("cert_org");
    const staff = await memberId("cert_staff");
    const campea = await memberId("cert_campea");
    await grantEditionRole(H, mentor, "mentor", null);
    await grantEditionRole(H, jur, "jurado", null);
    await grantEditionRole(H, org, "organizador", null);
    await grantEditionRole(H, staff, "staff", null);
    await register(campea);
    const t = (await createTeam(H, { name: "Campeões", placement: 0, memberUsernames: ["cert_campea"] })).team.id;

    // sem resultado publicado: ninguém ganha premiação ainda
    await issueCertificates(H);
    expect((await listMemberCertificates(campea)).map((c) => c.kind)).toEqual(["participacao"]);

    const c = await addCriterion(H, { label: "Impacto", weight: 1 });
    await assignAll(H);
    await saveScores(H, jur, t, [{ criterionId: c.id, score: 5 }], null);
    await publishResults(H, org);
    await issueCertificates(H);

    const kinds = async (id: number) => (await listMemberCertificates(id)).map((x) => x.kind).sort();
    expect(await kinds(mentor)).toEqual(["mentoria"]);
    expect(await kinds(jur)).toEqual(["jurado"]);
    expect(await kinds(org)).toEqual(["organizacao"]);
    expect(await kinds(staff)).toEqual(["organizacao"]);
    expect(await kinds(campea)).toEqual(["participacao", "premiacao"]);
    const premio = (await listMemberCertificates(campea)).find((x) => x.kind === "premiacao")!;
    expect(premio.detail).toMatch(/1º lugar.*Campeões/);
  });

  it("reemitir não duplica nem troca o código", async () => {
    const a = await memberId("cert_idem");
    await register(a);
    const first = await issueCertificates(H);
    const [before] = await listMemberCertificates(a);
    const second = await issueCertificates(H);
    const after = await listMemberCertificates(a);
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(after).toHaveLength(1);
    expect(after[0].code).toBe(before.code);
  });
});

describe("verificação e PDF", () => {
  it("getCertificate devolve nome, edição e tipo; código desconhecido é null; minúsculo também vale", async () => {
    const a = await memberId("cert_ver", "Bia Verificada");
    await register(a);
    await issueCertificates(H);
    const [c] = await listMemberCertificates(a);
    const got = await getCertificate(c.code);
    expect(got).toMatchObject({ code: c.code, memberName: "Bia Verificada", kind: "participacao", hackathonId: H });
    expect(got!.hackathonName).toBeTruthy();
    expect(await getCertificate(c.code.toLowerCase())).toMatchObject({ code: c.code });
    expect(await getCertificate("NAOEXISTE0")).toBeNull();
    expect(await getCertificate("x'; DROP")).toBeNull();
  });

  it("PDF sai como bytes de PDF de verdade", async () => {
    const a = await memberId("cert_pdf", "Caio Ção");
    await register(a);
    await issueCertificates(H);
    const [c] = await listMemberCertificates(a);
    const bytes = await certificatePdf((await getCertificate(c.code))!, "https://hackahub.test");
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5000);
  });
});
