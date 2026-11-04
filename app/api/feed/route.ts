import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";
import {
  countNewPosts,
  isTimelineTab,
  parseCursor,
  TIMELINE_PAGE_SIZE,
  timelineDefaultTab,
  timelinePage,
} from "@/lib/timeline";

// Timeline (spec 046, onda 2). GET /api/feed?aba=&antes=
// - logada: 401 deslogado (JSON, nunca redirect), 600 por hora por membro
//   (balde "feed");
// - aba fora da lista → 400; sem aba, a mesma aba padrão do /feed (seguindo
//   pra quem segue alguém ou alguma comunidade, senão tudo);
// - devolve {posts, next}: `next` é o cursor da página seguinte e vai em
//   ?antes=. A aba "comunidades" aqui é o mural das minhas comunidades; a
//   página /feed mostra também aviso, hackathon e agenda (communityUpdatesPage);
// - ?desde=<id> devolve {novos}: quantos posts entraram na aba depois daquele
//   id. É o "N posts novos" que o TimelineList checa a cada 60s.
export async function GET(req: Request) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "feed", me.id);
  if (limited) return limited;

  const sp = new URL(req.url).searchParams;
  const raw = sp.get("aba");
  if (raw && !isTimelineTab(raw)) return Response.json({ error: "Aba inválida." }, { status: 400 });
  const aba = raw && isTimelineTab(raw) ? raw : await timelineDefaultTab(me.id);

  const desdeRaw = sp.get("desde");
  const desde = parseCursor(desdeRaw);
  if (desdeRaw !== null && desde === null) return Response.json({ error: "Cursor inválido." }, { status: 400 });

  const antesRaw = sp.get("antes");
  const antes = parseCursor(antesRaw);
  if (antesRaw !== null && antes === null) return Response.json({ error: "Cursor inválido." }, { status: 400 });

  if (desde !== null) return Response.json({ novos: await countNewPosts(me.id, aba, desde) });

  const page = await timelinePage(me.id, aba, antes, TIMELINE_PAGE_SIZE);
  return Response.json(page);
}
