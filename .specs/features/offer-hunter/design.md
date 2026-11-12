# Caçador de Ofertas (Shein) — design

## 1. Observado na sonda de 2026-11-12

Feita no Mac do dono (IP residencial), com cópia do perfil do Chrome logado na Shein. Tudo abaixo é **observado,
não contrato** (endpoints internos de `m.shein.com/br/affiliate`).

| Chamada (POST, base `m.shein.com/br/affiliate/api/seller/activity`) | Corpo | Resposta |
|---|---|---|
| `/category` | `{}` | 9 categorias (`name`, `cateId`, `did`) + `sortTypeList [0,7,9,10,11,12]` |
| `/categoryRate` | `{ commRate }` | um `did` próprio da faixa de comissão (`commRate 4` = ">15%"; demais a mapear) |
| `/goods/list` | `{ pageNum, pageSize, sort, materialInfoInfo: { name, cateId, did, contextParam }, randomShow }` | `goodsList`, `total` (teto 1000), `hasNextPage`; devolve 10 por página mesmo pedindo 20 |
| `/goods/search` | o mesmo + `searchKey` | idem |
| `/goods/detail` | `{ goodsId, skc, activityId, playId: 5, uid, language }` | item + `shareLink` |

Ordenação: `0` recomendado · `7` mais votado · `9` novos · `10` preço ↑ · `11` preço ↓ · `12` mais vendidos.
Categorias: Women Apparel 4436 · Kids 2031 · Beauty & Health 1864 · Baby 3224 · Sports & Outdoor 3195 ·
Cell Phones & Accessories 2274 · Electronics 2273 · Automotive 3657.

Campos úteis por item: `goodsId`, `skcCode`, `goodsName`, `mainImage`, `salesPrice`, `retailPrice`, `discount`,
`percentPlatformCommission` + `commission` (cliente novo), `percentPlatformCommissionOfOld` + `commissionOfOld`
(cliente que retorna), `extraCommission`, `commissionAddExtra`, `spuSales` ("300+"), `commentNum` ("1000+"),
`commentRankAverage`, `rank`, `categoryId`, `activityId`, `sellGoodsEndTime`, `storeCode`. `oneLink` vem `null` na
lista: o link nasce depois, por produto.

**Triagem fora do navegador (curl do Mac, IP residencial, 2026-11-12).** A página envia `token`, `siteuid`,
`language`, `mi`, `channel` e também os headers anti-bot `armortoken`, `smdeviceid`, `x-oest` (e `anti-in` em
parte das chamadas). Resultado sem nenhum header anti-bot e com o User-Agent padrão do curl:

| Headers | Resultado |
|---|---|
| `token` + `siteuid` | `/category` ok; `/goods/list` 200 `code "0"` com **`goodsList: null`** |
| `token` + `siteuid` + `language: pt-br` + `mi: <memberId>` + `channel: 1` | **10 itens**, `total 1000`, em 8 chamadas seguidas (lista, página 2, categoria, busca, 5 faixas) |

- Página 2 não repete item da página 1. `pageSize` é ignorado: sempre 10.
- Resposta ≈ 30–34 KB por página: o limite de 256 KiB do `SheinAffiliateClient` basta.
- Categoria (`cateId 1864`) muda o resultado; busca `vestido` devolveu 10 de 10 com o termo, `total 5961`.
- **`sort` não é confiável por esse caminho**: `sort: 12` devolveu os mesmos 10 produtos, na mesma ordem, que `sort: 0` (só o horário do servidor mudou).
  Tratar como dica; a ordem que vale é a nossa pontuação local.
- Faixas: `commRate` 1, 2, 3, 4, 5 devolvem `did` distintos. Só `4` = ">15%" foi confirmado na tela; 1–3 = "<5%",
  "5%–10%", "10%–15%" e 5 = sem filtro são **inferidos pela ordem**. O filtro local de comissão mínima é a
  garantia; a faixa só reduz o que vem.

**Portão T0a aprovado (Shell da API na Render, IP de datacenter, 2026-11-12).** `fetch` do Node com os mesmos 5
headers, sem anti-bot e sem `User-Agent` definido por nós, `redirect: 'manual'`, timeout 8 s, 3 s entre chamadas:

| Chamada | Resultado |
|---|---|
| `/category` | 200 `code 0`, 1065 bytes |
| `/goods/list` páginas 1, 2, 3 | 200 `code 0`, 10 itens cada, `total 1000`, 28–32 KB |
| `/goods/search` (`vestido`) | 200 `code 0`, 10 itens, `total 5962` |
| `/categoryRate` (`commRate 4`) | 200 `code 0` |

Continua sendo observado, não contrato: se a Shein passar a exigir header anti-bot ou barrar o IP, o recurso para
e volta para o dono (regra de `docs/afiliado-shein.md`: não forjar).

## 2. Alternativas avaliadas

| Alternativa | Veredito | Por quê |
|---|---|---|
| A. Servidor chama a listagem com o `AT` já guardado (igual ao `detailNew`) | **Escolhida, condicionada ao T0** | Roda 24 h sem navegador, reaproveita credencial, portões e worker. Depende de a lista responder sem header anti-bot. |
| B. Extensão busca a lista no navegador do usuário | Descartada (D6) | Só funciona com Chrome aberto e logado; o dono exige funcionar com o navegador fechado. |
| C. Navegador headless no servidor com a sessão do tenant | Descartada | É contornar o anti-bot; proibido em `afiliado-shein.md`; custo de RAM no worker. |
| D. Forjar `armortoken`/`smdeviceid`/`x-oest` | Descartada | Proibido pela regra do projeto; quebra a qualquer mudança da Shein. |
| E. API/raspador de terceiros (ex.: Oxylabs) | Descartada | Não traz comissão do afiliado; custo por requisição; lê página de produto. |
| F. Caçar só entre links capturados nos grupos monitorados | Descartada como fonte principal | Já é o Monitoramento; não acha oferta nova nem traz comissão. Serve de consolo se A e B caírem. |
| G. Reusar `offer_generations_per_day` como teto | Descartada (D4) | O caçador é separado do gerador; teto próprio de ofertas garimpadas. |
| I. Teto por execuções (50/dia) | Descartada (D5) | O dono quer limitar o resultado (10 ofertas especiais/dia), não a consulta. Execuções ficam só com guarda técnica. |
| J. Teto editável por env ou `platform_settings` | Descartada | Já existe preset por plano com tela, propagação e auditoria; basta aceitar número. |
| H. Guardar catálogo Shein em tabela própria | Descartada | Dado muda a toda hora; só o achado escolhido é persistido. |

## 3. Arquitetura

Tudo no módulo `campaigns` (ofertas), subpasta `hunter/` em cada camada. Nada novo na extensão no caminho A.

```
OfferHuntSchedulerJob (worker, lease, flag) ──┐
POST /api/offer-hunts/:id/run (manual) ───────┼─▶ RunOfferHuntUseCase
                                              │    1 portões (plano → caçador → credencial → aceite → teto atômico)
                                              │    2 ISheinCatalogClient.list/search (≤ 3 páginas, pausa 1–2 s)
                                              │    3 normaliza → HuntCandidate
                                              │    4 filtros locais + scoreHuntCandidate (puro)
                                              │    5 tira repetidos (offer_hunt_finds)
                                              │    6 IA opcional: IAiTextGenerator, 1 chamada, top 15 → ids + motivo
                                              │    7 topN → ResolveAffiliateProductUseCase (link do tenant)
                                              │    8 REVIEW: grava achados · AUTO: grava achados + EnqueueOfferUseCase
                                              ▼
                                   OfferDispatchWorker existente ─▶ 1 grupo
```

### Entrega (aprovação e modo `AUTO`)

- O caçador **não cria `Offer`**: `EnqueueOfferUseCase` já cria a oferta (`offers.create`,
  `EnqueueOfferUseCase.ts:102`). Chamar com `origin: 'HUNTER'`, o grupo de `offer_hunter_settings` e
  `sourceKey: 'hunt:<findId>'` (a idempotência do Enqueue é só por `sourceKey`: queda entre enfileirar e gravar
  `offerId` no achado não reenvia).
- Texto da oferta (obrigatório no Enqueue): montado pelo `OfferTextComposer` existente, com o modelo e a
  configuração de IA de texto que o tenant já usa no gerador. O caçador não tem editor de texto.
- **D4 no código**: `countCreatedSince` e `createWithinDailyLimit` (`PrismaOfferRepository.ts:69` e `:30`) contam
  toda `Offer` do tenant sem olhar `origin`. Passam a excluir `origin = 'HUNTER'` (só essa exclusão: o que hoje
  conta, inclusive `MONITORING`, continua contando). Teste: oferta `HUNTER` não mexe no saldo do gerador.
- `OfferOrigin` ganha `HUNTER` em 3 lugares: enum Prisma (`ALTER TYPE "OfferOrigin" ADD VALUE 'HUNTER'`),
  `OFFER_ORIGINS` (`campaigns/domain/enums/OfferOrigin.ts`, usado em `offer.schema.ts` e `sendQueue.schema.ts`)
  e o tipo do app (`types/api.types.ts`).
- União de grupos (D3): a fonte é o `IBroadcastGroupUsageReader` (`BroadcastGroupUse` fechado em
  `'generator' | monitor:*`). Entra o uso `hunter` no tipo e no SQL do reader; os 4 chamadores de
  `countDistinctBroadcastGroups` não mudam.

### Domínio (`campaigns/domain`)

- `contracts/ISheinCatalogClient.ts`: `listCategories`, `resolveCommissionBand(band)`, `list(query)`,
  `search(query)`. Porta separada do `ISheinAffiliateClient` (que continua só com `getProductShare`).
- `services/hunter/scoreHuntCandidate.ts` (função pura): nota 0–100 e lista de fatores.
  Pesos iniciais: valor esperado da comissão 40 (R$ de cliente novo e de retorno, ponderados), prova social 30
  (faixa de vendas, nota, faixa de avaliações, `rank`), preço 20 (desconto, faixa de preço), urgência/extra 10
  (`extraCommission`, fim da campanha). Pesos em constante única, cobertos por teste.
- `services/hunter/parseSalesBucket.ts` ("1000+" → 1000), `matchHuntFilters.ts`, `huntSchedule.ts` (próxima
  execução reaproveitando `postingWindow.ts`), `huntPresets.ts`.
- Enums: `OfferHuntStatus` (ACTIVE, PAUSED), `OfferHuntPauseReason` (USER, SOURCE_UNAVAILABLE,
  CREDENTIAL_REJECTED, RISK_NOT_ACCEPTED, PLAN_UNAVAILABLE), `OfferHuntDeliveryMode` (REVIEW, AUTO),
  `OfferHuntRunStatus`, `OfferHuntFindStatus` (PENDING_REVIEW, APPROVED, DISMISSED, SENT, FAILED).

### Persistência (3 tabelas, todas com `tenantId`)

- `offer_hunts`: nome, estado, motivo de pausa, filtros da fonte (sort, categoryId, commissionBand, keyword),
  filtros locais (colunas simples, não JSON), `aiEnabled`, `topN`, `repeatAfterDays`, `deliveryMode`,
  `intervalMinutes`, `windowStartMinute`, `windowEndMinute`, `weekdaysMask`, `nextRunAt`, `lastRunAt`,
  `consecutiveFailures`, `claimToken`/`claimedUntil`.
- `offer_hunt_runs`: caçada, gatilho (MANUAL, SCHEDULED), estado, contadores, `aiUsed`, `aiFallback`,
  `errorCode`, início/fim. Serve ao histórico e à guarda técnica de 24 execuções/dia.
- `offer_hunt_finds`: execução, `goodsId`, retrato do item (título, preço, comissões, vendas, nota), pontuação,
  fatores, motivo da IA, estado, `offerId`. Índice `(huntId, goodsId, createdAt)` para a regra de repetição.
  **O teto diário conta linhas daqui**: todo achado gravado é um escolhido (os demais candidatos da execução não
  são persistidos) e conta mesmo se depois for dispensado. Inserção atômica sob o teto, no desenho do
  `createWithinDailyLimit`, dia por `startOfDayInZone`, índice `(tenantId, createdAt)`.
- Destino: `offer_hunter_settings` (1 linha por tenant: `sessionId`, `conversationId`). É do tenant, não da
  caçada, para garantir R4.
- Migrations versionadas; nenhuma roda fora da Render.

### Entitlements e portões

- `offer_hunter_enabled` (booleano): LITE `false`, PRO `false`, MAX `true`. Entra em
  `ADMIN_EDITABLE_ENTITLEMENT_KEYS`. Ausente = bloqueado.
- `offer_hunter_finds_per_day` (numérico): LITE 0, PRO 0, MAX 10. Lido a cada execução pelo `IEntitlementReader`
  (nunca guardado em memória). `getNumber` devolve `null` para ausente e o gerador trata `null` como ilimitado:
  no caçador é sempre `?? 0`, nunca copiar o padrão do gerador. Na tela Assinatura entra em `LIMIT_OF`
  (`subscriptionLimits.ts`) para ausente não aparecer como "sem limite".
- **Edição numérica no admin**: `adminEditableEntitlements.ts` passa a descrever o tipo de cada chave
  (`boolean` | `integer` com mín/máx; `offer_hunter_finds_per_day` = inteiro 0–100).
  `PUT /api/admin/plan-entitlements/:planSlug/:key` valida `{ value }` pelo tipo (fora da faixa ou tipo errado →
  400); `GET` devolve tipo e faixa. Mesma transação (preset + `tenant_entitlements` do plano + auditoria
  `PLAN_ENTITLEMENT_CHANGED`). Na tela, chave numérica mostra campo de número com salvar explícito no lugar do
  `<Switch>`, e o `ConfirmDialog` ganha título/texto próprios para número ("de X para Y") em
  `planEntitlementsAdmin/strings.ts`. Baixar o teto não apaga achado do dia; só zera o saldo.
  Pontos hoje presos a `boolean` que mudam juntos: `AdminPlanEntitlementsPage.tsx` (`PendingChange.value`,
  `on = raw === true`), `planEntitlementsAdmin/types.ts`, `usePlanEntitlementsAdmin.ts`,
  `services/adminPlanEntitlements.service.ts`, `planEntitlementAdmin.routes.ts` (schemas `value`) e
  `SetPlanEntitlementUseCase.ts`.
- **Vitrine e assinatura (código, não só doc)**: benefício exclusivo MAX em `features/plans/catalog.ts`; chaves
  em `SUBSCRIPTION_LIMIT_KEYS` e `FIXED_MIN_PLAN: 'max'` de `features/subscription/strings.ts`.
- Exige também `marketplace_shein_enabled`.
- Prévia: `OFFER_HUNTER_AUDIENCE` (`super_admin` padrão | `entitled`). Em `super_admin` as rotas levam
  portão que só deixa super admin passar. O job processa toda caçada ativa: na prévia só existem as criadas por
  super admin, porque só ele alcança as rotas (sem coluna de criador). Abrir ao público = trocar a env, sem
  deploy de código.
- Aceite (D2): `marketplace_risk_acceptances` ganha `scope` (`AFFILIATE_LINK` padrão, `OFFER_HUNTER`), único por
  (tenant, provider, scope, versão). Texto próprio citando busca automática e recorrente. Continua só inclusão,
  só administrador do tenant. Muda junto: troca da unique na migration, `findUnique` do
  `PrismaMarketplaceRiskAcceptanceRepository` (hoje `tenantId_provider_noticeVersion`), contrato do repositório,
  `IMarketplaceRiskGate.isAccepted` e `currentRiskNoticeVersion` (versão por provider **e** escopo). Chamadas
  existentes seguem no escopo padrão, sem mudança de comportamento.
- **Um aceite só para o caçador (decisão do dono, 2026-11-12)**: o aviso `OFFER_HUNTER` é completo e autônomo.
  O texto cobre, nomeando cada item: (1) busca automática e recorrente no catálogo de afiliados, (2) geração
  automática do link pela sessão da conta, (3) envio automático ao grupo, (4) as cláusulas 3.3.2 e Anexo 3 §6,
  (5) encerramento da conta e perda de comissões, (6) uso por conta e risco do titular. Em todo o fluxo do
  caçador só esse aceite é cobrado. Para isso `ResolveAffiliateProductUseCase` e `TenantAffiliateLinkComposer`
  ganham o parâmetro opcional `riskScope` (padrão `AFFILIATE_LINK`); o caçador passa `OFFER_HUNTER`. Gerador,
  vitrine, story e monitoramento não passam nada e seguem cobrando o aviso Shein atual, sem mudança.
  Na prática a conta Shein conectada já exigiu o aviso atual no momento da conexão; o caçador só não o
  cobra de novo.
- **Prévia e aceite**: super admin tem papel `SUPER_ADMIN` e é recusado no aceite
  (`AcceptMarketplaceRiskUseCase.ts:40`); a regra "super admin não aceita em nome de tenant" fica como está.
  Na prévia, um usuário `ADMIN` do tenant de teste aceita o aviso do caçador; depois o super admin opera.
  Para isso a rota de aceite do escopo `OFFER_HUNTER` não leva o portão de audiência (só plano + `ADMIN`).

### Cliente HTTP (`campaigns/infrastructure/http/SheinCatalogClient.ts`)

Antes de existir, a regra de `docs/afiliado-shein.md` ("nenhum host/endpoint Shein além dos três da allowlist e
do `detailNew`") e a linha do `AGENTS.md` são reescritas para uma lista fechada de endpoints fixos que inclui os
5 de `seller/activity` (decisão D1). O host continua só `m.shein.com`.

Mesmas regras do `SheinAffiliateClient`: URLs em constante, `redirect: 'manual'`, timeout 8 s, corpo ≤ 256 KiB
(página observada ≈ 33 KB). Headers fixos: `token`, `siteuid: mbr`, `language: pt-br`, `mi: <memberId>`,
`channel: 1`, `content-type`, mais o `User-Agent` que o cliente atual já envia. Nenhum outro.
`code 100105`/401 → `AffiliateCredentialRejectedError`; 3xx/5xx/timeout/JSON inválido →
`AffiliateApiUnavailableError`; `goodsList` nulo com `code "0"` (o sintoma de header faltando) → conta como
fonte indisponível, não como "nenhuma oferta". Imagem forçada para https e host `ltwebstatic.com`. Entrada do usuário que vai para a Shein: só
`searchKey` (≤ 60 caracteres, sem controle) e ids de enumerações fechadas.

### IA

- Só via `IAiTextGenerator`, `purpose: 'offer_hunt_ranking'`, 1 chamada por execução, conta em
  `ai_requests_per_day`. Sem provedor configurado: a opção aparece desligada com explicação.
- Entrada: até 15 itens compactos (id curto, título cortado em 80, preço, desconto, comissões, vendas, nota,
  avaliações, pontuação). Nunca token, link, id de afiliado ou nome do tenant.
- Saída exigida: JSON `[{ id, reason }]`. Validação: ids ⊂ enviados, sem repetição, `reason` ≤ 140 caracteres,
  texto puro. Qualquer desvio → `aiFallback`.
- Título de produto é dado não confiável: vai delimitado e o system prompt manda ignorar instruções nele.

### Job (`OfferHuntSchedulerJob`)

- Papel `worker` (e `all`), entra em `processJobs.ts`. Flag `OFFER_HUNTER_JOB_ENABLED`, padrão `false`, ligada só
  na Render. `IJobLease` + tique de 60 s.
- Reivindica caçadas vencidas por CAS em `claimToken` (sem estado em memória). No máximo 3 por tique, 1 por
  tenant por vez, com atraso aleatório entre tenants.
- Saldo do teto zerado: não chama a Shein, agenda a próxima para o dia seguinte dentro da janela.
- Orçamento por execução: ≤ 1 `categoryRate` + ≤ 3 páginas + ≤ `topN` `detailNew`. Pior caso por tenant/dia:
  24 execuções × 4 de listagem + 10 `detailNew` (teto padrão) ≈ 106 chamadas.
- 3 falhas seguidas de fonte → pausa `SOURCE_UNAVAILABLE`. Sessão recusada → pausa + marca a credencial
  `rejected` (regra geral). Fora da janela/dia: só recalcula `nextRunAt`, não gasta teto.

### Rotas (`/api/offer-hunts`, `authHook` + tenant + portão de audiência)

`GET /` · `POST /` · `GET /:id` · `PUT /:id` · `DELETE /:id` · `POST /:id/pause` · `POST /:id/resume` ·
`POST /:id/run` · `GET /:id/runs` (cursor assinado) · `GET /:id/finds` (cursor assinado) ·
`POST /finds/:findId/approve` · `POST /finds/:findId/dismiss` · `GET /usage` · `GET /access` (só `authHook`;
responde `{ visible }` para qualquer usuário, sem 403) · `GET /options` (categorias,
ordenações, faixas, predefinições, estado dos portões) · `GET`/`PUT /settings` (grupo de destino).
Erros novos: `OFFER_HUNT_DAILY_LIMIT` (429, teto de ofertas garimpadas), `OFFER_HUNT_RUN_THROTTLED` (429, guarda
técnica de execuções), `OFFER_HUNT_LIMIT_REACHED` (409), `OFFER_HUNT_DESTINATION_REQUIRED`
(422), `OFFER_HUNT_SOURCE_UNAVAILABLE` (503).

### Painel (`app/src/features/offerHunter/`)

- Caminho `/offer-hunter` (prefixo plano, como `/offer-story` e `/storefront`).
- Visibilidade vem da API, não do papel fixo no front: `GET /api/offer-hunts/access` → `{ visible }` (já aplica
  `OFFER_HUNTER_AUDIENCE`). `buildNavigation` ganha a entrada `offerHunterVisible` e só inclui o filho quando
  `true`; a rota usa um guard próprio (`OfferHunterRoute`) com o mesmo dado. **Não** usar `superAdminOnly` nem
  `SuperAdminRoute`: hoje os filhos de Afiliados não passam por `onlyAllowed` (`navigation/model.ts:91-100`) e
  o guard fixo impediria abrir ao público só trocando a env.
- Tela inicial: barra "X de N ofertas garimpadas hoje" (N da API), cartão do grupo de destino, cartões das caçadas (estado, próxima execução,
  últimos números, `<Switch>` de pausa), alerta quando pausada sozinha.
- Assistente em 3 passos: **O que caçar** (predefinição + categoria + faixa de comissão + palavra) → **Refino**
  (`RangeSlider` de preço, desconto/comissão/nota mínimos, `<Switch>` de IA, `topN`) → **Quando e onde**
  (intervalo, dias, janela, modo de entrega). Botão "Testar agora" mostra o ranking com fatores em `Tooltip`.
- Detalhe: achados (aprovar/dispensar no modo `REVIEW`) e histórico de execuções.
- `usePersistedState('offerHunter.wizard', initialWizard, { scope: 'tab', version: 1 })`, limpo ao salvar. Privacidade: tela `offerHunter` com flags
  `sessionName`, `groupNames`, `groupAvatars`, `productImages`, `productText`. Textos em `strings.ts`.
  Próxima execução com `serverNow()`.

## 4. Riscos

| Risco | Tratamento |
|---|---|
| Lista não responde ao servidor sem header anti-bot | Portão T0 antes de qualquer código; reprovou → recurso não é construído (D6). |
| Conta de afiliado encerrada por automação | Aceite próprio (D1/D2), orçamento baixo de chamadas, pausa automática, sem insistência. |
| Shein muda o endpoint | Cliente isolado atrás da porta; campo ausente vira item descartado; pausa em 3 falhas. |
| IP de datacenter bloqueado | T0 roda da Render; 403 sem `100105` conta como fonte indisponível. |
| Injeção de instrução pelo título do produto | Dado delimitado + validação estrita da saída + sem ferramenta na chamada. |
| Grupo inundado | Teto de 10 ofertas/dia, `topN` ≤ 5, repetição bloqueada, intervalo mínimo 30 min, padrão `REVIEW`. |

## 5. Versões e documentação

api 0.93.0 · app 0.116.0 · extensão sem mudança. `CHANGELOG.md` da api e do app. Doc nova
`docs/cacador-de-ofertas.md`; atualizar `docs/afiliado-shein.md` (endpoints e tabela "observado"),
`docs/produto-roadmap.md` (item novo no produto Afiliados), `docs/navegacao-produtos.md`, `docs/planos.md` e a
linha correspondente em `AGENTS.md`.
