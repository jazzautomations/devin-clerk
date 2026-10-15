import db from "@/lib/db";
import { publishToMembers } from "@/lib/announcements";

/**
 * Hackathon de uma comunidade que entra no ar pela primeira vez é anunciado
 * pros MEMBROS DESSA COMUNIDADE (não pra plataforma inteira): notificação
 * dentro do HackaHub e o mesmo aviso na fila de entregas (e-mail; zap só com
 * opt-in), marcado como aviso do sistema. Edição sem comunidade (evento
 * externo, edição antiga do painel) não anuncia.
 *
 * Idempotente por launchAnnouncedAt: despublicar e publicar de novo não
 * anuncia outra vez. A marca só é gravada quando a edição tem comunidade.
 */
export async function announceEditionLaunch(
  hackathonId: string,
): Promise<{ notified: number; queued: number } | null> {
  return db.transaction(async () => {
    const h = await db
      .prepare(
        `UPDATE hackathons h SET launchAnnouncedAt = sqlite_now()
         FROM communities c
         WHERE h.id = ? AND h.active = 1 AND h.launchAnnouncedAt IS NULL
           AND c.id = h.communityId AND c.hidden = 0
         RETURNING h.id, h.name, c.name AS "communityName", c.id AS "communityId"`,
      )
      .get<{ id: string; name: string; communityName: string; communityId: number }>(hackathonId);
    if (!h) return null;

    const members = await db
      .prepare(
        `SELECT m.id FROM community_members cm JOIN members m ON m.id = cm.memberId
         WHERE cm.communityId = ? AND m.clerkId NOT LIKE 'deleted:%' ORDER BY m.id`,
      )
      .all<{ id: number }>(h.communityId);
    const ids = members.map((m) => m.id);
    if (ids.length === 0) return { notified: 0, queued: 0 };

    const text = `${h.communityName} abriu ${h.name}. As inscrições estão abertas.`;
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
        title: `${h.communityName} abriu um hackathon: ${h.name}`,
        body: `${h.communityName} abriu ${h.name}. Você recebe este aviso porque está nessa comunidade no HackaHub. Data, local e desafios estão na página do hackathon.\n\n${site}${href}`,
      },
      ids,
      { system: true },
    );
    return { notified: ids.length, queued };
  })();
}
