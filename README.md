### Abrir CURSOR: 17/05/26
source ~/.zshrc   # se ainda não tiver o alias
cursor-waioprime ~/www/copysync

# ou
cw

### Verificar KEYCHAIN MCPs 17/05/26
source ~/.cursor/load-mcp-secrets.sh
[[ -n "$GITHUB_PERSONAL_ACCESS_TOKEN" ]] && echo "ok" || echo "VAZIO"