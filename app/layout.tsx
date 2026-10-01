import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { appConfig } from "@/app.config";
import { Header } from "@/components/Header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: appConfig.name,
  description: appConfig.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: appConfig.accent,
          colorPrimaryForeground: "#0b0d0e",
          colorBackground: "#121517",
          colorForeground: "#e7e5e0",
          colorInput: "#0b0d0e",
          colorInputForeground: "#e7e5e0",
        },
      }}
    >
      <html
        lang="pt-BR"
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
        style={{ "--accent": appConfig.accent } as CSSProperties}
      >
        <body className="flex min-h-full flex-col">
          <Header />
          <main className="flex-1">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
