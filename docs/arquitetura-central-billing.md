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
**Pendente**: M2 (`HubEmailSender`; painel "Assinatura" entregue, ver [`assinatura.md`](assinatura.md)) e o corpo da reconciliação (depende de H2 na central). Sem as três
`BILLING_HUB_URL`, `BILLING_APPLICATION_KEY`, `BILLING_APPLICATION_SECRET` (`BILLING_ENABLED`, `env.ts:362`) a rota não é registrada (404); em produção com
`EMAIL_SENDER=noop` ou `hub` (`hub` cai no noop, `EmailSenderFactory.ts:23-26`) ela também não é registrada e só loga erro
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
Reconciliação (padrão 1 h): GET /integrations/subscriptions?externalUserId=  (previsto H2; M2M, 1 GET por tenant, sob lease em tabela; corpo vazio hoje)
```

## Mapeamento evento → tenant (tabela única)

| Evento da central | `Tenant.status` | Entitlements | Observação |
| --- | --- | --- | --- |
| `subscription.activated` (1ª vez) | provisiona `ACTIVE` | preset do `planSlug` | e-mail já cadastrado → só `UserTenant` (PROV-01, regra 11); conta com senha → sem convite (PROV-02) |
| `subscription.activated` (1ª vez) sem `email` ou com `planSlug` fora de `PLAN_SLUGS` | nada; **422** sem receipt, log `error` | | a central marca o evento `DEAD` na hora (422 não é retentado) e ele fica na fila com replay no admin: cliente pagante sem conta nunca some em silêncio |
| `subscription.activated` (reativação) / `subscription.renewed` | `ACTIVE`, limpa `suspendedAt` | preset do `planSlug` | plano pode ter mudado: ressincroniza; `planSlug` inválido = status aplica, plano não muda (warn) |
| `subscription.updated` (edição manual, cortesia, troca de plano) | mantém | preset do `planSlug`, se válido | sem mudança de status |
| `expiresAt` em activated/renewed/updated | | grava `Tenant.subscriptionExpiresAt` | ausente = mantém; `null` limpa; malformado = **400** sem aplicar nem avançar o seq; nos demais tipos é ignorado |
| `subscription.payment_failed` | `SUSPENDED`, `suspendedAt=now` | mantém | emite `TENANT_SUSPENDED` |
| `subscription.canceled`, `subscription.expired` | `CANCELLED`, `suspendedAt=now` | mantém | login preservado (PROV-03); emite `TENANT_SUSPENDED` |
| `subscription.refunded`, `subscription.chargedback` | `CANCELLED`, `suspendedAt=now` | mantém | emite `TENANT_SUSPENDED` |
| qualquer tipo ≠ `activated` de cliente sem tenant | sem efeito, 200, receipt `IGNORED` | | watermark não avança (não há tenant) |
| `subscription.trial_ended` | sem efeito, 200, avança o watermark | | CopySync não tem trial próprio |
| tipo desconhecido | sem efeito, 200, receipt `IGNORED`, avança o watermark | | nunca 4xx/5xx: a central reenviaria |
| evento com `eventId` já visto | sem efeito, 200 | | `BillingEventReceipt` |
| `seq` ≤ `Tenant.lastBillingEventSeq` (fora de ordem ou repetido) | sem efeito, 200, receipt `OUT_OF_ORDER` (o `BillingEventReceipt` é a trilha de auditoria do receiver) | | `seq` é a sequência global da central (autoincrement), crescente; só se compara **dentro do mesmo cliente**. Tenant ↔ `billingCustomerId` é 1:1, então o watermark por tenant basta. A central nunca envia um `seq` maior do cliente enquanto um menor dele está pendente. Avanço do watermark é condicional: `UPDATE … SET lastBillingEventSeq=$s WHERE id=$t AND (lastBillingEventSeq IS NULL OR lastBillingEventSeq < $s)`; 0 linhas = outro evento passou na frente, sem efeito |

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
| Prisma (esta integração) | `Tenant.planSlug String?`, `Tenant.lastBillingEventSeq BigInt?` (seq da central é BIGINT; webhook aceita número inteiro seguro ou string de até 19 dígitos, `parseBillingSeq.ts`), `Tenant.subscriptionExpiresAt DateTime?`; `TenantEntitlement { tenantId, key, value Json?, @@unique([tenantId,key]) }` (`null` = ilimitado, cf. roadmap); `PlanEntitlementPreset { planSlug, key, value Json?, @@unique([planSlug,key]) }`; `BillingEventReceipt { eventId @id, billingCustomerId @index, tenantId?, type, seq BigInt, payload Json?, receivedAt, outcome }`; `JobLease { name @id, ownerId, expiresAt }`. `planSlug` aceito: `COPYSYNC_LITE\|PRO\|MAX` (`planPresets.ts:3`) |
| Módulo `integrations/billing` | `billing.routes.ts`: plugin sem `authHook`, `addContentTypeParser` `parseAs: 'buffer'` (corpo bruto). Ordem: `X-Application-Key` igual a `BILLING_APPLICATION_KEY` em tempo constante (senão 401) → `X-Signature: sha256=<hex>` sobre `${X-Timestamp}.${corpo bruto}`, `X-Timestamp` em segundos ±`BILLING_HMAC_TOLERANCE_SECONDS` (300), `timingSafeEqual` contra atual e anterior (`verifyBillingHmac.ts:39-63`; falha 401) → JSON inválido 400 → falta `eventId`/`type`/`externalUserId`/`seq` 400 → `X-Event-Id` opcional, se vier e divergir do corpo 400 → `expiresAt` malformado 400 → `ApplyBillingEventUseCase`; `UNPROVISIONABLE` 422; erro inesperado 500. Corpo lido: `eventId, type, externalUserId (= billingCustomerId), seq, email, name, planSlug, expiresAt`. `BillingEventReceipt` gravado **na mesma `$transaction`** que aplica o evento, com `SELECT … FOR UPDATE` na linha do tenant; `P2002` no receipt = entrega duplicada concorrente → 200 `DUPLICATE`. A canônica do webhook **ainda não existe na central** (dispatcher H2 não feito): fechar com vetor compartilhado quando ele nascer |
| Use cases novos | `ApplyBillingEventUseCase` (tabela acima; faz o sync de entitlements + `applyPlanSideEffects` dentro da própria transação), `ReconcileSubscriptionsUseCase` (lease pronto, `reconcileTenant` vazio). `SyncTenantEntitlementsUseCase` existe mas **nenhum código de produção o chama** (lógica duplicada no Apply): reusar ou remover |
| Use cases reusados | só `ProvisionTenantUseCase` com `origin: 'BILLING_WEBHOOK'` (cria o `UserInvite` direto pelo repositório, não via `InviteUserUseCase`). `UpdateTenantStatusUseCase` (que grava `AuditLog TENANT_STATUS_CHANGED`) **não** é usado pelo webhook: o status muda sem `AuditLog`; a trilha é só o `BillingEventReceipt` |
| Erros | `TenantSuspendedError` (403, `TENANT_SUSPENDED`, `TeamErrors.ts:3`) lançado em `resolveMembership.ts:36,57`, usado por `tenantHook` e `sseAuthHook`; mudança de contrato: painel trata `TENANT_SUSPENDED`. `PlanLimitReachedError` (403, `PLAN_LIMIT_REACHED`, com `key` e `limit`, `PlanErrors.ts:4`) lido de `TenantEntitlement` no application layer |
| E-mail | porta `IEmailSender.send({to, template, data, locale?})` → `{sent}`; adapters `SmtpEmailSender` (timeout 5 s, `sent:false` em falha) e `NoopEmailSender`. **`HubEmailSender` não existe**: `EMAIL_SENDER=hub` loga erro e usa noop. Previsto (H4): M2M `POST /integrations/email/send` na central, mapeando `data` → `vars`, assinado com a canônica M2M (método, path, query, timestamp, nonce, sha256 do corpo; `m2m-signature.ts` em `hub/h2-t13`). Envio em `afterCommit`, fora da transação: exceção documentada à regra "sem chamada síncrona à central". **Remetente com domínio próprio (H10)**: o hub envia o e-mail do CopySync pela conta SMTP do domínio do CopySync (`EmailSenderConfig` de aplicação, `hub/h4-t16`), nunca pela do PulsoSocial; falha dessa conta não cai para a do PulsoSocial |
| Agendamento | `ReconcileSubscriptionsUseCase` em `server.ts:316-326` (`setInterval` a cada `BILLING_RECONCILE_INTERVAL_MS`, padrão 1 h, + `unref` + `clearInterval` no shutdown, `server.ts:457`), só no papel `worker`/`all` (`processJobs.ts:37`) e só se o guard não bloquear. **Lease em tabela** `JobLease` `billing-reconcile` (TTL `BILLING_RECONCILE_LEASE_TTL_MS`, 10 min): `updateMany WHERE expiresAt < now()`, senão `create`; falha = outro processo tem o job; liberado no fim. Advisory lock de sessão não serve com pool do Prisma |
| Painel | "Assinatura" (Configurações > Assinatura, ver [`assinatura.md`](assinatura.md)): `checkout.ts:18-41` monta `{VITE_BILLING_CHECKOUT_URL}/planos/copysync-{starter\|profissional\|business}-{mensal\|anual}` (`catalog.ts:11`) (`SubscriptionPlanCard.tsx:54` usa só mensal; repassa `utm_*`/`gclid`/`fbclid`); env vazia = botão leva à vitrine interna. Na central, a API `GET /planos/:slug` devolve **JSON** de `RedirectConfig` (A/B) e quem redireciona é o front do PulsoSocial (`App.jsx:216` → `RedirectHandler.jsx:179`), logo `VITE_BILLING_CHECKOUT_URL` = domínio do front da central; o prefill do plano ali é recortado em socialpulse (H1 T29). Os slugs divergem do seed H3a (`copysync-{lite\|pro\|max}-mensal`), e não há `RedirectConfig` `copysync-*` semeado (o seed H3a cria só `Plan` `copysync-*-mensal`): o link ainda não leva a checkout. Primeiro acesso = tela do convite (USR-01) |
| Env (`env.ts:204-238`, todas opcionais; `BILLING_ENABLED` = as três primeiras presentes, `env.ts:362`; ausente = rota não registrada, 404, e reconciliação não roda) | `BILLING_HUB_URL`, `BILLING_APPLICATION_KEY`, `BILLING_APPLICATION_SECRET`, `BILLING_APPLICATION_SECRET_PREVIOUS`, `BILLING_HMAC_TOLERANCE_SECONDS` (300), `BILLING_RECONCILE_INTERVAL_MS` (3 600 000), `BILLING_RECONCILE_LEASE_TTL_MS` (600 000), `EMAIL_SENDER=noop\|smtp\|hub` (default `noop`; fora de produção, billing + noop = warn no boot; **em produção, `noop`/`hub` = rota não registrada + log `error`, o boot segue**: tenant criado sem e-mail ficaria sem link de senha; o hub reenvia depois), `EMAIL_SMTP_URL`, `EMAIL_FROM`, `PANEL_URL` (link do convite `{PANEL_URL}/invite/{token}`; sem ela não há link nem e-mail) |
| Saída para o hub (extensão) | `HubOutboxWorker.ts:79-97` faz `POST {HUB_EVENTS_URL}/events` com `HUB_EVENTS_APPLICATION_KEY`/`HUB_EVENTS_SECRET` (segundo par de segredos, separado do `BILLING_*`), canônica M2M em `hmacSigner.ts`. **Não há receptor `/events` na central** em nenhuma branch hub; e o `X-Timestamp` sai em ISO (`hmacSigner.ts:18`) enquanto a canônica M2M da central espera segundos: alinhar antes de ligar `HUB_EVENTS_ENABLED` |

Chaves de entitlement: as do roadmap (`whatsapp_sessions`, `telegram_enabled`, `monitored_groups`, `broadcast_groups`, …).
Fonte única: `PlanEntitlementPreset` por `planSlug` (dado: seed + tela super-admin). `permissions[]` do evento serve só para
validar que `planSlug` e permissão batem; divergência = `AuditLog`, preset vence.

Link "defina sua senha": token gerado **pelo CopySync** (`UserInvite.tokenHash`, design §10); a central só envia o e-mail com o
link pronto em `vars.link`. Hoje o CopySync monta `data: { name, link, expiresAt }` (`ProvisionTenantUseCase.ts:130-137`); o
`HubEmailSender` (previsto) mapeia para `{ to, locale, vars: { name, link, expiresAt } }`.
`permissions[]` do evento ainda **não é lido** pelo receiver (nem validado, nem auditado).

## Estado em 2026-11-05

A central está em **branches locais sem deploy** (`pulsosocial_api`: `feature/hub-h1` c9661c9, `hub/h2-schema` 412e352,
`hub/h2-t13` b82bc9f, `hub/h3a-base` e5751f5, `hub/h4-overrides` cd16539, `hub/h4-t16` abea7fd); produção da central segue
sem nada do hub para o CopySync. ✅ pronto · 🟡 parcial · ❌ não existe.

| Lado | Peça | Estado |
| --- | --- | --- |
| CopySync | Receiver `POST {API_PREFIX}/integrations/billing/webhook` (HMAC, 2 segredos, receipt + watermark, provisiona, 422) | ✅ |
| CopySync | `expiresAt` → `Tenant.subscriptionExpiresAt` | ✅ |
| CopySync | Guard de produção (`noop`/`hub` não registra a rota) | ✅ |
| CopySync | Listener `TENANT_SUSPENDED` desconecta sessões; worker só envia de tenant `ACTIVE` | ✅ |
| CopySync | `AuditLog TENANT_STATUS_CHANGED` nas mudanças pelo webhook | ❌ (só receipt) |
| CopySync | `SyncTenantEntitlementsUseCase` | 🟡 existe, sem uso |
| CopySync | Reconciliação | 🟡 lease + job 1 h; `reconcileTenant` vazio |
| CopySync | `HubEmailSender` | ❌ (`hub` = noop) |
| CopySync | Validação de `permissions[]` | ❌ |
| CopySync | Link de checkout do painel | 🟡 monta a URL; destino não funciona na central |
| CopySync | `HubOutboxWorker` → `/events` | 🟡 cliente pronto; sem receptor e timestamp ISO ≠ segundos |
| Central | `Application` (key/name/status) + recorte por `X-Application-Key` (H1) | 🟡 sem `webhookUrl`, segredo de webhook, `checkoutUrl` nem `creditsEnabled` no H1 |
| Central | `OutboundEvent` + triggers em `Subscription`/`SubscriptionRenewal`, `Application.webhookUrl`/`outboundEnabled`, `IntegrationNonce` (H2 schema) | 🟡 tabela e trigger; **sem dispatcher** que assine e envie ao CopySync; sem campo de segredo |
| Central | Canônica M2M + vetor (`m2m-signature.ts`, `__fixtures__/m2m-vector.json`) | ✅ (só a função; nenhuma rota `/integrations/*`) |
| Central | `GET /integrations/subscriptions`, `POST /integrations/email/send`, receptor `/events` | ❌ previsto (H2/H4) |
| Central | Planos/permissões `COPYSYNC_*` e seed da aplicação `copysync` (H3a) | ✅ (Plan `copysync-*-mensal`; sem anual, sem `RedirectConfig`) |
| Central | Templates de e-mail do hub + overrides copysync (H4) e `EmailSenderConfig` por aplicação (H4-t16) | ✅ código; sem rota que os use pelo CopySync |

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
