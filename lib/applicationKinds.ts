import type { EditionRole } from "@/lib/roles";

// frente E (spec 033) — tipos de candidatura. Módulo sem banco: serve
// componente client e server (lib/roleApplications reexporta).

export const APPLICATION_KINDS = ["voluntario", "mentor", "jurado"] as const;
export type ApplicationKind = (typeof APPLICATION_KINDS)[number];
export type ApplicationStatus = "pending" | "approved" | "rejected";

/** papel concedido na aprovação: voluntário faz check-in (staff) */
export const KIND_ROLE: Record<ApplicationKind, EditionRole> = {
  voluntario: "staff",
  mentor: "mentor",
  jurado: "jurado",
};

export const KIND_LABEL: Record<ApplicationKind, string> = {
  voluntario: "voluntário",
  mentor: "mentor",
  jurado: "jurado",
};

export const KIND_PITCH: Record<ApplicationKind, string> = {
  voluntario: "Credenciamento, check-in e o corre do dia.",
  mentor: "Destrava os times com o que você sabe.",
  jurado: "Avalia os projetos pela rubrica da edição.",
};

export function isApplicationKind(v: unknown): v is ApplicationKind {
  return typeof v === "string" && (APPLICATION_KINDS as readonly string[]).includes(v);
}
