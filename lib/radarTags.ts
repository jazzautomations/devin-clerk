// Tags do radar como aparecem pra quem navega. O scraper gravou por muito
// tempo o primeiro pedaço do tema do Devpost ("machine", "low", "open") e o
// prêmio como tag ("premio-$1,000"). O scripts/scrape_radar.py já grava
// limpo; isto limpa o que está no banco na hora de mostrar. Módulo puro, vai
// pro client junto com o HackathonFeed.

/** tradução das tags em inglês (o mesmo dicionário do scraper) */
const PT: Record<string, string> = {
  beginner: "iniciante",
  machine: "ia",
  ai: "ia",
  health: "saúde",
  saude: "saúde",
  education: "educação",
  educacao: "educação",
  gaming: "jogos",
  robotic: "automação",
  social: "impacto social",
  blockchain: "web3",
  productivity: "produtividade",
  communication: "comunicação",
  cybersecurity: "segurança",
  databases: "dados",
  music: "arte",
  quantum: "computação quântica",
  "e-commerce": "varejo",
  government: "governo",
  gov: "governo",
  voice: "voz",
  inovacao: "inovação",
};

/** pedaços de tema que sozinhos não dizem nada */
const DROP = new Set(["low", "open", "enterprise", "lifehacks", "covid-19"]);

/** tag como aparece na tela, ou null quando ela não deve aparecer */
export function displayTag(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t || t.startsWith("premio-") || DROP.has(t)) return null;
  return PT[t] ?? t;
}

/** tags de um evento já traduzidas, sem repetição */
export function cleanTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = displayTag(raw);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
