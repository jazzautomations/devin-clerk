import { COR_IDS, type CorId } from "@/lib/mascote/paleta";
import {
  ACESSORIOS,
  BOCAS,
  CENARIOS,
  ESPECIES,
  MAOS,
  NOME_MAX,
  OLHOS,
  POSES,
  ROUPAS,
  TOPOS,
  type MascoteConfig,
} from "@/lib/mascote/tipos";

// Valida e normaliza o config do bicho (migration 043). Campo ausente cai
// no padrão; campo presente e errado vira erro com a mensagem do campo.
//
// Versão antiga (v:1 da primeira spec) continua aceita:
//   {v:1, especie, cor, acessorio, olhos, nome}
// cor vira corPrincipal; acessorio 'bone' e 'gorro' viram topo.

export type ErrosMascote = Partial<Record<keyof MascoteConfig | "config", string>>;
export type ResultadoMascote = { ok: true; config: MascoteConfig } | { ok: false; erros: ErrosMascote; erro: string };

export const PADRAO: Omit<MascoteConfig, "especie" | "nome"> = {
  v: 1,
  corPrincipal: "banda",
  corDetalhe: "tinta",
  olhos: "ponto",
  boca: "sorriso",
  topo: "nada",
  roupa: "nada",
  mao: "nada",
  acessorio: "nada",
  pose: "pula",
  cenario: "nada",
};

const URL_RE = /(https?:|www\.|:\/\/|[a-z0-9-]\.(com|br|net|org|io|dev|app|me|gg|ly|xyz|co|link|site|info)\b)/i;

/** nome do bicho: até 20 caracteres, sem link, sem caractere de controle */
export function normalizarNome(raw: unknown): { ok: true; nome: string } | { ok: false; erro: string } {
  if (typeof raw !== "string") return { ok: false, erro: "Dê um nome pro bicho." };
  const nome = raw.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
  if (!nome) return { ok: false, erro: "Dê um nome pro bicho." };
  if ([...nome].length > NOME_MAX) return { ok: false, erro: `O nome tem até ${NOME_MAX} caracteres.` };
  if (URL_RE.test(nome)) return { ok: false, erro: "O nome não pode ter link." };
  return { ok: true, nome };
}

const CAMPOS = {
  especie: { lista: ESPECIES, erro: "Escolha uma das espécies." },
  corPrincipal: { lista: COR_IDS, erro: "Escolha uma cor da paleta." },
  corDetalhe: { lista: COR_IDS, erro: "Escolha uma cor de detalhe da paleta." },
  olhos: { lista: OLHOS, erro: "Escolha um dos olhos." },
  boca: { lista: BOCAS, erro: "Escolha uma das bocas." },
  topo: { lista: TOPOS, erro: "Escolha um chapéu da lista." },
  roupa: { lista: ROUPAS, erro: "Escolha uma roupa da lista." },
  mao: { lista: MAOS, erro: "Escolha um item da lista." },
  acessorio: { lista: ACESSORIOS, erro: "Escolha um acessório da lista." },
  pose: { lista: POSES, erro: "Escolha uma das poses." },
  cenario: { lista: CENARIOS, erro: "Escolha um dos cenários." },
} as const;

type Campo = keyof typeof CAMPOS;

export function validarMascote(input: unknown): ResultadoMascote {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, erros: { config: "Não deu pra ler o bicho enviado." }, erro: "Não deu pra ler o bicho enviado." };
  }
  const src = { ...(input as Record<string, unknown>) };
  if (src.v !== undefined && src.v !== 1) {
    return { ok: false, erros: { v: "Versão do bicho desconhecida." }, erro: "Versão do bicho desconhecida." };
  }
  // versão antiga
  if (src.corPrincipal === undefined && src.cor !== undefined) src.corPrincipal = src.cor;
  if (src.acessorio === "bone" || src.acessorio === "gorro") {
    if (src.topo === undefined) src.topo = src.acessorio;
    src.acessorio = "nada";
  }

  const erros: ErrosMascote = {};
  const out: Record<string, unknown> = { ...PADRAO };
  for (const campo of Object.keys(CAMPOS) as Campo[]) {
    const v = src[campo];
    const { lista, erro } = CAMPOS[campo];
    if (v === undefined || v === null) {
      if (campo === "especie") erros.especie = erro;
      continue;
    }
    if (typeof v !== "string" || !(lista as readonly string[]).includes(v)) {
      erros[campo] = erro;
      continue;
    }
    out[campo] = v;
  }
  const nome = normalizarNome(src.nome);
  if (nome.ok) out.nome = nome.nome;
  else erros.nome = nome.erro;

  const primeiro = Object.values(erros)[0];
  if (primeiro) return { ok: false, erros, erro: primeiro };
  return { ok: true, config: out as MascoteConfig };
}

/** lê o JSON salvo em members.mascote; inválido ou vazio = null */
export function lerMascoteSalvo(raw: string | null | undefined): MascoteConfig | null {
  if (!raw) return null;
  try {
    const r = validarMascote(JSON.parse(raw));
    return r.ok ? r.config : null;
  } catch {
    return null;
  }
}

export function ehCor(v: unknown): v is CorId {
  return typeof v === "string" && (COR_IDS as readonly string[]).includes(v);
}
