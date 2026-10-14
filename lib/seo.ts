import type { MetadataRoute } from "next";
import { appConfig } from "@/app.config";
import { type PostMeta } from "@/lib/blog";
import {
  getOpenHackathons,
  getPastHackathons,
  type Hackathon,
} from "@/lib/hackathons";
import { isProductionSite } from "@/lib/site";

// Camada de SEO (spec 009): base URL única, sitemap/robots e JSON-LD.
// NEXT_PUBLIC_SITE_URL em produção; placeholder explícito em dev/preview.

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://hackahub.dev"
).replace(/\/+$/, "");

export const SITE_NAME = appConfig.name;

export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// spec 039 — só rota PÚBLICA (lib/access) entra no sitemap: o resto da
// plataforma é logado e redirecionaria o crawler pro cadastro
const STATIC_ROUTES: { path: string; priority: number; freq: "weekly" | "daily" }[] = [
  { path: "/", priority: 1, freq: "weekly" },
  { path: "/organizar", priority: 0.8, freq: "weekly" },
  { path: "/empresas", priority: 0.7, freq: "weekly" },
  { path: "/legal/termos", priority: 0.2, freq: "weekly" },
  { path: "/legal/privacidade", priority: 0.2, freq: "weekly" },
];

export async function buildSitemap(now = new Date()): Promise<MetadataRoute.Sitemap> {
  const sitemap: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: absoluteUrl(r.path),
    changeFrequency: r.freq,
    priority: r.priority,
  }));

  const editions = [
    ...await getOpenHackathons(now),
    ...await getPastHackathons(now),
  ];
  for (const h of editions) {
    sitemap.push({
      url: absoluteUrl(`/h/${h.id}`),
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }
  return sitemap;
}

export function buildRobots(siteUrl: string = SITE_URL): MetadataRoute.Robots {
  // stage e preview são públicos (Clerk dev aceita qualquer cadastro): fora
  // do domínio de produção nada é indexável
  if (!isProductionSite(siteUrl)) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    // a plataforma logada nem é rastreável (redireciona pro cadastro); o
    // disallow evita o crawler gastar requisição nela
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/dashboard",
        "/perfil",
        "/bem-vindo",
        "/notificacoes",
        "/radar",
        "/feed",
        "/membros",
        "/projetos",
        "/talento",
        "/blog",
        "/rsvp/",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

// JSON-LD -------------------------------------------------------------------

/** Serializa schema.org pra <script type="application/ld+json"> com escape. */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** item publicado e aberto da programação (lib/schedule) — UTC "YYYY-MM-DD HH:MM:SS" */
export type SubEventInput = { id: number; title: string; startsAt: string; endsAt: string; room: string };

const utcIso = (t: string) => `${t.replace(" ", "T")}Z`;

export function eventJsonLd(h: Hackathon, subEvents: SubEventInput[] = []): Record<string, unknown> {
  const online = h.format === "online";
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: h.name,
    description: `${h.name} — hackathon ${h.format === "hibrido" ? "híbrido" : h.format} organizado por ${h.organizer}.`,
    startDate: h.startsAt,
    ...(h.endsAt ? { endDate: h.endsAt } : {}),
    eventAttendanceMode: online
      ? "https://schema.org/OnlineEventAttendanceMode"
      : "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    location: online
      ? { "@type": "VirtualLocation", url: absoluteUrl(`/h/${h.id}`) }
      : { "@type": "Place", name: h.location ?? "Online" },
    organizer: {
      "@type": "Organization",
      name: h.organizer,
      url: SITE_URL,
    },
    url: absoluteUrl(`/h/${h.id}`),
    ...(subEvents.length
      ? {
          subEvent: subEvents.map((s) => ({
            "@type": "Event",
            name: s.title,
            startDate: utcIso(s.startsAt),
            endDate: utcIso(s.endsAt),
            eventAttendanceMode: online
              ? "https://schema.org/OnlineEventAttendanceMode"
              : "https://schema.org/OfflineEventAttendanceMode",
            location: online
              ? { "@type": "VirtualLocation", url: absoluteUrl(`/h/${h.id}/programacao`) }
              : { "@type": "Place", name: [s.room, h.location].filter(Boolean).join(" · ") || "Online" },
            url: absoluteUrl(`/h/${h.id}/programacao#item-${s.id}`),
          })),
        }
      : {}),
  };
}

export function articleJsonLd(post: PostMeta): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    inLanguage: "pt-BR",
    author: { "@type": "Organization", name: post.author, url: SITE_URL },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
    ...(post.tags.length ? { keywords: post.tags.join(", ") } : {}),
  };
}
