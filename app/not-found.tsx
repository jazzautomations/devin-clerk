import Link from "next/link";

// 404 em PT-BR, no visual da Hack Inova (o padrão do Next é em inglês)
export default function NotFound() {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-20 sm:px-6">
      <p className="pix text-5xl text-accent">404</p>
      <h1 className="text-[clamp(2rem,6vw,3rem)] leading-none font-extrabold tracking-[-0.035em]">
        Essa página não existe
      </h1>
      <p className="max-w-prose text-muted">
        O link pode ter mudado, o código pode estar errado ou o conteúdo é só pra quem está logado.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="btn">
          voltar pro início
        </Link>
        <Link href="/radar" className="btn-ghost">
          ver o radar
        </Link>
      </div>
    </section>
  );
}
