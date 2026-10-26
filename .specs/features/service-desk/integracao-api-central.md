# Análise — reaproveitar a API central (`www/pulsosocial_api/api`) para cadastro, checkout e e-mail

Data: 2026-09-27. Base: leitura do código da API central (Fastify 5 + Prisma 5, v1.67.0).
Objetivo: decidir como o cliente do CopySync nasce (tenant + ADMIN) e como as duas APIs conversam.

## 1. Veredito

Reaproveitar **billing, e-mail e criação do cliente** é viável e vale a pena. Reaproveitar como
**provedor de identidade (login compartilhado)** não vale agora. A API central foi feita para um
produto por deploy: não tem dimensão de produto, não avisa sistemas externos e o único acesso
máquina-a-máquina é a `apiKey` de um ADMIN na URL.

## 2. O que já existe e serve

| Capacidade                | Onde                                             | Observação                                  |
| ------------------------- | ------------------------------------------------ | ------------------------------------------- |
| Checkout + 4 gateways     | `utils/gateway-router.ts`, `controllers/checkout*` | Stripe, MercadoPago, Efí, Cora (+ Cakto por webhook) |
| Ciclo da assinatura       | `utils/billing.ts` (`transitionToActive/Canceled/PaymentFailed`) | trial, renovação, refund, chargeback, snapshot imutável |
| Cliente criado no checkout| `checkout.ts:536`                                | sem senha; senha definida no primeiro login |
| Fila de e-mail            | `modules/email/service.ts` `EmailService.enqueue` | SMTP genérico, retry, supressão, 19 locales |
| Reset de senha            | `controllers/forget-password.ts`                 |                                             |

## 3. O que falta para ser "central" (bloqueios)

1. **Dimensão de produto/aplicação.** Permissão é enum Postgres (`SubscriptionPermissionKey`) +
   constante TS. `Plan` e `Subscription` não têm `productId`. Produto novo = migration + deploy.
2. **Registro de aplicações (o "dispositivo").** Não existe model `Application`/`Client`. Precisa:
   `Application { id, key, name, secret(hash), webhookUrl, brand vars, status }`.
3. **Eventos de saída.** Nenhum webhook outbound, nenhum event bus. O CopySync não fica sabendo
   de ativação/cancelamento. Precisa de um dispatcher com assinatura HMAC, retry e `eventId`.
4. **Auth máquina-a-máquina.** Só `User.apiKey` de ADMIN em texto puro no path. Precisa de
   credencial por aplicação (HMAC no header, ou client secret + token curto) e endpoint de consulta
   de assinatura por `externalUserId` para reconciliação.
5. **Marca única por processo.** `BRAND_*` por env; o guard `scripts/check-branding.ts` proíbe o
   termo "waio" no código. E-mails do CopySync precisam de marca por aplicação (no `Application`),
   não por env.
6. **Tenant não existe.** Assinatura pertence ao `User`. Para o CopySync, o `User` central é o
   contratante → vira ADMIN do tenant. O tenant guarda `billingCustomerId` (id do User central).
7. **Sem escopo de produto no e-mail.** `EmailTemplateType` é enum; textos presumem a extensão.
   Templates do CopySync (convite, senha provisória, boas-vindas) precisam de tipo por aplicação.

## 4. Por que **não** usar como login compartilhado (SSO) agora

- JWT não valida offline: `authenticate` exige linha ativa em `Session` no banco central. Todo
  request do CopySync dependeria da disponibilidade da API central.
- Cookie `__Host-ps_session`, `SameSite=Strict`, sem `Domain`: não atravessa domínios.
- Login consome vaga de sessão do plano (`maxSessions` = dispositivos logados, não WhatsApp).
- Senha em **sha256 sem salt** (`module.ts:313`). Antes de virar IdP, precisaria migrar para
  argon2/bcrypt com rehash no login.
- Carteira de créditos é uma por usuário, global entre produtos.

## 5. Opções

### A — Central faz billing + e-mail + cadastro; CopySync mantém a própria identidade ✅ recomendada

```
Cliente → checkout (central) → pagamento aprovado
  → central emite webhook assinado  subscription.activated
      { eventId, applicationKey, externalUserId, email, name, plan, limits, expiresAt }
  → CopySync  POST /integrations/billing/events  (verifica HMAC, idempotente por eventId)
  → ProvisionTenantUseCase: Tenant + User(ADMIN, sem senha) + UserTenant + depto padrão
  → CopySync pede à central o envio do e-mail "defina sua senha" (ou envia via porta EmailSender)
subscription.canceled / payment_failed → Tenant.status = CANCELLED / SUSPENDED → tenantHook bloqueia
```

- Sem credencial compartilhada: o problema do sha256 e do cookie some.
- CopySync já tem JWT + refresh próprios; nada muda no login.
- "Gerenciar assinatura" no painel → link para o painel central.
- Reconciliação: job diário consulta `GET /integrations/subscriptions?externalUserId=` (M2M).

### B — Central como IdP completo (SSO)

Bloqueada pelos itens da seção 4. Escopo muito maior. Reavaliar depois que a opção A estiver
rodando e a central tiver credencial por aplicação.

### C — CopySync com Stripe próprio

Duplica 4 gateways, fila de e-mail e ciclo de assinatura. Descartada.

## 6. Trabalho por repositório (opção A)

**API central (feature própria, `pulsosocial_api`)**
1. Model `Application` + migration; seed da aplicação "whatsapp-crm".
2. `productId`/`applicationId` em `Plan`; permissões por aplicação (sair do enum global ou
   prefixar por aplicação).
3. Dispatcher de webhooks de saída (tabela `OutboundEvent`, HMAC, retry exponencial, replay).
4. Rotas M2M `/integrations/*` autenticadas por aplicação (assinatura, envio de e-mail).
5. Marca por aplicação nos e-mails (`getBrandEmailVars(applicationId)`).
6. Templates de e-mail do produto (convite, senha provisória, boas-vindas).

**CopySync (`api/`)**
1. Módulo `billing` (ou `integrations/billing`): receiver de webhook, verificação HMAC,
   idempotência, tradução para `ProvisionTenantUseCase` / `UpdateTenantStatusUseCase`.
2. `Tenant.billingCustomerId`, `Tenant.planSlug` + `TenantEntitlement` (o snapshot foi superado por §9; entitlements em `docs/arquitetura-central-billing.md`), `User.passwordSetAt` nullable.
3. `tenantHook` bloqueia `SUSPENDED`/`CANCELLED` com erro `TENANT_SUSPENDED`.
4. Porta `EmailSender` com adapter que chama a central (M2M); fallback SMTP direto por env.
5. Painel: "Assinatura" com link para a central; tela "defina sua senha" (mesmo fluxo do convite).

## 7. Impacto na feature *service-desk*

Nada muda no núcleo. `ProvisionTenantUseCase` continua sendo a única porta de criação de tenant,
com duas entradas: **SUPER_ADMIN pelo painel** (v1, sem dependência externa) e **webhook da
central** (feature de integração, depois). O convite de equipe usa a porta `EmailSender`, que
nasce com o adapter SMTP direto e ganha o adapter central quando o M2M existir.

Assim a service-desk **não fica bloqueada** pela integração.

## 8. Alertas de segurança na API central (fora deste escopo, registrar)

- Senhas com sha256 sem salt (`module.ts:313-315`); bcryptjs instalado e não usado.
- `apiKey` de ADMIN em texto puro no banco e no path da URL dos webhooks.
- `webhooks.md` (linhas 51+) traz URLs de produção com apiKey parcialmente em claro — rotacionar.
- Login com e-mail desconhecido dispara e-mail `SUBSCRIPTION_OFFER` (enumeração de contas).

## 9. Decisões de 2026-10-26

Reanálise com os repos atuais (`pulsosocial_api` 1.84.5, CopySync 0.18.3). Supera a D7 do `design.md` ("não decidir agora entre A e B"): decidido A. Opção A confirmada e ampliada:

- Sem fork da central, sem segunda instância, sem checkout próprio no CopySync.
- Sem produtor/coprodutor ou checkout para terceiros agora; gateways continuam controlados pela central.
- Cascata de gateway conservadora (1 retentativa, só recusa recuperável sem sinal de fraude, token por gateway no navegador).
- Front do checkout: mesmo `app/` da central, um deploy estático por aplicação com marca própria.
- Créditos por flag `Application.creditsEnabled`; CopySync só período.
- Senha na central já é bcrypt: bloqueio de SSO menor, mas SSO segue fora de escopo.

Spec do lado da central: `pulsosocial_api/.specs/features/multi-application-hub/spec.md` (repositório irmão).
Doc operacional do lado CopySync: [`docs/arquitetura-central-billing.md`](../../../docs/arquitetura-central-billing.md).
