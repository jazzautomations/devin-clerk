import type { Metadata } from "next";
import Link from "next/link";
import { CommunityForm } from "@/components/CommunityForm";

export const metadata: Metadata = { title: "criar comunidade", robots: { index: false } };

// qualquer membro logado cria (o proxy manda quem não tem conta pro cadastro
// e traz de volta). Limite de 3 por dia na API.
export default function NovaComunidadePage() {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href="/comunidades" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← comunidades
        </Link>
        <p className="tag self-start">NOVA COMUNIDADE</p>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Crie sua comunidade.</h1>
        <p className="max-w-[48ch] text-[15.5px] leading-relaxed text-[#2b2b2b]">
          Dá um nome, diz a cidade e pronto. Depois você abre o primeiro hackathon e chama quem organiza junto.
        </p>
      </header>
      <CommunityForm />
    </section>
  );
}
