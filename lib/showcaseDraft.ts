import type { ShowcaseFields } from "@/lib/entries";

// spec 046 — rascunho da vitrine no editor (puro, sem banco: o editor é
// client). Cada integrante edita a vitrine do mesmo time; o autosave só
// manda o que a pessoa mexeu, senão o papel de um apagaria a história que
// outro salvou depois que a página dele abriu.

export type Story = {
  inspiration: string;
  howBuilt: string;
  challenges: string;
  learned: string;
  coverUrl: string;
  media: { url: string; caption: string }[];
  role: string;
};

export type StoryKey = keyof Story;

export function toStory(s: ShowcaseFields | null, role: string | null): Story {
  return {
    inspiration: s?.inspiration ?? "",
    howBuilt: s?.howBuilt ?? "",
    challenges: s?.challenges ?? "",
    learned: s?.learned ?? "",
    coverUrl: s?.coverUrl ?? "",
    media: (s?.media ?? []).map((m) => ({ url: m.url, caption: m.caption ?? "" })),
    role: role ?? "",
  };
}

/** corpo do PATCH com só as chaves mexidas; sem projeto, só o papel */
export function storyPayload(s: Story, keys: Iterable<StoryKey>, hasProject: boolean): Partial<Record<StoryKey, unknown>> {
  const out: Partial<Record<StoryKey, unknown>> = {};
  for (const k of keys) {
    if (k !== "role" && !hasProject) continue;
    out[k] =
      k === "media"
        ? s.media.filter((m) => m.url.trim()).map((m) => ({ url: m.url.trim(), caption: m.caption }))
        : s[k];
  }
  return out;
}

/**
 * Depois de salvar: o que a pessoa não mexeu vem do servidor (pega o que
 * outro integrante salvou nesse meio-tempo); o que está sendo editado fica.
 */
export function mergeStory(local: Story, server: Story, dirty: ReadonlySet<StoryKey>): Story {
  const out = { ...local };
  for (const k of Object.keys(server) as StoryKey[]) {
    if (!dirty.has(k)) (out as Record<StoryKey, unknown>)[k] = server[k];
  }
  return out;
}
