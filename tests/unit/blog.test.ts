import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPost, listPosts, parsePost, renderMarkdown } from "@/lib/blog";

function blogDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "blog-"));
  for (const [name, body] of Object.entries(files)) {
    if (name.includes("/")) {
      mkdirSync(join(dir, name.split("/")[0]), { recursive: true });
    }
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

const MD = (fm: Record<string, string>, body = "Primeiro parágrafo do post.") =>
  `---\n${Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n\n${body}\n`;

const VALID = {
  title: "Título do post",
  description: "Resumo do post pra listagem e SEO.",
  date: "2026-10-10",
  author: "equipe hackahub",
};

describe("parsePost — frontmatter", () => {
  it("extrai campos e corpo", () => {
    const p = parsePost(MD({ ...VALID, tags: "[guia, ia]" }), "meu-post");
    expect(p.slug).toBe("meu-post");
    expect(p.title).toBe("Título do post");
    expect(p.description).toBe("Resumo do post pra listagem e SEO.");
    expect(p.date).toBe("2026-10-10");
    expect(p.author).toBe("equipe hackahub");
    expect(p.tags).toEqual(["guia", "ia"]);
    expect(p.body).toContain("Primeiro parágrafo");
  });

  it("tags aceitam lista entre colchetes e vírgulas", () => {
    expect(
      parsePost(MD({ ...VALID, tags: "guia, deploy" }), "a").tags,
    ).toEqual(["guia", "deploy"]);
    expect(parsePost(MD(VALID), "b").tags).toEqual([]);
  });

  it("rejeita frontmatter ausente e campos obrigatórios faltando", () => {
    expect(() => parsePost("sem frontmatter", "x")).toThrow();
    // sem title
    expect(() =>
      parsePost(
        MD({ description: VALID.description, date: VALID.date, author: VALID.author }),
        "x",
      ),
    ).toThrow();
    // sem date
    expect(() =>
      parsePost(
        MD({ title: VALID.title, description: VALID.description, author: VALID.author }),
        "x",
      ),
    ).toThrow();
  });

  it("rejeita data que não é YYYY-MM-DD", () => {
    expect(() =>
      parsePost(MD({ ...VALID, date: "10/10/2026" }), "x"),
    ).toThrow();
    expect(() =>
      parsePost(MD({ ...VALID, date: "2026-13-40" }), "x"),
    ).toThrow();
  });
});

describe("listPosts — listagem", () => {
  it("ordena por data desc, ignora não-.md e gera excerpt", () => {
    const dir = blogDir({
      "velho.md": MD({ ...VALID, date: "2026-08-01" }),
      "novo.md": MD({ ...VALID, date: "2026-10-10" }, "Resumo novo."),
      "meio.md": MD({ ...VALID, date: "2026-09-01" }),
      "rascunho.txt": "não é post",
      ".oculto": "também não",
    });
    const posts = listPosts(dir);
    expect(posts.map((p) => p.slug)).toEqual(["novo", "meio", "velho"]);
    expect(posts[0].excerpt).toContain("Resumo novo");
    expect(posts[0].tags).toEqual([]);
  });

  it("diretório inexistente retorna lista vazia", () => {
    expect(listPosts("/tmp/dir-que-nao-existe-xyz")).toEqual([]);
  });
});

describe("getPost — artigo", () => {
  it("retorna meta + html renderizado", () => {
    const dir = blogDir({
      "post.md": MD(VALID, "## Seção\n\ntexto com **negrito**."),
    });
    const post = getPost("post", dir);
    expect(post).not.toBeNull();
    expect(post!.title).toBe("Título do post");
    expect(post!.html).toContain("<h2>");
    expect(post!.html).toContain("<strong>negrito</strong>");
  });

  it("slug inexistente → null; slug malicioso → null (sem path traversal)", () => {
    const dir = blogDir({ "post.md": MD(VALID) });
    expect(getPost("nao-existe", dir)).toBeNull();
    expect(getPost("../../etc/passwd", dir)).toBeNull();
    expect(getPost("../post", dir)).toBeNull();
  });
});

describe("renderMarkdown — renderer mínimo", () => {
  it("headings, parágrafos, listas ul/ol", () => {
    const html = renderMarkdown(
      "## Título\n\nParágrafo um.\n\n- item a\n- item b\n\n1. um\n2. dois",
    );
    expect(html).toContain("<h2>Título</h2>");
    expect(html).toContain("<p>Parágrafo um.</p>");
    expect(html).toContain("<ul><li>item a</li><li>item b</li></ul>");
    expect(html).toContain("<ol><li>um</li><li>dois</li></ol>");
  });

  it("fence de código escapa conteúdo e fecha no EOF", () => {
    const html = renderMarkdown("```js\nconst x = '<script>';\n```");
    expect(html).toContain("<pre><code");
    expect(html).toContain("&lt;script&gt;");
    const unclosed = renderMarkdown("```\nsem fechar\nlinha2");
    expect(unclosed).toContain("sem fechar");
  });

  it("inline: código, negrito, itálico e link http", () => {
    const html = renderMarkdown(
      "Use `npm run dev` com **força** e *jeito* — veja [o radar](/radar) e [fonte](https://devpost.com).",
    );
    expect(html).toContain("<code>npm run dev</code>");
    expect(html).toContain("<strong>força</strong>");
    expect(html).toContain("<em>jeito</em>");
    expect(html).toContain('href="/radar"');
    expect(html).toContain('href="https://devpost.com"');
  });

  it("escapa HTML cru e remove link javascript:", () => {
    const html = renderMarkdown(
      "Olá <script>alert(1)</script> e [clica](javascript:alert(1))",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('href="javascript');
  });
});
