import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { TestimonialActions, TestimonialForm } from "@/components/TestimonialForm";
import { TestimonialCard, TestimonialList } from "@/components/TestimonialList";
import { formatDbTime } from "@/lib/format";
import { currentMember } from "@/lib/session";
import {
  canWriteBack,
  joinHandles,
  listHidden,
  listPending,
  listWrittenBy,
  teammatesToWrite,
  type TeammatesToWrite,
} from "@/lib/testimonials";
import { getMemberByUsername } from "@/lib/members";

export const metadata: Metadata = { title: "depoimentos", robots: { index: false } };

// Depoimento de time (migration 037). Três abas: o que está esperando a
// pessoa aceitar, o que já aparece no perfil e quem ela pode escrever sobre.
// Só a própria pessoa vê esta página.

const TABS = [
  { key: "aceitar", label: "pra aceitar" },
  { key: "recebidos", label: "recebidos" },
  { key: "escrever", label: "escrever" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Tabs({ active, counts }: { active: Tab; counts: Partial<Record<Tab, number>> }) {
  return (
    <nav aria-label="depoimentos" className="flex flex-wrap gap-2" data-testid="testimonial-tabs">
      {TABS.map(({ key, label }) => (
        <Link
          key={key}
          href={`/perfil/depoimentos?aba=${key}`}
          aria-current={active === key ? "page" : undefined}
          className={`flex min-h-[44px] items-center gap-2 border-[1.5px] border-line px-3.5 font-mono text-[13px] transition ${
            active === key ? "bg-foreground text-band" : "text-foreground hover:bg-mint"
          }`}
          data-testid={`tab-${key}`}
        >
          {label}
          {counts[key] !== undefined && <span className={active === key ? "text-band" : "text-muted"}>{counts[key]}</span>}
        </Link>
      ))}
    </nav>
  );
}

function Empty({ text, testId }: { text: string; testId: string }) {
  return (
    <p className="border-[1.5px] border-dashed border-line px-4 py-6 font-mono text-[13px] text-muted" data-testid={testId}>
      {text}
    </p>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
      {children}
    </h2>
  );
}

function WriteGroup({ g }: { g: TeammatesToWrite }) {
  const many = g.people.length > 1;
  return (
    <li className="flex flex-col gap-3 border-t border-line py-5" data-testid="write-group">
      <p className="text-[17px] leading-snug font-bold tracking-[-0.01em]">
        Você fez time com {joinHandles(g.people)} no {g.hackathonName}. {many ? "Escreva sobre eles." : "Escreva um depoimento."}
      </p>
      <ul className="flex flex-col gap-2">
        {g.people.map((p) => (
          <li key={p.id}>
            <details className="group border-[1.5px] border-line" data-testid={`write-${p.username}`}>
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 transition hover:bg-mint">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar username={p.username} name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                  <span className="truncate font-bold">{p.name ?? `@${p.username}`}</span>
                  <span className="hidden truncate font-mono text-[12px] text-muted sm:inline">@{p.username}</span>
                </span>
                <span className="shrink-0 font-mono text-[13px] text-accent group-open:hidden">escrever →</span>
                <span className="hidden shrink-0 font-mono text-[13px] text-muted group-open:inline">fechar</span>
              </summary>
              <div className="border-t border-line p-3">
                <TestimonialForm username={p.username} hackathonId={g.hackathonId} />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </li>
  );
}

export default async function DepoimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; aceito?: string; escrever?: string }>;
}) {
  const me = await currentMember();
  if (!me) notFound();
  const sp = await searchParams;
  const [pending, groups] = await Promise.all([listPending(me.id), teammatesToWrite(me.id, 20)]);
  const aba: Tab = TABS.some((t) => t.key === sp.aba) ? (sp.aba as Tab) : pending.length > 0 ? "aceitar" : "recebidos";

  // "quer escrever sobre @x também?": só se der mesmo (o @ vem da URL)
  let writeBack: string | null = null;
  if (aba === "aceitar" && sp.aceito && sp.escrever) {
    const other = await getMemberByUsername(sp.escrever.toLowerCase());
    if (other && (await canWriteBack(me.id, other.id))) writeBack = other.username;
  }
  const [hidden, sent] = await Promise.all([
    aba === "recebidos" ? listHidden(me.id) : Promise.resolve([]),
    aba === "escrever" ? listWrittenBy(me.id) : Promise.resolve([]),
  ]);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 overflow-x-clip px-4 py-12 sm:px-6 sm:py-16" data-testid="testimonials-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/u/${me.username}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← seu perfil
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Depoimentos</h1>
        <p className="max-w-[60ch] text-[15px] text-muted">
          Quem fez time com você escreve. Você decide o que aparece no perfil. Recusar e esconder não avisam ninguém.
        </p>
        <Tabs active={aba} counts={{ aceitar: pending.length, escrever: groups.reduce((n, g) => n + g.people.length, 0) }} />
      </header>

      {aba === "aceitar" && (
        <div className="flex flex-col gap-5">
          {sp.aceito && (
            <div className="flex flex-col gap-2 border-[1.5px] border-accent bg-mint px-4 py-3" role="status" data-testid="accepted-banner">
              <p className="font-mono text-[13px] text-accent">Aceito. Já aparece em recebidos.</p>
              {writeBack && (
                <Link href="/perfil/depoimentos?aba=escrever" className="self-start font-mono text-[13px] font-semibold text-foreground underline underline-offset-4" data-testid="write-back">
                  Quer escrever sobre @{writeBack} também?
                </Link>
              )}
            </div>
          )}
          {pending.length === 0 ? (
            <Empty text="Nada esperando você." testId="pending-empty" />
          ) : (
            <ul className="flex flex-col border-b border-line" data-testid="pending-list">
              {pending.map((t) => (
                <TestimonialCard key={t.id} t={t} testId="pending">
                  <TestimonialActions id={t.id} actions={["accept", "decline"]} body={t.body} />
                </TestimonialCard>
              ))}
            </ul>
          )}
        </div>
      )}

      {aba === "recebidos" && (
        <div className="flex flex-col gap-8">
          <TestimonialList memberId={me.id} me={{ id: me.id }} heading={false} />
          {hidden.length > 0 && (
            <section aria-labelledby="escondidos-title" className="flex flex-col gap-3">
              <SectionTitle id="escondidos-title">escondidos do perfil</SectionTitle>
              <ul className="flex flex-col border-b border-line" data-testid="hidden-list">
                {hidden.map((t) => (
                  <TestimonialCard key={t.id} t={t} testId="hidden">
                    <TestimonialActions id={t.id} actions={["show"]} body={t.body} />
                  </TestimonialCard>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {aba === "escrever" && (
        <div className="flex flex-col gap-10">
          <section aria-labelledby="escrever-title" className="flex flex-col gap-3">
            <SectionTitle id="escrever-title">fizeram time com você</SectionTitle>
            {groups.length === 0 ? (
              <Empty text="Depoimento aqui só vem de quem fez time com você. Quando a edição acabar, seus colegas aparecem aqui." testId="write-empty" />
            ) : (
              <ul className="flex flex-col border-b border-line" data-testid="write-list">
                {groups.map((g) => (
                  <WriteGroup key={g.teamId} g={g} />
                ))}
              </ul>
            )}
          </section>

          {sent.length > 0 && (
            <section aria-labelledby="enviados-title" className="flex flex-col gap-3">
              <SectionTitle id="enviados-title">enviados</SectionTitle>
              <ul className="flex flex-col border-b border-line" data-testid="sent-list">
                {sent.map((t) => (
                  <li key={t.id} className="flex flex-col gap-3 border-t border-line py-5" data-testid="sent" data-id={t.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 font-mono text-[12px] text-muted [overflow-wrap:anywhere]">
                        sobre{" "}
                        <Link href={`/u/${t.member.username}`} className="text-foreground hover:text-accent">
                          @{t.member.username}
                        </Link>{" "}
                        · {t.hackathonName} · {formatDbTime(t.updatedAt)}
                      </p>
                      <span className={`chip bare ${t.publicStatus === "no perfil" ? "border-accent! bg-mint! text-accent!" : "text-muted!"}`} data-testid="sent-status">
                        {t.publicStatus}
                      </span>
                    </div>
                    <p className="text-[15px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{t.body}</p>
                    <details className="border-[1.5px] border-line">
                      <summary className="flex min-h-[44px] cursor-pointer list-none items-center px-3 font-mono text-[13px] text-accent hover:bg-mint">
                        editar
                      </summary>
                      <div className="flex flex-col gap-4 border-t border-line p-3">
                        <TestimonialForm
                          username={t.member.username}
                          hackathonId={t.hackathonId}
                          testimonialId={t.id}
                          initialBody={t.body}
                          accepted={t.publicStatus === "no perfil"}
                        />
                        <TestimonialActions id={t.id} actions={["delete"]} />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
