import { getCertificate } from "@/lib/certificates";
import { certificatePdf } from "@/lib/certificatePdf";
import { SITE_URL } from "@/lib/seo";

// PDF do certificado sob demanda — público, como a verificação em /c/[code]
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const cert = await getCertificate(code);
  if (!cert) return Response.json({ error: "Certificado não encontrado" }, { status: 404 });
  const bytes = await certificatePdf(cert, SITE_URL);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="certificado-${cert.code}.pdf"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
