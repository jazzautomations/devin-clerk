import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateMember } from "@/lib/members";
import { getOpenTo } from "@/lib/talent";
import { ProfileForm } from "@/components/ProfileForm";
import { PrivacyPanel } from "@/components/PrivacyPanel";
import { UsernameChange } from "@/components/UsernameChange";
import { getContactPrefs } from "@/lib/contact";
import { listMyImageConsents } from "@/lib/eventTerms";
import { ImageConsentToggle } from "@/components/ImageConsentToggle";
import { ProfileReminder } from "@/components/ProfileReminder";
import { ContactShareRevoke } from "@/components/ContactShareRevoke";
import { listMyContactShares } from "@/lib/sponsorContacts";
import { channelsEnabled } from "@/lib/notify/channels";
import { formatDbTime } from "@/lib/format";
import { MascoteViewer } from "@/components/MascoteViewer";
import { mascoteDoMembro } from "@/lib/mascote/store";
import { ESPECIE_DEFS } from "@/lib/mascote/especies";
import { COPY_CRESCE } from "@/lib/mascote/tipos";

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

  const [openTo, contact, images, shares, bicho] = await Promise.all([
    getOpenTo(member.id),
    getContactPrefs(member.id),
    listMyImageConsents(member.id),
    listMyContactShares(member.id),
    mascoteDoMembro(member.id),
  ]);
  const channels = channelsEnabled();

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 [&>*]:max-w-3xl">
      <div className="flex flex-col gap-2">
        <p className="tag self-start uppercase">
          {"perfil"}
        </p>
        {/* username tem até 20 caracteres sem espaço: quebra em vez de estourar 390px */}
        <h1 className="min-w-0 font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95] [overflow-wrap:anywhere]">
          @{member.username}
        </h1>
        <p className="text-muted">
          Seu perfil público:{" "}
          <Link
            href={`/u/${member.username}`}
            className="font-mono text-xs text-accent hover:underline"
          >
            /u/{member.username} →
          </Link>
        </p>
        <UsernameChange username={member.username} changedAt={member.usernameChangedAt ?? null} />
        <Link href="/perfil/bloqueados" className="self-start font-mono text-xs text-muted underline-offset-4 hover:text-accent hover:underline" data-testid="perfil-bloqueados-link">
          bloqueados e silenciados →
        </Link>
      </div>
      {/* bicho (migration 043) */}
      <section
        id="bicho"
        className="flex scroll-mt-24 flex-col gap-5 border-t-2 border-line pt-6 sm:flex-row sm:items-center"
        data-testid="perfil-bicho"
      >
        <div className="desk w-[176px] shrink-0 border-x-2 p-2">
          <div className="border-2 border-line bg-background">
            <MascoteViewer config={bicho.config} tamanho={160} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-xl font-extrabold tracking-[-0.03em]">Seu bicho</h2>
          <p className="font-mono text-[13px] [overflow-wrap:anywhere]">
            <span className="font-semibold">{bicho.config.nome}</span>
            <span className="text-muted"> · {ESPECIE_DEFS[bicho.config.especie].nome}</span>
            {!bicho.salvo && <span className="text-muted"> · sorteado</span>}
          </p>
          <p className="max-w-prose text-sm text-muted">{COPY_CRESCE}</p>
          <Link href="/perfil/bicho" className="btn-ghost min-h-[44px]! self-start rounded-[6px] font-mono text-[14px]!" data-testid="perfil-bicho-editar">
            {bicho.salvo ? "trocar o visual →" : "montar seu bicho →"}
          </Link>
        </div>
      </section>
      <ProfileReminder member={member} href="/bem-vindo?refazer=1" />
      <ProfileForm member={member} openTo={openTo} contact={contact} channels={channels} />
      {images.length > 0 && (
        <section id="imagem" className="flex flex-col gap-3 border-t-2 border-line pt-6" data-testid="image-consents">
          <h2 className="text-xl font-extrabold tracking-[-0.03em]">Uso de imagem</h2>
          <p className="max-w-prose text-sm text-muted">
            Por edição em que você se inscreveu. Revogar vale pra material novo; o que já foi publicado antes não é
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
      {shares.length > 0 && (
        <section id="marcas" className="flex scroll-mt-24 flex-col gap-3 border-t-2 border-line pt-6" data-testid="contact-shares">
          <h2 className="text-xl font-extrabold tracking-[-0.03em]">Contato com marcas</h2>
          <p className="max-w-prose text-sm text-muted">
            Marcas com quem você compartilhou nome, e-mail, LinkedIn, GitHub e projeto no estande. Revogar tira seus
            dados do relatório da marca na hora.
          </p>
          <ul className="flex flex-col">
            {shares.map((c) => (
              <li
                key={`${c.hackathonId}/${c.sponsorId}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold break-words">{c.sponsorName}</span>
                  <span className="font-mono text-[12px] text-muted break-words">
                    {c.hackathonName} · desde {formatDbTime(c.sharedAt)}
                  </span>
                </div>
                <ContactShareRevoke hackathonId={c.hackathonId} sponsorId={c.sponsorId} sponsorName={c.sponsorName} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <PrivacyPanel />
    </section>
  );
}
