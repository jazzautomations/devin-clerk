import { auth, currentUser } from "@clerk/nextjs/server";
import { getMemberByUsername, getOrCreateMember } from "@/lib/members";
import { isBlockedEither } from "@/lib/blocks";
import { canNetwork } from "@/lib/network";
import { limitOrNull } from "@/lib/ratelimit";
import { RecadoError, canWriteRecado, cleanRecado, recadoClosedText, writeRecado } from "@/lib/recados";

// Recado no perfil (migration 041): POST /api/members/[username]/recados
//
// 401 deslogado; 404 perfil inexistente, conta excluída ou bloqueio em
// qualquer sentido (não confirma que a pessoa existe); 400 texto; 403 quando
// members.recadosFrom fecha o perfil pra quem está escrevendo; 429 no limite
// de 10/h e no de 1/min pra mesma pessoa (lib/ratelimit) e na corrente de
// mesmo texto (lib/recados). O recado em si é um post com profileId.
//
// A ordem importa: texto e permissão são checados ANTES do rate limit, então
// errar a digitação ou bater no perfil fechado não gasta a cota do minuto.
export async function POST(req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await currentUser();
  const member = await getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    imageUrl: user?.imageUrl ?? null,
  });
  const { username } = await params;
  const target = await getMemberByUsername(decodeURIComponent(username).toLowerCase());
  if (!target) return Response.json({ error: "Not found" }, { status: 404 });
  // bloqueio e conta fora da rede valem como "não existe"
  if (await isBlockedEither(member.id, target.id)) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await canNetwork(target.id))) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  let text: string;
  try {
    text = cleanRecado(body?.body);
  } catch (e) {
    if (e instanceof RecadoError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const perm = await canWriteRecado(member, target);
  if (!perm.ok) {
    if (perm.reason === "bloqueado") return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ error: recadoClosedText(perm.reason) }, { status: 403 });
  }

  // 1 por minuto pra mesma pessoa primeiro: o balde mais apertado não pode
  // queimar a cota da hora quando quem barra é ele
  const tooFast = limitOrNull(req, "recado-target", `${member.id}:${target.id}`);
  if (tooFast) return tooFast;
  const limited = limitOrNull(req, "recados", member.id);
  if (limited) return limited;

  try {
    const recado = await writeRecado(member, target, text);
    return Response.json({ post: recado }, { status: 201 });
  } catch (e) {
    if (e instanceof RecadoError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
