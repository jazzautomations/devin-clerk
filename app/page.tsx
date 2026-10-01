import Link from "next/link";
import { appConfig } from "@/app.config";

const pillars = [
  {
    n: "01",
    title: "Um perfil pra todas as inscrições",
    text: "Identidade única de hacker — inscreva-se nos eventos parceiros sem preencher formulário novo toda vez.",
  },
  {
    n: "02",
    title: "Feed curado BR + mundo",
    text: "Os hackathons rolando no Brasil e lá fora, filtrados por quem vive o cenário — não por algoritmo.",
  },
  {
    n: "03",
    title: "Histórico público",
    text: "Skills, projetos e campanhas numa página tua. Prova de trabalho, não promessa de currículo.",
  },
];

export default function Home() {
  return (
    <div className="relative">
      <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />
      <section className="relative mx-auto flex max-w-5xl flex-col px-6 pt-20 pb-24 sm:pt-28">
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

        <div className="mt-20 grid divide-y divide-line border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {pillars.map((p) => (
            <div key={p.n} className="flex flex-col gap-3 px-6 py-8 sm:px-8">
              <span className="font-mono text-xs text-accent">{p.n}</span>
              <h2 className="font-display text-lg font-semibold tracking-tight">
                {p.title}
              </h2>
              <p className="text-sm leading-relaxed text-muted">{p.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
