import type { Metadata } from "next";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { LeadForm } from "@/components/LeadForm";
import imgComunidade from "@/assets/organizar/comunidade.webp";
import imgHackathon from "@/assets/organizar/abrir-hackathon.webp";
import imgInscritos from "@/assets/organizar/inscritos.webp";
import imgCertificados from "@/assets/organizar/certificados.webp";

// /organizar — self-service: crie sua comunidade e abra seu hackathon.
// Passo a passo curto, cada passo com print real da tela (dados de
// demonstração), o que vem no painel da edição e um contato pra dúvida.
// Hoje é grátis organizar e participar; nada aqui promete o futuro.

export const metadata: Metadata = {
  title: "organizar um hackathon",
  description:
    "Crie a comunidade e abra seu hackathon no HackaHub: inscrição, avisos, check-in por QR, júri e certificado com carga horária num painel só. Hoje é grátis.",
  alternates: { canonical: "/organizar" },
};

const PAINEL = [
  "visão geral",
  "equipe",
  "formulário",
  "inscritos",
  "candidaturas",
  "avisos",
  "programação",
  "dúvidas",
  "presença",
  "check-in",
  "crachás",
  "refeições",
  "incidentes",
  "entregas",
  "júri",
  "palco",
  "certificados",
  "patrocinadores",
  "nps",
];

const passos: { k: string; title: string; items: string[]; img: StaticImageData; alt: string }[] = [
  {
    k: "crie a comunidade",
    title: "Nome, cidade e pronto",
    items: ["página própria pra divulgar no grupo", "quem entra recebe o aviso dos seus hackathons", "chame quem organiza junto pelo e-mail"],
    img: imgComunidade,
    alt: "Página de uma comunidade: nome, cidade, membros, próximos hackathons e mural",
  },
  {
    k: "abra o hackathon",
    title: "Rascunho em um minuto",
    items: ["nome, datas, local, vagas e descrição", "só a equipe vê até você publicar", "o checklist mostra o que falta antes de ir pro ar"],
    img: imgHackathon,
    alt: "Painel de uma edição em rascunho: fase, botão de publicar e checklist com os próximos passos",
  },
  {
    k: "inscrição e avisos",
    title: "Formulário, fila e lista de inscritos",
    items: ["perguntas próprias e curadoria, se quiser", "limite de vagas com fila de espera que anda sozinha", "avisos pra todos ou só pros aprovados", "exportação em CSV"],
    img: imgInscritos,
    alt: "Aba inscritos do painel: contagem por status e lista de inscrições aprovadas com data",
  },
  {
    k: "no dia e depois",
    title: "Check-in, júri e certificado",
    items: ["check-in por QR, mesmo sem internet", "júri com rubrica e comentário pra cada time", "certificado com carga horária e código verificável"],
    img: imgCertificados,
    alt: "Aba certificados do painel: carga horária por papel e emissão",
  },
];

const patrocinio = [
  { title: "Desafio da empresa", desc: "A empresa define o problema, o prêmio e o que entregar. As equipes escolhem se vão pegar." },
  { title: "Relatório da edição", desc: "Inscritos, presentes, equipes no desafio, stack usada, vencedores e votos do público." },
  { title: "Contato com consentimento", desc: "No estande tem um QR. Só entra na lista quem quiser falar com a empresa." },
  { title: "Logo na edição", desc: "Na página pública da edição, por nível de patrocínio." },
];

const cuidado = [
  { title: "Código de conduta", desc: "Texto da edição, aceito na inscrição e linkado na página pública." },
  { title: "Canal de incidentes", desc: "Relato com opção anônima, direto pra quem a organização indicar." },
  { title: "LGPD", desc: "Aceite por finalidade, exportação e exclusão dos dados pelo próprio participante." },
  { title: "Papéis por edição", desc: "Organização, staff, mentoria e júri, cada um vendo só a aba que usa." },
];

export default function OrganizarPage() {
  return (
    <div className="overflow-x-clip">
      {/* hero */}
      <section aria-labelledby="org-title" className="mx-auto grid max-w-6xl gap-10 px-4 pt-10 pb-14 sm:px-6 sm:pt-16 lg:grid-cols-[1.35fr_1fr] lg:items-end lg:gap-14 lg:pt-20">
        <div className="rise min-w-0">
          <p className="tag">PRA QUEM ORGANIZA</p>
          <h1 id="org-title" className="mt-6 text-[clamp(2.5rem,7.2vw,5.2rem)] leading-[0.92] font-extrabold tracking-[-0.05em]">
            Crie sua comunidade.
            <br />
            <span className="text-accent">Abra seu hackathon.</span>
          </h1>
          <p className="mt-7 max-w-[50ch] text-[clamp(1.05rem,1.6vw,1.2rem)] leading-relaxed text-[#1e1e1e]">
            Você faz tudo daqui: cria a comunidade, abre o hackathon e publica quando o checklist estiver pronto.
            Quem está na comunidade recebe o aviso. Hoje é grátis.
          </p>
          <div className="mt-9 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-8">
            <Link href="/comunidades/nova" className="btn min-h-[52px]! px-6! text-[16px]!" data-testid="organizar-cta-criar">
              Criar comunidade →
            </Link>
            <a href="#contato" className="cta-link go self-start text-[clamp(1.05rem,2vw,1.25rem)] sm:self-auto" data-testid="organizar-cta-contato">
              Tenho uma dúvida
            </a>
          </div>
        </div>

        <aside aria-label="Abas do painel da edição" className="rise rise-2 border-2 border-line">
          <p className="flex items-center justify-between border-b-2 border-line bg-foreground px-4 py-1.5">
            <span className="pix text-[19px] leading-none text-band">PAINEL DA EDIÇÃO</span>
            <span className="pix text-[19px] leading-none text-background">{PAINEL.length} ABAS</span>
          </p>
          <ul className="flex flex-wrap gap-1.5 p-4">
            {PAINEL.map((t) => (
              <li key={t} className="chip">
                {t}
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-3 font-mono text-[12px] leading-relaxed text-muted">
            cada pessoa da equipe vê as abas do papel dela na edição
          </p>
        </aside>
      </section>

      {/* passo a passo, com a tela de cada passo */}
      <section aria-labelledby="passos-title" className="border-t-2 border-line">
        <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20">
          <p className="eyebrow">
            <b>[01]</b> passo a passo
          </p>
          <h2 id="passos-title" className="mt-4 max-w-[22ch] text-[clamp(2rem,4.4vw,3.2rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
            Quatro passos, uma tela pra cada.
          </h2>
          <ol className="mt-10 flex flex-col">
            {passos.map((e, i) => (
              <li
                key={e.k}
                className="grid gap-6 border-t-2 border-line py-10 lg:grid-cols-[1fr_1.35fr] lg:gap-12"
                data-testid="organizar-passo"
              >
                <div className="flex flex-col gap-3">
                  <p className="font-mono text-[13px] font-medium tracking-[0.04em] text-accent uppercase">
                    {String(i + 1).padStart(2, "0")} · {e.k}
                  </p>
                  <h3 className="text-[clamp(1.4rem,2.6vw,1.9rem)] leading-[1.05] font-extrabold tracking-[-0.03em]">{e.title}</h3>
                  <ul className="mt-1 flex flex-col gap-1.5 text-[15px] leading-snug text-[#2b2b2b]">
                    {e.items.map((it) => (
                      <li key={it} className="flex gap-2.5">
                        <span aria-hidden className="font-mono font-bold text-accent">
                          +
                        </span>
                        {it}
                      </li>
                    ))}
                  </ul>
                  {i === 0 && (
                    <Link href="/comunidades/nova" className="cta-link go mt-2 self-start text-[17px]">
                      Criar comunidade
                    </Link>
                  )}
                </div>
                <figure className="min-w-0">
                  <div className="border-2 border-line">
                    <p className="tbar">
                      <span className="title">{e.k}</span>
                      <span className="dots" aria-hidden>
                        <b />
                        <b />
                      </span>
                    </p>
                    <Image src={e.img} alt={e.alt} sizes="(min-width: 1024px) 640px, 100vw" placeholder="blur" className="block h-auto w-full" />
                  </div>
                  <figcaption className="mt-2 font-mono text-[12px] text-muted">tela real · dados de demonstração</figcaption>
                </figure>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* cuidado com gente */}
      <section aria-labelledby="cuidado-title" className="bg-foreground text-background">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="font-mono text-[13px] font-medium text-[#b8cdc0]">
            <span className="text-band">[02]</span> segurança e dados
          </p>
          <h2 id="cuidado-title" className="mt-4 max-w-[24ch] text-[clamp(1.8rem,4vw,2.8rem)] leading-[1] font-extrabold tracking-[-0.04em]">
            Gente reunida pede regra clara.
          </h2>
          <dl className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {cuidado.map((c) => (
              <div key={c.title} className="border-t border-[#5e7869] pt-4">
                <dt className="text-[19px] font-bold tracking-[-0.015em]">{c.title}</dt>
                <dd className="mt-2 text-[14px] leading-snug text-[#b8cdc0]">{c.desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* patrocínio — destino de quem marcou "patrocinar" no onboarding */}
      <section id="patrocinio" aria-labelledby="patro-title" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <div className="flex flex-col gap-4">
            <p className="eyebrow">
              <b>[03]</b> patrocínio
            </p>
            <h2 id="patro-title" className="text-[clamp(1.9rem,4vw,2.8rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
              A marca entra no problema.
            </h2>
            <Link href="/empresas" className="cta-link go self-start text-[18px]">
              Ver como patrocinar
            </Link>
          </div>
          <dl className="grid border-t-2 border-line sm:grid-cols-2">
            {patrocinio.map((p) => (
              <div key={p.title} className="border-b border-line py-5 sm:odd:pr-6 sm:even:border-l sm:even:pl-6">
                <dt className="text-[18px] font-extrabold tracking-[-0.02em]">{p.title}</dt>
                <dd className="mt-1.5 text-[14.5px] leading-relaxed text-[#2b2b2b]">{p.desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* contato pra dúvida */}
      <section id="contato" aria-labelledby="contato-title" className="scroll-mt-20 border-b-2 border-line bg-mint">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
          <div className="flex flex-col gap-4">
            <p className="eyebrow">
              <b>[04]</b> dúvida
            </p>
            <h2 id="contato-title" className="text-[clamp(2rem,4.4vw,3rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
              Ficou alguma dúvida?
            </h2>
            <p className="max-w-[42ch] text-[16px] leading-relaxed text-[#2b2b2b]">
              Pergunte aqui. A equipe do HackaHub responde no seu e-mail.
            </p>
            <p className="font-mono text-[13px] text-muted">
              É marca querendo patrocinar?{" "}
              <Link href="/empresas" className="text-accent underline underline-offset-4">
                vai por aqui →
              </Link>
            </p>
          </div>
          <div className="border-2 border-line bg-background p-5 sm:p-6">
            <LeadForm variant="organizar" />
          </div>
        </div>
      </section>
    </div>
  );
}
