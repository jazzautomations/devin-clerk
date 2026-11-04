import Link from "next/link";
import { AREA_KEYS, areaLabel } from "@/lib/areas";

// Filtros de /membros e /talento (spec 046, perfil-rico). GET puro, sem
// estado no cliente: ?q=, ?oferece=, ?quer=, ?cidade= e ?faculdade=
// (institution) combinam entre si. A área é uma chave de lib/areas.ts, então
// o seletor não deixa digitar valor fora da lista.

export type MemberFilterValues = {
  q?: string;
  oferece?: string;
  quer?: string;
  cidade?: string;
  faculdade?: string;
};

const input =
  "w-full min-w-0 border-[1.5px] border-line bg-surface px-3 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted focus:border-accent";

export function MemberFilters({
  action,
  values,
  sort,
  searchLabel = "buscar",
}: {
  action: string;
  values: MemberFilterValues;
  /** /membros mantém a ordem escolhida ao filtrar */
  sort?: string;
  /** nome acessível do campo de busca (o /membros fala "buscar membros") */
  searchLabel?: string;
}) {
  const active = [values.oferece, values.quer, values.cidade, values.faculdade].filter(Boolean);
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="member-filters">
      {sort && <input type="hidden" name="sort" value={sort} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          name="q"
          defaultValue={values.q ?? ""}
          placeholder="username, nome, skill…"
          aria-label={searchLabel}
          className={`${input} sm:max-w-xs`}
        />
        <button
          type="submit"
          className="min-h-[44px] border-[1.5px] border-line px-4 font-mono text-sm text-muted transition hover:border-accent hover:text-accent"
        >
          buscar
        </button>
        {active.length > 0 && (
          <Link
            href={action}
            className="flex min-h-[44px] items-center px-2 font-mono text-[12px] text-muted underline-offset-4 hover:text-accent hover:underline"
          >
            limpar filtros
          </Link>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] text-muted uppercase">posso ajudar com</span>
          <select name="oferece" defaultValue={values.oferece ?? ""} className={input}>
            <option value="">qualquer área</option>
            {AREA_KEYS.map((k) => (
              <option key={k} value={k}>
                {areaLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] text-muted uppercase">quero ajuda com</span>
          <select name="quer" defaultValue={values.quer ?? ""} className={input}>
            <option value="">qualquer área</option>
            {AREA_KEYS.map((k) => (
              <option key={k} value={k}>
                {areaLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] text-muted uppercase">cidade</span>
          <input name="cidade" defaultValue={values.cidade ?? ""} placeholder="Sorocaba" className={input} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] text-muted uppercase">faculdade</span>
          <input name="faculdade" defaultValue={values.faculdade ?? ""} placeholder="USP" className={input} />
        </label>
      </div>
    </form>
  );
}
