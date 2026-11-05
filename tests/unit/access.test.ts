import { describe, expect, it } from "vitest";
import { decideAccess, isPublicApi, isPublicPage } from "@/lib/access";

// spec 039 — allowlist: o que não está na lista exige login.
const anon = { signedIn: false, onboarded: false };
const novo = { signedIn: true, onboarded: false };
const pronto = { signedIn: true, onboarded: true };

const PUBLICAS = [
  "/",
  "/organizar",
  "/empresas",
  "/legal/termos",
  "/legal/privacidade",
  "/sign-in",
  "/sign-in/factor-one",
  "/sign-up",
  "/c/ABCD1234",
  "/c/ABCD1234/pdf",
  "/h/hack-inova-alphaville-2026",
  "/h/hack-inova-alphaville-2026/conduta",
  "/h/hack-inova-alphaville-2026/incidente",
  "/h/hack-inova-alphaville-2026/telao",
  "/h/hack-inova-alphaville-2026/programacao.ics",
  "/h/hack-inova-alphaville-2026/opengraph-image",
  "/u/marina.builds",
  "/p/12",
  "/p/12/opengraph-image",
  "/comunidade/hack-inova",
  "/u/marina.builds/feed.xml",
  "/p/12/feed.xml",
  "/comunidade/hack-inova/feed.xml",
  "/radar",
  "/rsvp/token.assinado",
  "/demo/time-x/",
  "/demo/time-x/assets/app.js",
  "/opengraph-image",
  "/sitemap.xml",
  "/robots.txt",
];

const PRIVADAS = [
  "/feed",
  "/membros",
  "/projetos",
  "/talento",
  "/blog",
  "/blog/o-que-rolou",
  "/dashboard",
  "/perfil",
  "/notificacoes",
  "/bem-vindo",
  "/admin",
  "/admin/h/x/palco",
  "/h/x/inscricao",
  "/h/x/ingresso",
  "/h/x/entrega",
  "/h/x/programacao",
  "/h/x/programacao/12.ics",
  "/h/x/projetos",
  "/h/x/duvidas",
  "/h/x/votar",
  "/h/x/nps",
  "/h/x/candidatura/mentor",
  "/h/x/patrocinador/oracle",
  "/p/12/feedback",
  "/comunidades",
  "/comunidades/nova",
  "/comunidade/hack-inova/editar",
  "/comunidade/hack-inova/hackathon/novo",
  "/comunidade/hack-inova/s/ajuda",
  "/comunidade/hack-inova/espacos",
  "/legalidade",
  "/organizar/outra-coisa",
];

describe("páginas públicas", () => {
  it.each(PUBLICAS)("%s abre sem login", (p) => {
    expect(isPublicPage(p)).toBe(true);
    expect(decideAccess(p, anon)).toBe("next");
  });
});

describe("páginas privadas", () => {
  it.each(PRIVADAS)("%s manda anon pro cadastro", (p) => {
    expect(isPublicPage(p)).toBe(false);
    expect(decideAccess(p, anon)).toBe("signup");
  });
  it("logado e onboarded passa", () => {
    for (const p of PRIVADAS) expect(decideAccess(p, pronto)).toBe("next");
  });
});

describe("onboarding", () => {
  it("membro novo cai no /bem-vindo na primeira página logada", () => {
    expect(decideAccess("/dashboard", novo)).toBe("onboarding");
    expect(decideAccess("/h/x/inscricao", novo)).toBe("onboarding");
  });
  it("sem loop: /bem-vindo, API e sign-in/up ficam fora", () => {
    expect(decideAccess("/bem-vindo", novo)).toBe("next");
    expect(decideAccess("/api/onboarding", novo)).toBe("next");
    expect(decideAccess("/sign-up", novo)).toBe("next");
  });
  it("página pública não força onboarding", () => {
    expect(decideAccess("/", novo)).toBe("next");
    expect(decideAccess("/h/x", novo)).toBe("next");
  });
});

describe("API", () => {
  it.each([
    "/api/health",
    "/api/leads",
    "/api/subscribe",
    "/api/subscribe/confirm",
    "/api/subscribe/unsubscribe",
    "/api/webhooks/resend",
    "/api/cron/rsvp",
    "/api/rsvp/tok",
    "/api/me/calendar/tok",
    "/api/hackathons/x/incidents",
    "/api/hackathons/x/stage",
    "/api/hackathons/x/stage/stream",
  ])("%s é pública", (p) => {
    expect(isPublicApi(p)).toBe(true);
    expect(decideAccess(p, anon)).toBe("next");
  });
  it.each(["/api/posts", "/api/hackathons", "/api/members/me", "/api/me/calendar", "/api/hackathons/x/stage/vote", "/api/onboarding", "/api/roadmap", "/api/communities", "/api/communities/hack-inova/members", "/api/admin/communities/hack-inova"])(
    "%s sem sessão é 401",
    (p) => {
      expect(decideAccess(p, anon)).toBe("unauthorized");
      expect(decideAccess(p, novo)).toBe("next");
    },
  );
});
