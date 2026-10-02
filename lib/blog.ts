import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Blog file-based (spec 009): cada post é content/blog/<slug>.md com
// frontmatter --- title/description/date/author/tags --- e corpo markdown.
// Sem dependência de lib de md — renderer mínimo e controlado embaixo.

export const BLOG_DIR = join(process.cwd(), "content", "blog");

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  author: string;
  tags: string[];
};

export type PostListItem = PostMeta & { excerpt: string };
export type Post = PostListItem & { html: string };

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseValue(raw: string): string | string[] {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return v;
}

/** Parseia frontmatter + corpo. Lança Error com slug quando inválido. */
export function parsePost(
  source: string,
  slug: string,
): PostMeta & { body: string } {
  const fail = (msg: string): never => {
    throw new Error(`post "${slug}": ${msg}`);
  };
  const normalized = source.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match)
    throw new Error(`post "${slug}": frontmatter ausente ou malformado`);
  const [, head, body] = match;

  const fields: Record<string, string | string[]> = {};
  for (const line of head.split("\n")) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!kv) continue;
    fields[kv[1].toLowerCase()] = parseValue(kv[2]);
  }

  const str = (key: string): string => {
    const v = fields[key];
    if (typeof v !== "string" || !v.trim()) fail(`campo "${key}" ausente`);
    return (v as string).replace(/^["']|["']$/g, "").trim();
  };

  const title = str("title");
  const description = str("description");
  const author = str("author");
  const date = str("date");
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)))
    fail(`date inválida: "${date}" — use YYYY-MM-DD`);
  const rawTags = fields.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.map((t) => t.trim()).filter(Boolean)
    : typeof rawTags === "string" && rawTags.trim()
      ? rawTags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

  return { slug, title, description, date, author, tags, body: body.trim() };
}

function mdToText(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptOf(body: string, description: string): string {
  const first = body
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#") && !s.startsWith("```"));
  const text = first ? mdToText(first) : description;
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

export function listPosts(dir: string = BLOG_DIR): PostListItem[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && SLUG_RE.test(f.slice(0, -3)))
    .map((f) => {
      const { body, ...meta } = parsePost(
        readFileSync(join(dir, f), "utf8"),
        f.slice(0, -3),
      );
      return { ...meta, excerpt: excerptOf(body, meta.description) };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

export function getPost(
  slug: string,
  dir: string = BLOG_DIR,
): Post | null {
  if (!SLUG_RE.test(slug)) return null;
  const file = join(dir, `${slug}.md`);
  if (!existsSync(file)) return null;
  const { body, ...meta } = parsePost(readFileSync(file, "utf8"), slug);
  return {
    ...meta,
    excerpt: excerptOf(body, meta.description),
    html: renderMarkdown(body),
  };
}

// --- renderer markdown mínimo (~60 linhas) --------------------------------
// Cobre: h1–h4, p, ul/ol, ```fence```, `code`, **bold**, *it* / _it_,
// [texto](url). HTML cru é sempre escapado — nunca injeta markup.

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) =>
      /^(https?:\/\/|\/)/i.test(url)
        ? `<a href="${url}">${text}</a>`
        : text,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_([^_\s][^_]*)_/g, "$1<em>$2</em>");
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join(" ")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list)
      out.push(
        `<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`,
      );
    list = null;
  };
  const flush = () => {
    flushPara();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flush();
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```"))
        buf.push(lines[i]);
      out.push(
        `<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(buf.join("\n"))}</code></pre>`,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(esc(h[2].trim()))}</h${h[1].length}>`);
      continue;
    }
    const li = line.match(/^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const tag = li[1] ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push(inline(esc(li[3])));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(esc(line.trim()));
  }
  flush();
  return out.join("\n");
}
