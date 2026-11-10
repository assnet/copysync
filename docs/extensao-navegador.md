# Extensão de navegador — sessão de afiliado

Pasta: `extension/` · CHANGELOG: [`extension/CHANGELOG.md`](../extension/CHANGELOG.md)

## Objetivo

Capturar, no navegador do operador, a sessão logada do marketplace (Mercado Livre; Shein desde a 3.4.0) e enviá-la ao
painel para o tenant gerar links de afiliado automaticamente. A extensão **não** lê senha do
marketplace: só cookies de identidade (`ssid`, `orguseridp`, `orgnickp`, `orguserid`) via
`chrome.cookies` API (Shein: `AT`, `memberId`). Substitui o legado "Redirect Flow"
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

**Um único content script** (`panel-bridge.js`, proxy do canal — ver §Proxy para Orion), só na origem do painel; nunca em site de terceiro. Sem `scripting`/`tabs`. Sem login por senha. Sem Bearer token.

Módulos: `src/config/env.ts` (único `process.env`), `src/contract/channel.ts` (envelope tipado),
`src/core/{devLog,i18n}.ts`. Nenhuma regra mora em `index.ts`.

### Painel (`app/src/features/extension/`)

Feature completa de gestão da extensão no painel (F3, `6d9f48c`):

- `channel/client.ts` — cliente `chrome.runtime.sendMessage` via `externally_connectable`; tenta IDs de `VITE_EXTENSION_IDS`
- `hooks/useExtension.ts` — hook principal: detecta extensão, handshake, status ML, connect, sync, disconnect
- `services/extensionApi.ts` — chamadas à API: issueSession, revokeSession, listSessions, getMlCredentialStatus
- `components/ExtensionSetupWizard.tsx` — wizard 5 passos (instalar, detectar, vincular, sincronizar, concluir)
- `components/ExtensionMlCard.tsx` — card ML com sync, desconectar, aviso de expiração
- `components/ExtensionStatusBadge.tsx` — chip colorido por status
- Página: `pages/settings/ExtensionSettingsPage.tsx` → rota `/settings/extension`

### Geração de links ML (`campaigns/infrastructure/http/MercadoLivreAffiliateClient.ts`)

A sessão sincronizada pela extensão também alimenta o `MercadoLivreAffiliateClient` (F4, `25578e7`),
que gera links de afiliado automaticamente via API interna do ML (`/affiliate-program/api/v2/affiliates/createLink`).
Detalhes em [`gerador-de-ofertas.md`](gerador-de-ofertas.md).

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

Operações v1: `handshake`, `bridge.identify`, `session.changed`, `ml.status`, `ml.syncSession`;
3.4.0: `shein.status`, `shein.syncSession`, `shein.requestAccess` (só adição, `CHANNEL_VERSION` inalterado).
`handshake.caps` = `['ml.session', 'shein.session']`; o painel lê com `supports(cap)`.

Guard: PUBLIC_OPS (handshake, bridge.identify) não requerem auth. ML_OPS requerem sessão +
mlTenantId + tenant ACTIVE + permissão `ml.session`; SHEIN_OPS, o mesmo com `shein.session`
(`hasPermission(profile, perm)` genérico).

Contrato espelhado em `app/src/features/extension/contract/channel.ts`. Paridade verificada por
`scripts/check-contract-sync.mjs`.

### Proxy para navegador sem `externally_connectable` (Orion) — extensão 3.3.0 · app 0.89.1

O Orion (Kagi, WebKit que instala da Chrome Web Store) não entrega `externally_connectable` à
página: `chrome.runtime` some ou o `sendMessage` nunca responde. Mesmo mecanismo do PulsoSocial
(`pulsosocial_extension/src/site-bridge.ts`), adaptado ao nosso canal de mensagem única (sem Port):

```
painel ──postMessage──▶ panel-bridge.js (content script, origem do painel)
       ◀─postMessage──        │ chrome.runtime.sendMessage (interna)
                              ▼
                 service worker: onMessage → handleMessage (MESMA cadeia do externo)
```

- **Contrato**: o envelope é o mesmo; o proxy só embrulha. `ProxyMessage` (`ready`/`req`/`res`/
  `fail`), `PROXY_MARKER_ATTR` (`data-cs-ext-proxy` em `<html>`, ids separados por espaço),
  `PROXY_MAX_BYTES` (64 KiB) e `parseProxyMessage` vivem em `contract/channel.ts` (paridade
  garantida pelo `check-contract-sync`).
- **Extensão** — `src/content/panelBridge.ts` (puro, testável) + `src/content/index.ts` (bootstrap
  idempotente). Aceita só: `event.source === window`, `event.origin === location.origin` e na
  allowlist (`core/panelOrigin.ts`: `PANEL_URL` + `DEV_ORIGINS` só no build dev, comparação exata),
  formato do contrato, `to === chrome.runtime.id` (loja + dev instaladas: só a endereçada age),
  até 20 pedidos/s e 64 KiB. Devolve só o envelope de resposta do service worker com o mesmo
  `requestId` (já passou por `assertNoSecrets`); qualquer outra coisa vira `fail`. Contexto
  invalidado (extensão recarregada) → `fail` sem chamar o worker. `postMessage` sempre com
  `targetOrigin` = própria origem.
- **Service worker** — `background/channel/proxy.ts`: `isTrustedProxySender` exige `sender.id`
  desta extensão, `frameId` 0 quando presente e origem (`sender.origin` → `url` → `tab.url`) do
  painel. Listener `onMessage` registrado no topo do worker, ao lado do `onMessageExternal`.
- **Painel** — `channel/proxyTransport.ts` (`readProxyIds`, `sendViaProxy`) + `client.ts`. Ordem:
  transporte já provado (cache) → externo (`VITE_EXTENSION_IDS`) → proxy. Com proxy na página, o
  `handshake` externo desiste em 1,5 s (Orion mudo); demais ops mantêm 3 s. Cada tentativa usa
  envelope novo (o anti-replay recusa `requestId` repetido). Proxy só de id em
  `VITE_EXTENSION_IDS` (quando configurado). Resposta só aceita do próprio window/origem, da
  extensão endereçada e com o `requestId` do pedido.
- **Detecção**: o marcador conta como canal ligado (`isExtensionChannelBound`,
  `isExtensionApiAvailable`) e `isExtensionCapableBrowser()` (`config.ts`) aceita o Orion quando o
  marcador existe — painel de instalação e aviso do Dashboard passam a ver a extensão no Orion.
  Instalou com a aba aberta: content script declarado só entra em página nova → continua o
  "recarregar" do `ExtensionInstallPanel`.
- **Manifest**: `content_scripts` gerado pelo `webpack.js` com os MESMOS `matches` do
  `externally_connectable`, `document_start`, só frame principal, isolated world. A origem do
  painel já está em `host_permissions` (foco da aba, 3.1) → **nenhuma permissão nova, nenhum
  aviso novo ao usuário**; a loja revisa o pacote como em toda atualização. `check-dist` barra
  qualquer outro content script, `matches` diferente, `all_frames`/`MAIN`.

**Não fazer**: content script em outra origem que não a do painel; `world: 'MAIN'`/`all_frames`;
`postMessage` com `'*'`; repassar ao painel algo que não seja o envelope de resposta (cookie,
storage, erro cru); ler `document.cookie`/storage no content script; aceitar mensagem sem checar
`source`/`origin`; mudar op/payload no proxy (contrato é um só); permissão `scripting` para injetar
em aba já aberta (permissão nova → aviso e revisão); validar só no content script — o worker
reaplica a cadeia completa.

## Contrato com a API

| Rota | Auth | Body | Resposta |
|---|---|---|---|
| `POST /api/extension/session` | Bearer + X-Tenant-Id (painel) | `{ installationId, extVersion, extensionId, channel, mlSessionConsent }` | cookie `__Host-ext_session` |
| `DELETE /api/extension/session` | Cookie | — | limpa cookie |
| `GET /api/extension/me` | Cookie + X-Client + X-Installation-Id | — | `ExtensionProfile` |
| `POST /api/extension/heartbeat` | Cookie | `{ extVersion, ml: { lastSyncAt } }` | `{ resyncRequested }` |
| `PUT /api/extension/marketplaces/ml/session` | Cookie + consentimento ML + entitlement | `{ cookies: { ssid, … }, capturedAt }` | `{ affiliateTag }` |
| `POST /api/extension/lifecycle/event` | Pública (rate limited) | `{ installationId, type, version, channel, dedupeKey, extensionId?, previousVersion? }` | `{ created }` |
| `POST /api/extension/store-click` | Bearer + X-Tenant-Id (painel) | `{ source: 'settings' \| 'ml_wizard' \| 'onboarding' }` | `{ recorded }` (false = repetido em 60 s) |
| `POST /api/extension/lifecycle/uninstall` | Pública (rate limited) | `{ installationId, extensionId?, version? }` | `{ success }` (igual p/ instalação desconhecida) |
| `POST /api/extension/lifecycle/feedback` | Pública (rate limited) | `{ installationId, reasons[1..8], comment? ≤500 }` | `{ success }` |
| `DELETE /api/extension/marketplaces/ml/session` | Bearer + X-Tenant-Id (painel) | — | revoga consentimento ML do tenant e apaga a sessão cifrada |
| `POST /api/extension/marketplaces/ml/consent` | Bearer + X-Tenant-Id (painel) | `{ installationId }` | reautoriza o sync nesta instalação |
| `POST /api/extension/marketplaces/shein/consent` | Bearer + X-Tenant-Id (painel) | `{ installationId }` | grava `sheinConsentAt`; 403 sem `marketplace_shein_enabled` ou sem aceite do aviso de risco; 404 sem sessão da extensão |
| `PUT /api/extension/marketplaces/shein/session` | Cookie + consentimento Shein + aceite + entitlement | `{ cookies: { AT, memberId }, capturedAt }` | `{ affiliateId }` (nunca o token) |
| `DELETE /api/extension/marketplaces/shein/session` | Bearer + X-Tenant-Id (painel) | — | revoga o consentimento Shein do tenant e apaga a credencial inteira (204, idempotente) |

**Desconectar Mercado Livre:** revoga o consentimento **antes** de apagar a sessão (senão a
extensão pode ressincronizar entre as duas escritas). Etiqueta e secreto da credencial ficam.
"Sincronizar agora" no painel chama `/consent` antes do sync: clicar é consentimento explícito.

Todas no envelope `{ success, data, error? }` de `shared/http/httpResponse.ts`.

**Sync ML:** a API só guarda os cookies de `ML_SESSION_COOKIES` (resto do body é descartado),
busca a etiqueta ativa no ML (`getActiveTag`, melhor esforço: falha não bloqueia a sessão) e
grava cifrado via `UpsertAffiliateSessionUseCase` — etiqueta só preenche ID vazio.

**Obrigatório em produção:** `EXTENSION_ORIGINS=chrome-extension://<id>` no serviço da API.
Sem ela, toda rota com `extensionRequestGuard` responde 403 `NO_EXTENSION_ORIGINS` — painel
mostra "Conectada", mas `/me`, heartbeat e sync falham e o ML aparece "Não logado".

Tradução de erros (padrão AGENTS.md §13): `apiFetch.ts` nunca propaga texto da API; cada falha
vira `SyncErrorCode` → chave `err_<code>` nas locales. 401→session_expired, 403→forbidden,
404→api_route_missing, 429→rate_limited, rede→api_unreachable.

## Fluxo de instalação e ciclo de vida (api 0.72.0 · app 0.89.0 · extensão 3.3.0)

**Painel.** `ExtensionInstallPanel` (`app/src/features/extension/components/`) é o único botão
"Instalar da Chrome Web Store": abre a loja em nova aba (`EXTENSION_STORE_URL` em
`features/extension/config.ts`, env `VITE_EXTENSION_STORE_URL`, default a listagem publicada),
registra o clique (`POST /extension/store-click`, sem esperar resposta; falha nunca bloqueia a loja)
e entra em espera: `useExtensionInstallWatch` refaz o handshake a cada 3 s e ao voltar à aba, teto
de 3 min, avança sozinho ao detectar. "Já instalei, verificar de novo" recomeça (recarrega a página
quando o Chrome ainda não ligou `chrome.runtime` — ele só aparece com uma extensão que declare a
origem em `externally_connectable`). Usado em:

- Configurações → Extensão: wizard com passo **Instalar** antes de Detectar (`source=settings`);
- modal "Configurar Mercado Livre" em Credenciais de afiliado (`source=ml_wizard`);
- `ExtensionInstallBanner` no Dashboard (`source=onboarding`): só Chromium desktop sem extensão;
  "Dispensar" grava `extension.installBanner.dismissed.<userId>` no localStorage (por usuário, por navegador).

**Correlação clique → instalação → usuário.** O Pulso não liga o clique à instalação (o redirect da
loja só conta visitante). Aqui:

1. clique = `ExtensionLifecycleEvent` `STORE_CLICK` com `userId`, `tenantId`, `source` e
   `installationId = null`; repetição do mesmo usuário em 60 s não grava (advisory lock por usuário);
2. a extensão cria o `installationId` já no `onInstalled` e manda `INSTALL` com `extensionId`: a rota
   pública cria a `ExtensionInstallation` sem dono;
3. no vínculo (`POST /session`), se a instalação ganha este usuário como dono, o
   `IssueExtensionSessionUseCase` grava `LINKED` e **atribui** o `STORE_CLICK` mais recente do
   usuário ainda sem instalação e de até 7 dias (`installationId` do clique passa a apontar a
   instalação; update condicional, um clique por vínculo). Falha aqui nunca derruba o vínculo.

Consulta: `SELECT * FROM extension_lifecycle_events WHERE type='STORE_CLICK' AND "installationId" IS NOT NULL`
= cliques convertidos; `occurredAt` do LINKED − do clique = tempo até instalar.

**Desinstalação.** A extensão define `setUninstallURL` no boot do service worker:
`<PANEL_URL>/extension-removed?i=<installationId>&e=<extensionId>&v=<versão>` (≤ 1023 chars). A página
pública `ExtensionRemovedPage` chama `/lifecycle/uninstall` uma vez e oferece a pesquisa (motivos
`not_working, hard_to_use, slow, fear_of_block, no_longer_needed, price, other_tool, other` + comentário
≤ 500, e-mail/telefone removidos no servidor) → `ExtensionUninstallFeedback` (reenvio substitui).

**Não fazer:** botão de loja fora do `ExtensionInstallPanel`; URL da loja literal; mandar o comentário
da pesquisa para a central; criar instalação pela rota pública sem `extensionId` válido; tocar
versão/canal de instalação com dono pela rota pública (só heartbeat autenticado).

## Eventos para a central

Fila: `hub_outbox_events` (`HubOutboxEvent`), enviada pelo `HubOutboxWorker` só com
`HUB_EVENTS_ENABLED=true` + `HUB_EVENTS_URL/APPLICATION_KEY/SECRET` (**desligado em produção até a
central ter o receptor**). Os eventos são enfileirados sempre (fila pendente acumula até ligar; volume
baixo). Gravação na mesma transação do evento local; `seq` por `clientKey` via `hub_outbox_sequences`.

**Envelope** (inalterado), `POST <HUB_EVENTS_URL>/events`, assinatura M2M de
`shared/http/m2m/m2mSignature.ts` (`X-Application-Key`, timestamp, nonce, `X-Signature: sha256=<hex>`):

```json
{ "eventId": "<id do outbox, dedupe>", "type": "extension.lifecycle", "clientKey": "<Tenant.billingCustomerId>",
  "installationId": "<uuid> | null", "payload": { ... } }
```

Resposta 2xx = SENT; 4xx = DEAD (bloqueia a fila daquele `clientKey`); 5xx/rede = retry 1 min → 24 h, 10 tentativas.
Ordem: só a cabeça (`MIN(seq)`) por `clientKey`; o receptor pode aplicar watermark de `seq`.

**`payload`** (`domain/services/lifecycleOutboxPayload.ts`; sem PII, sem userId local):

| Campo | Tipo | Quando |
|---|---|---|
| `event` | `STORE_CLICK` \| `INSTALL` \| `UPDATE` \| `LINKED` \| `UNINSTALL` \| `UNINSTALL_FEEDBACK` | sempre |
| `occurredAt` | ISO 8601 | sempre |
| `installationId` | uuid \| null | null só em `STORE_CLICK` |
| `clientKey` | string | sempre (= envelope) |
| `version` | semver \| null | versão da extensão; null em `STORE_CLICK` |
| `channel` | string \| null | `cs-ext`; null em `STORE_CLICK` |
| `source` | `settings` \| `ml_wizard` \| `onboarding` | só `STORE_CLICK` |
| `storeClickId`, `storeClickAt` | string, ISO | só `LINKED` com clique atribuído (correlação) |
| `reasons` | string[] | só `UNINSTALL_FEEDBACK` |

Regras: só entra no outbox evento com `clientKey` (tenant com `billingCustomerId`); `INSTALL`/`UPDATE`/
`UNINSTALL` de instalação ainda sem dono ficam só no banco local (o primeiro `INSTALL` quase sempre é
sem dono — o `LINKED` traz a instalação para a central). `STARTUP` e heartbeat não vão (o Pulso também
não envia heartbeat a lugar nenhum: ele só atualiza `lastHeartbeatAt` local). Cada evento é único por
instalação (`UNINSTALL`, `UNINSTALL_FEEDBACK`, `LINKED:<userId>`, `UPDATE:<versão>`, `INSTALL`).

## Shein (3.4.0)

Tudo do produto (aviso de risco, plano, gerador): [`afiliado-shein.md`](afiliado-shein.md).

- **Mapa por marketplace** (`config/env.ts`, espelhado em `__mocks__/env.ts`): `MARKETPLACES.ml` e
  `MARKETPLACES.shein` com `provider`, `MARKETPLACE_COOKIE_DOMAIN`, `MARKETPLACE_URL_PATTERN`, `MARKETPLACE_URL`,
  `cookies`, `tokenCookie` (`ssid` × `AT`), `optional`. Estado de sync, hash de cookies, rate limit, `lastSyncEpoch`
  e single-flight são por marketplace (chaves ML mantêm os nomes da 3.3; Shein usa `sheinSyncState`,
  `sheinCookieHash`, `sheinLastSyncEpoch`).
- **Permissão opcional**: `https://m.shein.com/*` em `optional_host_permissions` (`check-dist` exige que nunca esteja
  em `host_permissions`: host obrigatório novo desativa a extensão em toda a base). `chrome.permissions.request` só
  roda em gesto do usuário e não há popup, então: painel envia `shein.requestAccess` → pendência de 10 min no storage
  → usuário clica no ícone → `actionClick.ts` chama `permissions.request` como primeira chamada síncrona. Concedida:
  limpa, sincroniza e foca o painel; negada: limpa e foca. O espelho da pendência é carregado no topo de `index.ts`
  (antes dos listeners); clique com o espelho ainda não lido NÃO faz `await` antes do pedido: só foca o painel e
  mantém a pendência para o próximo clique. Recusa por gesto também mantém. Pendência vencida sai do storage quando
  lida. Sem pendência: só foca o painel. O painel consulta `shein.status` a cada 3 s
  enquanto `pending`.
- **Leitura**: `marketplaceSession.ts` só lê cookie Shein com `chrome.permissions.contains` verdadeiro e exige `AT` +
  `memberId`; `check-cookie-scope` falha se a função que chama `chrome.cookies.*` não tiver
  `if (!(await hasHostPermission(...))) return` antes. Só cookie do host exato (`c.domain` sem ponto = `m.shein.com`):
  `getAll({ url })` também traz `.shein.com`, descartado antes de deduplicar por path (ML, domínio com ponto, sem
  filtro). `cookieWatch.ts` agenda sync só para mudança desses dois em `m.shein.com` (debounce 60 s,
  `chrome.alarms.create` direto pelo nome). Gatilho automático sem permissão sai em silêncio. O alarme de reserva
  respeita o hash na Shein (só envia se o token mudou); no ML segue reenviando.
- **Recusa do servidor (só Shein)**: `consent_required`/`plan_unavailable` (ex.: "Desconectar" no painel) →
  `chrome.permissions.remove` da origem, apaga hash/`lastSyncEpoch`, estado vira só o erro e o automático pausa
  (`sheinAutoSyncPaused`). Só `shein.requestAccess` + clique reativa. `risk_not_accepted` → pausa o automático sem
  remover a permissão; sync manual/canal reativa. ML nunca pausa.
- **Erros**: `apiFetch.ts` lê o envelope antes do status e mapeia `error.code` conhecido (Map, sem herança de
  protótipo) em qualquer status; status (401/403/404/429) só sem código conhecido. `SESSION_NOT_FOUND`/
  `*_EXT_SESSION` → `session_expired`; `RATE_LIMITED` → `rate_limited`; `*_CONSENT_REQUIRED` → `consent_required`;
  `PLAN_FEATURE_UNAVAILABLE`/`EXTENSION_NOT_ENTITLED` → `plan_unavailable`; `MARKETPLACE_RISK_NOT_ACCEPTED` →
  `risk_not_accepted`. Códigos novos: `shein_not_logged`, `shein_permission_missing`, `shein_sync_failed`,
  `risk_not_accepted` (chaves `err_*` nas `_locales`, textos do painel em `features/extension/strings.ts`).
- `BLOCKED_FIELDS` ganha `AT` e `token` (o sanitize remove a chave; `memberId` é o id público).
- Permissão `shein.session` em `permissions` do `/extension/me` quando o tenant tem `marketplace_shein_enabled`.

**Não fazer**: tornar `m.shein.com` permissão obrigatória; chamar `permissions.request` fora do clique; ler cookie
Shein sem permissão concedida; abrir página da Shein ou resolver desafio anti-bot; deixar o sync Shein reusar
resultado, hash ou rate limit do ML.

## ML Cookie Sync

Cookies de identidade lidos via `chrome.cookies.getAll({ url })`:
`ssid`, `orguseridp`, `orgnickp`, `orguserid`.

SHA-256 hash para detecção de mudança. Rate limit 15 minutos entre syncs.

Triggers: `chrome.cookies.onChanged` (debounce 60s via alarm), alarm reserve (60min),
manual (popup), channel (`ml.syncSession`), startup.

Hash igual só pula envio em `cookie-changed` e `startup`. Alarm reserve, manual e channel enviam
sempre: o servidor revalida a sessão na loja a cada PUT e é isso que limpa "Recusada" quando o
token não mudou (ver `integracoes-credenciais-afiliado.md`, "Checagem da sessão no sync").
Não voltar a pular o alarme por hash no ML: o servidor fica dias sem revalidar. (A Shein pula: ver acima.)

Timeout do PUT da sessão: 25s (`SYNC_TIMEOUT_MS`), acima do caminho do servidor (bootstrap 8s +
etiqueta 8s). Demais chamadas: 10s.

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
  (ignorada pelo git). Geração/conferência: `pnpm keys:generate` / `pnpm keys:id`
- **Terser** remove `console.*` e `debugger` em produção
- **Guard scripts**:
  - `check-dist.mjs` — só o content script do proxy (`panel-bridge.js`, matches = externally_connectable), no scripting/tabs, externally_connectable, no .ar/.mx,
    no key em store build
  - `check-cookie-scope.mjs` — `chrome.cookies.*` só em `marketplaceSession.ts` + `onChanged`
    em index.ts
  - `check-i18n.mjs` — paridade pt_BR⇄en, toda chave usada existe, `err_<SyncErrorCode>` coberto
  - `check-contract-sync.mjs` — paridade channel.ts extension/⇄app/
- `onMessageExternal` verifica origem via `externally_connectable`; o proxy (`onMessage`) verifica remetente e origem no worker
- **Sem popup (3.1+)**: clique no ícone foca a aba do painel já aberta (janela atual primeiro)
  ou abre uma nova. Achar aba por URL exige a origem do painel em `host_permissions` — o
  `webpack.js` deriva de `PANEL_URL`. Não usar a permissão `tabs` (aviso "ler histórico").

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

Passo a passo completo (chaves, ID, `.crx`, zip de loja, textos da listagem, práticas de
privacidade, pendências): [`extensao-publicacao-chrome-web-store.md`](extensao-publicacao-chrome-web-store.md).

Resumo: bump em `extension/package.json` + CHANGELOG → `pnpm release` (type-check, test,
`pack:store`, `pack:crx`) → `release/*-store.zip` na loja; `release/*.crx` só para teste/política.
`pnpm keys:id` imprime o ID (`nokcbnoicaebghagbhlfcbepheohdgnd`) e falha se `manifest.key` ≠ `.pem`.

## Pendências

| # | Item | Onde | Bloqueia |
|---|---|---|---|
| ~~F3~~ | ~~Painel: UI de extensão, wizard, configurações~~ | ~~`app/src/features/extension/`~~ | ✅ `6d9f48c` |
| ~~F4~~ | ~~MercadoLivreAffiliateClient (bootstrap + createLink)~~ | ~~`api/src/modules/campaigns/infrastructure/http/`~~ | ✅ `25578e7` |
| 1 | Smoke test com extensão carregada (`pnpm dev` → `dist/` em `chrome://extensions`): canal com painel, cookie sync, heartbeat, geração de link ML | `extension/README.md` | Fechamento da feature |
| 2 | Receptor `POST /events` (`extension.lifecycle`) na central; depois ligar `HUB_EVENTS_*` na Render. Worker e enfileiramento prontos (0.72.0) | central + seção *Eventos para a central* | Hub integration |
| 6 | Extensão 3.3.0 (INSTALL na instalação, uninstall URL no boot) precisa ser publicada na Chrome Web Store | `extension/` | Correlação e feedback de remoção |
| 3 | Publicação na Chrome Web Store: nova listagem (F8). Build/zip/CRX prontos (3.2.1); faltam política de privacidade pública, capturas e conta — ver pendências em `extensao-publicacao-chrome-web-store.md` §9 | seção *Publicação* | Distribuição |
| 4 | Expiração da sessão do marketplace: API sinaliza via heartbeat `resyncRequested` | API + `syncSession.ts` | Confiabilidade |
| 5 | Outros marketplaces: Shein entrou na 3.4.0 (sessão + permissão opcional); Shopee e Amazon não exigem sessão (StoreID da Amazon pela extensão: spike opcional F6 em `.specs/features/shein-affiliate/`) | roadmap item 3 | — |
| 7 | Extensão 3.4.0 (Shein) precisa ser publicada na Chrome Web Store; smoke do prompt de permissão (inclusive com worker dormindo) no T16 | `extension/`, [`afiliado-shein.md`](afiliado-shein.md) | Shein em produção |
