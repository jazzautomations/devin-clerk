import db from "@/lib/db";

// spec 027 — "+N · 30d" da landing (padrão DoraHacks): momentum só onde há
// timestamp real. members/posts têm createdAt; eventos usam first_seen,
// gravado pelo scraper quando descobre a edição — seeds/comunidade/admin
// sem first_seen ficam fora da conta (data que não existe não é inventada).
// "edições no arquivo" não tem data de entrada → nunca mostra "+N".

export type StatsMomentum = {
  members: number;
  posts: number;
  events: number;
};

export async function getStatsMomentum(now = new Date()): Promise<StatsMomentum> {
  const params = {
    cutoff: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    now: now.toISOString(),
  };
  // to_ts() normaliza os dois formatos gravados ("YYYY-MM-DD HH:MM:SS"
  // do sqlite e ISO com offset do scraper) antes de comparar
  const count = async (sql: string) =>
    (await db.prepare(sql).get(params) as { n: number }).n;
  return {
    members: await count(
      `SELECT COUNT(*) n FROM members
        WHERE to_ts(createdAt) >= to_ts(@cutoff)`,
    ),
    posts: await count(
      `SELECT COUNT(*) n FROM posts
        WHERE to_ts(createdAt) >= to_ts(@cutoff)`,
    ),
    // "+N" decora "hackathons abertos" → conta o que entrou na janela E
    // continua aberto (mesma COALESCE de isOver/getOpenHackathons)
    events: await count(
      `SELECT COUNT(*) n FROM hackathons
        WHERE active = 1 AND to_ts(first_seen) >= to_ts(@cutoff)
          AND to_ts(COALESCE(endsAt, registrationDeadline, startsAt))
              >= to_ts(@now)`,
    ),
  };
}
