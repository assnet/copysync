# Changelog — CopySync Extension

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
