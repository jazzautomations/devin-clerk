import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPost, listPosts } from "@/lib/blog";
import { absoluteUrl, articleJsonLd, jsonLd } from "@/lib/seo";

const fmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

export function generateStaticParams() {
  return listPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "post não encontrado" };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: absoluteUrl(`/blog/${post.slug}`),
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(articleJsonLd(post)) }}
      />
      <Link
        href="/blog"
        className="w-fit font-mono text-xs text-muted transition hover:text-accent"
      >
        {"← voltar pro blog"}
      </Link>

      <header className="flex flex-col gap-3 border-b border-line pb-6">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// blog"}
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {post.title}
        </h1>
        <p className="font-mono text-xs text-muted">
          {fmt.format(new Date(`${post.date}T12:00:00`))} · {post.author}
        </p>
        {post.tags.length > 0 && (
          <div className="flex gap-2">
            {post.tags.map((t) => (
              <span
                key={t}
                className="border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </header>

      <article
        className="blog-body"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />
    </section>
  );
}
