# Plano de lançamento — hub central + CopySync escalável

Plano mestre que amarra quatro trilhas em marcos. Criado em 2026-10-26; estado revisado contra o código em 2026-11-05. Fontes:
[`arquitetura-central-billing.md`](arquitetura-central-billing.md) (integração),
[`arquitetura-escala.md`](arquitetura-escala.md) (escala), [`produto-roadmap.md`](produto-roadmap.md) (produto),
`pulsosocial_api/.specs/features/multi-application-hub/spec.md` (repositório irmão; hub).

Objetivos, nesta ordem de prioridade:
1. **Zero regressão no PulsoSocial** (produção, 1 instância, 500+ assinaturas Cakto).
2. CopySync vendendo e operando escalado o mais cedo possível.
3. Respeitar a arquitetura definida (hub de billing, CopySync com identidade própria, lease/teto por worker/filas).

## Estado em 2026-11-05 (verificado no código)

A central começou: H1 completo e H2/H3/H4 parciais, **tudo em branch local, sem deploy** (nenhum ref do H1 existe em
`origin`). Produção da central = `feature/calibracao-backend` 1.86.0. **O caminho crítico segue sendo a central**: deploy dos
hotfixes → H1 → 1.88.0 → integrar H2/H3/H4.

Cadeia linear na central (cada ref é ancestral do seguinte): `feature/calibracao-backend` 1.86.0 → `hotfix/seguranca-acesso-dados`
1.86.1 → `-2` 1.86.2 → `-3` 1.86.3 → `feature/hub-h1` 1.87.0 → `hub/h1-drop-default` 1.88.0. Os branches `hub/h2-*`, `hub/h3a-base`
e `hub/h4-*` saem de `feature/hub-h1`, são irmãos entre si e não estão integrados.

| Trilha | Entregue | Pendente |
| --- | --- | --- |
| **B** CopySync (api 0.64.0, app 0.82.1) | receiver HMAC `POST {API_PREFIX}/integrations/billing/webhook` (registrado só com `BILLING_ENABLED`), `ApplyBillingEventUseCase`, `SyncTenantEntitlementsUseCase`, enforcement `PLAN_LIMIT_REACHED`, `TENANT_SUSPENDED`, provisionamento/convite/`resolveMembership` (entregas de 2026-11-02 mantidas) | `HubEmailSender` (`EMAIL_SENDER=hub` cai em Noop com log de erro; depende de H4); `ReconcileSubscriptionsUseCase` só lease + laço, `reconcileTenant` vazio (depende de `GET /integrations/subscriptions`, H2); link de venda do painel monta `{VITE_BILLING_CHECKOUT_URL}/planos/copysync-{plano}-{periodo}`: na central, `GET /planos/:slug` (API, `controllers/redirect.ts`) devolve JSON de `RedirectConfig` e quem redireciona é o front do PulsoSocial (`app/src/App.jsx:216` → `RedirectHandler.jsx:179`), então `VITE_BILLING_CHECKOUT_URL` tem de ser o domínio do front da central; nenhum `RedirectConfig` `copysync-*` é semeado; o prefill do plano nessa rota é recortado em socialpulse (H1 T29, D5); **slugs divergem**: o painel usa `copysync-{starter\|profissional\|business}-{mensal\|anual}` (`catalog.ts:11`, `checkout.ts:19`) e o seed H3a cria `copysync-{lite\|pro\|max}-mensal`; o plano previa `Application.checkoutUrl`, que não existe |
| **E** Escala | E0, E1 (`S3MediaFileStore`, `S3_ENABLED`), E2 (lease + CAS), E3/E4 em código (`PROCESS_ROLE` default `all`, `WORKER_ADOPTION_ENABLED` default `false`) | ligar E3/E4 na Render após o checklist do doc de escala §5.1 (estado na Render não verificável daqui); `connection_limit`; E5 ❌ (só comentário `broadcast.post` em `OfferDispatchWorker.ts`) |
| **P** Produto | itens de 2026-11-02 + Telegram em código (`engines/telegram/`) | domínio personalizado (nada encontrado no código) |
| **H** Hub | H1 (1.87.0) e DROP DEFAULT (1.88.0) completos em branch local; S1 e S2 dentro do H1 | H2 🟡, H3 🟡, H4 🟡, H5/H6 ❌ (detalhe nos marcos); deploy de tudo |

## Trilhas

| Trilha | Repo | Conteúdo |
| --- | --- | --- |
| **H** Hub | `pulsosocial_api` | fases 0–8 da spec `multi-application-hub` |
| **E** Escala | `copysync/api` | fases 0–5 de `arquitetura-escala.md` |
| **P** Produto | `copysync` | "Ordem sugerida de entrega" de `produto-roadmap.md`, referida aqui pelo nome da funcionalidade |
| **B** Billing no CopySync | `copysync/api` | pré-requisito: service-desk P1.0 (provisionar) + USR-01 (convite) + `resolveMembership`; depois receiver HMAC, `ApplyBillingEventUseCase`, entitlements, `HubEmailSender` |

H e (E, P, B) são repos diferentes: andam em paralelo. Dentro do CopySync, E e P disputam as mesmas pessoas; a ordem abaixo decide.

## Rede de segurança do PulsoSocial (pré-requisito de qualquer commit na trilha H)

Estado em 2026-11-05 (central, branches locais, sem push): coluna "Estado" abaixo.

| # | Item | Critério de pronto | Estado 2026-11-05 |
| --- | --- | --- | --- |
| S1 | CI na central: `tsc --noEmit` + `check:branding` + `check:email-templates` em todo PR | PR vermelho bloqueia merge | 🟡 `.github/workflows/ci.yml` no H1 (tsc, branding, email-templates, `check:app-scope`, testes unit/db, app); dispara só em push/PR para `develop`/`main` e nunca rodou (sem push). Produção 1.86.0 não tem `.github/` |
| S2 | Testes de caracterização (vitest) de `utils/billing.ts` (`transitionTo*`), `utils/renewal.ts`, `modules/credits` (grant/authorize/consume), `checkout/process` com gateway mock, webhook Cakto `/add` e `/del` | Capturam a saída **atual**; qualquer fase da trilha H roda verde antes e depois | ✅ local: 39 arquivos `*.char*.test.ts` no H1 (billing, renewal, credits, checkout-process, cakto-webhook…). `test/char-prod` (sobre produção) fica fora do H1 |
| S3 | Staging na Render: serviço `api` + banco restaurado de `pg_dump` de produção (anonimizar e-mails) | Toda fase passa por staging com smoke antes de produção | 🟡 só runbook/scripts em `chore/staging-runbook` (`api/scripts/staging/`), fora do H1; staging não existe |
| S4 | Smoke manual por deploy (checklist em `docs/`): login painel, login extensão, `credits/authorize`, checkout Cakto sandbox, fila de e-mail processando, cron de renovação | Executado e anotado no PR | ❌ checklist não encontrado |
| S5 | Migrations só expand/contract: adicionar nullable → backfill → `NOT NULL`; nunca renomear/dropar na mesma release | Revisão no PR | 🟡 variante adotada: `ADD COLUMN … NOT NULL DEFAULT socialpulse` (só metadado; backfill = DEFAULT), FK `NOT VALID` nas tabelas grandes + `validate-application-constraints.ts`, DROP DEFAULT em release própria (1.88.0). Desvio: `20261105000010` cria `Plan_applicationId_slug_key` e faz `DROP INDEX Plan_slug_key` na mesma release |
| S6 | Toda fase H tem kill switch por env (`OUTBOUND_EVENTS_MODE`, `MULTI_APP_EMAIL_BRAND`, `GATEWAY_CASCADE_MODE`), padrão = comportamento atual | Rollback = env, sem redeploy de código | ❌ nenhuma das três envs no código; só a flag de dado `Application.outboundEnabled` (default `false`, H2) |
| S7 | Janela de deploy fora de pico da extensão; monitorar 24 h `RequestLog`/`AuditLog` antes da fase seguinte | Registro no PR | — nada deployado ainda |

Hotfixes de segurança 1.86.1, 1.86.2 e 1.86.3 (`hotfix/seguranca-acesso-dados`, `-2`, `-3`) estão prontos em branch local, em
cadeia sobre a produção 1.86.0; o H1 1.87.0 parte do 1.86.3 e aplica o recorte por aplicação às regras deles (`c9661c9`).
Ordem de deploy: 1.86.1 → 1.86.2 → 1.86.3 → 1.87.0 → 1.88.0.

## Marcos

### M0 — Fundação (semanas 1–3) — CopySync ✅; central 🟡 (S1/S2 no H1, S3 só runbook, S4 ❌; sem deploy); H0 ✅

| Trilha | Entrega |
| --- | --- |
| H | S1, S2, S3 (rede de segurança); estado na tabela da rede acima |
| H0 ✅ | Postgres do CopySync separado do da central na Render: **feito** (informado pelo owner em 2026-11-06; banco próprio há cerca de uma semana, o CopySync não divide mais o Postgres do PulsoSocial). Nasceu vazio com `prisma migrate deploy` e as sessões de teste foram pareadas de novo. Verificado em 2026-11-06 (só leitura): o Postgres do PulsoSocial (`pulsosocial_node_api_46eu`, Oregon) não tem nenhuma das 48 tabelas do CopySync nem migrations dele; a instância só tem esse banco e o `postgres`. Pendente: conferir `connection_limit=5` na `DATABASE_URL` |
| E0 | ✅ **Flush síncrono do auth state no shutdown** (`server.ts:347` chama `flushAllAuthStates()`; `BaileysAuthStatePersistence.ts:326-339`); `connection_limit` por processo; adapters já unificados Baileys. Medição de RAM/CPU com 50/100/200 sessões fica para o gate de M2 (exige o banco dedicado em 0.5c-1g ou acima) |
| B | **Início da service-desk P1.0 + USR-01** (4 + 1 requisitos; design §10 tem 6+ use cases, hook novo, endpoint de reemissão e UI de primeiro acesso: 4–6 semanas, atravessa M0 e M1). Em M0: migration do design §4 (`billingCustomerId`, `suspendedAt`, `passwordHash?`, `passwordSetAt`, `UserInvite`; sem `planSnapshot`), `resolveMembership` em `tenantHook` e `sseAuthHook`, `TenantSuspendedError`, login com `passwordHash` nulo respondendo credenciais inválidas |

Gate: smoke S4 verde no PulsoSocial; API religa após deploy sem 440; `tenantHook` nega tenant `SUSPENDED` com `TENANT_SUSPENDED`.

### M1 — Hub mínimo + CopySync recebendo (semanas 4–7) — CopySync ✅ (B, E1, P); central: H1 ✅ e H2 🟡, em branch local, sem deploy

| Trilha | Entrega |
| --- | --- |
| H1 ✅ local 1.87.0 | `Application` (linha `socialpulse` com id fixo na migration) + `applicationId NOT NULL DEFAULT socialpulse` em `Plan`, `Subscription`, `Payment`, `EmailQueue`, `AbandonedCheckout` (backfill = DEFAULT); FK `NOT VALID` nas grandes + script `validate-application-constraints`; helpers de recorte (`modules/applications/scope.ts`), `resolvePublicApplication`, guard `check:app-scope` no build; slug de plano único por aplicação; `seed-applications.ts`. **1.88.0** (`hub/h1-drop-default`): DROP DEFAULT nas 5 tabelas, release própria, só depois do 1.87.0 estável |
| H2 🟡 local | **Feito**: `hub/h2-schema` com `OutboundEvent`, `IntegrationNonce`, `Application.webhookUrl`/`outboundEnabled` (default `false`) e triggers de `Subscription`/`SubscriptionRenewal`; funções puras isoladas, sem nenhum import fora de teste: assinatura (`h2-t5`), colapso (`h2-t6`), payload (`h2-t7`), retentativa (`h2-t8`), canônica M2M (`h2-t13`). **Falta**: segredo da aplicação (`secretHash`), hook M2M, dispatcher, `OUTBOUND_EVENTS_MODE`, `GET /integrations/subscriptions`, integrar os branches. Plano original: `OutboundEvent` + dispatcher (`Application.outboundEnabled=false` no trigger e `OUTBOUND_EVENTS_MODE=off` no dispatcher no 1º deploy; migrations só `ADD COLUMN` nulo + trigger de default `socialpulse`, backfill por script) + auth M2M + `GET /integrations/subscriptions` |
| B | Fim da service-desk P1.0 + USR-01 (`ProvisionTenantUseCase`, `UpdateTenantStatusUseCase`, `InviteUserUseCase`, `IEmailSender` + Smtp/Noop, tela de primeiro acesso no painel). Depois: migration da integração (`planSlug`, `lastBillingEventSeq`, `TenantEntitlement`, `PlanEntitlementPreset`, `BillingEventReceipt`); módulo `integrations/billing` (plugin sem `authHook`, corpo bruto, HMAC com `timingSafeEqual`, receipt na mesma transação); `ApplyBillingEventUseCase` com a tabela evento→status e ordem por `seq`; `SyncTenantEntitlementsUseCase`; `ReconcileSubscriptionsUseCase` sob lease em tabela (`JobLease`); `sessions` desconecta ao receber `TENANT_SUSPENDED` (bus in-process até E3; Redis depois) |
| E1 | Mídia em S3/R2 (`S3MediaFileStore`) |
| P | Gerador de ofertas (credenciais de afiliado já entregues em 2026-10-22) |

Gate: em staging, compra sandbox na central → tenant provisionado no CopySync → owner entra pelo link → cancelamento → tenant `CANCELLED` e sessões desconectadas. PulsoSocial S2 verde.

### M2 — Primeira venda (semanas 8–9) — bloqueado pela central (deploy H1, H2–H4 incompletos); E2 ✅

| Trilha | Entrega |
| --- | --- |
| H3 🟡 local | **Ofertas na Cakto criadas** (2026-11-06, 6 ofertas mensal/anual; ver "Ofertas do CopySync na Cakto"). **Feito** (`hub/h3a-base`): enum `COPYSYNC_LITE/PRO/MAX` nas chaves de permissão + `seed-application-copysync.ts` com slug único por aplicação. **Falta**: rota `/webhook/app/copysync/cakto`, match de plano pela aplicação da rota, `Application.checkoutUrl`, produtos na Cakto (fora do código). Plano: **Venda pela Cakto** (decisão do owner 2026-11-04; o checkout próprio por aplicação fica para depois da escala, ver seção "Checkout por aplicação"): cadastrar `Application copysync` e planos LITE/PRO/MAX com `applicationId`; produtos do CopySync na Cakto com webhook numa URL própria da aplicação (`/webhook/app/copysync/cakto`, só essa parte do H8 é antecipada; o PulsoSocial segue na rota legada, sem mudança); match de plano filtrado pela aplicação da rota. Sem front de checkout, sem `ALLOWED_ORIGINS` |
| H4 🟡 local | **Feito** (branches irmãos): `EmailSenderConfig.applicationId` único (`h4-t16`); `smtp-transport.ts` único (`h4-t17`), usado por e-mail marketing e fila de campanha, **não** pelo `modules/email/service.ts`; templates base dos tipos do hub + overrides `copysync` (`SET_PASSWORD`, `TEAM_INVITE`, `SESSION_DISCONNECTED`) e loader com `applicationKey` (`h4-overrides`), que nenhum caminho de envio chama; `buildIntegrationEmailVars` sem uso (`h4-t26`). **Falta**: `Application.brand`, `POST /integrations/email/send`, `MULTI_APP_EMAIL_BRAND`, ligar transporter/templates no envio. Plano: E-mail por aplicação com **SMTP e domínio próprios** (H10: `EmailSenderConfig` de aplicação, transporter por aplicação; PulsoSocial segue no transporter atual) + `POST /integrations/email/send` (`SET_PASSWORD`, `TEAM_INVITE`) |
| Infra | **Resend** (decidido 2026-11-03, mesma conta do PulsoSocial): verificar o domínio do CopySync, publicar SPF/DKIM do Resend e DMARC no DNS, criar API key só de envio restrita a esse domínio; pré-requisito de H4 |
| B ❌ | `HubEmailSender` (M2M) como terceiro adapter de `IEmailSender`, `EMAIL_SENDER=hub`; `SET_PASSWORD` com link do `UserInvite`; painel "Assinatura" com link para a página de venda da Cakto (`Application.checkoutUrl`). Hoje o painel usa `/planos/copysync-{plano}-{periodo}` da central (ver Estado) |
| E2 ✅ api 0.59.0 | Migration `add-session-lease` (`ownerWorkerId`, `leaseUntil`, `connectRequestedAt`, `nextAdoptAt`, `adoptFailures`, `shard`); lease com fence local e teardown; CAS em `writeKeys`; helper `markConnectRequested` nas 6 rotas de conexão e limpeza em disconnect/logout/delete/suspensão; `closeAllSockets()` antes do flush no shutdown (deploy sem 440, failover). Readoção no deploy e filtro de lease na mídia órfã ficam para E4/E3 |
| P | Grupos de disparo + horário de postagem |

Gate: venda real do LITE ponta a ponta. `Application.outboundEnabled=true` e `OUTBOUND_EVENTS_MODE=on` só para `copysync`. Postgres do CopySync em 0.5c-1g e medição de RAM/CPU por sessão anotada no doc de escala.

### M3 — Escala real + núcleo do produto (semanas 10–14) — produto ✅; E3/E4 ✅ em código (flags off por default); H5/H6 ❌

| Trilha | Entrega |
| --- | --- |
| E3 ✅ código | `PROCESS_ROLE=http\|worker\|all`, dono por job de boot (tabela §3.3 do doc de escala; `JobLease` já em reconcile e rodízio; disparo e outbox já têm claim próprio), BullMQ `session.connect/disconnect/logout`, `message.send.*`, RPC síncrono para QR/pairing/login Telegram/grupos, Redis pub/sub → WS |
| E4 ✅ código | `WORKER_ADOPTION_ENABLED` (off por default, só Render) + `WORKER_MAX_SESSIONS` (adoção por capacidade, bootstrap com teto), drain no `SIGTERM` (sockets → flush → soltar lease), heartbeat + alerta 80%; N réplicas `worker` como Private Service (doc de escala §3.2, §5.1) |
| P | Disparo em massa; monitoramento com troca de link |
| H5 ❌ | `creditsEnabled` nos hooks (sem efeito para `socialpulse`) |
| H6 ❌ | Admin: seletor de aplicação, CRUD `Application`, replay de eventos |
| B ✅ | Enforcement `PLAN_LIMIT_REACHED` em sessões, grupos monitorados, grupos de disparo ("Planos e limites" do roadmap); worker de envio checa `Tenant.status` |

Gate: 2 workers em produção com failover testado; 1 tenant MAX com 2 números.

### M4 — Diferenciais e endurecimento (a partir da semana 15) — Telegram em código; E5, H7, H8 ❌

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
| Infra (Render / Dokploy) | subir e descer réplicas `worker` manualmente ao alerta de 80%. Autoescala pela API da infra: diferida, fora deste plano (decisão 2026-11-04) |
| Super-admin do CopySync | workers vivos, lease por sessão, sessões por worker, RAM, filas (doc de escala §3) |
| Admin do hub | leitura: tenants e assinaturas por aplicação, receita. Opcional: card "saúde" lendo `GET /integrations/health` do CopySync |

## Ofertas do CopySync na Cakto

| Plano | Período | Oferta na Cakto | URL de pagamento |
| --- | --- | --- | --- |
| LITE | mensal | Afiliados LITE Mensal | https://pay.cakto.com.br/8e4gepk_1291207 |
| LITE | anual | Afiliados LITE Anual | https://pay.cakto.com.br/a92kn9k_1291217 |
| PRO | mensal | Afiliados PRO Mensal | https://pay.cakto.com.br/fronsgu_1291227 |
| PRO | anual | Afiliados PRO Anual | https://pay.cakto.com.br/f34qfgh_1291232 |
| MAX | mensal | Afiliados MAX Mensal | https://pay.cakto.com.br/kzoagvc_1291239 |
| MAX | anual | Afiliados MAX Anual | https://pay.cakto.com.br/97nqcb8_1291245 |

Criadas pelo owner em 2026-11-06. **Não divulgar antes do H3 no ar**: sem a rota `/webhook/app/copysync/cakto`, a Cakto avisaria o webhook legado do PulsoSocial, e a venda viraria plano do PulsoSocial. Pendências:
- seed H3a com os 3 anuais (hoje só `copysync-{lite|pro|max}-mensal`);
- confirmar qual parte do código da URL (antes ou depois do `_`) chega no webhook como identificador, antes de gravar o `externalProductId`;
- webhook das 6 ofertas apontando para a rota da aplicação;
- preço anual;
- slugs do painel (`starter|profissional|business`) × `lite|pro|max`.

## O que bloqueia o quê

```
hotfixes 1.86.1 → 1.86.2 → 1.86.3 ──► H1 1.87.0 ──► (24 h estável) 1.88.0 DROP DEFAULT ──► integrar H2/H3/H4 sobre o H1
S1 (push + CI verde) e S3 (staging) ──► deploy do H1;  H0 ✅ (banco dedicado do CopySync em uso)
H2 (dispatcher + M2M + subscriptions) ──► H3 (venda pela Cakto) ──► primeira venda
H4 (send + brand) ──► B HubEmailSender;  H2 subscriptions ──► B Reconcile
E4 (escala pronta) ──► checkout próprio por aplicação (estudo + fase própria)
H0 ──► E1 ──► E2 ──► E3 ──► E4 ──► E5
H0 (banco dedicado) ──► E1 e testes de carga
service-desk P1.0 + USR-01 (M0–M1) ──► B(M1 receiver) ──► B(M2)        (B depende de H2 só para teste ponta a ponta; desconexão por evento entre processos e reconciliação restrita a worker dependem de E3)
gerador ──► disparo/horário ──► massa ──► monitoramento ──► IA …   (independente de H e E até monitoramento; monitoramento em escala precisa de E5)
```

## Checkout por aplicação (vale para toda aplicação, não só CopySync)

**Adiado (decisão do owner 2026-11-04).** Até a escala do CopySync estar pronta (E4), toda aplicação vende pela Cakto, como o
PulsoSocial já faz. O checkout da central por aplicação (marca, cores, logo e domínio próprios) vira fase própria depois disso e
ainda precisa de estudo. O desenho abaixo é o ponto de partida desse estudo, não compromisso do M2.

Um checkout **por `Application`**, mesmo código e mesmo processo da central. O que é por aplicação é dado:

| Por aplicação | Onde |
| --- | --- |
| Domínio e deploy do front | deploy estático próprio (`conta.copysync.app`, `studio.pulsosocial.app`), `VITE_APPLICATION_KEY` |
| Marca (nome, logo, cores, suporte) | `Application.brand`; `VITE_BRAND_*` no front |
| Planos e permissões | `Plan.applicationId`; `GET /plans?app=` |
| Remetente e templates de e-mail | `EmailSenderConfig.applicationId` (único, uma direção), `templates/<applicationKey>/` |
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
