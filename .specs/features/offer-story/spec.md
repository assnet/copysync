# Story de Oferta — Especificação

Roadmap item 11 (`docs/produto-roadmap.md`, chave `offer_story_enabled`). Termo de produto: **Story de Oferta**
(vitrine de planos: "Template para Instagram"). Nome técnico: `offer-story` (API) / `offerStory` (painel).
Decisões e alternativas: [`context.md`](context.md). Referência visual: prints do Redirect Flow de 2026-10-29.

## Problema

Afiliado que divulga no Instagram monta story de oferta à mão (Canva, print do produto, preço digitado). Leva
minutos por oferta e erra preço. Colar o link e receber a arte pronta, no padrão do story, tira esse trabalho.

## Objetivos

- [ ] Tenant Business sai do link colado à arte baixada/compartilhada em menos de 30 s
- [ ] Arte nunca mostra preço inventado: tudo vem do produto extraído ou do desconto digitado
- [ ] Quem não é Business vê o convite de upgrade, nunca a tela

## Fora de escopo (v1)

| Item | Motivo |
| --- | --- |
| Postar direto no Instagram | API do Instagram não publica story de conta pessoal; usamos Web Share/download |
| Histórico de artes | Arte é descartável; sem storage com TTL |
| Editar título/preço antes de gerar | v1 usa o extraído; fase 2 |
| Link do tenant gerado para Shopee | Fase 2 (vitrine já faz; ver `context.md` #4) |
| Templates do tenant (upload de fundo) | Fase 2 |
| Formato feed (1080×1350) | Fase 2; renderer recebe o tamanho por template |

## Histórias

### P1: Acesso por plano ⭐ MVP

1. WHEN tenant com `offer_story_enabled = true` abre `/offer-story` THEN painel SHALL mostrar o assistente
2. WHEN `offer_story_enabled` não é `true` (false ou ausente) THEN toda rota `/api/offer-story/*` SHALL responder
   `403 PLAN_FEATURE_UNAVAILABLE` e o painel SHALL redirecionar para `/plans?feature=offerStory`
3. WHEN `/plans` abre com `feature=offerStory` THEN SHALL mostrar "Faça upgrade e crie stories de oferta para o
   Instagram, exclusivo do plano Business"
4. Item de menu "Story de Oferta" visível para todos, com selo "Business"

### P1: Passo 1 — Template ⭐ MVP

1. Grade de templates (thumbnail 9:16, nome no tooltip), abas "Todos (n)" e "Favoritos (n)"
2. Estrela no card liga/desliga favorito (persistido no navegador); aba Favoritos vazia mostra estado vazio com dica
3. Clicar seleciona (borda + check); "Continuar" desabilitado sem seleção

### P1: Passo 2 — Produto ⭐ MVP

1. Campo "Link do produto" obrigatório, com ajuda "Use o link do PRODUTO (não da vitrine/loja). Mercado Livre,
   Shopee ou Amazon"
2. `Switch` "Tem cupom?"; ligado mostra "Código" (obrigatório, ≤ 20, letras/números/`_ . -`/espaço, igual ao gerador) e "Desconto (%)" (inteiro 1–90, opcional)
3. "Voltar" mantém os campos; "Gerar arte" chama a API e mostra overlay "Gerando sua arte… Analisando o produto e
   montando o story"
4. WHEN link inválido/sem produto/de outro afiliado THEN SHALL mostrar a mensagem do erro no campo
   (`OFFER_URL_UNSUPPORTED`, `OFFER_LINK_NOT_OWNED`, `OFFER_LINK_NOT_AFFILIATE`, `OFFER_STORY_PRODUCT_INCOMPLETE` "Não conseguimos ler o nome do produto; tente o link da página do produto") e ficar no passo 2

### P1: Passo 3 — Compartilhar ⭐ MVP

1. Arte em moldura de celular, "Sua arte está pronta"
2. "Compartilhar no Stories" só aparece quando `navigator.canShare({ files })` é verdadeiro; envia o JPEG pelo
   Web Share
3. "Baixar imagem" sempre (`story-oferta-<data>.jpg`)
4. "Copiar link" copia `affiliateUrl` (para o sticker de link); com `attributionVerified = false` mostra o selo
   "comissão não verificada"
5. Avisos não bloqueantes: sem foto do produto, sem preço, título por IA indisponível (usou o original)
6. "Editar" volta ao passo 2 com campos; "Nova arte" limpa tudo e volta ao passo 1

### P2: Título curto com IA

1. WHEN IA disponível THEN título SHALL ser encurtado (≤ 60, sem preço/emoji/aspas)
2. WHEN IA indisponível, com erro ou resposta inválida THEN SHALL usar o título original com corte em 3 linhas,
   `warnings` contém `AI_FALLBACK`, arte gerada mesmo assim

## Regras de preço (função pura, testada)

| Entrada | "De" (riscado) | "Por" |
| --- | --- | --- |
| sem desconto, `original > price` | `original` | `price` |
| sem desconto, sem `original` maior | — | `price` |
| desconto `d%` | `original` se `original > price`, senão `price` | `round(price × (100 − d) / 100)` |
| `price` nulo | — | — (bloco de preço omitido, `warnings: ['NO_PRICE']`) |

Cupom com código mostra selo "CUPOM: <CÓDIGO>"; desconto sem código é rejeitado (`400`).

## Critérios de pronto

- Gate, preço, cupom, template inexistente, fallback da IA e da foto cobertos por teste de use case
- Arte 1080×1920 validada por teste do adapter (dimensão, JPEG) e no Docker Alpine (spike T1)
- Painel: claro/escuro/sistema, flags de privacidade, estado do assistente sobrevive a reload, textos em `strings.ts`
- QA visual com agent-browser nos 3 passos, desktop e celular
