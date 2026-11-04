// Constantes e tipos do DM (migration 056) num módulo PURO — sem db — pra
// componente client importar sem puxar a camada de dados (mesmo motivo de
// lib/recadosText.ts).

export const DM_BODY_MAX = 2000;
export const DM_REQUEST_MAX = 280;
export const DM_PAGE_SIZE = 50;
export const DM_DECLINE_COOLDOWN_DAYS = 30;

export type DmLockState = "livre" | "pedido" | "bloqueado";
export type DmLock = { estado: DmLockState; motivo: string };

export type DmPeer = { id: number; username: string; name: string | null; avatarUrl: string | null };

export type DmMessage = {
  id: number;
  body: string;
  createdAt: string;
  /** true quando fui eu que escrevi */
  mine: boolean;
  authorUsername: string;
};

export type ThreadStatus = "aberta" | "pedido" | "recusada";

export type ThreadListItem = {
  id: number;
  status: ThreadStatus;
  /** fui eu que pedi (só faz sentido com status 'pedido'/'recusada') */
  iRequested: boolean;
  peer: DmPeer;
  lastBody: string | null;
  lastMine: boolean;
  lastMessageAt: string | null;
  unread: number;
};

/** o que o botão do /u mostra (null = escondido) */
export type DmEntry = {
  mode: "aberta" | "nova-livre" | "pedido-novo" | "pedido-recebido" | "pedido-enviado" | "recusada";
  threadId: number | null;
  motivo: string;
};
