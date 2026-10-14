"use client";

export function PrintButton({ label = "imprimir" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-ghost rounded-[6px] print:hidden">
      {label}
    </button>
  );
}
