import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KNOWN_TECH,
  normalizeTech,
  parseTechEntries,
  parseTechList,
  TAG_RE,
  TECH_ALIASES,
  TECH_MAX,
  techHref,
  techLabel,
} from "@/lib/techTags";

// tags de tecnologia da vitrine (spec 046): normalização com apelidos, até
// 12 únicas, rótulo pra exibir e a tabela de apelidos igual à do backfill
// da migration 036.

describe("normalizeTech", () => {
  it("junta os apelidos da spec", () => {
    const cases: [string, string][] = [
      ["Next.js", "nextjs"],
      ["nextjs", "nextjs"],
      ["NEXT.JS", "nextjs"],
      ["js", "javascript"],
      ["TS", "typescript"],
      ["React.js", "react"],
      ["node", "nodejs"],
      ["Node.js", "nodejs"],
      ["py", "python"],
      ["Postgres", "postgresql"],
      ["PostgreSQL", "postgresql"],
    ];
    for (const [raw, tag] of cases) expect(normalizeTech(raw), raw).toBe(tag);
  });

  it("espaço vira hífen, acento sai, sobra só o que o CHECK aceita", () => {
    expect(normalizeTech("  WhatsApp   API ")).toBe("whatsapp-api");
    expect(normalizeTech("Visão Computacional")).toBe("visao-computacional");
    expect(normalizeTech("C#")).toBe("c#");
    expect(normalizeTech("C++")).toBe("c++");
    expect(normalizeTech(".NET")).toBe("net");
    expect(normalizeTech("a".repeat(50))).toHaveLength(30);
  });

  it("nada aproveitável → null", () => {
    for (const raw of ["", "   ", "!!!", "---", 42, null, undefined, {}]) expect(normalizeTech(raw)).toBeNull();
  });

  it("toda tag gerada passa no regex do banco", () => {
    for (const t of [...KNOWN_TECH, "Ünïcødé ☃ stack", "--x--", "#hash"]) {
      const tag = normalizeTech(t);
      if (tag) expect(TAG_RE.test(tag), t).toBe(true);
    }
  });
});

describe("parseTechList / parseTechEntries", () => {
  it("até 12 únicas pela tag; a 13ª é ignorada", () => {
    const many = Array.from({ length: 15 }, (_, i) => `tech${i}`);
    expect(parseTechList(many)).toHaveLength(TECH_MAX);
    expect(parseTechList(many).at(-1)).toBe("tech11");
  });

  it("Next.js e nextjs contam uma vez só; guarda o texto do time como rótulo", () => {
    expect(parseTechEntries(["Next.js", "nextjs", "Postgres", " postgresql "])).toEqual([
      { tag: "nextjs", label: "Next.js" },
      { tag: "postgresql", label: "Postgres" },
    ]);
  });

  it("aceita texto separado por vírgula ou linha e ignora lixo", () => {
    expect(parseTechList("React, Node.js\nPython,, !!!")).toEqual(["react", "nodejs", "python"]);
    expect(parseTechList(null)).toEqual([]);
    expect(parseTechList([1, "go"])).toEqual(["go"]);
  });
});

describe("techLabel / techHref", () => {
  it("tag conhecida ganha o rótulo bonito; desconhecida volta igual", () => {
    expect(techLabel("nextjs")).toBe("Next.js");
    expect(techLabel("postgresql")).toBe("PostgreSQL");
    expect(techLabel("langgraph")).toBe("langgraph");
  });

  it("link do chip leva pro índice filtrado", () => {
    expect(techHref("c#")).toBe("/projetos?tech=c%23");
  });
});

describe("migration 036 usa os mesmos apelidos", () => {
  it("o CASE do backfill tem exatamente TECH_ALIASES", () => {
    const sql = readFileSync(join(process.cwd(), "migrations/036_vitrine_projeto.sql"), "utf8");
    const pairs = Object.fromEntries([...sql.matchAll(/WHEN '([^']+)' THEN '([^']+)'/g)].map((m) => [m[1], m[2]]));
    expect(pairs).toEqual(TECH_ALIASES);
  });
});
