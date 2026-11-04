import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MascoteEditor } from "@/components/MascoteEditor";
import { bichoDoMembro, itemEstados } from "@/lib/mascote/evolucao";
import { currentMember } from "@/lib/session";

// Criador do bicho (migration 043, itens na 047). Só o dono, logado (o proxy
// já manda quem não tem sessão pro cadastro). Os itens que o fato destravou
// vêm marcados; os travados mostram o que fazer pra ganhar.

export const metadata: Metadata = { title: "seu bicho", robots: { index: false } };

export default async function BichoPage() {
  const member = await currentMember();
  if (!member) notFound();
  const [bicho, itens] = await Promise.all([bichoDoMembro(member.id), itemEstados(member.id)]);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-2">
        <Link href="/perfil#bicho" className="self-start font-mono text-xs text-muted underline-offset-4 hover:text-accent hover:underline">
          ← perfil
        </Link>
        <p className="tag self-start uppercase">seu bicho</p>
        <h1 className="text-[clamp(2rem,6vw,3.25rem)] leading-[0.95] font-extrabold tracking-[-0.035em]">Monte o seu</h1>
        <p className="max-w-[56ch] text-muted">
          {bicho.salvo
            ? "Troque o que quiser. Ele aparece no seu perfil assim que você salvar."
            : "Esse veio sorteado pelo seu número de cadastro. Troque o que quiser e salve."}
          {" Os itens só entram com fato verificado: presença, entrega, prêmio, mentoria e tempo de estrada."}
        </p>
      </div>
      <MascoteEditor
        inicial={bicho.config}
        salvo={bicho.salvo}
        estagio={bicho.estagio}
        itensIniciais={bicho.itens}
        itensDisponiveis={itens}
      />
    </section>
  );
}
