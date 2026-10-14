// Parte pura do lib/notify/channels: pode ir pro componente client sem
// levar os drivers junto.

export type ChannelsEnabled = { email: boolean; whatsapp: boolean };

/**
 * Onde o aviso aparece, em texto corrido: "na página da edição e no sino",
 * mais e-mail e WhatsApp quando estão ligados.
 */
export function announcementReach(c: ChannelsEnabled): string {
  const parts = ["na página da edição", "no sino"];
  if (c.email) parts.push("por e-mail");
  if (c.whatsapp) parts.push("por WhatsApp pra quem optou");
  return parts.length === 2
    ? parts.join(" e ")
    : `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
}
