import Link from "next/link";
import type { Metadata } from "next";
import db from "@/lib/db";
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
        A edição vira arquivo público permanente — times, projetos, pódio e a
        marca do sponsor ficam no histórico pra sempre, linkáveis e indexados.
        Não é banner que expira: é prova que fica.
      </>
    ),
  },
  {
    num: "03",
    title: "Talento",
    desc: (
      <>
        O diretório <Link href="/talento" className="text-accent hover:underline">/talento</Link>{" "}
        lista quem marcou &quot;open to&quot; — com projetos entregues e pódio
        verificável. Contrate quem prova, não quem promete.
      </>
    ),
  },
];

export default function EmpresasPage() {
  // stats reais do banco — a prova social é o produto vivo, não promessa
  const members = (
    db.prepare("SELECT COUNT(*) n FROM members").get() as { n: number }
  ).n;
  const editions = (
    db.prepare("SELECT COUNT(*) n FROM hackathons").get() as { n: number }
  ).n;
  const projects = (
    db.prepare("SELECT COUNT(*) n FROM team_projects").get() as { n: number }
  ).n;
  const stats = [
    { n: members, label: "membros" },
    { n: editions, label: "edições" },
    { n: projects, label: "projetos entregues" },
  ];

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-16 sm:py-24">
      {/* hero */}
      <div className="flex flex-col gap-5">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// para empresas"}
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          sua marca na frente de{" "}
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

      {/* prova social — números direto do banco */}
      <dl className="grid grid-cols-3 gap-px border border-line bg-line">
        {stats.map((s) => (
          <div key={s.label} className="bg-background px-5 py-4">
            <dt className="font-mono text-[10px] tracking-widest text-muted uppercase">
              {s.label}
            </dt>
            <dd className="mt-1 font-display text-3xl font-bold text-accent">
              {s.n}
            </dd>
          </div>
        ))}
      </dl>

      {/* o que tá à venda */}
      <div className="flex flex-col gap-6">
        <div className="flex items-baseline gap-3 border-b border-line pb-4">
          <span className="font-mono text-[10px] text-muted">[01]</span>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            O que sua marca pode fazer
          </h2>
        </div>
        <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
          {oferta.map((o) => (
            <div key={o.num} className="flex flex-col gap-3 bg-background p-6">
              <span className="font-mono text-xs text-accent">{o.num}</span>
              <h3 className="font-display text-xl font-semibold tracking-tight">
                {o.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted">{o.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* captura de lead */}
      <div className="flex flex-col gap-6 border border-accent/30 bg-accent/5 p-6 sm:p-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs tracking-widest text-accent">
            {"// quero patrocinar"}
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tight">
            Bora conversar.
          </h2>
          <p className="max-w-xl text-muted">
            Deixa o contato e a gente volta com formato, edição e orçamento —
            sem compromisso.
          </p>
        </div>
        <LeadForm />
      </div>

      {/* legal — a página comercial é onde a garantia mais importa */}
      <p className="font-mono text-xs text-muted">
        {"// legal: "}
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
