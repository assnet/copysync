# WaioPrime — MCP secrets via Keychain + Cursor
# Fonte: .github/scripts/mcp/waioprime-mcp.zsh
# Instalado em ~/.cursor/ pelo install-mcp-scripts.sh

cursor-waioprime() {
  # shellcheck disable=SC1090
  if ! source "${HOME}/.cursor/load-mcp-secrets.sh"; then
    return 1
  fi

  local cursor_cmd=""
  if command -v cursor >/dev/null 2>&1; then
    cursor_cmd="cursor"
  elif [[ -x "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]]; then
    cursor_cmd="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
  else
    echo "CLI 'cursor' não encontrado." >&2
    echo "No Cursor: Cmd+Shift+P → Shell Command: Install 'cursor' command in PATH" >&2
    return 127
  fi

  "${cursor_cmd}" "$@"
}

# Ajuste o caminho do monorepo se o seu clone for diferente:
alias cw='cursor-waioprime "${WAIOPRIME_ROOT:-$HOME/www/waioprime}"'
