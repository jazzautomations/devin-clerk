import type { Db } from "@/lib/db";
import { hackathons as seed, pastHackathons as pastSeed } from "@/data/hackathons";

// Dados de base que todo ambiente precisa (edições Hack Inova + curadoria do
// radar, cartas, pódio e desafios reais divulgados). Idempotente: roda a cada
// boot do processo, logo depois das migrations.

// card colecionável por edição — raridade das edições Hack Inova é curadoria;
// eventos raspados mintam 'comum' sob demanda no register
const cardRarity: Record<string, string> = {
  "hack-inova-unifacens-2026": "lendario", // a 1ª edição — peça de arquivo
  "hack-inova-puc-saude-2026": "epico",
  "hackinova-os-2-anhembi-2026": "epico",
  "hack-inova-alphaville-2026": "raro",
};

export async function seedDatabase(db: Db) {
  const all = [...seed, ...pastSeed];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, registrationDeadline, tags, active, prize, source)
    VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location, @registrationUrl, @registrationDeadline, @tags, @active, @prize, 'seed')
  `);
  // OR IGNORE não alcança bancos existentes — preenche só o vazio,
  // nunca sobrescreve prêmio posto à mão pelo admin
  const backfillPrize = db.prepare(
    "UPDATE hackathons SET prize = @prize WHERE id = @id AND prize IS NULL",
  );

  await db.transaction(async () => {
    for (const h of all) {
      await insert.run({
        ...h,
        endsAt: h.endsAt ?? null,
        location: h.location ?? null,
        registrationDeadline: h.registrationDeadline ?? null,
        tags: JSON.stringify(h.tags),
        active: h.active ? 1 : 0,
        prize: h.prize ?? null,
      });
      if (h.prize) await backfillPrize.run({ id: h.id, prize: h.prize });
    }

    const seedIds = all.map((h) => h.id);
    // banco antigo: a linha do seed nasceu sem source — marca (a migration
    // 019 faz o mesmo; aqui cobre id novo que entrar na lista depois)
    await db
      .prepare("UPDATE hackathons SET source = 'seed' WHERE source IS NULL AND id = ANY(?)")
      .run(seedIds);
    // aposenta só o que JÁ FOI seed e saiu da lista. Edição criada pelo
    // painel (source='painel'), raspada pelo radar ou de teste nunca é tocada.
    await db
      .prepare(
        `UPDATE hackathons SET active = 0
         WHERE source = 'seed'
           AND NOT (id = ANY(?))
           AND id NOT IN (SELECT hackathonId FROM registrations)`,
      )
      .run(seedIds);

    const seedCard = db.prepare(
      "INSERT OR IGNORE INTO cards (hackathonId, rarity) VALUES (?, ?)",
    );
    for (const id of seedIds) await seedCard.run(id, cardRarity[id] ?? "comum");
  })();
}
