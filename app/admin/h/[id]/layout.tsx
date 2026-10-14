import { notFound } from "next/navigation";
import { getHackathon } from "@/lib/hackathons";
import { getEditionRoles, type EditionRole } from "@/lib/roles";
import { mySponsorships } from "@/lib/editionSponsors";
import { currentMember } from "@/lib/session";
import { isConductHandler } from "@/lib/incidents";
import { AdminTabs, type AdminTabGroup } from "@/components/AdminTabs";

// Painel da edição (spec 033): onde a organização opera UMA edição.
// Cada aba é dona de uma feature; a aba só aparece pra quem tem o papel.
// conductHandler: a aba também aparece pra quem o organizador marcou como
// responsável de conduta (frente L) — staff comum não vê incidentes.
// Agrupadas pela fase do evento, na ordem em que o organizador usa.
type Tab = { href: string; label: string; roles: EditionRole[]; conductHandler?: boolean };
const GROUPS: { label: string; tabs: Tab[] }[] = [
  {
    label: "preparar",
    tabs: [
      { href: "", label: "visão geral", roles: ["organizador", "staff", "mentor", "jurado"] },
      { href: "/edicao", label: "configurar", roles: ["organizador"] },
      { href: "/equipe", label: "equipe", roles: ["organizador"] },
      { href: "/formulario", label: "formulário", roles: ["organizador"] },
      { href: "/patrocinadores", label: "patrocinadores", roles: ["organizador"] },
      { href: "/programacao", label: "programação", roles: ["organizador"] },
      { href: "/presenca", label: "presença", roles: ["organizador"] },
    ],
  },
  {
    label: "inscrição",
    tabs: [
      { href: "/inscritos", label: "inscritos", roles: ["organizador"] },
      { href: "/candidaturas", label: "candidaturas", roles: ["organizador"] },
      { href: "/avisos", label: "avisos", roles: ["organizador"] },
    ],
  },
  {
    label: "dia do evento",
    tabs: [
      { href: "/checkin", label: "check-in", roles: ["organizador", "staff"] },
      { href: "/crachas", label: "crachás", roles: ["organizador"] },
      { href: "/refeicoes", label: "refeições", roles: ["organizador", "staff"] },
      { href: "/duvidas", label: "dúvidas", roles: ["organizador", "mentor"] },
      { href: "/incidentes", label: "incidentes", roles: ["organizador"], conductHandler: true },
      { href: "/palco", label: "palco", roles: ["organizador", "staff"] },
    ],
  },
  {
    label: "julgar",
    tabs: [
      { href: "/entregas", label: "entregas", roles: ["organizador", "staff"] },
      { href: "/juri", label: "júri", roles: ["organizador", "jurado"] },
    ],
  },
  {
    label: "depois",
    tabs: [
      { href: "/certificados", label: "certificados", roles: ["organizador"] },
      { href: "/nps", label: "satisfação", roles: ["organizador"] },
    ],
  },
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
  const can = (tab: Tab) =>
    roles.includes("organizador") || tab.roles.some((r) => roles.includes(r)) || (handler && !!tab.conductHandler);
  const groups: AdminTabGroup[] =
    roles.length === 0
      ? []
      : GROUPS.map((g) => ({ label: g.label, tabs: g.tabs.filter(can).map(({ href, label }) => ({ href, label })) })).filter(
          (g) => g.tabs.length > 0,
        );
  const extra = [
    ...(!roles.includes("organizador")
      ? sponsorships.map((s) => ({ href: `/patrocinador/${s.sponsorId}`, label: `relatório · ${s.name}` }))
      : []),
    // rascunho não tem página pública ainda (dá 404)
    ...(h.active ? [{ href: `/h/${id}`, label: "ver página pública ↗", external: true }] : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">
          painel da edição · {labels.join(" · ")}
        </p>
        <h1 className="text-[clamp(1.8rem,4vw,2.6rem)] leading-none font-extrabold tracking-[-0.035em]">
          {h.name}
        </h1>
        {!h.active && (
          <p className="font-mono text-[12px] text-muted" data-testid="draft-note">
            {h.publishedAt
              ? "fora do ar: a edição foi arquivada pela administração do HackaHub."
              : "fora do ar: a página pública só aparece depois de publicar a edição."}
          </p>
        )}
        <AdminTabs base={`/admin/h/${id}`} groups={groups} extra={extra} />
      </header>
      {children}
    </div>
  );
}
