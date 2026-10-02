import Link from "next/link";
import { appConfig } from "@/app.config";
import { NewsletterForm } from "@/components/NewsletterForm";
import { getPastHackathons, getUpcomingHackathons } from "@/lib/hackathons";
import { listMembers } from "@/lib/members";

const educacao = [
  {
    title: "Guia Oracle pra hackathon",
    desc: "Do zero à VPS com agente: rede, máquina, OpenCode/Pi/Devin e os serviços OCI que valem a pena.",
    href: "https://hackinova.vercel.app/oracle.html",
  },
  {
    title: "Terraform notas do César",
    desc: "Infra declarativa pra subir o ambiente do time — o material que virou referência dos hackathons.",
    href: "https://hackinova-anhembi.vercel.app/downloads/terraform-cesar-notas.md",
  },
  {
    title: "Preparar equipe",
    desc: "Plano do desafio, checklist do time e materiais do dia — como se chega pronto num hackathon nosso.",
    href: "https://hackinova-anhembi.vercel.app",
  },
];

const fmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
});

export default function Home() {
  const now = new Date();
  const upcoming = getUpcomingHackathons(now);
  const sessoes = upcoming.filter((h) => h.partner);
  const radar = upcoming.filter((h) => !h.partner);
  const arquivo = getPastHackathons(now);
  const members = listMembers(24);

  return (
    <div className="relative">
      <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto flex max-w-5xl flex-col px-6 pt-20 pb-24 sm:pt-28">

        {/* hero */}
        <section className="flex flex-col">
          <p className="font-mono text-xs tracking-widest text-accent">
            {"// hub brasileiro de hackathons"}
          </p>
          <h1 className="mt-6 font-display text-[2.75rem] leading-[1.02] font-bold tracking-tight sm:text-7xl">
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
              href="/sign-in"
              className="border border-line px-6 py-3 font-mono text-sm text-muted transition hover:border-accent/50 hover:text-foreground"
            >
              já tenho conta
            </Link>
          </div>
        </section>

        {/* sessões hackinova */}
        <section className="mt-24 flex flex-col gap-6">
          <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">
              Sessões <span className="text-accent">Hack Inova</span>
            </h2>
            <span className="font-mono text-xs text-muted">
              os eventos da comunidade
            </span>
          </div>
          <ul className="divide-y divide-line">
            {sessoes.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/h/${h.id}`}
                  className="group flex items-center justify-between gap-4 py-4"
                >
                  <div className="flex flex-col gap-1">
                    <span className="font-display text-lg font-semibold tracking-tight transition group-hover:text-accent">
                      {h.name}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {h.location ?? "online"} · {h.organizer}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-accent">
                    {fmt.format(new Date(h.startsAt))} →
                  </span>
                </Link>
              </li>
            ))}
            {sessoes.length === 0 && (
              <li className="py-4 font-mono text-xs text-muted">
                {"// próxima sessão sendo anunciada — assina a newsletter"}
              </li>
            )}
          </ul>
          {arquivo.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
                arquivo
              </span>
              <ul className="divide-y divide-line border-y border-line">
                {arquivo.map((h) => (
                  <li key={h.id}>
                    <Link
                      href={`/h/${h.id}`}
                      className="flex items-center justify-between gap-4 py-3 transition hover:text-accent"
                    >
                      <span className="text-sm">{h.name}</span>
                      <span className="font-mono text-xs text-muted">
                        {fmt.format(new Date(h.startsAt))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* radar */}
        <section className="mt-20 flex flex-col gap-6">
          <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">
              Radar
            </h2>
            <span className="font-mono text-xs text-muted">
              o que tá rolando BR + mundo
            </span>
          </div>
          <ul className="divide-y divide-line">
            {radar.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-4 py-4">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{h.name}</span>
                  <span className="font-mono text-xs text-muted">
                    {h.organizer} · {h.location ?? "online"}
                  </span>
                </div>
                <a
                  href={h.registrationUrl}
                  target="_blank"
                  rel="noopener"
                  className="shrink-0 border border-line px-3 py-1.5 font-mono text-xs text-muted transition hover:border-accent/50 hover:text-accent"
                >
                  {fmt.format(new Date(h.startsAt))} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* educação */}
        <section className="mt-20 flex flex-col gap-6">
          <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">
              Conteúdo
            </h2>
            <span className="font-mono text-xs text-muted">
              preparação pra ganhar hackathon
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {educacao.map((c) => (
              <a
                key={c.title}
                href={c.href}
                target="_blank"
                rel="noopener"
                className="flex flex-col gap-2 border border-line bg-surface p-5 transition hover:border-accent/40"
              >
                <h3 className="font-display font-semibold tracking-tight">
                  {c.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted">{c.desc}</p>
                <span className="mt-auto font-mono text-xs text-accent">
                  abrir →
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* comunidade — member wall estilo AI Tinkerers */}
        {members.length > 0 && (
          <section className="mt-20 flex flex-col gap-6">
            <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
              <h2 className="font-display text-2xl font-bold tracking-tight">
                Comunidade
              </h2>
              <span className="font-mono text-xs text-muted">
                quem constrói aqui
              </span>
            </div>
            <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((m) => (
                <li key={m.username}>
                  <Link
                    href={`/u/${m.username}`}
                    className="group flex flex-col gap-0.5"
                  >
                    <span className="font-medium transition group-hover:text-accent">
                      {m.name ?? `@${m.username}`}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {m.headline ?? m.skills.slice(0, 3).join(" · ") ?? ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* newsletter */}
        <section className="mt-20 flex flex-col gap-6 border border-line bg-surface p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-2xl font-bold tracking-tight">
              Newsletter
            </h2>
            <p className="text-muted">
              Toda semana: hackathons abertos, deadlines e o que tá em alta.
              Sem spam, curadoria de quem vive o cenário.
            </p>
          </div>
          <NewsletterForm />
        </section>
      </div>
    </div>
  );
}
