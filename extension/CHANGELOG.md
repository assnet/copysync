# Changelog — CopySync Extension

## [3.3.0] — 2026-11-07 — Instalação registrada desde o primeiro minuto

> Exige nova publicação na Chrome Web Store (`pnpm pack:store` / `pack:upload`). Sem permissão nova.

### Added

- **`content/panelBridge.ts`** + **`content/index.ts`** (`panel-bridge.js`) — proxy do canal para navegador sem `externally_connectable` (Orion): `window.postMessage` ⇄ content script na origem do painel ⇄ `chrome.runtime.sendMessage` ⇄ worker, mesmo envelope. Valida `source`, origem exata (`core/panelOrigin.ts`), formato e id endereçado; só o envelope de resposta volta à página. `background/channel/proxy.ts` revalida remetente/origem e usa a mesma `handleMessage`. Manifest ganha `content_scripts` nas mesmas origens do `externally_connectable` (já em `host_permissions`: sem aviso de permissão novo).
- **`store.ts`** — `ensureInstallation()`: get-or-create single-flight (`crypto.randomUUID()`, `extensionId: chrome.runtime.id`) usado por boot, onInstalled, lifecycle e handshake; nunca gera dois `installationId`. Slot `lifecyclePending` para o INSTALL que falhou.
- **`uninstallUrl.ts`** — `buildUninstallUrl(panelUrl, installationId, extensionId, version)` pura: `<panel>/extension-removed?i=&e=&v=` via `URL`/`URLSearchParams`; `null` com painel vazio/inválido ou acima de 1023 chars (limite do Chrome).
- **`panelTab.ts`** — busca da aba do painel por URL (host_permissions, sem `tabs`) extraída do `index.ts`; `focusPanelTabIfOpen()` foca a aba do painel na primeira instalação, sem abrir aba nova.
- **`lifecycle.ts`** — `flushPendingLifecycle()` reenvia o INSTALL pendente no alarme de heartbeat e no startup; limpa no sucesso ou em erro definitivo (4xx).
- Testes: `uninstallUrl.test.ts`, `lifecycle.test.ts` (idempotência, body, pendente reenviado e limpo).

### Fixed

- **`lifecycle.ts`** — INSTALL nunca era enviado: o `installationId` só nascia no handshake do painel e o evento era pulado. Agora cria a instalação antes de enviar. Body ganha `extensionId` (a API cria a instalação sem dono); `dedupeKey` do INSTALL passa a `INSTALL` (uma vez por instalação), UPDATE `UPDATE:<versão>`.
- **`index.ts`** + **`lifecycle.ts`** — URL de desinstalação definida no boot do service worker, em onInstalled/onStartup e após `bridge.identify`; antes ficava ausente até o próximo startup. Removido o `const installation = undefined` morto.
- **`vitest.config.ts`** — alias do mock de `env` com caminho absoluto (o relativo não resolvia para módulos que importam `../config/env.js`).

## [3.2.2] — 2026-11-04 — Revalidação da sessão do ML

### Added

- **`scripts/pack-crx.mjs`** — modo `--upload` (`pnpm pack:upload`): assina `dist-store/` com `.keys/verified-upload-private.pem` (par separado da chave do item) → `release/<name>-<versão>-upload.crx`, o pacote aceito pela loja com "uploads de CRX verificados" ativo; `pnpm release` passa a gerá-lo.

### Fixed

- **`syncSession.ts`** — alarme de reserva (60 min) envia a sessão mesmo sem mudança no hash; antes o servidor ficava dias sem revalidar e o card mostrava "Recusada" com o navegador logado. Hash só pula em `cookie-changed`/`startup`.
- **`syncSession.ts`** + **`apiFetch.ts`** — PUT da sessão com timeout de 25s (`timeoutMs`); os 10s padrão desistiam antes do servidor terminar (bootstrap + etiqueta no ML) e o painel mostrava falha com a sessão gravada.

## [3.2.1] — 2026-11-02 — Empacotamento de produção (CRX + Web Store)

### Added

- **`scripts/extension-id.mjs`** — ID a partir da `.pem`/`manifest.key`, com checagem de paridade (`pnpm keys:id`)
- **`scripts/keys-generate.mjs`** — par RSA 2048 PKCS#8 em `.keys/`, nunca sobrescreve (`pnpm keys:generate`)
- **`scripts/pack-crx.mjs`** — CRX3 assinado via `chrome --pack-extension` → `release/` (`pnpm pack:crx`)
- **`scripts/pack-store.mjs`** — zip de loja sem `key`, `--with-key` para o primeiro upload (`pnpm pack:store`, `pack:store:first`)
- **`package.json`** — `pnpm release` = type-check → test → pack:store → pack:crx
- **`scripts/store-assets.mjs`** — ícone 128, tile 440×280 e letreiro 1400×560 da listagem (`pnpm store:assets`, saída em `store-assets/`, fora do git)
- **`.gitignore`** — `release/`, `*.crx`, `*.pem`
- Doc: `docs/extensao-publicacao-chrome-web-store.md`

### Fixed

- **`build:store`** — passa `STORE_BUILD=true` ao `check-dist` (a checagem "sem key no build de loja" nunca rodava)
- **`webpack.js`**, **`check-dist.mjs`**, **`pack-store.mjs`** — build de loja sai em `dist-store/`; `dist/` (carregado sem compactação) nunca fica sem `key`. Causa raiz: extensão carregada de `dist/` durante um build de loja recebeu ID derivado do caminho e o painel não a encontrava. `check-dist` agora falha se `dist/manifest.json` estiver sem `key`
- **`README.md`** — removidas referências a popup, login por senha e content script (fora desde a 3.0.0)

## [3.0.0] — 2026-10-27 — Cookie-based auth + channel architecture

### Breaking Changes

- **Autenticação por cookie**: login/senha removido. Sessão via `__Host-ext_session` HttpOnly cookie emitido pela API (`POST /api/extension/session`). O painel inicia a autenticação; a extensão não tem mais formulário de login.
- **Content script removido**: nenhum script é injetado em páginas. ML cookies lidos via `chrome.cookies` API.
- **Permissões reduzidas**: `scripting`, `tabs` e host_permissions `.ar`/`.mx` removidos.
- **Contract channel**: comunicação painel↔extensão agora via `externally_connectable` + envelope tipado (`cs-ext` v1).

### Added

#### Background — Channel pipeline

- **`channel/index.ts`** — Pipeline: origin → version N-1 → envelope filter (TTL 15s, anti-replay 500) → guard → handler → assertNoSecrets
- **`channel/guard.ts`** — Guard por operação: PUBLIC_OPS (handshake, bridge.identify), ML_OPS requerem sessão + mlTenantId + tenant ativo + permissão `ml.session`
- **`channel/handlers.ts`** — Handlers: handshake, bridge.identify, session.changed, ml.status, ml.syncSession
- **`channel/sanitize.ts`** — `assertNoSecrets` strip de cookies ML, csrf, auth headers nos payloads de resposta

#### Background — Auth e resolução

- **`apiFetch.ts`** — HTTP client com `credentials:'include'`, headers `X-Client`/`X-Installation-Id`. Mapeia 401→session_expired, 403→forbidden, 404→api_route_missing, 429→rate_limited
- **`sessionResolver.ts`** — `resolverSessao`/`invalidarSessao` com single-flight fetch + TTL cache 5min (padrão PulsoSocial)
- **`store.ts`** — Storage: SyncState, StoredSettings (theme), InstallationState, mlCookieHash, lastSyncEpoch. Write queue para serialização

#### Background — ML sync

- **`marketplaceSession.ts`** — Leitura de cookies ML via `chrome.cookies.getAll`. SHA-256 hash para detecção de mudança
- **`syncSession.ts`** — `PUT /api/extension/marketplaces/ml/session` com cookie auth. Rate limit 15min. Triggers: alarm, manual, channel, cookie-changed, startup
- **`constants.ts`** — Listas de cookies ML (paridade com API), alarmes, rate limits, canal

#### Background — Lifecycle

- **`lifecycle.ts`** — Alarmes (heartbeat 30min, reserve sync 60min), uninstall URL, eventos INSTALL/UPDATE/STARTUP via `POST /api/extension/lifecycle/event`

#### Contract

- **`contract/channel.ts`** — Envelope tipado, error codes, ops v1. Cópia espelhada em `app/src/features/extension/contract/channel.ts` (paridade por `check-contract-sync.mjs`)

#### Scripts

- **`check-contract-sync.mjs`** — Verifica paridade channel.ts entre extension/ e app/
- **`check-dist.mjs`** — v3 checks: no content_scripts, no scripting/tabs, externally_connectable obrigatório, no .ar/.mx host_permissions, no key em store build
- **`check-cookie-scope.mjs`** — Aceita `cookies.onChanged` em index.ts + padrão MARKETPLACE_URL

### Changed

- **`manifest.json`** — MV3 sem content_scripts, sem scripting/tabs, sem .ar/.mx. Adicionado `https://api.copysync.app/*` em host_permissions. `externally_connectable` gerado por webpack
- **`webpack.js`** — Transform: gera externally_connectable.matches de PANEL_URL, host_permissions de API_URL + ML .br, strip content_scripts + key em store build. `DEV_ORIGINS` support
- **`index.ts`** — Reescrito: channel, lifecycle, alarms, cookies.onChanged com debounce, popup internal messages (get-state, sync-now, save-settings)
- **`errors.ts`** — SyncErrorCode agora em store.ts. Mesmo padrão SyncError

### Removed

- **`content/index.ts`** — Content script eliminado (v3 não injeta código em páginas)
- **`authStore.ts`** — Substituído por store.ts (sem tokens Bearer)
- **`apiClient.ts`** — Substituído por apiFetch.ts (cookie auth)
- **`contract/api.ts`** — Tipos movidos para channel.ts e store.ts
- **`contract/messages.ts`** — Tipos movidos para store.ts e channel.ts
- **Formulário de login** — Autenticação via painel, não mais na extensão
- **Seletor de tenant** — Gerenciado via painel
- **Campo de tag** — Gerenciado via painel
- **Permissões**: `scripting`, `tabs`, host_permissions `.ar`/`.mx`

---

## [2.0.1] — 2026-10-20 — Versão legada (pré-rewrite)

Última versão com content script, login por senha e Bearer token.
