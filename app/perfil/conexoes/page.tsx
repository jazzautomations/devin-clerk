import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectionActions } from "@/components/ConnectionActions";
import { ReportDialog } from "@/components/ReportDialog";
import { listConnections } from "@/lib/encounters";
import { followingIds } from "@/lib/memberFollows";
import { currentMember } from "@/lib/session";
import { formatDbTime } from "@/lib/format";

// "Quem eu conheci" (spec 046, onda 5) — PRIVADO, sem grafo público e sem
// "amigos em comum". Por edição, com o contato que cada um liberou, seguir,
// convidar pro time e denunciar. Só aparece o encontro confirmado pelos dois.

export const metadata: Metadata = {
  title: "quem eu conheci",
  robots: { index: false },
};

const DEPTH_LABEL: Record<string, string> = {
  rapido: "papo rápido",
  alem: "além do oi",
};

export default async function ConexoesPage() {
  const member = await currentMember();
  if (!member) notFound();
  const [connections, following] = await Promise.all([
    listConnections(member.id, member.username),
    followingIds(member.id),
  ]);
  const followingSet = new Set(following);
  const editions = new Map<string, { name: string; items: typeof connections }>();
  for (const c of connections) {
    const key = c.hackathonId;
    if (!editions.has(key)) editions.set(key, { name: c.hackathonName ?? key, items: [] });
    editions.get(key)!.items.push(c);
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <Link href="/perfil" className="font-mono text-[13px] text-muted underline-offset-4 hover:underline">
          ← perfil
        </Link>
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">só você vê</p>
        <h1 className="text-[clamp(1.9rem,6vw,2.6rem)] leading-[0.95] font-extrabold tracking-[-0.035em]">
          Quem eu conheci
        </h1>
        <p className="max-w-prose text-[15px] text-muted">
          Encontros confirmados pelos dois, por edição. Não existe lista pública, grafo de quem conhece quem nem
          amigos em comum.
        </p>
      </div>

      {connections.length === 0 ? (
        <p className="border-[1.5px] border-line px-4 py-6 text-[15px]" data-testid="conexoes-vazio">
          Nada por aqui ainda. Numa edição com encontros ligados, leia o código do bicho de alguém: quando os dois
          confirmam, a pessoa aparece nesta lista.
        </p>
      ) : (
        editions.size > 0 &&
        [...editions.entries()].map(([id, group]) => (
          <section key={id} className="flex flex-col gap-3" data-testid="conexoes-edicao">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-line pt-4">
              <h2 className="text-[17px] font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]">{group.name}</h2>
              <Link
                href={`/h/${id}/encontros`}
                className="font-mono text-[12.5px] text-accent underline-offset-4 hover:underline"
              >
                encontros da edição →
              </Link>
            </div>
            <ul className="flex flex-col gap-3">
              {group.items.map((c) => (
                <li key={c.id} className="flex flex-col gap-2.5 border-[1.5px] border-line p-3" data-testid="conexao">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[15.5px] font-semibold [overflow-wrap:anywhere]">
                        {c.peer.name ?? c.peer.firstName}{" "}
                        <span className="font-mono text-[12.5px] font-normal text-muted">@{c.peer.username}</span>
                      </p>
                      <p className="font-mono text-[12px] text-muted [overflow-wrap:anywhere]">
                        {[c.peer.personas.join(", "), c.peer.institution ?? c.peer.city]
                          .filter(Boolean)
                          .join(" · ")}
                        {c.confirmedAt ? ` · ${formatDbTime(c.confirmedAt)}` : ""}
                      </p>
                    </div>
                    <ReportDialog
                      targetType="encontro"
                      targetId={c.id}
                      targetLabel="o encontro"
                      authorUsername={c.peer.username}
                    />
                  </div>

                  {c.peer.contact && (
                    <p className="text-[14px] [overflow-wrap:anywhere]" data-testid="conexao-contato">
                      {c.peer.contact.label}: <span className="font-mono">{c.peer.contact.value}</span>
                    </p>
                  )}
                  {c.side.depth && (
                    <p className="font-mono text-[12.5px] text-muted">
                      você marcou: {DEPTH_LABEL[c.side.depth]}
                      {c.deep ? " · os dois foram além do oi" : ""}
                    </p>
                  )}
                  <ConnectionActions
                    username={c.peer.username}
                    hackathonId={c.hackathonId}
                    following={followingSet.has(c.peer.memberId)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
