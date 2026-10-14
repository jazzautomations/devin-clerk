import db from "@/lib/db";

// Números da página /empresas (auditoria 041, empresas-stats-zero). É página
// de venda: número pequeno afasta a marca e número inflado engana. Por isso
// conta só o que é da casa e só mostra quando passa de um piso.

export type EmpresaStat = { key: "membros" | "edicoes" | "projetos"; label: string; n: number };

/** abaixo disso o número não aparece (0 membros é prova social negativa) */
export const STAT_FLOOR: Record<EmpresaStat["key"], number> = {
  membros: 50,
  edicoes: 2,
  projetos: 5,
};

/** filtra pelos pisos; a ordem de saída é a de entrada */
export function visibleStats(stats: EmpresaStat[]): EmpresaStat[] {
  return stats.filter((s) => s.n >= STAT_FLOOR[s.key]);
}

export async function empresaStats(): Promise<EmpresaStat[]> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM members WHERE clerkId NOT LIKE 'deleted:%') AS membros,
         -- edição da Hack Inova (mesma regra do "partner" de lib/hackathons),
         -- sem os eventos raspados do radar e sem rascunho vazio
         (SELECT COUNT(*) FROM hackathons h
            WHERE lower(h.organizer) LIKE '%hack inova%'
              AND (h.active = 1
                   OR EXISTS (SELECT 1 FROM registrations r WHERE r.hackathonId = h.id)
                   OR EXISTS (SELECT 1 FROM teams t WHERE t.hackathonId = h.id))) AS edicoes,
         (SELECT COUNT(*) FROM team_projects) AS projetos`,
    )
    .get<{ membros: number; edicoes: number; projetos: number }>();
  return visibleStats([
    { key: "membros", label: "membros", n: Number(row?.membros ?? 0) },
    { key: "edicoes", label: "edições Hack Inova", n: Number(row?.edicoes ?? 0) },
    { key: "projetos", label: "projetos entregues", n: Number(row?.projetos ?? 0) },
  ]);
}
