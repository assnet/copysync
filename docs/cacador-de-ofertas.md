# Caçador de Ofertas

Recurso do produto Afiliados (item 17 do [`produto-roadmap.md`](produto-roadmap.md)): procura sozinho, no catálogo
de comissão do painel de afiliados da **Shein**, os produtos com melhor retorno, pontua (com ou sem IA) e envia só
os melhores para **1 grupo**. Cada caçada salva roda de tempos em tempos. Exclusivo Shein e MAX.
Estado: prévia só super admin; job desligado até o smoke (T20). Plano: `.specs/features/offer-hunter/`.
Regras gerais da Shein (credencial `AT`, endpoints, aviso): [`afiliado-shein.md`](afiliado-shein.md).

## Fluxo

```
OfferHuntSchedulerJob (worker, lease, flag) ─┐
POST /api/offer-hunts/:id/run (manual) ──────┼─▶ RunOfferHuntUseCase
                                             │  1 portões (abaixo) ─ recusa manual = erro HTTP; agendada = pula/pausa
                                             │  2 ISheinCatalogClient: ≤1 categoryRate + ≤3 páginas list/search
                                             │  3 normaliza → HuntCandidate · filtros locais · scoreHuntCandidate
                                             │  4 tira repetidos (offer_hunt_finds, janela repeatAfterDays)
                                             │  5 IA opcional: top 15 → ids + motivo (falha → aiFallback)
                                             │  6 min(topN, saldo) → grava achados sob o teto (atômico)
                                             │  7 REVIEW: PENDING_REVIEW · AUTO: APPROVED → HuntFindDelivery
                                             ▼
HuntFindDelivery: Resolve(riskScope OFFER_HUNTER) → OfferTextComposer → EnqueueOffer(origin HUNTER)
                                             ▼
                                  OfferDispatchWorker existente ─▶ 1 grupo
```

## Portões (ordem fixa, toda execução)

1. `marketplace_shein_enabled` → 2. `offer_hunter_enabled` → 3. credencial Shein `ok` com `AT` (`rejected` pausa
`CREDENTIAL_REJECTED`) → 4. aceite vigente do aviso `OFFER_HUNTER` → 5. saldo do teto > 0 → (AUTO: destino salvo,
senão `OFFER_HUNT_DESTINATION_REQUIRED` 422) → 6. guarda de 24 execuções/dia → só então a Shein. Plano ausente
pausa `PLAN_UNAVAILABLE`; aceite ausente pausa `RISK_NOT_ACCEPTED`. Ausente = bloqueado em toda chave.

## Teto de ofertas garimpadas

- Entitlement numérico `offer_hunter_finds_per_day` (LITE 0 · PRO 0 · MAX 10), lido a cada execução, **`?? 0`**
  (nunca o `null` = ilimitado do gerador). Editável por plano em `/admin/plan-entitlements` (inteiro 0–100, campo
  numérico com salvar explícito, mesma transação/propagação/auditoria das chaves booleanas).
- Conta linha de `offer_hunt_finds` do dia (`startOfDayInZone`): todo achado gravado é um escolhido e conta mesmo se
  dispensado depois. Execução escolhe `min(topN, saldo)` (pede 5, restam 2 → grava 2). Saldo 0 → 429
  `OFFER_HUNT_DAILY_LIMIT` **sem chamar a Shein**. Baixar o teto não apaga achado; só zera o saldo.
- Guarda técnica à parte (constante, não plano): `HUNTER_LIMITS.runsPerDayMax = 24` execuções/dia/tenant → 429
  `OFFER_HUNT_RUN_THROTTLED`. Rajada de cliques: preset `offerHuntRun` (10/min).
- Outros limites em `hunterLimits.ts`: 5 caçadas/tenant, `topN` 3 (máx. 5), repetição 7 dias (1–30), intervalo
  30–1440 min, palavra-chave ≤ 60.

## Pontuação (`scoreHuntCandidate`, pura)

Nota 0–100 = soma exata dos fatores (visíveis na tela). Pesos em `HUNT_SCORE_WEIGHTS` (única fonte):

| Grupo | Fatores (pontos) |
|---|---|
| Comissão 40 | `commission` 40: valor esperado 70% cliente novo + 30% retorno, log com teto R$ 30 |
| Prova social 30 | `sales` 12 · `rating` 8 (3,5→5,0) · `reviews` 6 · `rank` 4 (1º = máx., 0 no 101º) |
| Preço 20 | `discount` 12 (até 70%) · `priceBand` 8 (R$ 20–150 = máx.) |
| Urgência 10 | `extraCommission` 6 (teto R$ 10) · `endingSoon` 4 (≤ 7 dias) |

`sort` da Shein é só dica; a ordem que vale é esta nota. Filtros locais (`matchHuntFilters`) garantem preço,
desconto, comissão %/R$, nota, vendas, avaliações, "só com extra" e "termina em até N dias".

## IA (opcional por caçada)

- Só via `IAiTextGenerator`, `purpose: 'offer_hunt_ranking'`, 1 chamada/execução, conta em `ai_requests_per_day`.
  Sem provedor: opção aparece desligada com explicação.
- Entrada: até 15 itens com id curto (`c1..cN`), título sanitizado (≤ 80), números. **Nunca** `AT`, `goodsId`,
  link, id de afiliado ou dado do tenant. Título é dado não confiável: delimitado, system prompt manda ignorar
  instruções nele.
- Saída exigida `[{ id, reason }]`: ids ⊂ enviados, sem repetição, `reason` texto puro ≤ 140. Qualquer desvio ou
  erro do provedor → ranking determinístico e execução `aiFallback`. Prompt/validação: `huntRankingPrompt.ts`.

## Entrega

- `HuntFindDelivery` (aprovação no REVIEW ou AUTO): `ResolveAffiliateProductUseCase` com `riskScope: 'OFFER_HUNTER'`
  (link **sempre do tenant**) → `OfferTextComposer` do gerador (público STANDARD) → `EnqueueOfferUseCase` com
  `origin: 'HUNTER'` e `sourceKey: 'hunt:<findId>'` (idempotência: queda entre enfileirar e gravar `offerId` não
  reenvia). O Enqueue cria a `Offer`; o caçador nunca cria à parte. Espaçamento = intervalo do gerador.
- Decidível: `PENDING_REVIEW`, `FAILED` e `APPROVED` sem `offerId` parado há > 15 min (`HUNT_FIND_STALE_APPROVED_MS`,
  queda entre aprovar e entregar), retomado por CAS (`reclaimStaleApproved`): dois cliques entregam uma vez. Depois do
  enqueue a foto nunca é descartada; falha ao marcar SENT tenta de novo com o `offerId`.
- Repetição dentro do lock do teto (`insertWithinDailyLimit` com `repeatSince`): duas execuções simultâneas não
  escolhem o mesmo produto. Janela de horário vazia (ex.: início 1440 e fim 0) é recusada.
- Imagem: `imageMode` padrão `LINK_PREVIEW`, foto vinda do Resolve e gravada no storage (`storeImage`), como no
  gerador ([`mensagens-previa-de-link.md`](mensagens-previa-de-link.md)). `imageUrl` do achado (`mainImage`, só
  https `ltwebstatic.com`) é **só exibição no painel**; nunca vai à mensagem.
- Oferta `HUNTER` fica **fora** de `offer_generations_per_day` (`countCreatedSince`/`createWithinDailyLimit`
  excluem só `HUNTER`; `MONITORING` e o resto seguem contando).
- Destino único por tenant (`offer_hunter_settings`: sessão + conversa). Entra na união de `broadcast_groups`
  (gerador ∪ monitoramento ∪ caçador, uso `hunter` no `IBroadcastGroupUsageReader`); grupo já usado não consome de
  novo ([`grupos-de-disparo-e-horario.md`](grupos-de-disparo-e-horario.md)).

## Aceite de risco próprio

- `marketplace_risk_acceptances.scope` (`AFFILIATE_LINK` padrão · `OFFER_HUNTER`), único por (tenant, provider,
  scope, versão). Versão `OFFER_HUNTER_RISK_NOTICE_VERSION.SHEIN = '2026-11-12'` (`marketplaceRiskNotice.ts`); o aviso
  Shein atual (`2026-11-10`) não mudou.
- Texto autônomo: busca automática recorrente, link automático pela sessão, envio automático, cláusulas 3.3.2 e
  Anexo 3 §6, encerramento da conta/perda de comissão, risco do titular. **Um só aceite cobre todo o fluxo do
  caçador**; gerador, vitrine, story e monitoramento seguem no escopo padrão.
- Aceitam o `ADMIN` do tenant **e o super admin** (decisão do dono 2026-11-12: na prévia só ele vê a tela). Aceite do
  super admin fica com o id dele e `bySuperAdmin: true` na auditoria; o diálogo avisa que vale para a conta inteira.
  Exceção só do escopo `OFFER_HUNTER`: no aviso Shein do link (`AFFILIATE_LINK`) o super admin segue recusado (403).
  A rota de aceite não tem portão de audiência. Só inclusão. Caixa de aceite nunca persistida.

## Job (`OfferHuntSchedulerJob`)

- `offerHunterScheduler` em `processJobs.ts`, papel `worker`/`all` (nunca `http`), flag `OFFER_HUNTER_JOB_ENABLED`
  (padrão `false`, ligada **só na Render**). `JobLease` `offer-hunter-scheduler`, tique 60 s.
- Reivindica por CAS (`claimToken`/`claimedUntil` 15 min): até **3 por tique, 1 por tenant**, atraso 1–5 s entre
  tenants. Sem estado em memória.
- Fora da janela/dia (`weekdaysMask` + minutos, `postingWindow.ts`): só recalcula `nextRunAt`. Saldo zerado ou
  guarda de 24 → próxima no **dia seguinte**, sem chamar a Shein. 3 falhas seguidas de fonte → pausa
  `SOURCE_UNAVAILABLE`; `goodsList` nulo com `code "0"` conta como fonte indisponível.

## Audiência

`OFFER_HUNTER_AUDIENCE` = `super_admin` (padrão: só super admin, pelo token) | `entitled` (membro de tenant com
`offer_hunter_enabled === true`). Portão `offerHunterAudienceHook` em todas as rotas, menos `/access` e o aceite.
Abrir ao público = **trocar a env**, sem deploy. O job roda toda caçada ativa (na prévia só existem as do super admin).

## Rotas (`/api/offer-hunts`, `authHook` + tenant + audiência)

| Rota | Uso |
|---|---|
| `GET /access` | `{ visible }`, só `authHook`, nunca 403 |
| `GET /usage` | "X de N hoje" + execuções do dia |
| `GET /options` | categorias (Shein só após plano+caçador+aceite+credencial), ordenações, faixas, predefinições, portões |
| `GET`/`PUT /settings` | grupo de destino |
| `GET /` · `POST /` · `GET`/`PUT`/`DELETE /:id` | CRUD (máx. 5 → 409 `OFFER_HUNT_LIMIT_REACHED`) |
| `POST /:id/pause` · `/:id/resume` · `/:id/run` | pausa, retomada, "Testar agora" |
| `GET /:id/runs` · `/:id/finds` | histórico com cursor assinado |
| `POST /finds/:findId/approve` · `/dismiss` | aprovar (envia) ou dispensar |

Aceite: `POST /api/integrations/affiliate-credentials/:provider/risk-acceptance` com `scope: 'OFFER_HUNTER'`. Erros em
`OfferHuntErrors.ts` (inclui `OFFER_HUNT_SOURCE_UNAVAILABLE` 503).

## Painel (`app/src/features/offerHunter/`)

- Rotas `/offer-hunter` e `/offer-hunter/:huntId` sob `OfferHunterRoute`; menu: filho de Afiliados só com
  `offerHunterVisible` (`useOfferHunterAccess` → `GET /access`). Sem `superAdminOnly`/`SuperAdminRoute`; selo MAX e rótulo curto "Caçador" no menu (nome completo + selo não cabe).
- Tela inicial (uso do dia vindo da API, destino, cartões, painel de portões, alerta de pausa), assistente em 3
  passos (O que caçar → Refino → Quando e onde) com "Testar agora", detalhe com achados e execuções.
- Persistência (`tab`): `offerHunter.wizard*` (limpo ao salvar), `offerHunter.destinationDraft`,
  `offerHunter.destinationPickerOpen`, `offerHunter.detail.<id>`.
- Privacidade: tela `offerHunter`, flags `sessionName`, `groupNames`, `groupAvatars`, `productImages`, `productText`.
- Textos em `strings.ts` (aviso espelhado da API, teste de hash próprio); ícones via `AppIcon`, sem brilhinho de IA.

## Observado × garantido

Sonda de 2026-11-12 no Mac (IP residencial) e no Shell da Render (datacenter): `seller/activity` responde com
`token`, `siteuid`, `language`, `mi`, `channel`, sem header anti-bot. Observado, **não contrato**:
- `pageSize` ignorado (sempre 10); `total` até 1000.
- `sort` **não confiável** (12 devolveu o mesmo que 0).
- `commRate`: só 4 = ">15%" confirmado; 1/2/3/5 (<5%, 5–10%, 10–15%, sem filtro) **inferidos**. O filtro local de
  comissão mínima é a garantia.
Garantido pelo código: headers fixos, `redirect: 'manual'`, timeout 8 s, corpo ≤ 256 KiB, erros traduzidos, imagem
só https `ltwebstatic.com`, única entrada livre = palavra-chave sanitizada. Se a Shein exigir anti-bot ou barrar o
IP, o recurso para e volta ao dono.

## Migrations

`20261114100000_add_offer_hunter_entitlements` (backfill `ON CONFLICT DO NOTHING`) ·
`20261114100100_add_offer_origin_hunter` · `20261114100200_create_offer_hunter_tables` (`offer_hunts`,
`offer_hunt_runs`, `offer_hunt_finds`, `offer_hunter_settings`, todas com `tenantId`) ·
`20261114100300_add_risk_acceptance_scope` · `20261114100400_add_offer_hunt_find_image`. Só rodam na Render.

## O que não fazer

- Forjar `armortoken`/`smdeviceid`/`x-oest`/`anti-in`, headless ou insistir em desafio anti-bot.
- Ler página de produto Shein (a URL `product-p-<id>` só alimenta o Resolve) ou endpoint fora da lista fechada.
- Guardar catálogo em tabela: só o achado escolhido é persistido.
- Contar `HUNTER` em `offer_generations_per_day` ou tratar teto ausente como ilimitado.
- Liberar plano por código ou env: entitlement só em `/admin/plan-entitlements`.
- Persistir a caixa de aceite; mudar texto do aviso sem subir a versão na API **e** no app.
- Chamar a Shein no `GET /options` (ou em qualquer GET) sem os portões; chamar antes de conferir o saldo.
- Mandar `AT`, link, `goodsId` ou dado do tenant à IA, ou logar `AT`/link/título.
- Criar `Offer` fora do `EnqueueOfferUseCase`, devolver link colado ou usar `imageUrl` do achado na mensagem.
- Mais de 1 grupo, `superAdminOnly` no menu, ou ligar o job fora da Render.

## Smoke manual (T20, pendente do dono)

Pré: ADMIN do tenant de teste aceita o aviso do caçador. Após deploy, flag do job ligada só na Render: caçada
manual, agendada, `AUTO` em grupo de teste, 11ª oferta bloqueada pelo teto de 10, mudança do teto no admin
refletindo sem deploy, pausa ao deslogar da Shein.

## Mapa de arquivos (`api/src/modules/campaigns/` salvo indicação)

| Camada | Arquivos |
|---|---|
| Domínio | `domain/hunter/{HuntCandidate,OfferHunt}.ts`; `domain/services/hunter/{scoreHuntCandidate,matchHuntFilters,parseSalesBucket,huntSchedule,huntPresets,huntRankingPrompt,hunterLimits,validateHuntDefinition}.ts`; `domain/contracts/{ISheinCatalogClient,IBroadcastGroupUsageReader}.ts`, `domain/contracts/hunter/*` |
| Aplicação | `application/use-cases/hunter/*` (`RunOfferHuntUseCase`, CRUD, histórico, info, decisão, destino); `application/services/hunter/{HuntFindDelivery,AiHuntCandidateRanker,offerHunterAudience}.ts` |
| Infra | `infrastructure/http/SheinCatalogClient.ts`; `infrastructure/repositories/hunter/*`; `infrastructure/mappers/PrismaOfferHuntMapper.ts`; `infrastructure/jobs/OfferHuntSchedulerJob.ts`; `infrastructure/{hunterContainer,offerHunterSchedulerStart}.ts` |
| HTTP | `presentation/routes/offerHunt.routes.ts`, `presentation/schemas/offerHunt.schema.ts`, `presentation/presenters/OfferHuntPresenter.ts`, `presentation/hooks/offerHunterAudienceHook.ts`; `shared/errors/internal/OfferHuntErrors.ts` |
| Aceite | `integrations/domain/{enums/MarketplaceRiskScope,services/marketplaceRiskNotice}.ts`, `AcceptMarketplaceRiskUseCase.ts`, `PrismaMarketplaceRiskAcceptanceRepository.ts` |
| Planos | `tenants/domain/{entitlementKeys,planPresets,adminEditableEntitlements}.ts`, `SetPlanEntitlementUseCase.ts`, `planEntitlementAdmin.routes.ts` |
| Painel | `app/src/features/offerHunter/**`, `app/src/pages/OfferHunter{,Detail}Page.tsx`, `app/src/services/offerHunter.service.ts`, `features/navigation/model.ts`, `pages/admin/AdminPlanEntitlementsPage.tsx` |
