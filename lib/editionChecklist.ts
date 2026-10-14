import db from "@/lib/db";
import { parseEventTime } from "@/lib/eventTime";

// Checklist da visão geral do painel (/admin/h/[id]): o que falta pra fase
// atual, cada item com link pra aba que resolve. Uma consulta só, com
// subconsultas EXISTS — a visão geral abre rápido mesmo com edição cheia.
//
// Publicar (rascunho → no ar) exige o mínimo: data de início válida e, se
// não for online, o local. O resto é recomendação.

export type EditionPhase = "rascunho" | "arquivada" | "inscricoes" | "inscricoes_encerradas" | "dia_do_evento" | "encerrada";

export const PHASE_LABEL: Record<EditionPhase, string> = {
  rascunho: "rascunho · só a equipe vê",
  arquivada: "arquivada · fora do ar",
  inscricoes: "inscrições abertas",
  inscricoes_encerradas: "inscrições encerradas",
  dia_do_evento: "dia do evento",
  encerrada: "encerrada",
};

export type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  optional?: boolean;
  href: string;
};

type Facts = {
  name: string;
  startsAt: string;
  endsAt: string | null;
  format: string;
  location: string | null;
  registrationDeadline: string | null;
  capacity: number | null;
  active: number;
  publishedAt: string | null;
  rsvpEnabled: number;
  terms: boolean;
  questions: boolean;
  staff: boolean;
  schedule: boolean;
  rubric: boolean;
  judges: boolean;
  results: boolean;
  certificates: boolean;
  nps: boolean;
};

async function facts(hackathonId: string): Promise<Facts | null> {
  const row = await db
    .prepare(
      `SELECT h.name, h.startsAt, h.endsAt, h.format, h.location, h.registrationDeadline, h.capacity,
              h.active, h.publishedAt, h.rsvpEnabled,
              EXISTS (SELECT 1 FROM edition_terms t WHERE t.hackathonId = h.id) AS "terms",
              EXISTS (SELECT 1 FROM edition_questions q
                      WHERE q.hackathonId = h.id AND q.audience = 'participante' AND q.archived = 0) AS "questions",
              EXISTS (SELECT 1 FROM edition_roles r WHERE r.hackathonId = h.id AND r.role = 'staff') AS "staff",
              EXISTS (SELECT 1 FROM schedule_items s
                      WHERE s.hackathonId = h.id AND s.publishedAt IS NOT NULL) AS "schedule",
              EXISTS (SELECT 1 FROM rubric_criteria c WHERE c.hackathonId = h.id) AS "rubric",
              EXISTS (SELECT 1 FROM edition_roles r WHERE r.hackathonId = h.id AND r.role = 'jurado') AS "judges",
              EXISTS (SELECT 1 FROM jury_results j WHERE j.hackathonId = h.id) AS "results",
              EXISTS (SELECT 1 FROM certificates c WHERE c.hackathonId = h.id) AS "certificates",
              EXISTS (SELECT 1 FROM nps_invites n WHERE n.hackathonId = h.id) AS "nps"
       FROM hackathons h WHERE h.id = ?`,
    )
    .get<Facts>(hackathonId);
  return row ?? null;
}

const DAY = 86_400_000;

export function editionPhase(
  h: Pick<Facts, "active" | "startsAt" | "endsAt" | "registrationDeadline"> & { publishedAt?: string | null },
  now = new Date(),
): EditionPhase {
  if (h.active !== 1) return h.publishedAt ? "arquivada" : "rascunho";
  const start = parseEventTime(h.startsAt);
  const end = parseEventTime(h.endsAt) ?? start;
  const t = now.getTime();
  if (start && end && t > Math.max(end.getTime(), start.getTime()) + DAY / 2) return "encerrada";
  if (start && t >= start.getTime() - DAY) return "dia_do_evento";
  const deadline = parseEventTime(h.registrationDeadline);
  if (deadline && t > deadline.getTime()) return "inscricoes_encerradas";
  return "inscricoes";
}

function blockersOf(f: Facts): string[] {
  const out: string[] = [];
  if (!parseEventTime(f.startsAt)) out.push("data de início");
  if (f.format !== "online" && !f.location?.trim()) out.push("local do evento");
  return out;
}

/** o que falta pro organizador publicar a edição (vazio = pode publicar) */
export async function getPublishBlockers(hackathonId: string): Promise<string[]> {
  const f = await facts(hackathonId);
  return f ? blockersOf(f) : ["edição não encontrada"];
}

export type EditionChecklist = {
  phase: EditionPhase;
  /** itens da fase atual (antes do evento, no dia, depois) */
  items: ChecklistItem[];
  /** mínimo pra publicar; só faz sentido no rascunho */
  blockers: string[];
  capacity: number | null;
};

export async function getEditionChecklist(hackathonId: string, now = new Date()): Promise<EditionChecklist | null> {
  const f = await facts(hackathonId);
  if (!f) return null;
  const phase = editionPhase(f, now);
  const tab = (p: string) => `/admin/h/${hackathonId}${p}`;
  const before: ChecklistItem[] = [
    {
      key: "datas",
      label: f.format === "online" ? "datas da edição" : "datas e local",
      done: blockersOf(f).length === 0,
      href: tab("/edicao"),
    },
    { key: "vagas", label: "número de vagas", done: f.capacity !== null, href: tab("/edicao") },
    { key: "prazo", label: "prazo de inscrição", done: f.registrationDeadline !== null, href: tab("/edicao") },
    { key: "termos", label: "código de conduta e idade mínima revisados", done: f.terms, href: tab("/formulario") },
    {
      key: "perguntas",
      label: "perguntas extras da inscrição",
      done: f.questions,
      optional: true,
      href: tab("/formulario"),
    },
    { key: "equipe", label: "pelo menos uma pessoa de staff convidada", done: f.staff, href: tab("/equipe") },
    { key: "programacao", label: "programação publicada", done: f.schedule, href: tab("/programacao") },
    {
      key: "presenca",
      label: "confirmação de presença ligada",
      done: f.rsvpEnabled === 1,
      optional: true,
      href: tab("/presenca"),
    },
  ];
  const dayOf: ChecklistItem[] = [
    { key: "equipe", label: "staff pro check-in", done: f.staff, href: tab("/equipe") },
    { key: "programacao", label: "programação publicada", done: f.schedule, href: tab("/programacao") },
    { key: "criterios", label: "critérios de avaliação do júri", done: f.rubric, href: tab("/juri") },
    { key: "jurados", label: "jurados convidados", done: f.judges, href: tab("/equipe") },
  ];
  const after: ChecklistItem[] = [
    { key: "resultado", label: "resultado do júri publicado", done: f.results, href: tab("/juri") },
    { key: "certificados", label: "certificados emitidos", done: f.certificates, href: tab("/certificados") },
    { key: "nps", label: "pesquisa de satisfação enviada", done: f.nps, href: tab("/nps") },
  ];
  const items = phase === "encerrada" || phase === "arquivada" ? after : phase === "dia_do_evento" ? dayOf : before;
  return { phase, items, blockers: blockersOf(f), capacity: f.capacity };
}
