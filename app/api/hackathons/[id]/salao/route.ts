import { salaoDaEdicao } from "@/lib/salao";

// Salão do telão (spec 046, onda 4 — telao-e-bicho-do-time). Público: o
// telão roda no projetor sem login (PUBLIC_APIS em lib/access.ts).
//
// Devolve quem está presente e o bicho de cada um, mais os contadores do
// rodapé. Só entra no JSON quem fez check-in E consentiu aparecer
// (registrations.publicListing, migration 016); quem não consentiu conta em
// `presentes` e não aparece.
//
// `configs` (campo extra ao contrato) é o config do bicho dos MAX_MALHA
// primeiros: é o que o telão transforma em malha 3D de verdade com montar().
// O resto da cena sai de sprite desenhado do SVG (`src`), que já vai em cada
// bicho — assim a resposta de 300 presentes não carrega 300 configs.
//
// Cache de 10s: o telão faz polling nesse intervalo, e 300 celulares no
// wi-fi do evento não podem virar 300 consultas por segundo.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const salao = await salaoDaEdicao(id);
  if (!salao) return Response.json({ error: "Edição não encontrada" }, { status: 404 });
  return Response.json(salao, { headers: { "Cache-Control": "public, max-age=10" } });
}
