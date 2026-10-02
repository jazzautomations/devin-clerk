import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  articleJsonLd,
  buildRobots,
  buildSitemap,
  eventJsonLd,
  jsonLd,
  SITE_URL,
} from "@/lib/seo";

describe("SITE_URL / absoluteUrl", () => {
  it("fallback placeholder quando env não existe", () => {
    expect(SITE_URL).toMatch(/^https:\/\//);
    expect(absoluteUrl("/blog")).toBe(`${SITE_URL}/blog`);
    expect(absoluteUrl("radar")).toBe(`${SITE_URL}/radar`);
    expect(absoluteUrl("/")).toBe(`${SITE_URL}/`);
  });
});

describe("buildSitemap", () => {
  it("cobre rotas estáticas, edições /h/* e posts /blog/*", () => {
    const urls = buildSitemap().map((e) => e.url);
    for (const path of [
      "/",
      "/radar",
      "/feed",
      "/membros",
      "/talento",
      "/projetos",
      "/blog",
      "/empresas",
      "/legal/termos",
      "/legal/privacidade",
    ]) {
      expect(urls).toContain(absoluteUrl(path));
    }
    expect(urls).toContain(absoluteUrl("/h/hack-inova-unifacens-2026"));
    expect(urls).toContain(absoluteUrl("/h/hack-inova-alphaville-2026"));
    expect(urls.some((u) => u.startsWith(absoluteUrl("/blog/")))).toBe(true);
    // sem rotas privadas nem api
    expect(urls.some((u) => u.includes("/admin"))).toBe(false);
    expect(urls.some((u) => u.includes("/api"))).toBe(false);
    expect(urls.some((u) => u.includes("/dashboard"))).toBe(false);
  });
});

describe("buildRobots", () => {
  it("permite tudo e aponta o sitemap absoluto", () => {
    const robots = buildRobots();
    expect(robots.sitemap).toBe(absoluteUrl("/sitemap.xml"));
    const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
    expect(rules[0].userAgent).toBe("*");
    expect(rules[0].allow).toBe("/");
  });
});

describe("eventJsonLd — schema Event", () => {
  it("edição presencial vira Event com Place e Organization", () => {
    const ld = eventJsonLd({
      id: "hack-inova-unifacens-2026",
      name: "Hackathon Inova AI × Payment Shift",
      organizer: "Hack Inova × Unifacens · apoio Oracle + Enterprise X Ventures",
      startsAt: "2026-08-17T09:00:00-03:00",
      endsAt: "2026-08-17T18:00:00-03:00",
      format: "presencial",
      location: "UniFACENS, Sorocaba",
      registrationUrl: "https://hackinova.vercel.app",
      registrationDeadline: null,
      prize: "R$ 5 mil",
      tags: ["ia"],
      active: true,
      partner: true,
      requiresApproval: false,
    });
    expect(ld["@type"]).toBe("Event");
    expect(ld.name).toBe("Hackathon Inova AI × Payment Shift");
    expect(ld.startDate).toBe("2026-08-17T09:00:00-03:00");
    expect(ld.endDate).toBe("2026-08-17T18:00:00-03:00");
    expect(ld.location).toMatchObject({
      "@type": "Place",
      name: "UniFACENS, Sorocaba",
    });
    expect(ld.organizer).toMatchObject({ "@type": "Organization" });
    expect(ld.url).toBe(absoluteUrl("/h/hack-inova-unifacens-2026"));
  });

  it("edição online vira VirtualLocation", () => {
    const ld = eventJsonLd({
      id: "online-1",
      name: "Online Jam",
      organizer: "comunidade",
      startsAt: "2026-12-01T00:00:00Z",
      endsAt: null,
      format: "online",
      location: null,
      registrationUrl: "https://x.dev",
      registrationDeadline: null,
      prize: null,
      tags: [],
      active: true,
      partner: false,
      requiresApproval: false,
    });
    expect(ld.location).toMatchObject({ "@type": "VirtualLocation" });
  });
});

describe("articleJsonLd — schema Article", () => {
  it("post vira Article com headline, data, autor e url canônica", () => {
    const ld = articleJsonLd({
      slug: "recap-unifacens",
      title: "O que rolou no Hack Inova Unifacens",
      description: "Recap da 1ª edição.",
      date: "2026-08-20",
      author: "equipe hackahub",
      tags: ["recap"],
    });
    expect(ld["@type"]).toBe("Article");
    expect(ld.headline).toBe("O que rolou no Hack Inova Unifacens");
    expect(ld.datePublished).toBe("2026-08-20");
    expect(ld.author).toMatchObject({ name: "equipe hackahub" });
    expect(ld.publisher).toMatchObject({ "@type": "Organization" });
    expect(ld.mainEntityOfPage).toBe(absoluteUrl("/blog/recap-unifacens"));
  });
});

describe("jsonLd — serialização segura", () => {
  it("escapa < pra não fechar a tag script", () => {
    const out = jsonLd({ "@type": "Article", headline: "a</script>b" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script>");
    expect(JSON.parse(out).headline).toBe("a</script>b");
  });
});
