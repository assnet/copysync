# Extensão Chrome (MV3)

Sincroniza a sessão de afiliado do marketplace (cookie `ssid` + CSRF da página) com o painel,
para o tenant gerar links de afiliado sem o operador colar credenciais à mão.
Doc de projeto (arquitetura, contrato com a API, proteção, publicação): [`../docs/extensao-navegador.md`](../docs/extensao-navegador.md).

## Rodar

```bash
cd extension
pnpm i
cp .env.example .env       # produção (pnpm build)
cp .env.example .env.dev   # desenvolvimento (pnpm dev) — edite API_URL/DEV
pnpm dev                   # webpack --watch, bundle em dist/
```

Em `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem compactação** → pasta `dist/`.
O `key` do manifest mantém o mesmo ID da extensão em qualquer máquina.

| Comando | O que faz |
|---|---|
| `pnpm dev` | build de desenvolvimento com watch, usa `.env.dev`, logs ligados |
| `pnpm build` | build de produção (`.env`), Terser remove `console.*`, roda `check-dist` |
| `pnpm type-check` | `tsc --noEmit` + `check-cookie-scope` + `check-i18n` |
| `pnpm check:dist` | valida `dist/` (versão, sem localhost, sem `_metadata`, host da API presente) |

## Variáveis de ambiente (`.env` / `.env.dev`)

| Variável | Uso |
|---|---|
| `NAME_APP` | nome exibido (white label); em HTML/manifest o nome vem de `_locales` |
| `API_URL` | base da API **com** `/api`, sem barra final |
| `PANEL_URL` | link "Abrir painel" do popup |
| `DEV` | `true` só no `.env.dev`: liga `devLog` e `lastErrorDetail` |
| `SESSION_SYNC_INTERVAL_MINUTES` | período do alarme de renovação |

Só `src/config/env.ts` lê `process.env`. O `dotenv-webpack` substitui os valores no bundle.

## Fluxo

1. **Login** no popup → `POST /auth/login` → `accessToken`, `refreshToken`, `tenants` em `chrome.storage.local`
   (tenant ativo = primeiro da lista; trocável no popup).
2. **Captura** (`background/marketplaceSession.ts`): cookie `ssid` do domínio do marketplace →
   aba aberta do marketplace → CSRF via content script (`page/get-csrf`), com fallback
   `chrome.scripting.executeScript` para abas abertas antes da instalação.
3. **PUT** `/integrations/affiliate-credentials/MERCADO_LIVRE/session` com `Authorization: Bearer`
   e `X-Tenant-Id`. Em 401, um refresh e repete; se falhar, limpa a auth.
4. Repetido pelo alarme `affiliate-session-sync` a cada `SESSION_SYNC_INTERVAL_MINUTES` e pelo
   botão "Sincronizar agora". Resultado em `SyncState` (`idle|syncing|ok|error` + `lastErrorCode`).

## Onde fica cada coisa

```
src/
  config/env.ts            único leitor de process.env; constantes do marketplace
  contract/api.ts          tipos HTTP (espelham os presenters da API)
  contract/messages.ts     RuntimeRequest/Response, SyncErrorCode, STORAGE_KEYS
  core/devLog.ts           log gated por DEV
  core/i18n.ts             t() e applyI18n() sobre chrome.i18n
  background/index.ts      listeners (alarme, onMessage) — nenhuma regra aqui
  background/apiClient.ts  único lugar que monta URL; traduz erros para SyncErrorCode
  background/authStore.ts  chrome.storage.local
  background/marketplaceSession.ts  ÚNICO uso de chrome.cookies (domínio do marketplace)
  background/syncSession.ts         runSync com mutex e SyncState
  background/errors.ts     SyncError
  content/index.ts         responde page/get-csrf (sem polling, sem DOM)
  popup/                   UI (HTML + TS + CSS), temas sistema/claro/escuro
public/
  manifest.json            version é sobrescrita pelo webpack com a do package.json
  _locales/{pt_BR,en}      todas as strings exibidas
scripts/                   guardas (check-dist, check-cookie-scope, check-i18n)
```

## O que NÃO fazer

- **URL literal** em `src/` — toda URL nasce de `env.apiUrl`/`env.panelUrl` (`check-dist` falha com localhost no build).
- **`chrome.cookies` fora de `background/marketplaceSession.ts`** ou sem `MARKETPLACE_COOKIE_DOMAIN` (`check-cookie-scope`).
- **Ler cookie da própria API.** A API autentica por token; cookie é só do marketplace.
- **Texto exibido fora de `_locales`** — use `t('chave')`/`data-i18n` (`check-i18n` exige paridade pt_BR ⇄ en).
- **`process.env` fora de `config/env.ts`.**
- **Propagar texto cru da API** — erros viram `SyncErrorCode` (`err_*` nas locales).
- **Nome de marca em identificadores** — o nome só em `NAME_APP` e `_locales`.
- **Editar `version` no manifest** — bump em `package.json`; o webpack copia.
- **Commitar `.keys/*.pem`, `.env`, `.env.dev`, `dist/`** (já no `.gitignore`).
