import type { Metadata } from "next";

// Anuncia o feed Atom do diário do projeto (rss-aberto) em /p/[teamId] e
// filhas. A page.tsx do segmento não define alternates: o link sai.

export async function generateMetadata({ params }: LayoutProps<"/p/[teamId]">): Promise<Metadata> {
  const { teamId } = await params;
  return { alternates: { types: { "application/atom+xml": `/p/${teamId}/feed.xml` } } };
}

export default function Layout({ children }: LayoutProps<"/p/[teamId]">) {
  return children;
}
