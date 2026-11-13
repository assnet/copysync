# Caçador multimarca + IA — design

## 1. Fatos de partida (mapa 2026-11-13)

- Shein cravada: `PROVIDER = 'SHEIN'` em `RunOfferHuntUseCase.ts:35` e `OfferHunterInfoUseCases.ts:18`; porta
  `ISheinCatalogClient` injetada; portões `MARKETPLACE_SHEIN_ENABLED` (`RunOfferHuntUseCase.ts:218`,
  `OfferHunterInfoUseCases.ts:69`); `useHunterRiskAcceptance.ts:21` (`acceptRisk('SHEIN')`); textos Shein em
  `features/offerHunter/strings.ts`.
- `offer_hunts`, `offer_hunt_runs`, `offer_hunt_finds`: sem `provider`. Campos Shein: `goodsId`/`skcCode`/`activityId`,
  `commissionPercent`/`returningCommissionPercent`, `salesBucket`/`reviewsBucket`, `sort Int`, `commissionBand`.
- Genérico e reaproveitável: `HuntFindDelivery` (Resolve + texto + Enqueue), fila, scheduler, teto, aceite por
  (provider, scope), `RankingTable`, privacidade.
- ML hoje: sessão `ssid` cifrada em `affiliate_credentials`; `MercadoLivreAffiliateClient` faz bootstrap
  `GET /afiliados/linkbuilder` (colhe `_csrf`) e chama `/affiliate-program/api/v2/...` (`createLink`, `stripe/user/tags`)
  com `X-Csrf-Token`/`Origin`/`Referer`. Funciona com navegador fechado. **Catálogo/comissão do hub: endpoint
  desconhecido** (nenhuma fonte; `docs/extensao-ml-endpoints.md` só tem `GET /afiliados/hub` 200).
- Comissão ML oficial (página "Como calcular seus ganhos", cópia lida 2026-11-06): venda direta 16% (beleza, moda,
  esportes), 12% (casa, bebês, brinquedos, ferramentas…), 5% (eletrônicos, celulares, informática…), 0% (alimentos);
  "ganhos extras" pagos pelo vendedor somam ao percentual e só aparecem no painel.

### Hub ML observado (2026-11-13, cópia do perfil com Google bloqueado, conta do dono)

- `POST https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop`
  corpo `{"search":"","sort":"relevance","filters":[{"id":"best_seller","value":true}],"offset":0}`; página = 18
  cartões, `next_offset`. Página envia `x-csrf-token` (36 chars) e `x-custom-origin`.
- `filters` da resposta: `category` (25 valores, ex. `MLB5726` Eletrodomésticos), `extra_commission`, `best_seller`;
  `sort`: `relevance` | `lowest_price` | `highest_price`.
- Cartão (`polycards[]`): `metadata.id` (`MLB\d+`, anúncio), `metadata.product_id`, `metadata.url`,
  `metadata.extra_commission`/`brand_commission`; componentes `title`, `price` (`current_price.value`,
  `previous_price.value`, `discount_label`), `review_compacted` (nota + "Mais de 100 produtos vendidos" no `alt_text`),
  `highlight` ("MAIS VENDIDO"), **`affiliates_commission_chip`** (`"GANHOS 12%"` ou `"GANHOS EXTRAS 20%"`), foto por
  `picture_template` em `http2.mlstatic.com`. Fixture sem dado pessoal salva para testes.
- **Comissão vem do hub** (percentual por cartão, extra marcado) → D4 vira fallback raro.
- curl sem cabeçalhos de navegador: `GET /afiliados/hub` = 403 (WAF), sem chegar ao endpoint. Falta a sonda da Render
  com o caminho do cliente de produção (bootstrap `/afiliados/linkbuilder` → `_csrf`; POST com `User-Agent`, `Origin`,
  `Referer`, `X-Requested-With`, `X-Csrf-Token`, iguais aos do `createLink`).
- Efeito colateral na captura: um clique abriu o centro de notificações e marcou notificações da conta como lidas.

## 2. Alternativas avaliadas

| Alternativa | Veredito | Por quê |
|---|---|---|
| A. Lista do hub ML pelo servidor com `ssid` + `_csrf` (mesmo caminho do createLink) | **Escolhida, condicionada ao M0** | Funciona fechado, traz "ganhos"/"ganhos extras" que nenhuma outra fonte tem. Depende de o endpoint responder da Render sem anti-bot. |
| B. API pública `api.mercadolibre.com/sites/MLB/search` + tabela de comissão por categoria | Reserva (se A reprovar) | Oficial e estável, mas sem "ganhos extras" (a melhor oportunidade) e com comissão só estimada; busca pública exige app/token e tem limites próprios. |
| C. Extensão lê o hub no navegador do usuário | Descartada | Dono exige funcionar com navegador fechado (mesma decisão D6 da Shein). |
| D. Ler páginas de produto ML para achar comissão | Descartada | Página não traz comissão; custo e risco anti-bot. |
| E. Clonar perfil do Chrome para sondar | Descartada | Deslogou o Google do dono (memória `nao-clonar-perfil-chrome`); só "Copy as cURL"/HAR do próprio dono. |
| F. Tabela de capacidades no banco | Descartada | Capacidade é código (muda com o cliente da fonte); constante por marca no domínio. |
| G. Uma tabela de caçada por marca | Descartada | Duplica scheduler/teto/histórico; coluna `provider` + campos genéricos basta. |
| H. IA reconfigura filtros a cada busca | Descartada (D5) | Imprevisível, gasta IA por busca, quebra "por que 0 no filtro"; IA só na configuração. |
| I. IA escolhe filtros "às cegas" (sem amostra da fonte) | Descartada para "IA escolhe o produto" | Sem dados reais a IA chuta categoria; 1 chamada de amostra dá base (D6). Com intenção explícita, basta a lista de categorias. |

## 3. Arquitetura

```
Assistente: [Logo da marca] → [IA decide? + intenção] → (IA preenche) → O que caçar → Refino → Quando e onde
                                     │
                     POST /offer-hunts/ai-suggest {provider, intent|null}
                                     ▼
              SuggestHuntConfigUseCase → portões leves → categorias (+ amostra se "IA escolhe")
                     → IAiTextGenerator → JSON → validateAgainstCapabilities → draft + motivos

Execução: RunOfferHuntUseCase (genérico) → IHuntCatalogSource por provider (registry)
      SHEIN → SheinCatalogClient (atual)          MERCADO_LIVRE → MercadoLivreHubClient (novo, M0)
      → HuntCandidate genérico → filtros/pontuação por capacidade → IA ranking → achados → HuntFindDelivery
```

### Domínio

- `HuntProvider = 'SHEIN' | 'MERCADO_LIVRE'`.
- `HuntCapabilities` por marca (constante): `sorts[]`, `sourceFilters` (`keyword`, `category`, `extraEarningsOnly`,
  `bestSellersOnly`, …), `localFilters` disponíveis (`price`, `discount`, `commission`, `rating`, `sales`, `reviews`,
  `extraOnly`, `endsWithin`), `commissionModel` (`NEW_RETURNING` Shein | `BASE_EXTRA` ML), `productIdPattern`.
- `HuntCandidate` generalizado: `productId` (string, padrão por marca), `provider`, `commissionPrimaryPct/Cents`
  (Shein 1ª compra; ML base), `commissionSecondaryPct/Cents` (Shein recompra; ML —), `extraPct/Cents` (Shein extra R$;
  ML ganhos extras %), `commissionEstimated: boolean`, demais iguais (opcionais). Mapeadores por marca.
- `scoreHuntCandidate`: fatores ausentes para a marca saem e a nota é renormalizada para 0–100 (teste de equivalência:
  candidatos Shein dão a mesma nota de hoje).
- Comissão ML estimada: `mercadoLivreCommissionTable.ts` (tabela oficial por categoria raiz, data da leitura).

### Persistência (migrations novas, todas aditivas)

- `offer_hunts.provider` (enum `HuntProvider`, NOT NULL default `SHEIN`); `offer_hunts.sourceOptions Json?` para
  filtros da fonte específicos de marca não representáveis nas colunas (ex.: `extraEarningsOnly`,
  `bestSellersOnly`); colunas atuais mantidas (Shein continua usando).
- `offer_hunt_finds.provider` + `productId` (Shein = `goodsId` copiado no backfill; leitura nova usa `productId`);
  `commissionEstimated`. Índice de repetição passa a `(huntId, provider, productId, createdAt)`.
- `offer_hunt_runs.provider`. `ranking` JSON ganha `provider`/`productId`.
- `offer_hunts.aiConfigured boolean`, `aiIntent text?` (só registro/exibição).

### Portões e aceite

- `requireHuntProviderEnabled(provider)`: SHEIN → `marketplace_shein_enabled`; ML → sempre (D7).
- Aviso de risco `OFFER_HUNTER` por marca: `OFFER_HUNTER_RISK_NOTICE_VERSION.MERCADO_LIVRE = '<data>'`, texto próprio
  no app; `AcceptMarketplaceRiskUseCase` aceita `OFFER_HUNTER` para SHEIN e ML (hoje só SHEIN). Super admin segue
  podendo aceitar no escopo do caçador.

### Cliente ML (`MercadoLivreHubClient`)

- Reusa o bootstrap do `MercadoLivreAffiliateClient` (extrair para helper compartilhado sem mudar comportamento).
- Endpoints, parâmetros e campos **fixados só após o M0**; allowlist de host `www.mercadolivre.com.br`; timeout 8 s;
  corpo ≤ 256 KiB; mesmos erros (`AffiliateCredentialRejectedError`, `AffiliateApiRateLimitedError`,
  `AffiliateApiUnavailableError`); imagem só `http2.mlstatic.com` (https).
- Id do produto: `MLB\d+` (validação); link continua via Resolve (URL `https://produto.mercadolivre.com.br/MLB-<id>`
  ou a URL que o hub devolver, revalidada na allowlist).

### IA de configuração

- `SuggestHuntConfigUseCase` + `AiHuntConfigSuggester` (porta + implementação sobre `IAiTextGenerator`,
  `purpose: 'offer_hunt_config'`). Entrada: marca, capacidades, categorias (nome+id), intenção delimitada como dado não
  confiável, amostra opcional (título ≤ 80, preço, comissão, extra, vendidos, nota — sem id/link). Saída JSON:
  `{ filters, sort, category, keyword, reasons: { campo: frase } }`. Validação estrita por capacidade; campo inválido
  descartado e reportado; nada salvo pela rota (devolve rascunho).
- Rota `POST /api/offer-hunts/ai-suggest` (mesmos hooks + rate limit leve; conta em `ai_requests_per_day`).

### Painel

- Contrato do app: `provider` em `Hunt`, `CreateHuntInput`, `HuntFind`, `HuntRun` (`types.ts`); `initialDraft(hunt)`
  lê a marca; `HuntWizardDraft` ganha `provider` e o passo 0 → `WIZARD_STEPS` 4 e `usePersistedState` **version 3**
  (descarta rascunho antigo). `offerHunterService.getOptions(provider)`; `GET /options?provider=` devolve
  capacidades, categorias, predefinições **daquela marca** (presets filtrados por capacidade) e `gates` da marca. O
  passo 0 chama `GET /options/providers` (novo, leve: estado de gates por marca, sem chamar a fonte) — não N chamadas.
  `HunterGatesPanel` passa a mostrar os gates da marca escolhida.
- Lista de marcas do caçador própria: `HUNT_PROVIDERS = ['SHEIN','MERCADO_LIVRE']` (Shopee/Amazon não aparecem até
  terem fonte). Do `AFFILIATE_PROVIDERS` reusa só `logo`, `name`, `brandColor` (ícones MUI de `highlights` NÃO entram);
  estado em texto + `AppIcon` Lucide. Logo via `MarketplaceLogo` existente
  (`@/features/settings/components/MarketplaceLogo`), sem SVG novo.
- Aviso de risco do caçador por marca: `offerHunterStrings.riskNotice` vira mapa `{ SHEIN, MERCADO_LIVRE }`,
  `OFFER_HUNTER_RISK_NOTICE_VERSION` por marca espelhando a API; `useHunterRiskAcceptance(provider)`; `strings.test.ts`
  trava hash+versão **de cada** marca; `HunterRiskNoticeDialog` recebe `provider`. O aviso Shein de Configurações
  (escopo `AFFILIATE_LINK`, 2026-11-10) não muda.
- Dois interruptores distintos no assistente: **"Deixar a IA decidir os filtros"** (passo 0/1, só configura, AI-01) e
  o existente **"Escolha com IA"** (Refino, ranking por busca). Copy deixa claro: um configura, o outro escolhe a cada
  busca.
- Filtro de comissão no ML: compara o percentual do chip do hub (já inclui ganhos extras quando houver); operadores
  GT/GTE/LT iguais; rótulo por marca ("Comissão de 1ª compra" na Shein, "Comissão" no ML).
- Passo 0 do assistente: grade de logos com estado e CTA; marca escolhida fixa na edição.
- Interruptor "Deixar a IA decidir os filtros" + campo de intenção + "IA escolhe o produto"; botão "Gerar com IA" →
  preenche o rascunho e marca cada campo com a dica da IA; usuário revisa e salva.
- Assistente, chips, recusas e cartões renderizam por capacidade da marca; logo da marca no cartão e no detalhe.
- Strings Shein-específicas viram por marca; aviso de risco por marca; `useHunterRiskAcceptance(provider)`.

## 3b. Ajustes da revisão contra o código (2026-11-13)

- **Marca = `AffiliateProvider`** (subconjunto `HuntProvider = Extract<AffiliateProvider,'SHEIN'|'MERCADO_LIVRE'>`), sem
  enum novo, porque credencial, aceite e Resolve já usam `AffiliateProvider`.
- **Registry por marca** (`IHuntProviderAdapter`): `sessionFrom(credential)` (Shein `{token: AT, memberId}`; ML
  `{ssid}`), `catalog` (porta genérica), `productUrl(productId)` (Shein `https://br.shein.com/product-p-<id>.html`;
  ML `https://produto.mercadolivre.com.br/MLB-<dígitos>` a partir de `metadata.id`), `imageHosts` (`ltwebstatic.com` |
  `mlstatic.com`), `sorts`, capacidades. `HuntFindDelivery.huntProductUrl` e `safeFindImageUrl` do presenter passam a
  usar o adaptador (hoje cravados Shein). Gate de credencial deixa de ler `cookies.AT` direto.
- **Categoria "Todas"**: a porta devolve sempre uma entrada `categoryId: null`; ML a sintetiza (o hub não traz).
  `did` vira detalhe interno do adaptador Shein (opcional na porta).
- **Ordenação por marca**: Shein segue em `sort Int` (códigos atuais); ML guarda em `sourceOptions.sort`
  (`relevance|lowest_price|highest_price`) junto de `extraEarningsOnly`/`bestSellersOnly`. `validateHuntDefinition`,
  `offerHunt.schema.ts` (body e enum) e `PrismaOfferHuntMapper` validam por marca.
- **Etiqueta ML**: a caçada usa a **etiqueta ativa/principal** da conta (a URL de produto não tem `matt_word`); texto de
  MM-06/AC2 corrigido. Escolher etiqueta por caçada fica fora do escopo.
- **Comissão**: `commissionPrimaryPct` = Shein 1ª compra | ML percentual do chip (já inclui extra) com `extraFlag`;
  `commissionSecondaryPct` só Shein. Valor esperado: com secundária, 70/30 como hoje; sem secundária, 100% da
  primária. Fator de urgência ML usa `extraFlag` (+ % convertido em R$ pelo preço). Filtro de comissão lê a primária.
  Teste de equivalência garante notas Shein iguais.
- **Schemas e presenter** (`offerHunt.schema.ts`, `OfferHuntPresenter.ts`): body aceita `provider`/`sourceOptions`/
  `aiConfigured`; respostas incluem `provider`, `productId`, `commissionEstimated`, `aiConfigured` (Fastify descarta
  fora do schema). Entra em T2/T3/T11/T13.
- **Aceite fail-closed no caçador**: para escopo `OFFER_HUNTER`, marca sem versão de aviso = bloqueado (hoje versão
  nula passa). T4 (aviso ML) vem antes de qualquer caçada ML rodar.
- **403 do WAF ≠ sessão recusada**: no cliente do hub, só redirect para login (ou 401) = `rejected`; 403 sem redirect =
  fonte indisponível (não pausa a loja; conta nas 3 falhas). O helper de bootstrap compartilhado não muda para o
  `createLink`.
- **Repetição por `provider + productId`**: `withoutRepeats` e `recentGoodsIds` (`PrismaOfferHuntFindRepository`)
  trocados junto do índice; teste da corrida no descartável.
- **`ai-suggest`**: chamada à fonte (categorias/amostra) só com os portões completos (plano, caçador, credencial,
  aceite); sem eles a IA trabalha só com as capacidades e a intenção, sem amostra.
- **D3 = 10/dia somado** (decidido): sem migration de teto.

## 4. Riscos

| Risco | Tratamento |
|---|---|
| Endpoint do hub ML exige anti-bot ou não responde da Render | Portão M0; reprovou → alternativa B (decisão do dono) ou ML fica fora do caçador. |
| Termos ML proíbem automação | Aviso próprio + aceite (D2); orçamento baixo de chamadas; pausa automática. |
| Regressão Shein ao generalizar | Testes de equivalência (mesmas notas, mesmos filtros, mesmas rotas); backfill `provider=SHEIN`. |
| IA inventa filtro/categoria | Validação por capacidade + categorias reais; usuário confere antes de salvar. |
| Comissão estimada errada | Marcada "estimada" na tela; tabela com data da leitura; preferir dado do hub. |

## 5. Versões e docs

api 0.95.0 · app 0.118.0. `docs/cacador-de-ofertas.md` (multimarca, capacidades, IA), `docs/extensao-ml-endpoints.md`
(endpoints do hub observados no M0), `docs/integracoes-credenciais-afiliado.md` (aviso ML), roadmap item 17.
