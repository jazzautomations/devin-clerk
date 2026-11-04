import { parseId } from "@/lib/ids";
import { svgDoBicho } from "@/lib/mascote/isometrico";
import { mascotePublico } from "@/lib/mascote/store";

// SVG do bicho de um membro (migration 043). Público (PUBLIC_APIS): é o
// que listas, OG e telão põem em <img>. Membro inexistente ou excluído
// recebe o bicho da semente do id 0, nunca imagem quebrada.
//
// Com ?v=<hash> igual ao do bicho atual: cache imutável de 1 ano (o hash
// muda quando o bicho ou a arte mudam). Sem v, ou com v velho: 5 minutos.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id) ?? 0;
  const config = await mascotePublico(id);
  const { svg, hash } = svgDoBicho(config, { titulo: config.nome });
  const v = new URL(req.url).searchParams.get("v");
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
