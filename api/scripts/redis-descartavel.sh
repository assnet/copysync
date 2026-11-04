#!/usr/bin/env bash
# Redis descartável para testes de integração (BullMQ/pub-sub), SEM tocar api/.env (produção).
#
#   scripts/redis-descartavel.sh start   # sobe container redis:7 efêmero em porta livre, imprime a URL
#   scripts/redis-descartavel.sh stop    # derruba e remove o container
#
# Depois de `start`:  INTEGRATION_REDIS_URL=<url> pnpm test:int
# Só 127.0.0.1, sem persistência (sem RDB/AOF). Porta: REDIS_INT_PORT ou a 1ª livre a partir de 56379.
set -euo pipefail

NAME="${REDIS_INT_NAME:-copysync-redis-int}"
command -v docker >/dev/null || { echo "docker não encontrado." >&2; exit 1; }

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

case "${1:-}" in
  start)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    PORT="${REDIS_INT_PORT:-}"
    if [[ -z "$PORT" ]]; then
      PORT=56379
      while ! port_free "$PORT"; do PORT=$((PORT + 1)); done
    fi
    docker run -d --rm --name "$NAME" -p "127.0.0.1:${PORT}:6379" redis:7 \
      redis-server --save '' --appendonly no >/dev/null
    for _ in $(seq 1 30); do
      [[ "$(docker exec "$NAME" redis-cli ping 2>/dev/null)" == "PONG" ]] && break; sleep 0.5
    done
    echo "INTEGRATION_REDIS_URL=redis://127.0.0.1:${PORT}"
    ;;
  stop)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    echo "parado"
    ;;
  *)
    echo "uso: $0 start|stop" >&2; exit 2 ;;
esac
