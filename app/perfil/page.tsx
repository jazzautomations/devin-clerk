import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateMember } from "@/lib/members";
import { getOpenTo } from "@/lib/talent";
import { ProfileForm } from "@/components/ProfileForm";
import { PrivacyPanel } from "@/components/PrivacyPanel";
import { getContactPrefs } from "@/lib/contact";
import { listMyImageConsents } from "@/lib/eventTerms";
import { ImageConsentToggle } from "@/components/ImageConsentToggle";

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

  const [openTo, contact, images] = await Promise.all([
    getOpenTo(member.id),
    getContactPrefs(member.id),
    listMyImageConsents(member.id),
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
      {images.length > 0 && (
        <section id="imagem" className="flex flex-col gap-3 border-t-2 border-line pt-6" data-testid="image-consents">
          <h2 className="text-xl font-extrabold tracking-[-0.03em]">Uso de imagem</h2>
          <p className="max-w-prose text-sm text-muted">
            Por edição em que tu se inscreveu. Revogar vale pra material novo; o que já foi publicado antes não é
            recolhido. Cada mudança fica registrada com data.
          </p>
          <ul className="flex flex-col">
            {images.map((e) => (
              <li key={e.hackathonId} className="border-t border-line py-2.5">
                <ImageConsentToggle hackathonId={e.hackathonId} granted={e.granted} source="perfil" label={e.name} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <PrivacyPanel />
    </section>
  );
}
