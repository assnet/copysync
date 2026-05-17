# MCP — Model Context Protocol (WaioPrime)

Documentação completa da integração MCP no **Cursor IDE** para o monorepo WaioPrime: migração a partir do VS Code/Copilot, configuração de servidores, gestão de secrets via **macOS Keychain** e scripts de automação.

**Público:** desenvolvedores do time com macOS + Cursor.

**Última revisão:** maio/2026 — implementação inicial (Cursor + Keychain).

---

## Índice

1. [O que foi implementado](#1-o-que-foi-implementado)
2. [Por que migramos do formato VS Code](#2-por-que-migramos-do-formato-vs-code)
3. [Arquitetura e fluxo de dados](#3-arquitetura-e-fluxo-de-dados)
4. [Inventário de arquivos](#4-inventário-de-arquivos)
5. [Pré-requisitos](#5-pré-requisitos)
6. [Instalação (novo desenvolvedor)](#6-instalação-novo-desenvolvedor)
7. [Cadastro de secrets no Keychain](#7-cadastro-de-secrets-no-keychain)
7.1. [Criar usuário Postgres read-only (MCP)](#71-criar-usuário-postgres-read-only-mcp)
8. [Abrir o Cursor com MCP ativo](#8-abrir-o-cursor-com-mcp-ativo)
9. [Referência: `mcp.json`](#9-referência-mcpjson)
10. [Referência: scripts shell](#10-referência-scripts-shell)
11. [Referência: Keychain](#11-referência-keychain)
12. [Verificação e debug](#12-verificação-e-debug)
13. [Troubleshooting](#13-troubleshooting)
14. [Segurança e o que pode ir no git](#14-segurança-e-o-que-pode-ir-no-git)
15. [Uso no dia a dia (Agent)](#15-uso-no-dia-a-dia-agent)
16. [Referências externas](#16-referências-externas)

---

## 1. O que foi implementado

| Componente | Descrição |
|------------|-----------|
| **`.cursor/mcp.json`** | Definição dos 5 MCP servers do projeto (sem secrets; usa `${env:...}`) |
| **Scripts Keychain** | `store` / `load` / launcher — equivalente ao Secret Storage do VS Code |
| **`cursor-waioprime`** | Função shell que carrega secrets e abre o Cursor com env correto |
| **Alias `cw`** | Atalho para abrir o monorepo WaioPrime |
| **`install-mcp-scripts.sh`** | Copia scripts para `~/.cursor/` e registra no `~/.zshrc` |
| **Esta documentação** | `.github/MCP_SETUP.md` |

### Servidores MCP configurados

| ID no `mcp.json` | Transporte | Pacote / destino | Credencial |
|------------------|--------------|------------------|------------|
| `postgres-prod-ro` | stdio (`npx`) | `@modelcontextprotocol/server-postgres` | `DATABASE_URL_READONLY` |
| `stripe` | stdio (`npx`) | `@stripe/mcp` | `STRIPE_SECRET_KEY` |
| `github` | stdio (`docker`) | `ghcr.io/github/github-mcp-server` | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| `render` | HTTP | `https://mcp.render.com/mcp` | `RENDER_API_KEY` |
| `context7` | stdio (`npx`) | `@upstash/context7-mcp` | *(nenhuma)* |

---

## 2. Por que migramos do formato VS Code

O VS Code/Copilot usava um `mcp.json` com estrutura própria:

```json
{
  "mcpServers": {
    "inputs": [ { "type": "promptString", "id": "db-ro-url", ... } ],
    "servers": { "postgres-prod-ro": { ... } }
  }
}
```

Problemas ao importar **direto** no Cursor:

| Aspecto | VS Code | Cursor |
|---------|---------|--------|
| Estrutura | `inputs` + `servers` aninhados | Cada servidor **direto** em `mcpServers` |
| Secrets | `${input:id}` → Secret Storage | `${env:NOME}` → ambiente do processo |
| Comentários `//` | JSONC aceito | JSON estrito |
| Prompt na 1ª vez | Sim | Não |

**Solução adotada:** reescrever `mcp.json` no formato Cursor + scripts que leem o **macOS Keychain** (cofre criptografado), aproximando o comportamento do Secret Storage do VS Code.

---

## 3. Arquitetura e fluxo de dados

```mermaid
flowchart TB
  subgraph git [Repositório git]
    MCP_JSON[".cursor/mcp.json"]
    SCRIPTS[".github/scripts/mcp/*.sh"]
    DOC[".github/MCP_SETUP.md"]
  end

  subgraph local [Máquina do desenvolvedor]
    KC[(macOS Keychain)]
    HOME_CURSOR["~/.cursor/"]
    ZSH["~/.zshrc"]
    CURSOR[Cursor IDE]
  end

  SCRIPTS -->|install-mcp-scripts.sh| HOME_CURSOR
  MCP_JSON -->|merge config| CURSOR
  HOME_CURSOR -->|mcp.json global opcional| CURSOR

  STORE[store-mcp-secrets.sh] -->|security add-generic-password| KC
  KC -->|load-mcp-secrets.sh| ENV[Variáveis de ambiente]
  ZSH -->|cursor-waioprime| ENV
  ENV -->|herança de processo| CURSOR
  CURSOR -->|${env:...}| MCP_SERVERS[MCP child processes]
```

### Sequência ao abrir o projeto

1. Desenvolvedor executa `cursor-waioprime` (ou `cw`) no terminal.
2. `load-mcp-secrets.sh` lê 4 entradas do Keychain e faz `export`.
3. CLI `cursor` inicia o Cursor **com esse ambiente**.
4. Cursor carrega `.cursor/mcp.json` (projeto) e/ou `~/.cursor/mcp.json` (global).
5. Cada servidor resolve `${env:VAR}` no momento da conexão.
6. Agent no chat passa a usar tools dos MCPs em **Available Tools**.

> **Crítico:** abrir o Cursor pelo **Dock** ou Spotlight **não** executa o passo 2–3. Os MCPs que dependem de `${env:...}` ficarão sem credencial.

---

## 4. Inventário de arquivos

### No repositório (versionados)

| Caminho | Função |
|---------|--------|
| `.cursor/mcp.json` | Config MCP do projeto (sem valores secretos) |
| `.github/MCP_SETUP.md` | Esta documentação |
| `.github/scripts/mcp/load-mcp-secrets.sh` | Fonte: carrega Keychain → env |
| `.github/scripts/mcp/store-mcp-secrets.sh` | Fonte: grava secrets no Keychain |
| `.github/scripts/mcp/waioprime-mcp.zsh` | Fonte: `cursor-waioprime` + alias `cw` |
| `.github/scripts/mcp/install-mcp-scripts.sh` | Instala cópias em `~/.cursor/` |

### Na máquina local (não versionados)

| Caminho | Função |
|---------|--------|
| `~/.cursor/load-mcp-secrets.sh` | Cópia instalada do script de carga |
| `~/.cursor/store-mcp-secrets.sh` | Cópia instalada do script de cadastro |
| `~/.cursor/waioprime-mcp.zsh` | Cópia instalada do launcher |
| `~/.cursor/mcp.json` | Config global opcional (criada no install se ausente) |
| Keychain (4 serviços `waioprime-mcp-*`) | Valores reais das credenciais |

O `~/.zshrc` ganha uma linha:

```zsh
# WaioPrime MCP (Keychain → Cursor)
[[ -f "$HOME/.cursor/waioprime-mcp.zsh" ]] && source "$HOME/.cursor/waioprime-mcp.zsh"
```

---

## 5. Pré-requisitos

| Requisito | Motivo |
|-----------|--------|
| **macOS** | Scripts usam `security` (Keychain) |
| **Cursor IDE** | Cliente MCP |
| **Node.js + npx** | Servidores `postgres`, `stripe`, `context7` |
| **Docker Desktop** | Servidor `github` (imagem oficial) |
| **CLI `cursor` no PATH** | Cmd+Shift+P → *Shell Command: Install 'cursor' command in PATH* |
| **zsh** | Funções e alias em `waioprime-mcp.zsh` |
| Credenciais listadas na [seção 7](#7-cadastro-de-secrets-no-keychain) | Uma vez por desenvolvedor |

### Permissões mínimas por serviço

- **Postgres:** usuário dedicado read-only (ex.: `agent_ro`) — apenas `SELECT`
- **Stripe:** [Restricted Key](https://dashboard.stripe.com/apikeys) (`rk_test_` / `rk_live_`) — escopo read-only
- **GitHub:** fine-grained PAT — repositório WaioPrime, leitura + comentário em PR
- **Render:** API key (`rnd_...`) — escopo mínimo para logs/status

---

## 6. Instalação (novo desenvolvedor)

Na raiz do clone do monorepo:

```bash
.github/scripts/mcp/install-mcp-scripts.sh
source ~/.zshrc
```

O instalador:

1. Copia os 3 scripts para `~/.cursor/` com permissão de execução.
2. Adiciona o `source` no `~/.zshrc` (se ainda não existir).
3. Copia `.cursor/mcp.json` → `~/.cursor/mcp.json` **somente se** o global ainda não existir.

Opcional — apontar o alias `cw` para outro caminho de clone:

```bash
export WAIOPRIME_ROOT="/caminho/para/waioprime"
```

(defina no `~/.zshrc` antes do `source` do `waioprime-mcp.zsh`)

---

## 7. Cadastro de secrets no Keychain

### Cadastrar todos (interativo)

```bash
~/.cursor/store-mcp-secrets.sh
```

### Cadastrar um por vez

```bash
~/.cursor/store-mcp-secrets.sh --one database
~/.cursor/store-mcp-secrets.sh --one stripe
~/.cursor/store-mcp-secrets.sh --one github
~/.cursor/store-mcp-secrets.sh --one render
```

### Listar status (sem exibir valores)

```bash
~/.cursor/store-mcp-secrets.sh --list
```

Saída esperada após cadastro completo:

```text
Itens MCP no Keychain (conta: seu-usuario):
  ✓ database (waioprime-mcp-database-url-readonly)
  ✓ stripe (waioprime-mcp-stripe-secret-key)
  ✓ github (waioprime-mcp-github-pat)
  ✓ render (waioprime-mcp-render-api-key)
```

### Formato esperado de cada valor

| Chave | Variável exportada | Exemplo de formato (não use estes valores) |
|-------|-------------------|---------------------------------------------|
| `database` | `DATABASE_URL_READONLY` | `postgresql://agent_ro:***@host:5432/waioprime` |
| `stripe` | `STRIPE_SECRET_KEY` | `rk_test_...` ou `rk_live_...` |
| `github` | `GITHUB_PERSONAL_ACCESS_TOKEN` | `github_pat_...` |
| `render` | `RENDER_API_KEY` | `rnd_...` |

---

## 7.1. Criar usuário Postgres read-only (MCP)

O MCP `postgres-prod-ro` usa `@modelcontextprotocol/server-postgres` com uma **connection string** de um usuário que só pode fazer `SELECT`. Não é API key — é um **role/login** no PostgreSQL.

Convenção do projeto: usuário `agent_ro` (pode usar outro nome; ajuste a URL).

### 1. Gerar senha forte

```bash
openssl rand -base64 24
```

Guarde em local seguro; você vai colar no Keychain depois (`store-mcp-secrets.sh --one database`).

### 2. Conectar como administrador

Use um usuário com permissão para `CREATE ROLE` e `GRANT` (ex.: owner do banco no Render, ou `waioprime` no Docker local).

**Local (Docker / dev)** — porta do `.env.dev` costuma ser `5440`:

```bash
psql "postgresql://waioprime:waioprime@localhost:5440/waioprime"
```

**Produção (Render)** — no dashboard: PostgreSQL → *Connect* → *External Connection String* (usuário admin). Em geral exige SSL:

```bash
psql "postgresql://ADMIN_USER:ADMIN_PASS@HOST:5432/waioprime?sslmode=require"
```

### 3. SQL — criar role read-only

Execute **conectado ao banco `waioprime`** (substitua `SUA_SENHA_FORTE`):

```sql
-- Role de login só para leitura (MCP / agentes)
CREATE ROLE agent_ro WITH
  LOGIN
  PASSWORD 'SUA_SENHA_FORTE'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;

-- Acesso ao banco e ao schema Prisma (public)
GRANT CONNECT ON DATABASE waioprime TO agent_ro;
GRANT USAGE ON SCHEMA public TO agent_ro;

-- Tabelas existentes (snake_case — schema Prisma do WaioPrime)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agent_ro;

-- Tabelas criadas no futuro por migrations
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO agent_ro;

-- Opcional: sequences (só se o MCP/consulta precisar de currval — em geral não)
-- GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO agent_ro;
```

**Não conceda:** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, nem `ALL PRIVILEGES`.

### 4. Validar

```sql
-- Deve listar apenas SELECT nas tabelas do app
\dp public.*

-- Teste como agent_ro (outro terminal)
-- psql "postgresql://agent_ro:SUA_SENHA@localhost:5440/waioprime"
SELECT COUNT(*) FROM tenants;
-- Deve falhar:
-- INSERT INTO tenants (id) VALUES ('test');
```

### 5. Montar `DATABASE_URL_READONLY`

Formato (igual ao `DATABASE_URL` da API, trocando usuário/senha):

```text
postgresql://agent_ro:SUA_SENHA_FORTE@HOST:PORTA/waioprime?schema=public
```

| Ambiente | HOST | PORTA | SSL |
|----------|------|-------|-----|
| Local Docker | `localhost` | `5440` (ver `POSTGRES_PORT` no `.env.dev`) | geralmente não |
| Render prod | host do dashboard Render | `5432` | adicione `&sslmode=require` |

Exemplo **local**:

```text
postgresql://agent_ro:SUA_SENHA_FORTE@localhost:5440/waioprime?schema=public
```

Exemplo **Render**:

```text
postgresql://agent_ro:SUA_SENHA_FORTE@dpg-xxxxx.oregon-postgres.render.com:5432/waioprime?schema=public&sslmode=require
```

### 6. Salvar no Keychain (Cursor)

```bash
~/.cursor/store-mcp-secrets.sh --one database
```

Cole a URL completa quando pedir (entrada oculta).

### 7. Revogar / rotacionar

```sql
-- Nova senha
ALTER ROLE agent_ro WITH PASSWORD 'NOVA_SENHA';

-- Remover acesso
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM agent_ro;
REVOKE USAGE ON SCHEMA public FROM agent_ro;
REVOKE CONNECT ON DATABASE waioprime FROM agent_ro;
DROP ROLE agent_ro;
```

Depois atualize o Keychain com `store-mcp-secrets.sh --one database`.

### Erros comuns

| Erro | Causa | Ação |
|------|-------|------|
| `permission denied for table` | `GRANT SELECT` não aplicado | Rodar bloco GRANT de novo |
| `password authentication failed` | Senha/url errada | Recriar senha ou corrigir URL |
| `SSL required` | Render sem `sslmode=require` | Adicionar na query string |
| MCP conecta no banco errado | URL aponta outro DB | Confirmar nome `waioprime` |

---

## 8. Abrir o Cursor com MCP ativo

```bash
cursor-waioprime /caminho/para/waioprime
```

Ou, com alias padrão (`~/www/waioprime`):

```bash
cw
```

### Modo estrito

Falha se qualquer secret estiver ausente (útil em CI local ou sanity check):

```bash
MCP_SECRETS_STRICT=1 cursor-waioprime .
```

### Apenas recarregar env no shell atual

```bash
source ~/.cursor/load-mcp-secrets.sh
```

---

## 9. Referência: `mcp.json`

Arquivo canônico no repo: [`.cursor/mcp.json`](../.cursor/mcp.json)

### Merge de configuração (Cursor)

- **Projeto:** `.cursor/mcp.json`
- **Global:** `~/.cursor/mcp.json`
- Se o **mesmo nome** de servidor existir nos dois, o do **projeto** tem prioridade.

### Servidor: `postgres-prod-ro`

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres", "${env:DATABASE_URL_READONLY}"]
}
```

- Connection string passada como último argumento.
- Uso: validar queries, índices, presença de `tenantId` em debug.
- **Nunca** use URL com usuário de escrita.

### Servidor: `stripe`

```json
{
  "command": "npx",
  "args": ["-y", "@stripe/mcp"],
  "env": { "STRIPE_SECRET_KEY": "${env:STRIPE_SECRET_KEY}" }
}
```

- Uso: investigar subscriptions, refunds, eventos de billing.

### Servidor: `github`

```json
{
  "command": "docker",
  "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${env:GITHUB_PERSONAL_ACCESS_TOKEN}" }
}
```

- Requer Docker em execução.
- Uso: PRs, issues, status de CI, releases (fluxo AGENTS.md §35).

### Servidor: `render`

```json
{
  "url": "https://mcp.render.com/mcp",
  "headers": { "Authorization": "Bearer ${env:RENDER_API_KEY}" }
}
```

- MCP remoto (HTTP); **não** suporta `envFile`.
- A variável `RENDER_API_KEY` precisa estar no ambiente do processo Cursor.

### Servidor: `context7`

```json
{
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"]
}
```

- Sem credencial.
- Uso: documentação atualizada (Fastify, Prisma, MUI, Baileys, etc.) — peça explicitamente no chat ou use skill `render-deploy` quando aplicável.

---

## 10. Referência: scripts shell

### `store-mcp-secrets.sh`

| Opção | Descrição |
|-------|-----------|
| *(sem args)* | Cadastra os 4 secrets em sequência |
| `--one <chave>` | Cadastra só `database`, `stripe`, `github` ou `render` |
| `--list` | Lista presença no Keychain |
| `-h`, `--help` | Ajuda |

Implementação: `security add-generic-password` com conta `$USER`, serviço `waioprime-mcp-*`, flag `-U` (update se existir).

### `load-mcp-secrets.sh`

- Deve ser usado com **`source`**, não `./load-mcp-secrets.sh`.
- Exporta as 4 variáveis no shell atual.
- Se faltar item: aviso em stderr; exit 1 apenas com `MCP_SECRETS_STRICT=1`.
- **Não imprime** valores dos secrets.

### `waioprime-mcp.zsh`

| Símbolo | Descrição |
|---------|-----------|
| `cursor-waioprime [args...]` | `source` load → executa `cursor` com args |
| `cw` | `cursor-waioprime "${WAIOPRIME_ROOT:-$HOME/www/waioprime}"` |

### `install-mcp-scripts.sh`

Idempotente: não sobrescreve `~/.cursor/mcp.json` existente; não duplica entrada no `~/.zshrc`.

---

## 11. Referência: Keychain

| Chave CLI | Serviço Keychain (`-s`) | Variável `export` |
|-----------|-------------------------|-------------------|
| `database` | `waioprime-mcp-database-url-readonly` | `DATABASE_URL_READONLY` |
| `stripe` | `waioprime-mcp-stripe-secret-key` | `STRIPE_SECRET_KEY` |
| `github` | `waioprime-mcp-github-pat` | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| `render` | `waioprime-mcp-render-api-key` | `RENDER_API_KEY` |

Conta (`-a`): usuário macOS (`$USER`).

### Gerenciar manualmente (avançado)

```bash
# Ver se existe (não exibe senha)
security find-generic-password -s waioprime-mcp-render-api-key -a "$USER"

# Remover
security delete-generic-password -s waioprime-mcp-render-api-key -a "$USER"
```

---

## 12. Verificação e debug

### Checklist pós-instalação

- [ ] `~/.cursor/store-mcp-secrets.sh --list` — 4 itens com ✓
- [ ] `command -v cursor` retorna caminho
- [ ] `docker info` OK (para GitHub MCP)
- [ ] Cursor → **Settings** → **Features** → **Model Context Protocol** — 5 servidores
- [ ] **Output** (Cmd+Shift+U) → **MCP Logs** — sem erro de auth

### Testar env sem abrir o Cursor

```bash
source ~/.cursor/load-mcp-secrets.sh
[[ -n "$DATABASE_URL_READONLY" ]] && echo "DATABASE_URL_READONLY: ok"
[[ -n "$RENDER_API_KEY" ]] && echo "RENDER_API_KEY: ok"
```

Não compartilhe a saída de `echo $VAR` em canais públicos.

### Desabilitar servidor temporariamente

Settings → MCP → toggle off (não remove config).

---

## 13. Troubleshooting

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| MCP vermelho / `auth failed` | Cursor aberto pelo Dock | Fechar app; usar `cw` ou `cursor-waioprime` |
| `${env:...}` vazio nos logs | Secrets não cadastrados | `store-mcp-secrets.sh` |
| `github` não inicia | Docker parado | Abrir Docker Desktop |
| `postgres` connection refused | URL/host/firewall | Validar `DATABASE_URL_READONLY` |
| `stripe` permission denied | Key com escopo amplo demais ou errada | Gerar nova restricted key read-only |
| Keychain pede senha do Mac | Primeiro acesso ao item | Normal; autorizar |
| `cursor: command not found` | CLI não instalada | Install shell command no Cursor |
| Dois `mcp.json` conflitantes | Global + projeto | Renomear servidor duplicado ou alinhar configs |
| `cw` abre pasta errada | Clone em outro path | `export WAIOPRIME_ROOT=...` no `~/.zshrc` |

---

## 14. Segurança e o que pode ir no git

### Pode documentar / versionar

- Este arquivo (`MCP_SETUP.md`)
- `.cursor/mcp.json` com `${env:...}` apenas
- Scripts em `.github/scripts/mcp/` (sem valores secretos)
- Nomes de variáveis e serviços Keychain
- Comandos e troubleshooting

### Nunca versionar

- Tokens, PATs, `rnd_*`, connection strings com senha
- `~/.cursor/mcp-secrets.env` preenchido
- Prints de MCP Logs com headers `Authorization`
- Cópias de `~/.cursor/mcp.json` com valores literais

### Boas práticas

1. Postgres MCP sempre com usuário **read-only**.
2. Stripe: **restricted key**, nunca secret key completa de produção.
3. Rotacionar PAT/keys ao sair membro do time.
4. Não colar secrets em issues, PRs ou Slack.
5. Preferir Keychain a arquivo `.env` plano para MCP.

### Alternativa sem Keychain

Export no `~/.zshrc` (menos isolado, mas válido):

```bash
export DATABASE_URL_READONLY="postgresql://..."
export STRIPE_SECRET_KEY="rk_test_..."
export GITHUB_PERSONAL_ACCESS_TOKEN="github_pat_..."
export RENDER_API_KEY="rnd_..."
```

Abrir sempre via terminal: `cursor .`

---

## 15. Uso no dia a dia (Agent)

| Tarefa | MCP útil |
|--------|----------|
| Validar query / índice / `tenantId` | `postgres-prod-ro` |
| Debug billing / subscription | `stripe` |
| PR, CI, release | `github` |
| Logs e deploy Render | `render` |
| Docs de lib (Fastify, Prisma, Baileys) | `context7` |

O Agent usa tools automaticamente quando relevantes. Para forçar, cite o servidor ou a ação (“consulte o Postgres read-only”, “verifique CI no GitHub”).

Matriz alinhada ao plano interno: [`.cursor/plans/rules_skills_mcps_waioprime_c5f11ded.plan.md`](../.cursor/plans/rules_skills_mcps_waioprime_c5f11ded.plan.md)

---

## 16. Referências externas

- [Cursor — MCP](https://cursor.com/docs/mcp)
- [Cursor — Config interpolation](https://cursor.com/docs/mcp#config-interpolation)
- [Model Context Protocol](https://modelcontextprotocol.io/introduction)
- [Stripe MCP](https://github.com/stripe/agent-toolkit)
- [Render MCP](https://render.com/docs/mcp)

---

## Histórico de mudanças

| Data | Mudança |
|------|---------|
| 2026-05 | Migração VS Code → Cursor; Keychain + scripts; `.cursor/mcp.json` no repo |
