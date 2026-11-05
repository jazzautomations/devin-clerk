import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CopilotBox } from "@/components/CopilotBox";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "copilot", robots: { index: false } };

// /copilot (spec 046, onda 6: copilot-do-arquivo, migration 055): o
// assistente do arquivo. "Já fizeram isso?", "quem usou X?", "quem
// ganhou?" — a resposta cita projetos, campeões, desafios e regras do
// próprio HackaHub, sempre com link. Com LLM configurado vem um resumo que
// só cita esses fatos; sem, a página entrega os mesmos resultados. IA
// nunca dá nota nem escolhe vencedor.
export default async function CopilotPage() {
  const me = await currentMember();
  if (!me) redirect("/sign-up?redirect_url=%2Fcopilot");
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-none font-extrabold tracking-[-0.04em]">Copilot do arquivo</h1>
        <p className="text-[15px] text-muted">
          Pergunte em português: já fizeram isso? quem usou essa stack? quem ganhou? A resposta cita o que existe
          no HackaHub — projetos, campeões, desafios e regras — sempre com link.
        </p>
      </header>
      <CopilotBox />
    </section>
  );
}
