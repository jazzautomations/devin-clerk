import type { EditionPhase } from "@/lib/arena";
import type { RegistrationStatus } from "@/lib/registrations";
import type { EntryStatus } from "@/lib/entries";
import { KIND_LABEL, type ApplicationKind, type ApplicationStatus } from "@/lib/applicationKinds";

// spec 039 — "seu próximo passo": UM passo por pessoa por edição, decidido
// só a partir de fatos já carregados (sem banco aqui; quem junta é
// lib/nextStepFacts). A mesma resposta aparece no topo de /h/[id] e no
// card da edição no /dashboard. Módulo puro: testável e seguro pra client.

export const JOURNEY = [
  { key: "inscricao", label: "inscrição" },
  { key: "presenca", label: "presença" },
  { key: "checkin", label: "check-in" },
  { key: "entrega", label: "entrega" },
  { key: "resultado", label: "resultado" },
  { key: "certificado", label: "certificado" },
] as const;

export type JourneyStage = (typeof JOURNEY)[number]["key"];

export const stageIndex = (s: JourneyStage) => JOURNEY.findIndex((j) => j.key === s);

export type NextStepFacts = {
  hackathonId: string;
  phase: EditionPhase;
  /** roda no HackaHub (inscrição pela plataforma); false = evento do radar */
  hosted: boolean;
  registrationUrl: string;
  registrationClosed: boolean;
  requiresApproval: boolean;
  /** sem vaga (capacidade cheia, edição sem curadoria) */
  full: boolean;
  signedIn: boolean;
  status: RegistrationStatus | null;
  waitlistPosition: number | null;
  /** candidatura ativa pra ajudar (pendente/aprovada) */
  helping: { kind: ApplicationKind; status: ApplicationStatus } | null;
  /** convite de RSVP esperando resposta */
  rsvp: { href: string; deadline: string } | null;
  rsvpConfirmed: boolean;
  checkedIn: boolean;
  hasTeam: boolean;
  /** fluxo de entrega da edição (null = edição sem prazo de entrega) */
  submission: { open: boolean; deadline: string | null } | null;
  entry: { status: EntryStatus } | null;
  /** final no palco com voto aberto */
  stageLive: boolean;
  /** pesquisa pós-evento aberta e ainda sem resposta minha */
  npsPending: boolean;
  certificateCode: string | null;
};

export type NextStepKey =
  | "externo"
  | "externo-fechado"
  | "encerrada"
  | "fechada"
  | "inscrever"
  | "pedir-lugar"
  | "fila-entrar"
  | "ajudando"
  | "aguardando"
  | "fila"
  | "recusada"
  | "confirmar"
  | "votar"
  | "ingresso"
  | "time"
  | "entregar"
  | "entregue"
  | "sem-entrega"
  | "no-evento"
  | "confirmada"
  | "nps"
  | "certificado"
  | "participou";

export type NextStep = {
  key: NextStepKey;
  stage: JourneyStage;
  /** a etapa atual já está resolvida (ex.: entrega enviada) */
  stageDone: boolean;
  /** a pessoa faz parte da edição (inscrita, na fila, pendente) */
  involved: boolean;
  status: string;
  detail: string | null;
  action: { label: string; href: string; external?: boolean } | null;
};

const APP_STATUS: Record<ApplicationStatus, string> = {
  pending: "em análise",
  approved: "aprovada",
  rejected: "não aprovada",
};

export function nextStep(f: NextStepFacts): NextStep {
  const base = `/h/${f.hackathonId}`;
  const over = f.phase === "ended" || f.phase === "archived";
  const step = (
    key: NextStepKey,
    stage: JourneyStage,
    status: string,
    action: NextStep["action"],
    detail: string | null = null,
    extra: Partial<Pick<NextStep, "stageDone" | "involved">> = {},
  ): NextStep => ({
    key,
    stage,
    status,
    detail,
    action,
    stageDone: extra.stageDone ?? false,
    involved: extra.involved ?? f.status !== null,
  });

  // evento do radar: a inscrição é no site de quem organiza
  if (!f.hosted) {
    if (over) return step("encerrada", "resultado", "Edição encerrada", null, null, { involved: false });
    if (f.registrationClosed) {
      return step("externo-fechado", "inscricao", "Inscrições encerradas", null, null, { involved: false });
    }
    return step(
      "externo",
      "inscricao",
      "Inscrição no site oficial",
      { label: "inscrever no site oficial", href: f.registrationUrl, external: true },
      "evento do radar: a organização é de outra comunidade",
      { involved: false },
    );
  }

  if (over) {
    const participated = f.status === "approved";
    if (f.certificateCode) {
      return step(
        "certificado",
        "certificado",
        "Certificado emitido",
        { label: "baixar certificado", href: `/c/${f.certificateCode}` },
        "link verificável, com carga horária quando a edição define",
        { stageDone: true, involved: true },
      );
    }
    if (participated && f.npsPending) {
      return step(
        "nps",
        "resultado",
        "Conta como foi a edição",
        { label: "responder pesquisa", href: `${base}/nps` },
        "a organização usa as respostas na próxima edição",
      );
    }
    if (participated) {
      return step(
        "participou",
        "resultado",
        "Edição encerrada",
        { label: "ver resultado", href: `${base}#resultado` },
        "seu time, a carta e a trajetória ficam no seu perfil",
      );
    }
    return step("encerrada", "resultado", "Edição encerrada", { label: "ver resultado", href: `${base}#resultado` }, null, {
      involved: false,
    });
  }

  // quem se candidatou pra ajudar não compete na mesma edição
  if (f.helping && f.status === null) {
    return step(
      "ajudando",
      "inscricao",
      `Candidatura de ${KIND_LABEL[f.helping.kind]} ${APP_STATUS[f.helping.status]}`,
      { label: "ver candidatura", href: `${base}/candidatura/${f.helping.kind}` },
      "quem ajuda não se inscreve como participante na mesma edição",
      { involved: true },
    );
  }

  const form = `${base}/inscricao`;
  switch (f.status) {
    case null: {
      if (f.registrationClosed) {
        return step(
          "fechada",
          "inscricao",
          "Inscrições encerradas",
          { label: "ver hackathons abertos", href: "/radar" },
          "dá pra acompanhar pelo mural da edição",
        );
      }
      const login = f.signedIn ? null : "o formulário pede login; o perfil vale pra todas as edições";
      if (f.requiresApproval) {
        return step(
          "pedir-lugar",
          "inscricao",
          "Edição com curadoria",
          { label: "pedir lugar", href: form },
          login ?? "a organização revisa cada pedido e responde por aqui",
        );
      }
      if (f.full) {
        return step(
          "fila-entrar",
          "inscricao",
          "Vagas esgotadas",
          { label: "entrar na fila de espera", href: form },
          login ?? "se abrir vaga, a inscrição confirma sozinha, por ordem de chegada",
        );
      }
      return step("inscrever", "inscricao", "Inscrições abertas", { label: "fazer inscrição", href: form }, login ?? "formulário curto da edição");
    }
    case "pending":
      return step("aguardando", "inscricao", "Pedido em análise", null, "a resposta da curadoria aparece aqui na página");
    case "waitlist":
      return step(
        "fila",
        "inscricao",
        f.waitlistPosition ? `Na fila de espera · posição ${f.waitlistPosition}` : "Na fila de espera",
        null,
        "se abrir vaga, sua inscrição confirma sozinha e você recebe aviso",
      );
    case "rejected":
      return step(
        "recusada",
        "inscricao",
        "Não rolou dessa vez",
        { label: "ver hackathons abertos", href: "/radar" },
        "a curadoria não aprovou o pedido desta edição",
      );
  }

  // aprovado daqui pra baixo
  if (f.rsvp) {
    return step(
      "confirmar",
      "presenca",
      `Confirme sua presença até ${f.rsvp.deadline}`,
      { label: "confirmar presença", href: f.rsvp.href },
      "sem confirmação a vaga vai pra fila de espera",
    );
  }
  if (f.stageLive && f.checkedIn) {
    return step("votar", "resultado", "Final ao vivo", { label: "votar nos pitches", href: `${base}/votar` }, "nota de 1 a 5 em cada pitch, do celular");
  }
  const onSite = f.phase === "ongoing";
  if (onSite && !f.checkedIn) {
    return step(
      "ingresso",
      "checkin",
      "Mostra o QR na entrada",
      { label: "abrir meu ingresso", href: `${base}/ingresso` },
      "deixa o QR aberto no celular antes de chegar",
    );
  }
  if (f.submission) {
    const deadline = f.submission.deadline ? ` até ${f.submission.deadline}` : "";
    if (f.entry?.status === "enviado") {
      return step(
        "entregue",
        "entrega",
        "Entrega enviada",
        { label: "ver entrega", href: `${base}/entrega` },
        f.submission.open ? `dá pra editar e reenviar${deadline}` : null,
        { stageDone: true },
      );
    }
    if (f.entry?.status === "travado") {
      return step("entregue", "entrega", "Entrega travada pra avaliação", { label: "ver entrega", href: `${base}/entrega` }, null, {
        stageDone: true,
      });
    }
    if (f.entry?.status === "nao_entregue") {
      return step("sem-entrega", "entrega", "Prazo de entrega encerrado", { label: "ver entrega", href: `${base}/entrega` }, "o time não enviou a entrega");
    }
    if (f.submission.open && !f.hasTeam) {
      return step("time", "entrega", "Monte seu time", { label: "montar time", href: `${base}#meu-time` }, `a entrega é por time${deadline}`);
    }
    if (f.submission.open && f.entry) {
      return step("entregar", "entrega", `Entrega${deadline}`, { label: "abrir entrega", href: `${base}/entrega` }, "rascunho salva sozinho; vale o que for enviado");
    }
  }
  if (onSite) {
    if (!f.hasTeam) {
      return step("time", "entrega", "Monte seu time", { label: "montar time", href: `${base}#meu-time` }, "quem está sem time se marca no quadro e o time acha você");
    }
    return step("no-evento", "entrega", "Check-in feito", { label: "ver programação", href: `${base}/programacao` }, "bom evento");
  }
  return step(
    "confirmada",
    "checkin",
    f.rsvpConfirmed ? "Presença confirmada" : "Inscrição confirmada",
    { label: "ver meu ingresso", href: `${base}/ingresso` },
    f.hasTeam ? "no dia, mostra o QR na entrada" : "no dia, mostra o QR na entrada; time dá pra montar aqui antes",
  );
}
