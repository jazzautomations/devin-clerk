import { parseId } from "@/lib/ids";
import { svgDoBicho } from "@/lib/mascote/isometrico";
import { ITEM_MAX, ehItemId, pecaItem } from "@/lib/mascote/itens";
import { mascotePublico } from "@/lib/mascote/store";
import { ESTAGIOS, type Estagio } from "@/lib/mascote/tipos";

// SVG do bicho de um membro (migration 043, com itens e estágio na 047).
// Público (PUBLIC_APIS): é o que listas, OG e telão põem em <img>. Membro
// inexistente ou excluído recebe o bicho da semente do id 0, nunca imagem
// quebrada.
//
// ?e=<filhote|jovem|adulto> e ?i=<item,item,item> dizem o que vestir; a rota
// não consulta fato nenhum (quem calcula é lib/mascote/evolucao.ts, que grava
// a URL em members.avatarUrl). Sem eles, o bicho adulto sem itens, que é o
// que a onda 1 desenhava.
//
// Com ?v=<hash> igual ao do bicho atual: cache imutável de 1 ano (o hash
// muda quando o bicho, o estágio, os itens ou a arte mudam). Sem v, ou com v
// velho: 5 minutos.

type Ctx = { params: Promise<{ id: string }> };

const estagioDe = (v: string | null): Estagio =>
  (ESTAGIOS as readonly string[]).includes(v ?? "") ? (v as Estagio) : "adulto";

export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id) ?? 0;
  const config = await mascotePublico(id);
  const url = new URL(req.url);
  const estagio = estagioDe(url.searchParams.get("e"));
  // item desconhecido é ignorado (URL não escolhe o que vestir)
  const itens = (url.searchParams.get("i") ?? "")
    .split(",")
    .filter(ehItemId)
    .slice(0, ITEM_MAX)
    .map(pecaItem);
  const { svg, hash } = svgDoBicho(config, { itens, estagio, titulo: config.nome });
  const v = url.searchParams.get("v");
  const imutavel = v !== null && v === hash;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": imutavel ? "public, max-age=31536000, immutable" : "public, max-age=300",
      ETag: `"${hash}"`,
    },
  });
}
