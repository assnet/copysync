# Caçador de Ofertas multimarca + configuração por IA — spec

Estado: **plano; portão M0 aprovado (captura + sonda da Render, 2026-11-13); D1–D7 decididas; em implementação**. Base: api 0.94.0 · app 0.117.0
(`feature/rebranding-app`, caçador Shein em produção de prévia). Doc atual: `docs/cacador-de-ofertas.md`.

## Objetivo

1. O caçador deixa de ser só Shein: cada caçada escolhe a **marca** pela logo (Shein, Mercado Livre; depois Shopee/Amazon)
   e o resto do fluxo (portões, filtros, pontuação, IA, entrega, teto, job) funciona por marca.
2. **Mercado Livre** entra como segunda fonte, lendo a lista "Produtos selecionados para você" do painel de afiliados
   (`/afiliados/hub`) pelo servidor, com a sessão já guardada (`ssid`), com o navegador fechado.
3. **IA configura a caçada em 3 cliques**: marca → "deixar a IA decidir" → intenção (ex.: "moda feminina barata") ou
   "IA escolhe o produto". A IA preenche todos os filtros válidos daquela marca.

## Requisitos

### Multimarca (MM)

- **MM-01** Caçada tem `provider` (SHEIN | MERCADO_LIVRE). Caçadas existentes = SHEIN (backfill).
- **MM-02** Primeiro passo do assistente: escolher a marca por **logo** (`AFFILIATE_PROVIDERS`, `MarketplaceLogo`), com
  estado de cada uma (conectada, sem conta, sem plano, sem aceite) e link para resolver.
- **MM-03** Cada marca declara suas **capacidades** (filtros e ordenações que a fonte oferece). O assistente, os chips
  e a explicação de recusas mostram **só** os filtros que a marca suporta. Filtros locais universais (preço, desconto,
  comissão, nota quando houver) ficam disponíveis onde o dado existir.
- **MM-04** Teto diário de ofertas garimpadas é **um só por conta**, somando todas as marcas (D3, decidido
  2026-11-13): **10 por dia no MAX** (valor atual, `offer_hunter_finds_per_day`, editável por plano no admin). Guarda de
  24 buscas/dia e de 10 reenvios/dia seguem por conta, somando marcas.
- **MM-05** Portões por marca: plano da marca (SHEIN: `marketplace_shein_enabled`; ML: sem chave hoje) → caçador
  (`offer_hunter_enabled`) → credencial da marca → aceite do aviso do caçador **daquela marca** → saldo.
- **MM-06** Achado, ranking e histórico guardam a marca; o link segue só via `ResolveAffiliateProductUseCase` (ML com
  a etiqueta ativa da conta).
- **MM-07** Repetição (não reenviar o mesmo produto) é por marca + id do produto.

### Mercado Livre (ML)

- **ML-01** Cliente do catálogo do hub ML (`IMercadoLivreHubClient`) atrás da mesma porta genérica de catálogo; endpoints
  fixos descobertos no portão M0, só host `www.mercadolivre.com.br`, sessão `ssid` + bootstrap `_csrf` já existentes.
- **ML-02** Filtros da fonte ML (os que o hub tem): busca por palavra, "Ganhos extras", "Mais vendidos", categoria,
  ordenação (mais relevantes, menor preço, maior preço). Paginação até 3 páginas por busca.
- **ML-03** Comissão ML por produto: `ganhos` (percentual base) e `ganhos extras` quando a resposta do hub trouxer;
  valor em R$ = preço × percentual. Se o hub não trouxer, **estimativa pela tabela oficial por categoria** (venda direta)
  marcada como "estimada" na tela (D4).
- **ML-04** Pontuação: comissão (base + extra), prova social (vendidos, nota), preço/desconto, urgência (extra). Mesmos
  pesos totais; fatores que a marca não tem ficam fora e a nota é renormalizada.
- **ML-05** Erros: sessão recusada (login/redirect) → credencial `rejected` + pausa; 429 → fonte indisponível; formato
  inesperado → indisponível. Nunca forjar headers anti-bot nem ler página de produto além do que já existe.
- **ML-06** Aviso de risco do caçador para ML (texto próprio, versão própria, mesmo escopo `OFFER_HUNTER`) (D2).

### Configuração por IA (AI)

- **AI-01** No assistente, depois da marca: interruptor **"Deixar a IA decidir os filtros"** (padrão desligado).
- **AI-02** Ligado: um campo de intenção curto (≤ 120 chars) **ou** a opção "IA escolhe o produto" (sem intenção).
- **AI-03** A IA recebe: marca, capacidades, categorias reais da fonte (lidas na hora), a intenção (dado não confiável)
  e — quando "IA escolhe o produto" — a amostra larga da D6 (até 5 consultas à fonte, 40 itens compactos sem link/token +
  resumo por categoria). Devolve JSON com os filtros; o servidor **valida** contra as capacidades (campo inválido
  descartado) e devolve o rascunho preenchido para o usuário conferir e salvar (nada é salvo sem clique).
- **AI-04** A IA explica em 1 frase por que escolheu cada filtro (exibido como dica).
- **AI-05** Falha da IA ou saída inválida: o assistente segue manual, com aviso. Usa `IAiTextGenerator` (conta em
  `ai_requests_per_day`), sem provedor configurado a opção fica desligada com explicação.
- **AI-06** (D5) A configuração da IA vale para a caçada como foi salva; a IA **não** muda filtros sozinha nas buscas
  seguintes (o ranking por IA por busca continua como hoje).

## Fora do escopo

Shopee/Amazon como fonte (próximo passo, mesma porta) · comissão "venda indireta" · ler página de produto ML para
comissão · reconfiguração automática periódica pela IA · forjar headers ou contornar desafio.

## Decisões pendentes do dono

| # | Pergunta | Recomendação |
|---|---|---|
| D1 | Captura do endpoint do hub ML (M0): você exporta do DevTools o "Copy as cURL" da chamada que carrega "Produtos selecionados" (com filtros Ganhos extras / Mais vendidos / categoria / ordenação / busca / página 2), e eu sondo da Render com o `ssid`? | Sim (sem clonar perfil do Chrome). |
| D2 | ~~Aviso de risco próprio do caçador para ML?~~ **Decidido 2026-11-13: sim, aceite separado por marca.** | — |
| D3 | ~~Teto por conta ou por marca?~~ **Decidido 2026-11-13: 10 ofertas/dia por conta, somando marcas.** | — |
| D4 | **Decidido:** tabela por categoria só como reserva, marcada "estimada". | — |
| D5 | **Decidido:** IA só na criação/edição; usuário confere e salva. | — |
| D6 | **Decidido (2026-11-13):** "IA escolhe o produto" lê amostra larga: até 5 consultas à fonte (mais vendidos, ganhos extras, geral e 2 categorias), ~90 itens; vão à IA os 40 melhores pela nota + resumo por categoria. Teto 5 sugestões de IA/dia por conta. | — |
| D7 | **Decidido:** caçador em qualquer marca exige o MAX (`offer_hunter_enabled`); ML sem chave extra. | — |

## Critérios de aceite

1. Assistente abre com as logos; escolher Shein mostra só filtros Shein; escolher ML mostra só filtros ML.
2. Caçada ML busca no servidor com o navegador fechado, ranqueia e envia o link do tenant (com a etiqueta ativa da conta).
3. Card ML mostra comissão base e "ganhos extras"; estimada aparece marcada.
4. Com "deixar a IA decidir" + intenção "moda feminina barata", o assistente volta preenchido com filtros válidos da
   marca e a explicação; salvar cria a caçada.
5. Teto de 10/dia somado entre as marcas; a 11ª oferta do dia é bloqueada qualquer que seja a marca.
6. Caçadas Shein antigas seguem funcionando idênticas (regressão).
