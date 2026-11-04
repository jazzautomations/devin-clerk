import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { getMemberByUsername, resolveUsernameRedirect, type Member } from "@/lib/members";
import { absoluteUrl } from "@/lib/seo";
import { getRegistrationIds } from "@/lib/registrations";
import { computeXp, getMemberBadges, getMemberCards } from "@/lib/xp";
import { getMemberArc, getMemberProjects } from "@/lib/archive";
import type { MemberArcEntry } from "@/lib/archive";
import { levelFor } from "@/lib/game";
import { XpBar } from "@/components/XpBar";
import { BadgeChip } from "@/components/BadgeChip";
import { CollectibleCard } from "@/components/CollectibleCard";
import { Avatar } from "@/components/Avatar";
import { ShareBar } from "@/components/ShareBar";
import { profileUrl } from "@/lib/social";
import { personaLabel } from "@/lib/personas";
import { PublicCard } from "@/components/PublicCard";
import { ProfileSafetyMenu } from "@/components/ProfileSafetyMenu";
import { dmEntryPoint } from "@/lib/dm";
import { currentMember } from "@/lib/session";
import { isBlockedBy, relationTo } from "@/lib/blocks";
import { followsMe, isFollowingMember, ownCounts } from "@/lib/memberFollows";
import { sharedTeamsLabel } from "@/lib/evidence";
import { DmStart } from "@/components/DmStart";
import { FollowButton } from "@/components/FollowButton";
import { MascoteViewer } from "@/components/MascoteViewer";
import { bichoDoMembro, ESTAGIO_NOME } from "@/lib/mascote/evolucao";
import { nomeItem } from "@/lib/mascote/itens";
import { ESPECIE_DEFS } from "@/lib/mascote/especies";
import { PostCard } from "@/components/PostCard";
import { TestimonialList } from "@/components/TestimonialList";
import { CommunityBadges } from "@/components/CommunityBadges";
import { RecadoComposer } from "@/components/RecadoComposer";
import { hydratePosts, listPostIds, type Post } from "@/lib/posts";
import { areaLabel } from "@/lib/areas";
import {
  PROFILE_NUMBER_LABELS,
  numberLabel,
  openProfile,
  pinnedProjects,
  profileNumbers,
  type ProfileNumbers,
} from "@/lib/profileFacts";
import { canWriteRecado, listRecados, recadoClosedText } from "@/lib/recados";
import { countAccepted } from "@/lib/testimonials";

// Perfil de builder (spec 046, perfil-rico, migration 041).
//
// A ordem da página: cabeçalho, faixa dos 4 números de fato (countFacts),
// comunidades como crachá, "posso ajudar com" / "quero ajuda com", projetos
// fixados, recados do perfil (migration 041), depoimentos aceitos (037) e as
// abas ?aba= (atividade, projetos, trajetória, coleção).
//
// Quem não tem conta vê o cartão mínimo (spec 039) — e só vê a página aberta
// se a pessoa ligou "perfil aberto" (publicProfile) e passa em canNetwork.
// Nesse caso não há atividade, recado nem link pessoal: só trajetória,
// projetos e números, que é o que o toggle promete.

const TABS = [
  { key: "atividade", label: "atividade" },
  { key: "projetos", label: "projetos" },
  { key: "trajetoria", label: "trajetória" },
  { key: "colecao", label: "coleção" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const isTab = (v: string | undefined): v is Tab => !!v && TABS.some((t) => t.key === v);

const ACTIVITY_PAGE = 20;

// spec 029 — desfecho de cada edição do arco → chip da trajetória:
// pódio nas cores de raridade, entrega em accent, presença em muted
function arcOutcome(e: MemberArcEntry): { label: string; cls: string } {
  if (e.placement === 1)
    return {
      label: "1º lugar",
      cls: "border-lendario/50 bg-lendario/10 text-lendario",
    };
  if (e.placement === 2)
    return {
      label: "2º lugar",
      cls: "border-epico/50 bg-epico/10 text-epico",
    };
  if (e.placement === 3)
    return {
      label: "3º lugar",
      cls: "border-raro/50 bg-raro/10 text-raro",
    };
  if (e.hasProject)
    return {
      label: "entregou projeto",
      cls: "border-accent bg-mint text-accent",
    };
  return { label: "participou", cls: "border-line text-muted" };
}

const shortDate = (startsAt: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(new Date(startsAt));

function socialLinks(member: Member): [string, string][] {
  const out: [string, string][] = [];
  for (const [label, href] of [
    ["github", profileUrl("github", member.github)],
    ["linkedin", profileUrl("linkedin", member.linkedin)],
    ["x", profileUrl("twitter", member.twitter)],
    ["site", profileUrl("website", member.website)],
  ] as const) {
    if (href) out.push([label, href]);
  }
  return out;
}

/** faixa dos quatro números: zero aparece como travessão, cada um leva à aba */
function NumbersStrip({ username, numbers }: { username: string; numbers: ProfileNumbers }) {
  return (
    <div
      className="grid grid-cols-2 gap-[1.5px] border-[1.5px] border-line bg-line sm:grid-cols-4"
      data-testid="profile-numbers"
    >
      {PROFILE_NUMBER_LABELS.map(({ key, label, aba }) => (
        <Link
          key={key}
          href={`/u/${username}?aba=${aba}`}
          className="flex min-w-0 flex-col gap-0.5 bg-background px-3 py-2.5 transition hover:bg-mint"
          data-testid={`number-${key}`}
          aria-label={`${label}: ${numbers[key]}`}
        >
          <span className="font-mono text-[11px] tracking-[0.04em] text-muted uppercase">{label}</span>
          <span className="font-display text-[26px] leading-none font-extrabold">{numberLabel(numbers[key])}</span>
        </Link>
      ))}
    </div>
  );
}

function HelpChips({ member }: { member: Member }) {
  const offer = member.helpOffer ?? [];
  const want = member.helpWant ?? [];
  if (offer.length === 0 && want.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="profile-help">
      {[
        { label: "posso ajudar com", keys: offer, param: "oferece" },
        { label: "quero ajuda com", keys: want, param: "quer" },
      ]
        .filter((row) => row.keys.length > 0)
        .map((row) => (
          <div key={row.param} className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12px] text-muted">{row.label}</span>
            {row.keys.map((k) => (
              <Link
                key={k}
                href={`/membros?${row.param}=${k}`}
                className="border border-line bg-mint px-1.5 py-0.5 font-mono text-[12px] text-accent transition hover:border-accent"
              >
                {areaLabel(k) ?? k}
              </Link>
            ))}
          </div>
        ))}
    </div>
  );
}

type PinCard = { teamId: number; title: string; teamName: string; hackathonName: string; hackathonId: string; placement: number; href: string };

function Pins({ pins }: { pins: PinCard[] }) {
  if (pins.length === 0) return null;
  return (
    <section aria-labelledby="fixados-title" className="flex flex-col gap-3" data-testid="profile-pins">
      <h2 id="fixados-title" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
        fixados
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {pins.map((p) => (
          <li key={p.teamId} className="flex min-w-0 flex-col gap-1 border-[1.5px] border-line bg-surface p-3">
            <Link href={p.href} className="font-display font-extrabold tracking-[-0.02em] break-words transition hover:text-accent">
              {p.title}
            </Link>
            <span className="font-mono text-[12px] break-words text-muted">
              {p.teamName} · {p.hackathonName}
            </span>
            {p.placement > 0 && (
              <span className="w-fit border border-lendario/50 bg-lendario/10 px-1.5 font-mono text-[11px] text-lendario">
                {p.placement}º lugar
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Projects({ projects }: { projects: Awaited<ReturnType<typeof getMemberProjects>> }) {
  return (
    <div className="flex flex-col gap-4" data-testid="profile-projects">
      <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">projetos ({projects.length})</h2>
      {projects.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-line px-4 py-6 font-mono text-[13px] text-muted">
          Nenhum projeto entregue ainda.
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {projects.map((p) => (
            <li key={`${p.hackathonId}-${p.teamName}`} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="min-w-0 font-display font-extrabold tracking-[-0.02em] break-words">
                  {p.project ? (
                    <Link href={`/p/${p.teamId}`} className="transition hover:text-accent">
                      {p.project.title}
                    </Link>
                  ) : (
                    p.teamName
                  )}
                </p>
                {p.placement > 0 && (
                  <span className="border border-lendario/50 bg-lendario/10 px-1.5 font-mono text-[12px] text-lendario">
                    {p.placement}º lugar
                  </span>
                )}
              </div>
              <p className="font-mono text-xs break-words text-muted">
                {p.teamName} · {p.hackathonName}
              </p>
              {p.project?.repoUrl && (
                <a
                  href={p.project.repoUrl}
                  target="_blank"
                  rel="noopener nofollow"
                  className="font-mono text-xs text-accent hover:underline"
                >
                  repo →
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Trajectory({ arc }: { arc: MemberArcEntry[] }) {
  const podiums = arc.filter((e) => e.placement >= 1 && e.placement <= 3).length;
  const delivered = arc.filter((e) => e.hasProject).length;
  return (
    <div className="flex flex-col gap-3" data-testid="profile-arc">
      <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">{"trajetória"}</h2>
      {arc.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-line px-4 py-6 font-mono text-[13px] text-muted">
          {"ainda não participou de hackathon via hackahub"}
        </p>
      ) : (
        <>
          <p className="font-mono text-xs text-muted">
            {arc.length} {arc.length === 1 ? "edição" : "edições"} · {podiums}{" "}
            {podiums === 1 ? "pódio" : "pódios"} · {delivered}{" "}
            {delivered === 1 ? "projeto entregue" : "projetos entregues"}
          </p>
          <ol aria-label="trajetória" className="flex flex-wrap items-center gap-x-2 gap-y-2">
            {arc.map((e, i) => {
              const chip = arcOutcome(e);
              return (
                <li key={e.hackathonId} className="flex min-w-0 items-center gap-2">
                  {i > 0 && (
                    <span aria-hidden className="font-mono text-[12px] text-muted">
                      →
                    </span>
                  )}
                  <Link
                    href={`/h/${e.hackathonId}`}
                    title={e.teamName ?? e.hackathonName}
                    className="flex min-w-0 flex-wrap items-center gap-2 border-[1.5px] border-line bg-surface px-2.5 py-1.5 transition hover:border-line"
                  >
                    <span className="font-mono text-[12px] text-muted">{shortDate(e.startsAt)}</span>
                    <span className="min-w-0 font-display text-xs font-extrabold tracking-[-0.02em] break-words">
                      {e.hackathonName}
                    </span>
                    <span className={`border px-1.5 font-mono text-[10px] ${chip.cls}`}>{chip.label}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

async function Collection({ memberId }: { memberId: number }) {
  const [badges, cards] = await Promise.all([getMemberBadges(memberId), getMemberCards(memberId)]);
  return (
    <div className="flex flex-col gap-6" data-testid="profile-collection">
      {badges.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">badges ({badges.length})</h2>
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <BadgeChip key={b.id} badge={b} />
            ))}
          </div>
        </div>
      ) : (
        <p className="border-[1.5px] border-dashed border-line px-4 py-6 font-mono text-[13px] text-muted">
          Nenhuma conquista ainda.
        </p>
      )}
      {cards.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            coleção — cartinhas de edição ({cards.length})
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {cards.map((c) => (
              <CollectibleCard
                key={c.hackathonId}
                hackathonId={c.hackathonId}
                name={c.name}
                startsAt={c.startsAt}
                location={c.location}
                rarity={c.rarity}
                serial={c.serial}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const member = await getMemberByUsername(username);
  if (!member) return { title: "perfil não encontrado" };
  // bloqueado não vê nem o nome na aba (migration 032)
  const viewer = (await auth()).userId ? await currentMember() : null;
  if (viewer && (await isBlockedBy(viewer.id, member.id))) return { title: "perfil não encontrado" };
  const name = member.name ?? `@${member.username}`;
  // perfil fechado não entrega o nome pra crawler nem pra quem não tem conta
  const open = await openProfile(member.id, member.publicProfile ?? 0);
  if (!viewer && !open) {
    return {
      title: "perfil no HackaHub",
      description: "Quem constrói em hackathon no Brasil. Entre pra ver o perfil completo.",
      alternates: { canonical: `/u/${member.username}` },
      robots: { index: false },
    };
  }
  const description =
    member.headline ??
    member.bio ??
    `${name} no hackahub — trajetória, projetos, números de hackathon e depoimentos de time.`;
  return {
    title: name,
    description,
    alternates: { canonical: `/u/${member.username}` },
    openGraph: {
      title: name,
      description,
      url: absoluteUrl(`/u/${member.username}`),
      type: "profile",
      username: member.username,
    },
  };
}

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ aba?: string; antes?: string; recados?: string }>;
}) {
  const { username } = await params;
  const sp = await searchParams;
  const member = await getMemberByUsername(username);
  if (!member) {
    // frente N #8 — username trocado: o link antigo segue valendo (308)
    const moved = await resolveUsernameRedirect(decodeURIComponent(username));
    if (moved) permanentRedirect(`/u/${moved}`);
    notFound();
  }

  const open = await openProfile(member.id, member.publicProfile ?? 0);

  // spec 039 — sem conta: cartão mínimo, ou a página aberta se a pessoa ligou
  const { userId } = await auth();
  if (!userId) {
    if (!open) {
      const editions = (await getRegistrationIds(member.id)).length;
      const personas = member.personas.map((p) => personaLabel(p)).filter(Boolean).join(" · ");
      return (
        <PublicCard
          kind="perfil"
          title={member.name ?? `@${member.username}`}
          subtitle={member.headline}
          path={`/u/${member.username}`}
          facts={[
            ["usuário", `@${member.username}`],
            ...(personas ? ([["quem é", personas]] as [string, string][]) : []),
            ["edições", String(editions)],
          ]}
          rest="Esta pessoa ainda não abriu o perfil."
        >
          <Avatar username={member.username} name={member.name} avatarUrl={member.avatarUrl} size="md" />
        </PublicCard>
      );
    }
    // perfil aberto: cabeçalho sem e-mail, números, crachás, fixados,
    // projetos, trajetória e a contagem de depoimentos (sem o texto)
    const [numbers, pins, projects, arc, depoimentos] = await Promise.all([
      profileNumbers(member.id),
      pinnedProjects(member.id, member.username),
      getMemberProjects(member.username),
      getMemberArc(member.username),
      countAccepted(member.id),
    ]);
    return (
      <section
        className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 [&>*]:max-w-3xl"
        data-testid="public-profile"
      >
        <div className="flex flex-col gap-3">
          <p className="tag self-start uppercase">{"perfil aberto"}</p>
          <div className="flex items-center gap-4">
            <Avatar username={member.username} name={member.name} avatarUrl={member.avatarUrl} size="lg" />
            <h1 className="min-w-0 font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold leading-[0.95] tracking-[-0.035em] [overflow-wrap:anywhere]">
              {member.name ?? `@${member.username}`}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm text-muted">@{member.username}</p>
            {member.city && <span className="font-mono text-[12px] text-muted">{member.city}</span>}
            {member.institution && <span className="font-mono text-[12px] text-muted">{member.institution}</span>}
          </div>
          {member.headline && <p className="font-mono text-sm text-foreground">{member.headline}</p>}
        </div>
        <NumbersStrip username={member.username} numbers={numbers} />
        <CommunityBadges memberId={member.id} />
        <HelpChips member={member} />
        <Pins pins={pins.projects.map(toPinCard)} />
        <Projects projects={projects} />
        <Trajectory arc={arc} />
        {depoimentos > 0 && (
          <p className="font-mono text-[13px] text-muted" data-testid="public-testimonials">
            {depoimentos} {depoimentos === 1 ? "depoimento de time" : "depoimentos de time"}
          </p>
        )}
        <p className="border-t border-line pt-4 font-mono text-[12px] text-muted">
          Esta pessoa abriu o perfil.{" "}
          <Link href="/sign-up" className="text-accent underline-offset-4 hover:underline">
            entrar no HackaHub
          </Link>
        </p>
      </section>
    );
  }

  // migration 032: quem foi bloqueado recebe 404, igual a perfil que não existe
  const viewer = await currentMember();
  if (viewer && (await isBlockedBy(viewer.id, member.id))) notFound();
  const own = viewer?.id === member.id;
  const relation = viewer && !own ? await relationTo(viewer.id, member.id) : null;
  // seguir pessoa (migration 033): visitante vê "segue você" e o time em
  // comum, nunca número. O dono vê os próprios números e as listas.
  const [iFollow, followsViewer, teamLine, counts, dmEntry] = await Promise.all([
    viewer && !own ? isFollowingMember(viewer.id, member.id) : false,
    viewer && !own ? followsMe(viewer.id, member.id) : false,
    viewer && !own ? sharedTeamsLabel(viewer.id, member.id) : null,
    own ? ownCounts(member.id) : null,
    // DM com trava (migration 056): o motivo vira texto ao lado do botão;
    // bloqueio ou canNetwork falso devolve null e nada aparece
    viewer && !own ? dmEntryPoint(viewer.id, member) : null,
  ]);
  const me = viewer ? { id: viewer.id, username: viewer.username, role: viewer.role } : null;

  const [bicho, numbers, pins, xp, canWrite] = await Promise.all([
    bichoDoMembro(member.id),
    profileNumbers(member.id),
    pinnedProjects(member.id, member.username),
    computeXp(member.id),
    viewer ? canWriteRecado(viewer, member) : Promise.resolve({ ok: false as const, reason: "conexoes" as const }),
  ]);
  const { level } = levelFor(xp.total);
  const links = socialLinks(member);

  const tab: Tab = isTab(sp.aba) ? sp.aba : "atividade";
  const antes = Number(sp.antes) > 0 ? Number(sp.antes) : null;

  // atividade: posts que a pessoa escreveu (recado não entra — migration 041)
  let activity: Post[] = [];
  let activityMore: number | null = null;
  if (tab === "atividade") {
    const ids = await listPostIds({ kind: "member", id: member.id }, viewer?.id ?? null, {
      antes,
      limit: ACTIVITY_PAGE + 1,
    });
    activityMore = ids.length > ACTIVITY_PAGE ? ids[ACTIVITY_PAGE - 1] : null;
    activity = await hydratePosts(ids.slice(0, ACTIVITY_PAGE), viewer?.id ?? null);
  }
  const projects = tab === "projetos" ? await getMemberProjects(member.username) : [];
  const arc = tab === "trajetoria" ? await getMemberArc(member.username) : [];

  // recados do perfil: últimos RECADO_PAGE, com "ver mais" (?recados=todos)
  const recadosAll = sp.recados === "todos";
  const recados = await listRecados(member.id, viewer?.id ?? null, { limit: recadosAll ? 50 : 10 });
  const recadosMore = !recadosAll && recados.length === 10;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 [&>*]:max-w-3xl">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"hacker · lv"}
          {level.n} {level.name}
        </p>
        <div className="flex items-center gap-4">
          <Avatar username={member.username} name={member.name} avatarUrl={member.avatarUrl} size="lg" />
          {/* username tem até 20 caracteres sem espaço: quebra em vez de estourar 390px */}
          <h1 className="min-w-0 font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold leading-[0.95] tracking-[-0.035em] [overflow-wrap:anywhere]">
            {member.name ?? `@${member.username}`}
          </h1>
        </div>
        {/* bicho (migration 043, estágio e itens na 047): o herói do perfil */}
        <figure className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5" data-testid="u-bicho">
          <div className="desk w-[200px] shrink-0 border-x-2 p-2">
            <div className="border-2 border-line bg-background">
              <MascoteViewer config={bicho.config} itens={bicho.pecas} estagio={bicho.estagio} tamanho={184} />
            </div>
          </div>
          <figcaption className="flex min-w-0 flex-col gap-1 font-mono text-[13px]">
            <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{bicho.config.nome}</span>
            <span className="text-muted" data-testid="u-bicho-estagio">
              {ESPECIE_DEFS[bicho.config.especie].nome} · {ESTAGIO_NOME[bicho.estagio]}
            </span>
            {bicho.semanas.total >= 2 && (
              <span className="text-muted" data-testid="u-bicho-semanas">
                constrói há {bicho.semanas.total} semanas
              </span>
            )}
            {bicho.itens.length > 0 && (
              <span className="text-muted" data-testid="u-bicho-itens">
                {bicho.itens.map((id) => nomeItem(id)).join(", ")}
              </span>
            )}
            {own && (
              <Link href="/perfil/bicho" className="mt-1 text-accent underline-offset-4 hover:underline" data-testid="u-bicho-editar">
                trocar o visual →
              </Link>
            )}
          </figcaption>
        </figure>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm text-muted">@{member.username}</p>
          <span className="border border-line bg-surface px-1.5 font-mono text-[12px] text-foreground">LV{level.n}</span>
          {(member.personas.length ? member.personas : member.persona ? [member.persona] : []).map((k) => (
            <span key={k} className="border border-line bg-mint px-1.5 font-mono text-[12px] text-accent">
              {personaLabel(k) ?? k}
            </span>
          ))}
        </div>
        {(member.city || member.institution) && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12px] text-muted" data-testid="profile-place">
            {member.city && <span>{member.city}</span>}
            {member.institution && <span>{member.institution}</span>}
          </p>
        )}
        {member.headline && <p className="font-mono text-sm text-foreground">{member.headline}</p>}
        {member.bio && <p className="max-w-xl text-muted">{member.bio}</p>}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {links.map(([label, href]) => (
            <a key={label} href={href} target="_blank" rel="noopener nofollow" className="font-mono text-xs text-accent hover:underline">
              {label} →
            </a>
          ))}
        </div>
        {counts && (
          <p className="flex flex-wrap items-center gap-x-2 font-mono text-[13px] text-muted" data-testid="own-follow-counts">
            <Link href="/perfil/seguidores" className="text-foreground underline-offset-4 hover:text-accent hover:underline">
              {counts.seguidores} {counts.seguidores === 1 ? "seguidor" : "seguidores"}
            </Link>
            <span aria-hidden>·</span>
            <Link href="/perfil/seguindo" className="text-foreground underline-offset-4 hover:text-accent hover:underline">
              {counts.seguindo} seguindo
            </Link>
            <span className="basis-full text-[12px]">só você vê esses números</span>
          </p>
        )}
        {relation && !relation.blocked && (
          <div className="flex flex-col gap-2 border-y border-line py-3" data-testid="profile-follow">
            <div className="flex flex-wrap items-center gap-3">
              <FollowButton username={member.username} following={iFollow} />
              {dmEntry && <DmStart username={member.username} entry={dmEntry} />}
              {followsViewer && (
                <span className="tag" data-testid="follows-you">
                  segue você
                </span>
              )}
            </div>
            {teamLine && (
              <p className="font-mono text-[13px] text-foreground" data-testid="same-team">
                {teamLine}
              </p>
            )}
          </div>
        )}
        {relation?.blocked && (
          <p className="border-[1.5px] border-orange px-3 py-2 font-mono text-[12.5px] text-orange" data-testid="profile-blocked-note">
            Você bloqueou @{member.username}. Vocês não se veem no HackaHub.
          </p>
        )}
        {relation && (
          <ProfileSafetyMenu username={member.username} memberId={member.id} blocked={relation.blocked} muted={relation.muted} />
        )}
        <ShareBar
          url={absoluteUrl(`/u/${member.username}`)}
          text={`${member.name ?? `@${member.username}`} no HackaHub — hackathons, projetos e certificados`}
          label="compartilhar perfil"
        />
      </div>

      <NumbersStrip username={member.username} numbers={numbers} />
      <CommunityBadges memberId={member.id} />
      <HelpChips member={member} />
      <Pins pins={pins.projects.map(toPinCard)} />

      <section aria-labelledby="recados-title" className="flex flex-col gap-3" data-testid="recados">
        <h2 id="recados-title" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
          recados
        </h2>
        {canWrite.ok ? (
          <RecadoComposer username={member.username} />
        ) : own ? null : (
          <p className="font-mono text-[12px] text-muted" data-testid="recados-fechados">
            {recadoClosedText(canWrite.reason)}
          </p>
        )}
        {recados.length === 0 ? (
          <p className="border-[1.5px] border-dashed border-line px-4 py-6 font-mono text-[13px] text-muted" data-testid="recado-empty">
            {own ? recadoEmptyOwner(member) : "Deixe o primeiro recado."}
          </p>
        ) : (
          <ul className="flex flex-col gap-5">
            {recados.map((p) => (
              <li key={p.id} className="min-w-0">
                <PostCard post={p} me={me} />
              </li>
            ))}
          </ul>
        )}
        {recadosMore && (
          <Link
            href={`/u/${member.username}?recados=todos`}
            className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline"
            data-testid="recados-ver-mais"
          >
            ver mais recados →
          </Link>
        )}
      </section>

      <TestimonialList memberId={member.id} me={viewer ? { id: viewer.id } : null} />

      <div className="flex flex-col gap-4">
        <nav aria-label="abas do perfil" className="flex flex-wrap gap-2" data-testid="profile-tabs">
          {TABS.map(({ key, label }) => (
            <Link
              key={key}
              href={`/u/${member.username}?aba=${key}`}
              aria-current={tab === key ? "page" : undefined}
              data-testid={`tab-${key}`}
              className={`flex min-h-[44px] items-center border-[1.5px] border-line px-3.5 font-mono text-[13px] transition ${
                tab === key ? "bg-foreground text-band" : "text-foreground hover:bg-mint"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {tab === "atividade" && (
          <div className="flex flex-col gap-5" data-testid="tab-panel-atividade">
            {activity.length === 0 ? (
              <p className="border-[1.5px] border-dashed border-line px-4 py-6 font-mono text-[13px] text-muted">
                {own ? "Você ainda não publicou nada. O primeiro post sai no /feed." : "Nada publicado ainda."}
              </p>
            ) : (
              <ul className="flex flex-col gap-6">
                {activity.map((p) => (
                  <li key={p.id} className="min-w-0">
                    <PostCard post={p} me={me} />
                  </li>
                ))}
              </ul>
            )}
            {activityMore && (
              <Link
                href={`/u/${member.username}?aba=atividade&antes=${activityMore}`}
                className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline"
                data-testid="atividade-ver-mais"
              >
                ver mais →
              </Link>
            )}
          </div>
        )}
        {tab === "projetos" && <Projects projects={projects} />}
        {tab === "trajetoria" && <Trajectory arc={arc} />}
        {tab === "colecao" && <Collection memberId={member.id} />}
      </div>

      <div className="border border-line bg-surface p-4">
        <XpBar xp={xp.total} facts={xp.facts} own={own} />
      </div>

      {member.skills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {member.skills.map((s) => (
            <span key={s} className="border-[1.5px] border-line px-2 py-0.5 font-mono text-[12px] text-muted">
              {s}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** card do fixado: /p quando o time enviou projeto, senão a edição */
function toPinCard(p: {
  teamId: number;
  teamName: string;
  hackathonName: string;
  hackathonId: string;
  placement: number;
  project: { title: string } | null;
}): PinCard {
  return {
    teamId: p.teamId,
    title: p.project?.title ?? p.teamName,
    teamName: p.teamName,
    hackathonName: p.hackathonName,
    hackathonId: p.hackathonId,
    placement: p.placement,
    href: p.project ? `/p/${p.teamId}` : `/h/${p.hackathonId}`,
  };
}

/** vazio dos recados pro dono: diz quem pode escrever, sem contador */
function recadoEmptyOwner(member: Member): string {
  if (member.recadosFrom === "ninguem") return "Os recados estão desligados. Dá pra ligar em /perfil.";
  if (member.recadosFrom === "todos") return "Qualquer pessoa do HackaHub pode deixar recado aqui.";
  return "Quem fez time com você pode deixar recado aqui.";
}
