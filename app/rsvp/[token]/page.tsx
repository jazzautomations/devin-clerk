import type { Metadata } from "next";
import Link from "next/link";
import { getRsvpView, type RsvpView } from "@/lib/rsvp";
import { formatDbTime } from "@/lib/format";

// RSVP pelo link (migration 012): sem login — o token assinado é a
// autorização. A página só LÊ; confirmar/recusar é POST num <form> (sem
// JavaScript) pra /api/rsvp/[token], que responde 303 de volta pra cá.
// Leitor de e-mail que pré-carrega o link não decide por ninguém.

export const metadata: Metadata = {
  title: "confirmar presença",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  closed: "O prazo pra essa resposta acabou.",
  released: "Essa vaga já foi liberada — não dá mais pra confirmar.",
  not_invited: "Essa inscrição não está aguardando confirmação.",
  expired: "Este link expirou.",
  invalid: "Link inválido.",
  not_found: "Inscrição não encontrada.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      <div className="border-t-[3px] border-b border-line pb-5" data-testid="rsvp-page">
        <p className="pt-4 font-mono text-[12px] tracking-widest text-muted uppercase">confirmação de presença</p>
        {children}
      </div>
    </div>
  );
}

function Problem({ title, text }: { title: string; text: string }) {
  return (
    <Shell>
      <h1 className="mt-2 text-[clamp(1.7rem,7vw,2.2rem)] leading-[0.95] font-extrabold tracking-[-0.035em]" data-testid="rsvp-error">
        {title}
      </h1>
      <p className="mt-3 text-[15px] text-muted">{text}</p>
      <p className="mt-4 text-[15px]">
        <Link href="/dashboard" className="text-accent underline-offset-4 hover:underline">
          Entrar no HackaHub
        </Link>{" "}
        mostra o estado da tua inscrição.
      </p>
    </Shell>
  );
}

function statusLine(v: Extract<RsvpView, { kind: "open" }>): string {
  if (v.status === "confirmed") return "Presença confirmada. Te vemos lá.";
  if (v.status === "pending" && v.canConfirm) return `Responda até ${v.deadline}. Sem resposta, a vaga vai pra fila de espera.`;
  if (v.status === "pending") return "O prazo pra confirmar acabou.";
  return "Essa inscrição não está aguardando confirmação.";
}

export default async function RsvpPage({ params, searchParams }: PageProps<"/rsvp/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const done = typeof sp.feito === "string" ? sp.feito : null;
  const error = typeof sp.erro === "string" ? (ERRORS[sp.erro] ?? null) : null;
  const view = await getRsvpView(token);

  if (view.kind === "invalid") {
    return <Problem title="Link inválido" text="Esse link de confirmação não é válido. Confira se ele veio inteiro do e-mail ou do WhatsApp." />;
  }
  if (view.kind === "not_found") {
    return <Problem title="Inscrição não encontrada" text="Esse link é de uma inscrição que não existe mais." />;
  }
  if (view.kind === "expired") {
    return (
      <Problem
        title="Este link expirou"
        text={
          view.status === "confirmed"
            ? `Tua presença${view.hackathonName ? ` em ${view.hackathonName}` : ""} já está confirmada — nada a fazer.`
            : `O prazo pra responder${view.hackathonName ? ` sobre ${view.hackathonName}` : ""} acabou. Se a vaga foi liberada, você ainda pode entrar na fila de espera pela página da edição.`
        }
      />
    );
  }
  if (view.kind === "released") {
    return (
      <Shell>
        <h1 className="mt-2 text-[clamp(1.7rem,7vw,2.2rem)] leading-[0.95] font-extrabold tracking-[-0.035em] break-words">
          {view.hackathonName}
        </h1>
        <p className="mt-4 border-[1.5px] border-line bg-mint px-4 py-3 text-[15px] font-semibold" data-testid="rsvp-released">
          {view.outcome === "declined"
            ? `Vaga liberada em ${formatDbTime(view.at)}. Obrigado por avisar — ela foi pra próxima pessoa da fila.`
            : `A vaga foi liberada em ${formatDbTime(view.at)} porque não houve confirmação no prazo.`}
        </p>
        <p className="mt-4 text-[15px]">
          Mudou de ideia?{" "}
          <Link href={`/h/${view.hackathonId}`} className="text-accent underline-offset-4 hover:underline">
            Entre de novo pela página da edição
          </Link>{" "}
          (vai pro fim da fila, se ela existir).
        </p>
      </Shell>
    );
  }

  const action = `/api/rsvp/${encodeURIComponent(token)}`;
  return (
    <Shell>
      <h1 className="mt-2 text-[clamp(1.8rem,7vw,2.4rem)] leading-[0.95] font-extrabold tracking-[-0.035em] break-words">
        {view.hackathonName}
      </h1>
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[15px]">
        <dt className="font-mono text-[12px] tracking-wider text-muted uppercase">quando</dt>
        <dd className="font-semibold">{view.when}</dd>
        <dt className="font-mono text-[12px] tracking-wider text-muted uppercase">onde</dt>
        <dd className="font-semibold break-words">{view.location ?? "a confirmar"}</dd>
      </dl>

      {done === "confirmed" && view.status === "confirmed" && (
        <p className="mt-5 border-[1.5px] border-accent bg-mint px-4 py-3 font-semibold text-accent" role="status" data-testid="rsvp-done">
          Pronto — presença confirmada.
        </p>
      )}
      {error && (
        <p className="mt-5 border-[1.5px] border-orange px-4 py-3 font-semibold text-orange" role="alert">
          {error}
        </p>
      )}

      <p className="mt-5 text-[15px]" data-testid="rsvp-status">
        {view.firstName
          ? `${view.firstName}, ${statusLine(view).charAt(0).toLowerCase()}${statusLine(view).slice(1)}`
          : statusLine(view)}
      </p>

      {(view.canConfirm || view.canDecline) && (
        <div className="mt-5 flex flex-col gap-3">
          {view.canConfirm && (
            <form method="post" action={action}>
              <input type="hidden" name="action" value="confirm" />
              <button type="submit" className="btn w-full rounded-[6px] bg-accent! border-accent! text-white!">
                Confirmo, vou
              </button>
            </form>
          )}
          {view.canDecline && (
            <form method="post" action={action}>
              <input type="hidden" name="action" value="decline" />
              <button type="submit" className="btn-ghost w-full rounded-[6px]">
                {view.status === "confirmed" ? "Não vou mais — liberar minha vaga" : "Não vou — liberar a vaga"}
              </button>
            </form>
          )}
          <p className="font-mono text-[12px] text-muted">
            Liberar a vaga é na hora e não tem volta: ela vai pra próxima pessoa da fila.
          </p>
        </div>
      )}
      {view.status === "confirmed" && (
        <p className="mt-4 text-[15px]">
          <Link href={`/h/${view.hackathonId}/ingresso`} className="text-accent underline-offset-4 hover:underline">
            Ver meu ingresso (QR do check-in)
          </Link>
        </p>
      )}
    </Shell>
  );
}
