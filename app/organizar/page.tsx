import type { Metadata } from "next";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { LeadForm } from "@/components/LeadForm";
import { getOpenHackathons } from "@/lib/hackathons";
import imgInscritos from "@/assets/organizar/inscritos.webp";
import imgPresenca from "@/assets/organizar/presenca.webp";
import imgCheckin from "@/assets/organizar/checkin.webp";
import imgPalco from "@/assets/organizar/palco.webp";
import imgCertificados from "@/assets/organizar/certificados.webp";

// spec 039 — porta de quem organiza: o que o painel da edição faz, etapa
// por etapa, com print real da tela (dados de demonstração), e o contato
// que cai na fila de leads do /admin com aviso pros admins.

export const metadata: Metadata = {
  title: "organizar uma edição",
  description:
    "Rode um hackathon com a Hack Inova: formulário de inscrição, fila de espera, confirmação de presença, check-in por QR, júri, voto ao vivo e certificado com carga horária num painel só.",
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

const etapas: { k: string; title: string; items: string[]; img: StaticImageData; alt: string }[] = [
  {
    k: "inscrição",
    title: "Formulário da edição e lista de inscritos",
    items: [
      "perguntas próprias, além do que já vem do perfil",
      "confirmação na hora ou curadoria com aprovação",
      "limite de vagas com fila de espera que anda sozinha",
      "aceite LGPD versionado e uso de imagem em caixa separada",
      "exportação em CSV",
    ],
    img: imgInscritos,
    alt: "Aba inscritos do painel: contagem por status e lista de inscrições aprovadas com data",
  },
  {
    k: "confirmação",
    title: "Presença confirmada antes do evento",
    items: [
      "convite de confirmação dias antes, com prazo",
      "lembretes na véspera e horas antes",
      "quem não confirma libera a vaga pra fila",
      "avisos pra todos, aprovados, presentes ou um time, por e-mail e WhatsApp",
    ],
    img: imgPresenca,
    alt: "Aba presença do painel: configuração do convite, prazo e sobrevenda",
  },
  {
    k: "dia do evento",
    title: "Check-in por QR, mesmo sem internet",
    items: [
      "cada inscrito tem ingresso com QR pessoal",
      "pacote offline pro credenciamento quando o Wi-Fi cai",
      "crachás em PDF pra imprimir na véspera",
      "programação com agora/a seguir e arquivo .ics",
      "refeições e restrições alimentares pro buffet",
    ],
    img: imgCheckin,
    alt: "Aba check-in do painel: inscritos, aprovados, presentes, modo offline e leitor de QR",
  },
  {
    k: "entrega e final",
    title: "Entrega no prazo, júri e voto ao vivo",
    items: [
      "entrega com prazo, tolerância e trava; rascunho e versão enviada",
      "desafios de patrocinador escolhidos pelo time",
      "júri com rubrica, atribuição de projetos e feedback pro time",
      "palco com cronômetro de pitch e voto do público no telão",
    ],
    img: imgPalco,
    alt: "Aba palco do painel: cronômetro do pitch e fila de apresentações",
  },
  {
    k: "depois",
    title: "Certificado com carga horária",
    items: [
      "carga horária por papel: participante, staff, mentoria, júri, organização",
      "código verificável e PDF pra cada pessoa",
      "CSV de horas pra coordenação de curso",
      "pesquisa NPS por papel, só pra quem esteve lá",
      "relatório pronto pro patrocinador",
    ],
    img: imgCertificados,
    alt: "Aba certificados do painel: carga horária por papel e emissão",
  },
];

const patrocinio = [
  { title: "Desafio próprio", desc: "O problema, o prêmio e o que entregar são da marca; os times escolhem." },
  { title: "Relatório da edição", desc: "Funil, times no desafio, stack usada, vencedores e votos do público." },
  { title: "Contatos com opt-in", desc: "QR no estande: só entra na lista quem quiser falar com a marca." },
  { title: "Logo na edição", desc: "Na página pública da edição, por nível de patrocínio." },
];

const cuidado = [
  { title: "Código de conduta", desc: "Texto da edição, aceito na inscrição e linkado na página pública." },
  { title: "Canal de incidentes", desc: "Relato com opção anônima, direto pra quem a organização indicar." },
  { title: "LGPD", desc: "Aceite por finalidade, exportação e exclusão dos dados pelo próprio participante." },
  { title: "Papéis por edição", desc: "Organização, staff, mentoria e júri, cada um vendo só a aba que usa." },
];

export default async function OrganizarPage() {
  const open = await getOpenHackathons(new Date());
  const exemplo = open.find((h) => h.partner) ?? null;

  return (
    <div className="overflow-x-clip">
      {/* hero */}
      <section aria-labelledby="org-title" className="mx-auto grid max-w-6xl gap-10 px-4 pt-10 pb-14 sm:px-6 sm:pt-16 lg:grid-cols-[1.35fr_1fr] lg:items-end lg:gap-14 lg:pt-20">
        <div className="rise min-w-0">
          <p className="tag">PRA QUEM ORGANIZA</p>
          <h1 id="org-title" className="mt-6 text-[clamp(2.6rem,7.6vw,5.6rem)] leading-[0.9] font-extrabold tracking-[-0.05em]">
            Tua edição,
            <br />
            <span className="text-accent">do formulário ao certificado.</span>
          </h1>
          <p className="mt-7 max-w-[52ch] text-[clamp(1.05rem,1.6vw,1.2rem)] leading-relaxed text-[#1e1e1e]">
            A Hack Inova roda hackathon com universidade, comunidade e empresa. Quem participa se inscreve,
            confirma, faz check-in, entrega e recebe o certificado na mesma plataforma; a organização acompanha
            cada etapa num painel da edição.
          </p>
          <div className="mt-9 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-8">
            <a href="#contato" className="btn min-h-[52px]! px-6! text-[16px]!" data-testid="organizar-cta-contato">
              Falar com a Hack Inova →
            </a>
            <Link href={exemplo ? `/h/${exemplo.id}` : "/radar"} className="cta-link go self-start text-[clamp(1.1rem,2vw,1.3rem)] sm:self-auto">
              {exemplo ? "Ver uma edição no ar" : "Ver hackathons abertos"}
            </Link>
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

      {/* ciclo da edição, com a tela de cada etapa */}
      <section aria-labelledby="ciclo-title" className="border-t-2 border-line">
        <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20">
          <p className="eyebrow">
            <b>[01]</b> o ciclo da edição
          </p>
          <h2 id="ciclo-title" className="mt-4 max-w-[22ch] text-[clamp(2rem,4.4vw,3.2rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
            Cinco etapas, uma tela pra cada.
          </h2>
          <ol className="mt-10 flex flex-col">
            {etapas.map((e, i) => (
              <li
                key={e.k}
                className="grid gap-6 border-t-2 border-line py-10 lg:grid-cols-[1fr_1.35fr] lg:gap-12"
                data-testid="organizar-etapa"
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
                </div>
                <figure className="min-w-0">
                  <div className="border-2 border-line">
                    <p className="tbar">
                      <span className="title">painel / {e.k}</span>
                      <span className="dots" aria-hidden>
                        <b />
                        <b />
                      </span>
                    </p>
                    <Image
                      src={e.img}
                      alt={e.alt}
                      sizes="(min-width: 1024px) 640px, 100vw"
                      placeholder="blur"
                      className="block h-auto w-full"
                    />
                  </div>
                  <figcaption className="mt-2 font-mono text-[12px] text-muted">tela real do painel · dados de demonstração</figcaption>
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

      {/* contato */}
      <section id="contato" aria-labelledby="contato-title" className="scroll-mt-20 border-b-2 border-line bg-mint">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
          <div className="flex flex-col gap-4">
            <p className="eyebrow">
              <b>[04]</b> contato
            </p>
            <h2 id="contato-title" className="text-[clamp(2rem,4.4vw,3rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
              Conta da tua edição.
            </h2>
            <p className="max-w-[42ch] text-[16px] leading-relaxed text-[#2b2b2b]">
              Quando, onde, quantas pessoas e o tema, se já tiver. A mensagem cai direto na fila da Hack Inova.
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
