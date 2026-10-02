import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateMember } from "@/lib/members";
import { getOpenTo } from "@/lib/talent";
import { ProfileForm } from "@/components/ProfileForm";

export default async function PerfilPage() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  const user = await currentUser();
  const member = getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// perfil"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          @{member.username}
        </h1>
        <p className="text-muted">
          Teu perfil público:{" "}
          <Link
            href={`/u/${member.username}`}
            className="font-mono text-xs text-accent hover:underline"
          >
            /u/{member.username} →
          </Link>
        </p>
      </div>
      <ProfileForm member={member} openTo={getOpenTo(member.id)} />
    </section>
  );
}
