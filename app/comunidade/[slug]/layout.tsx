import type { Metadata } from "next";

// Anuncia o feed Atom do mural da comunidade (rss-aberto) no segmento
// /comunidade/[slug] inteiro. Na página da comunidade o link sai também
// porque a generateMetadata dela declara o types (canonical + feed).

export async function generateMetadata({ params }: LayoutProps<"/comunidade/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { alternates: { types: { "application/atom+xml": `/comunidade/${slug}/feed.xml` } } };
}

export default function Layout({ children }: LayoutProps<"/comunidade/[slug]">) {
  return children;
}
