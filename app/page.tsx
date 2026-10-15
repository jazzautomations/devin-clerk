import Link from "next/link";
import { Show, SignUpButton } from "@clerk/nextjs";
import { EditionRows } from "@/components/EditionRows";
import { getOpenHackathons } from "@/lib/hackathons";
import { landingSample } from "@/lib/radar";

// Landing curta (escolha do dono, 14/10/2026), posicionada como comunidade:
// rede de quem constrói, cada cidade/comunidade com sua edição e todo mundo
// no mesmo mapa. O que está aberto logo na primeira dobra, três linhas do que
// a rede faz, as portas de quem organiza e de quem patrocina, as dúvidas.
// Só promete o que existe (perfis, procuro-equipe, mural, feed, radar).

const passos = [
  { k: "01", title: "Encontre sua turma", desc: "Perfis de quem constrói, o quadro de quem procura equipe e o mural de cada edição." },
  { k: "02", title: "Construa junto", desc: "Hackathons abertos no Brasil inteiro. Inscrição, equipe e entrega pelo HackaHub." },
  { k: "03", title: "Mostre o que fez", desc: "Projetos, prêmios e certificado com carga horária no seu perfil, num link que é seu." },
] as const;

const faq = [
  {
    q: "O que é um hackathon?",
    a: "Uma maratona de um ou dois dias. Você forma uma equipe, escolhe um desafio, constrói um protótipo e apresenta pra um júri no fim.",
  },
  {
    q: "Preciso saber programar ou ter equipe?",
    a: "Não. Equipe boa mistura código, design, negócio e dados, e muita equipe se forma no próprio dia.",
  },
  {
    q: "Quanto custa?",
    a: "Nada. Quem participa não paga. A edição é bancada pela organização e pelos patrocinadores.",
  },
  {
    q: "O que eu levo do evento?",
    a: "Certificado com carga horária, que dá pra usar como hora complementar, os comentários do júri e o projeto no seu perfil.",
  },
  {
    q: "Por que preciso de conta?",
    a: "Porque lá dentro tem gente de verdade: perfis, equipes, o mural de cada edição. A conta é de graça e vale pra todas as edições.",
  },
] as const;

export default async function Home() {
  const now = new Date();
  const upcoming = await getOpenHackathons(now);
  const proxima = upcoming.find((h) => h.hosted) ?? null;
  // amostra de 4: Brasil (edições da casa e hackathons daqui) + 1–2 globais
  // grandes abertos pra brasileiros, sem o que fecha em menos de 48h
  // (lib/radar.ts). Loop de curiosidade: o radar completo é de quem tem
  // conta, e a contagem do resto é real (o radar inteiro que vale pra você)
  const { sample: abertos, count } = landingSample(upcoming, now, 4);
  const restantes = count - abertos.length;
  // sem edição anunciada, a próxima é surpresa: quem deixa o e-mail fica
  // sabendo primeiro (decisão do dono, 14/10/2026)
  const primaryHref = proxima ? `/h/${proxima.id}` : "#proxima";
  const primaryLabel = proxima ? "Quero participar" : "Quero saber da próxima edição";

  return (
    <div className="-mb-24 overflow-x-clip">
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
          <p className="mt-6 max-w-[46ch] text-[clamp(1.05rem,1.6vw,1.25rem)] leading-relaxed text-[#1e1e1e]">
            Quem constrói, quem organiza e quem apoia, num lugar só. Cada cidade com os seus hackathons,
            todo mundo no mesmo mapa.
          </p>
          <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-8">
            <Link href={primaryHref} className="btn min-h-[52px]! px-6! text-[16px]!" data-testid="hero-cta-primary">
              {primaryLabel} →
            </Link>
            <Link
              href="/organizar"
              className="cta-link go self-start text-[clamp(1.1rem,2vw,1.3rem)] sm:self-auto"
              data-testid="hero-cta-organizar"
            >
              Organizo hackathon
            </Link>
          </div>
        </section>
      </div>

      {!proxima && (
        <section id="proxima" aria-labelledby="proxima-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-16 sm:px-6" data-testid="landing-proxima-em-breve">
          <div className="grid gap-6 bg-foreground p-7 text-background sm:p-9 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-12">
            <div className="flex flex-col gap-3">
              <p className="pix text-[20px] leading-none text-band">PRÓXIMA EDIÇÃO NO HACKAHUB</p>
              <h2 id="proxima-title" className="text-[clamp(2rem,4.4vw,3.2rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">
                Em breve.
              </h2>
              <p className="max-w-[42ch] text-[15.5px] leading-relaxed text-[#b8cdc0]">
                Data, cidade e desafios saem primeiro pra quem está na comunidade. Quando a edição abrir, você recebe
                o aviso aqui dentro e no seu e-mail.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 lg:items-end">
              <Show when="signed-out">
                <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                  <button className="btn min-h-[52px]! bg-band! px-6! text-foreground!" data-testid="landing-proxima-signup">
                    criar conta e ficar sabendo →
                  </button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <p className="font-mono text-[14px] text-band">você já está dentro. O aviso chega no seu painel.</p>
              </Show>
            </div>
          </div>
        </section>
      )}

      {abertos.length > 0 && (
        <section id="abertos" aria-labelledby="abertos-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 sm:px-6">
          <div className="flex items-end justify-between gap-4 border-b-2 border-line pb-3">
            <h2 id="abertos-title" className="font-mono text-[13px] tracking-[0.08em] uppercase">
              abertos agora
            </h2>
            <Link href="/radar" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
              ver todos →
            </Link>
          </div>
          <EditionRows hackathons={abertos} testId="landing-proximas" now={now} />
          {restantes > 0 && (
            <div
              className="flex flex-col items-start justify-between gap-4 border-b-2 border-line bg-mint px-2 py-5 sm:flex-row sm:items-center"
              data-testid="landing-radar-trancado"
            >
              <p className="text-[clamp(1.1rem,2vw,1.35rem)] font-extrabold tracking-[-0.02em]">
                +{restantes} {restantes === 1 ? "hackathon aberto" : "hackathons abertos"} no radar.
                <span className="block text-[15px] font-normal text-[#2b2b2b]">
                  O Brasil por estado e o online do mundo todo, com a regra de quem pode entrar. Fica dentro da
                  plataforma.
                </span>
              </p>
              <Show when="signed-out">
                <SignUpButton mode="modal" forceRedirectUrl="/radar">
                  <button className="btn min-h-[48px]! shrink-0 px-5!">ver o radar completo →</button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <Link href="/radar" className="btn min-h-[48px]! shrink-0 px-5!">
                  ver o radar completo →
                </Link>
              </Show>
            </div>
          )}
        </section>
      )}

      <section id="como-funciona" aria-labelledby="como-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-20 sm:px-6 sm:pt-24">
        <h2 id="como-title" className="sr-only">
          Como funciona
        </h2>
        <ol className="ink-grid md:grid-cols-3">
          {passos.map((p) => (
            <li key={p.k} className="flex flex-col gap-2 p-6">
              <span className="pix text-[26px] leading-none text-accent">{p.k}</span>
              <h3 className="text-[1.6rem] leading-tight font-extrabold tracking-[-0.03em]">{p.title}</h3>
              <p className="text-[15.5px] leading-relaxed text-[#2b2b2b]">{p.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Pra quem organiza e pra quem patrocina" className="mx-auto mt-20 grid max-w-6xl gap-px px-4 sm:mt-24 sm:px-6 md:grid-cols-2">
        <div className="flex flex-col gap-3 bg-foreground p-7 text-background sm:p-9" data-testid="landing-organizar">
          <h2 className="text-[clamp(1.7rem,3vw,2.3rem)] leading-[1] font-extrabold tracking-[-0.035em]">Organiza na sua cidade?</h2>
          <p className="max-w-[40ch] text-[15.5px] leading-relaxed text-[#b8cdc0]">
            Faculdade, coletivo ou empresa: sua comunidade roda a edição dela aqui, e quem participa já chega
            com perfil.
          </p>
          <Link href="/organizar" className="mt-2 self-start font-mono text-[14px] text-band underline-offset-4 hover:underline">
            Como funciona pra organizar →
          </Link>
        </div>
        <div className="flex flex-col gap-3 border-2 border-line p-7 sm:p-9" data-testid="landing-patrocinar">
          <h2 className="text-[clamp(1.7rem,3vw,2.3rem)] leading-[1] font-extrabold tracking-[-0.035em]">Quer patrocinar?</h2>
          <p className="max-w-[40ch] text-[15.5px] leading-relaxed text-[#2b2b2b]">
            Sua empresa propõe um desafio, as equipes constroem em cima dele e você recebe o relatório do que aconteceu.
          </p>
          <Link href="/empresas" className="mt-2 self-start font-mono text-[14px] text-accent underline-offset-4 hover:underline">
            Quero patrocinar um desafio →
          </Link>
        </div>
      </section>

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
            Entre pra comunidade.
          </h2>
          <Show when="signed-out">
            <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="btn min-h-[52px]! shrink-0 px-6!" data-testid="landing-signup">
                criar conta, é de graça →
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
