# Acesso por produto — Especificação

**Status**: Aprovado pelo dono em 2026-11-11 (execução aguarda o comando de início) · api 0.99.0 → 0.100.0 · app 0.122.1 → 0.123.0 (conferir no início da execução; usar a próxima minor)
**Roadmap**: `docs/produto-roadmap.md:60-67` ("Plano, permissões e configurações por produto: etapa futura"; "não existe plano global").
**Pré-requisito de**: `.specs/features/saver/` (o Saver não pode ser vendido separado sem isto).

## Problema

O CopySync tem um único plano por tenant (`Tenant.planSlug`, só `COPYSYNC_LITE|PRO|MAX`) e nenhum conceito de
produto. Quem comprar apenas o Saver ganharia hoje, de graça, quase todo o produto de Afiliados: as rotas não têm
gate de produto e limite ausente vale como ilimitado. E uma compra de plano que não seja `copysync-{lite|pro|max}`
nem chega a criar a conta (422). Falta dizer, por tenant, **quais produtos ele tem**, e fazer API, billing e painel
respeitarem isso sem mudar nada para quem já é cliente.

## O que foi verificado

| Fato | Evidência |
| --- | --- |
| Um plano por tenant; slug fora de `PLAN_SLUGS` resolve `null` | `api/src/modules/tenants/domain/planPresets.ts:3,17-25` |
| Cliente novo com plano desconhecido: 422 `invalid_plan_slug`, evento vira DEAD na central | `ApplyBillingEventUseCase.ts:246` |
| Ativação sempre reativa o tenant (`unblock`), com os entitlements antigos | `ApplyBillingEventUseCase.ts:410-417` |
| Evento de corte: assinatura de plano desconhecido conta como "dá acesso" (`KEPT_ACTIVE`) | `subscriptionReconcile.ts:114-130`; `ApplyBillingEventUseCase.ts:419-428` |
| Sync de plano só faz upsert das chaves do preset; nunca remove | `integrations/billing/syncPlanEntitlements.ts:18-26` |
| Não existe hook de entitlement nem de produto; só `authHook`, `tenantHook`, `tenantAnyStatusHook`, `superAdminHook`, `sseAuthHook`, `optionalAuthHook`, `resolveMembership`; portão por rota `offerHunterAudienceHook` (`campaigns/presentation/hooks/`) | `api/src/shared/http/hooks/` |
| Rotas de sessões, chat, ofertas, grupos, monitoramento, IA, rodízio: só `[authHook, tenantHook]` | `api/src/app/routes.ts:99-173` |
| Limite numérico ausente = ilimitado; `mention_all`/`ai_rewrite` ausentes = liberados | `CreateSessionUseCase.ts:43-48`; `subscriptionLimits.ts:43-46` |
| `/me` devolve só `isSuperAdmin` e tenants (id, nome, slug, papel, status) | `users/presentation/routes/me.routes.ts:65-78` |
| Menu filtra só por super admin; rotas do painel sem guard de produto; início = `/dashboard` | `app/src/features/navigation/model.ts:81-82`; `AppRoutes.tsx:86-141` |
| Painel e assinatura fixos em `lite/pro/max` | `SubscriptionPresenter.ts:12,19`; `features/plans/catalog.ts:11` |
| O payload da central não traz produto; só `planSlug` e `permissions[]` (nível; permissão reconhecida vence o slug, `planPresets.ts:40-50`) | `billing.routes.ts:75-111`; `docs/arquitetura-central-billing.md:132,147-157` |

## Termos

- **Produto**: unidade vendida com planos próprios. Chaves: `AFFILIATES`, `CHAT`, `SAVER`.
- **Produto legado**: `AFFILIATES` e `CHAT`. Existem antes desta feature; tenant sem registro explícito continua com eles.
  `CHAT` ainda não é vendido à parte (não há plano de Chat): nesta versão o acesso a `CHAT` **acompanha** o de
  `AFFILIATES` e nenhuma linha `CHAT` é gravada. A chave existe para classificar rotas e separar no futuro.
- **Produto novo**: `SAVER` (e os próximos). Só existe para o tenant com registro explícito ativo.
- **Recurso do tenant**: não pertence a produto e nunca é bloqueado por produto: sessões, usuários, assinatura, `/me`, uploads.

## Alternativas avaliadas

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| A. Chave booleana por produto em `tenant_entitlements` (`affiliates_enabled`…) | ❌ | Sem plano nem vencimento por produto; cancelar um produto e manter outro fica sem lugar para morar; o sync nunca remove chave |
| **B. Tabela `tenant_products` + regra "produto legado sem linha = ativo"** | ✅ | Tenants atuais não ganham linha nenhuma: comportamento idêntico por construção; produto novo é opt-in explícito |
| C. Tabela com backfill de todos os tenants | ❌ | Escrita em massa em produção; tenant criado na janela do deploy nasce sem linha e fica travado; todo caminho que reativa tenant passaria a ter de gravar linha |
| D. Um tenant por produto | ❌ | Contraria o roadmap ("a mesma sessão serve mais de um produto"); duplica login, sessão e cobrança |
| E. Trocar `Tenant.planSlug` por lista de planos | ❌ | Mexe em todo consumidor de `planSlug` (webhook, reconciliação, assinatura, presets, testes) |
| F. Aplicação separada na central (`saver`) | ❌ | Segundo webhook, segredo e checkout; cliente com dois produtos viraria dois clientes e dois tenants |
| G. Esconder só no painel | ❌ | A API continua aberta a quem chamar direto |

Onde aplicar o gate na API:

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| `preHandler` em cada arquivo de rota | ❌ | 10+ arquivos tocados; módulo novo esquece |
| Dentro de `resolveMembership` | ❌ | Não sabe a que produto a rota pertence |
| **Classificação central em `routes.ts` + hook `onRoute` que anexa o gate depois do `tenantHook`** | ✅ | Um arquivo; teste falha se um módulo for registrado sem classificação |

**Decisão**: B, com gate central, atrás de `PRODUCT_ACCESS_GATE_MODE=off|log|enforce` (padrão `off`).

O modo é ensaio de implantação, não chave de venda: em `off`/`log` nada é bloqueado, então um tenant só-Saver
enxergaria Afiliados. Por isso **nenhum produto novo é concedido ou vendido antes de `enforce`**, e depois da primeira
venda sair de `enforce` é medida de emergência com vazamento declarado. Erro pontual se corrige pela concessão manual
(PROD-21), não desligando o gate.

## Objetivos

- [ ] Tenant existente, sem linha em `tenant_products`, se comporta exatamente como hoje com o gate em qualquer modo.
- [ ] Tenant só-Saver recebe 403 `PRODUCT_UNAVAILABLE` em toda rota de Afiliados e Chat e não vê essas telas.
- [ ] Compra de plano Saver cria ou atualiza a conta sem tocar plano, vencimento nem entitlements de Afiliados.
- [ ] Cancelar um produto mantém o outro funcionando.
- [ ] Antes da primeira venda de produto novo, reversão em um passo: `PRODUCT_ACCESS_GATE_MODE=off`. Depois dela, correção por tenant via concessão manual.

## Fora de escopo (v1)

| Item | Motivo |
| --- | --- |
| Permissão por usuário dentro do produto (RBAC granular) | Hoje só existem papéis; a matriz por papel do Saver fica na feature `saver` |
| Cadastro dos planos Saver na central e ofertas na Cakto | Repositório `pulsosocial_api` e painel da Cakto; listado como dependência externa |
| Remover entitlements órfãos de planos antigos | O gate de produto já impede o uso; limpeza é outra tarefa |
| Preço, checkout próprio, cálculo de cobrança | Proibido no CopySync (`docs/arquitetura-central-billing.md:286`) |
| Tirar o chat de `SuperAdminRoute` no painel | Decisão de produto separada |

---

## Histórias

### P1: Estado de produto por tenant ⭐ MVP

**História**: como plataforma, quero saber quais produtos cada tenant tem, para liberar só o que foi comprado.

1. **PROD-01** WHEN a migration roda THEN o sistema SHALL criar `tenant_products` (tenant, produto, status `ACTIVE|INACTIVE`, plano, vencimento, origem `BILLING|ADMIN`, `inactiveSince`) com unicidade por (tenant, produto) e **nenhuma** linha inserida.
2. **PROD-02** WHEN um tenant não tem linha para um produto legado THEN o sistema SHALL tratá-lo como ativo; WHEN não tem linha para um produto novo THEN SHALL tratá-lo como inativo; WHEN a linha existe THEN o status dela decide; o acesso a `CHAT` SHALL ser sempre o de `AFFILIATES`.
3. **PROD-03** WHEN código de aplicação precisa saber o acesso THEN SHALL usar a porta `IProductAccessReader` (`has`, `list`), com cache curto por processo (padrão do `CachedChatEntitlementGate`, 45 s).

**Teste independente**: função pura `resolveProductAccess` com tabela de casos; repositório em Postgres descartável.

### P1: Gate de produto na API ⭐ MVP

**História**: como dono, quero que rota de um produto recuse tenant sem esse produto.

4. **PROD-04** WHEN `PRODUCT_ACCESS_GATE_MODE=off` THEN o sistema SHALL não consultar `tenant_products` nas rotas legadas e responder como hoje; WHEN um produto novo é concedido ou provisionado com o modo diferente de `enforce` THEN SHALL registrar log de erro (alerta de vazamento).
5. **PROD-05** WHEN o modo é `enforce` e o tenant não tem o produto da rota THEN SHALL responder 403 `PRODUCT_UNAVAILABLE` com `meta.product`; o gate roda logo após `tenantHook`, antes de portões por rota (`offerHunterAudienceHook`).
6. **PROD-06** WHEN o modo é `log` THEN SHALL registrar `would_block` (tenantId, produto, rota; nunca dado pessoal) e deixar a requisição seguir.
7. **PROD-07** WHEN a rota é recurso do tenant (sessões, usuários, assinatura, `/me`, uploads, auth, admin, webhooks, públicas) THEN SHALL nunca aplicar gate de produto.
8. **PROD-08** WHEN um módulo de rota é registrado sem classificação (produto ou "do tenant") THEN o teste de classificação SHALL falhar.
9. **PROD-09** WHEN o usuário é super admin THEN o gate SHALL deixar passar (suporte).
10. **PROD-10** WHEN a conexão é WebSocket/SSE de um produto THEN SHALL aplicar a mesma regra na abertura.

**Teste independente**: `fastify.inject` em rota de afiliado com tenant só-Saver nos três modos.

### P1: Cobrança por produto ⭐ MVP

**História**: como cliente, quero comprar só o Saver, ou somar o Saver ao que já tenho, sem que um mexa no outro.

11. **PROD-11** WHEN a central envia `planSlug` e `permissions` THEN `resolvePlan(planSlug, permissions)` SHALL devolver produto e plano; Afiliados SHALL resolver por `resolveEffectivePlanSlug` (permissão vence slug) e os slugs atuais (`COPYSYNC_*`, `copysync-{lite|pro|max}-{mensal|anual}`, ofertas DEV) SHALL resolver exatamente como hoje, no produto `AFFILIATES`.
12. **PROD-12** WHEN chega `subscription.activated` de plano Saver para cliente desconhecido THEN SHALL provisionar o tenant com `SAVER` ativo, `AFFILIATES` inativo, `Tenant.planSlug` nulo e os entitlements do preset Saver.
13. **PROD-13** WHEN chega ativação/renovação/atualização de plano Saver para tenant existente THEN SHALL gravar `SAVER` ativo com plano e vencimento e SHALL não alterar `Tenant.planSlug`, `Tenant.subscriptionExpiresAt` nem entitlements de Afiliados; só ativação e renovação reativam o tenant (atualização nunca muda status, como hoje).
14. **PROD-14** WHEN a ativação de produto novo vai reativar um tenant que não está `ACTIVE` e não tem linha de `AFFILIATES` THEN SHALL consultar as assinaturas na central antes da transação (mesmo cliente dos eventos de corte; central fora = 503 sem recibo) e SHALL gravar `AFFILIATES` inativo **somente se** nenhuma assinatura de Afiliados **nem de plano desconhecido** dá acesso. Vale também para tenant com `adminBlockedAt` (a linha reflete a cobrança; o status segue bloqueado).
15. **PROD-15** WHEN chega evento de corte THEN SHALL decidir por produto pela união das assinaturas: tenant fica `ACTIVE` se algum produto ou plano desconhecido dá acesso. `AFFILIATES` SHALL ficar inativo **somente quando** outro produto conhecido dá acesso **e** nenhuma assinatura de Afiliados nem de plano desconhecido dá. Produto novo sem assinatura que dê acesso SHALL ficar inativo.
16. **PROD-16** WHEN nenhum produto dá acesso THEN SHALL suspender/cancelar o tenant como hoje, SHALL não criar linha de produto legado e SHALL marcar como inativas (com `inactiveSince`) as linhas de produto novo que existirem.
17. **PROD-17** WHEN a reconciliação horária roda THEN SHALL aplicar a mesma decisão por produto; para tenant sem assinatura Saver a decisão SHALL ser idêntica à de hoje, inclusive `unknown_plan` (nenhuma escrita).
18. **PROD-18** WHEN um plano de produto novo é sincronizado THEN SHALL gravar só as chaves próprias do produto; as chaves compartilhadas (`whatsapp_sessions`, `telegram_sessions`) SHALL ser escritas apenas pela regra de união: maior valor entre os presets dos produtos ativos (`null` = ilimitado vence). WHEN `AFFILIATES` está ativo sem `Tenant.planSlug` (tenant legado sem limites) THEN SHALL não tocar essas chaves.
19. **PROD-19** WHEN o tenant tem `adminBlockedAt` THEN o status do tenant SHALL continuar intocado (regra atual), com as linhas de produto atualizadas.
28. **PROD-28** WHEN `AFFILIATES` está inativo e o tenant segue ativo por outro produto THEN a reconciliação SHALL não tratá-lo como "Afiliados vencido" na fila de prioridade.

**Teste independente**: testes de caracterização do webhook e da reconciliação gravados antes da mudança passam sem alteração depois dela.

### P1: Segundo plano e páginas públicas ⭐ MVP

20. **PROD-20** WHEN `AFFILIATES` está inativo e o tenant segue ativo (modo `enforce`) THEN envio de ofertas, captura de monitoramento, rodízio público, vitrine pública, sync de membros do rodízio, **ingestão do chat (listeners)** e **rotas da extensão autenticadas por cookie** (que não passam pelo `tenantHook`) SHALL tratar o tenant como indisponível.

### P1: Concessão manual ⭐ MVP

21. **PROD-21** WHEN o super admin liga/desliga um produto para um tenant THEN SHALL gravar a linha com origem `ADMIN`, sincronizar o preset e registrar `AuditLog` (`TENANT_PRODUCT_CHANGED`); ligar produto novo SHALL exigir o plano (sem plano os limites seriam zero).
22. **PROD-22** WHEN a linha tem origem `ADMIN` THEN a reconciliação SHALL não desativá-la por falta de assinatura na central.

### P1: Painel ciente de produto ⭐ MVP

23. **PROD-23** WHEN o painel carrega os tenants do usuário (`GET /tenants`, fonte única do `TenantContext`: o login só chama `loadTenants()`; o painel não chama `/me`) THEN cada tenant SHALL trazer `products` (lista de chaves com acesso); campo aditivo, também exposto em `/me`.
24. **PROD-24** WHEN o tenant não tem um produto disponível THEN o menu SHALL mostrar o produto com cadeado e um único destino: a vitrine de planos dele.
25. **PROD-25** WHEN o usuário abre rota de produto sem acesso (URL direta) ou recebe 403 `PRODUCT_UNAVAILABLE` THEN o painel SHALL levar à vitrine do produto; WHEN a lista de tenants ainda está carregando THEN SHALL mostrar carregamento, nunca presumir produto.
26. **PROD-26** WHEN o tenant não tem `AFFILIATES` THEN a rota inicial SHALL ser a do primeiro produto com acesso **que já tenha tela** (senão Assinatura), o dashboard SHALL não mostrar o aviso da extensão, e todo redirecionamento fixo para `/dashboard` ou para a vitrine de Afiliados SHALL passar pela mesma resolução.
29. **PROD-29** WHEN o tenant não tem `AFFILIATES` THEN as telas de configuração que pertencem a Afiliados (`/settings/ai`, `/settings/extension`) SHALL sair do menu e ficar sob o mesmo guard de produto.
27. **PROD-27** WHEN o usuário abre Assinatura THEN SHALL ver um cartão por produto ativo (plano, vencimento, limites só daquele produto) e CTA para a vitrine certa; `GET /subscription` ganha `products[]` aditivo.

---

## Casos de borda

- WHEN a consulta de produto falha (banco) THEN o gate SHALL negar em `enforce` com erro 503 genérico, nunca liberar produto novo; em `log`/`off` segue.
- WHEN `tenant_products` tem `AFFILIATES` inativo e chega ativação de plano `COPYSYNC_*` THEN `AFFILIATES` SHALL voltar a ativo.
- WHEN o cache diz "ativo" e o produto acabou de ser cortado THEN o atraso máximo SHALL ser o TTL do cache (45 s).
- WHEN o tenant troca de tenant ativo no painel THEN menu e guards SHALL recalcular com os produtos do novo tenant.
- WHEN o super admin provisiona tenant pelo painel THEN nada muda (sem linha = legado).

## Rastreabilidade

| Requisitos | História | Tasks |
| --- | --- | --- |
| PROD-01..03 | Estado de produto | T2–T4 |
| PROD-04..10 | Gate na API | T5–T7 |
| PROD-11..19, 28 | Cobrança por produto | T1, T2, T9–T12 |
| PROD-20 | Segundo plano | T13–T15 |
| PROD-21..22 | Concessão manual | T16, T12 |
| PROD-23..27, 29 | Painel | T8, T17–T22 |

**Cobertura**: 29 requisitos, 29 mapeados.

## Revisão adversarial (2026-11-10)

Plano confrontado com o código por um revisor independente; 16 achados incorporados. Os três críticos, todos na
cobrança: assinatura de plano desconhecido desligaria Afiliados de cliente atual (PROD-15/17); o preset Saver
rebaixaria para 1 sessão o tenant legado ilimitado (PROD-18); tenant bloqueado pelo super admin que paga Afiliados
ganharia Afiliados inativo (PROD-14). Os demais estão nos requisitos e tasks marcados com "(revisão)".

## Critérios de pronto

- [ ] `pnpm typecheck && pnpm test` verdes em `api/` e `app/`.
- [ ] Testes de caracterização (T1) inalterados e verdes depois de T9–T13.
- [ ] Migration aplicada só em Postgres descartável; `integration-db` verde para o repositório novo.
- [ ] Modo `log` em produção por no mínimo 48 h com **zero** `would_block` para tenants existentes antes de `enforce`.
- [ ] Smoke com agent-browser: tenant legado (tudo igual), tenant só-Saver (só Saver + recursos do tenant), tenant com os dois.
- [ ] `docs/acesso-por-produto.md` novo; `AGENTS.md`, `docs/arquitetura-central-billing.md`, `docs/navegacao-produtos.md`, `docs/assinatura.md`, `docs/produto-roadmap.md` e `api/CHANGELOG.md` atualizados.
