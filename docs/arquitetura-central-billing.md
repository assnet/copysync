# Billing, checkout e e-mail via API central — CopySync

Fonte de verdade de **como o CopySync é vendido e cobrado** sem cálculo de preço nem gateway próprios. Complementa
[`produto-roadmap.md`](produto-roadmap.md) (planos) e [`arquitetura-escala.md`](arquitetura-escala.md) (operação).
Decisões de 2026-10-26; análise de origem em
[`../.specs/features/service-desk/integracao-api-central.md`](../.specs/features/service-desk/integracao-api-central.md).
Trabalho do lado da central: `pulsosocial_api/.specs/features/multi-application-hub/spec.md` (repositório irmão).

**Contrato de provisionamento, status de tenant, convite e e-mail é o da service-desk**
([`design.md`](../.specs/features/service-desk/design.md) §4, §10, §11; requisitos PROV-01..04 e USR-01 em
[`spec.md`](../.specs/features/service-desk/spec.md)). Este doc não redefine nada disso: só diz como o webhook da central entra
por essas portas. Em 2026-10-26 a service-desk está desenhada e **não implementada**; a integração depende de P1.0 (provisionar),
USR-01 (convite) e `resolveMembership` (§10) existirem primeiro.

## Decisão

A API central (`pulsosocial_api`, Fastify + Prisma) é o **hub** de checkout, assinatura, e-mail e créditos para N aplicações.
O CopySync é a aplicação `copysync` nela. O checkout é **por aplicação**: cada `Application` tem domínio, marca, planos, e-mail
e webhook próprios sobre o mesmo código. Descartados: fork da central, segunda instância, checkout próprio, SSO.

```
Cliente → checkout (front da central, deploy da aplicação copysync) → pagamento aprovado
  → central grava Subscription e emite  subscription.activated  (HMAC)
  → api.copysync.app  POST {API_PREFIX}/integrations/billing/events   (idempotente por eventId; ordem por seq)
  → ProvisionTenantUseCase({origin:'BILLING_WEBHOOK'})  (service-desk §10: Tenant + User + UserTenant ADMIN + Department padrão + UserInvite + AuditLog, uma transação)
  → afterCommit: EmailSender.send(SET_PASSWORD) com o link do UserInvite
eventos de status → UpdateTenantStatusUseCase({origin:'BILLING_WEBHOOK'}) → suspendedAt, AuditLog, publica TENANT_SUSPENDED (design §10; tipo em §12)
  → `sessions` consome TENANT_SUSPENDED e desconecta as sessões do tenant (ator SYSTEM); WS fecha (design §7)
Reconciliação diária: GET /integrations/subscriptions?externalUserId=  (M2M, 1 GET por tenant, sob lease em tabela)
```

## Mapeamento evento → tenant (tabela única)

| Evento da central | `Tenant.status` | Entitlements | Observação |
| --- | --- | --- | --- |
| `subscription.activated` (1ª vez) | provisiona `ACTIVE` | preset do `planSlug` | e-mail já cadastrado → só `UserTenant` (PROV-01, regra 11); conta com senha → sem convite (PROV-02) |
| `subscription.activated` (reativação) / `subscription.renewed` | `ACTIVE`, limpa `suspendedAt` | preset do `planSlug` | plano pode ter mudado: ressincroniza |
| `subscription.updated` (só `expiresAt` mudou: edição manual, cortesia) | mantém | ressincroniza `expiresAt` | sem mudança de status |
| `subscription.payment_failed` | `SUSPENDED` | mantém | |
| `subscription.canceled`, `subscription.expired` | `CANCELLED` | mantém | login preservado (PROV-03) |
| `subscription.refunded`, `subscription.chargedback` | `CANCELLED` | mantém | |
| `subscription.trial_ended` | sem efeito, 200 | | CopySync não tem trial próprio |
| tipo desconhecido | sem efeito, 200, `AuditLog` | | nunca 4xx/5xx: a central reenviaria |
| evento com `eventId` já visto | sem efeito, 200 | | `BillingEventReceipt` |
| `seq` ≤ `Tenant.lastBillingEventSeq` (fora de ordem ou repetido) | sem efeito, 200, `AuditLog` | | `seq` é a sequência global da central (autoincrement), crescente; só se compara **dentro do mesmo cliente**. Tenant ↔ `billingCustomerId` é 1:1, então o watermark por tenant basta. A central nunca envia um `seq` maior do cliente enquanto um menor dele está pendente. Avanço do watermark é condicional: `UPDATE … SET lastBillingEventSeq=$s WHERE id=$t AND (lastBillingEventSeq IS NULL OR lastBillingEventSeq < $s)`; 0 linhas = outro evento passou na frente, sem efeito |

Efeitos de `SUSPENDED`/`CANCELLED` além do HTTP (`resolveMembership` nega com `TENANT_SUSPENDED` 403): o módulo `sessions`
assina `TENANT_SUSPENDED` no bus (publicado em design §10, tipo definido em §12; precedente de listener:
`chat/infrastructure/listeners/*`) e desconecta as sessões do tenant com ator `SYSTEM` no `AuditLog`
(`DisconnectSessionUseCase` hoje exige `userId` de ator, `DisconnectSessionUseCase.ts:10-14`; ganha ator de sistema). `tenants`
não importa `sessions`. Reativação **não** reconecta: o cliente reconecta pelo painel. O worker de envio (escala §3.6) checa
`Tenant.status` antes de cada post. Isso **supera** a linha "Tenant suspenso mantém sessões WhatsApp: não desconectar nesta
feature" do design §17 (`design.md:1217`), que já apontava esta integração como dona da política.
**Dependência de E3**: o bus hoje é `EventEmitter` in-process (`InternalEventBus.ts:11`); com `PROCESS_ROLE=http|worker` o
receiver roda no HTTP e a sessão vive no worker. A fase E3 troca o bus por `RedisInternalEventBus` (escala §3.4), e aí o
listener continua funcionando sem mudança. Até E3, processo único (`all`) e o bus in-process basta.

## O que o CopySync implementa

| Camada | Item |
| --- | --- |
| Prisma (service-desk §4, migration única da service-desk) | `Tenant.billingCustomerId @unique`, `Tenant.suspendedAt`, `User.passwordHash String?`, `User.passwordSetAt`, `UserInvite` (`planSnapshot Json?` sai do design: substituído por `planSlug` tipado, AGENTS §26) |
| Prisma (esta integração) | `Tenant.planSlug String?`, `Tenant.lastBillingEventSeq Int?`; `TenantEntitlement { tenantId, key, value Json?, @@unique([tenantId,key]) }` (`null` = ilimitado, cf. roadmap); `PlanEntitlementPreset { planSlug, key, value Json? }`; `BillingEventReceipt { eventId @id, billingCustomerId @index, type, seq, receivedAt, outcome }`; `JobLease { name @id, ownerId, expiresAt }` |
| Módulo `integrations/billing` | plugin Fastify encapsulado **sem `authHook`** (precedente público: `auth.routes.ts:25`), `addContentTypeParser` com `parseAs: 'buffer'` para ter o corpo bruto (precedente: `media.upload.routes.ts:108-110`), verificação de `X-Signature: sha256=<hmac>` com `crypto.timingSafeEqual` (precedente: `OpaqueCursor.ts:54`) sobre `canonical = X-Timestamp + "." + corpo bruto` (mesmo formato do Cakto em `pulsosocial_api/api/src/modules/cakto/webhook-signature.ts:51-55`; validar com vetor de teste compartilhado entre os dois repos antes de codar) com `X-Timestamp` ±5 min, `X-Event-Id` e `X-Application-Key` (deve ser `copysync`); `BillingEventReceipt` gravado **na mesma `runInTransaction`** que aplica o evento (crash entre receipt e tenant deixaria o evento "visto" sem efeito); `P2002` no receipt = entrega duplicada concorrente → 200 sem efeito; tradução para os use cases da service-desk |
| Use cases novos | `ApplyBillingEventUseCase` (tabela acima), `SyncTenantEntitlementsUseCase`, `ReconcileSubscriptionsUseCase` |
| Use cases reusados | `ProvisionTenantUseCase`, `UpdateTenantStatusUseCase`, `InviteUserUseCase` (service-desk §10), com `origin: 'SUPER_ADMIN' \| 'BILLING_WEBHOOK'` |
| Erros | `TenantSuspendedError` (403, `TENANT_SUSPENDED`) substitui o `ForbiddenError` genérico de `tenantHook.ts:56` e `sseAuthHook.ts:39,50`; é mudança de contrato: painel passa a tratar `TENANT_SUSPENDED`. `PlanLimitReachedError` (403, `PLAN_LIMIT_REACHED`, com `key` e `limit`) lido de `TenantEntitlement` no application layer |
| E-mail | porta `IEmailSender.send({to, template, data, locale})` da service-desk; adapters `SmtpEmailSender`, `NoopEmailSender` (do design) **+ `HubEmailSender`** (M2M `POST /integrations/email/send`, que mapeia `data` → `vars` e assina com a canônica M2M da central: método, path, query, timestamp, nonce, sha256 do corpo). Envio em `afterCommit`, fora da transação, timeout 5 s, `sent:false` em falha: exceção documentada à regra "sem chamada síncrona à central" |
| Agendamento | `ReconcileSubscriptionsUseCase` no padrão `server.ts:142-149` (`setInterval` + `unref` + `clearInterval` no shutdown) sob **lease em tabela** `JobLease` (`UPDATE … SET ownerId=$me, expiresAt=now()+10min WHERE name='billing-reconcile' AND (expiresAt IS NULL OR expiresAt < now())`; 0 linhas = outro processo tem o job), mesmo padrão do lease de sessão de escala §3.1. Advisory lock de sessão não serve com pool do Prisma (o único lock do repo é `pg_advisory_xact_lock` em `PrismaChatMessageReactionRepository.ts:34`, transacional). Independe de `PROCESS_ROLE`; quando E3 existir, rodar só em `worker` |
| Painel | "Assinatura" = link para `Application.checkoutUrl` da central; tela de primeiro acesso é a do convite (USR-01) |
| Env (`env.ts`, opcionais; validadas na factory do módulo, como `CREDENTIALS_ENCRYPTION_KEY` em `env.ts:110-113`; ausente = webhook responde 503 e reconciliação não roda) | `BILLING_HUB_URL`, `BILLING_APPLICATION_KEY`, `BILLING_APPLICATION_SECRET`, `EMAIL_SENDER=noop\|smtp\|hub` (default `noop` com aviso no boot; **em `NODE_ENV=production` com `BILLING_*` definidas, `noop` recusa o boot**: tenant criado por webhook sem e-mail ficaria sem link de senha e a reemissão é só `[S]`), `EMAIL_SMTP_URL`, `EMAIL_FROM`, `PANEL_URL` |

Chaves de entitlement: as do roadmap (`whatsapp_sessions`, `telegram_enabled`, `monitored_groups`, `broadcast_groups`, …).
Fonte única: `PlanEntitlementPreset` por `planSlug` (dado: seed + tela super-admin). `permissions[]` do evento serve só para
validar que `planSlug` e permissão batem; divergência = `AuditLog`, preset vence.

Link "defina sua senha": token gerado **pelo CopySync** (`UserInvite.tokenHash`, design §10); a central só envia o e-mail com o
link pronto em `vars.link`. Payload do `SET_PASSWORD`: `{ to, locale, vars: { name, link, expiresAt } }`.

## O que não fazer

- Não chamar a central de forma síncrona em request de usuário. Exceções: e-mail em `afterCommit` com timeout curto e `sent:false` em falha.
- Não guardar preço nem cópia de preço: só `planSlug` e entitlements.
- Não compartilhar `JWT_SECRET` nem cookie com a central.
- Não criar tabela de assinatura própria: a verdade da cobrança é a central.
- Não aceitar evento sem HMAC válido, com `X-Timestamp` fora de ±5 min ou `eventId` já processado. Nunca 500 em evento repetido ou fora de ordem (a central reenviaria para sempre).
- Não deixar `BILLING_*` obrigatórias no `loadEnv`: deploy sem elas sobe, só o módulo fica desligado.

## Créditos

CopySync é só período. `Application.creditsEnabled=false` na central. Se uma feature pedir consumo (reescrita IA, gerador por dia),
usar `POST /credits/authorize` da central com `app=copysync`, depois de a carteira ganhar escopo por aplicação.

## Ordem

1. Central fases 0–2 (banco separado, `Application`, eventos de saída, M2M).
2. CopySync: service-desk P1.0 + USR-01 + `resolveMembership` + `TenantSuspendedError` (pré-requisito), depois migration desta integração + receiver + `ApplyBillingEventUseCase`.
3. Central fase 3 (checkout da aplicação `copysync`) → primeira venda.
4. `HubEmailSender`; `SET_PASSWORD`; convite de equipe pela central.
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
~1.000 GET de reconciliação (um por tenant), alguns milhares de e-mails por mês. Menos de 1 request/minuto. A extensão PulsoSocial
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
