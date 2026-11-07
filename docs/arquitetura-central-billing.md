# Billing, checkout e e-mail via API central — CopySync

Fonte de verdade de **como o CopySync é vendido e cobrado** sem cálculo de preço nem gateway próprios. Complementa
[`produto-roadmap.md`](produto-roadmap.md) (planos) e [`arquitetura-escala.md`](arquitetura-escala.md) (operação).
Decisões de 2026-10-26; análise de origem em
[`../.specs/features/service-desk/integracao-api-central.md`](../.specs/features/service-desk/integracao-api-central.md).
Trabalho do lado da central: `pulsosocial_api/.specs/features/multi-application-hub/spec.md` (repositório irmão).

**Contrato de provisionamento, status de tenant, convite e e-mail é o da service-desk**
([`design.md`](../.specs/features/service-desk/design.md) §4, §10, §11; requisitos PROV-01..04 e USR-01 em
[`spec.md`](../.specs/features/service-desk/spec.md)). Este doc não redefine nada disso: só diz como o webhook da central entra
por essas portas. Estado em 2026-10-28: P1.0 (`ProvisionTenantUseCase`, `POST /provisioning/tenants` só super-admin),
USR-01 (convite, `/auth/invites/:token/accept`), `resolveMembership`, receiver HMAC e entitlements **entregues** (commit `c44341e`,
M1-B). Em 2026-11-02 (`0.49.4`) o receiver foi alinhado a este contrato: provisiona em `subscription.activated` de cliente
desconhecido, valida `X-Application-Key` e `planSlug`, grava receipt e watermark na mesma transação com lock da linha do tenant.
`HubEmailSender` entregue em api 0.68.0 (seção [E-mail pela central](#e-mail-pela-central-hubemailsender)); painel "Assinatura" em [`assinatura.md`](assinatura.md).
Reconciliação entregue em api 0.71.0 (seção [Reconciliação](#reconciliação)). Sem as três
`BILLING_HUB_URL`, `BILLING_APPLICATION_KEY`, `BILLING_APPLICATION_SECRET` (`BILLING_ENABLED`, `env.ts:362`) a rota não é registrada (404); em produção com
`EMAIL_SENDER=noop`, ou `hub` sem `HUB_API_URL`/`HUB_APPLICATION_KEY`/`HUB_M2M_SECRET` (`HUB_EMAIL_CONFIGURED`), ela também não é registrada e só loga erro
(`billingWebhookGuard.ts:11-14`, `routes.ts:135-142`); o boot segue e a reconciliação também fica parada (`server.ts:318`).
Estado peça a peça: seção [Estado em 2026-11-05](#estado-em-2026-11-05).
**Rotação do segredo**: `BILLING_APPLICATION_SECRET_PREVIOUS` (opcional) é aceita junto com a atual enquanto a central troca o segredo; `verifyBillingHmac` compara as duas sempre (tempo constante, sem curto-circuito) e o log diz só o rótulo que casou (`previous` em warn). Sem ela, só a atual vale. Apagar a env ao fim da rotação; nunca logar segredo. Não há signup público: conta nova nasce pela compra no hub ou por provisionamento do super-admin.

## Decisão

A API central (`pulsosocial_api`, Fastify + Prisma) é o **hub** de checkout, assinatura, e-mail e créditos para N aplicações.
O CopySync é a aplicação `copysync` nela. O checkout é **por aplicação**: cada `Application` tem domínio, marca, planos, e-mail
e webhook próprios sobre o mesmo código. Descartados: fork da central, segunda instância, checkout próprio, SSO.

```
Cliente → checkout (front da central, deploy da aplicação copysync) → pagamento aprovado
  → central grava Subscription e emite  subscription.activated  (HMAC)
  → api.copysync.app  POST {API_PREFIX}/integrations/billing/webhook   (idempotente por eventId; ordem por seq)
  → ProvisionTenantUseCase({origin:'BILLING_WEBHOOK'})  (Tenant + User + UserTenant ADMIN + UserInvite + AuditLog, uma transação; sem Department: não há model)
  → afterCommit: EmailSender.send(SET_PASSWORD, data {name, link, expiresAt}) com o link do UserInvite
eventos de status → ApplyBillingEventUseCase grava status/suspendedAt direto na transação (não usa UpdateTenantStatusUseCase,
  então hoje sem AuditLog TENANT_STATUS_CHANGED) → após o commit emite TENANT_SUSPENDED (em SUSPENDED e CANCELLED)
  → `sessions` (TenantSuspendedSessionListener) desconecta as sessões do tenant (AuditLog SESSION_DISCONNECTED, actor SYSTEM)
Reconciliação (padrão 1 h): GET /integrations/subscriptions?externalUserId=  (M2M, 1 GET por tenant, lote por passada, sob lease em tabela; ver §Reconciliação)
```

## Mapeamento evento → tenant (tabela única)

| Evento da central | `Tenant.status` | Entitlements | Observação |
| --- | --- | --- | --- |
| `subscription.activated` (1ª vez) | provisiona `ACTIVE` | preset do `planSlug` | e-mail já cadastrado → só `UserTenant` (PROV-01, regra 11); conta com senha → sem convite (PROV-02) |
| `subscription.activated` (1ª vez), dono de tenant sem `billingCustomerId` | o do tenant existente | preset do `planSlug` | **vínculo pelo e-mail** (abaixo): grava `billingCustomerId` no tenant criado pelo super-admin em vez de criar um 2º |
| `subscription.activated` (1ª vez) sem `email` ou com `planSlug` fora de `PLAN_SLUGS` | nada; **422** sem receipt, log `error` | | a central marca o evento `DEAD` na hora (422 não é retentado) e ele fica na fila com replay no admin: cliente pagante sem conta nunca some em silêncio |
| `subscription.activated` (reativação) / `subscription.renewed` | `ACTIVE`, limpa `suspendedAt` | preset do `planSlug` | plano pode ter mudado: ressincroniza; `planSlug` inválido = status aplica, plano não muda (warn) |
| `subscription.updated` (edição manual, cortesia, troca de plano) | mantém | preset do `planSlug`, se válido | sem mudança de status |
| `expiresAt` em activated/renewed/updated | | grava `Tenant.subscriptionExpiresAt` | ausente = mantém; `null` limpa; malformado = **400** sem aplicar nem avançar o seq; nos demais tipos é ignorado |
| `subscription.payment_failed`, `subscription.canceled`, `subscription.expired`, `subscription.refunded`, `subscription.chargedback` | **decisão pela união** (abaixo): alguma assinatura do cliente ainda dá acesso (PAYMENT_FAILED/EXPIRED dentro da tolerância inclusive) → `ACTIVE`, limpa `suspendedAt`, `subscriptionExpiresAt` e plano da assinatura escolhida, receipt `KEPT_ACTIVE`; nenhuma → `SUSPENDED` (payment_failed) ou `CANCELLED` (demais), `suspendedAt=now` só na saída de ACTIVE, receipt `APPLIED`. Tenant com `adminBlockedAt`: status e `suspendedAt` nunca mudam (só plano/vencimento/watermark) | preset do plano escolhido (se mantém); senão mantém | central fora (401/403, 5xx, 404, timeout, rede, corpo inválido) = **503 sem receipt**, a central retenta; login preservado (PROV-03); corte emite `TENANT_SUSPENDED` |
| qualquer tipo ≠ `activated` de cliente sem tenant | sem efeito, 200, receipt `IGNORED` | | watermark não avança (não há tenant) |
| `subscription.trial_ended` | sem efeito, 200, avança o watermark | | CopySync não tem trial próprio |
| tipo desconhecido | sem efeito, 200, receipt `IGNORED`, avança o watermark | | nunca 4xx/5xx: a central reenviaria |
| evento com `eventId` já visto | sem efeito, 200 | | `BillingEventReceipt` |
| `seq` ≤ `Tenant.lastBillingEventSeq` (fora de ordem ou repetido) | sem efeito, 200, receipt `OUT_OF_ORDER` (o `BillingEventReceipt` é a trilha de auditoria do receiver) | | `seq` é a sequência global da central (autoincrement), crescente; só se compara **dentro do mesmo cliente**. Tenant ↔ `billingCustomerId` é 1:1, então o watermark por tenant basta. A central nunca envia um `seq` maior do cliente enquanto um menor dele está pendente. Avanço do watermark é condicional: `UPDATE … SET lastBillingEventSeq=$s WHERE id=$t AND (lastBillingEventSeq IS NULL OR lastBillingEventSeq < $s)`; 0 linhas = outro evento passou na frente, sem efeito |

**Decisão pela união nos eventos de corte (api 0.71.0).** Na Cakto a renovação cria linha nova (`activated`) e a antiga,
ao vencer, vira EXPIRED pelo cron da central e emite `expired` com `seq` maior: cortar no evento cancelaria quem pagou o ciclo
novo. Regra do PulsoSocial: o cliente tem acesso se **qualquer** assinatura dele dá acesso. Para payment_failed/canceled/
expired/refunded/chargedback com efeito (sem receipt, tenant existe, `seq` acima do watermark), `ApplyBillingEventUseCase` consulta
`GET /integrations/subscriptions` (o mesmo `IHubSubscriptionsClient` da reconciliação) **antes** da transação, sem segurar a
trava, e na transação decide com `pickGrantingSubscription` (o mesmo critério da §Reconciliação). Duplicado, fora de ordem e
cliente sem tenant não consultam. Lista vazia num evento de corte = corta (o evento é a prova). activated/renewed/updated
não consultam. Falha da consulta: 503 sem recibo (a central retenta); 401/403, 404, 400 e corpo inválido não se resolvem com
retry e logam `error` (motivo, status e contador por motivo desde o boot, `failuresSinceBoot`; sem PII), timeout/rede/5xx logam
`warn`. O contador é só observabilidade por processo, não decide nada.

**Bloqueio do super-admin (`Tenant.adminBlockedAt`, api 0.71.0).** `UpdateTenantStatusUseCase` com origem SUPER_ADMIN grava
`adminBlockedAt = agora` ao pôr SUSPENDED/CANCELLED e limpa ao pôr ACTIVE, **sempre** (inclusive sem mudança de status) e
sempre audita (`meta.adminBlocked`); `suspendedAt` só é gravado na saída de ACTIVE. Webhook e reconciliação nunca mudam o
status de tenant com `adminBlockedAt` (ativação, `KEPT_ACTIVE` e corte só atualizam plano/vencimento/watermark) e nunca
regravam `suspendedAt` de tenant já não-ACTIVE. Backfill na migration `20261107170000_add_tenant_admin_blocked_at` (idempotente):
tenant não-ACTIVE cuja última auditoria `TENANT_STATUS_CHANGED` tem `origin` SUPER_ADMIN recebe `adminBlockedAt = suspendedAt`.
Novo caminho que bloqueie tenant por ação humana tem de gravar `adminBlockedAt`.

**Vínculo pelo e-mail (cliente da central desconhecido em `subscription.activated`).** Tenant criado à mão pelo super-admin
nasce sem `billingCustomerId`; quando o dono assina pela Cakto, o `externalUserId` é novo. Antes de provisionar (só se o evento
provisionaria: tem `email` e `planSlug` válido), `ApplyBillingEventUseCase.findLinkCandidate` busca o `User` pelo e-mail
normalizado (`normalizeEmail`: trim + minúsculas). **Elegível só se** o usuário tem exatamente **um** `UserTenant` com
`role = ADMIN` (o "dono"; o modelo não tem outro papel de dono) e esse tenant tem `billingCustomerId` nulo. Usuário inexistente,
só `OPERATOR`, 0 ou 2+ tenants ADMIN, ou qualquer tenant ADMIN dele já ligado a outro cliente = comportamento antigo
(provisiona tenant novo) + `warn` com ids (`userId`, `unlinkedTenantIds`), nunca o e-mail. O vínculo acontece **na mesma
`$transaction`** do receipt/watermark/status: lock condicional `SELECT … WHERE id = $t AND "billingCustomerId" IS NULL FOR UPDATE`,
reconfere o `UserTenant` ADMIN, checa o receipt (reentrega = `DUPLICATE`), grava `billingCustomerId` e `AuditLog`
`TENANT_UPDATED` (`meta: { origin: 'BILLING_WEBHOOK', change: 'billing_customer_linked', eventId, billingCustomerId, ownerUserId }`,
`userId` nulo = sistema) e aplica o evento a esse tenant. Se outra entrega do mesmo cliente vinculou antes, o `FOR UPDATE` espera o
commit e a nova leitura por `billingCustomerId` acha o tenant; se o candidato foi tomado por outro cliente, erro sem receipt (500) e
o hub reenvia, reavaliando do zero. Eventos seguintes acham o tenant pelo `billingCustomerId`. Não fazer: vincular em evento que
não é `activated`, vincular por nome/slug, tocar tenant que já tem `billingCustomerId`, logar o e-mail.

Efeitos de `SUSPENDED`/`CANCELLED` além do HTTP (`resolveMembership` nega com `TENANT_SUSPENDED` 403,
`resolveMembership.ts:36,57`): `sessions/infrastructure/listeners/TenantSuspendedSessionListener.ts` assina `TENANT_SUSPENDED`
no bus e, por sessão, grava `DISCONNECTED` + limpa o pedido de conexão, desconecta na engine, solta o lease e grava `AuditLog`
`SESSION_DISCONNECTED` com `actor: 'SYSTEM'` (não passa por `DisconnectSessionUseCase`). `tenants` não importa `sessions`.
Reativação **não** reconecta: o cliente reconecta pelo painel. O worker de envio só reivindica envio de tenant `ACTIVE`
(`PrismaOfferDispatchRepository.ts:136`). Isso **supera** a linha "Tenant suspenso mantém sessões WhatsApp: não desconectar nesta
feature" do design §17 (`design.md:1217`), que já apontava esta integração como dona da política.
**Dependência de E3**: o bus hoje é `EventEmitter` in-process (`InternalEventBus.ts:7`); com `PROCESS_ROLE=http|worker` o
receiver roda no HTTP e a sessão vive no worker. A fase E3 troca o bus por `RedisInternalEventBus` (escala §3.4), e aí o
listener continua funcionando sem mudança. Até E3, processo único (`all`) e o bus in-process basta.

## O que o CopySync implementa

| Camada | Item |
| --- | --- |
| Prisma (service-desk §4, migration única da service-desk) | `Tenant.billingCustomerId @unique`, `Tenant.suspendedAt`, `User.passwordHash String?`, `User.passwordSetAt`, `UserInvite` (`planSnapshot Json?` sai do design: substituído por `planSlug` tipado, AGENTS §26) |
| Prisma (esta integração) | `Tenant.planSlug String?`, `Tenant.lastBillingEventSeq BigInt?` (seq da central é BIGINT; webhook aceita número inteiro seguro ou string de até 19 dígitos, `parseBillingSeq.ts`), `Tenant.subscriptionExpiresAt DateTime?`; `TenantEntitlement { tenantId, key, value Json?, @@unique([tenantId,key]) }` (`null` = ilimitado, cf. roadmap); `PlanEntitlementPreset { planSlug, key, value Json?, @@unique([planSlug,key]) }`; `BillingEventReceipt { eventId @id, billingCustomerId @index, tenantId?, type, seq BigInt, payload Json?, receivedAt, outcome }`; `JobLease { name @id, ownerId, expiresAt }`. `planSlug` aceito (`resolvePlanSlug`, `planPresets.ts`): slug da oferta da central `copysync-{lite\|pro\|max}-{mensal\|anual}` (mensal e anual = mesmo preset) e, por compatibilidade, o interno `COPYSYNC_LITE\|PRO\|MAX`; o tenant grava sempre o interno |
| Módulo `integrations/billing` | `billing.routes.ts`: plugin sem `authHook`, `addContentTypeParser` `parseAs: 'buffer'` (corpo bruto). Ordem: `X-Application-Key` igual a `BILLING_APPLICATION_KEY` em tempo constante (senão 401) → `X-Signature: sha256=<hex>` sobre `${X-Timestamp}.${corpo bruto}`, `X-Timestamp` em segundos ±`BILLING_HMAC_TOLERANCE_SECONDS` (300), `timingSafeEqual` contra atual e anterior (`verifyBillingHmac.ts:39-63`; falha 401) → JSON inválido 400 → falta `eventId`/`type`/`externalUserId`/`seq` 400 → `X-Event-Id` opcional, se vier e divergir do corpo 400 → `expiresAt` malformado 400 → `ApplyBillingEventUseCase`; `UNPROVISIONABLE` 422; erro inesperado 500. Corpo lido: `eventId, type, externalUserId (= billingCustomerId), seq, email, name, planSlug, expiresAt`. `BillingEventReceipt` gravado **na mesma `$transaction`** que aplica o evento, com `SELECT … FOR UPDATE` na linha do tenant; `P2002` no receipt = entrega duplicada concorrente → 200 `DUPLICATE`. A canônica do webhook **ainda não existe na central** (dispatcher H2 não feito): fechar com vetor compartilhado quando ele nascer |
| Use cases novos | `ApplyBillingEventUseCase` (tabela acima; faz o sync de entitlements + `applyPlanSideEffects` dentro da própria transação), `ReconcileSubscriptionsUseCase` (ver §Reconciliação). `SyncTenantEntitlementsUseCase` existe mas **nenhum código de produção o chama** (lógica duplicada no Apply): reusar ou remover |
| Use cases reusados | só `ProvisionTenantUseCase` com `origin: 'BILLING_WEBHOOK'` (cria o `UserInvite` direto pelo repositório, não via `InviteUserUseCase`). `UpdateTenantStatusUseCase` (que grava `AuditLog TENANT_STATUS_CHANGED`) **não** é usado pelo webhook: o status muda sem `AuditLog`; a trilha é só o `BillingEventReceipt`. Exceção: o vínculo pelo e-mail grava `AuditLog TENANT_UPDATED` |
| Erros | `TenantSuspendedError` (403, `TENANT_SUSPENDED`, `TeamErrors.ts:3`) lançado em `resolveMembership.ts:36,57`, usado por `tenantHook` e `sseAuthHook`; mudança de contrato: painel trata `TENANT_SUSPENDED`. `PlanLimitReachedError` (403, `PLAN_LIMIT_REACHED`, com `key` e `limit`, `PlanErrors.ts:4`) lido de `TenantEntitlement` no application layer |
| E-mail | porta `IEmailSender.send({to, template, data, locale?})` → `{sent}`; adapters `SmtpEmailSender` (timeout 5 s, `sent:false` em falha), `NoopEmailSender` e `HubEmailSender` (M2M `POST {HUB_API_URL}/integrations/email/send`; ver seção abaixo). Fábrica: `createEmailSenderFromEnv()` (`EmailSenderFactory.ts`). Envio em `afterCommit`, fora da transação: exceção documentada à regra "sem chamada síncrona à central". **Remetente com domínio próprio (H10)**: o hub envia o e-mail do CopySync pela conta SMTP do domínio do CopySync (`EmailSenderConfig` de aplicação, `hub/h4-t16`), nunca pela do PulsoSocial; falha dessa conta não cai para a do PulsoSocial |
| Agendamento | `ReconcileSubscriptionsUseCase` em `server.ts:316-326` (`setInterval` a cada `BILLING_RECONCILE_INTERVAL_MS`, padrão 1 h, + `unref` + `clearInterval` no shutdown, `server.ts:457`), só no papel `worker`/`all` (`processJobs.ts:37`) e só se o guard não bloquear. **Lease em tabela** `JobLease` `billing-reconcile` (TTL `BILLING_RECONCILE_LEASE_TTL_MS`, 10 min): `updateMany WHERE expiresAt < now()`, senão `create`; falha = outro processo tem o job; liberado no fim. Advisory lock de sessão não serve com pool do Prisma |
| Painel | `/plans` abre direto a oferta da Cakto do plano×período ("Assinatura" leva à vitrine `/plans`) (`checkoutUrls` em `features/plans/catalog.ts`, `checkout.ts`; nova aba; repassa `utm_*`/`gclid`/`fbclid`); slugs da vitrine `lite\|pro\|max`. Sem `VITE_BILLING_CHECKOUT_URL` nem `/planos/...` da central (app 0.86.0). Ver [`planos.md`](planos.md). Primeiro acesso = tela do convite (USR-01) |
| Env (`env.ts:204-238`, todas opcionais; `BILLING_ENABLED` = as três primeiras presentes, `env.ts:362`; ausente = rota não registrada, 404, e reconciliação não roda) | `BILLING_HUB_URL`, `BILLING_APPLICATION_KEY`, `BILLING_APPLICATION_SECRET`, `BILLING_APPLICATION_SECRET_PREVIOUS`, `BILLING_HMAC_TOLERANCE_SECONDS` (300), `BILLING_RECONCILE_INTERVAL_MS` (3 600 000), `BILLING_RECONCILE_LEASE_TTL_MS` (600 000), `EMAIL_SENDER=noop\|smtp\|hub` (default `noop`; fora de produção, billing + noop = warn no boot; **em produção, `noop`/`hub` = rota não registrada + log `error`, o boot segue**: tenant criado sem e-mail ficaria sem link de senha; o hub reenvia depois), `EMAIL_SMTP_URL`, `EMAIL_FROM`, `HUB_API_URL`, `HUB_APPLICATION_KEY` (`copysync`), `HUB_M2M_SECRET` (os três = `HUB_EMAIL_CONFIGURED`), `PANEL_URL` (link do convite `{PANEL_URL}/invite/{token}`; sem ela não há link nem e-mail) |
| Saída para o hub (extensão) | `HubOutboxWorker.ts:79-97` faz `POST {HUB_EVENTS_URL}/events` com `HUB_EVENTS_APPLICATION_KEY`/`HUB_EVENTS_SECRET` (segundo par de segredos, separado do `BILLING_*`), canônica M2M em `hmacSigner.ts`. **Não há receptor `/events` na central** em nenhuma branch hub. Desde api 0.68.0 `hmacSigner.ts` delega a `shared/http/m2m/m2mSignature.ts`: `X-Timestamp` em segundos, query ordenada, `X-Signature: sha256=<hex>` (antes ISO e hex sem prefixo) |

Chaves de entitlement: as do roadmap (`whatsapp_sessions`, `telegram_enabled`, `monitored_groups`, `broadcast_groups`, …).
Fonte única: `PlanEntitlementPreset` por `planSlug` (dado: seed + tela super-admin). `permissions[]` do evento serve só para
validar que `planSlug` e permissão batem; divergência = `AuditLog`, preset vence.

Link "defina sua senha": token gerado **pelo CopySync** (`UserInvite.tokenHash`, design §10); a central só envia o e-mail com o
link pronto. O CopySync monta `data: { name, link, expiresAt }` (`ProvisionTenantUseCase.ts`); o `HubEmailSender` mapeia para
`{ template: 'SET_PASSWORD', to, locale, vars: { name, setPasswordUrl, expiresInHours } }` (seção abaixo).
`permissions[]` do evento ainda **não é lido** pelo receiver (nem validado, nem auditado).

## Primeiro acesso

O provisionamento cria `User` sem senha + `UserTenant ADMIN` **antes** do `UserInvite` (`invitedById: null`). O token do
convite, que só chega ao e-mail do dono, é a prova de posse do e-mail: a tela `/invite/<token>` define a primeira senha,
mesmo com o usuário já vinculado. Regra única em `users/domain/services/inviteAccess.ts` (`decideInviteAccess`), usada pelo
`GET /auth/invites/:token` e pelo `AcceptInviteUseCase`:

- com senha → login (`requiresLogin: true`, aceite devolve `REQUIRES_LOGIN`/`LOGIN_REQUIRED`);
- sem senha + convite do sistema (`invitedById` null: cobrança ou super admin) → define senha;
- sem senha + convite de pessoa → define senha só se a conta não estiver em outro tenant nem for super admin; senão
  `REQUIRES_LOGIN`/`SET_PASSWORD_FIRST` (o cliente usa "esqueci a senha").
- já membro do tenant do convite: aceitar grava hash + `passwordSetAt`, marca o convite e **não** duplica `UserTenant` nem
  muda o papel.
- `GET /auth/invites/:token` devolve `firstAccess` (`isFirstAccessInvite`: convite do sistema + conta sem senha; aditivo,
  api 0.70.0). Com ele a tela troca o texto de equipe por "Bem-vindo ao …" e o botão vira "Criar senha e entrar".
- Página de obrigado do checkout (antes do e-mail chegar): `/obrigado`, ver [`pagina-obrigado.md`](pagina-obrigado.md).

Não fazer: voltar a exigir login por "já tem tenant" (api ≤ 0.69.0 fazia isso e todo cliente novo caía no login sem senha);
liberar convite de pessoa para conta sem senha de outro tenant (quem convida recebe o `inviteLink` na resposta de
`InviteUserUseCase`: seria troca de senha de conta alheia). Teste: `invite.routes.test.ts`.

## E-mail pela central (`HubEmailSender`)

`EMAIL_SENDER=hub` + `HUB_API_URL`, `HUB_APPLICATION_KEY`, `HUB_M2M_SECRET` (só env da Render; nunca logar).
Faltando qualquer um, a fábrica usa noop (log `error`) e, em produção com billing, o guard não registra o webhook.

- **Rota**: `POST {HUB_API_URL}/integrations/email/send`. A central registra a rota sem prefixo; se `HUB_API_URL` tiver path
  base, ele entra na URL **e** na canônica (o path que a central recebe).
- **Assinatura** (`shared/http/m2m/m2mSignature.ts`, vetor oficial copiado em `__fixtures__/m2m-vector.json`): headers
  `X-Application-Key`, `X-Timestamp` (segundos, 10 dígitos), `X-Nonce` (uuid v4), `X-Signature: sha256=<hex HMAC>`,
  `Content-Type: application/json`. Canônica = `METHOD\npath\nquery ordenada\ntimestamp\nnonce\nsha256(corpo exato)`.
- **Corpo** `{ template, to, locale?, vars }` (`hubEmailMapping.ts`). Templates internos → central:
  `SET_PASSWORD` (`link`→`setPasswordUrl`), `TEAM_INVITE` (`link`→`inviteUrl`, `tenantName`→`workspaceName`),
  `SESSION_DISCONNECTED` (`link`→`reconnectUrl`); `expiresAt` vira `expiresInHours`. Só chaves da allowlist da central
  (`email-vars.ts` dela; chave a mais = 400), só string/number/boolean, `<`/`>` removidos. Marca/suporte/links do painel
  são chaves de sistema da central: nunca enviar. Template sem equivalente: não chama, `sent:false`.
- **Idioma**: `locale` sempre vai (`toHubLocale`): o de `IEmailSender.send` em tag (`pt_BR` → `pt-BR`) ou `pt-BR` se
  ausente/inválido. Sem `locale` a central cai em inglês. Não há idioma salvo por usuário/tenant hoje.
- **Convite (`TEAM_INVITE`)**: `InviteUserUseCase` manda `tenantName` (→ `workspaceName`) e `inviterName` (nome de
  `invitedById`) quando conhecidos; ausente = omitido (a central usa texto neutro). `SET_PASSWORD` leva `name` do dono.
- **Links**: `setPasswordUrl`/`inviteUrl`/`reconnectUrl` precisam ser https absolutos (relativo = 400 na central). Base é
  `PANEL_URL`: produção com `EMAIL_SENDER=hub` sem `PANEL_URL` https **não sobe** (`hubEmailPanelUrlIssue` em `env.ts`);
  fora de produção a fábrica só loga. Link inválido no envio: não chama a central, `sent:false`.
- **Respostas**: 2xx (`202 QUEUED`) = `sent:true`. 4xx (400/401/403/409/429) = `sent:false`, sem retry. 5xx, rede ou
  timeout (5 s) = até 3 tentativas (300 ms, 1 s), cada uma com nonce/timestamp novos (senão 409).
- **Log**: só template, status, `code` da central (`[A-Z0-9_]`) e id; nunca destinatário, vars, corpo ou segredo.
- **Não fazer**: reaproveitar nonce no retry; enviar HTML nas vars; criar template novo sem liberar na central antes.

## Estado em 2026-11-05

A central está em **branches locais sem deploy** (`pulsosocial_api`: `feature/hub-h1` c9661c9, `hub/h2-schema` 412e352,
`hub/h2-t13` b82bc9f, `hub/h3a-base` e5751f5, `hub/h4-overrides` cd16539, `hub/h4-t16` abea7fd); produção da central segue
sem nada do hub para o CopySync. ✅ pronto · 🟡 parcial · ❌ não existe.

| Lado | Peça | Estado |
| --- | --- | --- |
| CopySync | Receiver `POST {API_PREFIX}/integrations/billing/webhook` (HMAC, 2 segredos, receipt + watermark, provisiona, 422) | ✅ |
| CopySync | `expiresAt` → `Tenant.subscriptionExpiresAt` | ✅ |
| CopySync | Guard de produção (`noop` ou `hub` sem credenciais não registra a rota) | ✅ |
| CopySync | Listener `TENANT_SUSPENDED` desconecta sessões; worker só envia de tenant `ACTIVE` | ✅ |
| CopySync | `AuditLog TENANT_STATUS_CHANGED` nas mudanças pelo webhook | ❌ (só receipt) |
| CopySync | `SyncTenantEntitlementsUseCase` | 🟡 existe, sem uso |
| CopySync | Reconciliação | ✅ api 0.71.0 (§Reconciliação); suspende sem acesso, reativa SUSPENDED/CANCELLED por cobrança |
| CopySync | `HubEmailSender` (M2M, vetor oficial em teste) | ✅ api 0.68.0; depende da rota na central |
| CopySync | Validação de `permissions[]` | ❌ |
| CopySync | Link de checkout do painel | ✅ direto na Cakto por plano×período (app 0.86.0) |
| CopySync | `HubOutboxWorker` → `/events` | 🟡 cliente pronto e assinatura alinhada (segundos); sem receptor |
| Central | `Application` (key/name/status) + recorte por `X-Application-Key` (H1) | 🟡 sem `webhookUrl`, segredo de webhook, `checkoutUrl` nem `creditsEnabled` no H1 |
| Central | `OutboundEvent` + triggers em `Subscription`/`SubscriptionRenewal`, `Application.webhookUrl`/`outboundEnabled`, `IntegrationNonce` (H2 schema) | 🟡 tabela e trigger; **sem dispatcher** que assine e envie ao CopySync; sem campo de segredo |
| Central | Canônica M2M + vetor (`m2m-signature.ts`, `__fixtures__/m2m-vector.json`) | ✅ (só a função; nenhuma rota `/integrations/*`) |
| Central | `GET /integrations/subscriptions`, `POST /integrations/email/send`, receptor `/events` | ❌ previsto (H2/H4) |
| Central | Planos/permissões `COPYSYNC_*` e seed da aplicação `copysync` (H3a) | ✅ (Plan `copysync-*-mensal`; sem anual, sem `RedirectConfig`) |
| Central | Templates de e-mail do hub + overrides copysync (H4) e `EmailSenderConfig` por aplicação (H4-t16) | ✅ código; sem rota que os use pelo CopySync |

## Reconciliação

Rede de segurança para evento perdido: sem ela, um `subscription.*` que não chegou deixa o tenant errado para sempre.

**Peças**: `ReconcileSubscriptionsUseCase` (orquestra, sem Prisma/HTTP), regras puras em
`integrations/domain/services/subscriptionReconcile.ts` (`subscriptionGrantsAccess`, `pickGrantingSubscription`,
`decideReconcile`), portas em `integrations/application/ports/` (`IHubSubscriptionsClient`, `IBillingReconcileRepository`),
infra em `integrations/infrastructure/billing/` (`HubSubscriptionsClient` M2M, `PrismaBillingReconcileRepository`,
`createReconcileSubscriptionsUseCase`). Entitlements + efeitos de plano pelo mesmo `billing/syncPlanEntitlements.ts` do webhook.

**Passada** (a cada `BILLING_RECONCILE_INTERVAL_MS`, só em `PROCESS_ROLE` worker/all, sob lease `billing-reconcile`):
até `BILLING_RECONCILE_BATCH_SIZE` tenants com `billingCustomerId`: primeiro (até metade do lote) os ACTIVE com
`subscriptionExpiresAt` + tolerância já passado, vencidos há mais tempo primeiro, para o corte de vencido não esperar o rodízio
(até ~39 h); o resto em ordem `billingReconciledAt` (nulos primeiro), `id`, entre ACTIVE/SUSPENDED/CANCELLED. Cada um
examinado recebe o carimbo (SQL direto, sem `updatedAt`), então as passadas giram por todos. Vencido renovado sem evento
sai da fila: o vencimento da central diferente do local é motivo de aplicar (`expiry_changed`). Um `GET {BILLING_HUB_URL}/integrations/subscriptions?externalUserId=` por tenant, assinado com
`BILLING_APPLICATION_KEY`/`BILLING_APPLICATION_SECRET` (`m2mSignature.ts`; o `_PREVIOUS` não vale para saída), timeout
`BILLING_RECONCILE_HTTP_TIMEOUT_MS`, sem retry (a próxima passada repete). Pior caso ≈ lote × timeout: manter abaixo de
`BILLING_RECONCILE_LEASE_TTL_MS` (padrão 100 × 5 s < 10 min). `BILLING_GRACE_HOURS` (0–168, padrão 24) vale para a reconciliação e para os eventos de corte. Log por passada: `examined`, `corrected`, `suspended`,
`unknownCustomer`, `unknownPlan`, `adminSuspended`, `stale`, `errors`, `durationMs` — só ids e contagens, nunca e-mail/nome.

**Assinatura dá acesso** (decisões do dono 2026-11-07; função `subscriptionGrantsAccess` do domínio, usada pela
reconciliação e pelos eventos de corte). Tolerância `BILLING_GRACE_HOURS` (padrão 24 h) após o `expiresAt` para o banco
retentar a cobrança:

| Assinatura na central | Acesso |
| --- | --- |
| `deletedAt`, `canceledAt`, `refundedAt` ou `chargedbackAt` preenchido | **não**, na hora (sem tolerância) |
| `billingStatus` CANCELED (cancelamento de admin/suporte na central) ou REFUNDED (reembolso/chargeback) | **não**, na hora |
| `billingStatus` null (legado), ACTIVE, TRIAL_ACTIVE | sim, sem vencimento ou enquanto `expiresAt` + tolerância ≥ agora |
| `billingStatus` PAYMENT_FAILED ou EXPIRED (o cron da central marca logo após vencer) | sim, enquanto `expiresAt` + tolerância ≥ agora; sem vencimento = não |
| `billingStatus` PENDING_CANCELLATION (pedido de cancelamento aguardando aprovação; na central segue ativa) | sim, como ACTIVE; o corte vem quando o admin aprova (`canceledAt`/CANCELED) |
| TRIAL_ENDED_PENDING, status desconhecido | não |

Cancelar só a recorrência na Cakto não grava nada na central: a linha segue ACTIVE e dá acesso até o vencimento + tolerância.
`canceledAt`/`refundedAt`/`chargedbackAt` (ISO|null) vêm na resposta desde a central 1.89.2 (junto com `status`, que o
cliente ignora); ausentes (central antiga) contam como nulos. Plano esperado = entre as que dão acesso com `planSlug` conhecido (`resolvePlanSlug`), o maior
(MAX > PRO > LITE); empate = vencimento mais distante, depois menor id.

**Regras** (decididas com o tenant travado, ver Concorrência):

| Situação | Ação |
| --- | --- |
| Watermark local > `lastSeq` (ou central sem evento e local com watermark) | `stale`: nada (evento mais novo já aplicado) |
| Há assinatura com acesso e tenant sem plano, com plano diferente, vencimento diferente, SUSPENDED/CANCELLED sem `adminBlockedAt` ou watermark < `lastSeq` | aplica: ACTIVE + `suspendedAt` null (se SUSPENDED/CANCELLED; `reasons` `billing_suspended`/`billing_cancelled`), `planSlug`, `subscriptionExpiresAt`, entitlements + efeitos; AuditLog (`TENANT_STATUS_CHANGED` se reativou, senão `TENANT_UPDATED`; `meta.origin = BILLING_RECONCILE`, `reasons`, antes/depois); watermark → `lastSeq` |
| Há acesso, mas só com `planSlug` desconhecido | nada; warn + `unknownPlan` |
| Tenant com `adminBlockedAt` (bloqueio do super-admin) | nunca muda status (nem suspende nem reativa); com acesso e plano/vencimento/watermark diferentes, aplica só isso (`activate: false`); senão nada, `adminSuspended` |
| Central lista assinaturas, nenhuma dá acesso, tenant ACTIVE (só resposta 200 bem formada) | suspende como o `payment_failed` do webhook: SUSPENDED + `suspendedAt`, plano/entitlements intactos, AuditLog `TENANT_STATUS_CHANGED` (`reasons: ['no_access']`), watermark → `lastSeq`; após o commit `TENANT_SUSPENDED` (desconecta sessões) |
| Central responde 200 com lista vazia (cliente desconhecido) | nada; warn + `unknownCustomer` |
| Iguais | nada |
| 401/403, outro status (404/400/5xx), timeout, rede, corpo inválido (outro `externalUserId`, `lastSeq` não inteiro, item malformado) | nada; `errors`; segue para o próximo |

Suspensão pela reconciliação não grava `adminBlockedAt`, então a passada seguinte reativa se o acesso voltar.

**Concorrência com o webhook**: `reconcileLocked` faz `SELECT … FOR UPDATE` na linha do tenant (mesma trava do
`ApplyBillingEventUseCase`) e só então decide, com o estado relido. Evento mais novo aplicado durante o GET deixa o
watermark acima do `lastSeq` → `stale`. O watermark sobe com `updateMany … lastBillingEventSeq < seq`: nunca desce.
Evento com `seq ≤ lastSeq` que chegue depois vira OUT_OF_ORDER (já refletido). Reconciliação não grava recibo.

**O que não faz**: não reativa bloqueio de super-admin; não cria tenant (cliente sem tenant segue pelo webhook); não toca tenant sem
`billingCustomerId`; não valida `permissions[]`; não usa o segredo anterior; não roda no papel `http`.

**Pendências**:
- ~~Central não expunha `canceledAt`/`refundedAt`/`chargedbackAt`~~ — resolvido na central 1.89.2: cancelamento de admin que
  grava só `canceledAt` com status ACTIVE agora corta na hora.
- O `subscriptionGrantsAccess` da própria central não tem tolerância de 24 h nem aceita PAYMENT_FAILED/EXPIRED: o CopySync
  segue a decisão do dono; alinhar os dois lados se a central mudar.

## O que não fazer

- Não chamar a central de forma síncrona em request de usuário. Exceções: e-mail em `afterCommit` com timeout curto e `sent:false` em falha.
- Não guardar preço nem cópia de preço: só `planSlug` e entitlements.
- Não compartilhar `JWT_SECRET` nem cookie com a central.
- Não criar tabela de assinatura própria: a verdade da cobrança é a central.
- Não aceitar evento sem HMAC válido, com `X-Timestamp` fora de ±5 min ou `eventId` já processado. Nunca 500 em evento repetido ou fora de ordem (a central reenviaria para sempre).
- Não deixar `BILLING_*` obrigatórias no `loadEnv`: deploy sem elas sobe, só o módulo fica desligado.

## Créditos

CopySync é só período. `Application.creditsEnabled=false` na central. Se uma feature pedir consumo (reescrita IA, gerador por dia),
usar `POST /credits/authorize` da central com `app=copysync`, depois de a carteira ganhar escopo por aplicação (previsto: o
`Application` do H1 não tem `creditsEnabled`).

## Ordem

1. Central fases 0–2 (banco separado, `Application`, eventos de saída, M2M).
2. CopySync: service-desk P1.0 + USR-01 + `resolveMembership` + `TenantSuspendedError` (pré-requisito), depois migration desta integração + receiver + `ApplyBillingEventUseCase`.
3. Central fase 3 (checkout da aplicação `copysync`) → primeira venda.
4. Domínio do CopySync verificado no **Resend** (SMTP `smtp.resend.com`, API key só de envio restrita ao domínio), com SPF, DKIM e DMARC; `EmailSenderConfig` de aplicação
   na central (H10); `HubEmailSender`; `SET_PASSWORD`; convite de equipe pela central.
5. Enforcement de `PLAN_LIMIT_REACHED` cresce por feature do roadmap; worker checa `Tenant.status`.

## Alternativas descartadas (2026-10-26) e por quê

| Alternativa | Por que não |
| --- | --- |
| Fork da central, rebrand e usar no CopySync | Terceira base divergente (já aconteceu: `api.waiochat.com` 1.26 → `pulsosocial_api` 1.84). Todo bugfix de gateway/e-mail/renovação feito N vezes. Carrega 53 models e 300+ rotas de outro produto. E o webhook de saída seria necessário do mesmo jeito, porque o CopySync tem tenant/auth próprios |
| Segunda instância da central com env do CopySync | Não duplica código, mas duplica processo, banco, painel admin, crons e configuração de gateway. Cliente com 2 produtos vira 2 usuários. Só aceitável como atalho de dias com migração de dados depois |
| Checkout próprio no CopySync (Stripe direto) | Duplica 5 gateways, ciclo de assinatura e fila de e-mail |
| SSO / central como provedor de identidade | Cookie `__Host` sem domínio, `maxSessions` conta dispositivo, dependência síncrona em todo request. Senha já é bcrypt, mas o resto permanece |
| Repo novo para o hub | É fork com outro nome. Hub = `pulsosocial_api` evoluindo em `api.pulsosocial.app` |
| Gerenciar instâncias do CopySync pelo painel do hub | Acopla cobrança à operação de um produto. Infra sobe worker; super-admin do CopySync mostra lease/sessões/RAM; hub só lê tenants e assinaturas |

## Carga que o CopySync gera no hub

Hub nunca vê mensagem de WhatsApp. Para 1.000 tenants: ~70 eventos de checkout/renovação por dia, ~70 webhooks de saída,
~1.000 GET de reconciliação por rodada (um por tenant; com o padrão de 1 h seriam ~24.000/dia, aumentar o intervalo
quando o corpo existir), alguns milhares de e-mails por mês. Menos de 1 request/minuto. A extensão PulsoSocial
(heartbeat, `credits/authorize`) já gera ordens de grandeza mais. O hub continua em 1 instância; sua limitação para 2+ réplicas
(crons em `setInterval`, sessão em cookie no banco) é do PulsoSocial e não é agravada pelo CopySync.

## Futuro (fora de escopo agora): checkout para terceiros e cascata

- **Produtor/coprodutor com gateways da central** é virar facilitador de pagamento: KYC, liquidação, repasse, MED do Pix,
  chargeback na sua conta, contrato de facilitador com cada gateway. Alternativa que tira 80% disso: subconta no gateway
  (Stripe Connect, Pagar.me/Asaas). Decidir só com o CopySync operando. O modelo do hub já cabe: `Application` → produtor,
  `Plan` → oferta, `Payment` → ledger com split.
- **Cascata entre gateways**: só 1 retentativa, em outro gateway, para recusa recuperável (timeout/5xx do adquirente, emissor
  indisponível 91, `do_not_honor` 05, recusa genérica). Nunca para saldo (51), limite (61), cartão roubado/perdido (41/43/04),
  fraude (59), dados inválidos (14/54/N7), não permitida (57/58), 3DS/antifraude/velocity. Token do cartão gerado no navegador
  no gateway primário e no fallback, para não ter PAN no servidor (fica em SAQ A). Pix fora. Só faz sentido com 2+ gateways de
  cartão ativos; em 2026-10-26 só a Cakto está ativa em produção. Testar primeiro nos próprios produtos antes de pensar em terceiros.
