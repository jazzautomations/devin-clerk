// Redes sociais do perfil e compartilhamento. Módulo puro (roda no client e
// no server): normaliza o que o membro digita pro handle canônico, monta os
// links públicos e as intents de compartilhar — sem SDK nem chave de API.

export type SocialKind = "linkedin" | "github" | "twitter" | "website";
export type Normalized = { value: string } | { error: string };

const RULES: Record<Exclude<SocialKind, "website">, { hosts: RegExp; path: RegExp; handle: RegExp; label: string }> = {
  // linkedin.com/in/<slug> (www., br., etc.); slug aceita letras, números, - _ . e %-encoding
  linkedin: {
    hosts: /^([a-z]{2,3}\.|www\.)?linkedin\.com$/,
    path: /^\/in\/([^/]+)\/?$/,
    handle: /^[A-Za-z0-9_.%-]{3,100}$/,
    label: "LinkedIn: use o link do teu perfil (linkedin.com/in/…)",
  },
  github: {
    hosts: /^(www\.)?github\.com$/,
    path: /^\/([^/]+)\/?$/,
    handle: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
    label: "GitHub: usuário inválido",
  },
  twitter: {
    hosts: /^(www\.)?(x|twitter)\.com$/,
    path: /^\/@?([^/]+)\/?$/,
    handle: /^[A-Za-z0-9_]{1,15}$/,
    label: "X: usuário inválido (até 15 letras, números ou _)",
  },
};

export function normalizeSocial(kind: SocialKind, raw: string): Normalized {
  const input = (raw ?? "").trim();
  if (!input) return { value: "" };

  if (kind === "website") {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
    try {
      const u = new URL(withScheme);
      if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "site: só http(s)" };
      if (!u.hostname.includes(".")) return { error: "site: endereço inválido" };
      return { value: u.toString() };
    } catch {
      return { error: "site: endereço inválido" };
    }
  }

  const rule = RULES[kind];
  let handle: string | null = null;
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:/i.test(input) || /\.[a-z]{2,}\//i.test(input) || /^[^@\s]+\.[a-z]{2,}$/i.test(input);
  if (looksLikeUrl) {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
      if (u.protocol !== "https:" && u.protocol !== "http:") return { error: rule.label };
      if (!rule.hosts.test(u.hostname.toLowerCase())) return { error: rule.label };
      const m = u.pathname.match(rule.path);
      if (!m) return { error: rule.label };
      handle = decodeURIComponent(m[1]).replace(/^@/, "");
    } catch {
      return { error: rule.label };
    }
  } else {
    handle = input.replace(/^@/, "");
  }
  return rule.handle.test(handle) ? { value: handle } : { error: rule.label };
}

/** link público a partir do valor salvo (aceita legado gravado como URL) */
export function profileUrl(kind: SocialKind, stored: string | null | undefined): string | null {
  if (!stored) return null;
  const n = normalizeSocial(kind, stored);
  if ("error" in n || !n.value) return null;
  switch (kind) {
    case "linkedin":
      return `https://www.linkedin.com/in/${n.value}`;
    case "github":
      return `https://github.com/${n.value}`;
    case "twitter":
      return `https://x.com/${n.value}`;
    case "website":
      return n.value;
  }
}

const enc = encodeURIComponent;

export function shareLinks(url: string, text: string) {
  return {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    x: `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`,
    whatsapp: `https://wa.me/?text=${enc(`${text} ${url}`)}`,
    telegram: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
  };
}

/**
 * "Adicionar licença ou certificado" do LinkedIn já preenchido — o
 * certificado vai pra seção de certificados do perfil com link de verificação.
 */
export function linkedinAddCertificationUrl(c: {
  name: string;
  organizationName: string;
  issuedAt: string; // "YYYY-MM-DD HH:MM:SS" ou ISO
  certUrl: string;
  certId: string;
}): string {
  const [y, m] = c.issuedAt.slice(0, 7).split("-");
  const p = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: c.name,
    organizationName: c.organizationName,
    issueYear: String(Number(y)),
    issueMonth: String(Number(m)),
    certUrl: c.certUrl,
    certId: c.certId,
  });
  return `https://www.linkedin.com/profile/add?${p.toString()}`;
}
