import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { StageVote } from "@/components/StageVote";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { getMyLiveVote, getStageSnapshot, voterStatus } from "@/lib/stage";

// Modo palco — o celular de quem está na plateia. Chega aqui pelo QR do
// telão. Precisa de login (o voto é por pessoa) e de check-in na edição.

export const metadata: Metadata = {
  title: "votar na final",
  robots: { index: false },
};

export default async function StageVotePage({ params }: PageProps<"/h/[id]/votar">) {
  const { id } = await params;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: `/h/${id}/votar` });

  const h = await getHackathon(id);
  if (!h || !h.active) notFound();
  const member = await getMemberByClerkId(userId);
  const [snapshot, voter] = await Promise.all([
    getStageSnapshot(h.id),
    member ? voterStatus(h.id, member.id) : Promise.resolve(null),
  ]);
  const myScore =
    member && snapshot.current ? await getMyLiveVote(h.id, member.id, snapshot.current.teamId) : null;

  return (
    <StageVote
      hackathonId={h.id}
      editionName={h.name}
      initial={snapshot}
      checkedIn={Boolean(voter?.ok)}
      ownTeamId={voter?.ok ? voter.teamId : null}
      initialScore={myScore}
    />
  );
}
