import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import {
  brtInputToDb,
  dbToBrtInput,
  deriveStatus,
  getEntry,
  isEligibleForVoting,
  isLocked,
  judgedVersions,
  missingRequired,
  reopenEntry,
  saveDraft,
  submitEntry,
  toDbTime,
  updateSubmissionSettings,
  validateDraftPatch,
  type EntryFields,
  type SubmissionSettings,
} from "@/lib/entries";
import { getEditionEntriesView, getProjectView, visibleArchive } from "@/lib/entriesPublic";
import { getArchive } from "@/lib/archive";
import { currentReminder, runEntryReminders } from "@/lib/entryReminders";
import { submitTeam, updateTeamProject } from "@/lib/teams";

// entrega de projeto — spec 034 §5: estados, snapshot, trava com
// tolerância, reabertura, visibilidade e lembretes

const H = "hack-inova-alphaville-2026";
const T0 = new Date("2026-11-20T21:00:00Z"); // prazo: 20/11 18:00 em Brasília
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

const settings = (over: Partial<SubmissionSettings> = {}): SubmissionSettings => ({
  hackathonId: H,
  teamFormationDeadline: null,
  submissionOpensAt: null,
  submissionDeadline: toDbTime(T0),
  submissionGraceMinutes: 5,
  juryDeadline: null,
  requireRepo: true,
  requireVideo: false,
  requireSlides: false,
  requireAiUsage: false,
  entriesShowContent: true,
  ...over,
});

const full: Record<string, unknown> = {
  title: "Radar SUS",
  tagline: "fila do posto em tempo real",
  description: "## Problema\nfila\n## Solução\napp",
  priorWork: "nada antes do evento",
  technologies: ["Next.js", "Postgres"],
  repoUrl: "https://github.com/time/radar",
  videoUrl: "https://youtu.be/abc",
  links: [{ label: "figma", url: "https://figma.com/x" }],
  socialPosts: ["https://x.com/time/status/1"],
};

async function memberId(username: string, approved = true): Promise<number> {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(`clerk_${username}`, username, `${username}@t.dev`);
  const id = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))!.id;
  await db
    .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
    .run(id, H, approved ? "approved" : "pending");
  return id;
}

async function team(name: string, members: string[]) {
  for (const u of members) await memberId(u);
  return (await createTeam(H, { name, placement: 0, memberUsernames: members })).team.id;
}

async function setDeadline(deadline: Date | null, grace = 5) {
  await db
    .prepare("UPDATE hackathons SET submissionDeadline = ?, submissionGraceMinutes = ?, submissionOpensAt = NULL, teamFormationDeadline = NULL WHERE id = ?")
    .run(deadline ? toDbTime(deadline) : null, grace, H);
}

beforeEach(async () => {
  for (const t of ["deliveries", "announcement_reads", "announcements", "submission_events", "project_submissions", "project_challenges", "prize_winners", "prize_categories", "jury_results"]) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await db.exec(`DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM teams WHERE hackathonId = '${H}'`);
  await db.exec(`DELETE FROM registrations WHERE hackathonId = '${H}'`);
  await setDeadline(T0);
});

describe("puro — status, trava, datas, obrigatórios", () => {
  it("status deriva de versão enviada × trava", () => {
    expect(deriveStatus(false, false)).toBe("rascunho");
    expect(deriveStatus(true, false)).toBe("enviado");
    expect(deriveStatus(true, true)).toBe("travado");
    expect(deriveStatus(false, true)).toBe("nao_entregue");
  });

  it("trava só depois do prazo + tolerância; reabertura vigente destrava", () => {
    const s = settings();
    expect(isLocked(s, null, min(4))).toBe(false); // dentro da tolerância de 5 min
    expect(isLocked(s, null, min(5))).toBe(false);
    expect(isLocked(s, null, min(6))).toBe(true);
    expect(isLocked(s, toDbTime(min(60)), min(30))).toBe(false);
    expect(isLocked(s, toDbTime(min(60)), min(61))).toBe(true);
    expect(isLocked(settings({ submissionDeadline: null }), null, min(9999))).toBe(false);
  });

  it("datetime-local de Brasília ↔ UTC do banco", () => {
    expect(brtInputToDb("2026-11-20T18:00")).toBe("2026-11-20 21:00:00");
    expect(dbToBrtInput("2026-11-20 21:00:00")).toBe("2026-11-20T18:00");
    expect(brtInputToDb("")).toBeNull();
    expect(() => brtInputToDb("20/11/2026")).toThrow();
  });

  it("obrigatórios seguem a configuração da edição", () => {
    const f = { ...validateDraftPatch(full), challengeIds: [] } as EntryFields;
    expect(missingRequired(f, settings())).toEqual([]);
    expect(missingRequired({ ...f, tagline: null }, settings())).toEqual(["tagline"]);
    expect(missingRequired({ ...f, repoUrl: null }, settings())).toEqual(["repositório"]);
    expect(missingRequired({ ...f, repoUrl: null }, settings({ requireRepo: false }))).toEqual([]);
    expect(missingRequired(f, settings({ requireSlides: true, requireAiUsage: true }))).toEqual(["slides", "uso de IA"]);
  });

  it("valida campos: tagline ≤140, URLs http(s), links com rótulo", () => {
    expect(() => validateDraftPatch({ tagline: "x".repeat(141) })).toThrow(/140/);
    expect(() => validateDraftPatch({ repoUrl: "javascript:alert(1)" })).toThrow(/URL/);
    expect(validateDraftPatch({ links: [{ url: "https://a.dev/x" }] }).links).toEqual([{ label: "a.dev/x", url: "https://a.dev/x" }]);
    expect(validateDraftPatch({ technologies: ["Go", "go", " "] }).technologies).toEqual(["Go"]);
  });

  it("lembrete só na faixa atual (24h → 3h → 30min)", () => {
    expect(currentReminder(T0, min(-25 * 60))).toBeNull();
    expect(currentReminder(T0, min(-23 * 60))).toBe("lembrete_24h");
    expect(currentReminder(T0, min(-170))).toBe("lembrete_3h");
    expect(currentReminder(T0, min(-10))).toBe("lembrete_30m");
    expect(currentReminder(T0, min(1))).toBeNull();
  });
});

describe("rascunho → enviado → travado", () => {
  it("autosave grava lastSavedAt; enviar cria versão imutável; editar e reenviar gera v2", async () => {
    const t = await team("Radar", ["ana", "bia"]);
    const ana = await memberId("ana");
    let e = await saveDraft(t, { username: "ana" }, { title: "Radar SUS" }, min(-120));
    expect(e.status).toBe("rascunho");
    expect(e.lastSavedAt).toBe(toDbTime(min(-120)));
    expect(e.missing).toContain("tagline");

    await expect(submitEntry(t, { id: ana, username: "ana" }, min(-110))).rejects.toMatchObject({ status: 400 });
    e = await saveDraft(t, { username: "ana" }, full, min(-100));
    const { version } = await submitEntry(t, { id: ana, username: "ana" }, min(-90));
    expect(version).toBe(1);
    e = (await getEntry(t, min(-90)))!;
    expect(e.status).toBe("enviado");
    expect(e.dirty).toBe(false);

    await saveDraft(t, { username: "bia" }, { tagline: "nova tagline" }, min(-60));
    e = (await getEntry(t, min(-60)))!;
    expect(e.dirty).toBe(true);
    const v1 = await db.prepare("SELECT snapshot FROM project_submissions WHERE teamId = ? AND version = 1").get<{ snapshot: string }>(t);
    expect(JSON.parse(v1!.snapshot).tagline).toBe("fila do posto em tempo real");
    expect(JSON.parse(v1!.snapshot).members).toEqual(["ana", "bia"]);

    expect((await submitEntry(t, { id: ana, username: "ana" }, min(-50))).version).toBe(2);
    // confirmação foi pro time pelos avisos
    const ann = await db.prepare("SELECT COUNT(*) AS n FROM announcements WHERE teamId = ?").get<{ n: number }>(t);
    expect(ann!.n).toBe(2);
    expect((await getEntry(t, min(10)))!.status).toBe("travado");
  });

  it("não integrante não salva (403); integrante pendente bloqueia o envio", async () => {
    const t = await team("Pend", ["caio"]);
    const caio = await memberId("caio");
    await memberId("estranho");
    await expect(saveDraft(t, { username: "estranho" }, { title: "x" }, min(-60))).rejects.toMatchObject({ status: 403 });
    await saveDraft(t, { username: "caio" }, full, min(-60));
    await memberId("dani", false);
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, 'dani')").run(t);
    await expect(submitEntry(t, { id: caio, username: "caio" }, min(-50))).rejects.toMatchObject({
      status: 400,
      missing: ["integrantes aprovados"],
    });
  });

  it("depois do prazo + tolerância: campo avaliado 403, 'depois do hackathon' 200, PATCH antigo também trava", async () => {
    const t = await team("Trava", ["eva"]);
    const eva = await memberId("eva");
    await saveDraft(t, { username: "eva" }, full, min(-30));
    await submitEntry(t, { id: eva, username: "eva" }, min(-20));
    // dentro da tolerância ainda dá
    await saveDraft(t, { username: "eva" }, { tagline: "ajuste de última hora" }, min(3));
    await expect(saveDraft(t, { username: "eva" }, { tagline: "tarde" }, min(6))).rejects.toMatchObject({ status: 403 });
    await expect(submitEntry(t, { id: eva, username: "eva" }, min(6))).rejects.toMatchObject({ status: 403 });
    const after = await saveDraft(t, { username: "eva" }, { afterNotes: "ganhamos piloto na prefeitura" }, min(60));
    expect(after.afterNotes).toBe("ganhamos piloto na prefeitura");
    // a trava vale no relógio real também: prazo no passado
    await setDeadline(new Date(Date.now() - 3_600_000), 0);
    await expect(updateTeamProject(t, { username: "eva" }, { title: "porta dos fundos" })).rejects.toMatchObject({ status: 403 });
  });

  it("formação de times encerrada barra time novo (409)", async () => {
    await memberId("fabio");
    await db.prepare("UPDATE hackathons SET teamFormationDeadline = ? WHERE id = ?").run(toDbTime(new Date(Date.now() - 60_000)), H);
    await expect(submitTeam(H, { username: "fabio" }, { name: "Atrasado" })).rejects.toMatchObject({ status: 409 });
  });

  it("reabrir exige motivo; reaberto edita e reenvia; júri continua com a versão do prazo", async () => {
    const t = await team("Reab", ["gil"]);
    const gil = await memberId("gil");
    const org = await memberId("org_reab");
    await saveDraft(t, { username: "gil" }, full, min(-30));
    await submitEntry(t, { id: gil, username: "gil" }, min(-20));
    await expect(reopenEntry(H, t, org, { reason: "  " }, min(30))).rejects.toMatchObject({ status: 400 });
    await expect(reopenEntry(H, 999999, org, { reason: "x" }, min(30))).rejects.toMatchObject({ status: 404 });
    await reopenEntry(H, t, org, { reason: "deploy caiu na hora", minutes: 30 }, min(30));
    await saveDraft(t, { username: "gil" }, { tagline: "versão pós-reabertura" }, min(40));
    expect((await submitEntry(t, { id: gil, username: "gil" }, min(45))).version).toBe(2);
    const judged = (await judgedVersions(H)).get(t)!;
    expect(judged.version).toBe(1);
    expect(judged.snapshot.tagline).toBe("fila do posto em tempo real");
    expect((await getEntry(t, min(70)))!.status).toBe("travado");
    const log = await db.prepare("SELECT kind, reason FROM submission_events WHERE teamId = ? ORDER BY id").all<{ kind: string; reason: string | null }>(t);
    expect(log.map((l) => l.kind)).toEqual(["enviado", "reaberto", "enviado"]);
    expect(log[1].reason).toBe("deploy caiu na hora");
  });

  it("configurar prazos valida tolerância e ordem abertura < prazo", async () => {
    await expect(updateSubmissionSettings(H, { submissionGraceMinutes: 11 })).rejects.toMatchObject({ status: 400 });
    await expect(
      updateSubmissionSettings(H, { submissionOpensAt: "2026-11-21T10:00", submissionDeadline: "2026-11-20T18:00" }),
    ).rejects.toMatchObject({ status: 400 });
    const s = await updateSubmissionSettings(H, {
      submissionOpensAt: "2026-11-19T09:00",
      submissionDeadline: "2026-11-20T18:00",
      requireVideo: true,
    });
    expect(s.submissionDeadline).toBe("2026-11-20 21:00:00");
    expect(s.requireVideo).toBe(true);
  });
});

describe("visibilidade (matriz §5)", () => {
  async function seed() {
    const a = await team("Alfa", ["ivo"]);
    const b = await team("Beta", ["jo"]);
    const ivo = await memberId("ivo");
    await saveDraft(a, { username: "ivo" }, full, min(-30));
    await submitEntry(a, { id: ivo, username: "ivo" }, min(-20));
    await saveDraft(b, { username: "jo" }, { title: "Beta rascunho" }, min(-20));
    await db.prepare("UPDATE team_projects SET stageVideoUrl = 'https://youtu.be/palco' WHERE teamId = ?").run(a);
    return { a, b };
  }

  it("antes do prazo: só contagem; nada no arquivo nem na ficha pra quem é de fora", async () => {
    const { a } = await seed();
    const v = await getEditionEntriesView(H, min(-10));
    expect(v.phase).toBe("antes");
    expect(v.counts).toEqual({ teams: 2, submitted: 1 });
    expect(v.entries).toEqual([]);
    expect((await visibleArchive(H, await getArchive(H), min(-10))).teams).toEqual([]);
    const fora = await getProjectView(a, null, min(-10));
    expect(fora!.showContent).toBe(false);
    expect(fora!.fields).toBeNull();
    const ivoId = await memberId("ivo");
    const dono = await getProjectView(a, { id: ivoId, role: "member", username: "ivo" }, min(-10));
    expect(dono!.isDraftPreview).toBe(true);
  });

  it("depois do prazo: All Entries com status, conteúdo da versão avaliada; palco só após publicar", async () => {
    const { a, b } = await seed();
    let v = await getEditionEntriesView(H, min(30));
    expect(v.phase).toBe("depois");
    const alfa = v.entries.find((e) => e.teamId === a)!;
    expect(alfa).toMatchObject({ status: "travado", showContent: true, tagline: "fila do posto em tempo real", stageVideoUrl: null });
    expect(v.entries.find((e) => e.teamId === b)).toMatchObject({ status: "nao_entregue", showContent: false, title: null });

    await db.prepare("UPDATE hackathons SET entriesShowContent = 0 WHERE id = ?").run(H);
    v = await getEditionEntriesView(H, min(30));
    expect(v.entries.find((e) => e.teamId === a)).toMatchObject({ showContent: false, tagline: null, title: "Radar SUS" });

    await db.prepare("INSERT INTO jury_results (hackathonId) VALUES (?)").run(H);
    v = await getEditionEntriesView(H, min(30));
    expect(v.phase).toBe("publicado");
    expect(v.entries.find((e) => e.teamId === a)).toMatchObject({ showContent: true, stageVideoUrl: "https://youtu.be/palco" });
    const page = await getProjectView(a, null, min(30));
    expect(page!.judged?.version).toBe(1);
    expect(page!.stageVideoUrl).toBe("https://youtu.be/palco");
  });

  it("edição sem prazo segue no modo antigo", async () => {
    await setDeadline(null);
    const t = await team("Legado", ["lu"]);
    await saveDraft(t, { username: "lu" }, { title: "Antigo" });
    const v = await getEditionEntriesView(H);
    expect(v.phase).toBe("legado");
    expect(v.entries[0]).toMatchObject({ status: "travado", title: "Antigo", showContent: true });
    expect(await isEligibleForVoting(t)).toBe(true);
  });

  it("isEligibleForVoting: só enviado/travado no fluxo novo", async () => {
    const { a, b } = await seed();
    expect(await isEligibleForVoting(a)).toBe(true);
    expect(await isEligibleForVoting(b)).toBe(false);
  });
});

describe("lembretes", () => {
  it("T-3h vai só pra time em rascunho, 1 vez; aviso de trava 1 vez por time", async () => {
    const a = await team("Enviou", ["mel"]);
    const b = await team("Rascunho", ["nina"]);
    const mel = await memberId("mel");
    await saveDraft(a, { username: "mel" }, full, min(-300));
    await submitEntry(a, { id: mel, username: "mel" }, min(-290));
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM announcements").get<{ n: number }>())!.n;

    const r1 = await runEntryReminders(min(-170));
    expect(r1.reminders).toBe(1);
    expect((await runEntryReminders(min(-160))).reminders).toBe(0);
    const anns = await db
      .prepare("SELECT teamId, title FROM announcements ORDER BY id")
      .all<{ teamId: number; title: string }>();
    expect(anns.length).toBe(before + 1);
    expect(anns.at(-1)).toMatchObject({ teamId: b, title: "Faltam 3 horas pra entrega" });

    const lock = await runEntryReminders(min(20));
    expect(lock.lockNotices).toBe(2);
    expect((await runEntryReminders(min(25))).lockNotices).toBe(0);
  });
});
