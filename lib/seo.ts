import type { MetadataRoute } from "next";
import { appConfig } from "@/app.config";
import { listPosts, type PostMeta } from "@/lib/blog";
import {
  getPastHackathons,
  getUpcomingHackathons,
  type Hackathon,
} from "@/lib/hackathons";
import { listMembers } from "@/lib/members";

// Camada de SEO (spec 009): base URL única, sitemap/robots e JSON-LD.
// NEXT_PUBLIC_SITE_URL em produção; placeholder explícito em dev/preview.

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://hackahub.dev"
).replace(/\/+$/, "");

export const SITE_NAME = appConfig.name;

export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

const STATIC_ROUTES: { path: string; priority: number; freq: "weekly" | "daily" }[] = [
  { path: "/", priority: 1, freq: "weekly" },
  { path: "/radar", priority: 0.9, freq: "daily" },
  { path: "/feed", priority: 0.7, freq: "daily" },
  { path: "/membros", priority: 0.6, freq: "daily" },
  { path: "/blog", priority: 0.8, freq: "weekly" },
];

export function buildSitemap(now = new Date()): MetadataRoute.Sitemap {
  const sitemap: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: absoluteUrl(r.path),
    changeFrequency: r.freq,
    priority: r.priority,
  }));

  const editions = [
    ...getUpcomingHackathons(now),
    ...getPastHackathons(now),
  ];
  for (const h of editions) {
    sitemap.push({
      url: absoluteUrl(`/h/${h.id}`),
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }
  for (const m of listMembers(500)) {
    sitemap.push({
      url: absoluteUrl(`/u/${m.username}`),
      changeFrequency: "weekly",
      priority: 0.4,
    });
  }
  for (const p of listPosts()) {
    sitemap.push({
      url: absoluteUrl(`/blog/${p.slug}`),
      lastModified: p.date,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }
  return sitemap;
}

export function buildRobots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

// JSON-LD -------------------------------------------------------------------

/** Serializa schema.org pra <script type="application/ld+json"> com escape. */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function eventJsonLd(h: Hackathon): Record<string, unknown> {
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
