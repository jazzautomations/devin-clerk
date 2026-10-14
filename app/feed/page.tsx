import Link from "next/link";
import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { FeedSection } from "@/components/FeedSection";
import { getOrCreateMember } from "@/lib/members";
import { listPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "feed",
  description:
    "O que a comunidade tá construindo — demos, projetos e bastidores dos hackathons, postados por devs, empreendedores e marcas.",
  alternates: { canonical: "/feed" },
};

export default async function FeedPage() {
  const { userId } = await auth();
  let member = null;
  if (userId) {
    const user = await currentUser();
    member = getOrCreateMember({
      id: userId,
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? "",
      imageUrl: user?.imageUrl ?? null,
    });
  }
  const posts = listPosts(50, member?.id ?? null);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 [&>*]:max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"feed"}
        </p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          O que a comunidade tá construindo
        </h1>
        <p className="max-w-xl text-muted">
          Devs, empreendedores, investidores, professores e marcas — demos,
          projetos e bastidores dos hackathons.{" "}
          {!member && (
            <Link href="/sign-up" className="text-accent hover:underline">
              cria conta pra postar →
            </Link>
          )}
        </p>
      </div>

      <div className="grid max-w-none! gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-14">
        <div className="min-w-0">
          <FeedSection
            initialPosts={posts}
            canPost={Boolean(member)}
            me={member?.username ?? null}
            isAdmin={member?.role === "admin"}
          />
        </div>

        {/* regras da casa — o que cabe no feed */}
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <div className="window hard">
            <div className="tbar">
              <span className="title">FEED.txt — o que postar</span>
              <span className="dots" aria-hidden>
                <b />
                <b />
              </span>
            </div>
            <ol className="tbody gap-3 p-4!">
              {[
                ["Demo", "o que teu time entregou, com link"],
                ["Bastidor", "o que rolou na edição, foto, aprendizado"],
                ["Procuro time", "tua skill e o que falta no time"],
                ["Recado", "carona, mentoria, dúvida da edição"],
              ].map(([t, d], i) => (
                <li key={t} className="grid grid-cols-[28px_1fr] gap-2 font-sans text-[14px]">
                  <span className="font-mono text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <strong className="font-bold">{t}</strong>{" "}
                    <span className="text-muted">— {d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col gap-2 border-t-2 border-line pt-4">
            <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
              tá numa edição?
            </p>
            <p className="text-[14px] text-muted">
              Cada edição tem mural próprio na página dela. Post de edição
              aparece aqui também, com o selo da edição.
            </p>
            <Link href="/radar" className="cta-link go mt-2 self-start text-[18px]">
              Ver edições
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
