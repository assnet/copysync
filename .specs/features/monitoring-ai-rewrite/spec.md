# Monitoramento: oferta montada + reescrita com IA — plano

Status: **implementado** (api 0.41.0 · app 0.47.0, 2026-10-28). T1–T8 feitos; migration validada em Postgres descartável. Roadmap: item 4 ("falta IA, imagem") e item 7 ("falta no monitoramento")
em `docs/produto-roadmap.md`. Tela já anuncia "Reescrita com IA · Em breve" (`MonitoringSettingsForm.tsx:224`).

## Problema

1. Captura que chega **só com o link** (ex.: `https://meli.la/1bfzHwh`, 2026-10-28 20:16 UTC) sai só com o
   link do tenant: oferta sem título, preço e foto (`ProcessPendingCapturedOffersUseCase.ts:112-150` só troca
   links no texto da origem).
2. Captura com texto sai com o texto do concorrente, palavra por palavra (tirando links). Não há reescrita.

O gerador resolve os dois (`GenerateOfferUseCase.resolveProduct` + `OfferTextComposer` com `IAiTextGenerator`,
gate `ai_rewrite_enabled`). O monitoramento não reaproveita nada disso.

## Alternativas avaliadas

| Alternativa | Veredito | Por quê |
|---|---|---|
| A. Só IA: prompt "reescreva este texto mantendo o link" sobre o texto capturado | ❌ | Não resolve o link puro (nada para reescrever); IA inventa preço/produto quando o texto é pobre |
| B. Só dados: ler produto (vitrine ML, API Shopee, página Amazon) e montar com o modelo fixo | 🟡 parcial | Resolve o link puro e dá foto; sem IA o texto fica igual para todo mundo |
| C. Dados + IA (este plano): extrair produto → `OfferTextComposer` (modelo fixo ou IA por público) | ✅ | Um caminho só, o mesmo do gerador; IA recebe JSON de dados, não texto de terceiro (anti-injeção já existe, `buildOfferTextPrompt.ts:71`) |
| D. Pedir dados à extensão (como o gerador v2 faz para página de produto ML) | ❌ aqui | Captura roda no servidor sem navegador do tenant; fica como fallback futuro |

Decisão: **C**, com B como degradação (sem IA → modelo fixo) e texto original como última degradação
(sem dados → comportamento de hoje).

## Comportamento

Novo em `GroupMonitorSettings` (migration `add-group-monitor-text-mode`):

| Campo | Tipo | Padrão | Uso |
|---|---|---|---|
| `textMode` | `'ORIGINAL' \| 'TEMPLATE' \| 'AI'` | `'ORIGINAL'` | `ORIGINAL` = hoje (troca links). `TEMPLATE` = monta com `renderOfferText`. `AI` = `OfferTextComposer` com `audience` |
| `audience` | `OfferAudience` | `'STANDARD'` | Só com `AI`; `STANDARD` equivale a `TEMPLATE` |
| `enrichLinkOnly` | boolean | `true` | Mesmo em `ORIGINAL`: captura **sem texto além de links** vira `TEMPLATE` (resolve o caso 1 sem o tenant mexer em nada) |

Pipeline no worker (`ProcessPendingCapturedOffersUseCase`), depois do link do tenant e antes de enfileirar:

1. `needsProduct = textMode !== 'ORIGINAL' || (enrichLinkOnly && semTextoAlémDeLinks)`.
2. Se `needsProduct`: `IMonitorProductReader.read(tenantId, first.provider, first.sourceUrl)` →
   `{ title, priceCents, originalPriceCents, imageUrl }` (adapter em `CampaignsMonitorAdapters`, reaproveitando
   `resolveProduct` do gerador extraído para um use case próprio, `ResolveProductDataUseCase`):
   - **ML vitrine social**: card `polycard` da página `/social/<etq>?…&ref=…` (lida sem cookie, item já no
     `BuildTenantAffiliateLinkUseCase`): `title.text`, `price.current_price.value`, `price.previous_price.value`,
     `pictures.pictures[0].id` + `picture_template` (host `http2.mlstatic.com`, já na allowlist do
     `HttpOfferImageFetcher`). Chaves confirmadas na vitrine real em 2026-10-28 (`"current_price":{"value":331.11}`,
     `"previous_price":{"value":699.9}`, `"text":"Kit Wella…"`); `parseProductPage` ganha `mercadoLivreSocialCard`.
     Página de produto `/p/` cai no captcha: não tentar.
   - **Shopee**: `getProduct` da API de afiliados (já existe).
   - **Amazon**: `HttpProductPageReader` (já existe; pode falhar por anti-bot → sem dados).
3. Texto final:
   - dados ok e modo `TEMPLATE`/`AI` → `OfferTextComposer.compose({ audience, title, priceCents, originalPriceCents, coupon, affiliateUrl })`;
     `aiFallback` vira `aiErrorCode` gravado na captura (campo novo `textSource: 'ORIGINAL' | 'TEMPLATE' | 'AI'` +
     `aiErrorCode` nullable) para o painel mostrar "texto da IA" / "modelo (IA indisponível)".
   - sem dados → texto de hoje (`rewriteOfferLinks`), `textSource = 'ORIGINAL'`; captura só-link continua
     saindo só com o link, marcada `reason`-like informativo `PRODUCT_DATA_UNAVAILABLE` (não bloqueia).
4. Foto: ordem `sourceMediaUrl` (foto da mensagem) → `imageUrl` do produto via `MediaOfferStore.saveImage`
   (mesmo `HttpOfferImageFetcher`, limite e MIME do gerador). Falha = sem foto, `imageUnavailable` como hoje.
5. Rede de segurança (`extractUrls(finalText)` só com links do tenant) continua valendo sobre o texto final,
   inclusive o da IA (o prompt já exige o link sozinho na última linha; `OfferTextComposer` garante o link).

Entitlement: `AI` exige `ai_rewrite_enabled` ≠ false (`IAiEntitlementReader`, já usado pelo gerador). Sem ele,
`AI` degrada para `TEMPLATE` e o painel mostra "disponível no seu plano" com link `/plans` (hoje o roadmap não
põe IA em plano específico). **Decisão do owner (2026-10-28): IA em todos os planos por enquanto**, como no gerador.

Limite de IA: mesmo `ai_usage_logs`/limite diário do `IAiTextGenerator` (`purpose: 'monitoring.text'`).

## Tarefas

| # | Tarefa | Onde | Verificação |
|---|---|---|---|
| T1 | Extrair `resolveProduct` + `storeImage` do `GenerateOfferUseCase` para `ResolveProductDataUseCase` (campaigns/application) sem mudar o gerador | api campaigns | testes do gerador continuam verdes |
| T2 | `parseProductPage`: `mercadoLivreSocialCard(html)` → título/preços/foto do 1º card; fixture HTML real anonimizada | api campaigns/domain | teste puro |
| T3 | Migration + `GroupMonitorSettings` (`textMode`, `audience`, `enrichLinkOnly`); `monitorSettings.ts` valida; rota `PUT /config` e schema | api automation + prisma | 422 em valor inválido |
| T4 | `captured_offers`: `textSource`, `aiErrorCode` (mesma migration); DTO/schema/app types | api automation | — |
| T5 | Portas `IMonitorProductReader`, `IMonitorTextComposer`, `IMonitorImageStore` em `IMonitorPorts.ts`; adapters em `CampaignsMonitorAdapters.ts`; fakes em `monitorTestFakes.ts` | api automation | — |
| T6 | Pipeline no `ProcessPendingCapturedOffersUseCase` (passos 1–5); testes: só-link → template; texto + `AI` → IA; IA falha → template + `aiErrorCode`; sem dados → original; rede de segurança sobre texto da IA | api automation | vitest |
| T7 | Painel: `MonitoringSettingsForm` troca o "Em breve" por seletor Original / Modelo / IA (+ público quando IA, mesmo componente do gerador `AudienceSelect`), switch "Montar oferta quando chegar só o link"; `CapturedOffersList` mostra chip "Texto: IA / Modelo / Original" e aviso de fallback | app monitoring | agent-browser, i18n via `strings.ts`, modos claro/escuro/sistema |
| T8 | Docs: `docs/monitoramento-grupos.md` §2 (novo passo), §6; `docs/ia-provedores.md` (purpose novo); roadmap itens 4 e 7; CHANGELOG; api minor, app minor | docs | — |

Ordem: T1 → T2 → T3/T4 (uma migration) → T5 → T6 → T7 → T8. T1+T2 cabem num PR sem migration.

## O que não fazer

- Não mandar o texto do concorrente para a IA: só JSON de dados (`buildOfferTextPrompt`), como no gerador.
- Não ler página de produto ML com cookie do servidor (captcha; `docs/extensao-ml-endpoints.md` §7) nem fora da
  allowlist (`isSupportedProductUrl`, `HOST_SUFFIXES` do fetcher de imagem).
- Não criar segundo compositor de texto: `OfferTextComposer` é o único. Não duplicar `resolveProduct`.
- Não guardar o entitlement na config: ler `IAiEntitlementReader` a cada processamento.
- Não bloquear a captura por falta de dados do produto: degradar para o texto de hoje.
- Não logar prompt, resposta da IA, HTML ou URL de terceiro.
