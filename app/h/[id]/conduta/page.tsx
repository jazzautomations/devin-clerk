import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getHackathon } from "@/lib/hackathons";
import { getEditionTerms } from "@/lib/eventTerms";

export async function generateMetadata({ params }: PageProps<"/h/[id]/conduta">): Promise<Metadata> {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.partner) return { title: "edição não encontrada" };
  return {
    title: `Código de conduta · ${h.name}`,
    description: `Como a gente se trata em ${h.name} e como relatar um problema.`,
  };
}

type Block = { kind: "h" | "p" | "ul"; lines: string[] };

// texto puro do organizador → blocos: linha curta sozinha vira título,
// linhas com "- " viram lista; nada de HTML vindo do banco
function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split(/\n\s*\n/)) {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const items = lines.filter((l) => l.startsWith("- "));
    const head = lines[0];
    if (items.length === lines.length) {
      out.push({ kind: "ul", lines: items.map((l) => l.slice(2)) });
    } else if (items.length > 0 && items.length === lines.length - 1 && !head.startsWith("- ")) {
      out.push({ kind: "h", lines: [head] });
      out.push({ kind: "ul", lines: items.map((l) => l.slice(2)) });
    } else if (lines.length > 1 && head.length <= 70 && !/[.:!?]$/.test(head)) {
      out.push({ kind: "h", lines: [head] });
      out.push({ kind: "p", lines: lines.slice(1) });
    } else if (lines.length === 1 && head.length <= 70 && !/[.:!?]$/.test(head)) {
      out.push({ kind: "h", lines: [head] });
    } else {
      out.push({ kind: "p", lines });
    }
  }
  return out;
}

// frente L — código de conduta público da edição (roadmap 037 #7). A
// inscrição exige o aceite desta versão; o canal de denúncia fica no fim.
export default async function CondutaPage({ params }: PageProps<"/h/[id]/conduta">) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.partner) notFound();
  const terms = await getEditionTerms(h.id);
  const body = blocks(terms.conductText);
  // o título do texto padrão ("Código de conduta") já está no h1
  if (body[0]?.kind === "h" && /^c[óo]digo de conduta$/i.test(body[0].lines[0])) body.shift();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <Link href={`/h/${h.id}`} className="font-mono text-[13px] text-muted hover:text-accent">
          ← {h.name}
        </Link>
        <p className="font-mono text-[12px] tracking-widest text-accent uppercase">
          código de conduta · versão {terms.conductVersion}
        </p>
        <h1 className="text-[clamp(1.9rem,6vw,2.75rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">
          Código de conduta
        </h1>
        <p className="text-[15px] text-muted">
          Vale pra todo mundo em {h.name}: participantes, mentores, jurados, voluntários, patrocinadores e
          organização. Quem se inscreve aceita esta versão.
        </p>
      </header>

      <article className="flex flex-col gap-4 text-[16px] leading-relaxed" data-testid="conduct-text">
        {body.map((b, i) =>
          b.kind === "h" ? (
            <h2 key={i} className="mt-2 text-[20px] leading-tight font-extrabold tracking-[-0.02em]">
              {b.lines[0]}
            </h2>
          ) : b.kind === "ul" ? (
            <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5 marker:text-accent">
              {b.lines.map((l, j) => (
                <li key={j} className="break-words">
                  {l}
                </li>
              ))}
            </ul>
          ) : (
            <p key={i} className="break-words">
              {b.lines.join(" ")}
            </p>
          ),
        )}
      </article>

      <section className="flex flex-col gap-3 border-[1.5px] border-line bg-mint p-5">
        <h2 className="text-[18px] font-bold">Aconteceu algo?</h2>
        <p className="text-[15px] leading-snug">
          Fale com qualquer pessoa da organização ou mande um relato pelo canal da edição. Pode ser anônimo: nesse caso
          não guardamos seu nome nem seu IP. Em risco imediato, ligue 190 ou 192.
        </p>
        <Link href={`/h/${h.id}/incidente`} className="btn self-start rounded-[6px]">
          relatar um problema
        </Link>
      </section>
    </div>
  );
}
