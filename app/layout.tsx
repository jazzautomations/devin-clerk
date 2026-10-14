import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { ptBR } from "@clerk/localizations";
import { Archivo, JetBrains_Mono, VT323 } from "next/font/google";
import { appConfig } from "@/app.config";
import { SITE_URL } from "@/lib/seo";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

// tipografia da Hack Inova: Archivo (texto e títulos), JetBrains Mono
// (dados e rótulos), VT323 (acento pixel do HACKINOVA.OS)
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

const vt323 = VT323({
  variable: "--font-vt323",
  subsets: ["latin"],
  weight: "400",
});

// tudo SSR por request: radar/feed/membros/perfil servem dados vivos do
// banco — prerender estático serviria snapshot obsoleto da comunidade
// (e quebraria o e2e, que roda contra `next start` e seeda depois do build)
// Clerk em PT-BR e com o nosso nome — o nome do app no Clerk ("devin-clerk",
// herdado do workshop) não aparece em nenhuma tela
const clerkPtBR = {
  ...ptBR,
  signIn: {
    ...ptBR.signIn,
    start: {
      ...ptBR.signIn?.start,
      title: "Entrar no HackaHub",
      subtitle: "Bem-vindo de volta — entra pra continuar",
    },
  },
  signUp: {
    ...ptBR.signUp,
    start: {
      ...ptBR.signUp?.start,
      title: "Criar conta no HackaHub",
      subtitle: "Um perfil pra todas as edições",
    },
  },
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${appConfig.name} — sua comunidade de hackathon`,
    template: `%s — ${appConfig.name}`,
  },
  description: appConfig.description,
  openGraph: {
    siteName: appConfig.name,
    locale: "pt_BR",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider
      localization={clerkPtBR}
      appearance={{
        variables: {
          colorPrimary: "#0c0c0c",
          colorPrimaryForeground: "#fefefe",
          colorBackground: "#fefefe",
          colorForeground: "#0c0c0c",
          colorMutedForeground: "#474747",
          colorInput: "#fefefe",
          colorInputForeground: "#0c0c0c",
          colorNeutral: "#0c0c0c",
          colorDanger: "#ba3919",
          colorSuccess: "#047a43",
          borderRadius: "0",
          fontFamily: "var(--font-archivo), system-ui, sans-serif",
        },
        elements: {
          card: { border: "2px solid #0c0c0c", boxShadow: "6px 6px 0 rgba(12,12,12,.85)" },
          formButtonPrimary: { boxShadow: "none" },
        },
      }}
    >
      <html
        lang="pt-BR"
        className={`${archivo.variable} ${jetbrains.variable} ${vt323.variable} h-full antialiased`}
        style={{ "--accent": appConfig.accent } as CSSProperties}
      >
        <body className="flex min-h-full flex-col">
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </body>
      </html>
    </ClerkProvider>
  );
}
