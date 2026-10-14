import db from "@/lib/db";

export default async function EditionPanelHome({ params }: PageProps<"/admin/h/[id]">) {
  const { id } = await params;
  const counts = await db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'approved') AS aprovados,
         COUNT(*) FILTER (WHERE status = 'pending') AS pendentes,
         COUNT(*) AS total
       FROM registrations WHERE hackathonId = ?`,
    )
    .get<{ aprovados: number; pendentes: number; total: number }>(id);
  const stats = [
    ["inscrições", counts?.total ?? 0],
    ["aprovados", counts?.aprovados ?? 0],
    ["pedidos pendentes", counts?.pendentes ?? 0],
  ] as const;
  return (
    <dl className="grid grid-cols-1 border-[1.5px] border-line sm:grid-cols-3">
      {stats.map(([label, n]) => (
        <div key={label} className="flex flex-col gap-1 border-line p-5 not-last:border-b-[1.5px] sm:not-last:border-r-[1.5px] sm:not-last:border-b-0">
          <dt className="font-mono text-[12px] tracking-widest text-muted uppercase">{label}</dt>
          <dd className="pix text-4xl">{n}</dd>
        </div>
      ))}
    </dl>
  );
}
