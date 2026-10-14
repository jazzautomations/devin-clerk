import Link from "next/link";
import Image from "next/image";
import { Show, SignUpButton } from "@clerk/nextjs";
import imgEdicao from "@/assets/landing/edicao.webp";
import imgPainel from "@/assets/landing/painel.webp";
import imgPerfil from "@/assets/landing/perfil.webp";
import imgHackathons from "@/assets/landing/hackathons.webp";
import { NewsletterForm } from "@/components/NewsletterForm";
import { EditionRows } from "@/components/EditionRows";
import { getOpenHackathons, getPastHackathons, isRegistrationClosed, type Hackathon } from "@/lib/hackathons";
import { getEditionCapacity } from "@/lib/registrations";
import { getStatsMomentum } from "@/lib/momentum";
import { getChampions, getCommunityProof } from "@/lib/landing";

// spec 039 — landing por público: quem participa decide no hero (próxima
// edição ou hackathons abertos), quem organiza tem a faixa escura e
// /organizar, quem patrocina tem a seção própria e /empresas. Todo número
// vem do banco; item zerado some.

const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: "America/Sao_Paulo" });
const fmtMes = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" });
const fmtSemana = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
const fmtLongo = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });
const fmtAno = new Intl.DateTimeFormat("pt-BR", { year: "numeric", timeZone: "America/Sao_Paulo" });
const mesCurto = (d: Date) => fmtMes.format(d).replace(".", "").toUpperCase();
const FORMAT_LABEL: Record<string, string> = { online: "online", presencial: "presencial", hibrido: "híbrido" };

// jornada de quem participa — cada passo existe hoje na plataforma
const passos = [
  {
    title: "Acha a edição",
    desc: "Edições da Hack Inova e os hackathons abertos no Brasil e no mundo numa lista só.",
  },
  {
    title: "Se inscreve com teu perfil",
    desc: "Um cadastro pra todas as edições e o formulário curto de cada uma. Lotou? Fila de espera com posição.",
  },
  {
    title: "Confirma presença e pega o ingresso",
    desc: "Confirmação antes do evento e QR pessoal pro check-in na entrada.",
  },
  {
    title: "Monta time e entrega",
    desc: "Quadro de quem procura time, entrega com prazo, rascunho e versão enviada.",
  },
  {
    title: "Sai com prova do que fez",
    desc: "Certificado verificável, feedback do júri, carta colecionável e o projeto no teu perfil público.",
  },
] as const;

// ciclo da edição pro organizador — só o que roda no painel hoje
const ciclo = [
  {
    k: "inscrição",
    title: "Formulário da edição",
    items: ["perguntas próprias e curadoria", "vagas com fila de espera", "aceite LGPD e uso de imagem à parte"],
  },
  {
    k: "confirmação",
    title: "Presença e avisos",
    items: ["RSVP com lembretes antes do evento", "quem não confirma libera a vaga", "avisos por e-mail e WhatsApp"],
  },
  {
    k: "dia do evento",
    title: "Credenciamento",
    items: ["check-in por QR, offline", "crachás em PDF", "programação com .ics e refeições"],
  },
  {
    k: "entrega",
    title: "Projetos no prazo",
    items: ["prazo com tolerância e trava", "desafios de patrocinador", "candidatura de mentor, jurado e voluntário"],
  },
  {
    k: "avaliação",
    title: "Júri e final",
    items: ["rubrica e feedback pro time", "voto do público no telão", "pódio no arquivo da edição"],
  },
  {
    k: "depois",
    title: "Certificado e retorno",
    items: ["certificado com carga horária", "pesquisa NPS por papel", "relatório pro patrocinador"],
  },
] as const;

const patrocinio = [
  { title: "Desafio próprio", desc: "Tua marca propõe o problema, o prêmio e o que entregar; os times escolhem." },
  { title: "Relatório automático", desc: "Funil da edição, times no teu desafio, stack usada, vencedores e votos do público." },
  { title: "Contatos com opt-in", desc: "Quem quiser falar com a marca escaneia o QR no estande. Só com consentimento." },
  { title: "NPS do patrocinador", desc: "Pesquisa pós-evento pra quem esteve lá, separada por papel." },
] as const;

// por dentro — prints reais das telas logadas (assets/landing)
const telas = [
  {
    bar: "edição / teu próximo passo",
    title: "Página da edição",
    desc: "Data, local, prazos e, no topo, o teu próximo passo: inscrição, presença, ingresso, entrega, resultado.",
    img: imgEdicao,
    alt: "Página de uma edição logada: ficha da edição e o painel 'teu próximo passo' com o trilho da jornada",
  },
  {
    bar: "meu painel",
    title: "Meu painel",
    desc: "Um card por edição em que tu tá, com o que fazer agora. Certificados e histórico logo abaixo.",
    img: imgPainel,
    alt: "Meu painel: saudação, lembrete de perfil e cards de próximo passo por edição",
  },
  {
    bar: "hackathons abertos",
    title: "Hackathons abertos",
    desc: "As edições da Hack Inova com inscrição pela plataforma e o radar do que tá aberto no Brasil e no mundo.",
    img: imgHackathons,
    alt: "Lista de hackathons abertos com filtros por formato e região",
  },
  {
    bar: "perfil público",
    title: "Teu perfil vira portfólio",
    desc: "Trajetória por edição, projetos, pódio, cartas colecionáveis e links. É o link que tu manda pra recrutador.",
    img: imgPerfil,
    alt: "Perfil público de uma pessoa: nível, badges, carta da edição e trajetória",
  },
];

// o que vem com a conta — tudo existe hoje
const beneficios = [
  { title: "Inscrição em minutos", desc: "Teu perfil preenche o básico; cada edição pede só o que é dela." },
  { title: "Próximo passo sempre à vista", desc: "Presença, ingresso com QR, entrega e resultado no teu painel." },
  { title: "Time e mural", desc: "Quadro de quem procura time e o mural de cada edição." },
  { title: "Certificado verificável", desc: "Código público e carga horária quando a edição define." },
  { title: "Portfólio que fica", desc: "Projetos, pódio e cartas no teu perfil público." },
  { title: "Avisos sem ruído", desc: "Aviso da organização no app, no e-mail e no WhatsApp se tu quiser." },
];

const faq = [
  {
    q: "Quanto custa participar?",
    a: "Nada. Participante nunca paga; quem banca a edição é a organização e os patrocinadores.",
  },
  {
    q: "Preciso ter time pra me inscrever?",
    a: "Não. Depois da inscrição tu entra no quadro de quem procura time da edição, e o time se forma ali ou no dia.",
  },
  {
    q: "Como funciona a inscrição?",
    a: "Tu cria o perfil uma vez e preenche o formulário curto de cada edição. Edição com curadoria responde por aqui; edição lotada abre fila de espera.",
  },
  {
    q: "O que eu levo pra casa?",
    a: "Certificado com código verificável (com carga horária quando a edição define), a carta da edição e o projeto no teu perfil público.",
  },
  {
    q: "Por que preciso de conta pra ver a plataforma?",
    a: "Inscritos, times e perfis são gente de verdade. Fica aberto só o que é divulgação: esta página, o resumo de cada edição, o cartão do perfil e a verificação de certificado.",
  },
  {
    q: "Quero levar um hackathon pra minha faculdade ou comunidade.",
    a: "Conta pra gente o que tu tem em mente na página de organizar. A Hack Inova responde e a edição roda inteira aqui.",
  },
] as const;

export default async function Home() {
  const now = new Date();
  const [upcoming, past, proof, momentum, champions] = await Promise.all([
    getOpenHackathons(now),
    getPastHackathons(now),
    getCommunityProof(now),
    getStatsMomentum(now),
    getChampions(6, now),
  ]);
  const editions = upcoming.filter((h) => h.partner);
  const proxima = editions[0] ?? null;
  const proximaCap = proxima ? await getEditionCapacity(proxima.id) : null;
  const ultima = past.find((h) => h.partner) ?? null;
  // próximas: Hack Inova primeiro, depois o radar por data
  const proximas = [...editions, ...upcoming.filter((h) => !h.partner)].slice(0, 6);

  const stats = [
    { n: proof.editions, label: "edições realizadas", delta: 0 },
    { n: proof.registrations, label: "inscrições confirmadas", delta: 0 },
    { n: proof.projects, label: "projetos entregues", delta: 0 },
    { n: proof.members, label: "membros", delta: momentum.members },
  ].filter((s) => s.n > 0);

  const primaryHref = proxima ? `/h/${proxima.id}` : "/radar";
  const primaryLabel = proxima ? "Participar da próxima edição" : "Ver hackathons abertos";

  return (
    <div className="-mb-24 overflow-x-clip">
      {/* faixa da próxima edição */}
      {proxima && (
        <Link href={`/h/${proxima.id}`} className="strip block hover:underline">
          {/* uma linha só no celular: nome trunca, status fica curto */}
          <span className="mx-auto flex max-w-6xl justify-between gap-x-4 px-4 py-1.5 sm:px-6">
            <span className="min-w-0 truncate">
              <span className="hidden sm:inline">PRÓXIMA EDIÇÃO · </span>
              {fmtDia.format(new Date(proxima.startsAt))} {mesCurto(new Date(proxima.startsAt))} · {proxima.name.toUpperCase()}
            </span>
            <span className="shrink-0">
              <span className="hidden sm:inline">INSCRIÇÕES </span>
              {isRegistrationClosed(proxima, now) ? "ENCERRADAS" : "ABERTAS"} ▸
            </span>
          </span>
        </Link>
      )}

      {/* hero */}
      <div className="relative">
        <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />
        <section
          aria-labelledby="hero-title"
          className="relative mx-auto grid max-w-6xl gap-10 px-4 pt-10 pb-14 sm:px-6 sm:pt-16 lg:grid-cols-[1.3fr_1fr] lg:items-end lg:gap-14 lg:pt-20 lg:pb-20"
        >
          <div className="rise min-w-0">
            <p className="tag">HACK INOVA · HACKAHUB</p>
            <h1
              id="hero-title"
              className="mt-6 text-[clamp(2.9rem,9vw,6.4rem)] leading-[0.88] font-extrabold tracking-[-0.05em]"
            >
              Sua comunidade
              <br />
              <span className="text-accent">de hackathon.</span>
            </h1>
            <p className="mt-7 max-w-[50ch] text-[clamp(1.05rem,1.6vw,1.25rem)] leading-relaxed text-[#1e1e1e]">
              Onde a Hack Inova abre as edições dela e onde fica o que tu constrói: inscrição, time,
              entrega, certificado e o portfólio que sobra depois.
            </p>
            <div className="mt-9 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-8">
              <Link href={primaryHref} className="btn min-h-[52px]! px-6! text-[16px]!" data-testid="hero-cta-primary">
                {primaryLabel} →
              </Link>
              <Link href="/organizar" className="cta-link go self-start text-[clamp(1.1rem,2vw,1.35rem)] sm:self-auto" data-testid="hero-cta-organizar">
                Vai organizar um hackathon?
              </Link>
            </div>
          </div>

          {/* ficha da próxima edição (ou da última, se nada abriu ainda) */}
          {(proxima ?? ultima) && (
            <EditionTicket
              h={(proxima ?? ultima)!}
              mode={proxima ? "proxima" : "ultima"}
              approved={proximaCap?.approved ?? null}
              remaining={proximaCap?.remaining ?? null}
              capacity={proximaCap?.capacity ?? null}
              closed={proxima ? isRegistrationClosed(proxima, now) : true}
            />
          )}
        </section>
      </div>

      {/* prova — número real do banco; item zerado some */}
      {stats.length > 0 && (
        <section aria-label="A comunidade em números" className="mx-auto max-w-6xl px-4 sm:px-6">
          <dl className={`ink-grid grid-cols-2 ${stats.length >= 4 ? "sm:grid-cols-4" : stats.length === 3 ? "sm:grid-cols-3" : ""}`}>
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col px-4 py-4 sm:px-5">
                <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">{s.label}</dt>
                <dd className="pix mt-1 text-[clamp(2.6rem,6vw,3.6rem)] leading-[0.85]">{s.n}</dd>
                {s.delta > 0 && (
                  <dd className="mt-2 self-start bg-mint px-1.5 font-mono text-[12px] text-accent">{`+${s.delta} · 30d`}</dd>
                )}
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* quem participa: a jornada inteira antes de pedir conta */}
      <section id="como-funciona" aria-labelledby="participar-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-20 sm:px-6 sm:pt-28">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.35fr] lg:gap-16">
          <div className="flex flex-col gap-5 lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow">
              <b>[01]</b> pra quem participa
            </p>
            <h2
              id="participar-title"
              className="text-[clamp(2.1rem,4.6vw,3.4rem)] leading-[0.95] font-extrabold tracking-[-0.04em]"
            >
              Da inscrição ao portfólio, sem perder o fio.
            </h2>
            <p className="max-w-[42ch] text-[16px] leading-relaxed text-muted">
              Estudante, dev, designer ou founder: um perfil, todas as edições. A página de cada edição
              mostra o teu próximo passo.
            </p>
            <Link href="/radar" className="cta-link go self-start text-[18px]">
              Ver hackathons abertos
            </Link>
          </div>
          <ol className="steps border-b border-line">
            {passos.map((p) => (
              <li key={p.title} className="grid grid-cols-[40px_1fr] items-baseline gap-x-4 border-t border-line py-6 sm:grid-cols-[56px_1fr]">
                <div className="col-start-2 flex flex-col gap-1.5">
                  <h3 className="text-[clamp(1.25rem,2.2vw,1.55rem)] leading-tight font-extrabold tracking-[-0.025em]">
                    {p.title}
                  </h3>
                  <p className="max-w-[52ch] text-[15.5px] leading-relaxed text-[#2b2b2b]">{p.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* por dentro: a plataforma é logada, então a landing mostra as telas */}
      <section id="por-dentro" aria-labelledby="dentro-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-20 sm:px-6 sm:pt-28" data-testid="landing-por-dentro">
        <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="flex flex-col gap-4">
            <p className="eyebrow">
              <b>[02]</b> por dentro
            </p>
            <h2 id="dentro-title" className="max-w-[20ch] text-[clamp(2rem,4.2vw,3rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
              O que tu vê depois de criar a conta.
            </h2>
          </div>
          <p className="max-w-[44ch] text-[15.5px] leading-relaxed text-muted">
            A plataforma é pra quem tem conta: edições, inscritos, times, projetos e perfis ficam lá dentro. Estas
            são as telas de verdade.
          </p>
        </div>
        <div className="grid gap-x-8 gap-y-12 lg:grid-cols-2">
          {telas.map((t, i) => (
            <figure key={t.title} className="flex min-w-0 flex-col gap-4">
              <div className="border-2 border-line">
                <p className="tbar">
                  <span className="title">{t.bar}</span>
                  <span className="dots" aria-hidden>
                    <b />
                    <b />
                  </span>
                </p>
                <Image src={t.img} alt={t.alt} sizes="(min-width: 1024px) 560px, 100vw" placeholder="blur" className="block aspect-[1152/580] w-full object-cover object-top" />
              </div>
              <figcaption className="grid grid-cols-[36px_1fr] gap-x-3">
                <span className="font-mono text-[13px] font-medium text-accent">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="block text-[19px] font-extrabold tracking-[-0.02em]">{t.title}</span>
                  <span className="mt-1 block text-[14.5px] leading-snug text-[#2b2b2b]">{t.desc}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-4 font-mono text-[12px] text-muted">telas reais da plataforma · dados de demonstração</p>
      </section>

      {/* próximas edições */}
      {proximas.length > 0 && (
        <section aria-labelledby="proximas-title" className="mx-auto max-w-6xl px-4 pt-20 sm:px-6 sm:pt-28">
          <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-4">
              <p className="eyebrow">
                <b>[03]</b> inscrições abertas
              </p>
              <h2 id="proximas-title" className="text-[clamp(2rem,4.2vw,3rem)] leading-none font-extrabold tracking-[-0.04em]">
                Próximas edições
              </h2>
            </div>
            <Link href="/radar" className="font-mono text-[13px] font-medium text-accent underline-offset-4 hover:underline">
              ver todos os hackathons →
            </Link>
          </div>
          <EditionRows hackathons={proximas} testId="landing-proximas" />
        </section>
      )}

      {/* vitrine: o que saiu das edições */}
      {champions.length > 0 && (
        <section aria-labelledby="vitrine-title" className="mx-auto max-w-6xl px-4 pt-20 sm:px-6 sm:pt-28">
          <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-4">
              <p className="eyebrow">
                <b>[04]</b> do arquivo
              </p>
              <h2 id="vitrine-title" className="max-w-[18ch] text-[clamp(2rem,4.2vw,3rem)] leading-none font-extrabold tracking-[-0.04em]">
                O que os times levaram pro pódio.
              </h2>
            </div>
            <Link href="/projetos" className="font-mono text-[13px] font-medium text-accent underline-offset-4 hover:underline">
              ver todos os projetos →
            </Link>
          </div>
          <ul className="ink-grid sm:grid-cols-2 lg:grid-cols-3" data-testid="landing-vitrine">
            {champions.map((c) => (
              <li key={c.teamId} className={`flex flex-col gap-3 p-5 ${c.placement === 1 ? "bg-mint!" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`pix px-2 text-[24px] leading-[1.15] ${
                      c.placement === 1 ? "bg-foreground text-band" : "border-[1.5px] border-line"
                    }`}
                  >
                    {c.placement}º
                  </span>
                  <span className="truncate font-mono text-[11.5px] text-muted">
                    {mesCurto(new Date(c.startsAt))} {fmtAno.format(new Date(c.startsAt))}
                  </span>
                </div>
                <Link
                  href={`/p/${c.teamId}`}
                  className="text-[20px] leading-tight font-extrabold tracking-[-0.025em] underline-offset-4 hover:text-accent hover:underline"
                >
                  {c.title}
                </Link>
                {c.description && <p className="line-clamp-3 text-[14px] leading-snug text-[#2b2b2b]">{c.description}</p>}
                <p className="mt-auto border-t border-line-soft pt-3 font-mono text-[12px] leading-relaxed text-muted">
                  <span className="text-foreground">{c.teamName}</span> · {c.hackathonName}
                  {c.members.length > 0 && (
                    <>
                      <br />
                      {c.members.map((u) => `@${u}`).join(" ")}
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* quem organiza: faixa escura com o ciclo da edição */}
      <section aria-labelledby="organizar-title" className="mt-20 bg-foreground text-background sm:mt-28" data-testid="landing-organizar">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
            <div className="flex flex-col gap-4">
              <p className="font-mono text-[13px] font-medium text-[#b8cdc0]">
                <span className="text-band">[05]</span> pra quem organiza
              </p>
              <h2
                id="organizar-title"
                className="max-w-[20ch] text-[clamp(2rem,4.4vw,3.2rem)] leading-[0.98] font-extrabold tracking-[-0.04em]"
              >
                A edição inteira, do formulário ao certificado.
              </h2>
            </div>
            <div className="flex flex-col gap-5 lg:items-end lg:text-right">
              <p className="max-w-[44ch] text-[15px] leading-relaxed text-[#b8cdc0]">
                Universidade, comunidade ou empresa: a Hack Inova roda a edição contigo, e cada etapa tem uma tela
                no painel.
              </p>
              <Link href="/organizar" className="btn-go self-start lg:self-end">
                Ver como funciona pra organizar →
              </Link>
            </div>
          </div>
          <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {ciclo.map((c, i) => (
              <li key={c.k} className="border-t border-[#5e7869] pt-4">
                <p className="font-mono text-[12px] font-medium tracking-[0.04em] text-band uppercase">
                  {String(i + 1).padStart(2, "0")} · {c.k}
                </p>
                <h3 className="mt-2 mb-2 text-[20px] font-bold tracking-[-0.015em]">{c.title}</h3>
                <ul className="flex flex-col gap-1 text-[14px] leading-snug text-[#b8cdc0]">
                  {c.items.map((it) => (
                    <li key={it} className="flex gap-2">
                      <span aria-hidden className="text-band">
                        +
                      </span>
                      {it}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* patrocinador */}
      <section aria-labelledby="patrocinar-title" className="mx-auto max-w-6xl px-4 pt-20 sm:px-6 sm:pt-28" data-testid="landing-patrocinar">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <div className="flex flex-col gap-5">
            <p className="eyebrow">
              <b>[06]</b> pra patrocinador
            </p>
            <h2 id="patrocinar-title" className="text-[clamp(2rem,4.2vw,3rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
              Tua marca no problema, não no banner.
            </h2>
            <p className="max-w-[42ch] text-[16px] leading-relaxed text-muted">
              Patrocínio que vira desafio, contato com consentimento e um relatório no fim.
            </p>
            <Link href="/empresas" className="cta-link go self-start text-[18px]">
              Lançar um desafio patrocinado
            </Link>
          </div>
          <dl className="grid border-t-2 border-line sm:grid-cols-2">
            {patrocinio.map((p) => (
              <div key={p.title} className="border-b border-line py-5 sm:odd:pr-6 sm:even:border-l sm:even:pl-6">
                <dt className="text-[19px] font-extrabold tracking-[-0.02em]">{p.title}</dt>
                <dd className="mt-1.5 text-[14.5px] leading-relaxed text-[#2b2b2b]">{p.desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* por que criar conta */}
      <section aria-labelledby="conta-title" className="mx-auto max-w-6xl px-4 pt-20 sm:px-6 sm:pt-28" data-testid="landing-conta">
        <div className="grid gap-8 border-2 border-line lg:grid-cols-[1fr_1.4fr]">
          <div className="flex flex-col gap-5 border-b-2 border-line bg-mint p-6 sm:p-8 lg:border-r-2 lg:border-b-0">
            <p className="eyebrow">
              <b>[07]</b> tua conta
            </p>
            <h2 id="conta-title" className="text-[clamp(1.9rem,4vw,2.8rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
              Um cadastro, todas as edições.
            </h2>
            <p className="text-[15.5px] leading-relaxed text-[#2b2b2b]">
              Criar conta não custa nada e leva 3 passos curtos depois do cadastro. Dá pra pular e completar depois.
            </p>
            <Show when="signed-out">
              <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                <button className="btn self-start" data-testid="landing-signup">
                  criar minha conta →
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" className="btn self-start">
                ir pro meu painel →
              </Link>
            </Show>
          </div>
          <ul className="grid content-start gap-x-8 p-6 sm:grid-cols-2 sm:p-8">
            {beneficios.map((b) => (
              <li key={b.title} className="border-t border-line py-4 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
                <p className="text-[17px] font-extrabold tracking-[-0.015em]">{b.title}</p>
                <p className="mt-1 text-[14.5px] leading-snug text-muted">{b.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-title" className="mx-auto max-w-6xl px-4 pt-20 pb-20 sm:px-6 sm:pt-28 sm:pb-28">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <div className="flex flex-col gap-4">
            <p className="eyebrow">
              <b>[08]</b> dúvidas
            </p>
            <h2 id="faq-title" className="text-[clamp(2rem,4.2vw,3rem)] leading-none font-extrabold tracking-[-0.04em]">
              Perguntas que chegam antes da inscrição.
            </h2>
          </div>
          <div className="border-b-2 border-line" data-testid="landing-faq">
            {faq.map((f) => (
              <details key={f.q} className="group border-t-2 border-line">
                <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 py-4 text-[17px] font-bold tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden className="font-mono text-[18px] text-accent group-open:rotate-45 motion-safe:transition-transform">
                    +
                  </span>
                </summary>
                <p className="max-w-[60ch] pb-5 text-[15.5px] leading-relaxed text-[#2b2b2b]">
                  {f.a}
                  {f.q.startsWith("Quero levar") && (
                    <>
                      {" "}
                      <Link href="/organizar" className="text-accent underline underline-offset-4">
                        Organizar uma edição →
                      </Link>
                    </>
                  )}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* newsletter */}
      <section aria-labelledby="news-title" className="border-t-2 border-line bg-mint">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.1fr] md:items-end">
          <div>
            <p className="tag">NEWSLETTER</p>
            <h2 id="news-title" className="mt-4 text-[clamp(2rem,4vw,2.75rem)] leading-none font-extrabold tracking-[-0.04em]">
              Toda semana, o que tá aberto.
            </h2>
            <p className="mt-3 max-w-[46ch] text-[15px] text-[#2b2b2b]">
              Hackathons abertos, prazos e as próximas edições da Hack Inova. Um e-mail por semana.
            </p>
          </div>
          <NewsletterForm />
        </div>
      </section>
    </div>
  );
}

// ficha/ingresso da edição no hero — o "event-facts" do site da Hack Inova
function EditionTicket({
  h,
  mode,
  approved,
  remaining,
  capacity,
  closed,
}: {
  h: Hackathon;
  mode: "proxima" | "ultima";
  approved: number | null;
  remaining: number | null;
  capacity: number | null;
  closed: boolean;
}) {
  const d = new Date(h.startsAt);
  const rows: [string, string][] = [
    ["local", h.location ?? "Online"],
    ["formato", FORMAT_LABEL[h.format]],
  ];
  if (mode === "proxima") {
    if (approved !== null && approved > 0) rows.push(["inscritos", String(approved)]);
    if (capacity !== null && remaining !== null) {
      rows.push(["vagas", remaining === 0 ? "esgotadas · fila aberta" : `${remaining} de ${capacity} livres`]);
    }
    rows.push([
      "inscrições",
      closed ? "encerradas" : h.registrationDeadline ? `até ${fmtLongo.format(new Date(h.registrationDeadline))}` : "abertas",
    ]);
  }
  return (
    <article
      aria-label={mode === "proxima" ? "Próxima edição" : "Última edição"}
      className="rise rise-2 border-2 border-line bg-background"
      data-testid="hero-ticket"
    >
      <div className="flex items-center justify-between border-b-2 border-line bg-foreground px-4 py-1.5">
        <span className="pix text-[19px] leading-none text-band">{mode === "proxima" ? "PRÓXIMA EDIÇÃO" : "ÚLTIMA EDIÇÃO"}</span>
        <span className="pix text-[19px] leading-none text-background">{fmtAno.format(d)}</span>
      </div>
      <div className="px-5 pt-5 pb-4">
        <p className="flex items-baseline gap-2 text-[clamp(3.6rem,8vw,5rem)] leading-[0.85] font-extrabold tracking-[-0.05em] tabular-nums">
          {fmtDia.format(d)}
          <span className="text-[0.48em] text-accent">{mesCurto(d)}</span>
        </p>
        <p className="mt-2 font-mono text-[12.5px] text-muted first-letter:uppercase">
          {fmtSemana.format(d)} · {fmtLongo.format(d)}
        </p>
        <p className="mt-4 text-[22px] leading-tight font-extrabold tracking-[-0.025em]">{h.name}</p>
        <p className="mt-1 text-[14px] text-muted">Realização {h.organizer}</p>
      </div>
      <dl className="border-t border-line text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[96px_1fr] gap-3 border-b border-line-soft px-5 py-2.5 last:border-b-0">
            <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">{k}</dt>
            <dd className="font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <Link
        href={mode === "proxima" ? `/h/${h.id}` : `/h/${h.id}#resultado`}
        className="pix block border-t-2 border-line bg-band py-2 text-center text-[22px] leading-none hover:bg-foreground hover:text-band"
      >
        {mode === "proxima" ? (closed ? "VER EDIÇÃO ▸" : "VER EDIÇÃO E SE INSCREVER ▸") : "VER RESULTADO ▸"}
      </Link>
    </article>
  );
}
