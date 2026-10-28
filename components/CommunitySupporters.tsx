import { CommunityLogo } from "@/components/CommunityLogo";
import type { CommunitySupporter } from "@/lib/communitySupporters";
import { SUPPORT_KIND_LABELS } from "@/lib/supportKinds";

// "Quem apoia" da página da comunidade (migration 028). Só renderiza com
// apoiador cadastrado: lista vazia não vira seção vazia nem número inventado.
export function CommunitySupporters({
  supporters,
  variant = "page",
}: {
  supporters: Pick<CommunitySupporter, "id" | "name" | "logoUrl" | "url" | "kind" | "description">[];
  /** "card" = dentro do cartão público mínimo */
  variant?: "page" | "card";
}) {
  if (supporters.length === 0) return null;
  const card = variant === "card";
  return (
    <section
      aria-labelledby="apoio-title"
      id="apoio"
      className={card ? "flex flex-col gap-3 border-t-2 border-line px-5 py-4" : "flex scroll-mt-24 flex-col gap-4"}
      data-testid="community-supporters"
    >
      <h2
        id="apoio-title"
        className={
          card
            ? "font-mono text-[12px] font-normal tracking-[0.04em] text-muted uppercase"
            : "text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]"
        }
      >
        Quem apoia
      </h2>
      <ul className="flex flex-col border-b border-line">
        {supporters.map((s) => {
          const name = s.url ? (
            <a href={s.url} target="_blank" rel="noopener noreferrer nofollow sponsored" className="font-bold break-words underline-offset-4 hover:underline">
              {s.name} ↗
            </a>
          ) : (
            <span className="font-bold break-words">{s.name}</span>
          );
          return (
            <li key={s.id} className="flex items-start gap-3 border-t border-line py-3" data-testid="community-supporter">
              <CommunityLogo name={s.name} logoUrl={s.logoUrl} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[15px]">
                  {name}
                  <span className="chip bare">{SUPPORT_KIND_LABELS[s.kind]}</span>
                </span>
                {s.description && <p className="text-[14px] leading-snug text-[#2b2b2b] break-words">{s.description}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
