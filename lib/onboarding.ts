// spec 039 — onboarding pós-cadastro (/bem-vindo). Módulo puro: intenções,
// validação do que a pessoa manda, próximo passo no fim e completude do
// perfil. Serve o client (wizard), a API e os testes.

export const INTENTS = [
  { key: "participar", label: "participar de hackathon" },
  { key: "organizar", label: "organizar uma edição" },
  { key: "mentorar", label: "mentorar ou julgar" },
  { key: "patrocinar", label: "patrocinar" },
] as const;

export type IntentKey = (typeof INTENTS)[number]["key"];
const INTENT_KEYS = new Set<string>(INTENTS.map((i) => i.key));

export function parseIntents(input: unknown): { value: IntentKey[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "intents deve ser uma lista" };
  const out: IntentKey[] = [];
  for (const v of input) {
    if (typeof v !== "string" || !INTENT_KEYS.has(v)) return { error: `intenção desconhecida: ${String(v)}` };
    if (!out.includes(v as IntentKey)) out.push(v as IntentKey);
  }
  return { value: out };
}

/** texto curto opcional: trim, limite, vazio → null */
export function shortText(v: unknown, max: number, field: string): { value: string | null } | { error: string } {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return { error: `${field} inválido` };
  const s = v.trim().replace(/\s+/g, " ");
  if (s.length > max) return { error: `${field}: até ${max} caracteres` };
  return { value: s || null };
}

export const LIMITS = { name: 80, headline: 90, city: 60, institution: 100, course: 80 } as const;

/**
 * redirect_url só pode ser caminho DESTE site ("/h/x/inscricao"). Qualquer
 * coisa com esquema, host ou "//" vira null (open redirect).
 */
export function safeRedirect(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(s)) return null;
  if (s.startsWith("/bem-vindo") || s.startsWith("/sign-")) return null;
  return s;
}

export type OnboardingNext = { title: string; detail: string; label: string; href: string };

/**
 * Fim do onboarding: redirect_url (a pessoa veio de um link, ex.: a
 * inscrição de uma edição) ganha de tudo; senão a primeira intenção, na
 * ordem participar → organizar → mentorar → patrocinar.
 */
export function onboardingNext(opts: {
  intents: IntentKey[];
  redirectUrl: string | null;
  /** próxima edição com inscrição pelo HackaHub aberta */
  nextEdition: { id: string; name: string } | null;
  /** edição aberta recebendo candidatura de mentor/jurado */
  helpEdition: { id: string; name: string; kind: "mentor" | "jurado" | "voluntario" } | null;
}): OnboardingNext {
  const back = safeRedirect(opts.redirectUrl);
  if (back) {
    const m = back.match(/^\/h\/([^/?#]+)/);
    return {
      title: m ? "Bora pra inscrição" : "Bora voltar",
      detail: m ? "Tu volta pra edição e termina a inscrição de onde parou." : "Tu volta pra página que tu tava abrindo.",
      label: m ? "continuar a inscrição" : "continuar",
      href: back,
    };
  }
  const has = (k: IntentKey) => opts.intents.includes(k);
  if (has("participar") || opts.intents.length === 0) {
    return opts.nextEdition
      ? {
          title: "Tua primeira edição",
          detail: `${opts.nextEdition.name} tá com inscrição aberta.`,
          label: "ver a edição e se inscrever",
          href: `/h/${opts.nextEdition.id}`,
        }
      : {
          title: "Acha teu hackathon",
          detail: "Nenhuma edição com inscrição pelo HackaHub aberta agora. O radar tem os abertos no Brasil e no mundo.",
          label: "ver hackathons abertos",
          href: "/radar",
        };
  }
  if (has("organizar")) {
    return {
      title: "Conta da tua edição",
      detail: "Mostra quando, onde e pra quantas pessoas; a Hack Inova responde.",
      label: "falar com a Hack Inova",
      href: "/organizar#contato",
    };
  }
  if (has("mentorar")) {
    return opts.helpEdition
      ? {
          title: "Tem edição chamando",
          detail: `${opts.helpEdition.name} tá recebendo candidatura de ${opts.helpEdition.kind === "voluntario" ? "voluntário" : opts.helpEdition.kind}.`,
          label: "me candidatar",
          href: `/h/${opts.helpEdition.id}/candidatura/${opts.helpEdition.kind}`,
        }
      : {
          title: "Mentoria e júri",
          detail: "Quando uma edição abrir candidatura, ela aparece na página da edição e no teu painel.",
          label: "ir pro meu painel",
          href: "/dashboard",
        };
  }
  return {
    title: "Patrocínio",
    detail: "Desafio próprio, relatório da edição e contatos com opt-in.",
    label: "ver como patrocinar",
    href: "/organizar#patrocinio",
  };
}

export type ProfileFields = {
  name: string | null;
  headline: string | null;
  personas: string[];
  city: string | null;
  github: string | null;
  linkedin: string | null;
  skills: string[];
};

/** completude do perfil (0–100) e o que falta, pro lembrete discreto */
export function profileCompleteness(m: ProfileFields): { percent: number; missing: string[] } {
  const checks: [boolean, string][] = [
    [!!m.name?.trim(), "nome"],
    [!!m.headline?.trim(), "headline"],
    [m.personas.length > 0, "quem você é"],
    [!!m.city?.trim(), "cidade"],
    [!!(m.github || m.linkedin), "GitHub ou LinkedIn"],
    [m.skills.length > 0, "skills"],
  ];
  const done = checks.filter(([ok]) => ok).length;
  return { percent: Math.round((done / checks.length) * 100), missing: checks.filter(([ok]) => !ok).map(([, l]) => l) };
}
