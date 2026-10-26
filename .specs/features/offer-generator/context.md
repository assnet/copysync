# Gerador de ofertas — Context

**Gathered:** 2026-10-26 · **Spec:** `spec.md` · **Status:** Ready for design

## Feature Boundary

Colar link → oferta montada com o link de afiliado do tenant → revisar → enviar aos destinos
pré-selecionados. Espelhamento de grupo é outro recurso (`../broadcast-mirror/context.md`).

## Implementation Decisions

### Marketplaces
- Shopee automática pela Affiliate Open API (`productOfferV2` + `generateShortLink`).
- Amazon: link `dp/{ASIN}?tag=` automático; dados do produto pelo operador.
- Mercado Livre: `matt_word` anexado (atribuição **não verificada**, o painel avisa); dados pelo operador.
- Extensão lendo DOM e endpoint interno do ML ficam para P3.

### Envio
- Gerador envia **direto** para conversas selecionadas previamente na própria tela (lista de destinos do gerador).
- Destinos podem ser de qualquer sessão do tenant; cada envio sai pela sessão da conversa.
- Envio espaçado com intervalo configurável (padrão 8–15 s aleatório); estado no banco.

### Persistência e limite
- Tabela `Offer` (histórico) + `OfferDispatch` (envio por destino).
- `offer_generations_per_day` lido de `TenantEntitlement`; ausente/`null` = ilimitado; `PLAN_LIMIT_REACHED`.

## Agent's Discretion
- Códigos de erro, nomes de tabela, modelo de texto padrão, layout da tela.

## Deferred Ideas
- Unificar destinos do gerador com "Grupos de disparo" (item 5) quando existir.
- Agendar envio no horário de postagem (item 6).
