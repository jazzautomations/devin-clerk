import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { reviewSubmission } from "@/lib/submissions";

// POST /api/admin/submissions/[id] — curadoria da fila (spec 026):
// action=approve cria a edição em hackathons (source='comunidade');
// action=reject só sai da fila. Revisão é terminal (re-post → 200 no-op).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return Response.json(
      { error: "Indicação não encontrada" },
      { status: 404 },
    );
  }

  const b = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const action = b?.action;
  if (action !== "approve" && action !== "reject") {
    return Response.json(
      { error: "action deve ser 'approve' ou 'reject'" },
      { status: 400 },
    );
  }

  const res = reviewSubmission(numId, action);
  if (!res) {
    return Response.json(
      { error: "Indicação não encontrada" },
      { status: 404 },
    );
  }
  return Response.json(res);
}
