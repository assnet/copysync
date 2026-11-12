# Caçador de Ofertas (Shein) — tasks

Cada tarefa: commit atômico, `tsc --noEmit` na `api/` e no `app/`, testes da área. Migrations nunca rodam local.

## Fase 0 — Portões (sem código de produto)

- **T0a** ~~feito~~ Sonda da listagem **a partir do Shell da API na Render**, com o `AT` do dono:
  `goods/list` com `token` + `siteuid` + `language` + `mi` + `channel`, sem nenhum header anti-bot, corpo com
  `materialInfoInfo` e `did` vindo de `/category`. Passa se vierem itens em 3 chamadas espaçadas. Anotar em
  `docs/afiliado-shein.md`. **Reprovou → parar: o recurso não é construído (D6), avisar o dono.**
  **Aprovado em 2026-11-12**: triagem do Mac e sonda do Shell da Render, 6 chamadas, todas 200 `code 0` com
  10 itens por página (ver design §1). Anotado em `docs/afiliado-shein.md` (T5).
- **T0b** ~~Página 2, `pageSize`, categoria, busca~~ feito na triagem. **Aberto (não bloqueia)**: resta confirmar na tela da Shein o
  rótulo de `commRate` 1, 2, 3 e 5 (só o 4 está confirmado) e por que `sort` não muda a resposta.
- **T0c** ~~Dono responde D1–D6~~ feito em 2026-11-12 (ver spec).
- **T0d** ~~feito~~ (`ff774025`) `docs/produto-roadmap.md` antes de codar, 4 edições: funcionalidade nº 17 na tabela, nº 17 na linha do
  produto Afiliados, limite "ofertas garimpadas/dia" (MAX 10) na tabela de planos, chaves `offer_hunter_*` na
  lista de entitlements.

## Fase 1 — Base e caçada manual (api)

- **T1** ~~feito~~ (`72de72c0`) Entitlements `offer_hunter_enabled` e `offer_hunter_finds_per_day` (MAX 10): chaves, presets,
  `subscriptionLimits` (inclusive `LIMIT_OF`, ausente = 0), migration de dados com backfill `ON CONFLICT DO NOTHING`; `seed.ts` não sobrescreve.
- **T1b** ~~feito~~ (`72de72c0`) Edição numérica em `/admin/plan-entitlements`: tipo e faixa por chave em `adminEditableEntitlements.ts`,
  validação no `SetPlanEntitlementUseCase` e no schema da rota, `GET` com tipo/faixa, campo numérico na
  `AdminPlanEntitlementsPage`, confirmação com texto numérico. Trocar o `boolean` nos 7 pontos listados no design
  (página, `types.ts`, hook, service, schemas da rota, use case). Testes: fora da faixa 400, booleano em chave
  numérica 400, propagação e auditoria; chave booleana existente segue igual.
- **T2** ~~feito~~ (`39e71b8a`; tabelas em `20261114100200_create_offer_hunter_tables`) Migration `create-offer-hunts-runs-finds-settings`. `HUNTER` em `OfferOrigin` nos 3 lugares (enum Prisma
  com `ALTER TYPE … ADD VALUE` em migration própria, `OFFER_ORIGINS`, tipo do app).
- **T2b** ~~feito~~ (`39e71b8a`) D4 no código: `countCreatedSince` e `createWithinDailyLimit` excluem `origin = 'HUNTER'`. Teste de que o
  saldo do gerador não muda com oferta do caçador e de que as demais origens seguem contando.
- **T3** ~~feito~~ (`4a1be87d`) `scope` em `marketplace_risk_acceptances`: migration (coluna com default + troca da unique), contrato e
  `PrismaMarketplaceRiskAcceptanceRepository`, `IMarketplaceRiskGate.isAccepted`, `currentRiskNoticeVersion` por
  provider e escopo, `AcceptMarketplaceRiskUseCase` e rota aceitando `scope`. Aviso do caçador (versão e texto
  espelhado no app). Teste de regressão: fluxos atuais no escopo padrão sem mudança.
- **T4** ~~feito~~ (`e779b1f1`) Domínio puro com testes: `scoreHuntCandidate`, `matchHuntFilters`, `parseSalesBucket`, `huntSchedule`,
  `huntPresets`.
- **T5** ~~feito~~ (`e779b1f1`) Primeiro reescrever a regra de endpoints em `docs/afiliado-shein.md` ("O que não fazer" e "Garantido
  pelo código") e a linha do `AGENTS.md` para a lista fechada com os 5 de `seller/activity`. Depois
  `ISheinCatalogClient` + `SheinCatalogClient` com testes de erro (401, 403 `100105`, 3xx, 5xx, timeout,
  JSON inválido, lista nula, host de imagem).
- **T6** ~~feito~~ (`542fe263`) Repositórios Prisma + mappers; reserva atômica dos achados sob o teto diário (saldo parcial: pede 5,
  restam 2, grava 2) com teste de concorrência (Postgres descartável); guarda de 24 execuções/dia.
- **T7** ~~feito~~ (`542fe263`) `RunOfferHuntUseCase` sem IA: portões na ordem, busca, filtro, pontuação, repetição, `REVIEW`.
- **T8** ~~feito~~ (`542fe263`) Entrega: aprovar achado e modo `AUTO` via `ResolveAffiliateProductUseCase` + `OfferTextComposer` +
  `EnqueueOfferUseCase` (`origin: 'HUNTER'`, `sourceKey: 'hunt:<findId>'`, sem criar `Offer` à parte). Grupo
  único. União de grupos (D3): uso `hunter` no `BroadcastGroupUse` e no SQL do `IBroadcastGroupUsageReader`.
  `riskScope` opcional em `ResolveAffiliateProductUseCase` e `TenantAffiliateLinkComposer` (padrão
  `AFFILIATE_LINK`; caçador passa `OFFER_HUNTER`). Testes: reenvio do mesmo achado não duplica; só o aceite do
  caçador é cobrado no fluxo dele; chamadores atuais seguem cobrando o aviso Shein; teto com `?? 0`.
- **T9** ~~feito~~ (`126520c8`) Use cases de CRUD, pausa/retomada, uso, opções, destino. Rotas, schemas, presenters, erros, portão de
  audiência (`OFFER_HUNTER_AUDIENCE`). Teste de rota: usuário comum 403.

## Fase 2 — IA

- **T10** ~~feito~~ (`b273f053`; nome real `AiHuntCandidateRanker` + `huntRankingPrompt.ts`) `RankHuntCandidatesWithAi` (serviço de aplicação): prompt, validação da saída, `aiFallback`. Testes:
  saída inválida, id fora da lista, provedor ausente, título com instrução embutida, nenhum segredo no prompt.

## Fase 3 — Agendamento

- **T11** ~~feito~~ (`0cd087b2`) `OfferHuntSchedulerJob`: lease, flag `OFFER_HUNTER_JOB_ENABLED`, reivindicação por CAS, limite por
  tique, pausa automática. Registro em `processJobs.ts`/`server.ts`, env no zod. Teste com dois "processos".

## Fase 4 — Painel

- **T12** ~~feito~~ (`1feffe11`; item sem selo no menu) Serviço HTTP, hooks, `strings.ts`, flags de privacidade. Menu e rota `/offer-hunter` pela visibilidade
  da API (`GET /access` → `offerHunterVisible` no `buildNavigation` + `OfferHunterRoute`); teste do modelo de
  navegação: invisível quando `false`. Vitrine/assinatura: `plans/catalog.ts`, `SUBSCRIPTION_LIMIT_KEYS`,
  `FIXED_MIN_PLAN`.
- **T13** ~~feito~~ (`5a35b7ee`) Tela inicial: uso do dia, destino, cartões de caçada, alertas de pausa.
- **T14** ~~feito~~ (`5a35b7ee`) Assistente de 3 passos com predefinições, `usePersistedState`, "Testar agora" com ranking e fatores.
- **T15** ~~feito~~ (`5a35b7ee`; foto do produto em `29008550`, migration `20261114100400_add_offer_hunt_find_image`, só exibição) Detalhe: achados (aprovar/dispensar) e histórico com cursor.
- **T16** ~~feito~~ (`5a35b7ee`) Aviso de risco do caçador com aceite; estados travados (sem plano, sem conta Shein, sem IA). `scope` em
  `AcceptMarketplaceRiskRequest` (`types/api.types.ts`) e em `affiliateCredential.service.ts`; texto e versão
  próprios do caçador, com teste de hash separado do aviso Shein atual (que não muda).
- **T17** ~~feito~~ (`559497f9` ajustes visuais) Conferência visual com agent-browser: claro, escuro, celular; borrar ligado.

## Fase 5 — Fecho

- **T18** **Em andamento**: docs feitas (`docs/cacador-de-ofertas.md`, `afiliado-shein.md`, `navegacao-produtos.md`, `produto-roadmap.md`, `AGENTS.md`); `planos.md`, `CHANGELOG.md` e versões pendentes (outra sessão edita esses arquivos). Plano original: `docs/cacador-de-ofertas.md`, `afiliado-shein.md`, `navegacao-produtos.md`, `planos.md`,
  `AGENTS.md`. `CHANGELOG.md` + versões api 0.93.0 / app 0.115.0.
- **T19** Pendente. Revisão (`/code-review`) e correções.
- **T20** Pendente (dono). Pré-requisito: um usuário `ADMIN` do tenant de teste aceita o aviso do caçador (super admin não aceita). Smoke do dono após deploy, com a flag do job ligada só na Render: caçada manual, agendada, `AUTO` em
  grupo de teste, teto de 10 ofertas bloqueando a 11ª, mudança do teto na tela do admin, pausa ao deslogar da Shein.

## Dependências

T0a aprovado: Fase 1 liberada (T0d antes de codar). T1b pode ir em paralelo com T2–T5. T10 e T11 dependem de T7. Fase 4 pode andar em paralelo a
partir de T9.
