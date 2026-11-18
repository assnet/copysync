# Contrato do uso dos recursos

Fixtures que amarram a API e o painel sem import entre `api/` e `app/` (`.specs/features/usage-metrics/design.md` §5, D16).

| Arquivo | O que é |
| --- | --- |
| `summary.response.json` | Exemplo completo de `GET /admin/usage/summary` |
| `feature-detail.response.json` | Exemplo completo de `GET /admin/usage/features/:featureKey` (`inScope: false` = tipo/plano excluem o recurso; resposta zerada) |
| `feature-tenants.response.json` | Exemplo completo de `GET /admin/usage/features/:featureKey/tenants` (nomes fictícios) |
| `summary.daily.response.json` / `feature-detail.daily.response.json` | Os mesmos, lidos do agregado diário: `source: "daily"`, `range.maxDays: 400` e `freshAt` = último tick bem-sucedido do job (`lastSuccessAt`, menos de 45 min) |
| `screens.response.json` | Exemplo completo de `GET /admin/usage/screens` (P3; uma linha por tela, sem conta) |
| `catalog.json` | Chaves de recurso (`featureKeys`), códigos de `coverageReasons` (`coverageReasonCodes`), motivos da leitura direta (`liveReasonCodes`) e telas medidas por visita (`screenKeys`, P3, com o produto de cada uma em `screenProducts`, separadas das chaves de recurso; rótulo das strings de navegação) e recursos só de conta interna (`internalOnlyFeatures` = `INTERNAL_ONLY_FEATURES` da api; hoje o Chat, cujo menu é só de super admin) |

- **Valida (api):** o teste do catálogo compara `catalog.json` com `FEATURE_USAGE_CATALOG`; o teste do catálogo de telas compara `screenKeys` com `SCREEN_VIEW_CATALOG`; o teste do presenter compara as respostas com os seis exemplos (mesmas chaves e tipos em todos os níveis).
- **Valida (api):** o teste de elegibilidade compara `internalOnlyFeatures` com `INTERNAL_ONLY_FEATURES`.
- **Consome (app):** os testes de `features/featureUsage` exigem texto para cada chave e código e validam os exemplos contra `types.ts`; o teste do menu exige o item do Chat `superAdminOnly` enquanto `chat_send` estiver em `internalOnlyFeatures` (e o contrário).
- Os testes leem os arquivos por caminho (`fs`). Nada daqui entra em build, imagem ou código de produção.
- P3: o resumo traz `eligibleTenants`, `adoption`, `adoptedTenants`, `usedWithoutEligibility`, `recurringTenants` e `retainedTenants` preenchidos (`adoption`/`retainedTenants` podem ser `null`); no detalhe os seis seguem `null`. `adoption = adoptedTenants ÷ eligibleTenants` (só quem usou e tem direito; nunca passa de 1); quem usou sem direito vem em `usedWithoutEligibility`.
- Resumo e detalhe trazem `liveReason` (por que leu direto nas tabelas de origem: `NO_AGGREGATE`, `NOT_COVERED`, `STALE`, `PENDING`); `null` com `source: "daily"` e no detalhe fora do recorte.
- Dados fictícios. Mudou o contrato? Atualize estes arquivos no mesmo commit.
