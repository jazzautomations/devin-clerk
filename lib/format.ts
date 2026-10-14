// datas do banco são TEXT "YYYY-MM-DD HH:MM:SS" em UTC → hora de Brasília
const fmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function formatDbTime(text: string): string {
  const d = new Date(`${text.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? text : fmt.format(d).replace(".", "");
}
