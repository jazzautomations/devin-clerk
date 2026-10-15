import { absoluteUrl } from "@/lib/seo";

// Mensagens do RSVP (migration 012): convite do D-7 ("confirmo / não vou"),
// D-1 (logística) e H-2 (endereço + ingresso). Mesmo visual do e-mail de
// aviso (lib/notify/templates.ts) — tabela com estilo inline, raio zero no
// quadro, botão verde — mais a versão texto e a de WhatsApp.

export type RsvpMessageKind = "invite" | "d1" | "h2";

export type RsvpMessageInput = {
  kind: RsvpMessageKind;
  hackathonId: string;
  hackathonName: string;
  firstName: string | null;
  /** "sáb, 14 nov, 09:00" — já no fuso de Brasília */
  when: string;
  location: string | null;
  /** só no convite: "sex, 11 nov, 23:59" */
  deadline?: string;
  rsvpUrl: string;
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const WHAT_TO_BRING = [
  "documento com foto (o nome tem que bater com a inscrição)",
  "notebook e carregador",
  "garrafa d'água e um casaco",
];

type Body = { subject: string; heading: string; lines: string[]; cta: string; ctaUrl: string; secondary?: { label: string; url: string } };

function body(m: RsvpMessageInput): Body {
  const ticketUrl = absoluteUrl(`/h/${m.hackathonId}/ingresso`);
  const where = m.location ?? "local a confirmar na página da edição";
  const hi = m.firstName ? `${m.firstName}, ` : "";
  if (m.kind === "invite") {
    return {
      subject: `[${m.hackathonName}] Você vai? Confirme sua presença`,
      heading: "Confirma sua presença?",
      lines: [
        `${hi}sua vaga em ${m.hackathonName} está garantida — falta só confirmar que você vai.`,
        `Quando: ${m.when}. Onde: ${where}.`,
        `Responda até ${m.deadline}. Sem resposta até lá, a vaga vai pra próxima pessoa da fila de espera.`,
        "Não vai conseguir? Avise pelo mesmo link: a vaga é liberada na hora pra quem está esperando.",
      ],
      cta: "Responder: vou / não vou",
      ctaUrl: m.rsvpUrl,
    };
  }
  if (m.kind === "d1") {
    return {
      subject: `[${m.hackathonName}] É amanhã — o que levar`,
      heading: "É amanhã.",
      lines: [
        `${hi}obrigado por confirmar. ${m.hackathonName} começa ${m.when}.`,
        `Onde: ${where}.`,
        `O que levar: ${WHAT_TO_BRING.join("; ")}.`,
        "Seu ingresso (QR do check-in) está no link abaixo. Se não puder mais ir, libere a vaga pelo segundo link.",
      ],
      cta: "Ver meu ingresso",
      ctaUrl: ticketUrl,
      secondary: { label: "Não vou mais — liberar a vaga", url: m.rsvpUrl },
    };
  }
  return {
    subject: `[${m.hackathonName}] Começa em 2 horas`,
    heading: "Começa em 2 horas.",
    lines: [
      `${hi}${m.hackathonName} começa ${m.when}.`,
      `Endereço: ${where}.`,
      "Deixe o ingresso aberto no celular pra agilizar o check-in.",
    ],
    cta: "Abrir meu ingresso",
    ctaUrl: ticketUrl,
    secondary: { label: "Não vou mais — liberar a vaga", url: m.rsvpUrl },
  };
}

export function renderRsvpEmail(m: RsvpMessageInput): { subject: string; html: string; text: string } {
  const b = body(m);
  const mono = "'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace";
  const sans = "Archivo,'Helvetica Neue',Arial,sans-serif";
  const paragraphs = b.lines
    .map((l) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#0c0c0c;">${esc(l)}</p>`)
    .join("");
  const secondary = b.secondary
    ? `<p style="margin:16px 0 0;font-family:${mono};font-size:13px;"><a href="${esc(b.secondary.url)}" style="color:#ba3919;">${esc(b.secondary.label)}</a></p>`
    : "";
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.subject)}</title></head>
<body style="margin:0;padding:0;background:#fefefe;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fefefe;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border:2px solid #0c0c0c;background:#fefefe;">
<tr><td style="background:#0c0c0c;padding:8px 16px;font-family:${mono};font-size:13px;letter-spacing:.06em;color:#3ecf8e;text-transform:uppercase;">HackaHub · presença</td></tr>
<tr><td style="padding:28px 24px 8px;font-family:${sans};">
<p style="margin:0 0 10px;font-family:${mono};font-size:12px;letter-spacing:.08em;color:#047a43;text-transform:uppercase;">${esc(m.hackathonName)}</p>
<h1 style="margin:0 0 20px;font-size:28px;line-height:1.1;font-weight:800;letter-spacing:-.02em;color:#0c0c0c;">${esc(b.heading)}</h1>
${paragraphs}
</td></tr>
<tr><td style="padding:8px 24px 28px;">
<a href="${esc(b.ctaUrl)}" style="display:inline-block;background:#047a43;color:#ffffff;font-family:${sans};font-size:15px;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:6px;">${esc(b.cta)}</a>
${secondary}
</td></tr>
<tr><td style="border-top:1.5px solid #0c0c0c;background:#d8f4e5;padding:16px 24px;font-family:${mono};font-size:12px;line-height:1.6;color:#474747;">
Você recebe isto porque tem vaga aprovada em ${esc(m.hackathonName)}. O link é pessoal — não encaminhe.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [
    `${m.hackathonName} — ${b.heading}`,
    "",
    ...b.lines,
    "",
    `${b.cta}: ${b.ctaUrl}`,
    ...(b.secondary ? [`${b.secondary.label}: ${b.secondary.url}`] : []),
    "",
    "--",
    `Você recebe isto porque tem vaga aprovada em ${m.hackathonName}. O link é pessoal — não encaminhe.`,
  ].join("\n");
  return { subject: b.subject, html, text };
}

export function renderRsvpWhatsapp(m: RsvpMessageInput): string {
  const b = body(m);
  return [
    `*${m.hackathonName}* — ${b.heading}`,
    "",
    ...b.lines,
    "",
    `${b.cta}: ${b.ctaUrl}`,
    ...(b.secondary ? [`${b.secondary.label}: ${b.secondary.url}`] : []),
  ].join("\n");
}

export function rsvpInappText(m: RsvpMessageInput): string {
  if (m.kind === "invite") return `${m.hackathonName}: confirme sua presença até ${m.deadline}`;
  if (m.kind === "d1") return `${m.hackathonName} é amanhã — veja o que levar`;
  return `${m.hackathonName} começa em 2 horas`;
}
