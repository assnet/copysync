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

Operações v1: `handshake`, `bridge.identify`, `session.changed`, `ml.status`, `ml.syncSession`.

Guard: PUBLIC_OPS (handshake, bridge.identify) não requerem auth. ML_OPS requerem sessão +
mlTenantId + tenant ACTIVE + permissão `ml.session`.

Contrato espelhado em `app/src/features/extension/contract/channel.ts`. Paridade verificada por
`scripts/check-contract-sync.mjs`.

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

## ML Cookie Sync

Cookies de identidade lidos via `chrome.cookies.getAll({ url })`:
`ssid`, `orguseridp`, `orgnickp`, `orguserid`.

SHA-256 hash para detecção de mudança. Rate limit 15 minutos entre syncs.

Triggers: `chrome.cookies.onChanged` (debounce 60s via alarm), alarm reserve (60min),
manual (popup), channel (`ml.syncSession`), startup.

Hash igual só pula envio em `cookie-changed` e `startup`. Alarm reserve, manual e channel enviam
sempre: o servidor revalida a sessão na loja a cada PUT e é isso que limpa "Recusada" quando o
token não mudou (ver `integracoes-credenciais-afiliado.md`, "Checagem da sessão no sync").
Não voltar a pular o alarme por hash: o servidor fica dias sem revalidar.

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
  - `check-dist.mjs` — no content_scripts, no scripting/tabs, externally_connectable, no .ar/.mx,
    no key em store build
  - `check-cookie-scope.mjs` — `chrome.cookies.*` só em `marketplaceSession.ts` + `onChanged`
    em index.ts
  - `check-i18n.mjs` — paridade pt_BR⇄en, toda chave usada existe, `err_<SyncErrorCode>` coberto
  - `check-contract-sync.mjs` — paridade channel.ts extension/⇄app/
- `onMessageExternal` verifica origem via `externally_connectable`
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
| 5 | Outros marketplaces (Shopee, Amazon) — só ML exige sessão por extensão | roadmap item 3 | — |
