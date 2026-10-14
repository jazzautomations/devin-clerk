import { buildOfflinePack } from "@/lib/checkinPack";
import { limitOrNull } from "@/lib/ratelimit";
import { requireEditionStaff } from "@/lib/staffAuth";

// Pacote do check-in offline (roadmap 037 #5): staff baixa antes do Wi-Fi
// cair. Hash do token + nome + status por inscrição — sem token, sem segredo,
// sem e-mail. no-store: o pacote é dado pessoal, não fica em cache de proxy.
const HOUR = 3_600_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionStaff(id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "checkin-pack", g.member.id, { limit: 60, windowMs: HOUR });
  if (limited) return limited;
  const pack = await buildOfflinePack(g.hackathon);
  return Response.json(pack, { headers: { "Cache-Control": "no-store" } });
}
