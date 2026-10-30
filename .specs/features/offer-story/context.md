# Story de Oferta — decisões (2026-10-29)

Pedido do dono + prints do Redirect Flow ("Instagram", `publicar-instagram.php`). Roadmap item 11
(`docs/produto-roadmap.md`, "Story de oferta"). Linhas **(proposta)** foram decididas pelo agente; confirmar
com o dono antes da task citada.

## Alternativas avaliadas

| # | Questão | Alternativa | Veredito | Por quê |
| --- | --- | --- | --- | --- |
| A1 | Como gerar a imagem | Modelo de imagem por IA (gerar a arte inteira) | ❌ | Caro por arte, lento (10–30 s), inventa texto/preço; não há porta de imagem em `assistants` (só `IAiTextGenerator`) |
| | | Canvas no navegador | ❌ | Imagem do marketplace sem CORS "suja" o canvas e `toBlob` falha; exigiria proxy na API de qualquer jeito; fonte varia por aparelho; regra de layout duplicada fora da API |
| | | `sharp` + SVG com `<text>` (librsvg) | ❌ | Imagem roda em `node:22-alpine` sem fontconfig nem fontes (`api/Dockerfile:1,6`); librsvg não lê `@font-face`; quebra de linha manual |
| | | **`satori` (layout flex + `lineClamp`, fontes passadas como buffer) → `@resvg/resvg-js` (SVG→PNG) → `sharp` (JPEG)** | ✅ | Determinístico, fontes OFL versionadas no repo, sem dependência do SO; `sharp` já é dependência direta. Spike T1 valida no Alpine (musl); se falhar, plano B `@napi-rs/canvas` atrás da mesma porta |
| A2 | O que a "IA" faz | Nada (título cortado) | ❌ | Título de marketplace tem 100–200 caracteres; 3 linhas cortadas perdem o produto |
| | | **`IAiTextGenerator` encurta o título (≤ 60) com fallback para o título original + `lineClamp`** | ✅ | Mesma porta e fallback do gerador (`OfferTextComposer.ts:53-62`); gasto entra em `ai_usage_logs` e no teto diário existente |
| A3 | Entrega da arte | Gravar no storage e devolver URL | ❌ | Arte é descartável; exigiria job de limpeza (não existe TTL para objetos, só para sessões de upload) |
| | | Resposta binária `image/jpeg` | ❌ | Com `responseType: 'blob'` o corpo do erro vira Blob e o painel perde `code` (gate `PLAN_FEATURE_UNAVAILABLE`, `planGate.ts:8-10`) |
| | | **JSON padrão (`httpResponse.ok`) com `image` em data URL base64 + metadados** | ✅ | Erros e gate iguais às outras rotas; ~0,5 MB por arte; CSP do painel já aceita `img-src data: blob:` (`render.yaml`) |
| A4 | Arte dos templates | Copiar os fundos do Redirect Flow | ❌ | Direito autoral de terceiro |
| | | PNGs encomendados | ❌ (v1) | Dependência externa; atrasa a entrega |
| | | **Templates originais em código (gradientes, formas, títulos com fontes OFL), catálogo no domínio da API** | ✅ | Versionado, sem asset binário grande; thumbnails gerados pelo mesmo renderer |
| A5 | Favoritos | Tabela por usuário | ❌ (v1) | Migration + rotas para preferência visual |
| | | **`usePersistedState(..., { scope: 'browser' })`** | ✅ **(proposta)** | Zero backend; perde ao trocar de navegador (aceito) |
| A6 | Onde mora o código | `campaigns/offer-story` (roadmap) | ❌ | `campaigns` já concentra gerador, fila e envio |
| | | **Módulo próprio `offer-story`, consumindo `offersContainer.resolveAffiliateProduct()` como a vitrine (`storefrontContainer.ts:64`)** | ✅ | Mesmo desenho do `storefront`; roadmap item 11 (`campaigns/offer-story`) corrigido na T13 |

## Decisões

| # | Dúvida | Decisão |
| --- | --- | --- |
| 1 | Plano | Entitlement booleano `offer_story_enabled`: Starter `false`, Profissional `false`, Business `true`. Ausente = bloqueado (`=== true`). `catalog.ts:125` já vende "Template para Instagram" só no Business |
| 2 | Não-Business clica no menu | Menu visível para todos com selo "Business"; API `403 PLAN_FEATURE_UNAVAILABLE`; painel redireciona para `/plans?feature=offerStory` com aviso |
| 3 | Extração | `ResolveAffiliateProductUseCase` (allowlist, anti-SSRF, dono do link). Não usa `GenerateOfferUseCase`, não grava `Offer`, não consome `offer_generations_per_day` |
| 4 | Link na arte | Arte **não** leva link (story usa o sticker de link do Instagram). Resposta devolve `affiliateUrl` para o botão "Copiar link". Shopee: link colado + `attributionVerified` do resolve; geração do link do tenant como na vitrine fica fase 2 **(proposta)** |
| 5 | Cupom | Código obrigatório quando "Tem cupom?" ligado; validado por `normalizeCoupon` (`offerCoupon.ts:8`, padrão interno), máx. 20 caracteres na arte. Charset igual ao do gerador, máx. 20 próprio da arte (gerador aceita 40) (letras, números, `_ . -` e espaço): `%`, `*`, `+` → 422 **(proposta)**; painel valida o mesmo padrão antes de enviar. Desconto % inteiro 1–90, opcional |
| 6 | Preço | Tabela única em `spec.md` ("Regras de preço"): sem desconto, "de" só quando `originalPriceCents > priceCents`; com desconto `d%`, "por" = `round(priceCents × (100 − d) / 100)` e "de" = `originalPriceCents` se maior que `priceCents`, senão `priceCents` (sempre acima do "por"); cupom sem % não muda preço. Sem `priceCents`: arte sem bloco de preço + aviso |
| 7 | Arte | 1080×1920 JPEG q85, sem EXIF. Imagem do produto via `IOfferImageFetcher` (≤ 5 MiB, allowlist de CDN); falha → card sem foto + aviso |
| 8 | Templates v1 | 8 originais **(proposta)**; texto da arte em pt-BR (como a página pública) |
| 9 | Limite | `perTenantRateLimit` `offerStoryRender` 60/hora por tenant por instância (store em memória, `rateLimitPresets.ts:44-47`) **(proposta)**; render com no máx. 2 em paralelo por instância |
| 10 | Persistência | Arte nunca vai ao servidor. Assistente (passo, template, link, cupom) em `usePersistedState` escopo `tab`; arte + metadados em `offerStory.result` (escopo `tab`, v1) → reload no passo 3 mantém a arte. Arte inválida/fora do catálogo ou cota estourada → passo 2 com campos, sem erro (revisado 2026-10-29; antes: reload no 3 voltava ao 2) |
| 11 | Downgrade | Nada a pausar (sem dado persistido); sem mudança em `applyPlanSideEffects` |
