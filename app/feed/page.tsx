import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { FeedSection } from "@/components/FeedSection";
import { getOrCreateMember } from "@/lib/members";
import { listPosts } from "@/lib/posts";

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
    });
  }
  const posts = listPosts(50, member?.id ?? null);

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// feed"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
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

      <FeedSection initialPosts={posts} canPost={Boolean(member)} />
    </section>
  );
}
