import Link from "next/link";
import type { Metadata } from "next";
import { listPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "blog",
  description:
    "Guias de hackathon, recaps das edições do Hack Inova e tutoriais da plataforma — conteúdo da comunidade HackaHub.",
  alternates: { canonical: "/blog" },
};

const fmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

export default function BlogPage() {
  const posts = listPosts();

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// blog"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Bastidores e guias
        </h1>
        <p className="max-w-xl text-muted">
          Como vencer hackathons, o que rolou nas edições e tutoriais da
          plataforma — escrito por quem vive isso.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="border border-dashed border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {"// ainda sem posts — o primeiro tá saindo"}
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/blog/${p.slug}`}
                className="group flex flex-col gap-2 py-5"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-display text-xl font-semibold tracking-tight transition group-hover:text-accent">
                    {p.title}
                  </h2>
                  <time
                    dateTime={p.date}
                    className="shrink-0 font-mono text-xs text-muted"
                  >
                    {fmt.format(new Date(`${p.date}T12:00:00`))}
                  </time>
                </div>
                <p className="text-sm text-muted">{p.excerpt}</p>
                {p.tags.length > 0 && (
                  <span className="flex gap-2">
                    {p.tags.map((t) => (
                      <span
                        key={t}
                        className="border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
                      >
                        #{t}
                      </span>
                    ))}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
