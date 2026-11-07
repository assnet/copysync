# Extensão Chrome (MV3)

Sincroniza a sessão de afiliado do Mercado Livre (cookies de identidade via `chrome.cookies`) com o
painel, para o tenant gerar links de afiliado sem colar credenciais à mão. Só um content script (proxy do canal
na origem do painel, para Orion), sem popup, sem login na extensão: o painel autentica e fala com ela por `externally_connectable`.

- Arquitetura, canal e contrato com a API: [`../docs/extensao-navegador.md`](../docs/extensao-navegador.md)
- Build de produção, chaves do CRX, zip de loja e textos da listagem:
  [`../docs/extensao-publicacao-chrome-web-store.md`](../docs/extensao-publicacao-chrome-web-store.md)

## Rodar em desenvolvimento

```bash
cd extension
pnpm i
cp .env.example .env       # produção (pnpm build / pack:*)
cp .env.example .env.dev   # desenvolvimento — edite API_URL, PANEL_URL, DEV=true, DEV_ORIGINS
pnpm dev                   # webpack --watch, bundle em dist/
```

`chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem compactação** → pasta `dist/`.
O `key` do manifest mantém o ID `nokcbnoicaebghagbhlfcbepheohdgnd` em qualquer máquina; a API
precisa de `EXTENSION_ORIGINS=chrome-extension://<id>` e o painel de `VITE_EXTENSION_IDS=<id>`.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | build de desenvolvimento com watch (`.env.dev`), logs ligados |
| `pnpm build` | produção (`.env`), Terser remove `console.*`, roda `check-dist`; manifest **com** `key` |
| `pnpm build:store` | idem **sem** `key` (exigência da Web Store), em `dist-store/`; `dist/` nunca fica sem `key` |
| `pnpm type-check` | `tsc --noEmit` + `check-cookie-scope` + `check-i18n` + `check-contract-sync` |
| `pnpm test` | vitest |
| `pnpm keys:id` | imprime o ID da extensão; falha se `manifest.key` ≠ `.keys/extension-private.pem` |
| `pnpm keys:generate` | gera par RSA 2048 em `.keys/` (recusa sobrescrever — trocar chave troca o ID) |
| `pnpm pack:crx` | `build` + `chrome --pack-extension` assinado → `release/<name>-<versão>.crx` |
| `pnpm pack:store` | `build:store` + zip do conteúdo de `dist-store/` → `release/<name>-<versão>-store.zip` |
| `pnpm pack:store:first` | igual, com `key.pem` na raiz do zip — só no primeiro upload de listagem nova |
| `pnpm release` | `type-check` → `test` → `pack:crx` → `pack:store` |

## Variáveis de ambiente (`.env` / `.env.dev`)

| Variável | Uso |
|---|---|
| `NAME_APP` | nome exibido (white label); em manifest/locales o nome vem de `_locales` |
| `API_URL` | base da API **com** `/api`, sem barra final → `host_permissions` |
| `PANEL_URL` | origem do painel → `externally_connectable.matches` e `host_permissions` (foco da aba) |
| `DEV` | `true` só no `.env.dev`: liga `devLog` e aceita `DEV_ORIGINS` |
| `DEV_ORIGINS` | origens extras do painel em dev (`http://localhost:5173/*`), ignorado em produção |
| `SESSION_SYNC_INTERVAL_MINUTES` | período do alarme de renovação |

Só `src/config/env.ts` lê `process.env`. O `dotenv-webpack` substitui os valores no bundle.

## Fluxo

1. Painel (`/settings/extension`) detecta a extensão pelo ID e faz `handshake` via
   `chrome.runtime.sendMessage` (envelope `cs-ext` v1).
2. Painel chama `POST /api/extension/session` (Bearer + tenant) → API emite cookie HttpOnly
   `__Host-ext_session` para a extensão. Sem senha nem token na extensão.
3. `marketplaceSession.ts` lê `ssid`, `orguseridp`, `orgnickp`, `orguserid` de `mercadolivre.com.br`
   e calcula SHA-256; mudança dispara sync (debounce 60 s, limite 15 min).
4. `syncSession.ts` → `PUT /api/extension/marketplaces/ml/session` com cookie. Erros viram
   `SyncErrorCode` → `err_*` nas locales. Heartbeat e alarme de reserva em `lifecycle.ts`.
5. Clique no ícone foca a aba do painel aberta ou abre uma nova.

## Onde fica cada coisa

```
src/
  config/env.ts              único leitor de process.env
  contract/channel.ts        envelope, ops e erros do canal (espelho em app/src/features/extension/contract/)
  core/{devLog,i18n}.ts      log gated por DEV; t() sobre chrome.i18n
  background/index.ts        listeners (alarmes, onMessageExternal, cookies.onChanged, action) — sem regra
  background/channel/        pipeline origin → versão → envelope → guard → handler → sanitize
  background/apiFetch.ts     fetch(credentials:'include'); traduz status HTTP → SyncErrorCode
  background/sessionResolver.ts  GET /me com single-flight + cache 5 min
  background/marketplaceSession.ts  ÚNICO uso de chrome.cookies
  background/syncSession.ts  runSync com mutex, rate limit e SyncState
  background/lifecycle.ts    alarmes, heartbeat, eventos install/update/uninstall
  background/store.ts        chrome.storage.local (SyncState, settings, installationId)
public/
  manifest.json              version/host_permissions/externally_connectable escritos pelo webpack
  _locales/{pt_BR,en}        todas as strings exibidas
scripts/                     guardas (check-*) e empacotamento (extension-id, keys-generate, pack-*)
.keys/                       extension-private.pem (segredo, fora do git) + public-key.b64
dist-store/                  build de loja (sem key) — nunca carregar no Chrome
release/                     .crx e .zip gerados (fora do git)
```

## O que NÃO fazer

- **URL literal** em `src/` — toda URL nasce de `env.apiUrl`/`env.panelUrl` (`check-dist` barra localhost).
- **`chrome.cookies` fora de `background/marketplaceSession.ts`** (`check-cookie-scope`).
- **Ler cookie da própria API.** A API autentica por cookie HttpOnly que a extensão não lê.
- **Texto exibido fora de `_locales`** — `t('chave')`; `check-i18n` exige paridade pt_BR ⇄ en.
- **`process.env` fora de `config/env.ts`.**
- **Propagar texto cru da API** — erros viram `SyncErrorCode`.
- **Nome de marca em identificadores** — só em `NAME_APP` e `_locales`.
- **Editar `version`/`host_permissions`/`externally_connectable` no manifest** — vêm de `package.json` e `.env`.
- **Permissão `tabs`/`scripting`/content script além do `panel-bridge.js`** — `check-dist` barra; `tabs` gera aviso "ler histórico".
- **Trocar ou perder `.keys/extension-private.pem`** — muda o ID e quebra API, painel e instalações.
- **Carregar `dist-store/` sem compactação** — sem `key` o Chrome deriva outro ID e o painel não acha a extensão.
- **Commitar `.keys/*.pem`, `.env*`, `dist/`, `dist-store/`, `release/`, `*.crx`, `*.zip`.**
