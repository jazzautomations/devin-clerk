import type { MetadataRoute } from "next";
import { buildSitemap } from "@/lib/seo";

// gerado por request: lê o banco (edições, perfis, projetos) — prerender no
// build serviria sitemap velho e exigiria banco na hora do build
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap();
}
