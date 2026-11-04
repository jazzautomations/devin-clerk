import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { currentMember } from "@/lib/session";
import { listThreads, type ThreadListItem } from "@/lib/dm";
import { formatDbTime } from "@/lib/format";

export const metadata: Metadata = { title: "mensagens", robots: { index: false } };

// Mensagem direta com trava (migration 056): conversas abertas, a caixa de
// pedidos de conversa e os pedidos que você mandou. DM é só entre quem tem
// laço — quem não tem manda pedido e espera o aceite.

function preview(item: ThreadListItem): string {
  if (item.status === "pedido") return item.iRequested ? "pedido enviado" : "quer conversar com você";
  if (item.status === "recusada") return item.iRequested ? "pedido recusado" : "conversa recusada";
  if (!item.lastBody) return "conversa aberta";
  return `${item.lastMine ? "você: " : ""}${item.lastBody}`;
}

function Row({ item }: { item: ThreadListItem }) {
  return (
    <li>
      <Link
        href={`/mensagens/${item.id}`}
        className="flex min-h-[56px] items-center gap-3 border-[1.5px] border-line px-3.5 py-2.5 transition hover:bg-mint"
        data-testid={`dm-thread-${item.peer.username}`}
      >
        <Avatar username={item.peer.username} name={item.peer.name} avatarUrl={item.peer.avatarUrl} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-[15px] ${item.unread > 0 ? "font-bold" : "font-medium"}`}>
              {item.peer.name ?? `@${item.peer.username}`}
            </span>
            {item.lastMessageAt && (
              <span className="shrink-0 font-mono text-[11px] text-muted">{formatDbTime(item.lastMessageAt)}</span>
            )}
          </span>
          <span className={`block truncate text-[13px] ${item.unread > 0 ? "text-foreground" : "text-muted"}`}>
            {preview(item)}
          </span>
        </span>
        {item.unread > 0 && (
          <span
            aria-label={`${item.unread} não lidas`}
            className="min-w-5 shrink-0 rounded-full bg-accent px-1.5 text-center font-mono text-[11px] font-bold leading-5 text-band"
          >
            {item.unread}
          </span>
        )}
      </Link>
    </li>
  );
}

export default async function MensagensPage() {
  const me = await currentMember();
  if (!me) notFound();
  const { conversas, pedidos, enviados } = await listThreads(me.id);
  const vazio = !conversas.length && !pedidos.length && !enviados.length;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6" data-testid="mensagens">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em]">mensagens</h1>
        <p className="font-mono text-[12.5px] text-muted">
          conversa privada, só entre quem tem laço: seguir de volta, mesmo time, encontro ou vaga aceita.
        </p>
      </div>

      {vazio ? (
        <p className="border-[1.5px] border-dashed border-line px-4 py-8 font-mono text-[13px] text-muted" data-testid="dm-empty">
          Nenhuma conversa ainda. Vá ao perfil de quem você conhece e chame por lá.
        </p>
      ) : (
        <>
          {pedidos.length > 0 && (
            <section aria-labelledby="dm-pedidos" className="flex flex-col gap-3">
              <h2 id="dm-pedidos" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
                pedidos de conversa
              </h2>
              <ul className="flex flex-col gap-2" data-testid="dm-requests">
                {pedidos.map((item) => (
                  <Row key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
          {conversas.length > 0 && (
            <ul className="flex flex-col gap-2" data-testid="dm-threads">
              {conversas.map((item) => (
                <Row key={item.id} item={item} />
              ))}
            </ul>
          )}
          {enviados.length > 0 && (
            <section aria-labelledby="dm-enviados" className="flex flex-col gap-3">
              <h2 id="dm-enviados" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
                pedidos que você mandou
              </h2>
              <ul className="flex flex-col gap-2" data-testid="dm-sent">
                {enviados.map((item) => (
                  <Row key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
