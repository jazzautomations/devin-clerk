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

    // seed do arquivo: pódio público da Unifacens (dado real divulgado);
    // o resto entra pelo admin quando os organizadores cadastrarem
    await db
      .prepare(
        `INSERT OR IGNORE INTO teams (hackathonId, name, placement)
         VALUES ('hack-inova-unifacens-2026', 'One Day Hospital', 1)`,
      )
      .run();
    const team = await db
      .prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?")
      .get<{ id: number }>("hack-inova-unifacens-2026", "One Day Hospital");
    if (team) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO team_projects (teamId, title, description)
           VALUES (?, ?, ?)`,
        )
        .run(
          team.id,
          "One Day Hospital",
          "Vencedora da 1ª edição — solução de saúde apresentada depois na Oracle SP",
        );
    }

    // desafios patrocinados — o inventário de monetização (participante nunca
    // paga; quem paga é a marca que lança o desafio). seeds = patrocínio real
    // divulgado das edições; o resto entra pelo admin
    const seedChallenge = db.prepare(
      `INSERT OR IGNORE INTO challenges (id, hackathonId, sponsor, title, description, prize)
       VALUES (@id, @hackathonId, @sponsor, @title, @description, @prize)`,
    );
    await seedChallenge.run({
      id: "seed-puc-jornada-paciente",
      hackathonId: "hack-inova-puc-saude-2026",
      sponsor: "Oracle",
      title: "Jornada do paciente",
      description:
        "A edição rodou 7 desafios da jornada do paciente — do agendamento ao pós-consulta — com contexto e dados da Oracle.",
      prize: "créditos OCI + visita Oracle Innovation Center",
    });
    await seedChallenge.run({
      id: "seed-unifacens-ia-saude",
      hackathonId: "hack-inova-unifacens-2026",
      sponsor: "Oracle + Enterprise X Ventures",
      title: "IA aplicada à saúde",
      description:
        "Desafio aberto de IA pra saúde na 1ª edição — o projeto vencedor (One Day Hospital) foi apresentado depois na Oracle SP.",
      prize: "R$5k em consultoria + créditos OCI",
    });
  })();
}
