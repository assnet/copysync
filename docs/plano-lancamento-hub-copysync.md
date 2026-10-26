# Plano de lançamento — hub central + CopySync escalável

Plano mestre que amarra quatro trilhas em marcos. Atualizado em 2026-10-26. Fontes:
[`arquitetura-central-billing.md`](arquitetura-central-billing.md) (integração),
[`arquitetura-escala.md`](arquitetura-escala.md) (escala), [`produto-roadmap.md`](produto-roadmap.md) (produto),
`pulsosocial_api/.specs/features/multi-application-hub/spec.md` (repositório irmão; hub).

Objetivos, nesta ordem de prioridade:
1. **Zero regressão no PulsoSocial** (produção, 1 instância, 500+ assinaturas Cakto).
2. CopySync vendendo e operando escalado o mais cedo possível.
3. Respeitar a arquitetura definida (hub de billing, CopySync com identidade própria, lease/shard/filas).

## Trilhas

| Trilha | Repo | Conteúdo |
| --- | --- | --- |
| **H** Hub | `pulsosocial_api` | fases 0–8 da spec `multi-application-hub` |
| **E** Escala | `copysync/api` | fases 0–5 de `arquitetura-escala.md` |
| **P** Produto | `copysync` | "Ordem sugerida de entrega" de `produto-roadmap.md`, referida aqui pelo nome da funcionalidade |
| **B** Billing no CopySync | `copysync/api` | pré-requisito: service-desk P1.0 (provisionar) + USR-01 (convite) + `resolveMembership`; depois receiver HMAC, `ApplyBillingEventUseCase`, entitlements, `HubEmailSender` |

H e (E, P, B) são repos diferentes: andam em paralelo. Dentro do CopySync, E e P disputam as mesmas pessoas; a ordem abaixo decide.

## Rede de segurança do PulsoSocial (pré-requisito de qualquer commit na trilha H)

Estado em 2026-10-26: central **sem testes, sem CI, sem staging**. CopySync tem 111 arquivos de teste (Vitest) e `ci.yml`.

| # | Item | Critério de pronto |
| --- | --- | --- |
| S1 | CI na central: `tsc --noEmit` + `check:branding` + `check:email-templates` em todo PR | PR vermelho bloqueia merge |
| S2 | Testes de caracterização (vitest) de `utils/billing.ts` (`transitionTo*`), `utils/renewal.ts`, `modules/credits` (grant/authorize/consume), `checkout/process` com gateway mock, webhook Cakto `/add` e `/del` | Capturam a saída **atual**; qualquer fase da trilha H roda verde antes e depois |
| S3 | Staging na Render: serviço `api` + banco restaurado de `pg_dump` de produção (anonimizar e-mails) | Toda fase passa por staging com smoke antes de produção |
| S4 | Smoke manual por deploy (checklist em `docs/`): login painel, login extensão, `credits/authorize`, checkout Cakto sandbox, fila de e-mail processando, cron de renovação | Executado e anotado no PR |
| S5 | Migrations só expand/contract: adicionar nullable → backfill → `NOT NULL`; nunca renomear/dropar na mesma release | Revisão no PR |
| S6 | Toda fase H tem kill switch por env (`OUTBOUND_EVENTS_MODE`, `MULTI_APP_EMAIL_BRAND`, `GATEWAY_CASCADE_MODE`), padrão = comportamento atual | Rollback = env, sem redeploy de código |
| S7 | Janela de deploy fora de pico da extensão; monitorar 24 h `RequestLog`/`AuditLog` antes da fase seguinte | Registro no PR |

## Marcos

### M0 — Fundação (semanas 1–3)

| Trilha | Entrega |
| --- | --- |
| H | S1, S2, S3 (rede de segurança) |
| H0 | Postgres do CopySync separado do da central na Render (hoje compartilhado, Basic-256mb). **Adiado por decisão do owner (2026-10-26)**: em produção do CopySync só há sessões de teste; os testes seguem no compartilhado e o banco dedicado (Virginia, 0.1c-256mb, `connection_limit=5`) é criado quando uma fase precisar dele. Gatilho: antes de E1 (R2) ou antes de qualquer teste de carga, o que vier primeiro; avisar o owner com antecedência. **Sem dump**: banco novo nasce vazio com `prisma migrate deploy`, sessões de teste são pareadas de novo; isso dispensa o runbook de cutover e o flush de E0 como pré-requisito (o flush continua em E0 por mérito próprio). Tabelas do CopySync no banco compartilhado são apagadas 7 dias depois |
| E0 | **Flush síncrono do auth state no shutdown** (`server.ts:212-233` não limpa `flushTimer` de `BaileysAuthStatePersistence.ts:152-155`; a última janela de 750 ms se perde → 440 ao religar em todo deploy da Render); `connection_limit` por processo; unificar os 2 adapters Baileys. Medição de RAM/CPU com 50/100/200 sessões fica para o gate de M2 (exige o banco dedicado em 0.5c-1g ou acima) |
| B | **Início da service-desk P1.0 + USR-01** (4 + 1 requisitos; design §10 tem 6+ use cases, hook novo, endpoint de reemissão e UI de primeiro acesso: 4–6 semanas, atravessa M0 e M1). Em M0: migration do design §4 (`billingCustomerId`, `suspendedAt`, `passwordHash?`, `passwordSetAt`, `UserInvite`; sem `planSnapshot`), `resolveMembership` em `tenantHook` e `sseAuthHook`, `TenantSuspendedError`, login com `passwordHash` nulo respondendo credenciais inválidas |

Gate: smoke S4 verde no PulsoSocial; API religa após deploy sem 440; `tenantHook` nega tenant `SUSPENDED` com `TENANT_SUSPENDED`.

### M1 — Hub mínimo + CopySync recebendo (semanas 4–7)

| Trilha | Entrega |
| --- | --- |
| H1 | `Application` + `applicationId` nas tabelas + backfill `socialpulse` + seeds (`socialpulse`, `copysync`) |
| H2 | `OutboundEvent` + dispatcher (`OUTBOUND_EVENTS_MODE=off` no 1º deploy) + auth M2M + `GET /integrations/subscriptions` |
| B | Fim da service-desk P1.0 + USR-01 (`ProvisionTenantUseCase`, `UpdateTenantStatusUseCase`, `InviteUserUseCase`, `IEmailSender` + Smtp/Noop, tela de primeiro acesso no painel). Depois: migration da integração (`planSlug`, `lastBillingEventSeq`, `TenantEntitlement`, `PlanEntitlementPreset`, `BillingEventReceipt`); módulo `integrations/billing` (plugin sem `authHook`, corpo bruto, HMAC com `timingSafeEqual`, receipt na mesma transação); `ApplyBillingEventUseCase` com a tabela evento→status e ordem por `seq`; `SyncTenantEntitlementsUseCase`; `ReconcileSubscriptionsUseCase` sob lease em tabela (`JobLease`); `sessions` desconecta ao receber `TENANT_SUSPENDED` (bus in-process até E3; Redis depois) |
| E1 | Mídia em S3/R2 (`S3MediaFileStore`) |
| P | Gerador de ofertas (credenciais de afiliado já entregues em 2026-10-22) |

Gate: em staging, compra sandbox na central → tenant provisionado no CopySync → owner entra pelo link → cancelamento → tenant `CANCELLED` e sessões desconectadas. PulsoSocial S2 verde.

### M2 — Primeira venda (semanas 8–9)

| Trilha | Entrega |
| --- | --- |
| H3 | **Checkout por aplicação**: cada `Application` tem seu checkout (domínio, marca, planos, remetente, webhook) servido pelo mesmo código da central. `VITE_APPLICATION_KEY` no front, `GET /plans?app=`, `checkout/process` grava `applicationId`; um deploy estático por aplicação. Para o CopySync: cadastrar `Application copysync`, planos Starter/Profissional/Business e deploy do checkout dele |
| H4 | E-mail por aplicação + `POST /integrations/email/send` (`SET_PASSWORD`, `TEAM_INVITE`) |
| B | `HubEmailSender` (M2M) como terceiro adapter de `IEmailSender`, `EMAIL_SENDER=hub`; `SET_PASSWORD` com link do `UserInvite`; painel "Assinatura" com link para `Application.checkoutUrl` |
| E2 | Lease de sessão + `version` no auth state (deploy sem 440, failover) |
| P | Grupos de disparo + horário de postagem |

Gate: venda real do Starter ponta a ponta. `OUTBOUND_EVENTS_MODE=on` só para `copysync`. Postgres do CopySync em 0.5c-1g e medição de RAM/CPU por sessão anotada no doc de escala.

### M3 — Escala real + núcleo do produto (semanas 10–14)

| Trilha | Entrega |
| --- | --- |
| E3 | `PROCESS_ROLE=http\|worker\|all`, BullMQ comandos, Redis pub/sub → WS |
| E4 | Shard (`WORKER_SHARD`), N workers |
| P | Disparo em massa; monitoramento com troca de link |
| H5 | `creditsEnabled` nos hooks (sem efeito para `socialpulse`) |
| H6 | Admin: seletor de aplicação, CRUD `Application`, replay de eventos |
| B | Enforcement `PLAN_LIMIT_REACHED` em sessões, grupos monitorados, grupos de disparo ("Planos e limites" do roadmap); worker de envio checa `Tenant.status` |

Gate: 2 workers em produção com failover testado; 1 tenant Business com 2 números.

### M4 — Diferenciais e endurecimento (a partir da semana 15)

| Trilha | Entrega |
| --- | --- |
| P | Reescrita IA, rodízio, story, site, domínio, menção a todos, Telegram |
| E5 | Filas de produto (`monitoring.inbound`, `offer.rewrite`, `broadcast.post`) com rate limit por sessão |
| H7 | Cascata de gateway, só quando houver 2º gateway de cartão ativo |
| H8 | `/webhook/app/:applicationKey/:gateway`, migração da Cakto, aposentar apiKey no path |
| Infra | Decidir Render × Hetzner/Dokploy pelo critério 5.4 do doc de escala (~500–800 sessões) |

## Gestão de instâncias do CopySync

Não é função do hub. Três responsabilidades, três lugares:

| Onde | O quê |
| --- | --- |
| Infra (Render / Dokploy) | subir e descer workers, RAM, réplicas; depois automatizado por API da infra conforme contagem de tenants |
| Super-admin do CopySync | workers vivos, lease por sessão, sessões por worker, RAM, filas (doc de escala §3) |
| Admin do hub | leitura: tenants e assinaturas por aplicação, receita. Opcional: card "saúde" lendo `GET /integrations/health` do CopySync |

## O que bloqueia o quê

```
S1–S3 ──► H1 ──► H2 ──► H3 (checkout por aplicação) ──► primeira venda
H0 ──► E1 ──► E2 ──► E3 ──► E4 ──► E5
H0 (banco dedicado) ──► E1 e testes de carga
service-desk P1.0 + USR-01 (M0–M1) ──► B(M1 receiver) ──► B(M2)        (B depende de H2 só para teste ponta a ponta; desconexão por evento entre processos e reconciliação restrita a worker dependem de E3)
gerador ──► disparo/horário ──► massa ──► monitoramento ──► IA …   (independente de H e E até monitoramento; monitoramento em escala precisa de E5)
```

## Checkout por aplicação (vale para toda aplicação, não só CopySync)

Um checkout **por `Application`**, mesmo código e mesmo processo da central. O que é por aplicação é dado:

| Por aplicação | Onde |
| --- | --- |
| Domínio e deploy do front | deploy estático próprio (`conta.copysync.app`, `studio.pulsosocial.app`), `VITE_APPLICATION_KEY` |
| Marca (nome, logo, cores, suporte) | `Application.brand`; `VITE_BRAND_*` no front |
| Planos e permissões | `Plan.applicationId`; `GET /plans?app=` |
| Remetente e templates de e-mail | `Application.senderConfigId`, `templates/<applicationKey>/` |
| Webhook de saída e segredo | `Application.webhookUrl`, `secretHash` |
| Créditos | `Application.creditsEnabled` |
| Gateways | compartilhados por padrão (`Gateway.applicationId = null`); podem ser próprios |

Cliente de uma aplicação nunca vê planos, marca ou e-mail de outra. Nova aplicação = seed de `Application` + planos + deploy
do front, zero código.

## Regras do plano

- Nenhum commit na trilha H sem S1–S3 prontos.
- Fase H só avança após 24 h em produção sem anomalia (S7).
- CopySync nunca chama a central de forma síncrona em request de usuário. Exceção documentada: e-mail em `afterCommit`, timeout de 5 s, `sent:false` em falha.
- Versão e CHANGELOG em cada repo a cada fase (AGENTS.md §31–33 de cada um).
- Este doc é atualizado ao fechar cada marco, com data e o que ficou de fora.
