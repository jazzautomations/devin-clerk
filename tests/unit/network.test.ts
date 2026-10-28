import { afterEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { canNetwork } from "@/lib/network";
import { deleteMemberData } from "@/lib/privacy";

// canNetwork (spec 046, evidencia-e-lgpd): a porta única de toda superfície
// pública ou de contato. Conta excluída nunca aparece; menor só existe com
// HACKAHUB_ALLOW_MINORS=on, e aí fica fora da edição em que é menor.

let seq = 0;
async function member() {
  const t = `nw${seq++}`;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${t}`, `u_${t}`, `${t}@t.dev`);
  return r!.id;
}

async function edition(endsAt: string) {
  const id = `nw-ed-${seq++}`;
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, ?, 'Org', '2025-01-01T09:00:00-03:00', ?, 'presencial', '', '[]', 1, 'painel')`,
    )
    .run(id, `Hack ${id}`, endsAt);
  return id;
}

/** data de nascimento de quem faz `years` anos daqui a `days` dias (negativo = já fez) */
function bornYearsAgo(years: number, days = 0): string {
  const d = new Date(Date.now() - 3 * 3600_000); // dia de hoje em São Paulo
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function terms(memberId: number, hackathonId: string, age: number, birthDate = bornYearsAgo(age, -1)) {
  const r = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
    .get<{ id: number }>(memberId, hackathonId);
  await db
    .prepare("INSERT INTO edition_conduct_versions (hackathonId, version, text) VALUES (?, 1, 'x') ON CONFLICT DO NOTHING")
    .run(hackathonId);
  await db
    .prepare(
      `INSERT INTO registration_terms (registrationId, memberId, hackathonId, birthDate, ageAtEvent, conductVersion)
       VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(r!.id, memberId, hackathonId, birthDate, age);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canNetwork", () => {
  it("flag desligada: membro ativo true, excluído false, inexistente false", async () => {
    vi.stubEnv("HACKAHUB_ALLOW_MINORS", "");
    const ana = await member();
    const bia = await member();
    const h = await edition("2099-01-01T18:00:00-03:00");
    await terms(ana, h, 16); // dado velho de menor não vale com a flag desligada
    expect(await canNetwork(ana)).toBe(true);
    expect(await canNetwork(ana, h)).toBe(true);
    await deleteMemberData(bia);
    expect(await canNetwork(bia)).toBe(false);
    expect(await canNetwork(999_999)).toBe(false);
  });

  it("flag ligada: menor na edição fica fora dela; sem edição, vale a idade de hoje", async () => {
    vi.stubEnv("HACKAHUB_ALLOW_MINORS", "on");
    const caio = await member();
    const dani = await member();
    const edu = await member();
    const futura = await edition("2099-01-01T18:00:00-03:00");
    const passada = await edition("2025-01-02T18:00:00-03:00");
    const outra = await edition("2099-02-01T18:00:00-03:00");
    await terms(caio, futura, 16, bornYearsAgo(16));
    await terms(caio, outra, 17, bornYearsAgo(16));
    expect(await canNetwork(caio, futura)).toBe(false);
    expect(await canNetwork(caio)).toBe(false);
    // 17 numa edição que já acabou e ainda sem 18 hoje: continua fora
    await terms(dani, passada, 17, bornYearsAgo(18, 1));
    expect(await canNetwork(dani, passada)).toBe(false);
    expect(await canNetwork(dani)).toBe(false);
    // 17 na edição passada, mas já fez 18: fora dela, livre no resto
    await terms(edu, passada, 17, bornYearsAgo(18));
    expect(await canNetwork(edu, passada)).toBe(false);
    expect(await canNetwork(edu)).toBe(true);
    // excluído continua false mesmo adulto
    await deleteMemberData(edu);
    expect(await canNetwork(edu)).toBe(false);
  });

  it("flag ligada: adulto na edição é livre nela", async () => {
    vi.stubEnv("HACKAHUB_ALLOW_MINORS", "on");
    const fe = await member();
    const h = await edition("2099-03-01T18:00:00-03:00");
    await terms(fe, h, 18, bornYearsAgo(30));
    expect(await canNetwork(fe, h)).toBe(true);
    expect(await canNetwork(fe)).toBe(true);
  });
});
