import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { AREA_KEYS, areaLabel, isAreaKey, type AreaKey } from "@/lib/areas";
import { currentMember } from "@/lib/session";
import { listSeekers, type BoardCard } from "@/lib/teamboard";
import {
  activityEditions,
  listOpenings,
  matchReasons,
  openAreasOfMyTeams,
  type Opening,
} from "@/lib/teamOpenings";
import { InviteToTeamButton, OpenOpeningForm, OpeningCard, TeamUpButton } from "@/components/OpeningCard";

export const metadata: Metadata = {
  title: "times",
  description: "Vagas de time com área, candidatura com intro curta e o procuro time de todas as edições.",
  robots: { index: false },
};

// /times (spec 046, onda 3 — migration 045). O lugar de formar time entre uma
// edição e outra: vagas abertas dos times ("procuro design") e quem procura
// time. Logada de propósito: candidatura e convite só fazem sentido com conta.
//
// "Pra você" não tem nota nem ranking: a vaga cuja área está no meu "posso
// ajudar com", e a pessoa que oferece a área que o meu time procura.

const CHIP = "border border-line px-1.5 py-0.5 font-mono text-[11.5px] text-muted";

const tab = (active: boolean) =>
  `border-[1.5px] px-3 py-1.5 font-mono text-[12.5px] transition ${
    active ? "border-line bg-foreground text-background" : "border-line text-foreground hover:bg-mint"
  }`;

type Edition = { id: string; name: string };

export default async function TimesPage({ searchParams }: PageProps<"/times">) {
  const sp = await searchParams;
  const member = await currentMember();
  if (!member) redirect("/sign-up");

  const aba = sp.aba === "procurando" ? "procurando" : "vagas";
  const edicao = typeof sp.edicao === "string" && sp.edicao.trim() ? sp.edicao.trim() : null;
  const area = typeof sp.area === "string" && isAreaKey(sp.area) ? (sp.area as AreaKey) : null;
  const cidade = typeof sp.cidade === "string" && sp.cidade.trim() ? sp.cidade.trim() : null;
  const faculdade = typeof sp.faculdade === "string" && sp.faculdade.trim() ? sp.faculdade.trim() : null;

  const filter = { hackathonId: edicao, area, cidade, faculdade };
  const myOffer = member.helpOffer ?? [];

  const [openings, seekers, editions, myTeams, myAreas] = await Promise.all([
    aba === "vagas" ? listOpenings(filter, member) : Promise.resolve([] as Opening[]),
    aba === "procurando" ? listSeekers(filter, member.id) : Promise.resolve([] as BoardCard[]),
    activityEditions(),
    db
      .prepare(
        `SELECT t.id, t."hackathonId", h.name AS "hackathonName" FROM teams t
         JOIN team_members tm ON tm."teamId" = t.id
         JOIN hackathons h ON h.id = t."hackathonId"
         WHERE tm.username = ? AND h.active = 1 ORDER BY h."startsAt" DESC`,
      )
      .all<{ id: number; hackathonId: string; hackathonName: string }>(member.username),
    openAreasOfMyTeams(member.username),
  ]);

  // bloqueio e silêncio já saíram na query (listSeekers)
  const visibleSeekers = seekers;
  const abertas = openings.filter((o) => o.status === "aberta");
  const minhas = openings.filter((o) => o.status !== "aberta");
  const myTeamByEdition = new Map(myTeams.map((t) => [t.hackathonId, t.id]));
  const myEditionOptions: Edition[] = [...new Map(myTeams.map((t) => [t.hackathonId, { id: t.hackathonId, name: t.hackathonName }])).values()];

  // "Pra você": vaga cuja área eu ofereço; pessoa que oferece a área que o
  // meu time procura. Sem nota e sem bloqueado, no máximo 6 de cada.
  const forYouOpenings = myOffer.length > 0 ? (await listOpenings({ limit: 30 }, member)).filter((o) => !o.isTeamMember && o.canApply && myOffer.includes(o.area)).slice(0, 6) : [];
  const forYouPeople =
    myAreas.length > 0
      ? (await listSeekers({ limit: 40 }, member.id))
          .filter((s) => s.username !== member.username && s.helpOffer.some((k) => myAreas.includes(k)))
          .slice(0, 6)
      : [];
  const reasons = new Map<number, string[]>(
    await Promise.all(forYouOpenings.map(async (o) => [o.id, await matchReasons(member.id, o)] as const)),
  );

  const href = (over: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ aba, edicao, area, cidade, faculdade, ...over })) {
      if (v) params.set(k, v);
    }
    const s = params.toString();
    return s ? `/times?${s}` : "/times";
  };

  const input =
    "w-full min-w-0 border-[1.5px] border-line bg-surface px-3 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted focus:border-accent";

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">times</p>
        <h1 className="font-display text-[clamp(2.2rem,6vw,3.4rem)] leading-[0.95] font-extrabold tracking-[-0.035em]">
          Formar time sem adivinhar o @
        </h1>
        <p className="max-w-xl text-[15px] text-muted">
          O time abre a vaga dizendo a área que falta, você se candidata com uma intro curta e o aceite vira convite de
          time. Quem ainda está sozinho aparece em &quot;procurando time&quot;.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Times">
        <Link href={href({ aba: "vagas" })} aria-current={aba === "vagas" ? "page" : undefined} className={tab(aba === "vagas")}>
          vagas abertas
        </Link>
        <Link
          href={href({ aba: "procurando" })}
          aria-current={aba === "procurando" ? "page" : undefined}
          className={tab(aba === "procurando")}
        >
          procurando time
        </Link>
      </div>

      <form action="/times" className="flex min-w-0 flex-col gap-2">
        <input type="hidden" name="aba" value={aba} />
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[11px] text-muted uppercase">edição</span>
            <select name="edicao" defaultValue={edicao ?? ""} className={input}>
              <option value="">todas</option>
              {editions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[11px] text-muted uppercase">área</span>
            <select name="area" defaultValue={area ?? ""} className={input}>
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
            <input name="cidade" defaultValue={cidade ?? ""} placeholder="Sorocaba" className={input} />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[11px] text-muted uppercase">faculdade</span>
            <input name="faculdade" defaultValue={faculdade ?? ""} placeholder="USP" className={input} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="min-h-[44px] border-[1.5px] border-line px-4 font-mono text-sm text-muted transition hover:border-accent hover:text-accent"
          >
            filtrar
          </button>
          {(edicao || area || cidade || faculdade) && (
            <Link
              href={href({ edicao: null, area: null, cidade: null, faculdade: null })}
              className="font-mono text-[12px] text-muted underline-offset-4 hover:text-accent hover:underline"
            >
              limpar filtros
            </Link>
          )}
        </div>
      </form>

      {(forYouOpenings.length > 0 || forYouPeople.length > 0) && (
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="pra-voce">
          <div className="flex flex-col gap-1">
            <h2 id="pra-voce" className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
              pra você
            </h2>
            <p className="text-[13.5px] text-muted">
              Sem nota e sem ranking: o que casa com o seu &quot;posso ajudar com&quot; e com a área que o seu time
              procura.
            </p>
          </div>
          {forYouOpenings.length > 0 && (
            <ul className="flex min-w-0 flex-col gap-2">
              {forYouOpenings.map((o) => (
                <li key={`v-${o.id}`} className="flex min-w-0 flex-col gap-1 border border-line bg-surface p-3">
                  <p className="min-w-0 text-[15px] font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]">
                    {o.teamName} procura {areaLabel(o.area) ?? o.area}
                  </p>
                  <p className="min-w-0 font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">{o.intro}</p>
                  {(reasons.get(o.id) ?? []).length > 0 && (
                    <p className="flex flex-wrap gap-1">
                      {(reasons.get(o.id) ?? []).map((r) => (
                        <span key={r} className={CHIP}>
                          {r}
                        </span>
                      ))}
                    </p>
                  )}
                  <Link href={href({ aba: "vagas", edicao: o.hackathonId })} className="font-mono text-[12px] text-accent hover:underline">
                    ver a vaga →
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {forYouPeople.length > 0 && (
            <ul className="flex min-w-0 flex-col gap-2">
              {forYouPeople.map((s) => (
                <li key={`p-${s.id}`} className="flex min-w-0 flex-col gap-1 border border-line bg-surface p-3">
                  <p className="min-w-0 text-[15px] font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]">
                    <Link href={`/u/${s.username}`} className="hover:text-accent hover:underline">
                      @{s.username}
                    </Link>
                    {s.name && <span className="ml-2 font-mono text-[12px] font-normal text-muted">{s.name}</span>}
                  </p>
                  <p className="flex flex-wrap gap-1">
                    {s.helpOffer.map((k) => (
                      <span key={k} className={CHIP}>
                        ajuda em {areaLabel(k)}
                      </span>
                    ))}
                  </p>
                  <Link href={href({ aba: "procurando", edicao: s.hackathonId })} className="font-mono text-[12px] text-accent hover:underline">
                    ver o anúncio →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {aba === "vagas" ? (
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
              vagas abertas ({abertas.length})
            </h2>
            <p className="text-[13.5px] text-muted">
              O e-mail aparece pros dois quando o time aceitar. Antes disso, o contato é o perfil.
            </p>
          </div>
          <OpenOpeningForm editions={myEditionOptions} />
          {abertas.length === 0 ? (
            <div className="flex flex-col gap-3 border-[1.5px] border-line px-5 py-8">
              <p className="font-mono text-xs text-muted">
                {edicao || area || cidade || faculdade
                  ? "Nenhuma vaga com esses filtros. Limpe um deles e tente de novo."
                  : "Nenhuma vaga aberta agora. Se você tem time, abra a primeira: diga a área que falta."}
              </p>
              {editions.length > 0 && (
                <Link
                  href={`/h/${edicao ?? editions[0].id}`}
                  className="font-mono text-[12px] text-accent hover:underline"
                >
                  entrar no procuro time da edição →
                </Link>
              )}
            </div>
          ) : (
            <ul className="flex min-w-0 flex-col gap-3">
              {abertas.map((o) => (
                <OpeningCard key={o.id} opening={o} />
              ))}
            </ul>
          )}
          {minhas.length > 0 && (
            <div className="flex min-w-0 flex-col gap-3 border-t border-line pt-4">
              <h2 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
                suas vagas ({minhas.length})
              </h2>
              <p className="text-[13.5px] text-muted">
                Preenchida quando o convite é aceito, fechada quando o time desiste. Fica aqui pra você não perder o
                combinado.
              </p>
              <ul className="flex min-w-0 flex-col gap-3">
                {minhas.map((o) => (
                  <OpeningCard key={o.id} opening={o} />
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
              procurando time ({visibleSeekers.length})
            </h2>
            <p className="text-[13.5px] text-muted">
              Quem se anunciou nas edições. &quot;Bora fazer junto&quot; é silencioso: a pessoa só fica sabendo quando
              os dois marcam.
            </p>
          </div>
          {visibleSeekers.length === 0 ? (
            <div className="flex flex-col gap-3 border-[1.5px] border-line px-5 py-8">
              <p className="font-mono text-xs text-muted">
                {edicao || area || cidade || faculdade
                  ? "Ninguém procurando time com esses filtros."
                  : "Ninguém anunciado agora. Entre no procuro time da edição que você vai fazer e apareça aqui."}
              </p>
              {editions.length > 0 && (
                <Link
                  href={`/h/${edicao ?? editions[0].id}`}
                  className="font-mono text-[12px] text-accent hover:underline"
                >
                  entrar no procuro time da edição →
                </Link>
              )}
            </div>
          ) : (
            <ul className="flex min-w-0 flex-col gap-3">
              {visibleSeekers.map((s) => {
                const myTeamId = myTeamByEdition.get(s.hackathonId) ?? null;
                return (
                  <li key={s.id} className="flex min-w-0 flex-col gap-2 border border-line bg-surface p-4" data-testid="procuro-time-card">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                      <Link href={`/u/${s.username}`} className="font-mono text-[13px] text-accent hover:underline">
                        @{s.username}
                      </Link>
                      {s.name && (
                        <span className="min-w-0 text-[15px] font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]">
                          {s.name}
                        </span>
                      )}
                      {s.persona && <span className="border border-line bg-mint px-1.5 font-mono text-[11.5px] text-accent">{s.persona}</span>}
                      {s.hasTeam && <span className={CHIP}>já tem time</span>}
                    </div>
                    {s.headline && (
                      <p className="min-w-0 font-mono text-[12px] text-muted [overflow-wrap:anywhere]">{s.headline}</p>
                    )}
                    <p className="min-w-0 font-mono text-[12.5px] text-foreground [overflow-wrap:anywhere]">
                      <span className="text-muted">busca:</span> {s.need}
                    </p>
                    {s.skills.length > 0 && (
                      <p className="flex flex-wrap gap-1.5">
                        {s.skills.map((k) => (
                          <span key={k} className={CHIP}>
                            {k}
                          </span>
                        ))}
                      </p>
                    )}
                    {s.helpOffer.length > 0 && (
                      <p className="flex flex-wrap gap-1.5">
                        {s.helpOffer.map((k) => (
                          <span key={k} className="border border-line bg-mint px-1.5 py-0.5 font-mono text-[11.5px] text-accent">
                            posso ajudar com {areaLabel(k)}
                          </span>
                        ))}
                      </p>
                    )}
                    {(s.city || s.institution) && (
                      <p className="font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">
                        {[s.city, s.institution].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {s.username === member.username ? (
                      <p className="border-t border-line pt-2 font-mono text-[11.5px] text-accent">← seu anúncio</p>
                    ) : (
                      <div className="flex flex-wrap items-start gap-4 border-t border-line pt-2">
                        <TeamUpButton hackathonId={s.hackathonId} username={s.username} />
                        {myTeamId && !s.hasTeam && (
                          <InviteToTeamButton hackathonId={s.hackathonId} username={s.username} />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
