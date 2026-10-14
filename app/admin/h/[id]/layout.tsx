import Link from "next/link";
import { notFound } from "next/navigation";
import { getHackathon } from "@/lib/hackathons";
import { getEditionRoles, type EditionRole } from "@/lib/roles";
import { currentMember } from "@/lib/session";

// Painel da edição (spec 033): onde a organização opera UMA edição.
// Cada aba é dona de uma feature; a aba só aparece pra quem tem o papel.
const TABS: { href: string; label: string; roles: EditionRole[] }[] = [
  { href: "", label: "visão geral", roles: ["organizador", "staff", "mentor", "jurado"] },
  { href: "/equipe", label: "equipe", roles: ["organizador"] },
  { href: "/formulario", label: "formulário", roles: ["organizador"] },
  { href: "/inscritos", label: "inscritos", roles: ["organizador"] },
  { href: "/avisos", label: "avisos", roles: ["organizador"] },
  { href: "/duvidas", label: "dúvidas", roles: ["organizador", "mentor"] },
  { href: "/presenca", label: "presença", roles: ["organizador"] },
  { href: "/checkin", label: "check-in", roles: ["organizador", "staff"] },
  { href: "/juri", label: "júri", roles: ["organizador", "jurado"] },
  { href: "/certificados", label: "certificados", roles: ["organizador"] },
];

export default async function EditionPanelLayout({
  children,
  params,
}: LayoutProps<"/admin/h/[id]">) {
  const { id } = await params;
  const [member, h] = await Promise.all([currentMember(), getHackathon(id)]);
  if (!member || !h) notFound();
  const roles = member.role === "admin" ? (["organizador"] as EditionRole[]) : await getEditionRoles(id, member.id);
  if (roles.length === 0) notFound();
  const can = (tab: (typeof TABS)[number]) =>
    roles.includes("organizador") || tab.roles.some((r) => roles.includes(r));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">
          painel da edição · {roles.join(" · ")}
        </p>
        <h1 className="text-[clamp(1.8rem,4vw,2.6rem)] leading-none font-extrabold tracking-[-0.035em]">
          {h.name}
        </h1>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[13px]">
          {TABS.filter(can).map((t) => (
            <Link key={t.href} href={`/admin/h/${id}${t.href}`} className="underline-offset-4 hover:text-accent hover:underline">
              {t.label}
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
