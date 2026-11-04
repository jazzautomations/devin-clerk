import db from "@/lib/db";
import { hiddenIdsFor } from "@/lib/blocks";
import { getChallenges } from "@/lib/challenges";
import { getEditionTerms } from "@/lib/eventTerms";
import { formatDbTime } from "@/lib/format";
import { getHackathon, hostedSql } from "@/lib/hackathons";
import type { Member } from "@/lib/members";
import { canNetwork } from "@/lib/network";
import { projectVisibleSql } from "@/lib/projects";
import { canUseQuestions } from "@/lib/questions";
import { canManageEdition } from "@/lib/roles";
import { dayLabel, timeLabel } from "@/lib/schedule";
import { excerpt, SEARCH_DOC, searchAll, searchWords } from "@/lib/search";
import { normalizeTech, techLabel } from "@/lib/techTags";
import { isEvaluationAsk } from "@/lib/copilot/guard";

// Recuperação do copilot (spec 046, onda 6: copilot-do-arquivo, migration
// 055). A pergunta em português cai numa intenção por regras e palavras-
// chave (sem LLM) e cada intenção lê de libs/tabelas que já existem —
// projetos visíveis por FTS, project_tech, prize_winners, campos e
// programação da edição, termos, desafios patrocinados e dúvidas
// resolvidas. Nada achou pela intenção → cai no searchAll. Cada resultado
// vira um fato numerado {n, tipo, titulo, href, trecho}: o LLM (quando
// configurado, lib/copilot/answer.ts) só pode citar esses números.
//
// Fronteiras respeitadas (as mesmas da busca global): projeto invisível
// nunca aparece (projectVisibleSql), pessoa passa por canNetwork e fica de
// fora se bloqueada, comunidade escondida não vaza, e dúvida resolvida só
// aparece pra quem pode usar o canal da edição.

export const COPILOT_INTENTS = ["similar", "stack", "edicao", "regras", "busca"] as const;
export type CopilotIntent = (typeof COPILOT_INTENTS)[number];

export const COPILOT_Q_MIN = 3;
export const COPILOT_Q_MAX = 300;
export const COPILOT_FACTS_MAX = 8;

export type CopilotFactTipo =
  | "projeto"
  | "pessoa"
  | "vencedor"
  | "desafio"
  | "edicao"
  | "agenda"
  | "regra"
  | "duvida"
  | "post"
  | "comunidade"
  | "hackathon";

/** um fato do arquivo: o que o copilot pode citar como [n] */
export type CopilotFact = {
  n: number;
  tipo: CopilotFactTipo;
  titulo: string;
  href: string;
  /** texto curto, pode ter \n (UI em whitespace-pre-line) */
  trecho: string;
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

const CFG = "'portuguese'";

// ——— intenção por regras e palavras-chave ———
//
// Ordem: 'edicao' (campeões) antes de 'regras' ("quem ganhou o desafio X" é
// vencedor, não regra); 'regras' só com edição no contexto; 'stack' antes
// de 'similar' ("quem já usou X" não é "já fizeram isso?"); sem padrão,
// 'busca' (searchAll direto).

const RE_EDICAO = /\b(ganhou|ganhador\w*|campe\w*|vencedor\w*|podio\w*|trofeu|finalista\w*|ficou em)\b/;
const RE_REGRAS =
  /\b(prazo\w*|deadline|horario\w*|hora|quando|onde|regra\w*|programa\w*|agenda|cronograma|entreg\w*|submiss\w*|almoc\w*|janta|lanche|refei\w*|cafe|mentor\w*|pitch|check[- ]?in|ingresso\w*|sala|conduta|termo\w*|idade\w*|menor|desafio\w*|patrocina\w*|premio\w*|trilha\w*|jurado\w*|juri\b|certificado\w*|inscri\w*|palestra\w*|oficina\w*|abertura|encerramento|formato\w*|local\w*|cidade\w*)\b/;
const RE_STACK =
  /\b(usou|usaram|usam|usa|usando|utiliz\w*|stack|tecnolog\w*|feito (com|em)|construido com|sabe\w*|manja\w*|conhece\w*|domina\w*|cod(a|ar|ando) (com|em))\b/;
const RE_SIMILAR =
  /\b(ja (fiz|fez|fizeram|criou|criaram|construiu|construiram|montou|montaram|tentou|tentaram)|alguem|existe|parecid\w*|similar|ideia\w*|fazer (um|uma)|montar|criar)\b/;

export function detectIntent(q: string, hasEdition: boolean): CopilotIntent {
  const f = ` ${fold(q)} `;
  if (RE_EDICAO.test(f)) return "edicao";
  if (hasEdition && RE_REGRAS.test(f)) return "regras";
  if (RE_STACK.test(f)) return "stack";
  if (RE_SIMILAR.test(f)) return "similar";
  return "busca";
}

// ——— palavras e termos ———

const STOPWORDS = new Set(
  `a o e ou de do da dos das em no na nos nas um uma uns umas para pra pro por com sem sob sobre que qual quais
   quem como quando onde foi sao ser eh se me mim meu minha nos nossa nosso esse essa isso isto ao aos as os
   ele ela eles elas seu sua seus suas mais menos muito pouco algum alguma algo coisa coisas la aqui
   tem tera tinha faz feita feito quero queria gostaria preciso pode podem sera so ja seria`.split(/\s+/),
);

// palavras de intenção: carregam o tipo da pergunta, não o assunto — saem
// do termo antes de procurar edição por nome ou tech por tag
const INTENT_WORDS = new Set(
  `ganhou ganhador ganhadora campeao campeoes campea vencedor vencedora podio trofeu finalista ultima ultimo
   usou usaram usa usando utilizou utilizam stack tecnologia tecnologias feito sabe manja conhece conhecem domina
   hackathon hackathons edicao edicoes primeira primeiro projeto projetos app aplicativo pessoa pessoas time times
   alguem existe parecido parecida similar ideia ideias hoje`.split(/\s+/),
);

/** palavras de conteúdo: termo da pergunta sem stopword nem palavra de intenção */
function contentWords(q: string): string[] {
  return searchWords(q).filter((w) => !STOPWORDS.has(fold(w)) && !INTENT_WORDS.has(fold(w)));
}

/** tags de tech extraídas da pergunta (palavras soltas + pares vizinhos) */
function techTermsFor(q: string): string[] {
  const words = contentWords(q);
  const out: string[] = [];
  const push = (raw: string) => {
    const t = normalizeTech(raw);
    if (t && !out.includes(t)) out.push(t);
  };
  words.forEach((w, i) => {
    push(w);
    if (i + 1 < words.length) push(`${w} ${words[i + 1]}`);
  });
  return out.slice(0, 4);
}

const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const pgTextArray = (ids: (string | number)[]) => `{${ids.join(",")}}`;

type FactDraft = Omit<CopilotFact, "n">;

const placeLabel = (place: number) => `${place}º lugar`;

// tsquery dos dois modos do search.ts: todas as palavras; se zerar, qualquer
// uma (a função devolve as duas variantes prontas pra tentar em ordem)
function tsQueries(q: string): { sql: string; params: Record<string, string> }[] {
  const words = searchWords(q);
  const any =
    words.length > 1
      ? {
          sql: `(${words.map((_, i) => `plainto_tsquery(${CFG}, @w${i})`).join(" || ")})`,
          params: Object.fromEntries(words.map((w, i) => [`w${i}`, w])),
        }
      : null;
  const all = { sql: `websearch_to_tsquery(${CFG}, @q)`, params: { q } };
  return any ? [all, any] : [all];
}

// ——— 'similar': projetos visíveis por FTS ———

type ProjectRow = {
  teamId: number;
  teamName: string;
  placement: number;
  title: string;
  tagline: string | null;
  description: string | null;
  howBuilt: string | null;
  continuedAt: string | null;
  hackathonId: string;
  hackathonName: string;
};

function projectFact(p: ProjectRow, extra?: string): FactDraft {
  const meta = [p.teamName, p.hackathonName, p.placement > 0 ? placeLabel(p.placement) : null, p.continuedAt ? "continuou" : null]
    .filter(Boolean)
    .join(" · ");
  const snippet = p.tagline ?? excerpt(p.description || p.howBuilt || "", "", 140);
  return {
    tipo: "projeto",
    titulo: p.title,
    href: `/p/${p.teamId}`,
    trecho: [meta, extra ?? snippet].filter(Boolean).join("\n"),
  };
}

async function similarFacts(q: string): Promise<FactDraft[]> {
  const doc = SEARCH_DOC.projetos("tp");
  const base = (tq: string) => `SELECT t.id AS "teamId", t.name AS "teamName", t.placement,
        tp.title, tp.tagline, tp.description, tp."howBuilt", tp."continuedAt",
        h.id AS "hackathonId", h.name AS "hackathonName"
     FROM teams t
     JOIN team_projects tp ON tp."teamId" = t.id
     JOIN hackathons h ON h.id = t."hackathonId"
     WHERE ${doc} @@ ${tq} AND ${projectVisibleSql("t", "h")}
     ORDER BY ts_rank(${doc}, ${tq}) DESC, t.id DESC
     LIMIT ${COPILOT_FACTS_MAX}`;
  for (const tq of tsQueries(q)) {
    const rows = await db.prepare(base(tq.sql)).all<ProjectRow>(tq.params);
    if (rows.length) return rows.map((p) => projectFact(p));
  }
  return [];
}

// ——— 'stack': projetos por project_tech + pessoas por skills ———

async function stackFacts(q: string, meId: number | null): Promise<FactDraft[]> {
  const tags = techTermsFor(q);
  if (!tags.length) return [];
  const labels = tags.map(techLabel).join(", ");

  const projects = await db
    .prepare(
      `SELECT t.id AS "teamId", t.name AS "teamName", t.placement,
              tp.title, tp.tagline, tp.description, tp."howBuilt", tp."continuedAt",
              h.id AS "hackathonId", h.name AS "hackathonName"
       FROM teams t
       JOIN team_projects tp ON tp."teamId" = t.id
       JOIN hackathons h ON h.id = t."hackathonId"
       WHERE ${projectVisibleSql("t", "h")}
         AND EXISTS (SELECT 1 FROM project_tech pt WHERE pt."teamId" = t.id AND pt.tag = ANY(@tags::text[]))
       ORDER BY h."startsAt" DESC, t.id DESC
       LIMIT 5`,
    )
    .all<ProjectRow>({ tags: pgTextArray(tags) });

  const facts = projects.map((p) => projectFact(p, `feito com ${labels}`));

  // pessoas: skills (JSON de texto livre) bate a tag por LIKE escapado —
  // mesma aproximação da lista de membros. Bloqueado e excluído ficam fora.
  const hidden = meId ? await hiddenIdsFor(meId) : { blocked: [] };
  const conds = tags.map((_, i) => `m.skills ILIKE @s${i} ESCAPE '\\'`).join(" OR ");
  const params: Record<string, unknown> = { blocked: pgTextArray(hidden.blocked) };
  tags.forEach((t, i) => (params[`s${i}`] = `%${esc(t)}%`));
  const people = await db
    .prepare(
      `SELECT m.id, m.username, m.name, m.headline
       FROM members m
       WHERE m."clerkId" NOT LIKE 'deleted:%'
         AND NOT (m.id = ANY(@blocked::int[]))
         AND (${conds})
       ORDER BY m.id DESC
       LIMIT 12`,
    )
    .all<{ id: number; username: string; name: string | null; headline: string | null }>(params);
  const ok = await Promise.all(people.map((p) => canNetwork(p.id)));
  people
    .filter((_, i) => ok[i])
    .slice(0, 3)
    .forEach((p) => {
      facts.push({
        tipo: "pessoa",
        titulo: p.name ?? `@${p.username}`,
        href: `/u/${p.username}`,
        trecho: [p.headline ?? `@${p.username}`, `skills com ${labels}`].join("\n"),
      });
    });
  return facts;
}

// ——— 'edicao': prize_winners da edição citada ou das últimas ———

type EditionRef = { id: string; name: string; startsAt: string };

async function editionsFor(q: string, hackathonId: string | null): Promise<EditionRef[]> {
  if (hackathonId) {
    const h = await getHackathon(hackathonId);
    return h && h.active ? [{ id: h.id, name: h.name, startsAt: h.startsAt }] : [];
  }
  const words = contentWords(q).slice(0, 6);
  if (words.length) {
    const params: Record<string, string> = {};
    const hit = words
      .map((w, i) => {
        params[`w${i}`] = `%${esc(w)}%`;
        return `CASE WHEN h.name ILIKE @w${i} ESCAPE '\\' THEN 1 ELSE 0 END`;
      })
      .join(" + ");
    const row = await db
      .prepare(
        `SELECT h.id, h.name, h."startsAt", (${hit}) AS hit
         FROM hackathons h
         LEFT JOIN communities c ON c.id = h."communityId"
         WHERE h.active = 1 AND COALESCE(c.hidden, 0) = 0 AND (${hit}) > 0
         ORDER BY hit DESC, h."startsAt" DESC
         LIMIT 1`,
      )
      .get<EditionRef>(params);
    if (row) return [row];
  }
  // sem edição citada: as últimas com resultado publicado
  return db
    .prepare(
      `SELECT DISTINCT h.id, h.name, h."startsAt"
       FROM prize_categories pc
       JOIN hackathons h ON h.id = pc."hackathonId"
       LEFT JOIN communities c ON c.id = h."communityId"
       WHERE h.active = 1 AND COALESCE(c.hidden, 0) = 0
         AND ${hostedSql("h")}
         AND EXISTS (SELECT 1 FROM prize_winners w WHERE w."categoryId" = pc.id)
       ORDER BY h."startsAt" DESC
       LIMIT 2`,
    )
    .all<EditionRef>();
}

async function edicaoFacts(q: string, hackathonId: string | null): Promise<FactDraft[]> {
  const editions = await editionsFor(q, hackathonId);
  if (!editions.length) return [];
  const rows = await db
    .prepare(
      `SELECT w.place, pc.name AS "categoryName", t.id AS "teamId", t.name AS "teamName",
              tp.title, h.id AS "hackathonId", h.name AS "hackathonName",
              CASE WHEN tp."teamId" IS NOT NULL AND ${projectVisibleSql("t", "h")} THEN 1 ELSE 0 END AS "canLink"
       FROM prize_winners w
       JOIN prize_categories pc ON pc.id = w."categoryId"
       JOIN teams t ON t.id = w."teamId"
       JOIN hackathons h ON h.id = pc."hackathonId"
       LEFT JOIN team_projects tp ON tp."teamId" = t.id
       WHERE pc."hackathonId" = ANY(@ids::text[])
       ORDER BY h."startsAt" DESC, pc.position, w.place, t.name`,
    )
    .all<{
      place: number;
      categoryName: string;
      teamId: number;
      teamName: string;
      title: string | null;
      hackathonId: string;
      hackathonName: string;
      canLink: number;
    }>({ ids: pgTextArray(editions.map((e) => e.id)) });
  return rows.slice(0, COPILOT_FACTS_MAX).map((r) => ({
    tipo: "vencedor",
    titulo: r.title ? `${r.title} — ${r.teamName}` : r.teamName,
    href: r.canLink === 1 ? `/p/${r.teamId}` : `/h/${r.hackathonId}`,
    trecho: `${placeLabel(r.place)} em ${r.categoryName}\n${r.hackathonName}`,
  }));
}

// ——— 'regras': campos, programação, termos, desafios e dúvidas da edição ———

async function regrasFacts(q: string, me: Member | null, hackathonId: string): Promise<FactDraft[]> {
  const h = await getHackathon(hackathonId);
  if (!h || !h.active) return [];
  // edição de comunidade escondida: mesma fronteira da página /h/[id]
  if (h.communityHidden && !(await canManageEdition(me, h.id))) return [];

  const f = ` ${fold(q)} `;
  const words = contentWords(q);
  const facts: FactDraft[] = [];
  const has = (re: RegExp) => re.test(f);

  if (has(/\b(prazo|deadline|entreg|submiss)\b/) && h.submissionDeadline) {
    facts.push({
      tipo: "edicao",
      titulo: "Prazo de entrega",
      trecho: `até ${formatDbTime(h.submissionDeadline)}${h.submissionGraceMinutes ? ` (+${h.submissionGraceMinutes} min de tolerância)` : ""}`,
      href: `/h/${h.id}/entrega`,
    });
  }
  if (has(/\b(quando|data|dia|comeca|termina|duracao|horario)\b/)) {
    facts.push({
      tipo: "edicao",
      titulo: "Quando é",
      trecho: h.endsAt
        ? `de ${formatDbTime(h.startsAt)} a ${formatDbTime(h.endsAt)}`
        : `a partir de ${formatDbTime(h.startsAt)}`,
      href: `/h/${h.id}`,
    });
  }
  if (has(/\b(onde|local|cidade|formato|online|presencial|hibrido)\b/)) {
    facts.push({
      tipo: "edicao",
      titulo: "Onde e como",
      trecho: [h.location, h.format].filter(Boolean).join(" · "),
      href: `/h/${h.id}`,
    });
  }
  if (has(/\binscri\b/) && h.registrationDeadline) {
    facts.push({
      tipo: "edicao",
      titulo: "Inscrições",
      trecho: `até ${formatDbTime(h.registrationDeadline)}`,
      href: `/h/${h.id}`,
    });
  }

  // programação publicada: itens cujo título/descrição/sala bate a pergunta
  if (has(/\b(programa|agenda|horario|hora|quando|cronograma|almoc|janta|lanche|refei|cafe|mentor|pitch|check|sala|palestra|oficina|abertura|encerramento)\b/)) {
    const params: Record<string, unknown> = { h: h.id };
    const conds = words.length
      ? words
          .map((w, i) => {
            params[`w${i}`] = `%${esc(w)}%`;
            return `(si.title ILIKE @w${i} ESCAPE '\\' OR si.description ILIKE @w${i} ESCAPE '\\' OR si.room ILIKE @w${i} ESCAPE '\\')`;
          })
          .join(" OR ")
      : "TRUE";
    const items = await db
      .prepare(
        `SELECT si.id, si.title, si."startsAt", si."endsAt", si.room
         FROM schedule_items si
         WHERE si."hackathonId" = @h AND si."publishedAt" IS NOT NULL AND (${conds})
         ORDER BY si."startsAt" LIMIT 4`,
      )
      .all<{ id: number; title: string; startsAt: string; endsAt: string; room: string }>(params);
    items.forEach((si) => {
      facts.push({
        tipo: "agenda",
        titulo: si.title,
        trecho: `${dayLabel(si.startsAt)}, ${timeLabel(si.startsAt)}–${timeLabel(si.endsAt)}${si.room ? ` · ${si.room}` : ""}`,
        href: `/h/${h.id}/programacao`,
      });
    });
    if (!items.length) {
      facts.push({
        tipo: "agenda",
        titulo: "Programação da edição",
        trecho: "a grade publicada fica na página de programação",
        href: `/h/${h.id}/programacao`,
      });
    }
  }

  // desafios patrocinados da edição
  if (has(/\b(desafio|patrocina|patrono|premio)\b/)) {
    const challenges = await getChallenges(h.id);
    challenges.slice(0, 3).forEach((c) => {
      facts.push({
        tipo: "desafio",
        titulo: c.title,
        trecho: [`patrocinado por ${c.sponsor}${c.prize ? ` · ${c.prize}` : ""}`, excerpt(c.description ?? "", "", 120)]
          .filter(Boolean)
          .join("\n"),
        href: `/h/${h.id}`,
      });
    });
  }

  // termos e regras formais da edição
  if (has(/\b(idade|menor|termo|conduta|regra|dieta|restric|aliment|aceite|documento|responsavel)\b/)) {
    const terms = await getEditionTerms(h.id);
    facts.push({
      tipo: "regra",
      titulo: "Idade mínima",
      trecho: `${terms.minAge} anos${terms.allowsMinors ? " (menor com responsável)" : ""}`,
      href: `/h/${h.id}/conduta`,
    });
    if (terms.dietEnabled) {
      facts.push({
        tipo: "regra",
        titulo: "Restrição alimentar",
        trecho: "a inscrição pergunta sua restrição alimentar",
        href: `/h/${h.id}/conduta`,
      });
    }
    if (has(/\b(conduta|termo|regra)\b/)) {
      facts.push({
        tipo: "regra",
        titulo: "Código de conduta",
        trecho: excerpt(terms.conductText, "", 120),
        href: `/h/${h.id}/conduta`,
      });
    }
  }

  // dúvidas já resolvidas — só pra quem pode ler o canal da edição
  if (me && (await canUseQuestions(me, h.id)) && words.length) {
    const params: Record<string, unknown> = { h: h.id };
    const conds = words
      .map((w, i) => {
        params[`w${i}`] = `%${esc(w)}%`;
        return `q.body ILIKE @w${i} ESCAPE '\\'`;
      })
      .join(" OR ");
    const qs = await db
      .prepare(
        `SELECT q.id, q.body,
                (SELECT a.body FROM answers a WHERE a."questionId" = q.id ORDER BY a.id LIMIT 1) AS answer
         FROM questions q
         WHERE q."hackathonId" = @h AND q."resolvedAt" IS NOT NULL AND (${conds})
         ORDER BY q.id DESC LIMIT 3`,
      )
      .all<{ id: number; body: string; answer: string | null }>(params);
    qs.forEach((row) => {
      facts.push({
        tipo: "duvida",
        titulo: excerpt(row.body, "", 80),
        trecho: row.answer ? excerpt(row.answer, "", 120) : "resolvida nas dúvidas da edição",
        href: `/h/${h.id}/duvidas`,
      });
    });
  }

  return facts.slice(0, COPILOT_FACTS_MAX);
}

// ——— 'busca' (fallback): searchAll + desafios abertos ———

async function buscaFacts(q: string, meId: number | null): Promise<FactDraft[]> {
  const res = await searchAll(q, meId, { limit: 5 });
  const facts: FactDraft[] = [];
  res.sections.projetos?.items.forEach((p) =>
    facts.push({
      tipo: "projeto",
      titulo: p.title,
      href: `/p/${p.teamId}`,
      trecho: [`${p.teamName} · ${p.hackathonName}`, p.tagline].filter(Boolean).join("\n"),
    }),
  );
  res.sections.pessoas?.items.forEach((p) =>
    facts.push({
      tipo: "pessoa",
      titulo: p.name ?? `@${p.username}`,
      href: `/u/${p.username}`,
      trecho: [p.headline, `@${p.username}`].filter(Boolean).join("\n"),
    }),
  );
  res.sections.posts?.items.forEach((p) =>
    facts.push({
      tipo: "post",
      titulo: p.name ?? `@${p.username}`,
      href: `/post/${p.id}`,
      trecho: [p.excerpt, p.hackathonName ?? p.communityName ?? ""].filter(Boolean).join("\n"),
    }),
  );
  res.sections.comunidades?.items.forEach((c) =>
    facts.push({
      tipo: "comunidade",
      titulo: c.name,
      href: `/comunidade/${c.slug}`,
      trecho: excerpt(c.description ?? "", "", 120),
    }),
  );
  res.sections.hackathons?.items.forEach((h) =>
    facts.push({
      tipo: "hackathon",
      titulo: h.name,
      href: `/h/${h.id}`,
      trecho: [h.organizer, formatDbTime(h.startsAt)].filter(Boolean).join(" · "),
    }),
  );

  // "desafio" fora de edição: os desafios abertos das comunidades
  if (/\bdesafio/.test(fold(q))) {
    const rows = await db
      .prepare(
        `SELECT oc.id, oc.title, oc.brief, oc.prize, oc."sponsorName", c.name AS "communityName"
         FROM open_challenges oc
         JOIN communities c ON c.id = oc."communityId"
         WHERE oc.status IN ('aberto','resultado') AND oc."removedAt" IS NULL AND c.hidden = 0
         ORDER BY oc."publishedAt" DESC LIMIT 3`,
      )
      .all<{ id: number; title: string; brief: string; prize: string | null; sponsorName: string | null; communityName: string }>();
    rows.forEach((r) =>
      facts.push({
        tipo: "desafio",
        titulo: r.title,
        href: `/desafios/${r.id}`,
        trecho: [[r.sponsorName ? `patrocinado por ${r.sponsorName}` : null, r.communityName].filter(Boolean).join(" · "), r.prize]
          .filter(Boolean)
          .join("\n"),
      }),
    );
  }
  return facts;
}

/**
 * Junta tudo: detecta a intenção (ou usa a recebida), busca os fatos e, se
 * vier vazio, cai na busca global. Devolve até COPILOT_FACTS_MAX fatos já
 * numerados de 1..n — o número é o que o resumo cita como [n].
 */
export async function retrieveFacts(
  q: string,
  me: Member | null,
  opts: { hackathonId?: string | null; intent?: CopilotIntent } = {},
): Promise<CopilotFact[]> {
  const hackathonId = opts.hackathonId ?? null;
  const intent = opts.intent ?? detectIntent(q, !!hackathonId);
  let drafts: FactDraft[] = [];
  if (intent === "similar") drafts = await similarFacts(q);
  else if (intent === "stack") drafts = await stackFacts(q, me?.id ?? null);
  else if (intent === "edicao") drafts = await edicaoFacts(q, hackathonId);
  else if (intent === "regras" || (intent === "busca" && hackathonId)) {
    // 'busca' dentro da edição: antes de abrir dúvida nova, a pessoa pergunta
    // sem palavra-chave de regra ("pode usar lib paga?") — a edição responde
    // primeiro; vazio cai na busca global
    drafts = hackathonId ? await regrasFacts(q, me, hackathonId) : [];
  }
  if (!drafts.length) drafts = await buscaFacts(q, me?.id ?? null);
  return drafts.slice(0, COPILOT_FACTS_MAX).map((f, i) => ({ ...f, n: i + 1 }));
}

// ——— log da pergunta (copilot_queries, migration 055) ———

const PRUNE_DAYS = 90;

/**
 * Grava a pergunta e devolve o id pro feedback. A poda de 90 dias roda aqui
 * mesmo, a cada insert — pergunta de arquivo é contexto, não histórico.
 * Nunca grava a resposta: o resumo é gerado na hora e não vira registro.
 */
export async function logCopilotQuery(
  memberId: number,
  question: string,
  intent: CopilotIntent,
  resultCount: number,
  usedLlm: boolean,
): Promise<number> {
  await db
    .prepare(`DELETE FROM copilot_queries WHERE to_ts("createdAt") < now() - interval '${PRUNE_DAYS} days'`)
    .run();
  const row = await db
    .prepare(
      `INSERT INTO copilot_queries ("memberId", question, intent, "resultCount", "usedLlm")
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(memberId, question.slice(0, COPILOT_Q_MAX), intent, resultCount, usedLlm ? 1 : 0);
  return row!.id;
}

/** voto "ajudou?" — só da pessoa que perguntou */
export async function setCopilotFeedback(id: number, memberId: number, helpful: boolean): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE copilot_queries SET helpful = ? WHERE id = ? AND "memberId" = ?`)
    .run(helpful ? 1 : 0, id, memberId);
  return r.changes > 0;
}

export { isEvaluationAsk };
