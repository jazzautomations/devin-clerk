import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import QRCode from "qrcode";
import { formatCheckinTime, getTicket } from "@/lib/checkins";
import { getHackathon } from "@/lib/hackathons";
import { parseEventTime } from "@/lib/eventTime";
import { getMemberByClerkId } from "@/lib/members";
import { getRegistrationStatus, getWaitlistPosition } from "@/lib/registrations";

// Ingresso do inscrito (spec 033 US4): QR com o token assinado — nunca o id
// cru da inscrição. SVG gerado no servidor, sem JS no cliente.

export const metadata: Metadata = {
  title: "meu ingresso",
  robots: { index: false },
};

export default async function TicketPage({ params }: PageProps<"/h/[id]/ingresso">) {
  const { id } = await params;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: `/h/${id}/ingresso` });

  const h = await getHackathon(id);
  if (!h || !h.active) notFound();
  const member = await getMemberByClerkId(userId);
  // o token assinado do QR só existe pra quem está aprovado
  const status = member ? await getRegistrationStatus(member.id, h.id) : null;
  const ticket = member && status === "approved" ? await getTicket(member.id, h.id) : null;
  const approved = ticket?.status === "approved";
  const position = member && status === "waitlist" ? await getWaitlistPosition(member.id, h.id) : null;
  const svg = approved
    ? await QRCode.toString(ticket.token, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#0c0c0c", light: "#fefefe" },
      })
    : null;
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(parseEventTime(h.startsAt) ?? new Date(h.startsAt));

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      <Link href={`/h/${h.id}`} className="font-mono text-[13px] text-muted underline-offset-4 hover:underline">
        ← {h.name}
      </Link>

      <div className="border-t-[3px] border-b border-line">
        <p className="pt-4 font-mono text-[12px] tracking-widest text-muted uppercase">ingresso</p>
        <h1 className="mt-2 text-[clamp(1.8rem,7vw,2.4rem)] leading-[0.95] font-extrabold tracking-[-0.035em] break-words">
          {h.name}
        </h1>
        <p className="mt-2 mb-4 text-[14px] text-muted">
          {date} · {h.location ?? "online"}
        </p>

        {approved && svg ? (
          <div className="flex flex-col gap-4 border-t border-line py-5">
            <div
              data-testid="ticket-qr"
              role="img"
              aria-label="QR do ingresso"
              className="mx-auto w-full max-w-[300px] [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <div className="flex flex-col gap-1 text-center">
              <p className="text-[20px] font-extrabold tracking-[-0.02em]">
                {member!.name ?? `@${member!.username}`}
              </p>
              <p className="font-mono text-[13px] text-muted">@{member!.username}</p>
            </div>
            {ticket.checkedInAt ? (
              <p className="border-[1.5px] border-accent bg-mint px-4 py-3 text-center font-semibold text-accent-hi">
                check-in feito às {formatCheckinTime(ticket.checkedInAt)}
              </p>
            ) : (
              <p className="text-center text-[14px] text-muted">
                mostre este QR pro staff na entrada — tela com brilho alto ajuda
              </p>
            )}
          </div>
        ) : (
          <div className="border-t border-line py-5 text-[15px]">
            {status === "pending" ? (
              <p>Seu pedido de inscrição ainda está em análise. O ingresso aparece aqui quando for aprovado.</p>
            ) : status === "waitlist" ? (
              <div className="flex flex-col gap-2" data-testid="ticket-waitlist">
                <p className="pix text-[28px] leading-none">fila de espera{position ? ` #${position}` : ""}</p>
                <p>
                  Você está na fila de espera. Se abrir vaga, sua inscrição é confirmada sozinha, você recebe um aviso
                  e o ingresso aparece aqui.
                </p>
              </div>
            ) : status === "rejected" ? (
              <p>Sua inscrição nesta edição não foi aprovada, então não há ingresso.</p>
            ) : (
              <p>
                Você não está inscrito nesta edição.{" "}
                <Link href={`/h/${h.id}`} className="text-accent underline-offset-4 hover:underline">
                  Ver a edição
                </Link>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
