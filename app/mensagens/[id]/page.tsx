import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { DmThread } from "@/components/DmThread";
import { currentMember } from "@/lib/session";
import { canMessage, getThreadFor, listMessages } from "@/lib/dm";

export const metadata: Metadata = { title: "mensagem", robots: { index: false } };

// A conversa (migration 056). Thread alheia dá 404 — a existência da
// conversa não vaza. Bloqueio depois da abertura não apaga o histórico,
// mas fecha o campo de escrever.

export default async function MensagemPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentMember();
  if (!me) notFound();
  const raw = (await params).id;
  const id = /^\d{1,12}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const found = await getThreadFor(me.id, id);
  if (!found) notFound();
  const { thread, peer } = found;
  const page = (await listMessages(me.id, id, null))!;
  const lock = await canMessage(me.id, peer.id);
  const falar = thread.status === "aberta" && lock.estado !== "bloqueado";

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6" data-testid="dm-conversa">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/mensagens" aria-label="voltar pras mensagens" className="shrink-0 font-mono text-[13px] text-muted hover:text-accent">
            ←
          </Link>
          <Avatar username={peer.username} name={peer.name} avatarUrl={peer.avatarUrl} size="sm" />
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-bold">{peer.name ?? `@${peer.username}`}</h1>
            <Link href={`/u/${peer.username}`} className="font-mono text-[12px] text-muted hover:text-accent hover:underline">
              @{peer.username}
            </Link>
          </div>
        </div>
      </div>
      <DmThread
        threadId={thread.id}
        peer={peer}
        initialMessages={page.messages}
        initialMais={page.mais}
        initialStatus={thread.status}
        iRequested={thread.requestedBy === me.id}
        initialFalar={falar}
        lockMotivo={lock.motivo}
      />
    </section>
  );
}
