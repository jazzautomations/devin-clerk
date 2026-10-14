"use client";

// imprimir / salvar em PDF pelo diálogo do navegador (o print CSS limpa a página)
export function PrintButton({ label = "imprimir / PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn rounded-[6px]">
      {label}
    </button>
  );
}
