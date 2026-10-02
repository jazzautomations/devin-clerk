import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import {
  getRegistrationIds,
  getRegistrationsByHackathon,
} from "@/lib/registrations";
import { RegisterButton } from "@/components/RegisterButton";
import { CollectibleCard } from "@/components/CollectibleCard";
import { getCardRarity, getCardSupply, getMemberCard } from "@/lib/xp";

const FORMAT_LABEL: Record<string, string> = {
  online: "online",
  presencial: "presencial",
  hibrido: "híbrido",
};

export default async function HackathonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) notFound();

  const now = new Date();
  const past = new Date(h.startsAt) <= now;
  const closed =
    h.registrationDeadline !== null &&
    new Date(h.registrationDeadline) < now;

  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  const registered =
    member !== null && getRegistrationIds(member.id).includes(h.id);
  const attendees = getRegistrationsByHackathon(h.id);
  const cardRarity = getCardRarity(h.id);
  const cardSupply = getCardSupply(h.id);
  const myCard = member ? getMemberCard(member.id, h.id) : null;

  const fmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {past ? "// arquivo" : "// hackathon"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          {h.name}
        </h1>
        <p className="font-mono text-sm text-muted">{h.organizer}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-y border-line py-6 font-mono text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">data</dt>
          <dd className="mt-1">{fmt.format(new Date(h.startsAt))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">formato</dt>
          <dd className="mt-1">{FORMAT_LABEL[h.format]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">local</dt>
          <dd className="mt-1">{h.location ?? "Online"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">inscrições</dt>
          <dd className={`mt-1 ${closed && !past ? "text-muted" : "text-accent"}`}>
            {past
              ? "edição encerrada"
              : closed
                ? "encerradas"
                : h.registrationDeadline
                  ? `até ${fmt.format(new Date(h.registrationDeadline))}`
                  : "abertas"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {h.tags.map((t) => (
          <span
            key={t}
            className="border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
          >
            #{t}
          </span>
        ))}
      </div>

      {!past && !closed && h.partner && (
        <div className="flex flex-col gap-3 border border-line bg-surface p-6">
          <RegisterButton hackathonId={h.id} registered={registered} />
          {!member && (
            <p className="font-mono text-xs text-muted">
              {"// vai pedir login — é o cadastro único do hackahub, não um Google Form"}
            </p>
          )}
        </div>
      )}

      {!past && !h.partner && (
        <a
          href={h.registrationUrl}
          target="_blank"
          rel="noopener"
          className="w-fit border border-line px-6 py-3 font-mono text-sm transition hover:border-accent/50 hover:text-accent"
        >
          inscrever no site oficial →
        </a>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          cartinha colecionável desta edição
        </h2>
        <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
          <CollectibleCard
            hackathonId={h.id}
            name={h.name}
            startsAt={h.startsAt}
            location={h.location}
            rarity={cardRarity}
            serial={myCard?.serial}
            supply={myCard === null ? cardSupply : undefined}
          />
          <div className="flex flex-col justify-center gap-2 border border-line bg-surface p-5 font-mono text-xs text-muted">
            <p>
              {myCard
                ? `// tu tens a № ${String(myCard.serial).padStart(3, "0")} — prova de presença na tua coleção`
                : past
                  ? "// edição encerrada — a tiragem desta carta fechou"
                  : "// inscreve-te pra mintar a tua — serial na ordem de chegada"}
            </p>
            <p className="text-foreground">
              {cardSupply} {cardSupply === 1 ? "mintada" : "mintadas"} até agora
            </p>
          </div>
        </div>
      </div>

      {attendees.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
            inscritos ({attendees.length})
          </h2>
          <ul className="divide-y divide-line border-y border-line font-mono text-xs">
            {attendees.map((a) => (
              <li key={a.username} className="flex justify-between py-2">
                <span>@{a.username}</span>
                <span className="text-muted">
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "short",
                  }).format(new Date(a.createdAt + "Z"))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
