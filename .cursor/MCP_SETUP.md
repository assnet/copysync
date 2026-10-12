# MCP — setup local (Cursor)

Guia para conectar os MCP servers do CopySync no **Cursor**, sem commitar credenciais no repositório.

## É seguro documentar?

**Sim.** Este arquivo descreve *como* configurar, nomes de variáveis e comandos.

**Nunca coloque no git:**

- URLs de banco com senha
- `rk_live_...`, `rk_test_...`, `rnd_...`, `github_pat_...`
- Conteúdo de `~/.cursor/mcp-secrets.env` (se usar essa abordagem)
- Prints de tela com tokens

Documentar o fluxo reduz risco: o time não “inventa” workarounds que acabam commitando secrets.

---

## Visão geral

| Camada | Onde fica | Vai pro git? |
|--------|-----------|--------------|
| Definição dos servidores | `~/.cursor/mcp.json` (global) ou `.cursor/mcp.json` (projeto) | Só o do **projeto**, sem valores secretos |
| Valores reais | macOS **Keychain** (recomendado) ou env do shell | **Nunca** |
| Scripts pessoais | `~/.cursor/load-mcp-secrets.sh`, `store-mcp-secrets.sh`, `waioprime-mcp.zsh` | **Não** (máquina local) |

No **VS Code/Copilot**, secrets iam para o *Secret Storage* via `${input:...}`.

No **Cursor**, use `${env:NOME}` — o valor precisa existir no ambiente do processo do Cursor quando ele inicia.

---

## Servidores configurados

| Servidor | Uso | Variável de ambiente |
|----------|-----|----------------------|
| `postgres-prod-ro` | `SELECT` read-only em prod (debug) | `DATABASE_URL_READONLY` |
| `stripe` | Subscriptions, refunds, eventos | `STRIPE_SECRET_KEY` |
| `github` | PRs, issues, CI (via Docker) | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| `render` | Logs, deploy, env vars (HTTP MCP) | `RENDER_API_KEY` |
| `context7` | Docs atualizadas de libs | *(nenhuma)* |

### Permissões mínimas

- **Postgres:** usuário `agent_ro` (ou equivalente) — apenas `SELECT`
- **Stripe:** [Restricted Key](https://dashboard.stripe.com/apikeys) read-only
- **GitHub:** fine-grained PAT — escopo neste repositório (read + comentário em PR)
- **Render:** API key com escopo mínimo necessário

---

## Setup no macOS (Keychain — recomendado)

Scripts na máquina local (não versionados):

| Script | Função |
|--------|--------|
| `~/.cursor/store-mcp-secrets.sh` | Grava secrets no Keychain |
| `~/.cursor/load-mcp-secrets.sh` | Exporta variáveis no shell |
| `~/.cursor/waioprime-mcp.zsh` | `cursor-waioprime` e alias `cw` |

### 1. Cadastrar secrets (uma vez)

```bash
~/.cursor/store-mcp-secrets.sh
```

Um item por vez:

```bash
~/.cursor/store-mcp-secrets.sh --one database
~/.cursor/store-mcp-secrets.sh --one stripe
~/.cursor/store-mcp-secrets.sh --one github
~/.cursor/store-mcp-secrets.sh --one render
```

Listar o que já está cadastrado (sem exibir valores):

```bash
~/.cursor/store-mcp-secrets.sh --list
```

### 2. Serviços no Keychain

Identificadores (não são secrets — só nomes de entrada no Keychain):

| Chave no script | Serviço Keychain |
|-----------------|------------------|
| `database` | `waioprime-mcp-database-url-readonly` |
| `stripe` | `waioprime-mcp-stripe-secret-key` |
| `github` | `waioprime-mcp-github-pat` |
| `render` | `waioprime-mcp-render-api-key` |

Conta Keychain: seu usuário macOS (`$USER`).

### 3. Abrir o Cursor com secrets

O Cursor precisa ser iniciado **pelo terminal** para herdar as variáveis:

```bash
source ~/.zshrc   # primeira vez após instalar o alias
cursor-waioprime ~/www/copysync
# ou
cw
```

**Importante:** abrir o Cursor pelo Dock **não** carrega o Keychain automaticamente.

### 4. `mcp.json` global

Arquivo: `~/.cursor/mcp.json`

Usa apenas referências `${env:...}` — sem tokens em texto claro.

---

## Alternativa: variáveis no shell

Sem Keychain, exporte no `~/.zshrc` (menos isolado que o Keychain, mas comum):

```bash
export DATABASE_URL_READONLY="postgresql://..."
export STRIPE_SECRET_KEY="rk_test_..."
export GITHUB_PERSONAL_ACCESS_TOKEN="github_pat_..."
export RENDER_API_KEY="rnd_..."
```

Depois: `cursor .` a partir desse terminal.

---

## Verificação

1. **Cursor** → Settings → Features → Model Context Protocol — servidores sem erro.
2. **Output** (Cmd+Shift+U) → **MCP Logs** — auth/conexão.
3. No terminal, antes de abrir o Cursor:

   ```bash
   source ~/.cursor/load-mcp-secrets.sh
   # Não imprima os valores em logs compartilhados; só confira se existem:
   [[ -n "$RENDER_API_KEY" ]] && echo "RENDER_API_KEY ok"
   ```

### Modo estrito

Falha se faltar qualquer secret:

```bash
MCP_SECRETS_STRICT=1 cursor-waioprime .
```

---

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| MCP vermelho / auth failed | Cursor aberto pelo Dock | Fechar e usar `cursor-waioprime` |
| `database` falha | URL ou usuário sem permissão | Validar `DATABASE_URL_READONLY` e role read-only |
| `github` falha | Docker parado | Iniciar Docker Desktop |
| Variável vazia | Secret não cadastrado | `store-mcp-secrets.sh --one <chave>` |
| Keychain pede senha | Primeiro acesso | Normal no macOS |

---

## Config no repositório (opcional)

Para compartilhar a **lista** de MCPs com o time, crie `.cursor/mcp.json` no projeto com o mesmo formato, sempre com `${env:...}`.

O merge do Cursor: config do projeto + `~/.cursor/mcp.json` (projeto tem prioridade em nomes iguais).

---

## Checklist de segurança

- [ ] Nenhum token em `mcp.json` commitado
- [ ] Nenhum `.env` com secrets de MCP no git
- [ ] Postgres MCP usa usuário **read-only**
- [ ] Stripe usa **restricted key**, não secret key completa
- [ ] PAT GitHub com escopo mínimo
- [ ] Não colar tokens em issues, PRs ou Slack

---

## Referências

- [Cursor — MCP](https://cursor.com/docs/mcp)
- [Cursor — config interpolation (`${env:...}`)](https://cursor.com/docs/mcp#config-interpolation)
- Plano interno: `.cursor/plans/rules_skills_mcps_copysync_c5f11ded.plan.md`
