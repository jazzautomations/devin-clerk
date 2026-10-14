#!/usr/bin/env bash
# Smoke do release depois do health: o /api/health só faz SELECT 1, e quem
# quebra no standalone (arquivo que o rastreamento deixou de fora, escrita
# barrada pelo sandbox da unit) é página SSR, imagem de compartilhamento e
# PDF, que leem fontes e conteúdo do disco.
#   bash smoke.sh <url-base> [banco] [prod|stage]
# Com o banco (nome dentro do container hackahub-pg), pega uma edição ativa,
# um time e um certificado de verdade pra testar /h, /p e o PDF.
# Com o ambiente, confere a indexação: prod precisa estar aberto pra busca
# (o robots e o X-Robots-Tag saem do NEXT_PUBLIC_SITE_URL da hora do build,
# e um valor errado fecharia prod em silêncio); stage precisa estar fechado.
set -uo pipefail
BASE="${1:?url base, ex.: http://127.0.0.1:3410}"
DBN="${2:-}"
ENV_NAME="${3:-}"
# SMOKE_PSQL troca o psql (os testes usam um falso)
PSQL="${SMOKE_PSQL:-docker exec hackahub-pg psql -U hackahub -d $DBN}"
fail=0

# check <caminho> <códigos aceitos, ex.: 200 ou 200|404> [prefixo do content-type]
check() {
  local out code ctype
  out=$(curl -sS -m 30 -o /dev/null -w '%{http_code} %{content_type}' "$BASE$1" 2>&1) || out="000 $out"
  code=${out%% *}; ctype=${out#* }
  if [[ "|$2|" != *"|$code|"* ]] || { [ "$code" = 200 ] && [ -n "${3:-}" ] && [[ "$ctype" != "$3"* ]]; }; then
    echo "smoke FALHOU: $1 -> $out" >&2; fail=1
  else
    echo "smoke ok: $1 ($code)"
  fi
}

q() { $PSQL -qtAc "$1" 2>/dev/null | head -1; }

# indexação: robots.txt e o cabeçalho X-Robots-Tag da home
check_index() {
  local robots tag
  robots=$(curl -sS -m 30 "$BASE/robots.txt" 2>/dev/null | tr -d '\r')
  tag=$(curl -sS -m 30 -o /dev/null -D - "$BASE/" 2>/dev/null | tr -d '\r' | grep -i '^x-robots-tag:')
  if [ "$1" = prod ]; then
    if grep -qx 'Disallow: /' <<<"$robots" || [ -n "$tag" ]; then
      echo "smoke FALHOU: prod fechado pra busca (robots com 'Disallow: /' ou $tag). Confira NEXT_PUBLIC_SITE_URL no prod.env" >&2; fail=1
    else
      echo "smoke ok: prod aberto pra busca"
    fi
  else
    if grep -qx 'Disallow: /' <<<"$robots" && [ -n "$tag" ]; then
      echo "smoke ok: $1 fechado pra busca"
    else
      echo "smoke FALHOU: $1 aberto pra busca (robots ou X-Robots-Tag)" >&2; fail=1
    fi
  fi
}

check / 200 text/html
check /organizar 200 text/html
check /legal/termos 200 text/html
# /blog é só pra quem tem conta (redireciona pro cadastro), fica de fora
check /sitemap.xml 200
check /opengraph-image 200 image/png
check /robots.txt 200
check /p/2147483648 404
[ -n "$ENV_NAME" ] && check_index "$ENV_NAME"

if [ -n "$DBN" ]; then
  # só edição ativa: /h/<id> dá 404 em rascunho ou edição desligada
  h=$(q 'SELECT id FROM hackathons WHERE active = 1 ORDER BY "startsAt" DESC NULLS LAST LIMIT 1')
  if [ -n "$h" ]; then
    check "/h/$h" 200 text/html
    check "/h/$h/opengraph-image" 200 image/png
  fi
  t=$(q 'SELECT id FROM teams ORDER BY id DESC LIMIT 1')
  if [ -n "$t" ]; then
    check "/p/$t" "200|404" text/html
    check "/p/$t/opengraph-image" "200|404" image/png
  fi
  c=$(q 'SELECT code FROM certificates ORDER BY "issuedAt" DESC LIMIT 1')
  [ -n "$c" ] && check "/c/$c/pdf" 200 application/pdf
fi

exit "$fail"
