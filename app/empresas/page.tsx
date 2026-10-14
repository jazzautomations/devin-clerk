import Link from "next/link";
import type { Metadata } from "next";
import { empresaStats } from "@/lib/empresasStats";
import { LeadForm } from "@/components/LeadForm";

// Porta comercial (spec 022): participante nunca paga — quem paga é a marca.
// A página vende o que já existe: desafio patrocinado, presença no arquivo/
// radar e talento que entrega. O formulário vira lead na fila do /admin.

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "empresas",
    description:
      "Sua marca na frente de quem constrói: desafio patrocinado numa edição, presença permanente no radar e acesso a talento que prova em hackathon.",
    alternates: { canonical: "/empresas" },
  };
}

const oferta = [
  {
    num: "01",
    title: "Desafio patrocinado",
    desc: (
      <>
        Sua marca lança um desafio real dentro de uma edição — contexto, dados
        e prêmio. Foi assim que a Oracle rodou a jornada do paciente na edição
        da PUC e que a 1ª edição na Unifacens pagou{" "}
        <span className="text-lendario">R$5 mil</span> pro time vencedor.
      </>
    ),
  },
  {
    num: "02",
    title: "Presença no radar e no arquivo",
    desc: (
      <>
        A edição vira arquivo público permanente. Times, projetos, pódio e a
        marca do patrocinador ficam no histórico, com link e aparecendo na
        busca. É prova que fica.
      </>
    ),
  },
  {
    num: "03",
    title: "Talento",
    desc: (
      <>
        O diretório{" "}
        <Link href="/talento" className="link-inline">
          /talento
        </Link>{" "}
        lista quem se marcou como disponível, com projetos entregues e pódio
        verificável. Contrate quem já entregou.
      </>
    ),
  },
  {
    num: "04",
    title: "Relatório e contatos autorizados",
    desc: (
      <>
        A marca recebe um relatório da edição: inscrições, times que entraram
        no desafio, tecnologias usadas, vencedores e a pesquisa de satisfação
        por papel. Quem quiser falar com a marca lê o QR do estande e autoriza
        o envio do próprio contato.
      </>
    ),
  },
];

export default async function EmpresasPage() {
  // números reais do banco, só os da casa e só acima do piso (lib/empresasStats)
  const stats = await empresaStats();

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-16 sm:px-6 sm:py-24">
      {/* hero */}
      <div className="flex flex-col gap-5">
        <p className="tag self-start uppercase">
          {"para empresas"}
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-6xl">
          Sua marca na frente de{" "}
          <span className="text-accent">quem constrói</span>
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Patrocinar hackathon aqui é recrutamento, marca e produto de verdade
          ao mesmo tempo: sua empresa propõe um desafio, times constroem em cima
          dele e o resultado fica arquivado com seu nome — enquanto você vê de
          perto quem entrega sob pressão. Participante nunca paga; quem paga é
          a marca que quer alcançar eles.
        </p>
      </div>

      {/* prova social — números direto do banco; abaixo do piso nem aparece */}
      {stats.length > 0 && (
      <dl
        data-testid="empresas-stats"
        className="grid gap-px border border-line bg-line"
        style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
      >
        {stats.map((s) => (
          <div key={s.key} className="bg-background px-5 py-4">
            <dt className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
              {s.label}
            </dt>
            <dd className="mt-1 font-display text-3xl font-extrabold text-accent tracking-[-0.02em]">
              {s.n}
            </dd>
          </div>
        ))}
      </dl>
      )}

      {/* o que tá à venda */}
      <div className="flex flex-col gap-6">
        <div className="flex items-baseline gap-3 border-b border-line pb-4">
          <span className="font-mono text-[12px] text-muted">[01]</span>
          <h2 className="font-display text-2xl font-extrabold tracking-[-0.035em]">
            O que sua marca pode fazer
          </h2>
        </div>
        <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
          {oferta.map((o) => (
            <div key={o.num} className="flex flex-col gap-3 bg-background p-6">
              <span className="font-mono text-xs text-accent">{o.num}</span>
              <h3 className="font-display text-xl font-extrabold tracking-[-0.035em]">
                {o.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted">{o.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* captura de lead */}
      <div id="contato" className="flex scroll-mt-24 flex-col gap-6 border border-line bg-mint p-6 sm:p-10">
        <div className="flex flex-col gap-2">
          <p className="tag self-start uppercase">
            {"quero patrocinar"}
          </p>
          <h2 className="font-display text-3xl font-extrabold tracking-[-0.035em]">
            Bora conversar.
          </h2>
          <p className="max-w-xl text-muted">
            Deixe o contato e a gente volta com formato, edição e orçamento.
            Sem compromisso.
          </p>
        </div>
        <LeadForm />
      </div>

      {/* legal — a página comercial é onde a garantia mais importa */}
      <p className="font-mono text-xs text-muted">
        {"legal: "}
        <Link
          href="/legal/termos"
          className="text-muted transition hover:text-accent"
        >
          termos de uso
        </Link>
        {" · "}
        <Link
          href="/legal/privacidade"
          className="text-muted transition hover:text-accent"
        >
          privacidade
        </Link>
      </p>
    </section>
  );
}
