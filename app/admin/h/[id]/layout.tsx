import Link from "next/link";
import { notFound } from "next/navigation";
import { getHackathon } from "@/lib/hackathons";
import { getEditionRoles, type EditionRole } from "@/lib/roles";
import { mySponsorships } from "@/lib/editionSponsors";
import { currentMember } from "@/lib/session";
import { isConductHandler } from "@/lib/incidents";

// Painel da edição (spec 033): onde a organização opera UMA edição.
// Cada aba é dona de uma feature; a aba só aparece pra quem tem o papel.
// conductHandler: a aba também aparece pra quem o organizador marcou como
// responsável de conduta (frente L) — staff comum não vê incidentes.
const TABS: { href: string; label: string; roles: EditionRole[]; conductHandler?: boolean }[] = [
  { href: "", label: "visão geral", roles: ["organizador", "staff", "mentor", "jurado"] },
  { href: "/equipe", label: "equipe", roles: ["organizador"] },
  { href: "/formulario", label: "formulário", roles: ["organizador"] },
  { href: "/inscritos", label: "inscritos", roles: ["organizador"] },
  { href: "/candidaturas", label: "candidaturas", roles: ["organizador"] },
  { href: "/avisos", label: "avisos", roles: ["organizador"] },
  { href: "/programacao", label: "programação", roles: ["organizador"] },
  { href: "/duvidas", label: "dúvidas", roles: ["organizador", "mentor"] },
  { href: "/presenca", label: "presença", roles: ["organizador"] },
  { href: "/checkin", label: "check-in", roles: ["organizador", "staff"] },
  { href: "/crachas", label: "crachás", roles: ["organizador"] },
  { href: "/refeicoes", label: "refeições", roles: ["organizador", "staff"] },
  { href: "/incidentes", label: "incidentes", roles: ["organizador"], conductHandler: true },
  { href: "/entregas", label: "entregas", roles: ["organizador", "staff"] },
  { href: "/juri", label: "júri", roles: ["organizador", "jurado"] },
  { href: "/palco", label: "palco", roles: ["organizador", "staff"] },
  { href: "/certificados", label: "certificados", roles: ["organizador"] },
  { href: "/patrocinadores", label: "patrocinadores", roles: ["organizador"] },
  { href: "/nps", label: "nps", roles: ["organizador"] },
];

export default async function EditionPanelLayout({
  children,
  params,
}: LayoutProps<"/admin/h/[id]">) {
  const { id } = await params;
  const [member, h] = await Promise.all([currentMember(), getHackathon(id)]);
  if (!member || !h) notFound();
  const [roles, sponsorships] = await Promise.all([
    member.role === "admin" ? (["organizador"] as EditionRole[]) : getEditionRoles(id, member.id),
    // papel patrocinador (migration 017) é por marca: só a aba do relatório dela
    mySponsorships(id, member.id),
  ]);
  if (roles.length === 0 && sponsorships.length === 0) notFound();
  const handler = roles.includes("organizador") ? false : await isConductHandler(member.id, id);
  const labels = [...roles, ...(sponsorships.length > 0 && !roles.includes("organizador") ? ["patrocinador"] : [])];
  const can = (tab: (typeof TABS)[number]) =>
    roles.includes("organizador") || tab.roles.some((r) => roles.includes(r)) || (handler && !!tab.conductHandler);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">
          painel da edição · {labels.join(" · ")}
        </p>
        <h1 className="text-[clamp(1.8rem,4vw,2.6rem)] leading-none font-extrabold tracking-[-0.035em]">
          {h.name}
        </h1>
        <nav data-print-hide className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[13px]">
          {(roles.length > 0 ? TABS.filter(can) : []).map((t) => (
            <Link key={t.href} href={`/admin/h/${id}${t.href}`} className="underline-offset-4 hover:text-accent hover:underline">
              {t.label}
            </Link>
          ))}
          {!roles.includes("organizador") &&
            sponsorships.map((s) => (
              <Link
                key={s.sponsorId}
                href={`/admin/h/${id}/patrocinador/${s.sponsorId}`}
                className="underline-offset-4 hover:text-accent hover:underline"
              >
                relatório · {s.name}
              </Link>
            ))}
          <Link href={`/h/${id}`} className="text-muted underline-offset-4 hover:underline">
            ver página pública ↗
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
