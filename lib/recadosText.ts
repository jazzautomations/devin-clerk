// Regras de texto do recado no perfil (spec 046, perfil-rico; estudo 044
// §1.4). Módulo PURO: o formulário (client) usa estas funções e a rota usa
// as mesmas, sem arrastar o banco pro bundle do navegador.
//
// O que fica aqui: tamanho, texto puro e quem pode escrever (o vocabulário de
// members.recadosFrom). O que fica em lib/recados.ts: laço, anti-corrente,
// gravação e aviso.

export const RECADO_MAX = 280;

export const RECADOS_FROM = ["conexoes", "todos", "ninguem"] as const;
export type RecadosFrom = (typeof RECADOS_FROM)[number];

export const isRecadosFrom = (v: unknown): v is RecadosFrom =>
  typeof v === "string" && (RECADOS_FROM as readonly string[]).includes(v);

export class RecadoError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 429,
  ) {
    super(message);
  }
}

/** texto do recado: puro, sem espaço nas pontas, até RECADO_MAX */
export function cleanRecado(raw: unknown): string {
  if (typeof raw !== "string") throw new RecadoError("Escreva o recado.", 400);
  const body = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!body) throw new RecadoError("Escreva o recado.", 400);
  if ([...body].length > RECADO_MAX) throw new RecadoError(`Até ${RECADO_MAX} caracteres.`, 400);
  return body;
}

/** copy da tela quando o recado está fechado pra quem olha */
export function recadoClosedText(reason: "ninguem" | "conexoes" | "bloqueado"): string {
  if (reason === "ninguem") return "Os recados deste perfil estão desligados.";
  if (reason === "bloqueado") return "Pessoa não encontrada.";
  return "Recado aqui é de quem tem laço: time, edição, comunidade ou seguir mútuo.";
}
