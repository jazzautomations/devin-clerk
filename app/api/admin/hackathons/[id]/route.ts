import { isSafeLink, updateHackathon, type HackathonPatch } from "@/lib/admin";
import db from "@/lib/db";
import { requireEditionManager } from "@/lib/editionAuth";
import { getPublishBlockers } from "@/lib/editionChecklist";
import { announceEditionLaunch } from "@/lib/editionLaunch";
import { EventTimeError, normalizeEventTime, parseEventTime } from "@/lib/eventTime";
import { shiftSchedule } from "@/lib/schedule";
import { cleanUrl } from "@/lib/communities";

const FORMATS = ["online", "presencial", "hibrido"];

const bad = (msg: string) => Response.json({ error: msg }, { status: 400 });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // organizador da edição edita a própria edição (admin global vale);
  // arquivar, o endereço (id) e o link de inscrição continuam só com o admin
  // global
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const { member, hackathon: before } = g;
  const isAdmin = member.role === "admin";
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") {
    return bad("corpo da requisição inválido");
  }

  const patch: HackathonPatch = {};

  if ("name" in b) {
    if (typeof b.name !== "string" || !b.name.trim()) {
      return bad("informe o nome da edição");
    }
    patch.name = b.name;
  }
  if ("startsAt" in b) {
    if (typeof b.startsAt !== "string" || !b.startsAt) {
      return bad("informe a data de início");
    }
    patch.startsAt = b.startsAt;
  }
  if ("format" in b) {
    if (!FORMATS.includes(b.format)) {
      return bad("formato deve ser presencial, online ou híbrido");
    }
    patch.format = b.format;
  }
  if ("registrationUrl" in b) {
    // o botão de inscrição da página pública só aponta pra fora do HackaHub
    // por decisão do admin global (a aba configurar nem mostra o campo)
    if (!isAdmin) {
      return Response.json(
        { error: "Só a administração do HackaHub muda o link de inscrição." },
        { status: 403 },
      );
    }
    if (typeof b.registrationUrl !== "string" || !isSafeLink(b.registrationUrl.trim())) {
      return bad("link de inscrição inválido: use um endereço http(s) ou um caminho do site");
    }
    patch.registrationUrl = b.registrationUrl.trim();
  }
  // campos opcionais que aceitam null/vazio pra limpar
  for (const k of [
    "endsAt",
    "location",
    "registrationDeadline",
    "prize",
  ] as const) {
    if (k in b) {
      if (b[k] !== null && typeof b[k] !== "string") {
        return bad("valor inválido");
      }
      patch[k] = typeof b[k] === "string" && b[k] ? b[k] : null;
    }
  }
  // descrição e link do evento (organizador escreve)
  if ("description" in b) {
    if (b.description !== null && typeof b.description !== "string") return bad("descrição inválida");
    const d = typeof b.description === "string" ? b.description.trim() : "";
    if (d.length > 2000) return bad("descrição: até 2000 caracteres");
    patch.description = d || null;
  }
  if ("infoUrl" in b) {
    const u = cleanUrl(b.infoUrl);
    if ("error" in u) return bad(`${u.error} (link do evento)`);
    patch.infoUrl = u.value;
  }
  if ("tags" in b) {
    if (
      !Array.isArray(b.tags) ||
      b.tags.some((t: unknown) => typeof t !== "string")
    ) {
      return bad("tags inválidas");
    }
    patch.tags = b.tags;
  }
  if ("active" in b) {
    if (typeof b.active !== "boolean") {
      return bad("active deve ser booleano");
    }
    // publicar (rascunho → no ar) é do organizador, com o mínimo pronto;
    // arquivar e desarquivar ficam com o admin global
    if (b.active !== before.active) {
      if (!b.active && !isAdmin) {
        return Response.json({ error: "Só a administração do HackaHub arquiva uma edição." }, { status: 403 });
      }
      // já esteve no ar e saiu: foi arquivada pelo admin, que decide a volta
      if (b.active && !isAdmin && before.publishedAt) {
        return Response.json(
          { error: "Esta edição foi arquivada. Só a administração do HackaHub coloca de volta no ar." },
          { status: 403 },
        );
      }
      if (b.active && !isAdmin) {
        const missing = await getPublishBlockers(id);
        if (missing.length > 0) {
          return Response.json(
            { error: `Antes de publicar, falta: ${missing.join("; ")}.`, missing },
            { status: 409 },
          );
        }
      }
      patch.active = b.active;
    }
  }
  // spec 032 — edição curada: inscrição vira pedido pendente
  if ("requiresApproval" in b) {
    if (typeof b.requiresApproval !== "boolean") {
      return bad("requiresApproval deve ser booleano");
    }
    patch.requiresApproval = b.requiresApproval;
  }

  // frente N #7 — mudou o início: deslocar a programação junto só com
  // confirmação explícita (shiftSchedule: true); sem ela os itens ficam
  if ("shiftSchedule" in b && typeof b.shiftSchedule !== "boolean") {
    return bad("shiftSchedule deve ser booleano");
  }

  if (Object.keys(patch).length === 0 && !("active" in b)) {
    return bad("nada pra salvar");
  }

  // datas: sem fuso = horário de Brasília; formato desconhecido é 400
  try {
    for (const k of ["startsAt", "endsAt", "registrationDeadline"] as const) {
      const v = patch[k];
      if (typeof v === "string") patch[k] = normalizeEventTime(v);
    }
  } catch (e) {
    if (e instanceof EventTimeError) return bad(e.message);
    throw e;
  }

  // deslocamento real entre os dois instantes (o texto antigo pode estar em
  // outro formato: com Z, sem fuso, só a data)
  const oldStart = parseEventTime(before.startsAt);
  const newStart = patch.startsAt !== undefined ? parseEventTime(patch.startsAt) : null;
  const delta = oldStart && newStart ? newStart.getTime() - oldStart.getTime() : null;
  if (b.shiftSchedule === true && delta === null) {
    return bad("não deu pra calcular o deslocamento da programação — confira o início");
  }
  // data da edição e programação andam juntas ou nenhuma anda
  const { hackathon, schedule } = await db.transaction(async () => ({
    hackathon: await updateHackathon(id, patch),
    schedule: b.shiftSchedule === true && delta ? await shiftSchedule(id, delta, member.id) : null,
  }))();
  // edição da Hack Inova entrando no ar pela primeira vez: a comunidade inteira
  // fica sabendo (notificação + fila de e-mail). Idempotente.
  const launch = patch.active === true && !before.active ? await announceEditionLaunch(id) : null;
  return Response.json({ hackathon, schedule, launch });
}
