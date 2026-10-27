import type { Metadata } from "next";
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { RadarFeed } from "@/components/RadarFeed";
import { SubmitEventForm } from "@/components/SubmitEventForm";
import { getOpenHackathons, searchHackathons } from "@/lib/hackathons";
import { getOrCreateMember } from "@/lib/members";
import { getRegistrationIds } from "@/lib/registrations";

export const metadata: Metadata = {
  title: "radar",
  description:
    "Hackathons abertos no Brasil e no mundo: formato, alcance, prazo, prêmio e se brasileiro pode participar.",
  alternates: { canonical: "/radar" },
};

export default async function RadarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { userId } = await auth();
  let registeredIds: string[] = [];
  if (userId) {
    const user = await currentUser();
    const member = await getOrCreateMember({
      id: userId,
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? "",
      imageUrl: user?.imageUrl ?? null,
    });
    registeredIds = await getRegistrationIds(member.id);
  }

  const { q: rawQ } = await searchParams;
  const q = rawQ?.trim() ?? "";
  const now = new Date();
  const hackathons = q
    ? await searchHackathons(q, now)
    : await getOpenHackathons(now);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"radar"}
        </p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          Hackathons abertos
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Primeiro o que rola no Brasil, por estado. Depois o que dá pra
          fazer online de qualquer lugar, com a regra de quem pode entrar. A
          lista é atualizada duas vezes por dia.
        </p>
        <form action="/radar" className="mt-1 flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="buscar por nome, cidade, marca ou tema…"
            aria-label="buscar no radar"
            className="w-full max-w-md border-[1.5px] border-line bg-surface px-4 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            className="border-[1.5px] border-line px-4 py-2.5 font-mono text-sm text-muted transition hover:border-accent hover:text-accent"
          >
            buscar
          </button>
        </form>
      </div>

      {q && hackathons.length === 0 && (
        <p className="border-[1.5px] border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {`nada no radar pra "${q}". Tente outro termo.`}
        </p>
      )}

      {!(q && hackathons.length === 0) && (
        <RadarFeed
          hackathons={hackathons}
          now={now.toISOString()}
          registeredIds={registeredIds}
        />
      )}

      {/* terceiro canal do radar (spec 026): a comunidade indica, a
          curadoria decide — nada entra direto na listagem */}
      <details className="group border-[1.5px] border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            {"indique um hackathon"}
          </span>
          <span className="font-mono text-xs text-muted">
            <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span>
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line/50 px-5 py-5">
          <p className="max-w-xl text-sm text-muted">
            Viu um hackathon que não está no radar? Mande o link. A
            curadoria revisa antes de publicar.
          </p>
          {userId ? (
            <SubmitEventForm />
          ) : (
            <Link href="/sign-up?redirect_url=%2Fradar" className="cta-link go self-start text-sm">
              Entre pra indicar
            </Link>
          )}
        </div>
      </details>
    </section>
  );
}
