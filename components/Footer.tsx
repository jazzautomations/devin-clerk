import Link from "next/link";
import { appConfig } from "@/app.config";

const cols = [
  {
    title: "Plataforma",
    links: [
      { href: "/radar", label: "Radar de hackathons" },
      { href: "/feed", label: "Feed" },
      { href: "/projetos", label: "Projetos" },
      { href: "/membros", label: "Membros" },
    ],
  },
  {
    title: "Pra marcas",
    links: [
      { href: "/empresas", label: "Lançar um desafio" },
      { href: "/talento", label: "Talento" },
      { href: "/blog", label: "Blog" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/termos", label: "Termos de uso" },
      { href: "/legal/privacidade", label: "Privacidade" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t-2 border-band bg-foreground text-background">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="flex flex-col gap-3">
          <p className="pix text-[28px] leading-none text-band">
            {appConfig.name.toUpperCase()}
          </p>
          <p className="max-w-[34ch] font-mono text-[13px] leading-relaxed text-[#b8cdc0]">
            Realização Hack Inova. A comunidade que roda hackathon de verdade
            em universidade, empresa e rua.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title} className="flex flex-col gap-2">
            <p className="font-mono text-[12px] tracking-[0.06em] text-[#b8cdc0] uppercase">
              {c.title}
            </p>
            {c.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-[14px] text-background underline-offset-4 hover:text-band hover:underline"
              >
                {l.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-[#2a5f45]">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-4 font-mono text-[12px] text-[#b8cdc0] sm:px-6">
          <span>{appConfig.name.toLowerCase()} · pt-BR</span>
          <span>participante nunca paga</span>
        </div>
      </div>
    </footer>
  );
}
