import { getHackathon } from "@/lib/hackathons";
import { getStageSnapshot } from "@/lib/stage";
import { subscribeStage } from "@/lib/stageStream";

// Modo palco — Server-Sent Events do palco, sem lib. Público (o telão
// roda sem login). Eventos:
//   event: stage  → snapshot completo (manda na conexão e a cada mudança)
//   event: ping   → heartbeat a cada 15s (o cliente usa como watchdog)
// A conexão é reciclada a cada 10 min (o EventSource reconecta sozinho com
// `retry`), então nenhuma conexão esquecida segura recurso pra sempre.
//
// Headers: `no-transform` impede a compressão do `next start` de segurar
// os bytes; `X-Accel-Buffering: no` desliga buffer de proxy (nginx-like).
// O Caddy faz flush imediato em text/event-stream.

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const LIFETIME_MS = 10 * 60_000;
// Safari segura o stream até 1KB: um comentário de padding destrava o 1º evento
const PADDING = `:${" ".repeat(2048)}\n`;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) return Response.json({ error: "Edição não encontrada" }, { status: 404 });

  const enc = new TextEncoder();
  let closed = false;
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // já fechado pelo cliente
        }
      };
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          close();
        }
      };
      const event = (name: string, data: unknown) => send(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

      send(PADDING);
      send("retry: 3000\n\n");
      const unsub = subscribeStage(id, (snap) => event("stage", snap));
      const hb = setInterval(() => event("ping", { t: Date.now() }), HEARTBEAT_MS);
      const life = setTimeout(close, LIFETIME_MS);
      cleanup = () => {
        unsub();
        clearInterval(hb);
        clearTimeout(life);
      };
      req.signal.addEventListener("abort", close);
      try {
        event("stage", await getStageSnapshot(id));
      } catch {
        close();
      }
    },
    cancel() {
      closed = true;
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
