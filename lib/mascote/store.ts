import db from "@/lib/db";
import { canNetwork } from "@/lib/network";
import { hashMascote, mascoteSrc } from "@/lib/mascote/isometrico";
import { configFromSeed, resolveMascote } from "@/lib/mascote/semente";
import { lerMascoteSalvo } from "@/lib/mascote/validar";
import type { MascoteConfig } from "@/lib/mascote/tipos";

// Leitura e escrita do bicho em members (migration 043). O config chega
// aqui já validado (validarMascote); a leitura revalida e cai na semente se
// o JSON salvo não servir mais.

export type MascoteDoMembro = {
  config: MascoteConfig;
  /** false = bicho da semente (a pessoa ainda não montou) */
  salvo: boolean;
  atualizadoEm: string | null;
  hash: string;
  src: string;
};

type Row = { id: number; clerkId: string; mascote: string | null; mascoteUpdatedAt: string | null };

async function linha(memberId: number): Promise<Row | undefined> {
  return db
    .prepare(`SELECT id, clerkId, mascote, mascoteUpdatedAt FROM members WHERE id = ?`)
    .get<Row>(memberId);
}

export async function mascoteDoMembro(memberId: number): Promise<MascoteDoMembro> {
  const r = await linha(memberId);
  const salvo = lerMascoteSalvo(r?.mascote);
  const config = r ? resolveMascote({ id: r.id, mascote: r.mascote }) : configFromSeed(0);
  const hash = hashMascote(config);
  return { config, salvo: !!salvo, atualizadoEm: r?.mascoteUpdatedAt ?? null, hash, src: mascoteSrc(memberId, hash) };
}

/**
 * Bicho que a rota pública desenha: o do membro, ou o da semente do id 0
 * quando o membro não existe ou excluiu a conta.
 */
export async function mascotePublico(memberId: number): Promise<MascoteConfig> {
  if (!Number.isSafeInteger(memberId) || memberId <= 0) return configFromSeed(0);
  const r = await linha(memberId);
  if (!r || !(await canNetwork(r.id))) return configFromSeed(0);
  return resolveMascote({ id: r.id, mascote: r.mascote });
}

export async function salvarMascote(memberId: number, config: MascoteConfig): Promise<{ hash: string; src: string }> {
  await db
    .prepare(`UPDATE members SET mascote = ?, mascoteUpdatedAt = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(config), memberId);
  const hash = hashMascote(config);
  return { hash, src: mascoteSrc(memberId, hash) };
}
