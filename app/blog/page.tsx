import Link from "next/link";
import type { Metadata } from "next";
import { listPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "blog",
  description:
    "Guias de hackathon, recaps de edições e tutoriais da plataforma, escritos pela comunidade HackaHub.",
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
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 [&>*]:max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"blog"}
        </p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          Bastidores e guias
        </h1>
        <p className="max-w-xl text-muted">
          Como vencer hackathons, o que rolou nas edições e tutoriais da
          plataforma — escrito por quem vive isso.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="border-[1.5px] border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {"ainda sem posts — o primeiro tá saindo"}
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
                  <h2 className="font-display text-xl font-extrabold tracking-[-0.035em] transition group-hover:text-accent">
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
                        className="border-[1.5px] border-line px-2 py-0.5 font-mono text-[12px] text-muted"
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
