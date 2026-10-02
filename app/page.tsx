import Link from "next/link";
import { appConfig } from "@/app.config";
import { NewsletterForm } from "@/components/NewsletterForm";
import { getOpenHackathons, getPastHackathons } from "@/lib/hackathons";
import { listMembers } from "@/lib/members";
import { getStatsMomentum } from "@/lib/momentum";
import { listPosts } from "@/lib/posts";

const pilares = [
  {
    num: "01",
    title: "Sessões Hack Inova",
    desc: "Os eventos da comunidade com inscrição em 1 clique — sem Google Forms. Cada edição minta uma cartinha colecionável de prova de presença.",
    href: "/radar",
    cta: "ver sessões →",
  },
  {
    num: "02",
    title: "Radar",
    desc: "Hackathons abertos no Brasil e no mundo, raspados das fontes oficiais — Devpost, TAIKAI, MLH, Meetup, ETHGlobal.",
    href: "/radar",
    cta: "abrir radar →",
  },
  {
    num: "03",
    title: "Feed",
    desc: "Devs, empreendedores, investidores, professores e marcas postando demos e bastidores — a rede social do cenário.",
    href: "/feed",
    cta: "ver feed →",
  },
  {
    num: "04",
    title: "Comunidade",
    desc: "Diretório de quem constrói: perfis públicos com nível, badges, skills, projetos e histórico de campanhas.",
    href: "/membros",
    cta: "ver membros →",
  },
];

export default function Home() {
  const now = new Date();
  const upcoming = getOpenHackathons(now);
  const sessoes = upcoming.filter((h) => h.partner);
  const arquivo = getPastHackathons(now);
  const memberCount = listMembers(100).length;
  const postCount = listPosts(100).length;
  // "+N · 30d" (spec 027): só onde há timestamp real — "edições no arquivo"
  // não tem data de entrada, então nunca mostra momentum
  const momentum = getStatsMomentum(now);

  const stats = [
    { n: memberCount, label: "membros", delta: momentum.members },
    { n: upcoming.length, label: "hackathons abertos", delta: momentum.events },
    { n: arquivo.length, label: "edições no arquivo", delta: 0 },
    { n: postCount, label: "posts no feed", delta: momentum.posts },
  ];

  return (
    <div className="relative">
      <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto flex max-w-6xl flex-col px-6 pt-20 pb-24 sm:pt-28">

        {/* hero */}
        <section className="flex flex-col">
          <p className="font-mono text-xs tracking-widest text-accent">
            {"// a rede social dos hackathons"}
          </p>
          <h1 className="mt-6 max-w-4xl font-display text-[2.75rem] leading-[1.02] font-bold tracking-tight sm:text-7xl">
            Um perfil.
            <br />
            Todos os <span className="text-accent">hackathons</span>.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            {appConfig.description}
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/dashboard"
              className="bg-accent px-6 py-3 font-mono text-sm font-semibold text-black transition hover:brightness-110"
            >
              {"entrar_pro_early_access →"}
            </Link>
            <Link
              href="/radar"
              className="border border-line px-6 py-3 font-mono text-sm text-muted transition hover:border-accent/50 hover:text-foreground"
            >
              explorar o radar
            </Link>
          </div>

          <dl className="mt-14 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="bg-background px-5 py-4">
                <dt className="font-mono text-[10px] tracking-widest text-muted uppercase">
                  {s.label}
                </dt>
                <dd className="mt-1 font-display text-3xl font-bold text-accent">
                  {s.n}
                </dd>
                {s.delta > 0 && (
                  <dd className="mt-0.5 font-mono text-[10px] text-muted">
                    {`+${s.delta} · 30d`}
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </section>

        {/* próxima sessão em destaque */}
        {sessoes[0] && (
          <section className="mt-20">
            <div className="flex items-baseline gap-3 border-b border-line pb-4">
              <span className="font-mono text-[10px] text-muted">[01]</span>
              <h2 className="font-display text-2xl font-bold tracking-tight">
                Próxima <span className="text-accent">sessão</span>
              </h2>
            </div>
            <Link
              href={`/h/${sessoes[0].id}`}
              className="group flex flex-col gap-4 border border-line bg-surface p-6 transition hover:border-accent/40 sm:flex-row sm:items-center sm:gap-8 sm:p-8"
            >
              <div className="flex w-20 shrink-0 flex-col items-center justify-center border border-accent/30 bg-accent/10 py-4 font-mono">
                <span className="text-3xl font-bold text-accent">
                  {new Date(sessoes[0].startsAt).getDate()}
                </span>
                <span className="text-xs uppercase text-muted">
                  {new Intl.DateTimeFormat("pt-BR", { month: "short" })
                    .format(new Date(sessoes[0].startsAt))
                    .replace(".", "")}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="font-display text-2xl font-bold tracking-tight transition group-hover:text-accent">
                  {sessoes[0].name}
                </h3>
                <p className="font-mono text-sm text-muted">
                  {sessoes[0].location ?? "online"} · {sessoes[0].organizer}
                </p>
              </div>
              <span className="font-mono text-sm text-accent sm:ml-auto">
                inscrever em 1 clique →
              </span>
            </Link>
          </section>
        )}

        {/* pilares → rotas */}
        <section className="mt-20 flex flex-col gap-6">
          <div className="flex items-baseline gap-3 border-b border-line pb-4">
            <span className="font-mono text-[10px] text-muted">[02]</span>
            <h2 className="font-display text-2xl font-bold tracking-tight">
              O que tem aqui dentro
            </h2>
          </div>
          <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
            {pilares.map((p) => (
              <Link
                key={p.title}
                href={p.href}
                className="group flex flex-col gap-3 bg-background p-6 transition hover:bg-surface"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-xs text-accent">{p.num}</span>
                  <span className="font-mono text-xs text-muted transition group-hover:text-accent">
                    {p.cta}
                  </span>
                </div>
                <h3 className="font-display text-xl font-semibold tracking-tight transition group-hover:text-accent">
                  {p.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted">{p.desc}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* porta comercial — participante nunca paga; quem paga é a marca */}
        <p className="mt-20 font-mono text-xs text-muted">
          {"// marca/empresa? "}
          <Link
            href="/empresas"
            className="text-accent transition hover:underline"
          >
            sua marca pode lançar um desafio patrocinado numa edição →
          </Link>
        </p>

        {/* newsletter */}
        <section className="mt-20 border border-accent/30 bg-accent/5 p-6 sm:p-10">
          <div className="flex max-w-2xl flex-col gap-6">
            <p className="font-mono text-xs tracking-widest text-accent">
              {"// newsletter"}
            </p>
            <h2 className="font-display text-3xl font-bold tracking-tight">
              Toda semana, o que tá aberto.
            </h2>
            <p className="text-muted">
              Hackathons abertos, deadlines e o que tá em alta no cenário —
              curadoria de quem vive isso. Sem spam.
            </p>
            <NewsletterForm />
          </div>
        </section>
      </div>
    </div>
  );
}
