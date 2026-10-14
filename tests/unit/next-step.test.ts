import { describe, expect, it } from "vitest";
import { JOURNEY, nextStep, stageIndex, type NextStepFacts } from "@/lib/nextStep";

// spec 039 — o próximo passo da pessoa numa edição: um caso por estado da
// tabela da spec. Fatos mínimos = anon numa edição Hack Inova aberta.
const H = "hack-teste";
const base: NextStepFacts = {
  hackathonId: H,
  phase: "open",
  partner: true,
  registrationUrl: "https://exemplo.dev/inscricao",
  registrationClosed: false,
  requiresApproval: false,
  full: false,
  signedIn: false,
  status: null,
  waitlistPosition: null,
  helping: null,
  rsvp: null,
  rsvpConfirmed: false,
  checkedIn: false,
  hasTeam: false,
  submission: null,
  entry: null,
  stageLive: false,
  npsPending: false,
  certificateCode: null,
};
const f = (over: Partial<NextStepFacts>): NextStepFacts => ({ ...base, ...over });
const approved = (over: Partial<NextStepFacts> = {}) => f({ signedIn: true, status: "approved", ...over });

describe("nextStep — evento do radar", () => {
  it("aberto: inscrição externa", () => {
    const s = nextStep(f({ partner: false }));
    expect(s.key).toBe("externo");
    expect(s.action).toEqual({ label: "inscrever no site oficial", href: "https://exemplo.dev/inscricao", external: true });
    expect(s.involved).toBe(false);
  });
  it("inscrição fechada: sem ação", () => {
    const s = nextStep(f({ partner: false, registrationClosed: true }));
    expect(s.key).toBe("externo-fechado");
    expect(s.action).toBeNull();
  });
  it("encerrado", () => {
    expect(nextStep(f({ partner: false, phase: "ended" })).key).toBe("encerrada");
  });
});

describe("nextStep — sem inscrição", () => {
  it("anon numa edição aberta vai pro formulário e é avisado do login", () => {
    const s = nextStep(base);
    expect(s.key).toBe("inscrever");
    expect(s.stage).toBe("inscricao");
    expect(s.action).toEqual({ label: "fazer inscrição", href: `/h/${H}/inscricao` });
    expect(s.detail).toMatch(/login/);
    expect(s.involved).toBe(false);
  });
  it("logado não recebe o aviso de login", () => {
    expect(nextStep(f({ signedIn: true })).detail).not.toMatch(/login/);
  });
  it("edição curada pede lugar", () => {
    const s = nextStep(f({ requiresApproval: true }));
    expect(s.key).toBe("pedir-lugar");
    expect(s.action?.label).toBe("pedir lugar");
  });
  it("edição cheia oferece a fila", () => {
    const s = nextStep(f({ full: true, signedIn: true }));
    expect(s.key).toBe("fila-entrar");
    expect(s.action).toEqual({ label: "entrar na fila de espera", href: `/h/${H}/inscricao` });
  });
  it("inscrição fechada aponta pro radar", () => {
    const s = nextStep(f({ registrationClosed: true }));
    expect(s.key).toBe("fechada");
    expect(s.action?.href).toBe("/radar");
  });
  it("candidato a mentor não vê inscrição de participante", () => {
    const s = nextStep(f({ signedIn: true, helping: { kind: "mentor", status: "pending" } }));
    expect(s.key).toBe("ajudando");
    expect(s.status).toBe("Candidatura de mentor em análise");
    expect(s.action?.href).toBe(`/h/${H}/candidatura/mentor`);
    expect(s.involved).toBe(true);
  });
});

describe("nextStep — inscrição em andamento", () => {
  it("pendente aguarda a curadoria, sem ação", () => {
    const s = nextStep(f({ signedIn: true, status: "pending" }));
    expect(s.key).toBe("aguardando");
    expect(s.action).toBeNull();
    expect(s.involved).toBe(true);
    // e-mail pode estar desligado (auditoria 041): a tela não promete canal
    expect(s.detail).toBe("a resposta da curadoria aparece aqui na página");
    expect(s.detail).not.toMatch(/e-mail/);
  });
  it("fila mostra a posição", () => {
    const s = nextStep(f({ signedIn: true, status: "waitlist", waitlistPosition: 3 }));
    expect(s.key).toBe("fila");
    expect(s.status).toBe("Na fila de espera · posição 3");
  });
  it("fila sem posição conhecida", () => {
    expect(nextStep(f({ signedIn: true, status: "waitlist" })).status).toBe("Na fila de espera");
  });
  it("recusado", () => {
    const s = nextStep(f({ signedIn: true, status: "rejected" }));
    expect(s.key).toBe("recusada");
    expect(s.action?.href).toBe("/radar");
  });
});

describe("nextStep — aprovado, antes e durante o evento", () => {
  it("RSVP pendente vem antes de tudo", () => {
    const s = nextStep(approved({ rsvp: { href: "/rsvp/tok", deadline: "07/11 18:00" }, phase: "live" }));
    expect(s.key).toBe("confirmar");
    expect(s.stage).toBe("presenca");
    expect(s.status).toBe("Confirme sua presença até 07/11 18:00");
    expect(s.action?.href).toBe("/rsvp/tok");
  });
  it("antes do evento: ingresso; presença confirmada aparece no status", () => {
    const s = nextStep(approved({ rsvpConfirmed: true, hasTeam: true }));
    expect(s.key).toBe("confirmada");
    expect(s.status).toBe("Presença confirmada");
    expect(s.action?.href).toBe(`/h/${H}/ingresso`);
    expect(s.stage).toBe("checkin");
  });
  it("antes do evento sem RSVP configurado", () => {
    expect(nextStep(approved()).status).toBe("Inscrição confirmada");
  });
  it("evento rolando sem check-in: QR", () => {
    const s = nextStep(approved({ phase: "ongoing" }));
    expect(s.key).toBe("ingresso");
    expect(s.stage).toBe("checkin");
  });
  it("final ao vivo com check-in: votar", () => {
    const s = nextStep(approved({ phase: "ongoing", checkedIn: true, stageLive: true }));
    expect(s.key).toBe("votar");
    expect(s.action?.href).toBe(`/h/${H}/votar`);
  });
  it("final ao vivo sem check-in não oferece voto", () => {
    expect(nextStep(approved({ phase: "ongoing", stageLive: true })).key).toBe("ingresso");
  });
  it("entrega aberta sem time: montar time", () => {
    const s = nextStep(approved({ phase: "ongoing", checkedIn: true, submission: { open: true, deadline: "15/11 14:00" } }));
    expect(s.key).toBe("time");
    expect(s.action?.href).toBe(`/h/${H}#meu-time`);
  });
  it("entrega aberta com rascunho: entregar com prazo", () => {
    const s = nextStep(
      approved({
        phase: "ongoing",
        checkedIn: true,
        hasTeam: true,
        submission: { open: true, deadline: "15/11 14:00" },
        entry: { status: "rascunho" },
      }),
    );
    expect(s.key).toBe("entregar");
    expect(s.status).toBe("Entrega até 15/11 14:00");
    expect(s.action?.href).toBe(`/h/${H}/entrega`);
  });
  it("entrega enviada fica marcada como feita", () => {
    const s = nextStep(
      approved({ phase: "ongoing", checkedIn: true, hasTeam: true, submission: { open: true, deadline: null }, entry: { status: "enviado" } }),
    );
    expect(s.key).toBe("entregue");
    expect(s.stageDone).toBe(true);
  });
  it("entrega travada", () => {
    const s = nextStep(
      approved({ phase: "ongoing", checkedIn: true, hasTeam: true, submission: { open: false, deadline: null }, entry: { status: "travado" } }),
    );
    expect(s.key).toBe("entregue");
    expect(s.status).toMatch(/travada/);
  });
  it("prazo passou sem envio", () => {
    const s = nextStep(
      approved({ phase: "ongoing", checkedIn: true, hasTeam: true, submission: { open: false, deadline: null }, entry: { status: "nao_entregue" } }),
    );
    expect(s.key).toBe("sem-entrega");
  });
  it("no evento, com check-in e time, sem fluxo de entrega: programação", () => {
    const s = nextStep(approved({ phase: "ongoing", checkedIn: true, hasTeam: true }));
    expect(s.key).toBe("no-evento");
    expect(s.action?.href).toBe(`/h/${H}/programacao`);
  });
  it("no evento, com check-in, sem time e sem fluxo de entrega: montar time", () => {
    expect(nextStep(approved({ phase: "ongoing", checkedIn: true })).key).toBe("time");
  });
});

describe("nextStep — depois da edição", () => {
  it("certificado emitido ganha de tudo", () => {
    const s = nextStep(approved({ phase: "ended", certificateCode: "ABC123", npsPending: true }));
    expect(s.key).toBe("certificado");
    expect(s.action?.href).toBe("/c/ABC123");
    expect(s.stage).toBe("certificado");
    expect(s.stageDone).toBe(true);
  });
  it("NPS pendente antes do resultado", () => {
    const s = nextStep(approved({ phase: "ended", npsPending: true }));
    expect(s.key).toBe("nps");
    expect(s.action?.href).toBe(`/h/${H}/nps`);
  });
  it("participou, sem certificado nem NPS: resultado", () => {
    const s = nextStep(approved({ phase: "archived" }));
    expect(s.key).toBe("participou");
    expect(s.action?.href).toBe(`/h/${H}#resultado`);
  });
  it("não participou: edição encerrada", () => {
    const s = nextStep(f({ phase: "ended" }));
    expect(s.key).toBe("encerrada");
    expect(s.involved).toBe(false);
  });
  it("certificado de mentor (sem inscrição de participante) também aparece", () => {
    expect(nextStep(f({ phase: "ended", signedIn: true, certificateCode: "MEN001" })).key).toBe("certificado");
  });
});

describe("trilho", () => {
  it("etapas na ordem da jornada", () => {
    expect(JOURNEY.map((j) => j.key)).toEqual(["inscricao", "presenca", "checkin", "entrega", "resultado", "certificado"]);
    expect(stageIndex("entrega")).toBe(3);
  });
});
