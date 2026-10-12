# Rebranding → CopySync

Este repositório nasceu como cópia do projeto **WaioPrime** e está sendo rebatizado como
**CopySync**. Este documento é a fonte de verdade sobre o que já mudou, o que falta e o que
**não** deve ser renomeado. Atualize-o a cada fase concluída.

## Identidade

| Item | Valor |
|------|-------|
| Nome do produto | **CopySync** |
| Painel (app) | https://copysync.app |
| API | https://api.copysync.app |
| Repositório | git@github.com:assnet/copysync.git |
| Logo (fonte) | `app/public/assets/copysync-logo.png` (1254×1254) |
| Logo 256 px | `app/public/assets/copysync-logo-256x256.png` |

Regra white label (AGENTS.md): nomes de funções, chaves, eventos e componentes descrevem o
**recurso**, nunca a marca. A marca aparece só em texto exibido ao usuário, metadados HTTP
(OpenAPI), `<title>` e assets.

## Fase 1 — Documentação ✅ (2026-10-12, v0.13.1)

Prosa, domínios e caminhos de clone rebatizados em: `README.md`, `api/README.md`,
`AGENTS.md` (seção *Marca e domínios*), `.cursor/MCP_SETUP.md`, `.github/MCP_SETUP.md`,
`.cursor/plans/rules_skills_mcps_copysync_c5f11ded.plan.md` (renomeado),
`.specs/features/service-desk/integracao-api-central.md`, `api/db.instructions.md`,
comentário de cabeçalho em `render.yaml`. Logo adicionado em `app/public/assets/`.

Único ajuste de tooling: o alias `cw` em `.cursor/scripts/mcp/waioprime-mcp.zsh` passou a abrir
`~/www/copysync` (o caminho antigo não existe mais). Rode `.cursor/scripts/mcp/install-mcp-scripts.sh`
para atualizar a cópia em `~/.cursor/`.

Histórico do `CHANGELOG.md` **não** foi reescrito: entradas antigas citam `waioprime.com` porque
descrevem o estado da época.

## Fase 2 — Painel (`app/`) ⏳

Cada item lista o arquivo e o que trocar. Trocar **texto e assets**, não identificadores de recurso.

| Arquivo | Trocar |
|---------|--------|
| `app/index.html` | `<title>WaioPrime</title>` → `CopySync`; favicon → `/assets/copysync-logo-256x256.png` |
| `app/index.html` + `app/src/shared/dom-guardian/DomGuardian.ts` | marcador `data-app="waioprime"` → `data-app="copysync"` **nos dois ao mesmo tempo**, senão o DomGuardian remove os estilos globais |
| `app/src/app/AppLayout.tsx` | logo `src`, `alt`, texto "WaioPrime" (3×), tooltip de versão |
| `app/src/app/AppLayout.tsx` | chave `localStorage` `waioprime-sidebar-collapsed` → `sidebar-collapsed` (white label). Efeito: usuário perde só a preferência de sidebar recolhida |
| `app/src/pages/LoginPage.tsx` | logo, nome (2×) e rodapé "© … WaioPrime" |
| `app/src/features/chat/mock/conversations.mock.ts` | textos de mock citando WaioPrime |
| `app/.env.dev` | `VITE_DEV_PROXY_TARGET`/`VITE_API_URL` → `https://api.copysync.app`; comentário de origem |
| `app/src/utils/resolveMediaUrl.ts` | comentários com `api.waioprime.com` |
| `app/public/assets/` | remover `logo_waiochat.png`, `waio*.png`, `waiochat-pro*.png` **depois** que nada mais referenciar (`grep -rn "logo_waiochat\|waioLogo\|waioFavicon" app/src app/index.html`) |
| `app/package.json` | `"name": "waioprime-app"` → `"copysync-app"` |

Checar i18n: o nome do produto exibido deve vir de uma constante única (ex.: `APP_NAME` em
`app/src/config`), não ficar duplicado em cada tela. Validar modos sistema/claro/escuro com o logo novo
(fundo branco do PNG pode exigir versão com fundo transparente).

## Fase 3 — API (`api/`) ⏳

| Arquivo | Trocar |
|---------|--------|
| `api/src/app/app.ts` | fallback de CORS: `https://copysync.app`, `https://www.copysync.app` (manter os antigos até o DNS antigo ser desligado) |
| `api/src/app/app.ts` | OpenAPI: `title: 'CopySync API'`, descrição, `contact` (`dev@copysync.app`), server de produção `https://api.copysync.app` |
| `api/prisma/seed.ts` | e-mail do usuário seed (`waiopremium@gmail.com`) — decidir novo e-mail; **não** altera banco existente |
| `api/package.json` | `"name": "waioprime-api"` → `"copysync-api"` |

Deploy na Render: cadastrar domínios `copysync.app` (static) e `api.copysync.app` (web) e
atualizar `CORS_ORIGIN` e `VITE_API_URL` nas envs. Só depois remover os domínios antigos.

## Fase 4 — Tooling e infra ⏳ (opcional, baixo valor)

Identificadores abaixo funcionam e são locais ao dev. Renomear exige recadastrar secrets e
recriar volume Docker. Fazer só se houver motivo.

| Onde | Identificador | Custo de renomear |
|------|---------------|-------------------|
| `docker-compose.yml`, `api/db.instructions.md`, `.github/MCP_SETUP.md` | container `waioprime_postgres`, banco/usuário `waioprime` | recriar volume local (perde dados locais) |
| `.cursor/scripts/mcp/*`, `.cursor/MCP_SETUP.md`, `.github/MCP_SETUP.md` | Keychain `waioprime-mcp-*`, função `cursor-waioprime`, env `WAIOPRIME_ROOT` | recadastrar 4 secrets no Keychain + reinstalar scripts |
| `render.yaml` | `name: waioprime` (serviço static) | criar serviço novo na Render |
| `dbeaver.command` | workspace `WaioChat` | caminho local do DBeaver |

## Nunca renomear

- **Banco de produção na Render**: nome `waioprime` e usuário `waiochat_jesus` na `DATABASE_URL`
  (AGENTS.md). Renomear = migração de banco, fora do escopo do rebranding.
- **Chaves de evento interno, rotas HTTP, nomes de tabela/coluna Prisma**: já são white label; não
  contêm marca.
- **Histórico de CHANGELOG e migrations aplicadas**.

## Como verificar

```bash
# referências de marca fora de node_modules/legado (esperado: só Fase 4 + histórico)
grep -rniE 'waio' --exclude-dir=node_modules --exclude-dir=legado1 --exclude-dir=legado2 \
  --exclude-dir=.git --exclude-dir=dist . | grep -v CHANGELOG
```

Após cada fase: `pnpm tsc --noEmit` em `api/` e `app/`, bump de versão nos dois `package.json`
e entrada no `CHANGELOG.md`.
