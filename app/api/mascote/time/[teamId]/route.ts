import { parseId } from "@/lib/ids";
import { svgDoTime } from "@/lib/mascote/time";

// SVG do bicho do time (spec 046, onda 4 — telao-e-bicho-do-time). Público
// (PUBLIC_APIS): é o que a vitrine do projeto, o telão e o OG põem em <img>.
//
// O bicho do time é montado com uma parte do bicho de cada integrante
// (lib/mascote/time.ts) e carrega a bandeira com as iniciais do time no
// encaixe da mão. Time inexistente: 404 — aqui não faz sentido devolver um
// bicho de semente, porque não existe "time 0".
//
// Mesmo cache e CSP da rota do bicho de membro: com ?v=<hash> igual ao atual
// o cache é imutável de 1 ano; sem v, 5 minutos.
type Ctx = { params: Promise<{ teamId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const teamId = parseId((await params).teamId);
  if (teamId === null) return Response.json({ error: "time não encontrado" }, { status: 404 });
  const bicho = await svgDoTime(teamId);
  if (!bicho) return Response.json({ error: "time não encontrado" }, { status: 404 });
  const v = new URL(req.url).searchParams.get("v");
  const imutavel = v !== null && v === bicho.hash;
  return new Response(bicho.svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": imutavel ? "public, max-age=31536000, immutable" : "public, max-age=300",
      ETag: `"${bicho.hash}"`,
    },
  });
}
