import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import QRCode from "qrcode";
import { EncountersClient } from "@/components/EncountersClient";
import { MascoteViewer } from "@/components/MascoteViewer";
import { encountersOn, meetState, type MeetState } from "@/lib/encounters";
import { CONTACT_CHANNELS, CONTACT_CHANNEL_LABEL, type ContactChannel } from "@/lib/encounters";
import { getHackathon } from "@/lib/hackathons";
import { bichoDoMembro } from "@/lib/mascote/evolucao";
import { getMemberByClerkId } from "@/lib/members";
import { absoluteUrl } from "@/lib/seo";

// Encontros na edição (spec 046, onda 5). Opcional e leve: o organizador
// liga, quem fez check-in aceita, lê o código de alguém e os dois confirmam.
// O QR aponta pra esta mesma tela com ?c=CODIGO — ler com a câmera do celular
// já abre o encontro. Sem JS no servidor: o QR e o bicho saem prontos.

export const metadata: Metadata = {
  title: "encontros",
  robots: { index: false },
};

const CHANNEL_VALUE_LABEL: Record<ContactChannel, string> = {
  linkedin: "seu LinkedIn do perfil",
  github: "seu GitHub do perfil",
  email: "o e-mail da sua conta",
};

export default async function EncontrosPage({ params, searchParams }: PageProps<"/h/[id]/encontros">) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) notFound();

  const enabled = await encountersOn(id);
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: `/h/${id}/encontros` });
  const member = await getMemberByClerkId(userId);
  if (!member) notFound();

  const sp = (await searchParams) as { c?: string | string[] };
  const code = typeof sp.c === "string" ? sp.c : null;

  if (!enabled) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <Link href={`/h/${h.id}`} className="font-mono text-[13px] text-muted underline-offset-4 hover:underline">
          ← {h.name}
        </Link>
        <h1 className="text-[clamp(1.8rem,7vw,2.4rem)] leading-[0.95] font-extrabold tracking-[-0.035em]">
          Encontros
        </h1>
        <p className="max-w-prose text-[15px]" data-testid="encontros-off">
          Os encontros não estão ligados nesta edição. Quem organiza liga no painel da edição.
        </p>
      </div>
    );
  }

  const [state, bicho] = await Promise.all([
    meetState({ id: member.id, username: member.username }, id),
    bichoDoMembro(member.id),
  ]);
  const qrSvg =
    state.me && !state.me.paused
      ? await QRCode.toString(absoluteUrl(`/h/${h.id}/encontros?c=${state.me.code}`), {
          type: "svg",
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#0c0c0c", light: "#fefefe" },
        })
      : null;

  const initialState: MeetState = state;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <Link href={`/h/${h.id}`} className="font-mono text-[13px] text-muted underline-offset-4 hover:underline">
          ← {h.name}
        </Link>
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">encontros na edição</p>
        <h1 className="text-[clamp(1.8rem,7vw,2.4rem)] leading-[0.95] font-extrabold tracking-[-0.035em]">
          Encontros
        </h1>
        <p className="max-w-prose text-[15px] text-muted">
          Você lê o código do bicho de alguém, a pessoa confirma, e o contato aparece pros dois. Um encontro por
          pessoa por edição, sem ranking.
        </p>
      </div>

      {/* meu código: o QR abre esta tela com ?c=, então ler com a câmera já vale */}
      {state.me && !state.me.paused && qrSvg ? (
        <section
          className="flex flex-col gap-4 border-[1.5px] border-line p-4 sm:flex-row sm:items-start"
          data-testid="encontros-meu-codigo"
        >
          <div className="mx-auto w-[132px] shrink-0 border-2 border-line bg-background">
            <MascoteViewer config={bicho.config} itens={bicho.pecas} estagio={bicho.estagio} tamanho={128} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="font-mono text-[12px] tracking-widest text-muted uppercase">seu código</p>
            <p className="pix text-[40px] leading-none tracking-[0.14em]" data-testid="encontros-codigo">
              {state.me.code}
            </p>
            <div
              role="img"
              aria-label="QR do seu código de encontro"
              className="w-[148px] border border-line bg-background p-1 [&_svg]:h-auto [&_svg]:w-full"
              data-testid="encontros-qr"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="max-w-prose text-[13.5px] text-muted">
              Quem lê este código pede um encontro com você. Depois de confirmado, a outra pessoa vê{" "}
              {CHANNEL_VALUE_LABEL[state.me.channel]} — só isso, nada mais do seu perfil.
            </p>
          </div>
        </section>
      ) : (
        <section className="border-[1.5px] border-line p-4" data-testid="encontros-sem-codigo">
          <p className="text-[15px]">
            {state.me?.paused
              ? "Seu código está pausado: ninguém consegue ler ele agora. Volte quando quiser."
              : "Ative os encontros abaixo pra ter seu código e seu QR."}
          </p>
        </section>
      )}

      <EncountersClient
        hackathonId={h.id}
        editionName={h.name}
        initialState={initialState}
        channels={CONTACT_CHANNELS.map((key) => ({ key, label: CONTACT_CHANNEL_LABEL[key] }))}
        initialCode={code}
      />
    </div>
  );
}
