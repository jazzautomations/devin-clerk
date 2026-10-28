import { limitOrNull } from "@/lib/ratelimit";
import { isSearchType, parseSearchQuery, searchAll } from "@/lib/search";
import { currentMember } from "@/lib/session";

// Busca global (migration 042). GET ?q=&tipo=&antes=
// - logada (401 deslogado), 120 por hora por membro (balde "search");
// - q de 2 a 80 caracteres e tipo conhecido; fora disso 400;
// - sem tipo: 5 por seção; com tipo: 20 e `next` pra pedir mais (?antes=).
export async function GET(req: Request) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "search", me.id);
  if (limited) return limited;
  const sp = new URL(req.url).searchParams;
  const parsed = parseSearchQuery(sp.get("q"));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const tipo = sp.get("tipo");
  if (tipo && !isSearchType(tipo)) return Response.json({ error: "Tipo de busca inválido." }, { status: 400 });
  const result = await searchAll(parsed.q, me.id, {
    tipo: tipo && isSearchType(tipo) ? tipo : null,
    antes: sp.get("antes"),
  });
  return Response.json(result);
}
