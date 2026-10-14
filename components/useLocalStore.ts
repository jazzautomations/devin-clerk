"use client";

import { useCallback, useSyncExternalStore } from "react";

// Valor JSON em localStorage como store externo do React: sem setState em
// effect, sem mismatch de hidratação (no servidor é sempre null), e todas
// as abas/componentes com a mesma chave veem a mesma coisa. Storage pode
// não existir (aba anônima, bloqueio) — aí vive só em memória.

type Store = { raw: string | null; val: unknown; mem: string | null; listeners: Set<() => void> };
const stores = new Map<string, Store>();

function store(key: string): Store {
  let s = stores.get(key);
  if (!s) {
    s = { raw: null, val: null, mem: null, listeners: new Set() };
    stores.set(key, s);
  }
  return s;
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return store(key).mem;
  }
}

function snapshot<T>(key: string): T | null {
  const s = store(key);
  const raw = readRaw(key);
  if (raw !== s.raw) {
    s.raw = raw;
    try {
      s.val = raw === null ? null : JSON.parse(raw);
    } catch {
      s.val = null;
    }
  }
  return s.val as T | null;
}

export function writeLocal<T>(key: string, value: T | null): void {
  const s = store(key);
  const raw = value === null ? null : JSON.stringify(value);
  try {
    if (raw === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, raw);
  } catch {
    s.mem = raw;
  }
  s.listeners.forEach((l) => l());
}

export function readLocal<T>(key: string): T | null {
  return snapshot<T>(key);
}

export function useLocalStore<T>(key: string): [T | null, (v: T | null) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      const s = store(key);
      s.listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) cb();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        s.listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => snapshot<T>(key),
    () => null,
  );
  const set = useCallback((v: T | null) => writeLocal(key, v), [key]);
  return [value, set];
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** navigator.onLine como store (no servidor: online) */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
