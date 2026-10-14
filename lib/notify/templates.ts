import { absoluteUrl } from "@/lib/seo";

// Mensagens do aviso. E-mail = HTML de tabela com estilo inline (cliente de
// e-mail ignora <style> e fonte web) no visual da Hack Inova — papel, tinta,
// verde, fios pretos, raio zero — mais a versão texto puro.

export type AnnouncementContent = {
  hackathonId: string;
  hackathonName: string;
  title: string;
  body: string;
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function announcementUrls(hackathonId: string) {
  return {
    edition: absoluteUrl(`/h/${hackathonId}#avisos`),
    preferences: absoluteUrl("/perfil#contato"),
  };
}

export function renderAnnouncementEmail(a: AnnouncementContent): {
  subject: string;
  html: string;
  text: string;
} {
  const urls = announcementUrls(a.hackathonId);
  const subject = `[${a.hackathonName}] ${a.title}`;
  const paragraphs = a.body
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#0c0c0c;">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const mono = "'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace";
  const sans = "Archivo,'Helvetica Neue',Arial,sans-serif";

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#fefefe;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fefefe;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border:2px solid #0c0c0c;background:#fefefe;">
<tr><td style="background:#0c0c0c;padding:8px 16px;font-family:${mono};font-size:13px;letter-spacing:.06em;color:#3ecf8e;text-transform:uppercase;">Hack Inova · aviso da edição</td></tr>
<tr><td style="padding:28px 24px 8px;font-family:${sans};">
<p style="margin:0 0 10px;font-family:${mono};font-size:12px;letter-spacing:.08em;color:#047a43;text-transform:uppercase;">${esc(a.hackathonName)}</p>
<h1 style="margin:0 0 20px;font-size:28px;line-height:1.1;font-weight:800;letter-spacing:-.02em;color:#0c0c0c;">${esc(a.title)}</h1>
${paragraphs}
</td></tr>
<tr><td style="padding:8px 24px 28px;">
<a href="${esc(urls.edition)}" style="display:inline-block;background:#047a43;color:#ffffff;font-family:${sans};font-size:15px;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:6px;">Ver na página da edição</a>
</td></tr>
<tr><td style="border-top:1.5px solid #0c0c0c;background:#d8f4e5;padding:16px 24px;font-family:${mono};font-size:12px;line-height:1.6;color:#474747;">
Você recebe este aviso porque está inscrito em ${esc(a.hackathonName)}.<br>
<a href="${esc(urls.preferences)}" style="color:#047a43;">Preferências de contato (WhatsApp, telefone)</a> ·
<a href="${esc(urls.edition)}" style="color:#047a43;">Cancelar inscrição na edição</a> para não receber mais avisos dela.
</td></tr>
</table>
<p style="margin:12px 0 0;font-family:${mono};font-size:11px;color:#474747;">HackaHub · avisos da edição</p>
</td></tr></table>
</body></html>`;

  const text = [
    `${a.hackathonName} — aviso da edição`,
    "",
    a.title,
    "",
    a.body.trim(),
    "",
    `Ver na página da edição: ${urls.edition}`,
    "",
    "--",
    `Você recebe este aviso porque está inscrito em ${a.hackathonName}.`,
    `Preferências de contato: ${urls.preferences}`,
    `Para não receber mais avisos desta edição, cancele a inscrição: ${urls.edition}`,
  ].join("\n");

  return { subject, html, text };
}

export function renderAnnouncementWhatsapp(a: AnnouncementContent): string {
  const urls = announcementUrls(a.hackathonId);
  return [
    `*${a.hackathonName}* — aviso`,
    "",
    `*${a.title}*`,
    a.body.trim(),
    "",
    urls.edition,
    "",
    `Para parar de receber por aqui: ${urls.preferences}`,
  ].join("\n");
}
