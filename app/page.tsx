import Link from "next/link";
import { appConfig } from "@/app.config";

export default function Home() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-6 py-24 text-center">
      <span className="text-6xl" aria-hidden>
        {appConfig.emoji}
      </span>
      <h1 className="text-5xl font-bold tracking-tight">{appConfig.name}</h1>
      <p className="max-w-xl text-lg text-black/70">{appConfig.description}</p>
      <div className="flex flex-wrap items-center justify-center gap-3 text-left">
        {[
          "Um perfil pra todas as inscrições",
          "Feed curado de hackathons BR + mundo",
          "Histórico e skills em página pública",
        ].map((item) => (
          <span
            key={item}
            className="rounded-full border border-black/10 bg-black/[0.03] px-4 py-2 text-sm"
          >
            {item}
          </span>
        ))}
      </div>
      <Link
        href="/dashboard"
        className="rounded-full bg-accent px-6 py-3 font-medium text-white shadow-sm transition hover:opacity-90"
      >
        Entrar pro early access →
      </Link>
      <p className="text-sm text-black/50">
        Landing pública. A página de early access é só pra membros logados.
      </p>
    </section>
  );
}
