import Link from "next/link";

// spec 033 US4 — atalho pro ingresso (QR do check-in) na página da edição;
// só renderiza pra inscrito aprovado em edição que ainda não acabou.
export function TicketLink({ hackathonId, show }: { hackathonId: string; show: boolean }) {
  if (!show) return null;
  return (
    <Link
      href={`/h/${hackathonId}/ingresso`}
      data-testid="ticket-link"
      className="btn w-full rounded-[6px]"
    >
      meu ingresso — QR do check-in →
    </Link>
  );
}
