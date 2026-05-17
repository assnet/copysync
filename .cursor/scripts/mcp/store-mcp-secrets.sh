#!/usr/bin/env bash
# Grava secrets MCP no macOS Keychain (equivalente ao Secret Storage do VS Code).
# Uso: ~/.cursor/store-mcp-secrets.sh
# Opções: --one <nome>  cadastra só um item
#         --list        lista itens cadastrados (sem exibir valores)

set -euo pipefail

_ACCOUNT="${USER}"

_service_for() {
  case "$1" in
    database) echo "waioprime-mcp-database-url-readonly" ;;
    stripe)   echo "waioprime-mcp-stripe-secret-key" ;;
    github)   echo "waioprime-mcp-github-pat" ;;
    render)   echo "waioprime-mcp-render-api-key" ;;
    *)        return 1 ;;
  esac
}

_label_for() {
  case "$1" in
    database) echo "Postgres read-only (postgresql://agent_ro:...@host:5432/db)" ;;
    stripe)   echo "Stripe restricted key (rk_test_... ou rk_live_...)" ;;
    github)   echo "GitHub fine-grained PAT" ;;
    render)   echo "Render API key (rnd_...)" ;;
    *)        return 1 ;;
  esac
}

_usage() {
  cat <<'EOF'
Uso:
  ~/.cursor/store-mcp-secrets.sh           # cadastra todos (interativo)
  ~/.cursor/store-mcp-secrets.sh --one database
  ~/.cursor/store-mcp-secrets.sh --list

Chaves: database | stripe | github | render
EOF
}

_keychain_exists() {
  local service="$1"
  security find-generic-password -s "$service" -a "$_ACCOUNT" >/dev/null 2>&1
}

_keychain_set() {
  local service="$1"
  local label="$2"
  local secret

  echo ""
  echo "→ ${label}"
  if _keychain_exists "$service"; then
    read -r -p "  Já existe no Keychain. Substituir? [s/N] " replace
    if [[ ! "${replace}" =~ ^[sS]$ ]]; then
      echo "  Ignorado."
      return 0
    fi
    security delete-generic-password -s "$service" -a "$_ACCOUNT" >/dev/null 2>&1 || true
  fi

  read -r -s -p "  Valor (oculto): " secret
  echo ""
  if [[ -z "${secret}" ]]; then
    echo "  Valor vazio — ignorado."
    return 0
  fi

  security add-generic-password \
    -s "$service" \
    -a "$_ACCOUNT" \
    -w "${secret}" \
    -U \
    -T /usr/bin/security \
    -T /usr/bin/env

  echo "  ✓ Salvo no Keychain (${service})"
}

_store_one() {
  local key="$1"
  local service label

  service="$(_service_for "$key")" || {
    echo "Chave inválida: ${key}" >&2
    _usage
    exit 1
  }
  label="$(_label_for "$key")"
  _keychain_set "$service" "$label"
}

_list() {
  local key service
  echo "Itens MCP no Keychain (conta: ${_ACCOUNT}):"
  for key in database stripe github render; do
    service="$(_service_for "$key")"
    if _keychain_exists "$service"; then
      echo "  ✓ ${key} (${service})"
    else
      echo "  ✗ ${key} (não cadastrado)"
    fi
  done
}

main() {
  case "${1:-}" in
    --list)
      _list
      exit 0
      ;;
    --one)
      if [[ -z "${2:-}" ]]; then
        echo "Informe a chave: database | stripe | github | render" >&2
        exit 1
      fi
      _store_one "$2"
      exit 0
      ;;
    -h|--help)
      _usage
      exit 0
      ;;
    "")
      echo "Cadastro de secrets MCP WaioPrime → macOS Keychain"
      echo "Os valores NÃO ficam em mcp.json nem em arquivos .env."
      for key in database stripe github render; do
        _store_one "$key"
      done
      echo ""
      echo "Pronto. Abra o projeto com: cursor-waioprime <pasta-do-repo>"
      exit 0
      ;;
    *)
      echo "Opção desconhecida: $1" >&2
      _usage
      exit 1
      ;;
  esac
}

main "$@"
