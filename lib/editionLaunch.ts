import db from "@/lib/db";
import { publishToMembers } from "@/lib/announcements";

/**
 * Edição da Hack Inova que entra no ar pela primeira vez é anunciada pra
 * toda a comunidade: notificação dentro da plataforma pra cada membro e o
 * mesmo aviso pela fila de entregas (e-mail; zap só com opt-in). É a
 * promessa do bloco "em breve" da landing: quem tem conta fica sabendo
 * primeiro. Idempotente por launchAnnouncedAt — despublicar e publicar de
 * novo não anuncia outra vez.
 */
export async function announceEditionLaunch(
  hackathonId: string,
): Promise<{ notified: number; queued: number } | null> {
  return db.transaction(async () => {
    const h = await db
      .prepare(
        `UPDATE hackathons SET launchAnnouncedAt = sqlite_now()
         WHERE id = ? AND active = 1 AND launchAnnouncedAt IS NULL
           AND lower(organizer) LIKE '%hack inova%'
         RETURNING id, name`,
      )
      .get<{ id: string; name: string }>(hackathonId);
    if (!h) return null;

    const members = await db
      .prepare(`SELECT id FROM members WHERE clerkId NOT LIKE 'deleted:%' ORDER BY id`)
      .all<{ id: number }>();
    const ids = members.map((m) => m.id);
    if (ids.length === 0) return { notified: 0, queued: 0 };

    const text = `Edição nova da Hack Inova: ${h.name}. As inscrições estão abertas.`;
    const href = `/h/${h.id}`;
    await db
      .prepare(
        `INSERT INTO notifications (memberId, type, text, href)
         SELECT id, 'edicao_nova', ?, ? FROM members WHERE id = ANY(?::int[])`,
      )
      .run(text, href, `{${ids.join(",")}}`);

    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hackahub.jazzautomations.com.br";
    const { queued } = await publishToMembers(
      h.id,
      null,
      {
        title: `Edição nova da Hack Inova: ${h.name}`,
        body: `Saiu a próxima edição da Hack Inova: ${h.name}. Data, local e desafios estão na página da edição, e as vagas são limitadas.\n\n${site}${href}`,
      },
      ids,
      { system: true },
    );
    return { notified: ids.length, queued };
  })();
}
