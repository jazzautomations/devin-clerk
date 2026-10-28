import Image from "next/image";
import Link from "next/link";
import { Show, SignUpButton } from "@clerk/nextjs";
import { CommunityRows } from "@/components/CommunityRows";
import { EditionRows } from "@/components/EditionRows";
import { listCommunities } from "@/lib/communities";
import { getOpenHackathons } from "@/lib/hackathons";
import { landingSample, radarCounts } from "@/lib/radar";
import imgComunidade from "@/assets/organizar/comunidade.webp";
import imgHackathon from "@/assets/organizar/abrir-hackathon.webp";
import imgInscritos from "@/assets/organizar/inscritos.webp";
import imgCertificados from "@/assets/organizar/certificados.webp";

// Landing curta (formato aprovado pelo dono) contando a ideia inteira: o
// radar com a regra de quem pode entrar, as comunidades de verdade, organizar
// o seu hackathon daqui e o que fica no seu perfil. Todo número sai do banco
// e some quando é zero; nada de depoimento, logo de parceiro ou métrica
// inventada. Organizar hoje é grátis, e é só isso que a página promete.

const organizar = [
  { k: "01", title: "Crie a comunidade", desc: "Nome, cidade e a página pra divulgar.", img: imgComunidade, alt: "Página de uma comunidade com membros, próximos hackathons e mural" },
  { k: "02", title: "Abra o hackathon", desc: "Nasce rascunho. Publica quando o checklist fecha.", img: imgHackathon, alt: "Painel de uma edição em rascunho com o checklist do que falta" },
  { k: "03", title: "Inscrição e avisos", desc: "Formulário, vagas com fila e aviso pra quem está dentro.", img: imgInscritos, alt: "Lista de inscritos de uma edição com status de cada inscrição" },
  { k: "04", title: "Check-in, júri e certificado", desc: "QR na porta, nota com comentário e certificado com horas.", img: imgCertificados, alt: "Aba de certificados com carga horária por papel" },
] as const;

const faq = [
  {
    q: "O que é um hackathon?",
    a: "Uma maratona de um ou dois dias. Você forma uma equipe, escolhe um desafio, constrói um protótipo e apresenta pra um júri no fim.",
  },
  {
    q: "Preciso saber programar?",
    a: "Não. Equipe boa mistura código, design, negócio e dados, e muita equipe se forma no próprio dia.",
  },
  {
    q: "Quanto custa participar?",
    a: "Nada. Quem participa não paga, nem a conta nem a inscrição nos hackathons que rodam aqui.",
  },
  {
    q: "Como crio minha comunidade?",
    a: "Com a conta feita, clique em criar comunidade, dê um nome e diga a cidade. Você vira dono, chama quem organiza junto e abre o primeiro hackathon pelo painel dela.",
  },
  {
    q: "Quanto custa organizar?",
    a: "Hoje é grátis. Criar a comunidade, abrir o hackathon e usar o painel da edição não custam nada.",
  },
  {
    q: "Por que preciso de conta?",
    a: "Porque lá dentro tem gente de verdade: perfis, equipes, o mural de cada comunidade. A conta é de graça e vale pra tudo.",
  },
] as const;

const fmtN = new Intl.NumberFormat("pt-BR");

export default async function Home() {
  const now = new Date();
  const [upcoming, communities] = await Promise.all([getOpenHackathons(now), listCommunities({ limit: 4 })]);
  // amostra de 4: Brasil (edições do HackaHub e hackathons daqui) + 1–2
  // globais abertos pra brasileiros, sem o que fecha em menos de 48h. O
  // "+N" é o radar inteiro que vale pra você, aberto em /radar
  const { sample: abertos, count } = landingSample(upcoming, now, 4);
  const restantes = count - abertos.length;
  const nums = radarCounts(upcoming);
  const showNums = nums.open > 0 && nums.brazilOk > 0 && nums.brazilOk <= nums.open;
  const onlyHackInova = communities.length === 1 && communities[0].slug === "hack-inova";

  return (
    <div className="-mb-24 overflow-x-clip">
      {/* 1. hero */}
      <div className="relative">
        <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />
        <section
          aria-labelledby="hero-title"
          className="relative mx-auto max-w-6xl px-4 pt-12 pb-14 sm:px-6 sm:pt-20 lg:pt-24 lg:pb-20"
        >
          <p className="tag">HACKAHUB</p>
          <h1
            id="hero-title"
            className="rise mt-6 max-w-[16ch] text-[clamp(2.6rem,7.4vw,5.6rem)] leading-[0.92] font-extrabold tracking-[-0.045em]"
          >
            A comunidade de hackathon <span className="text-accent">do Brasil.</span>
          </h1>
          <p className="mt-6 max-w-[48ch] text-[clamp(1.05rem,1.6vw,1.25rem)] leading-relaxed text-[#1e1e1e]">
            Ache hackathon aqui e lá fora sabendo se brasileiro pode entrar. Junte-se à comunidade da sua cidade, ou
            crie a sua e organize o próximo por aqui.
          </p>
          <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-8">
            <Show when="signed-out">
              <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                <button className="btn min-h-[52px]! px-6! text-[16px]!" data-testid="hero-cta-primary">
                  Entrar na comunidade →
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link href="/comunidades" className="btn min-h-[52px]! px-6! text-[16px]!" data-testid="hero-cta-primary">
                Achar minha comunidade →
              </Link>
            </Show>
            <Link
              href="/comunidades/nova"
              className="cta-link go self-start text-[clamp(1.1rem,2vw,1.3rem)] sm:self-auto"
              data-testid="hero-cta-criar"
            >
              Criar minha comunidade
            </Link>
          </div>
        </section>
      </div>

      {/* 2. radar */}
      {abertos.length > 0 && (
        <section id="abertos" aria-labelledby="abertos-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 sm:px-6">
          <div className="flex flex-col gap-3 border-b-2 border-line pb-4">
            <h2 id="abertos-title" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-[1] font-extrabold tracking-[-0.035em]">
              Antes de se inscrever, você vê se brasileiro pode entrar.
            </h2>
            {showNums && (
              <p className="font-mono text-[13.5px] text-muted" data-testid="landing-radar-numeros">
                <b className="text-foreground">{fmtN.format(nums.open)}</b> {nums.open === 1 ? "hackathon aberto" : "hackathons abertos"} agora ·{" "}
                <b className="text-accent">{fmtN.format(nums.brazilOk)}</b> {nums.brazilOk === 1 ? "aceita" : "aceitam"} brasileiro
                {nums.devpostExcluded > 0 && (
                  <>
                    {" "}
                    · {fmtN.format(nums.devpostExcluded)} do Devpost {nums.devpostExcluded === 1 ? "deixa" : "deixam"} o Brasil de fora na regra
                  </>
                )}
              </p>
            )}
          </div>
          <EditionRows hackathons={abertos} testId="landing-proximas" now={now} />
          {restantes > 0 && (
            <div
              className="flex flex-col items-start justify-between gap-4 border-b-2 border-line bg-mint px-2 py-5 sm:flex-row sm:items-center"
              data-testid="landing-radar-completo"
            >
              <p className="text-[clamp(1.1rem,2vw,1.35rem)] font-extrabold tracking-[-0.02em]">
                +{fmtN.format(restantes)} no radar completo.
                <span className="block text-[15px] font-normal text-[#2b2b2b]">
                  Brasil por estado e o online do mundo, com a regra de cada um.
                </span>
              </p>
              <Link href="/radar" className="btn min-h-[48px]! shrink-0 px-5!">
                ver o radar →
              </Link>
            </div>
          )}
        </section>
      )}

      {/* 3. comunidades */}
      <section id="comunidades" aria-labelledby="comunidades-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-20 sm:px-6 sm:pt-24" data-testid="landing-comunidades">
        <div className="flex flex-col justify-between gap-3 border-b-2 border-line pb-4 sm:flex-row sm:items-end">
          <h2 id="comunidades-title" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-[1] font-extrabold tracking-[-0.035em]">
            Comunidades
          </h2>
          <p className="max-w-[44ch] text-[15px] text-[#2b2b2b]">Quem entra recebe o aviso quando a comunidade abre um hackathon.</p>
        </div>
        {communities.length > 0 && <CommunityRows communities={communities} />}
        <div className="flex flex-col items-start justify-between gap-4 border-b-2 border-line px-2 py-5 sm:flex-row sm:items-center" data-testid="landing-crie-a-sua">
          <p className="text-[clamp(1.05rem,2vw,1.3rem)] font-extrabold tracking-[-0.02em]">
            {onlyHackInova || communities.length === 0
              ? "A da sua cidade ainda não está aqui?"
              : "Não achou a sua?"}{" "}
            <span className="font-normal text-[#2b2b2b]">Crie em um minuto.</span>
          </p>
          <Link href="/comunidades/nova" className="btn-ghost min-h-[48px]! shrink-0">
            criar minha comunidade →
          </Link>
        </div>
      </section>

      {/* 4. organizar */}
      <section id="organizar" aria-labelledby="organizar-title" className="mt-20 bg-foreground text-background sm:mt-24" data-testid="landing-organizar">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-3">
              <p className="font-mono text-[13px] text-[#b8cdc0]">
                <span className="text-band">[organizar]</span> do zero ao certificado
              </p>
              <h2 id="organizar-title" className="max-w-[18ch] text-[clamp(1.9rem,4vw,2.9rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
                Organize o seu hackathon daqui.
              </h2>
            </div>
            <Link href="/comunidades/nova" className="btn-go shrink-0 self-start sm:self-auto" data-testid="landing-organizar-cta">
              Criar minha comunidade →
            </Link>
          </div>
          <ol className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 sm:gap-y-10 lg:grid-cols-4">
            {organizar.map((p) => (
              <li key={p.k} className="flex min-w-0 flex-col gap-3">
                <div className="overflow-hidden border-[1.5px] border-[#5e7869] bg-background">
                  <Image src={p.img} alt={p.alt} sizes="(min-width: 1024px) 270px, 50vw" placeholder="blur" className="block aspect-[4/3] h-auto w-full object-cover object-left-top" />
                </div>
                <p className="pix text-[22px] leading-none text-band">{p.k}</p>
                <h3 className="text-[1.05rem] leading-tight font-extrabold tracking-[-0.02em] sm:text-[1.3rem]">{p.title}</h3>
                <p className="text-[13.5px] leading-snug text-[#b8cdc0] sm:text-[14.5px]">{p.desc}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 font-mono text-[13px] text-[#b8cdc0]">
            Hoje é grátis.{" "}
            <Link href="/organizar" className="text-band underline-offset-4 hover:underline">
              ver o passo a passo →
            </Link>
          </p>
          <p className="mt-3 font-mono text-[13px] text-[#b8cdc0]">
            Sua empresa quer apoiar?{" "}
            <Link href="/empresas" className="text-band underline-offset-4 hover:underline">
              quero patrocinar um desafio →
            </Link>
          </p>
        </div>
      </section>

      {/* 5. perfil */}
      <section aria-labelledby="perfil-title" className="mx-auto max-w-6xl px-4 pt-20 sm:px-6 sm:pt-24" data-testid="landing-perfil">
        <div className="grid gap-4 border-y-2 border-line py-8 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-12">
          <h2 id="perfil-title" className="text-[clamp(1.9rem,4vw,2.9rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
            O que você construiu <span className="text-accent">fica com você.</span>
          </h2>
          <p className="max-w-[44ch] text-[16px] leading-relaxed text-[#2b2b2b]">
            Projeto, equipe, prêmio e certificado com horas, num link que é seu.
          </p>
        </div>
      </section>

      {/* 6. dúvidas */}
      <section aria-labelledby="faq-title" className="mx-auto grid max-w-6xl gap-8 px-4 pt-20 sm:px-6 sm:pt-24 lg:grid-cols-[1fr_1.6fr]">
        <h2 id="faq-title" className="text-[clamp(1.9rem,3.6vw,2.6rem)] leading-[1] font-extrabold tracking-[-0.035em]">
          Dúvidas
        </h2>
        <div className="border-b-2 border-line" data-testid="landing-faq">
          {faq.map((f) => (
            <details key={f.q} className="group border-t-2 border-line">
              <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-4 py-3 text-[16.5px] font-bold">
                {f.q}
                <span aria-hidden className="font-mono text-accent group-open:rotate-45">+</span>
              </summary>
              <p className="max-w-[60ch] pb-5 text-[15.5px] leading-relaxed text-[#2b2b2b]">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="conta-title" className="mx-auto max-w-6xl px-4 pt-20 pb-24 sm:px-6 sm:pt-24 sm:pb-28" data-testid="landing-conta">
        <div className="flex flex-col items-start justify-between gap-6 border-2 border-line bg-mint p-7 sm:flex-row sm:items-center sm:p-9">
          <h2 id="conta-title" className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.05] font-extrabold tracking-[-0.03em]">
            Sua conta vale pra todas as comunidades.
          </h2>
          <Show when="signed-out">
            <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="btn min-h-[52px]! shrink-0 px-6!" data-testid="landing-signup">
                Entrar na comunidade →
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard" className="btn min-h-[52px]! shrink-0 px-6!">
              ir pro meu painel →
            </Link>
          </Show>
        </div>
      </section>
    </div>
  );
}
