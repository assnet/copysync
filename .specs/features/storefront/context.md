# Página de Ofertas — decisões (2026-10-29)

Pedido do dono + prints do Redirect Flow. Linhas marcadas **(proposta)** foram decididas pelo
agente por falta de resposta explícita; confirmar com o dono antes de executar a task citada.

## Alternativas avaliadas

| # | Questão | Alternativa | Veredito | Por quê |
| --- | --- | --- | --- | --- |
| A1 | Onde fica o subdomínio da página | Domínio separado (ex.: `ofertas.<x>`) | ❌ | Render inclui 2 custom domains e ambos estão em uso (rodízio, decisão #12); cada raiz a mais custa |
| | | Mesmo `LinkDomain` do rodízio, tabelas separadas com checagem cruzada | ❌ | Unicidade só na aplicação; corrida entre rodízio e página cria dois donos para o mesmo Host |
| | | **Mesmo `LinkDomain`, tabela única de reivindicação `PublicSlugClaim(domainId, slug)` unique, com `kind`** | ✅ | Unicidade no banco; hook por Host despacha pelo `kind`; backfill simples dos rodízios |
| A2 | Preview em tempo real | Componente React que imita a página | ❌ | Dois renderizadores divergem; o preview mente |
| | | **`POST /storefront/preview` renderiza o mesmo template com o rascunho; painel mostra em `<iframe sandbox srcdoc>`** | ✅ | Paridade exata; iframe sem script isola o HTML |
| A3 | Extração da oferta | Chamar `GenerateOfferUseCase` | ❌ | Grava `Offer`, compõe texto/IA e consome cota diária do gerador |
| | | Reescrever extração no módulo novo | ❌ | Duplica allowlist, expansão e regra de dono do link |
| | | **Extrair passos 2–4 do gerador para `ResolveAffiliateProductUseCase` (campaigns) e usar nos dois** | ✅ | Uma regra; testes atuais do gerador travam o refactor |
| A4 | Upload de foto/capa | Multipart direto em rota nova | ❌ | AGENTS: upload só por `chunkedUpload` |
| | | **`chunkedUpload` (1 parte) → `PUT /storefront/images/:kind {uploadId}` → valida, recorta (sharp), grava WebP** | ✅ | Reaproveita sessão de upload; imagem final pequena |
| A5 | Imagem do produto | Hotlink da CDN do marketplace | ❌ | URL expira/bloqueia; `allowedMediaUrl` só aceita `S3_PUBLIC_URL` |
| | | **Baixar via `IOfferImageFetcher` → `IStorefrontImageProcessor(offer)` → `IMediaFileStore.saveBuffer`** | ✅ | Gerador grava bruto (`ResolveProductDataUseCase.ts:94-103`, sem resize); vitrine redimensiona. Com `MEDIA_STORAGE_DRIVER=local` a URL é relativa e a página pública não mostra imagem: validar em dev com bucket R2/S3 |
| A6 | Nome especial "Comprar" | Checkout via hub | ❌ (v1) | Hub = 1 assinatura por tenant, sem add-on |
| | | **Lista `premiumNames` por domínio + `PremiumSlugGrant` concedido pelo super-admin; banner com placeholder** | ✅ | Entrega o fluxo visível agora; hub cria grant com `source = BILLING` depois |

## Decisões

| # | Dúvida | Decisão |
| --- | --- | --- |
| 1 | Planos | `storefront_enabled`: Starter `false`, Profissional `true`, Business `true`. Booleano de feature ausente = bloqueado (`entitlementKeys.ts`). Os 4 tenants de produção estão sem `planSlug` → bloqueados até evento do hub ou concessão manual |
| 2 | Starter clica no menu | Menu visível para todos com selo "Profissional"; API devolve `403 PLAN_FEATURE_UNAVAILABLE`; painel redireciona para `/plans?feature=storefront` com o aviso pedido |
| 3 | Páginas por tenant | 1 (`Storefront.tenantId @unique`) |
| 4 | Link da oferta | Regra de dono do gerador; **Shopee diverge**: com credencial gera link via `BuildTenantAffiliateLinkUseCase` (gerador grava o colado, `verifyAffiliateLink.ts:64` = sempre `unverified`); sem credencial grava o colado + selo "comissão não verificada" **(proposta)** |
| 5 | Limites | 200 ofertas no total, 60 publicadas, 60 extrações/hora — constantes de domínio, não entitlement **(proposta)** |
| 6 | Foto | JPEG/PNG/WebP ≤ 2 MiB, mín. 200×200 → WebP 320×320 q80 (~20 KB) |
| 7 | Capa | JPEG/PNG/WebP ≤ 4 MiB, mín. 1200×400 → WebP 1500×500 q80 (~80–120 KB), proporção 3:1 |
| 8 | Imagem de oferta | WebP lado maior 600 px q80 |
| 9 | Categorias | Catálogo fixo de 17 (prints) no domínio da API com rótulo pt-BR; página escolhe quais mostrar |
| 10 | Página pública | HTML sem JS, filtro de categorias por CSS (`:checked`), `Cache-Control: public, max-age=60` |
| 11 | Downgrade | `PAUSED_BY_PLAN`, nome mantido (sem job de liberação na v1) |
| 12 | Troca de nome | Nome antigo reservado 30 dias ao tenant (`LinkSlugReservation`, igual ao rodízio) |
| 13 | Preço do nome especial | Texto de marketing em `features/plans/catalog.ts` (`PREMIUM_SLUG_OFFER`), placeholder; `checkoutUrl: null` → botão "Em breve" |
