#!/usr/bin/env bash
# Postgres descartável para testes de integração e validação de migrations, SEM tocar api/.env (produção).
#
#   scripts/postgres-descartavel.sh start   # sobe cluster efêmero (Homebrew postgresql@16), aplica migrations, imprime a URL
#   scripts/postgres-descartavel.sh stop    # derruba e apaga o cluster
#
# Depois de `start`:  INTEGRATION_DATABASE_URL=<url> pnpm test:int
# Só TCP em 127.0.0.1 (porta 55432), fuso UTC (colunas `timestamp` sem fuso são gravadas em UTC).
set -euo pipefail

PORT="${PG_INT_PORT:-55432}"
DIR="${TMPDIR:-/tmp}/copysync-pg-int"
DB="copysync_int"
URL="postgresql://postgres@127.0.0.1:${PORT}/${DB}"
API_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PGBIN="$(ls -d /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin 2>/dev/null | head -1 || true)"
if [[ -z "$PGBIN" ]]; then
  echo "postgresql@16 do Homebrew não encontrado (brew install postgresql@16)." >&2
  exit 1
fi
export PATH="$PGBIN:$PATH"

case "${1:-}" in
  start)
    rm -rf "$DIR"; mkdir -p "$DIR"
    initdb -D "$DIR/data" -U postgres -A trust >/dev/null
    pg_ctl -D "$DIR/data" -o "-p $PORT -k '' -c listen_addresses=127.0.0.1" -l "$DIR/log" start >/dev/null
    for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p "$PORT" -U postgres >/dev/null 2>&1 && break; sleep 0.5; done
    psql -h 127.0.0.1 -p "$PORT" -U postgres -qc "CREATE DATABASE $DB;" -c "ALTER DATABASE $DB SET timezone='UTC';"
    # Schema + migrations copiados para fora de api/: o `prisma` nunca lê api/.env
    rm -rf "$DIR/prisma"; mkdir -p "$DIR/prisma"
    cp "$API_DIR/prisma/schema.prisma" "$DIR/prisma/"; cp -R "$API_DIR/prisma/migrations" "$DIR/prisma/"
    (cd "$API_DIR" && DATABASE_URL="$URL" npx prisma migrate deploy --schema "$DIR/prisma/schema.prisma" | tail -2)
    echo "INTEGRATION_DATABASE_URL=$URL"
    ;;
  stop)
    if [[ -d "$DIR/data" ]]; then pg_ctl -D "$DIR/data" stop >/dev/null 2>&1 || true; fi
    rm -rf "$DIR"
    echo "parado"
    ;;
  *)
    echo "uso: $0 start|stop" >&2; exit 2 ;;
esac
