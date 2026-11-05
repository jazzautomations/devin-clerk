import type { Metadata } from "next";

// Anuncia o feed Atom do perfil (rss-aberto): o <link rel="alternate"> do
// segmento /u/[username] inteiro. A page.tsx deste segmento define o próprio
// alternates (canonical), que no Next SOBRESCREVE o do layout — o link do
// feed aparece nas páginas-filhas; na página do perfil ele entra quando a
// metadata dela ganhar types (documentado no PR).

export async function generateMetadata({ params }: LayoutProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  return { alternates: { types: { "application/atom+xml": `/u/${username}/feed.xml` } } };
}

export default function Layout({ children }: LayoutProps<"/u/[username]">) {
  return children;
}
