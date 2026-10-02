import Link from "next/link";
import type { Metadata } from "next";

// Termos de uso (spec 022) — contrato honesto e curto: o que a plataforma é,
// de quem é o conteúdo, conduta e isenção.

export const metadata: Metadata = {
  title: "termos de uso",
  description:
    "Os termos de uso do hackahub: o que a plataforma é, de quem é o conteúdo postado, conduta esperada e limites de responsabilidade.",
  alternates: { canonical: "/legal/termos" },
};

export default function TermosPage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// legal"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          termos de uso
        </h1>
        <p className="text-muted">
          O combinado entre você e o hackahub. Direto ao ponto — se não concorda
          com algo aqui, não use a plataforma.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          o serviço
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          O hackahub é a rede social dos hackathons: páginas de edições,
          inscrição, feed, perfil público, arquivo de resultados e diretório de
          talento. Participante nunca paga — a receita vem de marcas que
          patrocinam desafios e edições.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          seu conteúdo
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          O que você posta (projetos, demos, comentários, perfil) continua seu.
          Você nos autoriza a exibir esse conteúdo publicamente na plataforma —
          é o propósito dela. Você responde pelo que publica: nada ilegal, nada
          que viole direito de terceiro.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          conduta
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Respeito é regra, não sugestão: sem assédio, spam, fraude ou conteúdo
          que atrapalhe a comunidade. A organização pode remover conteúdo e
          suspender conta que viole isso — avisando quando fizer sentido.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          resultados e arquivo
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Pódios, times e projetos de edições passadas são registro histórico
          público — parte do propósito da plataforma. Dados declarados pelo
          organizador da edição (colocação, time) são de responsabilidade dele.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          limites
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          A plataforma é oferecida como está: não garantimos disponibilidade
          contínua nem nos responsabilizamos por eventos de terceiros listados
          no radar — cada hackathon tem organizador e regras próprios.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          contato
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Dúvidas sobre estes termos: fala com a organização pelo formulário em{" "}
          <Link href="/empresas" className="text-accent hover:underline">
            /empresas
          </Link>{" "}
          ou nas sessões da comunidade.
        </p>
      </div>

      <p className="border-t border-line pt-6 font-mono text-[10px] text-muted">
        {"// última revisão: out/2026 · "}
        <Link href="/legal/privacidade" className="hover:text-accent">
          privacidade →
        </Link>
      </p>
    </section>
  );
}
