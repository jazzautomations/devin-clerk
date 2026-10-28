import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import db from "@/lib/db";
import { columnExists, getNetworkMetrics, publicProfileShare, relationExists, testimonialCoverage } from "@/lib/metrics";

// Painel de métricas antes do depoimento (migration 037) e do perfil aberto
// (041) chegarem. Arquivo próprio: o PGlite é um banco limpo por arquivo, só
// com o que está em migrations/. Quando a migration existir, o bloco dela é
// pulado e quem confere os números é metricas.test.ts.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const HAS_TESTIMONIALS = await relationExists("team_testimonials");
const HAS_PUBLIC_PROFILE = await columnExists("members", "publicProfile");
const NOW = new Date("2031-03-12T15:00:00Z");

beforeAll(async () => {
  await db.prepare("INSERT INTO members (clerkId, username, email, role) VALUES ('clerk_msf', 'u_msf', 'msf@t.dev', 'admin')").run();
  clerk.uid = "clerk_msf";
});

async function adminHtml() {
  const { default: MetricasPage } = await import("@/app/admin/metricas/page");
  return renderToStaticMarkup(await MetricasPage());
}

describe("feature ainda fora do ar vira null, não erro", () => {
  it.skipIf(HAS_TESTIMONIALS)("sem team_testimonials: cobertura null e o painel avisa", async () => {
    expect(await testimonialCoverage(NOW)).toBeNull();
    expect((await getNetworkMetrics({ now: NOW })).testimonials).toBeNull();
    const html = await adminHtml();
    expect(html).toContain("O depoimento de time ainda não está no ar.");
    expect(html).toMatch(/data-testid="checkpoint-depoimento-value"[^>]*>—</);
  });

  it.skipIf(HAS_PUBLIC_PROFILE)("sem members.publicProfile: perfil aberto null e o painel avisa", async () => {
    expect(await publicProfileShare()).toBeNull();
    expect((await getNetworkMetrics({ now: NOW })).publicProfile).toBeNull();
    const html = await adminHtml();
    expect(html).toContain("O perfil aberto ainda não está no ar.");
    expect(html).toMatch(/data-testid="now-perfil-aberto-value"[^>]*>—</);
  });
});
