// Tags de tecnologia do projeto (spec 046, vitrine-de-projeto). Puro: sem
// banco, pra rodar no editor (client) e no servidor.
//
// team_projects.technologies (JSON) é A FONTE da stack, com o texto que o
// time escreveu ("Next.js"). project_tech (migration 036) é um índice
// derivado com a tag normalizada ("nextjs"), que é o que /projetos?tech=
// filtra. A tag segue o CHECK da 036: ^[a-z0-9][a-z0-9.+#-]{0,29}$.

export const TECH_MAX = 12;
export const TAG_RE = /^[a-z0-9][a-z0-9.+#-]{0,29}$/;

// apelido → tag. A migration 036 repete esta tabela no backfill (o teste
// tests/unit/tech-tags.test.ts confere que as duas não se separaram).
export const TECH_ALIASES: Record<string, string> = {
  "next.js": "nextjs",
  next: "nextjs",
  js: "javascript",
  ts: "typescript",
  "react.js": "react",
  reactjs: "react",
  node: "nodejs",
  "node.js": "nodejs",
  py: "python",
  postgres: "postgresql",
  "vue.js": "vue",
  vuejs: "vue",
  golang: "go",
};

/** sugestões e rótulos conhecidos (o time pode digitar outras) */
export const KNOWN_TECH = [
  "TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "Kotlin", "Swift", "Dart",
  "React", "Next.js", "Vue", "Svelte", "Node.js", "FastAPI", "Django", "Flutter", "React Native",
  "PostgreSQL", "SQLite", "MongoDB", "Supabase", "Firebase", "Redis",
  "OpenAI", "Claude", "Gemini", "LangChain", "Whisper", "Hugging Face",
  "WhatsApp API", "Docker", "Vercel", "AWS", "Google Cloud", "Arduino", "Figma",
];

/** texto livre → tag do índice; null quando não sobra nada aproveitável */
export function normalizeTech(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.+#-]/g, "")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "");
  s = TECH_ALIASES[s] ?? s;
  s = s.slice(0, 30);
  return TAG_RE.test(s) ? s : null;
}

const LABELS = new Map<string, string>(KNOWN_TECH.map((t) => [normalizeTech(t)!, t]));

/** tag → rótulo pra exibir ("nextjs" → "Next.js"); tag desconhecida volta como está */
export function techLabel(tag: string): string {
  return LABELS.get(tag) ?? tag;
}

export type TechEntry = { tag: string; label: string };

/**
 * Lista do time (array ou texto separado por vírgula/linha) → até 12
 * tecnologias únicas pela tag. Da 13ª em diante é ignorada, sem erro. O
 * rótulo é o texto do time, aparado ("Postgres" fica "Postgres"; a tag é
 * "postgresql").
 */
export function parseTechEntries(input: unknown): TechEntry[] {
  const items: unknown[] = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,\n]/)
      : [];
  const out: TechEntry[] = [];
  for (const item of items) {
    if (out.length >= TECH_MAX) break;
    const tag = normalizeTech(item);
    if (!tag || out.some((o) => o.tag === tag)) continue;
    out.push({ tag, label: (item as string).trim().replace(/\s+/g, " ").slice(0, 40) });
  }
  return out;
}

/** só as tags (até 12, únicas, na ordem do time) */
export function parseTechList(input: unknown): string[] {
  return parseTechEntries(input).map((e) => e.tag);
}

/** link do chip "Feito com" pro índice filtrado */
export const techHref = (tag: string) => `/projetos?tech=${encodeURIComponent(tag)}`;
