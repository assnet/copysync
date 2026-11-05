#!/usr/bin/env bash
# Redis descartável para testes de integração (BullMQ/pub-sub), SEM tocar api/.env (produção).
#
#   scripts/redis-descartavel.sh start   # sobe container redis:7 efêmero em porta livre, imprime a URL
#   scripts/redis-descartavel.sh stop    # derruba e remove o MESMO container que o start subiu
#
# Depois de `start`:  INTEGRATION_REDIS_URL=<url> pnpm test:int:redis
# Só 127.0.0.1, sem persistência (sem RDB/AOF). Porta: REDIS_INT_PORT ou a 1ª livre a partir de 56379.
# Nome do container: REDIS_INT_NAME ou `copysync-redis-int-<porta>` (único por execução). O nome fica
# em $TMPDIR/copysync-redis-int/name; jobs paralelos usam TMPDIR próprio (como o do Postgres).
set -euo pipefail

command -v docker >/dev/null || { echo "docker não encontrado." >&2; exit 1; }

STATE_DIR="${TMPDIR:-/tmp}/copysync-redis-int"
STATE_FILE="$STATE_DIR/name"

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

stop_saved() {
  if [[ -f "$STATE_FILE" ]]; then docker rm -f "$(cat "$STATE_FILE")" >/dev/null 2>&1 || true; fi
  rm -rf "$STATE_DIR"
}

case "${1:-}" in
  start)
    stop_saved   # start repetido no mesmo TMPDIR não deixa container órfão
    mkdir -p "$STATE_DIR"
    PORT="${REDIS_INT_PORT:-56379}"
    started=""
    for _ in $(seq 1 20); do
      if [[ -n "${REDIS_INT_PORT:-}" ]] || port_free "$PORT"; then
        NAME="${REDIS_INT_NAME:-copysync-redis-int-${PORT}}"
        docker rm -f "$NAME" >/dev/null 2>&1 || true
        if docker run -d --rm --name "$NAME" -p "127.0.0.1:${PORT}:6379" redis:7 \
          redis-server --save '' --appendonly no >/dev/null; then
          started=1; break
        fi
        # porta tomada entre o teste e o bind (start paralelo): porta fixa não tenta outra
        [[ -n "${REDIS_INT_PORT:-}" ]] && break
      fi
      PORT=$((PORT + 1))
    done
    [[ -n "$started" ]] || { rm -rf "$STATE_DIR"; echo "não foi possível subir o Redis." >&2; exit 1; }
    echo "$NAME" >"$STATE_FILE"
    for _ in $(seq 1 30); do
      [[ "$(docker exec "$NAME" redis-cli ping 2>/dev/null)" == "PONG" ]] && break; sleep 0.5
    done
    echo "INTEGRATION_REDIS_URL=redis://127.0.0.1:${PORT}"
    ;;
  stop)
    if [[ -n "${REDIS_INT_NAME:-}" ]]; then docker rm -f "$REDIS_INT_NAME" >/dev/null 2>&1 || true; fi
    stop_saved
    echo "parado"
    ;;
  *)
    echo "uso: $0 start|stop" >&2; exit 2 ;;
esac
