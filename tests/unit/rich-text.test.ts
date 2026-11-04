import { describe, expect, it } from "vitest";
import { extractMentions, extractTags, mentionedSet, parseRich } from "@/lib/richText";
import { USERNAME_RE } from "@/lib/members";
import { normalizeTech, TECH_ALIASES } from "@/lib/techTags";

// Parser do texto do post (spec 046, onda 2, mencoes-e-tags). Módulo puro:
// aqui se prova que @ vira menção só no começo de palavra (e-mail não é
// menção), que # normaliza igual à stack (#NextJS e #next.js são nextjs), que
// url não pesca @ nem # de dentro dela e que o limite é 5 de cada.

const kinds = (body: string) => parseRich(body).map((s) => `${s.t}:${s.v}`);

describe("parseRich", () => {
  it("texto sem @ nem # é um segmento só", () => {
    expect(parseRich("subi a demo, quebrou o build")).toEqual([{ t: "text", v: "subi a demo, quebrou o build" }]);
    expect(parseRich("")).toEqual([]);
  });

  it("os segmentos cobrem o texto inteiro, quebras de linha inclusive", () => {
    const body = "primeira linha @ana\nsegunda com #nextjs e https://exemplo.dev/demo";
    expect(kinds(body)).toEqual([
      "text:primeira linha ",
      "mention:ana",
      "text:\nsegunda com ",
      "tag:nextjs",
      "text: e ",
      "url:https://exemplo.dev/demo",
    ]);
  });

  it("@ no começo ou depois de espaço/pontuação vira menção", () => {
    for (const body of ["@ana obrigado", "oi, @ana!", "(@ana)", "linha\n@ana"]) {
      expect(kinds(body).some((k) => k === "mention:ana"), body).toBe(true);
    }
  });

  it("e-mail não vira menção: @ colado em letra/número/ponto não conta", () => {
    for (const body of ["fala com ana@exemplo.com", "ana.silva@exemplo.com", "1@ana", "a_@ana"]) {
      expect(parseRich(body).some((s) => s.t === "mention"), body).toBe(false);
    }
    // já depois de um espaço, é menção de verdade
    expect(kinds("manda pra ana@exemplo.com e @ana")).toContain("mention:ana");
  });

  it("menção sai em minúsculas e o padrão é o mesmo do USERNAME_RE", () => {
    expect(kinds("oi @Ana")).toEqual(["text:oi ", "mention:ana"]);
    for (const name of ["ana", "a1_", "abc", "a".repeat(20), "ab", "a".repeat(21), "1abc"]) {
      const asMention = parseRich(`oi @${name}`).some((s) => s.t === "mention");
      expect(asMention, name).toBe(USERNAME_RE.test(name));
    }
  });

  it("# normaliza: apelido de stack, acento e maiúscula caem na mesma tag", () => {
    expect(extractTags("#NextJS e #next.js e #nextjs")).toEqual(["nextjs"]);
    expect(extractTags("estudei #saúde hoje")).toEqual(["saude"]);
    expect(extractTags("curti o #C++")).toEqual(["c++"]);
    // todo apelido de stack passa pela mesma tabela de lib/techTags.ts
    for (const [raw, tag] of Object.entries(TECH_ALIASES)) {
      expect(extractTags(`#${raw}`), raw).toEqual([normalizeTech(raw)]);
      expect(normalizeTech(raw)).toBe(tag);
    }
  });

  it("# sozinho, #a e C# ficam texto", () => {
    expect(parseRich("# ").every((s) => s.t === "text")).toBe(true);
    expect(parseRich("#a").every((s) => s.t === "text")).toBe(true);
    expect(parseRich("programo em C#").every((s) => s.t === "text")).toBe(true);
    expect(parseRich("cor#tag").every((s) => s.t === "text")).toBe(true);
  });

  it("ponto e hífen do fim da frase não entram na tag", () => {
    expect(kinds("usei #nextjs.")).toEqual(["text:usei ", "tag:nextjs", "text:."]);
    expect(extractTags("#react-native- e #ia.")).toEqual(["react-native", "ia"]);
  });

  it("url inteira é um segmento: @ e # de dentro dela não viram menção/tag", () => {
    const body = "olha https://exemplo.dev/@ana/#nextjs?x=1#y fim";
    expect(kinds(body)).toEqual(["text:olha ", "url:https://exemplo.dev/@ana/#nextjs?x=1#y", "text: fim"]);
    expect(extractMentions(body)).toEqual([]);
    expect(extractTags(body)).toEqual([]);
  });

  it("no máximo 5 menções e 5 tags, únicas e na ordem", () => {
    const body = "@ana @bruno @carla @davi @edu @fabio @ana";
    expect(extractMentions(body)).toEqual(["ana", "bruno", "carla", "davi", "edu"]);
    const tags = "#t1 #t2 #t3 #t4 #t5 #t6";
    expect(extractTags(tags)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  });
});

describe("mentionedSet", () => {
  it("só os @ que existem viram link", () => {
    const set = mentionedSet(["ana", "bia"]);
    expect(set.has("ana")).toBe(true);
    expect(set.has("carla")).toBe(false);
    expect(mentionedSet(null).size).toBe(0);
    expect(mentionedSet([]).size).toBe(0);
  });
});
