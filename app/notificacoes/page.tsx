import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { listNotificationsGrouped, unreadCount } from "@/lib/notifications";
import { MarkAllReadButton } from "@/components/MarkAllReadButton";
import { NotificationList } from "./NotificationList";

export const metadata: Metadata = { title: "notificações", robots: { index: false } };

const TABS = [
  { key: "tudo", label: "tudo", href: "/notificacoes" },
  { key: "mencoes", label: "menções", href: "/notificacoes?aba=mencoes" },
] as const;

// Notificações do membro, agrupadas (migration 040): reações, comentários e
// seguidores parecidos das últimas 24h viram uma linha. Abrir uma (link do
// /open) marca como lida, com o grupo junto, e leva ao destino. "mais" pede
// a próxima página pelo cursor.
export default async function NotificacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const aba = (await searchParams).aba === "mencoes" ? "mencoes" : "tudo";
  const [page, unread] = await Promise.all([
    listNotificationsGrouped(member.id, null, 30, { only: aba === "mencoes" ? "mencoes" : undefined }),
    unreadCount(member.id),
  ]);
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-x-clip px-4 py-12 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-line pb-5">
        <div className="flex flex-col gap-2">
          <p className="tag self-start uppercase">notificações</p>
          <h1 className="text-[clamp(2rem,6vw,3rem)] leading-none font-extrabold tracking-[-0.035em]">
            {unread > 0 ? `${unread} não lida${unread === 1 ? "" : "s"}` : "tudo lido"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {unread > 0 && <MarkAllReadButton />}
          <Link
            href="/notificacoes/preferencias"
            className="font-mono text-[13px] text-accent underline-offset-4 hover:underline"
            data-testid="prefs-link"
          >
            preferências
          </Link>
        </div>
      </header>

      <nav aria-label="filtrar notificações" className="flex border-[1.5px] border-line self-start">
        {TABS.map((t) => {
          const active = t.key === aba;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`px-4 py-2 font-mono text-[13px] transition ${
                active ? "bg-foreground text-background" : "text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {page.items.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-line px-4 py-5 text-muted" data-testid="notifications-empty">
          {aba === "mencoes"
            ? "Ninguém mencionou você ainda. Quando alguém escrever seu @ num post, aparece aqui."
            : "Nada por aqui ainda. Respostas às suas dúvidas, convites de time e avisos das suas edições aparecem aqui."}
        </p>
      ) : (
        <NotificationList key={aba} initial={page.items} next={page.next} aba={aba} />
      )}
    </section>
  );
}
