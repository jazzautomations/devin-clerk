import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { listNotifications, unreadCount } from "@/lib/notifications";
import { MarkAllReadButton } from "@/components/MarkAllReadButton";

export const metadata: Metadata = { title: "notificações", robots: { index: false } };

const fmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// todas as notificações do membro: abrir uma (link do /open) marca como lida
// e leva ao destino; "marcar todas" zera o contador do sino
export default async function NotificacoesPage() {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const [items, unread] = await Promise.all([listNotifications(member.id, 200), unreadCount(member.id)]);
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-line pb-5">
        <div className="flex flex-col gap-2">
          <p className="tag self-start uppercase">notificações</p>
          <h1 className="text-[clamp(2rem,6vw,3rem)] leading-none font-extrabold tracking-[-0.035em]">
            {unread > 0 ? `${unread} não lida${unread === 1 ? "" : "s"}` : "tudo lido"}
          </h1>
        </div>
        {unread > 0 && <MarkAllReadButton />}
      </header>
      {items.length === 0 ? (
        <p className="text-muted">
          Nada por aqui ainda. Respostas às suas dúvidas, convites de time e avisos das suas edições aparecem aqui.
        </p>
      ) : (
        <ul className="border-b border-line" data-testid="notification-list">
          {items.map((n) => (
            <li key={n.id} className="border-t border-line">
              <a
                href={`/api/notifications/${n.id}/open`}
                data-read={n.read ? "1" : "0"}
                className="flex gap-3 py-3 transition hover:bg-line/10"
              >
                <span
                  aria-hidden
                  className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-accent"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className={`block break-words ${n.read ? "text-muted" : "font-semibold text-foreground"}`}>
                    {n.text}
                  </span>
                  <span className="block font-mono text-[12px] text-muted">
                    {fmt.format(new Date(`${n.createdAt.replace(" ", "T")}Z`))}
                    {!n.read && " · não lida"}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
