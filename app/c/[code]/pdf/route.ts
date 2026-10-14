import { getCertificate } from "@/lib/certificates";
import { certificatePdf } from "@/lib/certificatePdf";
import { SITE_URL } from "@/lib/seo";

// PDF do certificado sob demanda — público, como a verificação em /c/[code]
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const cert = await getCertificate(code);
  if (!cert) return Response.json({ error: "Certificado não encontrado" }, { status: 404 });
  // revogado não vira PDF: quem guardou o link /pdf não baixa um documento que
  // parece válido. A página /c/[code] continua abrindo e diz "revogado".
  if (cert.revokedAt) {
    return Response.json(
      { error: "Certificado revogado", verify: `${SITE_URL}/c/${cert.code}` },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }
  const bytes = await certificatePdf(cert, SITE_URL);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="certificado-${cert.code}.pdf"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
