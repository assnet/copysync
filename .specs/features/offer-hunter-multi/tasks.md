# Caçador multimarca + IA — tasks

Cada tarefa: commit atômico, `tsc --noEmit` api/app, testes da área. Migrations nunca locais (`api/.env` = produção);
SQL em Postgres descartável. `[P]` = pode rodar em paralelo.

## Estado (2026-11-13)

T1–T16 feitos (api 0.95.0 · app 0.118.0, commits f5775376..HEAD): núcleo multimarca, hub ML, aviso por marca,
IA de configuração, painel, conferência visual e duas rodadas de revisão (api e app) com correções. Pendente: T17
(smoke do dono na Render) e confirmar o formato do filtro de categoria do ML (`{"id":"category","value":"MLB…"}`, suposto).

## Fase 0 — Portões

- **M0** ~~Captura do hub~~ feita 2026-11-13 (design §1 "Hub ML observado"). **Sonda da Render aprovada
  (2026-11-13)**: bootstrap `linkbuilder` 200 com `_csrf`; `POST /affiliate-program/api/hub/search` 200 com 18 cartões
  em "mais vendidos", "ganhos extras" e busca "vestido" (45–51 KB), mesmos headers do `createLink`, só `ssid`.
- **M0b** Decisões D1–D7.
- **M0c** Roadmap: item 17 vira multimarca.

## Fase 1 — Generalizar sem mudar comportamento (Shein)

- **T1** Domínio: `HuntProvider`, `HuntCapabilities` (Shein preenchida), `HuntCandidate` genérico + mapeador Shein,
  `scoreHuntCandidate` com fatores por capacidade e renormalização (teste de equivalência Shein). [P com T2]
- **T2** Migration aditiva: `provider` em hunts/runs/finds, `productId`, `commissionEstimated`, `sourceOptions`,
  `aiConfigured`/`aiIntent`, backfill SHEIN, índice de repetição; `migrate diff` vazio no descartável. [P com T1]
- **T3** Porta `IHuntCatalogSource` + registry por marca; `SheinCatalogClient` adaptado; `RunOfferHuntUseCase` e
  `OfferHunterInfoUseCases` sem `PROVIDER` fixo; portão de marca; repetição por marca+produto. Regressão: toda a suíte
  do caçador Shein igual.
- **T4** Aceite `OFFER_HUNTER` por marca (SHEIN + ML), versão ML, fail-closed sem versão, `useHunterRiskAcceptance(provider)`.
  Precede qualquer gate ML (design §3b).

## Fase 2 — Mercado Livre (depende de M0 aprovado)

- **T5** Helper de bootstrap ML compartilhado (extraído de `MercadoLivreAffiliateClient`, testes atuais verdes).
- **T6** `MercadoLivreHubClient` + mapeador → `HuntCandidate` (comissão base/extra, estimada pela tabela quando faltar),
  capacidades ML; testes com fixtures do M0 (corpo exato, erros, allowlist de imagem). `docs/extensao-ml-endpoints.md`.
- **T7** `mercadoLivreCommissionTable.ts` + teste. [P com T6]
- **T8** Entrega ML ponta a ponta: URL de produto pelo adaptador, Resolve com a etiqueta ativa da conta, `HuntFindDelivery` com `provider`; integração no
  descartável.

## Fase 3 — IA de configuração

- **T9** `AiHuntConfigSuggester` (prompt, validação por capacidade, intenção como dado não confiável) + testes. [P após T1]
- **T10** `SuggestHuntConfigUseCase` + `POST /offer-hunts/ai-suggest` (amostra opcional, rate limit, conta IA) + testes.

## Fase 4 — Painel

- **T11** Passo 0 com logos e estado por marca; `GET /options?provider=`; assistente/chips/recusas por capacidade.
- **T12** "Deixar a IA decidir" + intenção + "IA escolhe o produto" → preenche rascunho com dicas; revisar e salvar.
- **T13** Cartão/detalhe/ranking com logo e comissão ML ("estimada"); strings por marca; privacidade.
- **T14** Conferência visual (agent-browser, descartável, claro/escuro/celular).

## Fase 5 — Fecho

- **T15** Docs, CHANGELOG, versões api 0.95.0 / app 0.118.0.
- **T16** `/caveman-review` do diff (api + app) e correções até restar nit.
- **T17** Smoke do dono na Render: caçada ML real com navegador fechado.

## Dependências

M0 bloqueia a Fase 2 inteira (T5–T8). Fases 1 e 3 podem andar já. T11–T13 dependem de T3 (e T6 para a parte ML).
