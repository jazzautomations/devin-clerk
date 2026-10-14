import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { EditionSponsorsAdmin, type SponsorAdminRow } from "@/components/EditionSponsorsAdmin";
import { listChallenges } from "@/lib/challenges";
import { listEditionSponsors, listGeneralCategories, listSponsorPeople } from "@/lib/editionSponsors";
import { canManageEdition } from "@/lib/roles";
import { absoluteUrl } from "@/lib/seo";
import { currentMember } from "@/lib/session";
import { countActiveOptIns } from "@/lib/sponsorContacts";

// Patrocinadores da edição (roadmap 037 #8/#12): cadastro, vínculo com
// desafios/categorias, pessoas da marca (acesso só ao relatório dela) e o
// QR do estande pro opt-in de contato. Só organizador / admin global.
export default async function EditionSponsorsPage({ params }: PageProps<"/admin/h/[id]/patrocinadores">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await canManageEdition(member, id))) notFound();
  const [sponsors, challenges, generalCategories] = await Promise.all([
    listEditionSponsors(id),
    listChallenges(id),
    listGeneralCategories(id),
  ]);
  const rows: SponsorAdminRow[] = await Promise.all(
    sponsors.map(async (s) => {
      const optInUrl = absoluteUrl(`/h/${id}/patrocinador/${s.sponsorId}`);
      const [people, qrSvg, optIns] = await Promise.all([
        listSponsorPeople(id, s.sponsorId),
        QRCode.toString(optInUrl, {
          type: "svg",
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#0c0c0c", light: "#fefefe" },
        }),
        countActiveOptIns(id, s.sponsorId),
      ]);
      return { ...s, ...people, optInUrl, qrSvg, optIns };
    }),
  );

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em]">
          Patrocinadores
        </h2>
        <p className="max-w-[62ch] text-[14px] text-muted">
          Quem patrocina esta edição. O logo aparece na página pública e no projeto que entrou no desafio da marca.
          Cada pessoa convidada vê só o relatório da própria marca. O QR leva ao opt-in de contato: só quem aceitar
          aparece no relatório com nome e e-mail.
        </p>
      </div>
      <EditionSponsorsAdmin
        hackathonId={id}
        sponsors={rows}
        challenges={challenges.map((c) => ({ id: c.id, title: c.title, sponsorId: c.sponsorId }))}
        categories={generalCategories}
      />
    </section>
  );
}

