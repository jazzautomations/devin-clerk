import {
  networkFailure,
  outcomeFromResponse,
  type Driver,
  type DriverEnv,
  type WhatsappMessage,
} from "@/lib/notify/types";

// WhatsApp via Evolution API, sempre mensagem individual (nunca grupo):
// POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}, header apikey.
// Sem as três envs → driver "log" (skipped com motivo, zero rede).
export function whatsappDriver(env: DriverEnv = process.env): Driver<WhatsappMessage> {
  const base = env.EVOLUTION_URL?.replace(/\/+$/, "");
  const instance = env.EVOLUTION_INSTANCE;
  const key = env.EVOLUTION_API_KEY;
  if (!base || !instance || !key) {
    return {
      name: "log",
      async send() {
        console.info("[notify:whatsapp:log] (não enviado)");
        return {
          status: "skipped",
          reason: "EVOLUTION_URL/INSTANCE/API_KEY ausentes — driver log, nada enviado",
        };
      },
    };
  }
  const url = `${base}/message/sendText/${encodeURIComponent(instance)}`;
  return {
    name: "evolution",
    async send(m) {
      // só número individual E.164 BR — JID de grupo (…@g.us) nunca passa
      if (!/^\d{12,13}$/.test(m.number)) {
        return { status: "failed", error: "número inválido (esperado E.164 BR sem +)", permanent: true };
      }
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { apikey: key, "Content-Type": "application/json" },
          body: JSON.stringify({ number: m.number, text: m.text }),
        });
        return await outcomeFromResponse(res);
      } catch (e) {
        return networkFailure(e);
      }
    },
  };
}
