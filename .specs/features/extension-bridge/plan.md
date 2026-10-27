# Extensão: login central, ponte com o painel e sessão do Mercado Livre — Plano

**Data:** 2026-10-26 · **Status:** plano v4.5 (R1–R9 aplicadas; histórico abaixo é cronológico — onde diverge, vale o corpo; decisão do owner:
token ML usado no servidor, modelo legadoML) · Branch-base: `feature/rebranding-app` · Modelo de auth/canal/lifecycle: `pulsosocial_extension` +
`pulsosocial_api` (validado; desvios só os listados em §2).

**Glossário:** neste plano, **"painel"** = o **app do CopySync** (`app/`), usado pelo cliente (sessões, gerador,
Configurações, wizard do ML, extensão); `PANEL_URL`/`PANEL_ORIGIN` apontam para ele. **Não** é o admin central do
hub (`pulsosocial_api`), que é só da equipe, não fala com a extensão e não muda neste plano; o cliente vê plano e
cobrança em Configurações do próprio CopySync.

## 0. Pré-condições

- **P1 — API em `api.copysync.app`** ✅ DNS e TLS no ar (2026-10-26: `https://api.copysync.app/health` → 200,
  CNAME na Render). Falta só apontar o painel: `app/.env` ainda usa `api.copysync.com` (tarefa F1, item
  "domínios" abaixo).
- **P2 — Host do painel** ✅ decidido: **`https://app.copysync.app`** (no ar, 200; já é o `render.yaml:14`, com
  `X-Robots-Tag` de painel privado). `copysync.app` fica para a landing (hoje HostGator, 403). `PANEL_ORIGIN =
  https://app.copysync.app`. Ajustar referências antigas a `copysync.app` como painel (`extension/.env*`,
  AGENTS.md "Painel", docs de rebranding) na F1.
- **P3 — Extensão não publicada** ✅ confirmado pelo owner: a listagem antiga `iiobglifbapgfafnghkcakggkcaddpap`
  é o "Redirect Flow", de terceiro (`legadoML`). Nova extensão sai como **v3.0.0 única** e é publicada na Web
  Store só quando estiver pronta (F8); sem base instalada a migrar.
- **P4 — Rota de eventos no hub** (`pulsosocial_api`) não existe; precisa ser criada lá (aprovação do owner). Sem
  ela o outbox fica desligado. A **chave do cliente está definida**: `clientKey = Tenant.billingCustomerId` do
  `mlTenantId`, que é o `externalUserId` (`User.id` central) que o próprio hub manda nos webhooks
  (`multi-application-hub/spec.md:56,199-205`; gravado por `ApplyBillingEventUseCase.ts:55-69`).
- **P5 — Planos** ✅ fonte: `docs/produto-roadmap.md:38-69` (Starter / Profissional / Business; a versão Básico /
  Plus / Pro está substituída). Slugs do hub: `COPYSYNC_STARTER`, `COPYSYNC_PROFISSIONAL`, `COPYSYNC_BUSINESS`
  (`multi-application-hub/spec.md:53,156`; F1 confere o formato exato do `planSlug` no webhook).
  `marketplace_extension = true` **nos três**: "Marketplaces (Shopee, Amazon, ML) ✅" em todos, e o
  monitoramento (troca o link do concorrente pelo seu) precisa da sessão ML já no Starter. O gerador continua
  limitado pelo próprio entitlement (`offer_generations_per_day`; gerador automático só Profissional/Business).
- **P6 — App no DevCenter do ML** (OAuth de app): **último recurso** (decisão do owner 2026-10-26) — só se o teste
  de integração mostrar que o servidor com a sessão do usuário não passa do desafio anti-bot.
- **P7 — Migrations** ✅ conferido read-only em 2026-10-26 no banco novo (`db_copysync_postgres_w398`): 21/21
  aplicadas, última `20261027090000_extend_ai_provider_kinds` = última do repo, nenhuma pendente;
  `tenant_entitlements` e `plan_entitlement_presets` existem (presets: 0 linhas, a F1 grava). Só dados de teste:
  sem backup obrigatório antes da F1.

## 1. Problema

- Extensão v2.0.1: senha no popup, JWT completo + refresh 7 d em `chrome.storage.local['auth']`
  (`extension/src/background/authStore.ts:28-60`; login em `apiClient.ts:91-97`); sync de `ssid`+CSRF sem checar plano; content script em toda
  página do ML (`manifest.json:33-39`); popup lê cookie do ML ao abrir (`background/index.ts:61-67`).
- `legadoML` (Redirect Flow, publicado): alarme 30 min + popup → lê `ssid` (`chrome.cookies`) e CSRF de aba aberta
  do ML (`meta[name=csrf-token]` / `__PRELOADED_STATE__.csrf`) → POST ao backend, que chama o ML no servidor
  (linkbuilder etc.). Funciona com navegador fechado enquanto a sessão vale. Pede e-mail e etiqueta à mão.
- Painel não detecta a extensão; não existe gerador de link nem busca de ofertas ML no servidor
  (`docs/gerador-de-ofertas.md:96` proíbe gerar link).
- CORS: default `'*'` reflete qualquer origem (`env.ts:38`; `app.ts:29-31,78-80`) + defaults waioprime sempre mesclados (`app.ts:17-22,38`).

## 2. Modelo de referência (Pulso) e desvios

| Pulso | CopySync |
| --- | --- |
| Site loga; API grava cookie de sessão | Painel (Bearer) chama `POST /api/extension/session` → cookie `__Host-ext_session` |
| Extensão não rotaciona; heartbeat só repassa storage (`background.ts:911-960`) | Igual |
| `resolverSessao`/`invalidarSessao` (single-flight, época, TTL 5 min / 15 s) | Copiar só o caminho por cookie |
| `apiFetch` único (`credentials:'include'`, `X-Client`, `X-Installation-Id`) | Igual |
| `session.changed` vazio; N−1; `OPS_BY_VERSION`; queda `recusada/ociosa/queda` | Igual |
| Guard por op com `permissions[]` (por usuário) do `GET /user`, devolve só `{code}` (`guard.ts:92-138,176-213`) | **Diferente** (desvio 5): `GET /api/extension/me` devolve `tenants[{id,name,status,permissions}]` (por tenant); guard devolve `{code, reason?}` |
| `assertNoSecrets`; token do site nunca cruza o canal (`contract/sanitize.ts`) | Igual; chaves bloqueadas = `ML_SERVER_COOKIES` (derivadas das constantes) + `csrf`, `x-csrf-token`, `cookies`, `authorization`, `cookie`, `set-cookie` |
| Lifecycle (`modules/extension-lifecycle/*`): event/uninstall/absent, startup só em `onStartup`, limites `limit.ts:19-24` | Igual (§4.6), com endurecimentos do desvio 6 |
| CSRF guard + origens (`csrf-guard.ts`, `origins.ts`); `EXTENSION_ORIGINS` vazio aceita qualquer extensão (`origins.ts:49-54`) | Igual, mas **fail-closed** (desvio 7): vazio nega; boot falha em produção sem lista |
| Cookie lido/escrito à mão, sem `@fastify/cookie` (`session-cookie.ts:9-13`) | Igual: helper próprio, sem plugin (evita escopo de plugin Fastify) |

**Desvios (necessários):**
1. Cookie dedicado à extensão (painel CopySync é Bearer/localStorage; migrá-lo está fora de escopo). Consequência:
   handshake devolve `userId` para o painel detectar extensão vinculada a outra conta.
2. `REINSTALL`/`deviceId` registrados no `POST /api/extension/session` em vez de `/lifecycle/handshake`: outro
   `installationId` exige revincular de qualquer forma.
3. Outbox de lifecycle para o hub (o Pulso é o hub).
4. Segredo do site **vai à API** (decisão do owner, modelo legadoML) — só à API, nunca ao painel/canal.
5. Permissões por tenant + `reason` (`MEMBERSHIP`|`TENANT`|`PLAN`) no `FORBIDDEN`: o CopySync é multi-tenant e o
   painel precisa distinguir "revincule" de "assine".
6. Lifecycle: rota pública cria linha nova ou atualiza linha sem dono; em linha com dono toca só `status` + `lastSeenAt`; `REPLACED`/`UNLINKED` viram eventos (o Pulso
   só muda status); unique de dedupe nos eventos (o Pulso tolera duplicata de `UPDATE`, `service.ts:255-257`).
7. `EXTENSION_ORIGINS` fail-closed (o próprio Pulso registra que aceitar qualquer extensão não é o ideal).

## 3. Decisões

1. **D1 Auth**: `ExtensionSession` (token opaco 32 B, sha256 no banco); `expiresAt` deslizante 30 d (heartbeat),
   `absoluteExpiresAt` 90 d; cookie `Max-Age` até o teto. Sem senha na extensão.
2. **D2 Escopo**: cookie só autentica `/api/extension/*`; `authHook` segue só Bearer.
3. **D3 Gate (owner)**: a extensão só lê cookie/CSRF/etiquetas do ML se (a) foi **vinculada pelo painel
   identificado** (Port de `PANEL_ORIGIN` → `POST /session`, que fixa `mlTenantId`); (b) sessão central válida
   (`resolverSessao`); (c) `permissions` do `mlTenantId` no `/me` inclui `ml.session`, calculada no servidor como
   membro ativo + tenant ACTIVE + entitlement `marketplace_extension` (D7). O servidor revalida (a)–(c) em toda
   rota **da extensão** (`/api/extension/*`). O **uso no servidor** da sessão já sincronizada (gerador, §4.4) exige
   entitlement + credencial ACTIVE + sessão válida, e **não** depende do vínculo da extensão: é o que permite
   automação com o navegador fechado (D4). Desvincular a extensão (`DELETE /session`) para novos syncs; para parar
   o uso da sessão guardada, "Desconectar ML" (§4.3). Nenhum content script; popup e heartbeat não tocam o ML.
4. **D4 Token ML no servidor (owner)**: extensão envia `ssid` + CSRF **só** para
   `PUT /api/extension/marketplaces/ml/session`; API cifra (`ISecretCipher`, já existente, AAD
   `tenantId:MERCADO_LIVRE:session`) e usa para ler produto, buscar ofertas e gerar link. Nunca logado, nunca
   devolvido, nunca no canal.
5. **D5 Link de afiliado**: substitui `docs/gerador-de-ofertas.md:96` por "link gerado no servidor com a sessão ML
   e a etiqueta do próprio tenant". Conta ML só sobrescreve a sessão do tenant se for a mesma conta (hash de
   `orguseridp`) e, quando a leitura de etiquetas responder, se a etiqueta cadastrada estiver entre as dela (§4.3).
6. **D6 Etiqueta automática**: após o 1º sync, o **servidor** lê as etiquetas com a sessão do próprio usuário
   em `GET https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/tags` → `{tags:[{tag, in_use}]}`
   (referência MIT `geralink`, `gerar-link.ts:34,133-146`). API CopySync:
   `GET /api/integrations/affiliate-credentials/MERCADO_LIVRE/account-tags` (Bearer + tenant + entitlement); o
   painel pré-seleciona a etiqueta com `inUse` (o `in_use` do ML é mapeado no adapter), o usuário confirma e grava pela rota de credencial existente.
   Fallback **só se a F0 mostrar o servidor bloqueado**: extensão faz GET do mesmo endpoint JSON com a host
   permission (sem offscreen, pois é JSON) e devolve só a lista pelo canal. Iframe não é usado.
7. **D7 Entitlement** `marketplace_extension`: ausente = negado; vale só para **uso da sessão ML** (sync,
   `createLink`, `getProduct`, busca, leitura com cookie) — link colado à mão continua sem entitlement. Presets:
   migration com `INSERT … ON CONFLICT ("planSlug","key") DO NOTHING` e valor explícito para cada slug da P5;
   regra nova, a acrescentar em `docs/arquitetura-central-billing.md:73-74` (fonte única `PlanEntitlementPreset`):
   "todo plano tem `marketplace_extension` explícito" no seed e na tela super-admin; backfill de tenants só com
   autorização. Correção de preset errado: só pela tela super-admin (fonte única), não por nova migration.
   **Revogação**: Sync e Apply hoje fazem upsert sem remover chaves, pulam `null` (`?? undefined`) e o Sync retorna
   antes de atualizar `planSlug` quando não há presets (`ApplyBillingEventUseCase.ts:113-131`,
   `SyncTenantEntitlementsUseCase.ts:12-27`). F1 muda os dois: chave de D7 ausente no plano novo grava `false`;
   `null` vira `false` para chaves booleanas; `planSlug` atualiza mesmo sem presets; teste de paridade Sync × Apply.
8. **D8 Consentimento**: no passo "Vincular" do wizard, texto explícito ("a extensão envia a sessão do Mercado
   Livre ao servidor para gerar seus links") + aceite → `POST /session {mlSessionConsent:true}` grava
   `ExtensionSession.mlConsentAt`; sem ele, o `PUT` da sessão ML é recusado (LGPD + Web Store).
9. **D9 Estado** em Postgres. Exceção registrada (AGENTS.md: estado em memória só com equivalente externo
   previsto): rate limits por instância, best-effort — F7 acrescenta o item "rate limit compartilhado (Redis)" em
   `docs/arquitetura-escala.md`. Cache de bootstrap/CSRF **não** fica em memória: vai no blob cifrado.
   IP do rate limit pelo salto confiável do proxy (`trustProxy` com contagem fixa = 1 na Render, hoje `true` em
   `app.ts:63`), mais chave por `installationId`/sessão.

## 4. Arquitetura

### 4.1 Vínculo / login central

```
Painel (Bearer + X-Tenant-Id)  Extensão SW                                 API
 |--connect(extId)------------>| origem = PANEL_ORIGIN
 |--bridge.identify----------->| {installationId, extensionId, version}
 |--POST /api/extension/session {installationId, deviceId, extVersion, mlSessionConsent} (withCredentials)->| membro →
 |                             |                       cria/reemite ExtensionSession {mlTenantId = X-Tenant-Id}
 |<------------------------ Set-Cookie __Host-ext_session (Max-Age até absoluteExpiresAt) -|
 |--session.changed {}-------->| invalidarSessao()
 |                             |--GET /api/extension/me (cookie)------------------------->|
 |                             |<-- {user, mlTenantId, tenants[{id,name,status,permissions}]} |
 |--handshake----------------->| {extVersion, contractVersion, caps, authenticated, userId}
```

- **Sem código de pareamento** (decisão de 2026-10-26): site e extensão estão no mesmo Chrome, então o vínculo é
  o do Pulso — `externally_connectable` (só `PANEL_ORIGIN` fala com a extensão) + `installationId` (não é segredo)
  + `POST /session` autenticado pelo login do site → cookie HttpOnly que nenhum JS lê. Código mostrado na popup
  foi descartado: é para aparelhos sem navegador compartilhado, fica exposto a engenharia social e acrescenta passo.
- `POST /session` exige `UserTenant` ativo explícito: **sem** o bypass de super-admin de `resolveMembership`
  (`resolveMembership.ts:16-35`), para ninguém vincular extensão a tenant alheio. Antes do vínculo, o painel lê o
  entitlement do tenant pelo endpoint existente de plano/uso (Bearer) para decidir o passo 3 do wizard.
- `userId` divergente → "Extensão vinculada a outra conta" + revincular. Trocar o tenant do ML = revincular.
- Reemissão: update condicional ao hash vigente, anterior vale 60 s, renova teto; perdedor da corrida responde
  200 sem `Set-Cookie`.
- Logout **explícito** (botão "Sair" → `logout()`): axios sem interceptors, `withCredentials`, sem
  `Authorization`, `X-Client: web` → `DELETE /api/extension/session`; aguarda ≤ 2 s → `session.changed {}` →
  redireciona. `clearSessionAndRedirect` (`app/src/services/apiClient.ts:31-41`) **não** chama a rota: ele roda
  em 401/403 de Bearer expirado (`apiClient.ts:150,159`) e revogaria a extensão a cada expiração. Idempotente (204
  + cookie limpo). 401 nas demais rotas nunca limpa cookie.

### 4.2 Canal painel ↔ extensão

- **A construir na F2** (hoje o transform do `extension/webpack.js` só troca `version`; `public/manifest.json`
  tem `content_scripts` e `key`, sem `externally_connectable` nem host da API): transform gera
  `externally_connectable` a partir de `new URL(PANEL_URL).origin + '/*'`, `host_permissions` = API + ML, remove
  `content_scripts`; `DEV_ORIGINS` via dotenv só em dev (padrão `pulsosocial_extension/webpack.js:20-35`); target
  `build:store` remove `key` (dev mantém, para ID estável). `check-dist.mjs` passa a ler o manifest e falha com
  `content_scripts`, localhost/IP em `externally_connectable`/`host_permissions` e `key` no artefato de loja.
  `extension/.env.dev` passa a `PANEL_URL=http://localhost:5174` (hoje 5173; Vite usa 5174, `vite.config.ts:26`).
- Contrato `extension/src/contract/channel.ts` (novo) criado e copiado para `app/src/features/extension/contract/channel.ts`;
  `extension/scripts/check-contract-sync.mjs` (novo) ligado no `type-check`; app ganha `@types/chrome` (dev).
- Envelope `{channel:'cs-ext', version:1, direction, requestId, timestamp, op, payload}`; erro `{code}`, e só
  `FORBIDDEN` acrescenta `reason`.
- Pipeline (`extension/src/background/channel/`): origem → versão N−1 → filtro de envelope (TTL 15 s,
  anti-replay, rate limit, recusa campo `auth`) → guard → handler → `assertNoSecrets`. Códigos do guard (como
  `pulsosocial_extension/.../guard.ts:179-198`): `NEEDS_LOGIN` (sem sessão central), `AUTH` (sessão
  inválida/expirada), `FORBIDDEN` com `reason: 'MEMBERSHIP'|'TENANT'|'PLAN'` (vindo do `/me`; desvio 5), para o
  painel distinguir "entre", "revincule" e "assine".
- Ops v1: `handshake`, `bridge.identify`, `session.changed`, `ml.status`, `ml.syncSession`. **Condicionais à F0**
  (só entram se o fallback for acionado): `ml.getAffiliateTags` e o campo `needsTab`.
- Popup: só estado da sessão central + "Abrir painel"; sem `chrome.cookies`/`tabs`.
- Painel `app/src/features/extension/`: `channel/client.ts` (`VITE_EXTENSION_IDS`, loja e dev), `extensionStore.ts`,
  `useExtension.ts`, `strings.ts`.

### 4.3 Sessão do ML (extensão → API), modelo legadoML com gate

- `ml.status` → `{loggedIn, lastSyncAt, resyncRequested, needsTab?}` (presença de `ssid` + `orguseridp` e último
  sync; nada sai). `needsTab` só no fallback de CSRF.
- `ml.getAffiliateTags` → `{tags:[{tag, inUse}]}` — **só fallback** de D6 (GET do endpoint JSON `stripe/user/tags`).
- **Constantes** (mesmo módulo, espelhadas na API com teste de paridade):
  `ML_SESSION_COOKIES = ['ssid','orguseridp','orguserid','orgnickp']` (identidade; vêm da extensão);
  `ML_TEMP_COOKIES = ['_csrf','_d2id','_mldataSessionId','nsa_rotok']` (temporários; renovados pelo servidor no
  bootstrap); `ML_SERVER_COOKIES` = união. **A extensão lê e envia só `ML_SESSION_COOKIES`** (identidade); os temporários
  vêm só do bootstrap do servidor. Dos 7 do Bot do Afiliado, os 3 temporários (`_csrf`, `_d2id`, `nsa_rotok`) ficam
  fora do PUT; a F0 só os devolve à extensão se o bootstrap não os gerar. Paridade extensão × API cobre
  `ML_SESSION_COOKIES`.
- `ml.syncSession` (e gatilhos abaixo; "vinculada" é estado, não exige painel
  aberto — revalida (b)/(c) a cada disparo): gate D3 → lê **lista fechada** `ML_SESSION_COOKIES` (identidade, subconjunto dos 7 do Bot do
  Afiliado em produção, `legadoBot/.../cookies-lojas.js:16-42`; F0 reduz por
  remoção, amplia só com evidência e paridade atualizada; nunca "todos") via
  `chrome.cookies.getAll({url})` (Chrome aplica domínio/path/Secure; F0 confirma se uma URL traz todos ou se são
  duas, deduplicadas), descartando
  particionados e valores inválidos, nome repetido → path mais longo; logado = `ssid` + `orguseridp`; só em
  `marketplaceSession.ts` (`check-cookie-scope.mjs` ajustado: regex com `\s*`, constante checada no arquivo
  inteiro, aceita `getAll({url})` e `onChanged`; teste compara a lista da extensão com a do servidor)
  → `PUT /api/extension/marketplaces/ml/session {cookies:{…}, capturedAt}` (sem campo `csrf`: o CSRF vem só do
  bootstrap). O schema do PUT recusa nome fora de `ML_SESSION_COOKIES`, mais de 4 cookies e valor acima de 4 KB (hoje só `maxLength 8192`,
  `affiliateCredential.schema.ts:55-58`).
- Gatilhos (como `legadoBot/.../background.js:280-303`): `chrome.cookies.onChanged` (listener top-level síncrono
  no SW; **filtro no callback**, a API não filtra) por domínio + nome da lista → espera 60 s (alarme `ml-session-pending`); alarme de reserva 60 min; `onStartup`; botão "Sincronizar
  agora". Envia só se `sha256(cookies de identidade)` mudou (rotação de temporários no navegador não dispara sync), teto 1 envio/15 min (botão ignora o teto), uma rodada por vez.
- Resposta tipada (padrão `OfferErrors.ts`, `UPPER_SNAKE`; painel/popup mostram o próximo passo):
  200 `{result:'UPDATED'|'UNCHANGED'}` (nome `result`, não `status`, que já é ACTIVE/INACTIVE na credencial) |
  409 `ML_ACCOUNT_MISMATCH` | 409 `ML_TAG_MISMATCH` | 403 `PLAN_FEATURE_UNAVAILABLE {key:'marketplace_extension'}`
  | 403 `ML_CONSENT_REQUIRED`. `PLAN_FEATURE_UNAVAILABLE` hoje é `OfferMentionAllUnavailableError` com
  `key:'mention_all_enabled'` fixo (`OfferErrors.ts:110-112`): F1 parametriza em `PlanFeatureUnavailableError(key)`,
  mantendo o uso atual, com teste por chave. Etiqueta ainda não cadastrada **não** bloqueia o sync (o wizard pede depois).
  **Bootstrap + CSRF no servidor** (referência MIT `geralink`, `gerar-link.ts:121-158`): `GET
  https://www.mercadolivre.com.br/afiliados/linkbuilder` com os cookies da sessão (`redirect:'manual'`, allowlist
  exata, cookie nunca segue para outro salto) → o ML devolve por `Set-Cookie` os temporários `_csrf`, `_d2id`,
  `_mldataSessionId` → `x-csrf-token`, nesta ordem: valor do cookie `_csrf` do bootstrap → meta/estado embutido
  (reserva); teste da precedência. Temporários vivem só no servidor (mesmo blob cifrado), renovados a cada
  bootstrap e gravados pela regra de `Set-Cookie` do §4.4. Bootstrap reaproveitado (guardado no blob), não refeito
  por chamada; **403 descarta os temporários guardados e refaz o bootstrap uma vez** — se o 403 persistir, vale a
  classificação do §4.4 (503 temporário com backoff). Só se a F0 provar
  que o CSRF do servidor é recusado, volta o fallback do legado: `executeScript` ISOLATED em aba aberta, só pela
  meta, sem aba → `needsTab`. `resyncRequested` força envio; mutex (como
  `syncSession.ts:51-57`). **Storage guarda só o hash + `lastSyncAt`, nunca valores de cookie.**
- API: `UpsertAffiliateSessionUseCase` **mantido em `integrations`** (AAD `affiliateCipherAad.ts`,
  `SecretCipherFactory`) e injetado no container de `extension` (precedente: `offersContainer.ts:4-5`). Ordem:
  sessão válida + `mlConsentAt` → `mlTenantId` → membro + tenant ACTIVE + entitlement → **mesma conta ML**:
  `HMAC(chave, tenantId:orguseridp)` comparado com `AffiliateCredential.sessionAccountHash`, usando o keyring
  `ML_ACCOUNT_HMAC_KEYS` (versão → chave): compara com a chave da `sessionAccountKeyVersion` gravada; se bater e a
  versão for antiga, regrava com a atual; 409 `ML_ACCOUNT_MISMATCH` só se nenhuma bater (gravado no 1º sync;
  chave antiga fica no keyring até nenhuma linha usá-la) → etiquetas da conta
  **buscadas pelo servidor com os cookies deste PUT** (endpoint `stripe/user/tags`; se a busca falhar, grava com
  `result:'UPDATED'` + `tagVerified:false`: a troca de conta já é barrada pelo hash, e a etiqueta volta a ser
  conferida pelo `long_url` em cada geração) → credencial com `publicIdentifier` fora delas → 409
  `ML_TAG_MISMATCH` (proteção contra engano: um membro já pode trocar a etiqueta pela rota de credencial) → cifra e
  grava com `sessionInvalidAt = null`. Hoje `sessionColumns` não zera esse campo e `toDomain` não expõe
  `sessionInvalidAt`/`sessionAccountHash`/versão (`PrismaAffiliateCredentialMapper.ts:18-30,65-72`): F1 inclui os
  três em `toDomain`/`toRecord`, `sessionInvalidAt: null` em `sessionColumns` e teste no mapper. Auditoria só
  quando `ssid` ou a conta mudam. Contrato muda: segredo `AffiliateSessionSecret` passa de `{sessionToken,
  csrfToken}` para `{cookies, csrf?}`; DTO sem `affiliateTag`/`publicIdentifierIfEmpty` (etiqueta só pelo painel,
  D6). **Consumidores a migrar na F1** (senão viram `undefined` em silêncio): `GenerateOfferUseCase.ts:204-207`
  (`cred?.session?.sessionToken`; o `pageReader` passa a ser chamado **sem token** para ML — regra de fonte no §4.4),
  `HttpProductPageReader.ts:40`, `IProductPageReader.ts:9`, `IAffiliateCredentialResolver.ts:8-9`,
  `AffiliateCredentialDTO.ts:35-38`, `UpsertAffiliateSessionUseCase.test.ts`, `GenerateOfferUseCase.test.ts`.
  Nunca loga corpo/headers. O PUT da extensão é a fonte da verdade (substitui `ML_SESSION_COOKIES` e descarta os
  temporários, §4.4). **Breaking change** (410 da rota legada + formato do segredo): seção "Breaking Changes" em
  `api/CHANGELOG.md`; sem migração de dados (0 credenciais em prod).
- **Trocar conta / Desconectar ML**: ação explícita do usuário (botão no card/wizard) →
  `DELETE /api/integrations/affiliate-credentials/:provider/session` (**rota nova**, Bearer + tenant; não confundir
  com o `DELETE /:provider` existente, `affiliateCredential.routes.ts:88`, que apaga a credencial inteira) →
  `ResetAffiliateSessionAccountUseCase` (`integrations`) zera sessão + `sessionAccountHash`; auditoria com valor
  novo `AFFILIATE_SESSION_ACCOUNT_RESET` no enum `AuditAction` (`schema.prisma:50-73`, `ALTER TYPE … ADD VALUE` na
  migration). Revincular a extensão **não** reseta a conta.
- `GET /api/integrations/affiliate-credentials/:provider/account-tags` (**rota nova**, F1; Bearer + tenant +
  entitlement): sem sessão → 409 `ML_SESSION_EXPIRED`; resposta `{tags:[{tag, inUse}]}` (camelCase na API e no canal; o `in_use` do ML é mapeado no adapter).
- Expiração: `GenerateOfferUseCase` recebe `AffiliateSessionExpiredError` do adapter e chama
  `MarkAffiliateSessionInvalidUseCase` (`integrations`) → `sessionInvalidAt`; resolver
  (`IAffiliateCredentialResolver.ts:9`) passa a expor os cookies da lista fechada e a validade; heartbeat devolve
  `ml.resyncRequested`; painel avisa (resolve a pendência 4 de `docs/extensao-navegador.md`).

### 4.4 Uso no servidor (gerador de ofertas)

- Porta nova `IMercadoLivreAffiliateClient` (`campaigns/domain/contracts`) + adapter
  `infrastructure/http/MercadoLivreAffiliateClient.ts` (como `ShopeeAffiliateClient.ts`): `getProduct`,
  `searchOffers`, `createLinks(urls[], tag)` (**uma porta só**; na v1 o gerador chama com 1 URL por oferta e a cota
  continua contando ofertas gravadas, `GenerateOfferUseCase.ts:92-96,150-151`; o lote ≤20 fica pronto no adapter
  para seleção múltipla futura, sem consumidor na v1); `tag` = `credential.publicIdentifier` (fonte única; `stripe/user/tags`
  só no wizard/sync); usa os cookies decifrados; timeouts/limites iguais
  aos HTTP existentes; host allowlist ML; falha de sessão (classificação abaixo) → lança
  `AffiliateSessionExpiredError` (código `ML_SESSION_EXPIRED`). `getProduct` é **próprio** do adapter (recebe a
  lista fechada e lança em sessão expirada), reaproveitando o parser puro `parseProductPage.ts`; o
  `IProductPageReader` atual (`ssid` único, "nunca lança", `IProductPageReader.ts:9-12`) fica para os outros
  marketplaces e link colado.
- **`createLinks` (principal)** — referência MIT `geralink` (`gerar-link.ts:35,79-109`), reimplementado:
  `POST https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink` body `{urls[≤20], tag}`;
  headers `accept`, `content-type: application/json`, `origin`, `referer` = `/afiliados/linkbuilder`, `cookie`,
  `user-agent`, `x-requested-with: XMLHttpRequest`, `x-csrf-token`. Lotes de **até 20**, pausa de 2 s entre lotes.
  Resposta `{total_success, total_error, urls:[{origin_url, short_url, long_url, type_url, error_code, message}]}`;
  casar item por `origin_url` (índice como reserva); `long_url` opcional. **HTTP 200 não basta**: item sem `short_url` = erro do item
  (ex.: `error_code 111` "URL not allowed" para busca, categoria, catálogo genérico ou anúncio fora do programa) →
  `ML_URL_NOT_ALLOWED` só para aquele item. Porta: `createLinks(urls[], tag)` → `{ok, url, shortUrl?, longUrl?,
  error?}` por item. `short_url` = link da mensagem; `long_url` = prova de etiqueta. Expansão `meli.la`/`/sec/`/
  `/social/` pelo `HttpShortLinkExpander` existente, sem `got-scraping`.
- Endpoint alternativo `POST …/api/v2/stripe/user/links {url, tag}` (Afilimax): só reserva se o principal falhar na F0.
- Link curto pode vir como `meli.la/…` **ou `mercadolivre.com/sec/…`** (formato citado pelo Bot do Afiliado);
  `HttpShortLinkExpander.isShortLink` já cobre `/sec/` — F0 confirma qual o linkbuilder devolve hoje.
- **Atualização por `Set-Cookie` (todas as respostas do ML)**: bootstrap do linkbuilder, `stripe/user/tags`,
  `createLinks` e `getProduct` passam pelo mesmo jar do adapter, que aceita só `Set-Cookie` de host da allowlist e
  só nomes de `ML_SERVER_COOKIES` (§4.3). Regras do jar (um teste por caso): sem `Domain` → host-only do host que
  respondeu; `Domain` só aceito se for sufixo do ML; `Path` casado na hora de enviar; nome repetido → path mais
  longo; `Max-Age` prevalece sobre `Expires`; `Expires` passado ou `Max-Age=0` remove; `Secure` exigido.
  Ao fim da operação, `ApplyRotatedSessionCookiesUseCase` (`integrations`, sem `userId`, não mexe em
  `sessionSyncedAt`/`sessionAccountHash`, sem auditoria) grava o que mudou com **compare-and-set** contra a versão
  do blob lida antes (perdeu para um PUT da extensão → descarta) — nunca string vazia.
  - Cookie de **sessão** (`ssid`, `orguseridp`) removido/expirado → `sessionInvalidAt` + resync.
  - Cookie **temporário** (`_csrf`, `_d2id`, `_mldataSessionId`, `nsa_rotok`) removido/expirado → só novo
    bootstrap na próxima chamada; não invalida a sessão.
  - PUT da extensão substitui os nomes de `ML_SESSION_COOKIES` e descarta os temporários do servidor (força
    bootstrap novo; evita misturar `_csrf` antigo com `ssid` novo).
  - F0 verifica se usar `nsa_rotok` no servidor invalida o do navegador; se invalidar, o servidor não usa nem
    regrava `nsa_rotok`.
- Classificação de falha (regra fixa **por endpoint**, uma fixture cada):
  - qualquer endpoint: 401 ou redirect/marcador da página de login → sessão expirada (`sessionInvalidAt`);
    403 (após 1 novo bootstrap, §4.3) ou HTML de desafio sem marcador de login (bloqueio/anti-bot, `geralink` `README.md:105`) →
    `AFFILIATE_API_UNAVAILABLE` 503 temporário com backoff, **sem** tocar `sessionInvalidAt`;
  - endpoints JSON (`createLink`, `stripe/user/tags`): resposta HTML com marcador de login → sessão expirada;
    `urls` ausente/não-array → `AFFILIATE_API_UNAVAILABLE` 503 (padrão `AffiliateApiUnavailableError` de
    `OfferErrors.ts`, com `{provider}`; não invalida a sessão); item sem `short_url` → erro **do item**
    (`error_code 111` → `ML_URL_NOT_ALLOWED`; código desconhecido → `ML_LINK_FAILED` com o `error_code`);
  - `getProduct` (HTML é o normal), nesta ordem: marcador/redirect de login → sessão expirada; marcador de
    desafio/anti-bot (detectado **antes** do parser) → 503 temporário, sem tocar `sessionInvalidAt`; HTML de
    produto = sucesso; HTML sem dados e sem marcador → `null` (dados manuais, como hoje);
  - resposta de `createLinks` com `urls` vazio ou sem item casável para a URL → `ML_LINK_FAILED`;
  - 429 → `AffiliateApiRateLimitedError` (existente) + backoff.
- `GenerateOfferUseCase` (ML), schema inalterado (`url`, `offer.schema.ts:31-32`); expand + `parseProductRef`
  antes; ramo novo **antes** de `checkOwnership`, porque hoje `verifyAffiliateLink` devolve `not_affiliate` para URL
  sem identificador (`verifyAffiliateLink.ts:67`) e o erro sai em `GenerateOfferUseCase.ts:109-113`:

  | Link recebido | Condição | Resultado |
  | --- | --- | --- |
  | Com identificador do tenant | — | `verified`, como hoje; dados do produto pela regra de fonte abaixo |
  | Com identificador de outra conta | — | `OfferLinkNotOwnedError`, como hoje |
  | Sem identificador (URL de produto) | entitlement + credencial ACTIVE com etiqueta + sessão sem `sessionInvalidAt` | `createLinks([finalUrl], tag)` com a URL **já expandida e revalidada** (não re-expande) → `affiliateUrl` = `short_url`, `sourceUrl` = produto; `attributionVerified=true` **só se** `long_url` trouxer a etiqueta do tenant (comparação sem caixa), senão `false`; sem passar por `verifyAffiliateLink` |
  | Sem identificador | item recusado pelo ML (`error_code 111`) | 422 `ML_URL_NOT_ALLOWED`, nada gravado, cota não consumida |

  Linhas de falha do ramo "sem identificador", avaliadas **nesta ordem**: (1) sem entitlement → 403
  `PLAN_FEATURE_UNAVAILABLE {key:'marketplace_extension'}`; (2) sem credencial ACTIVE, ou ACTIVE sem etiqueta
  (o resolver devolve `null`, `ResolveAffiliateCredentialUseCase.ts:22`) → `OfferLinkNotAffiliateError`, como hoje;
  (3) sessão ausente ou `sessionInvalidAt` → 409 `ML_SESSION_EXPIRED` (painel pede resync). Catálogo `/p/MLB…`
  (`parseProductRef.ts:46`) é tratado como produto e enviado ao ML; se o ML recusar, cai na linha do `111`.

  **Ordem fixa** (evita imagem órfã — hoje `storeImage` roda em `GenerateOfferUseCase.ts:117` e só é descartada no
  `catch` do create, `:152-155`): cota → expand/ref → credencial + entitlement → `createLinks` → `getProduct` →
  `storeImage` → compose → `createWithinDailyLimit`. Falha em `createLinks` não consome cota nem grava imagem.

  **Regra de fonte dos dados do produto (ML)** — no ramo "com identificador" vale inteira; no ramo "sem identificador" sessão ausente/expirada já parou antes (409 `ML_SESSION_EXPIRED`), então só se aplica a degradação após o link gerado: com entitlement + sessão válida → `getProduct` do
  adapter; sem entitlement, sem sessão ou `sessionInvalidAt` → `pageReader` **sem token** (como tenant sem
  extensão). `ML_SESSION_EXPIRED` do `getProduct` degrada para `pageReader` sem token e, se ele devolver `null`, para dados manuais; **429 ou desafio/503 vão direto para dados manuais** (sem nova chamada ao host que limitou; o `pageReader` de ML também conta no limite de 30/min por tenant) — como o ramo Shopee (`GenerateOfferUseCase.ts:182-201`) — e
  nunca aborta a oferta; `ML_SESSION_EXPIRED` também marca `sessionInvalidAt`. No ramo "sem identificador" o link
  já foi gerado no ML, então a oferta segue gravada mesmo sem dados (evita link órfão e novo link no retry).
  Testes F4: uma linha da tabela por caso + cada erro do `getProduct` degradando; mudam de propósito
  `GenerateOfferUseCase.test.ts:169-171` (ML sem `matt_word` → `OFFER_LINK_NOT_AFFILIATE` vira `createLinks`) e
  `:160-166` (`pageReader` com `SSID-TOKEN` vira `getProduct`/sem token); entram casos de sessão ausente/expirada.
- **Dados do produto**: nenhuma referência revela endpoint do ML (Bot do Afiliado entrega título, imagem, preço,
  preço anterior e parcelas, mas não diz a origem; o scrape dele é do DOM da aba). Caminho: `getProduct` do adapter
  com o parser existente (og/JSON-LD/`andes-money-amount`, `parseProductPage.ts:151-169`) e a sessão;
  se a F0 confirmar a API oficial (`/items/{id}`, `/products/{id}` com token de app), ela vira a fonte primária.
  Parcelas e preço com cupom: manuais na v1. Histórico de preço (como o Bot) = gravar nossas próprias leituras, fora
  de escopo.
- **Busca de ofertas**: nenhuma referência documenta. F0 compara, nesta ordem de preferência: API oficial
  `/sites/MLB/search` com app OAuth registrado no DevCenter (P6), página pública `mercadolivre.com.br/ofertas`,
  listagem da Central de Afiliados. Se nenhuma passar, a aba de busca sai da F4 e volta ao owner.
- Busca: `GET /api/campaigns/offers/marketplaces/ml/search` (Bearer + tenant + entitlement) → lista; escolher item
  chama o gerador com a URL do item. Aba "Buscar no Mercado Livre" no `OfferGeneratorForm` (componente novo),
  visível com credencial ACTIVE + sessão válida + entitlement; consulta `GET /api/campaigns/offers/usage` antes.
- Todo **uso da sessão** ML checa `getBoolean(tenantId,'marketplace_extension') === true` (D7).
- Erros novos em `OfferErrors.ts` + `strings.ts` (`UPPER_SNAKE`, com `{provider}` como os `AFFILIATE_API_*`):
  gerador — `ML_SESSION_EXPIRED` (409), `ML_URL_NOT_ALLOWED` (422), `ML_LINK_FAILED` (422); só no PUT da sessão
  (§4.3, não no gerador) — `ML_ACCOUNT_MISMATCH`, `ML_TAG_MISMATCH` (409), `ML_CONSENT_REQUIRED` (403). Reusa
  `AFFILIATE_API_UNAVAILABLE` (503) e `AffiliateApiRateLimitedError` (429). **Cria** `PlanFeatureUnavailableError(key)`
  em `OfferErrors.ts` (F1) e migra `OfferMentionAllUnavailableError` (`OfferErrors.ts:109-113`) para ela.
- Rate limit por tenant nas chamadas ao ML (ToS/anti-bot): **30 chamadas/min por tenant** (cada oferta usa até 3:
  bootstrap quando expirado, `createLinks`, `getProduct`); acima → `AffiliateApiRateLimitedError`. F0 ajusta o
  número.

### 4.5 API — módulo `extension` (`api/src/modules/extension/`)

- Prisma (migration `add-extension-sessions-lifecycle-outbox`):
  - `ExtensionSession {id, userId → User onDelete Cascade, installationId → ExtensionInstallation onDelete Cascade, mlTenantId →
    Tenant onDelete Cascade, tokenHash @unique, prevTokenHash?, prevValidUntil?, extVersion, mlConsentAt?,
    lastSeenAt, expiresAt, absoluteExpiresAt, revokedAt?, createdAt}` `@@unique([userId, installationId])`
    `@@index([prevTokenHash])` `@@index([mlTenantId])` `@@index([absoluteExpiresAt])` (padrão `RefreshToken`,
    `schema.prisma:224-240`). Modelo novo: no Pulso a sessão fica na `Session` do site; aqui só se copia a ideia
    de hash + graça de rotação de `session-cookie.ts`. Poda: sessão revogada ou expirada há > 30 d é apagada pelo
    job `extension-retention` do §4.6.
  - `ExtensionInstallation` (copia `pulsosocial_api/api/prisma/schema.prisma:2254-2281`): `installationId @id`
    (UUID validado no servidor), `extensionId`, `channel`, `deviceId?`, `userId?` → User `onDelete SetNull`,
    `version`, `status` (ACTIVE/UNINSTALLED/INFERRED_GONE/REPLACED), `firstSeenAt`, `installedAt?`, `lastSeenAt`,
    `lastHeartbeatAt?`, `lastSiteSeenAt?`, `uninstalledAt?`, `previousInstallationId?`;
    `@@index([deviceId, extensionId])` `@@index([userId])` `@@index([status, lastSeenAt])`. Regra de dono (§4.6).
  - `ExtensionLifecycleEvent {id, installationId, type, occurredAt, userId?, channel, version, dedupeKey}`
    `@@unique([installationId, dedupeKey])` (dedupeKey = `type:version` para INSTALL/UPDATE; `clientEventId` gerado
    pela extensão nos demais) — o Pulso não tem unique (`schema.prisma:2283-2301`); aqui é o que faz o P2002 valer.
  - `HubOutboxEvent` (§4.6) `@@unique([clientKey, seq])` `@@index([status, nextAttemptAt])`.
  - `AffiliateCredential.sessionInvalidAt?`, `sessionAccountHash?`, `sessionAccountKeyVersion?`.
  - `AuditAction` += `AFFILIATE_SESSION_ACCOUNT_RESET` (`ALTER TYPE … ADD VALUE`).
  - presets `marketplace_extension` (migration de dados versionada, D7, após P5).
- Use cases: `IssueExtensionSession`, `ValidateExtensionSession`, `RevokeExtensionSession`, `GetExtensionProfile`,
  `RecordLifecycleSignal`; porta própria `IExtensionEntitlementReader` em `extension/domain`. O adapter
  `PrismaEntitlementReader` (hoje em `campaigns/infrastructure/repositories/PrismaEntitlementReader.ts:27`) **muda
  para `tenants/infrastructure`** e satisfaz as portas de `campaigns` e `extension` (sem import cruzado entre os dois). Hooks só chamam use cases; `extensionAuthHook` preenche `{userId, isSuperAdmin}`.
- `extensionRequestGuard` em `onRequest` (antes do parse/validação do body; chamador sem auth recebe 403, não 400
  de schema) em todo método das rotas por cookie: `X-Client: extension` + `X-Installation-Id` = sessão + (Origin ∈
  `EXTENSION_ORIGINS` ou sem Origin com `Sec-Fetch-Site: none`). Exceção: `DELETE /session` com
  `Origin === PANEL_ORIGIN` + `X-Client: web`. Cookie `SameSite=Strict` em chamada da extensão: **não validado**
  (o Pulso só define o atributo, `session-cookie.ts:50`; o Chrome trata pedido de extensão a host com
  `host_permissions` como same-site, mas falta prova aqui). **F1 bloqueante**: teste real (extensão dev carregada
  → `GET /api/extension/me` com cookie). Se o cookie não seguir, usar `SameSite=Lax` (nunca `None`) e repetir.
- Rotas `/api/extension`: `POST /session` (Bearer + `UserTenant` ativo explícito; body `{installationId, deviceId,
  extVersion, mlSessionConsent}`), `DELETE /session`, `GET /me`, `POST /heartbeat`
  (`{extVersion, ml:{lastSyncAt}}` do storage; resposta `{ml:{resyncRequested}}`),
  `PUT /marketplaces/ml/session`, `GET /sessions` + `DELETE /sessions/:id` (Bearer), lifecycle (§4.6).
  Novas em `integrations` (F1): `GET /:provider/account-tags`, `DELETE /:provider/session` (§4.3).
  `PUT /api/integrations/affiliate-credentials/MERCADO_LIVRE/session` (Bearer, legado) → 410.
- Cookie: helper próprio (sem `@fastify/cookie`, como o Pulso). Prefixo e atributos pelo **esquema da URL da API**
  (critério do Pulso, `session-cookie.ts:28-31`): https → `__Host-ext_session; HttpOnly; Secure; SameSite=Strict;
  Path=/`; http (dev local) → `ext_session; HttpOnly; SameSite=Lax; Path=/`. Dev: painel e API locais, sem proxy
  para prod.
- CORS: **remove** `defaultCorsOrigins` e o merge (`app.ts:17-22,38`) e o ramo que reflete tudo (`app.ts:78-80`);
  em produção, lista = `CORS_ORIGIN` explícita (vazia ou `'*'` → boot falha); em desenvolvimento, vazia =
  `PANEL_ORIGIN` + localhost (localhost **só** com `NODE_ENV=development`); `credentials` só com lista;
  `allowedHeaders` += `x-client`, `x-installation-id`;
  `chrome-extension://` só em `EXTENSION_ORIGINS`.
- `trustProxy: 1` (hoje `true`, `app.ts:63`, e o IP vem do 1º `X-Forwarded-For`, forjável) — F1, com teste de
  XFF forjado.
- `@fastify/rate-limit@^9` com chave = IP do salto confiável + `installationId`/sessão (D9); limites das rotas
  públicas de lifecycle copiados do Pulso (`limit.ts:19-24`), mais `/api/auth/login`, `/api/extension/session`,
  `/marketplaces/ml/session`.
- Env:
  - **reusa** `PANEL_URL` (`env.ts:174`): `PANEL_ORIGIN = new URL(PANEL_URL).origin`; boot falha em produção sem ele
    (hoje é opcional e só monta links de convite). `CORS_ORIGIN` muda o default de `'*'` para vazio.
  - **novas**: `EXTENSION_ORIGINS` (vazio = nega; boot falha em produção sem ela), `HUB_EVENTS_ENABLED` (default
    `false`), `HUB_EVENTS_URL` + `HUB_EVENTS_APPLICATION_KEY` + `HUB_EVENTS_SECRET` (**par próprio de saída**; não
    reusa `BILLING_APPLICATION_SECRET`, que valida o webhook de entrada em `verifyBillingHmac.ts:29-36`),
    `ML_ACCOUNT_HMAC_KEYS` (keyring versão → chave de 32 B; boot falha em produção sem chave atual).
  - App: `VITE_EXTENSION_IDS`.

### 4.6 Ciclo de vida + hub

| Evento | Detector | Rota |
| --- | --- | --- |
| `INSTALL` / `UPDATE` | `onInstalled` (update com espera 0–30 min, slot `lifecycle.pending`, TTL 7 d) | `POST /api/extension/lifecycle/event` (pública; `X-Client: extension` + Origin ∈ `EXTENSION_ORIGINS`; rate limit) |
| startup | só `onStartup` | idem |
| `LINKED` / `UNLINKED` / `REINSTALL` / `REPLACED` | `POST`/`DELETE /session` (`deviceId` visto com `installationId` novo → anterior `REPLACED`) | interno |
| `UNINSTALL` | uninstall URL → página pública `/extension-removed?i=&e=&v=` (bloco público de `AppRoutes.tsx:22-23`) | `POST /api/extension/lifecycle/uninstall` (+ `feedback`) |
| `INFERRED_GONE` (desativada ou removida sem a página) | painel logado não acha extensão já vista no `deviceId` (≤ 1/5 min, ao voltar foco) | `POST /api/extension/lifecycle/absent` (Bearer) |
| `REACTIVATED` | qualquer sinal válido em instalação não ACTIVE | qualquer |

- Desativar × remover silenciosamente não se distinguem (limite do Chrome). Uninstall URL não assinada (aceito).
- **Rota pública** (`/event`, `/uninstall`) — regra única: cria linha nova ou atualiza linha sem dono por inteiro;
  em linha **com dono** toca só `status` + `lastSeenAt`, nunca `version`/`channel`/`extensionId` (estes só pelo
  heartbeat autenticado). `version` validada (semver, ≤ 32 caracteres) antes de gravar. `UPDATE` de linha com dono
  grava o evento e vai ao outbox; teto de 20 eventos públicos por instalação/dia no outbox (o excedente fica só no
  banco local). Limites copiados do Pulso (`limit.ts:19-24`: install 10/IP, startup+update 120/IP,
  uninstall 5 por instalação + 200/IP, janela 10 min) com IP do salto confiável (D9) + chave por `installationId`;
  ao lotar o mapa, **abre** como o Pulso ("usuário real primeiro", `limit.ts:9-12,114-120`).
- **Dono da instalação**: definido no `POST /session`. Instalação com outro dono → recusa (como o handshake do
  Pulso, `service.ts:364-365`), até `DELETE /session` (desvínculo explícito) liberar. Teto de 20 vínculos por
  usuário em 24 h (como `VINCULOS_MAX_24H`, `service.ts:59,330`). `REPLACED` só atinge instalação anterior **sem
  dono ou do mesmo usuário** (filtro do Pulso, `service.ts:131-138`) e do mesmo canal.
- Idempotência: `updateMany` condicional + evento (unique `installationId+dedupeKey`, §4.5) + outbox na mesma
  transação; P2002 relê.
- Contrato com o hub (P4): `INSTALL`, `UPDATE`, `LINKED`, `UNLINKED`, `REINSTALL`, `REPLACED`, `UNINSTALL`,
  `INFERRED_GONE`, `REACTIVATED` (`REPLACED`/`UNLINKED` como eventos é desvio 6).
- **Outbox** `HubOutboxEvent {id, clientKey, seq, installationId, type:'extension.lifecycle', payload{event,
  installationId, clientKey, version, occurredAt}, status (PENDING|SENT|DEAD), attempts, nextAttemptAt,
  lockedUntil?, sentAt?}`:
  - `clientKey` = a chave de cliente que o hub reconhece. O hub identifica por `externalUserId` central
    (`multi-application-hub/spec.md:56,201`) e o CopySync hoje só guarda `Tenant.billingCustomerId`
    (`Tenant.ts:8`): **P4 define qual é** (provável `billingCustomerId` do `mlTenantId` vinculado). Nunca a lista
    de memberships do usuário; sem `clientKey` → não entra;
  - evento sem dono (`INSTALL`/`UPDATE`/`UNINSTALL` de instalação ainda não vinculada) **não** entra no outbox:
    fica só no banco local e conta numa métrica `extension_lifecycle_unowned_total`;
  - ordem **por cliente** (o hub aplica watermark de `seq` por cliente, `spec.md:61,125,204`): `seq` alocado por
    contador `HubOutboxSequence {clientKey @id, lastSeq}` com `UPDATE … SET lastSeq = lastSeq + 1 RETURNING` (ou
    `INSERT … ON CONFLICT`) na mesma transação do evento; P2002 de `seq` → retry da transação, separado do caminho
    de dedupe do evento;
  - cabeça = `MIN(seq)` pendente por `clientKey`, **independente de lock**; worker: lease próprio
    `hub-events-outbox` com renovação por lote; claim por cliente (se a cabeça está travada por outro worker, pula
    o cliente inteiro naquele tick — nunca envia `seq n+1` antes de `n`); só na Render (`HUB_EVENTS_ENABLED`,
    default `false`);
  - 5xx/rede → backoff 1 min → 24 h, até 10 tentativas, depois `DEAD`; **4xx do hub → `DEAD` na hora**, sem retry;
    `DEAD` bloqueia a fila daquele cliente até replay manual (reenviar a cabeça destrava), com alerta
    (`spec.md:208-211`);
  - assinatura M2M **do hub** (canônica `method\npath\nquery\ntimestamp\nnonce\nsha256(body)`, headers
    `X-Application-Key`/`X-Nonce`/`X-Signature`, `spec.md:216-219`) com o par próprio `HUB_EVENTS_*` e teste
    vetorial; timestamp, nonce e assinatura **recalculados a cada tentativa** (janela de ±5 min do hub); o
    `verifyBillingHmac` atual (`timestamp.corpo`, sem nonce) **não** serve de base; `id` do outbox = `eventId`
    (dedupe no hub faz parte de P4).
- **Retenção / dados pessoais** — job diário `extension-retention` (lease próprio, só na Render, junto da flag do
  worker): outbox `SENT` apagado após 30 d, `DEAD` após 90 d; eventos e feedback após 365 d; `ExtensionSession`
  revogada/expirada há > 30 d; `ExtensionInstallation` sem dono pela regra do Pulso (30 d/90 d,
  `service.ts:640-676`). Feedback de desinstalação: só `reasons[]` fixos + `comment` ≤ 500 sem
  e-mail/telefone (removidos no servidor). Sem dado do ML. Entra na declaração de dados da F8.

### 4.7 Wizard do ML (Configurações › Credenciais)

`MercadoLivreConnectWizard` no card do ML (`app/src/features/settings/`), passos adaptados do Redirect Flow:

1. **Entre no Mercado Livre** (conta de afiliado) — instrução + abrir site.
2. **Instale a extensão** — botão da Web Store (até a F8: instruções de "carregar sem compactação" em dev; link da
   loja entra com o ID da F8); detecção por handshake ao voltar o foco.
3. **Vincule a extensão** — texto de consentimento (D8) + aceite → "Vincular" → `POST /api/extension/session`
   (tenant atual, `mlSessionConsent`) + `session.changed`; sem
   entitlement → explica e oferece upgrade; para aqui.
4. **Sincronizar** — `ml.syncSession`; só no fallback de CSRF: `needsTab` → "abra o Mercado Livre em uma aba" e
   tenta de novo. Mostra o `result`/código tipado com o próximo passo.
5. **Sua etiqueta** — `GET …/MERCADO_LIVRE/account-tags` (D6; fallback `ml.getAffiliateTags`): `inUse` →
   pré-selecionada; várias → escolher; nenhuma → link para criar. "Usar esta etiqueta" grava pela
   `PUT /api/integrations/affiliate-credentials/MERCADO_LIVRE`; credencial `INACTIVE` → oferece "Ativar"
   (`PATCH …/status`). Sem e-mail. Campo manual + "Onde encontrar minha etiqueta?" (`/afiliados/adminlabel`) só se
   a detecção falhar.

Estado final do card: extensão vinculada · ML conectado (sessão sincronizada há X) · etiqueta. Configurações ›
Extensão: estado e dispositivos. `strings.ts`, temas claro/escuro/sistema, agent-browser. Tooltips: o painel não
tem lib de tooltip hoje — usar o `Tooltip` do MUI (já no projeto; atende "Use sempre Tooltip Libraries" do AGENTS.md sem dependência nova) com `aria-label`/`describeChild`.

## 5. Fases

Dependências: F0 ∥ F1 → F2 → F3; F0 + F1 → F4 (testes); F4 ← P6 se a F0 escolher a API oficial; smoke real da
F4 após F2/F3; F2–F4 → F8; F6 após P4; presets da F1 após P5; F1 em prod: P7 ok. (Não há F5: fundida em F1/F2
na v4.)
**Versão + CHANGELOG em cada fase** (AGENTS: "atualizar package.json a cada alteração"; o bump de release do §31.2
segue no `release/*`): api `0.23.0` → `0.24.0` (F1, com "Breaking Changes": 410 + formato do segredo) → `0.25.0`
(F4) → `0.26.0` (F6); app `0.23.0` → `0.24.0` (F3) → `0.25.0` (F4); extensão `2.0.1` → `3.0.0` (F2,
`package.json` + `public/manifest.json`) e patch na F8 se a loja pedir; F7 (só docs) sem bump. CHANGELOG: api em
`api/CHANGELOG.md` (AGENTS §31.3); app e extensão em `CHANGELOG.md` da raiz (padrão de
`docs/extensao-navegador.md:107`). Owner confirmou: bump a cada fase.

| Fase | Entrega | Pronto quando |
| --- | --- | --- |
| F0 | Spike ML (conta do owner, agent-browser): **conjunto de cookies** (1º teste: só `ssid` + bootstrap do linkbuilder, como o `geralink`; depois os 7 do Bot do Afiliado; reduzir por remoção; `orguseridp` fica pela checagem de conta); bootstrap + `affiliates/createLink` (lote 20) e `stripe/user/tags` **a partir da Render** (local já validado pelas referências); validade do bootstrap/CSRF; rotação via `Set-Cookie` e se `nsa_rotok` usado no servidor invalida o do navegador; formato de `long_url`/`type_url` e casos `error_code 111`; produto pela página (Render, com e sem sessão) × API oficial `/items`/`/products`; busca: API oficial `/sites/MLB/search` (com/sem token de app) × `/ofertas` × Central de Afiliados; validade da sessão → `docs/extensao-ml-endpoints.md` + fixtures | varredura sem `ssid`, `_csrf`, `_d2id`, `nsa_rotok`, `orguserid`, `orgnickp`, `_snoopy`, `x-bf-session`, `ftid`, `csrf`, ids/etiqueta do owner nas fixtures |
| F1 | Módulo `extension` (sessão, guarda, `/me`, sync ML, heartbeat, lifecycle, outbox sem worker), **domínios** (`app/.env*` → `https://api.copysync.app/api`, `extension/.env*` → `PANEL_URL=https://app.copysync.app`, AGENTS.md/docs com o painel em `app.copysync.app`), rotas novas de `integrations` (`account-tags`, `DELETE …/session`), migration, presets, Sync/Apply de entitlement, `PlanFeatureUnavailableError(key)`, CORS, cookie, rate limit, 410 da rota legada, migração dos consumidores do segredo | `tsc`; testes: guarda (incl. `onRequest` antes do schema; Origin `chrome-extension://` com cookie Strict), reemissão/corrida, logout explícito × `clearSessionAndRedirect` sem rede, `POST /session` sem bypass de super-admin, `permissions` sem plano/membro/tenant inativo, sync recusado sem entitlement, sem consentimento, com `ML_ACCOUNT_MISMATCH` e `ML_TAG_MISMATCH`, schema do PUT recusa nome/quantidade/tamanho fora do limite, keyring HMAC (versão antiga regravada; outra conta 409), "Desconectar ML" libera troca de conta e revincular não reseta, use case de rotação com entrada simulada (perde corrida para PUT; `ssid` removido marca `sessionInvalidAt`; temporário removido só força bootstrap), sync aceito zera `sessionInvalidAt` (mapper), downgrade grava `false` e `null` vira `false` (paridade Sync × Apply), `PlanFeatureUnavailableError` por chave, lifecycle idempotente e rota pública em linha com dono tocando só `status` + `lastSeenAt` (nunca `version`/`channel`/`extensionId`), `version` inválida recusada, `REPLACED` só sem dono ou do mesmo usuário, teto de 20 vínculos/24 h, `trustProxy: 1` com XFF forjado, Cookie Strict com extensão real (bloqueante), CORS sem defaults waioprime e sem localhost em produção e boot falha com `*`/lista vazia/`EXTENSION_ORIGINS` vazio/`PANEL_URL` ausente em produção |
| F2 | Extensão v3.0.0: canal, `apiFetch`, `resolverSessao`, heartbeat, lifecycle, gate D3, ops ML, manifest gerado sem content script; remove senha, `auth`, `affiliate-session-sync`, `page/get-csrf`, `marketplace/check-login`, etiqueta do popup, permissões `tabs` e `scripting` (volta só se a F0 acionar o fallback de CSRF) e host permissions `.ar`/`.mx` (produto BR); manifest final = `cookies`, `storage`, `alarms` + hosts API/ML; versão 3.0.0 (sem `offscreen`: o fallback D6 é JSON) | build + `check-i18n` + `check-contract-sync` + `check-dist` (manifest) + vitest com os arquivos de teste **criados nesta fase** (hoje não há nenhum; `vitest run` sai 1): filtro de envelope, versão, sanitize, paridade das constantes de cookie; popup e heartbeat nunca tocam `chrome.cookies`; alarme e `ml.*` só tocam após gate D3; sem login/permissão nada toca; storage nunca contém valor de cookie |
| F3 | Painel: feature `extension`, wizard, Configurações › Extensão, `/extension-removed`, logout, aviso de resync, "Trocar conta/Desconectar ML" | testes de componente (binários): os 5 passos avançam com cada estado simulado (sem extensão, extensão sem vínculo, vinculada, sync `UPDATED`, etiqueta `inUse`); sem entitlement o passo 3 mostra upgrade e para; credencial `INACTIVE` mostra "Ativar" e chama `PATCH …/status`; `needsTab` só aparece com o fallback ligado; "Trocar conta" chama `DELETE …/session`; logout explícito chama `DELETE /api/extension/session` e `clearSessionAndRedirect` não; renderiza em claro, escuro e sistema; gate de i18n: script `app/scripts/check-strings.mjs` (novo, no `typecheck`) falha com texto literal em JSX nos arquivos da feature; Tooltips MUI com `aria-label` nos ícones; screenshots agent-browser dos 5 passos + Configurações › Extensão em claro e escuro anexados ao PR |
| F4 | `MercadoLivreAffiliateClient`, link gerado no servidor, busca (se F0 aprovar), aba no gerador | testes do use case (uma linha da tabela por caso, ordem fixa, `attributionVerified` pelo `long_url`, imagem não gravada quando `createLinks` falha) e do adapter com fixtures (classificação de falha por endpoint, regras do jar de `Set-Cookie` — host-only/`Domain`/`Path`/repetido/`Expires`/nome e host fora da lista —, bootstrap/CSRF, lote com erro por item); smoke na conta do owner: URL de produto → oferta gravada com link `/sec/` ou `meli.la`, `attributionVerified=true`, título e preço preenchidos |
| F6 | Worker do outbox → hub | testes: vetor de assinatura M2M bate com o do hub; retry até 10 com backoff 1 min → 24 h e depois `DEAD`; só a cabeça (`MIN(seq)`) por `clientKey` é enviada, cliente com cabeça travada é pulado, `DEAD` bloqueia a fila, 4xx vira `DEAD` sem retry, `seq` concorrente sem colisão; job de retenção apaga o que o §4.6 lista; assinatura recalculada por tentativa; `HUB_EVENTS_ENABLED=false` não envia; poda de `SENT`/`DEAD` |
| F7 | Docs (`extensao-navegador.md`, `extensao-ml-endpoints.md` da F0 revisado, `gerador-de-ofertas.md` D5, `integracoes-credenciais-afiliado.md`, roadmap + chave e regra em `arquitetura-central-billing.md:73-74`, item "rate limit compartilhado" em `arquitetura-escala.md`, AGENTS.md) | checklist PR §35; entrada de docs no CHANGELOG da raiz |
| F8 | Web Store: pacote de loja sem `key`, ID da loja em `EXTENSION_ORIGINS`/`VITE_EXTENSION_IDS`, link da loja no wizard, política de privacidade em `PANEL_ORIGIN`, propósito único, justificativa por permissão (`cookies`, `storage`, `alarms`; `scripting` só se o fallback entrar), declaração de dados (autenticação do ML enviada à própria API, eventos de instalação, feedback de desinstalação; uso limitado; retenção do §4.6), sem código remoto | pacote enviado para revisão; smoke com o build da loja (vincular, sync, gerar link) passou; aprovação acompanhada fora do plano |

## 6. Riscos

- Sessão do usuário guardada no servidor (D4): cifrada, nunca logada/devolvida; limpeza de credencial no logout do
  ML a critério do usuário ("Desconectar ML", §4.3).
- ToS/anti-bot ML no servidor (IP da Render): rate limit por tenant, F0 valida antes de investir na F4.
- Endpoints internos do ML mudam: parsers isolados + fixtures + `ML_SCHEMA_CHANGED`.
- Revisão da Web Store pode pedir ajustes de permissões/declarações (legado aprovado com o mesmo conjunto).
- P4 (rota de eventos no hub) e P6 (só se a F0 escolher a API oficial) ainda podem atrasar; P1, P2, P3, P5 e P7 resolvidos em 2026-10-26. Rate limits por instância (D9); uninstall URL forjável (aceito).

## 7. Fora de escopo

Shopee/Amazon na extensão; migrar o painel para cookie; implementação da rota do hub (outro repo, P4);
fila servidor → extensão (desnecessária: com sessão no servidor, automações usam a API direto); parcelas e preço
com cupom automáticos (manuais na v1); histórico de preço; encurtador próprio; iframe; `got-scraping`; usar a API
do Bot do Afiliado como fornecedor.

## Histórico de revisão

- **R1** (3): ordem legado/ops; guarda em todo método + vínculo à instalação; sem rotação no SW; dev; CORS;
  plugins Fastify 4; contrato copiado; `session.changed` vazio; N−1; queda do Port; `assertNoSecrets`.
- **R2** (2): DELETE do painel; logout sem interceptors; `Max-Age` até o teto; corrida da reemissão; só caminho
  cookie; default CORS vazio; `check-dist` no manifest.
- **R3** (2): content script removido; popup e heartbeat sem tocar o ML; entitlement checado no servidor;
  presets/backfill e revogação explícitos; payload do hub por `billingCustomerId`; desvios listados; startup só
  `onStartup`; `/absent` com Bearer; `permissions` (nome Pulso) no guard; porta de entitlement própria; versão por
  fase; credencial INACTIVE no wizard.
- **Owner 26/10**: wizard + etiqueta automática; `externally_connectable`; lifecycle + hub; gate D3; sempre padrão
  Pulso; **token ML no servidor (modelo legadoML)** — remove o fluxo "produto vindo do cliente" da v3; publicação
  na Web Store (F8).
- **R4** (2; itens de CSRF por meta e offscreen superados depois): tabela de decisão gerar × aceitar link (link colado sem entitlement); presets dependem da P5 e
  revogação só por `false` explícito; consentimento D8; CSRF só por meta em ISOLATED; sem `tabs` e sem `.ar/.mx`;
  storage só com hash; `sessionInvalidAt` zerado no sync e marcado por use case de `integrations`; etiquetas da
  conta buscadas no servidor; contrato do Upsert sem `publicIdentifierIfEmpty`; erros novos; dependência do smoke.
- **Referência `Afilimax/mercado-livre-provider`** (URL citada no AGENTS.md; licença MIT e commit f9e2379 verificados no clone): endpoint do linkbuilder,
  CSRF obtido no servidor, lista fechada de cookies (não só `ssid`), `createLink` por URL, `short_url` + `long_url`.
  Simplifica a extensão (sem aba/`scripting` no caminho principal). Busca, produto e etiquetas seguem na F0.
- **Gist JulioBorges** (n8n, sem licença; contém sessão real exposta — não usar valores): endpoint candidato
  `affiliates/createLink` em lote, CSRF fixo + cookie `_csrf`, rotação por `Set-Cookie`, teste de remoção na F0.
  **`gabrieldamasse-01/bot-de-automacao`**: sem integração real com o ML (mock `?aff_source=`); não é referência.
- **botdoafiliado.com (artigo 19/06/2026)**: confirma que não há API oficial de afiliados no ML (só
  `/afiliados/linkbuilder` e `/afiliados/adminlabel` no painel) e que o concorrente usa o mesmo modelo de D4:
  extensão conecta a sessão + tag, servidor converte; sessão expirada → falha de conversão. Link curto
  `mercadolivre.com/sec/…`; lote até 150 URLs.
- **`legadoBot/` (extensão Bot do Afiliado 1.0.45, publicada)**: confirma D4, lista fechada, hash local, sem content
  script, opt-in desligado por padrão (Web Store aceitou). Adotado: 7 cookies do ML, `getAll({url})`,
  `onChanged` + espera 60 s + reserva 60 min + teto 15 min, conta checada por `orguseridp`, respostas tipadas,
  teste de paridade da lista. Não adotado: auth reaproveitando cookie do painel, chave de API em
  `storage.sync`, `host_permissions` de todos os sites, jar completo, etiqueta manual, sem heartbeat/canal.
- **R5** (revisão das inclusões pós-R4): rotação de cookies com use case próprio + compare-and-set (PUT da
  extensão vence); troca de conta ML via `ResetAffiliateSessionAccountUseCase`; `HMAC(tenantId:orguseridp)` em vez
  de sha256; classificação de falha por regra fixa; CSRF em URL fixa com `redirect:'manual'`; lista de cookies e
  `assertNoSecrets` derivados da mesma constante; tabela HTTP → `status`; segredo `{cookies, csrf?}`.
- **Releitura das referências (produto/busca)** (fallback offscreen superado pelo geralink): nenhuma revela endpoint do ML; produto pela página existente
  (`HttpProductPageReader`) ou API oficial se a F0 confirmar (P6); busca decidida na F0. Etiqueta pelo servidor
  (fallback offscreen; sem iframe); wizard passa a sincronizar antes de escolher a etiqueta.
- **API pública do Bot do Afiliado** (`/api/v1/product`, `/api/v1/convert-links`; screenshots do owner): é a API
  **deles**, não do ML — não revela a fonte. Confirma: link do ML gerado = `mercadolivre.com/sec/…` (expansor já
  cobre); lote com `ok`/`error` por item (adotar no contrato de `createLinks` e da busca); produto = título, preço
  (string + número), moeda, imagem, campos podem vir `null` (= nosso `HttpProductPageReader`); `price_history` é
  cache próprio (fora de escopo); sessão expirada → erro com "reconecte pela extensão" (= `resyncRequested`).
  Usar a API deles como fornecedor: descartado (dependência de concorrente, white label).
- **R6 caveman-review** (2 revisores, plano × código): permissão `offscreen` na F2/F8; busca de etiquetas usa os
  cookies do PUT; tabela gerar × colar com linhas próprias para plano (`PLAN_FEATURE_UNAVAILABLE`) e sessão
  expirada; testes de rotação/classificação divididos entre F1 (use case simulado) e F4 (fixtures); reset de conta
  só por ação explícita (`DELETE …/MERCADO_LIVRE/session`); `getProduct` próprio do adapter; `ml.session`
  derivada no servidor; códigos do guard `NEEDS_LOGIN`/`AUTH`/`FORBIDDEN+reason`; erros em `UPPER_SNAKE`, sem
  `missing_tag`; env reusa `PANEL_URL` e `BILLING_*`, nova `ML_ACCOUNT_HMAC_KEY`; entitlement reader movido para
  `tenants`; breaking change documentado; versão da extensão por fase; critérios binários; `REPLACED` no contrato
  do hub; citações corrigidas; diferidos em §7.
- **`geralink-afiliado-mercadolivre` (Raskinkamar, MIT; cópia em `legadoML/geralink-afiliado-mercadolivre-main`)**:
  responde 3 perguntas da F0 — **etiquetas** `GET /affiliate-program/api/v2/stripe/user/tags` (`in_use`);
  **bootstrap** `GET /afiliados/linkbuilder` com `ssid` devolve `_csrf`/`_d2id`/`_mldataSessionId` e o CSRF é o
  cookie `_csrf`; **lote** `affiliates/createLink` com até 20 URLs, 2 s entre lotes, HTTP 200 com erro por item
  (`error_code 111`). Adotado como endpoint principal; fallback de etiqueta vira GET JSON (sai `offscreen` da F2).
  Não adotado: `redirect:'follow'` no bootstrap e mesclar todo `Set-Cookie` (mantidos `manual` + lista fechada).
  F0 encolhe para: cookies mínimos, chamadas a partir da Render, `nsa_rotok`, produto e busca.
- **R7 caveman-review** (8 revisores: 2 amplos + 6 fatias): pré-condição
  P7 (prod atrasada em migrations); classificação de falha por endpoint (HTML de produto é sucesso; 403/desafio
  não invalida sessão; item `111` é erro do item); `attributionVerified` só com etiqueta no `long_url`; ordem fixa
  do gerador (sem imagem órfã) e precedência das falhas; porta única `createLinks`; entitlement também na leitura
  com sessão do caminho "com identificador"; regras do jar de `Set-Cookie`; constantes `ML_SESSION_COOKIES` /
  `ML_TEMP_COOKIES` / `ML_SERVER_COOKIES`; schema do PUT com limites; keyring HMAC; consumidores do segredo
  listados; mapper com campos novos; `PlanFeatureUnavailableError(key)`; Sync/Apply gravam `false`; Prisma com
  FKs, índices, dedupe de eventos e `AuditAction` novo; logout só explícito; `POST /session` sem bypass de
  super-admin; guard em `onRequest`; CORS sem defaults waioprime; `EXTENSION_ORIGINS` fail-closed; rate limit por
  salto confiável; cookie por helper próprio (sem `@fastify/cookie`); par `HUB_EVENTS_*` próprio e assinatura M2M
  do hub; outbox por `clientKey` (P4) do tenant vinculado, ordem por cliente, `DEAD`, retenção; rota pública de
  lifecycle sem tocar linha com dono; manifest/scripts da F2 descritos como a construir; `scripting` sai salvo fallback de CSRF; versões e
  CHANGELOG por fase com caminhos; critérios binários de F2/F3/F6.
- **R8 caveman-review rodada 2** (4 revisores, regressões das correções R7): `inUse` único; §6 com P5–P7; F3 com
  casos binários; regra única de fonte do produto e degradação de qualquer erro do `getProduct`; desafio detectado
  antes do parser; `urls` vazio → `ML_LINK_FAILED`; `PlanFeatureUnavailableError` a criar na F1; `ExtensionSession` com
  Cascade e poda; SameSite **não validado** e teste real bloqueante na F1; CORS sem localhost em produção;
  `trustProxy: 1`; `UPDATE` de linha com dono; mapa cheio abre (como o Pulso); teto de 20 vínculos/24 h; `REPLACED`
  com filtro de dono; outbox por `clientKey` (P4) com `seq` por cliente, `DEAD` bloqueia a fila, assinatura por
  tentativa; D3 restrito às rotas da extensão (uso no servidor independe do vínculo); erro `{code}` + `reason` só
  em `FORBIDDEN`; extensão envia só os 4 cookies de identidade (R3 final); PUT sem `csrf`; 403 refaz bootstrap uma vez; P3 esclarecida.
- **R9 caveman-review rodada 3 (final)** (3 revisores): 0 🔴; 8 🟡 corrigidos — 429/desafio sem nova chamada ao
  ML; regra de fonte por ramo; 403 com 1 novo bootstrap; extensão envia só os 4 cookies de identidade; regra única
  da rota pública em linha com dono + validação de `version`; `seq` por contador com retry próprio; cabeça
  `MIN(seq)` independente de lock; 4xx do hub vira `DEAD`; job `extension-retention` (sessões e instalações sem
  dono); índice em `occurredAt`. Restam só 🔵. Revisão encerrada pelo teto de 3 rodadas desta sessão.
- **F0 parcial (2026-10-26, conta do owner, janela isolada; perfil apagado ao fim)**: etiquetas confirmadas
  (`GET /affiliate-program/api/v2/stripe/user/tags` → `{tags:[{tag, in_use, generated_date}]}`); os 7 cookies do
  Bot existem, todos `Secure` + `SameSite=None`, `ssid`/`nsa_rotok` HttpOnly, `_csrf` host-only de `www`;
  `/ofertas` logado = 144 `poly-card` no HTML (sem `__PRELOADED_STATE__`/JSON-LD); **fora do navegador e sem
  sessão, `/ofertas` e página de produto → 302 `/gz/account-verification`** (marcador de desafio; o
  `HttpProductPageReader` atual sem cookie já cai nele); API oficial sem token: `/items` 403, `/products` 401,
  `/sites/MLB/search` 403. **Em aberto**: chamada do servidor **com** a sessão (local e Render) — fecha no 1º
  teste de integração (extensão → API → ML), não por cópia manual de cookies. Geração de link real idem.
