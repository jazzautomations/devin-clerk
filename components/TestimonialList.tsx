import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { ReportDialog } from "@/components/ReportDialog";
import { TestimonialActions } from "@/components/TestimonialForm";
import { formatDbTime } from "@/lib/format";
import { listAccepted, type Testimonial } from "@/lib/testimonials";

// Depoimentos aceitos de uma pessoa (migration 037). Server component: o
// /perfil/depoimentos usa hoje, o perfil-rico põe no /u.
//
// - memberId: de quem é o perfil; me: quem olha (null = deslogado).
// - Dono vê "esconder do perfil"; quem está logado e não escreveu vê
//   "denunciar". Sem nenhum aceito, o dono vê o porquê e a visita não vê nada.
// - Texto puro: o React escapa e link não vira <a>.

type Props = {
  memberId: number;
  me: { id: number } | null;
  /** título "Depoimentos de time" em cima da lista */
  heading?: boolean;
};

export function TestimonialCard({ t, children, testId = "testimonial" }: { t: Testimonial; children?: React.ReactNode; testId?: string }) {
  return (
    <li className="flex flex-col gap-3 border-t border-line py-5" data-testid={testId} data-id={t.id}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar username={t.author.username} name={t.author.name} avatarUrl={t.author.avatarUrl} size="md" />
        <div className="flex min-w-0 flex-col">
          <Link href={`/u/${t.author.username}`} className="truncate font-bold transition hover:text-accent">
            {t.author.name ?? `@${t.author.username}`}
          </Link>
          <span className="truncate font-mono text-[12px] text-muted">
            @{t.author.username} · time no {t.hackathonName} · {formatDbTime(t.acceptedAt ?? t.createdAt)}
          </span>
        </div>
      </div>
      <blockquote
        className="border-l-[3px] border-accent pl-4 text-[16px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]"
        data-testid="testimonial-text"
      >
        {t.body}
      </blockquote>
      {children}
    </li>
  );
}

export async function TestimonialList({ memberId, me, heading = true }: Props) {
  const owner = me?.id === memberId;
  const list = await listAccepted(memberId, me?.id ?? null);
  if (list.length === 0 && !owner) return null;

  return (
    <section aria-labelledby={heading ? "depoimentos-title" : undefined} aria-label={heading ? undefined : "depoimentos recebidos"} className="flex flex-col gap-3" data-testid="testimonial-list">
      {heading && (
        <h2 id="depoimentos-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
          Depoimentos de time <span className="font-mono text-[15px] font-normal text-muted">{list.length}</span>
        </h2>
      )}
      {list.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-line px-4 py-6 font-mono text-[13px] text-muted" data-testid="testimonial-empty">
          Depoimento aqui só vem de quem fez time com você.
        </p>
      ) : (
        <ul className="flex flex-col border-b border-line">
          {list.map((t) => (
            <TestimonialCard key={t.id} t={t}>
              {owner ? (
                <TestimonialActions id={t.id} actions={["hide"]} />
              ) : me && me.id !== t.authorId ? (
                <ReportDialog
                  targetType="depoimento"
                  targetId={t.id}
                  targetLabel={`o depoimento de @${t.author.username}`}
                  authorUsername={t.author.username}
                  triggerClassName="self-start font-mono text-[12px] text-muted underline-offset-4 transition hover:text-orange hover:underline min-h-[44px]"
                />
              ) : null}
            </TestimonialCard>
          ))}
        </ul>
      )}
    </section>
  );
}
