"""Importa a planilha-calendário da comunidade WoHackers como curadoria.

NÃO RODA SOZINHO. A planilha é trabalho da WoHackers; só use --apply depois
que o dono do HackaHub combinar com a comunidade. Sem --apply o script só
mostra o que entraria (dry-run).

Cada linha vira um evento de curadoria ('source'='curadoria') com crédito no
organizador ("… · via calendário WoHackers") e o link original do evento.
Só entram eventos futuros com link. Nada é apagado; o scraper deduplica com
as fontes automáticas pelo nome + data.

Colunas do CSV exportado (linha de cabeçalho "MÊS, DIA DA SEMANA, …"):
  0 mês (JAN…DEZ) · 2–8 dia do mês na coluna do dia da semana · 9 EVENTO ·
  10 comunidade e parcerias · 11 último dia de inscrição (dd/mm/aaaa) ·
  12 link · 13 local · 14 cidade · 15 UF/país

Uso:
  python scripts/import_wohackers.py planilha.csv            # dry-run
  DATABASE_URL=… python scripts/import_wohackers.py planilha.csv --apply
"""

from __future__ import annotations

import csv
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_radar as sr  # noqa: E402

MONTHS = {"JAN": 1, "FEV": 2, "MAR": 3, "ABR": 4, "MAI": 5, "JUN": 6,
          "JUL": 7, "AGO": 8, "SET": 9, "OUT": 10, "NOV": 11, "DEZ": 12}
YEAR = 2026
CREDIT = "via calendário WoHackers"


def parse_rows(path: str, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            if len(row) < 13:
                continue
            mon = MONTHS.get(row[0].strip().upper()[:3])
            name = " ".join(row[9].split())
            link = (re.findall(r"https?://\S+", row[12]) or [None])[0]
            if not mon or not name or not link:
                continue
            day = next((int(c) for c in row[2:9] if c.strip().isdigit()), None)
            deadline = None
            dm = re.match(r"\s*(\d{2})/(\d{2})/(\d{4})", row[11] or "")
            if dm:
                deadline = f"{dm.group(3)}-{dm.group(2)}-{dm.group(1)}T23:59:00-03:00"
            start = f"{YEAR}-{mon:02d}-{day or 1:02d}T09:00:00-03:00"
            local = " ".join(row[13].split())
            cidade = " ".join(row[14].split()) if len(row) > 14 else ""
            uf = " ".join(row[15].split()) if len(row) > 15 else ""
            online = re.search(r"(?i)on-?line|discord", local) and not re.search(
                r"(?i)presencial|h[íi]brido", local)
            fmt = ("online" if online else
                   "hibrido" if re.search(r"(?i)h[íi]brido|e presencial", local)
                   else "presencial")
            loc = ", ".join(p for p in (cidade, uf) if p and p not in ("?", "--"))
            org = " ".join(row[10].split()) or "a confirmar"
            r = {
                "id": f"wohackers-{sr.slugify(name)}",
                "name": name,
                "organizer": f"{org} · {CREDIT}",
                "startsAt": start,
                "endsAt": None,
                "format": fmt,
                "location": None if fmt == "online" else (loc or None),
                "registrationUrl": link,
                "registrationDeadline": deadline,
                "tags": [],
                "source": "curadoria",
            }
            if sr.is_expired(r, now) and not (deadline and deadline[:10] >= now.date().isoformat()):
                continue
            out.append(r)
    return out


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rows = parse_rows(sys.argv[1])
    for r in rows:
        print(f"{r['startsAt'][:10]}  {r['format']:10s} {r['name'][:60]:60s} {r['registrationUrl']}")
    print(f"\n{len(rows)} eventos futuros com link")
    if "--apply" not in sys.argv:
        print("dry-run: nada gravado (use --apply depois do OK do dono)")
        return
    import psycopg
    conn = sr.PgConn(psycopg.connect(os.environ["DATABASE_URL"]))
    n = sr.upsert(conn, rows)
    conn.commit()
    print(f"gravados: {n}")


if __name__ == "__main__":
    main()
