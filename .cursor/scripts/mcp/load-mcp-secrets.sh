#!/usr/bin/env bash
# Carrega secrets MCP do macOS Keychain para variáveis de ambiente.
# Uso: source ~/.cursor/load-mcp-secrets.sh
# Não execute com ./ — use source para exportar no shell atual.

set -euo pipefail

_KEYCHAIN_ACCOUNT="${USER}"
_MCP_LOAD_ERRORS=0

_keychain_get() {
  local service="$1"
  security find-generic-password -s "$service" -a "$_KEYCHAIN_ACCOUNT" -w 2>/dev/null
}

_load_secret() {
  local service="$1"
  local var_name="$2"
  local label="$3"
  local value

  if ! value="$(_keychain_get "$service")"; then
    echo "⚠️  MCP: ${label} ausente no Keychain (serviço: ${service})" >&2
    echo "    Cadastre com: ~/.cursor/store-mcp-secrets.sh" >&2
    _MCP_LOAD_ERRORS=$((_MCP_LOAD_ERRORS + 1))
    return 0
  fi

  if [[ -z "${value}" ]]; then
    echo "⚠️  MCP: ${label} vazio no Keychain (serviço: ${service})" >&2
    _MCP_LOAD_ERRORS=$((_MCP_LOAD_ERRORS + 1))
    return 0
  fi

  export "${var_name}=${value}"
}

_load_secret "waioprime-mcp-database-url-readonly" "DATABASE_URL_READONLY" "Postgres read-only"
_load_secret "waioprime-mcp-stripe-secret-key" "STRIPE_SECRET_KEY" "Stripe restricted key"
_load_secret "waioprime-mcp-github-pat" "GITHUB_PERSONAL_ACCESS_TOKEN" "GitHub PAT"
_load_secret "waioprime-mcp-render-api-key" "RENDER_API_KEY" "Render API key"

if [[ "${_MCP_LOAD_ERRORS}" -gt 0 ]]; then
  if [[ "${MCP_SECRETS_STRICT:-0}" == "1" ]]; then
    echo "❌ MCP: ${_MCP_LOAD_ERRORS} secret(s) faltando (MCP_SECRETS_STRICT=1)." >&2
    return 1
  fi
  echo "ℹ️  MCP: ${_MCP_LOAD_ERRORS} secret(s) faltando — servidores afetados podem falhar no Cursor." >&2
fi

return 0
