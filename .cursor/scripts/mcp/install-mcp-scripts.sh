#!/usr/bin/env bash
# Instala scripts MCP WaioPrime em ~/.cursor/ e registra no ~/.zshrc
# Uso (na raiz do repo): .github/scripts/mcp/install-mcp-scripts.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC_DIR="${REPO_ROOT}/.github/scripts/mcp"
DEST_DIR="${HOME}/.cursor"
ZSHRC="${HOME}/.zshrc"
MARKER="# WaioPrime MCP (Keychain → Cursor)"

mkdir -p "${DEST_DIR}"

for f in load-mcp-secrets.sh store-mcp-secrets.sh; do
  cp "${SRC_DIR}/${f}" "${DEST_DIR}/${f}"
  chmod +x "${DEST_DIR}/${f}"
  echo "✓ ${DEST_DIR}/${f}"
done

cp "${SRC_DIR}/waioprime-mcp.zsh" "${DEST_DIR}/waioprime-mcp.zsh"
echo "✓ ${DEST_DIR}/waioprime-mcp.zsh"

if [[ -f "${HOME}/.cursor/mcp.json" ]]; then
  echo "ℹ️  ~/.cursor/mcp.json já existe — não sobrescrito."
else
  if [[ -f "${REPO_ROOT}/.cursor/mcp.json" ]]; then
    cp "${REPO_ROOT}/.cursor/mcp.json" "${HOME}/.cursor/mcp.json"
    echo "✓ Copiado .cursor/mcp.json → ~/.cursor/mcp.json"
  fi
fi

if grep -qF "${MARKER}" "${ZSHRC}" 2>/dev/null; then
  echo "ℹ️  Entrada já presente em ~/.zshrc"
else
  printf '\n%s\n[[ -f "$HOME/.cursor/waioprime-mcp.zsh" ]] && source "$HOME/.cursor/waioprime-mcp.zsh"\n' "${MARKER}" >> "${ZSHRC}"
  echo "✓ Registrado em ~/.zshrc"
fi

echo ""
echo "Próximos passos:"
echo "  1. source ~/.zshrc"
echo "  2. ~/.cursor/store-mcp-secrets.sh"
echo "  3. cursor-waioprime ${REPO_ROOT}"
echo ""
echo "Documentação: .github/MCP_SETUP.md"
