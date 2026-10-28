import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { parseInternalLink, resolveInternalLink } from "@/lib/linkCard";

// Card de link interno (migration 034): a parte pura decide se o link é do
// próprio HackaHub; a leitura respeita o que quem lê pode ver.

const HOSTS = ["hackahub.jazzautomations.com.br", "localhost:3100"];

describe("parseInternalLink", () => {
  it("caminho relativo e mesmo host apontando pras 4 páginas", () => {
    expect(parseInternalLink("/p/12", HOSTS)).toEqual({ kind: "projeto", teamId: 12 });
    expect(parseInternalLink("https://hackahub.jazzautomations.com.br/h/hack-inova-2026?x=1#a", HOSTS)).toEqual({
      kind: "edicao",
      id: "hack-inova-2026",
    });
    expect(parseInternalLink("http://localhost:3100/u/ana_dev/", HOSTS)).toEqual({ kind: "perfil", username: "ana_dev" });
    expect(parseInternalLink("/comunidade/hack-inova", HOSTS)).toEqual({ kind: "comunidade", slug: "hack-inova" });
    expect(parseInternalLink("HTTPS://HACKAHUB.JAZZAUTOMATIONS.COM.BR/p/3", HOSTS)).toEqual({ kind: "projeto", teamId: 3 });
  });

  it("link externo, outra rota, protocolo estranho e caminho torto ficam de fora", () => {
    for (const url of [
      "https://github.com/p/12",
      "https://hackahub.jazzautomations.com.br.evil.com/p/12",
      "//evil.com/p/12",
      "/\\evil.com/p/12",
      "/p/12/feedback",
      "/p/abc",
      "/feed",
      "/h/",
      "javascript:alert(1)",
      "ftp://hackahub.jazzautomations.com.br/p/1",
      "",
      "/u/%E0%A4%A",
    ]) {
      expect(parseInternalLink(url, HOSTS), url).toBeNull();
    }
  });
});

describe("resolveInternalLink", () => {
  it("perfil existente vira card; conta excluída e inexistente, não; externo nem consulta", async () => {
    await db
      .prepare("INSERT INTO members (clerkId, username, email, name, headline) VALUES ('clerk_lc1', 'lc_ana', 'lc1@t.dev', 'Ana LC', 'faz bot')")
      .run();
    await db.prepare("INSERT INTO members (clerkId, username, email) VALUES ('deleted:99', 'lc_fora', 'lc2@t.dev')").run();
    expect(await resolveInternalLink("/u/lc_ana", null)).toEqual({
      kind: "perfil",
      title: "Ana LC",
      subtitle: "@lc_ana · faz bot",
      href: "/u/lc_ana",
    });
    expect(await resolveInternalLink("/u/lc_fora", null)).toBeNull();
    expect(await resolveInternalLink("/u/ninguem_aqui", null)).toBeNull();
    expect(await resolveInternalLink("https://example.com/u/lc_ana", null)).toBeNull();
  });

  it("comunidade aberta vira card com cidade; edição ativa com data e local", async () => {
    await db.prepare("INSERT INTO communities (slug, name, city, verified) VALUES ('lc-com', 'LC Recife', 'Recife, PE', 1)").run();
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source, location)
         VALUES ('lc-ed', 'LC Hack', 'Org', '2026-03-05T09:00:00-03:00', 'presencial', '', '[]', 1, 'painel', 'Recife, PE')`,
      )
      .run();
    expect(await resolveInternalLink("/comunidade/lc-com", null)).toEqual({
      kind: "comunidade",
      title: "LC Recife",
      subtitle: "Recife, PE · verificada",
      href: "/comunidade/lc-com",
    });
    const ed = await resolveInternalLink("/h/lc-ed", null);
    expect(ed).toMatchObject({ kind: "edicao", title: "LC Hack", href: "/h/lc-ed" });
    expect(ed!.subtitle).toContain("Recife, PE");
    expect(ed!.subtitle).toContain("2026");
  });
});
