import { emailDriver } from "@/lib/notify/email";
import { whatsappDriver } from "@/lib/notify/whatsapp";
import type { DriverEnv } from "@/lib/notify/types";
import type { ChannelsEnabled } from "@/lib/notify/reach";

export { announcementReach, type ChannelsEnabled } from "@/lib/notify/reach";

// Quais canais externos saem de verdade neste ambiente. A interface usa
// isso pra só prometer e-mail ou WhatsApp quando o driver existe: sem
// RESEND_API_KEY o e-mail cai no driver "log" e nada sai.
export function channelsEnabled(env: DriverEnv = process.env): ChannelsEnabled {
  return {
    email: emailDriver(env).name !== "log",
    whatsapp: whatsappDriver(env).name !== "log",
  };
}
