import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import db from "@/lib/db";
import {
  audienceCounts,
  listAnnouncementsForAdmin,
  listEditionTeams,
  processDeliveries,
  publishAnnouncement,
  requeueNoDriver,
} from "@/lib/announcements";
import { channelsEnabled } from "@/lib/notify/channels";
import { announcementReach } from "@/lib/notify/reach";
import { emailDriver, emailReplyTo } from "@/lib/notify/email";

// auditoria 041 pacote E — a interface só promete o canal que existe, o
// "pulado por canal desligado" fica marcado (no_driver) e volta pra fila
// quando a chave aparece.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const H = "avisos-canais";
const LIVE = { RESEND_API_KEY: "re_test" };

let seq = 0;
async function registered(status = "approved"): Promise<number> {
  const tag = `ch${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`);
  await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
    .run(row!.id, H, status);
  return row!.id;
}

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  await db.prepare("DELETE FROM deliveries").run();
  await db.prepare("DELETE FROM announcements").run();
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(H);
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, source)
       VALUES (?, 'Avisos Canais', 'Hack Inova', '2027-01-01', 'presencial', 'https://x.dev', 'painel')`,
    )
    .run(H);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("channelsEnabled", () => {
  it("sem env: e-mail e WhatsApp desligados", () => {
    expect(channelsEnabled({})).toEqual({ email: false, whatsapp: false });
  });

  it("liga cada canal só com a chave dele (WhatsApp precisa das 3)", () => {
    expect(channelsEnabled({ RESEND_API_KEY: "k" })).toEqual({ email: true, whatsapp: false });
    expect(channelsEnabled({ EVOLUTION_URL: "https://e", EVOLUTION_INSTANCE: "i" }).whatsapp).toBe(false);
    expect(
      channelsEnabled({ EVOLUTION_URL: "https://e", EVOLUTION_INSTANCE: "i", EVOLUTION_API_KEY: "a" }).whatsapp,
    ).toBe(true);
  });

  it("onde o aviso aparece, em texto, conforme os canais", () => {
    expect(announcementReach({ email: false, whatsapp: false })).toBe("na página da edição e no sino");
    expect(announcementReach({ email: true, whatsapp: false })).toBe("na página da edição, no sino e por e-mail");
    expect(announcementReach({ email: true, whatsapp: true })).toBe(
      "na página da edição, no sino, por e-mail e por WhatsApp pra quem optou",
    );
  });
});

describe("AnnouncementComposer", () => {
  async function render(props: Record<string, unknown>) {
    const { AnnouncementComposer } = await import("@/components/AnnouncementComposer");
    return renderToStaticMarkup(
      createElement(AnnouncementComposer, {
        hackathonId: H,
        teams: [],
        counts: { todos: 3, aprovados: 1, presentes: 0 },
        channels: channelsEnabled({}),
        ...props,
      } as never),
    );
  }

  it("sem canal externo, promete só página e sino", async () => {
    const html = await render({});
    expect(html).toContain("O texto aparece na página da edição e no sino.");
    expect(html).not.toMatch(/e-mail|WhatsApp/);
  });

  it("com o Resend ligado, cita o e-mail", async () => {
    const html = await render({ channels: channelsEnabled(LIVE) });
    expect(html).toContain("no sino e por e-mail");
  });

  it("público com 0 pessoas bloqueia o envio e diz por quê", async () => {
    const html = await render({ counts: { todos: 0, aprovados: 0, presentes: 0 } });
    expect(html).toContain('data-testid="audience-empty"');
    expect(html).toMatch(/<button type="submit"[^>]*disabled/);
  });
});

describe("skipped por canal desligado (no_driver)", () => {
  it("sem chave: e-mail fica 'skipped' com reason no_driver e o painel agrupa o motivo", async () => {
    await registered();
    const a = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "t", body: "b" });
    await processDeliveries(50, { env: {} });
    const row = await db
      .prepare("SELECT status, reason FROM deliveries WHERE announcementId = ? AND channel = 'email'")
      .get<{ status: string; reason: string | null }>(a.id);
    expect(row).toEqual({ status: "skipped", reason: "no_driver" });
    const [admin] = await listAnnouncementsForAdmin(H);
    expect(admin.stats.email.skipped).toBe(1);
    expect(admin.noDriver.email).toBe(1);
  });

  it("depois de pôr a RESEND_API_KEY, o worker reenfileira e envia o que foi pulado por falta de chave", async () => {
    await registered();
    const a = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "t", body: "b" });
    await processDeliveries(50, { env: {} });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await processDeliveries(50, { env: LIVE });
    expect(r.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = await db
      .prepare("SELECT status, reason FROM deliveries WHERE announcementId = ? AND channel = 'email'")
      .get<{ status: string; reason: string | null }>(a.id);
    expect(row).toEqual({ status: "sent", reason: null });
  });

  it("aviso com mais de 7 dias não volta (notícia velha confunde) e outro motivo de skip nunca volta", async () => {
    await registered();
    const a = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "t", body: "b" });
    await processDeliveries(50, { env: {} });
    await db.prepare("UPDATE announcements SET createdAt = '2020-01-01 00:00:00' WHERE id = ?").run(a.id);
    expect(await requeueNoDriver({ env: LIVE })).toBe(0);
    await db.prepare("UPDATE announcements SET createdAt = sqlite_now() WHERE id = ?").run(a.id);
    await db.prepare("UPDATE deliveries SET reason = NULL WHERE announcementId = ?").run(a.id);
    expect(await requeueNoDriver({ env: LIVE })).toBe(0);
  });

  it("sem chave nenhuma o reenfileiramento não faz nada", async () => {
    expect(await requeueNoDriver({ env: {} })).toBe(0);
  });
});

describe("fan-out em lote e contagens do composer", () => {
  it("um INSERT só cria inapp + email por inscrito e é idempotente", async () => {
    await registered("approved");
    await registered("pending");
    await registered("waitlist");
    await registered("rejected");
    const a = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "t", body: "b" });
    expect(a.queued).toBe(6);
    const counts = await audienceCounts(H);
    expect(counts).toEqual({ todos: 3, aprovados: 1, presentes: 0 });
  });

  it("times vêm com o número de integrantes", async () => {
    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, 'Time Vazio') RETURNING id")
      .get<{ id: number }>(H);
    const teams = await listEditionTeams(H);
    expect(teams.find((x) => x.id === t!.id)?.members).toBe(0);
  });
});

describe("e-mail: reply-to", () => {
  it("emailReplyTo só existe com Resend ligado e endereço configurado", () => {
    expect(emailReplyTo({})).toBeNull();
    expect(emailReplyTo({ HACKAHUB_EMAIL_REPLY_TO: "org@x.dev" })).toBeNull();
    expect(emailReplyTo({ RESEND_API_KEY: "k", HACKAHUB_EMAIL_REPLY_TO: " org@x.dev " })).toBe("org@x.dev");
  });

  it("o driver manda reply_to pro Resend", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await emailDriver({ RESEND_API_KEY: "k", HACKAHUB_EMAIL_REPLY_TO: "org@x.dev" }).send({
      to: "a@b.dev",
      subject: "s",
      html: "<p>x</p>",
      text: "x",
      idempotencyKey: "k1",
    });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.reply_to).toBe("org@x.dev");
  });
});
