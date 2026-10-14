import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateMember } from "@/lib/members";
import { getOpenTo } from "@/lib/talent";
import { ProfileForm } from "@/components/ProfileForm";
import { PrivacyPanel } from "@/components/PrivacyPanel";
import { getContactPrefs } from "@/lib/contact";

export default async function PerfilPage() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  const user = await currentUser();
  const member = await getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    imageUrl: user?.imageUrl ?? null,
  });

  const [openTo, contact] = await Promise.all([
    getOpenTo(member.id),
    getContactPrefs(member.id),
  ]);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 [&>*]:max-w-3xl">
      <div className="flex flex-col gap-2">
        <p className="tag self-start uppercase">
          {"perfil"}
        </p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
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
      <ProfileForm member={member} openTo={openTo} contact={contact} />
      <PrivacyPanel />
    </section>
  );
}
