import Link from "next/link";
import { notFound } from "next/navigation";
import { EncountersAdminForm } from "@/components/EncountersAdminForm";
import { adminEncounterStats, encountersOn, missionsOn } from "@/lib/encounters";
import { getHackathon } from "@/lib/hackathons";
import { currentMember } from "@/lib/session";
import { hasEditionRole } from "@/lib/roles";

// Encontros no painel da edição (spec 046, onda 5): liga/desliga e mostra
// só número agregado. Nenhum nome, nenhum encontro individual — com menos de
// 5 presentes a leitura vira "poucos dados" pra não virar dedo apontado.

export default async function AdminEncontrosPage({ params }: PageProps<"/admin/h/[id]/encontros">) {
  const { id } = await params;
  const [member, h] = await Promise.all([currentMember(), getHackathon(id)]);
  if (!member || !h) notFound();
  if (!(await hasEditionRole(member, id, "organizador"))) notFound();

  const [on, missions, stats] = await Promise.all([
    encountersOn(id),
    missionsOn(id),
    adminEncounterStats(id),
  ]);
  const pct = Math.round(stats.pctComEncontro * 100);
  const rows: { label: string; value: string }[] = stats.poucosDados
    ? [{ label: "leitura", value: "poucos dados" }]
    : [
        { label: "presentes com pelo menos 1 encontro", value: `${pct}%` },
        { label: "encontros confirmados", value: String(stats.confirmados) },
        { label: "entre faculdades ou cidades diferentes", value: String(stats.entreFaculdades) },
        { label: "times com gente que se conheceu ali", value: String(stats.timesFormados) },
      ];
  const dist = [
    ["0 encontros", stats.distribuicao.zero],
    ["1 encontro", stats.distribuicao.um],
    ["2 a 3", stats.distribuicao.doisTres],
    ["4 ou mais", stats.distribuicao.quatroMais],
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">encontros</p>
        <h2 className="text-[clamp(1.5rem,4vw,2rem)] leading-none font-extrabold tracking-[-0.035em]">
          Encontros na edição
        </h2>
        <p className="max-w-prose text-[14.5px] text-muted">
          Opcional e leve. Quem fez check-in e aceitou tem um código de 5 caracteres; o encontro só conta quando os
          dois confirmam. Um encontro por par por edição, sem ranking e sem XP.
        </p>
      </div>

      <EncountersAdminForm hackathonId={id} encountersOn={on} missionsOn={missions} />

      <section className="flex flex-col gap-3 border-t-2 border-line pt-5" data-testid="admin-encontros-stats">
        <h3 className="text-[17px] font-extrabold tracking-[-0.02em]">Números da edição</h3>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3 border border-line px-3 py-2.5">
              <dt className="text-[13.5px] text-muted">{r.label}</dt>
              <dd className="font-mono text-[15px]">{r.value}</dd>
            </div>
          ))}
        </dl>
        {!stats.poucosDados && (
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[12px] tracking-widest text-muted uppercase">pessoas por participante</p>
            <ul className="flex flex-wrap gap-2">
              {dist.map(([label, n]) => (
                <li key={label} className="border border-line px-3 py-2 font-mono text-[13px]">
                  {label}: {n}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="max-w-prose text-[13px] text-muted">
          Nada individual: nenhum nome, nenhum par e nenhuma nota privada chegam aqui. Menos de 5 presentes aparece
          como poucos dados.
        </p>
      </section>

      <div className="flex flex-wrap gap-4 border-t border-line pt-4 font-mono text-[12.5px]">
        <Link href={`/h/${id}/encontros`} className="text-accent underline-offset-4 hover:underline">
          ver a tela do participante →
        </Link>
        <Link href={`/admin/h/${id}/denuncias`} className="text-muted underline-offset-4 hover:text-accent hover:underline">
          denúncias da edição →
        </Link>
      </div>
    </div>
  );
}
