# Extensão de navegador — sessão de afiliado

Pasta: `extension/` · CHANGELOG: [`extension/CHANGELOG.md`](../extension/CHANGELOG.md)

## Objetivo

Capturar, no navegador do operador, a sessão logada do marketplace (Mercado Livre) e enviá-la ao
painel para o tenant gerar links de afiliado automaticamente. A extensão **não** lê senha do
marketplace: só cookies de identidade (`ssid`, `orguseridp`, `orgnickp`, `orguserid`) via
`chrome.cookies` API. Substitui o legado "Redirect Flow"
(`legadoML/iiobglifbapgfafnghkcakggkcaddpap/`).

## Arquitetura (v3.0.0)

```
 painel (app/)                  background (service worker)
 ────────────                   ───────────────────────────
 externally_connectable ──────▶ channel/index.ts (onMessageExternal)
   envelope cs-ext v1              │
   guard → handler → sanitize      ├─ store.ts ── chrome.storage.local (settings, syncState)
                                   ├─ sessionResolver.ts ── GET /api/extension/me (5min cache)
                                   ├─ apiFetch.ts ── fetch(credentials:'include') ──▶ API (cookie auth)
                                   ├─ marketplaceSession.ts
                                   │     └─ chrome.cookies.getAll({ url }) → SHA-256 hash
                                   ├─ syncSession.ts ── PUT /api/extension/marketplaces/ml/session
                                   └─ lifecycle.ts ── heartbeat, alarmes, eventos install/update
 popup (UI)                     ──▶ chrome.runtime.onMessage (get-state, sync-now, save-settings)
```

**Sem content script.** Sem `scripting`/`tabs`. Sem login por senha. Sem Bearer token.

Módulos: `src/config/env.ts` (único `process.env`), `src/contract/channel.ts` (envelope tipado),
`src/core/{devLog,i18n}.ts`. Nenhuma regra mora em `index.ts`.

## Autenticação

Cookie-based via `__Host-ext_session` HttpOnly emitido pela API em `POST /api/extension/session`.
O **painel** inicia a autenticação (Bearer + tenantId) e a extensão recebe o cookie automaticamente.
Sem formulário de login na extensão.

`sessionResolver.ts` resolve o perfil via `GET /api/extension/me` com single-flight fetch + TTL
cache de 5 minutos (padrão PulsoSocial). `invalidarSessao()` limpa o cache quando o painel sinaliza
`session.changed`.

## Canal painel↔extensão

Comunicação via `chrome.runtime.onMessageExternal` + `externally_connectable` (webpack gera o
`matches` a partir de `PANEL_URL`). Envelope tipado:

```ts
{ channel: 'cs-ext', version: 1, direction, requestId, timestamp, op, payload }
```

Pipeline: origin → version N-1 → envelope filter (TTL 15s, anti-replay set de 500) →
guard → handler → `assertNoSecrets`.

Operações v1: `handshake`, `bridge.identify`, `session.changed`, `ml.status`, `ml.syncSession`.

Guard: PUBLIC_OPS (handshake, bridge.identify) não requerem auth. ML_OPS requerem sessão +
mlTenantId + tenant ACTIVE + permissão `ml.session`.

Contrato espelhado em `app/src/features/extension/contract/channel.ts`. Paridade verificada por
`scripts/check-contract-sync.mjs`.

## Contrato com a API

| Rota | Auth | Body | Resposta |
|---|---|---|---|
| `POST /api/extension/session` | Bearer (painel) | `{ installationId, extVersion, mlSessionConsent }` | cookie `__Host-ext_session` |
| `DELETE /api/extension/session` | Cookie | — | limpa cookie |
| `GET /api/extension/me` | Cookie + X-Client + X-Installation-Id | — | `ExtensionProfile` |
| `POST /api/extension/heartbeat` | Cookie | `{ extVersion, ml: { lastSyncAt } }` | `{ resyncRequested }` |
| `PUT /api/extension/marketplaces/ml/session` | Cookie | `{ cookies, capturedAt }` | `{ status }` |
| `POST /api/extension/lifecycle/event` | Pública (rate limited) | `{ installationId, type, version }` | — |

Todas no envelope `{ success, data, error? }` de `shared/http/httpResponse.ts`.

Tradução de erros (padrão AGENTS.md §13): `apiFetch.ts` nunca propaga texto da API; cada falha
vira `SyncErrorCode` → chave `err_<code>` nas locales. 401→session_expired, 403→forbidden,
404→api_route_missing, 429→rate_limited, rede→api_unreachable.

## ML Cookie Sync

Cookies de identidade lidos via `chrome.cookies.getAll({ url })`:
`ssid`, `orguseridp`, `orgnickp`, `orguserid`.

SHA-256 hash para detecção de mudança. Rate limit 15 minutos entre syncs.

Triggers: `chrome.cookies.onChanged` (debounce 60s via alarm), alarm reserve (60min),
manual (popup), channel (`ml.syncSession`), startup.

`assertNoSecrets` strip todos cookies ML, csrf, auth headers dos payloads de resposta do canal.

## Sistema de proteção

### Removido do legado

- `_metadata/verified_contents.json` — assinatura da Chrome Web Store do "Redirect Flow"
- `update_url` apontando para listagem antiga
- `console.log` em produção
- Content script com polling/`window.load` e leitura de `document.cookie`
- Login por senha, Bearer tokens, `authStore.ts`, `apiClient.ts`

### O que entrou (v3)

- **Cookie-based auth** → HttpOnly, Secure, SameSite=Strict
- **Channel pipeline** → envelope tipado, guard, anti-replay, sanitize
- **`key` no manifest** → ID estável. Chave privada em `extension/.keys/extension-private.pem`
  (ignorada pelo git)
- **Terser** remove `console.*` e `debugger` em produção
- **Guard scripts**:
  - `check-dist.mjs` — no content_scripts, no scripting/tabs, externally_connectable, no .ar/.mx,
    no key em store build
  - `check-cookie-scope.mjs` — `chrome.cookies.*` só em `marketplaceSession.ts` + `onChanged`
    em index.ts
  - `check-i18n.mjs` — paridade pt_BR⇄en, toda chave usada existe, `err_<SyncErrorCode>` coberto
  - `check-contract-sync.mjs` — paridade channel.ts extension/⇄app/
- `onMessageExternal` verifica origem via `externally_connectable`
- `onMessage` do background ignora remetente que não seja a própria extensão

## Versionamento

`extension/package.json` é a fonte (`3.0.0` = rewrite cookie-based). O webpack
(`CopyPlugin.transform`) escreve a mesma versão em `dist/manifest.json`; `check-dist` confere.
Nunca editar `version` em `public/manifest.json` à mão. SemVer igual ao resto do monorepo.

## i18n e temas

- Strings em `public/_locales/{pt_BR,en}/messages.json`; `default_locale: pt_BR`
- Manifest usa `__MSG_extName__`; código usa `t('chave')` ou `data-i18n`
- Nome da marca só em `NAME_APP` (.env) e nas locales — identificadores descrevem o recurso
- Popup segue `prefers-color-scheme` com override `system|light|dark` salvo em `settings.theme`

## Publicação na Chrome Web Store

1. `pnpm type-check && pnpm build` (o `check-dist` roda no fim)
2. Zipar o **conteúdo** de `dist/` (`cd dist && zip -r ../extension-<versão>.zip .`)
3. Enviar na listagem nova do CopySync (não reaproveitar listagem do legado)
4. Para build de loja: `pnpm build:store` (strip `key` do manifest)
5. Bump de `extension/package.json` + entrada no `CHANGELOG.md` antes de cada envio

## Pendências

| # | Item | Onde | Bloqueia |
|---|---|---|---|
| 1 | Smoke test com extensão carregada (`pnpm dev` → `dist/` em `chrome://extensions`): canal com painel, cookie sync, heartbeat | `extension/README.md` | Fechamento da feature |
| 2 | F3 — Painel: UI de extensão, botão conectar, canal handshake | `app/src/features/extension/` | Fluxo completo |
| 3 | F4 — MercadoLivreAffiliateClient (bootstrap + createLink na API) | `api/src/modules/integrations/` | Geração de links |
| 4 | Publicação na Chrome Web Store: nova listagem | seção *Publicação* | Distribuição |
| 5 | Expiração da sessão do marketplace: API sinaliza via heartbeat `resyncRequested` | API + `syncSession.ts` | Confiabilidade |
| 6 | Outros marketplaces (Shopee, Amazon) — só ML exige sessão por extensão | roadmap item 3 | — |
