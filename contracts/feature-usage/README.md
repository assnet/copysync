# Contrato do uso dos recursos

Fixtures que amarram a API e o painel sem import entre `api/` e `app/` (`.specs/features/usage-metrics/design.md` §5, D16).

| Arquivo | O que é |
| --- | --- |
| `summary.response.json` | Exemplo completo de `GET /admin/usage/summary` |
| `feature-detail.response.json` | Exemplo completo de `GET /admin/usage/features/:featureKey` (`inScope: false` = tipo/plano excluem o recurso; resposta zerada) |
| `feature-tenants.response.json` | Exemplo completo de `GET /admin/usage/features/:featureKey/tenants` (nomes fictícios) |
| `summary.daily.response.json` / `feature-detail.daily.response.json` | Os mesmos, lidos do agregado diário: `source: "daily"`, `range.maxDays: 400` e `freshAt` = último tick bem-sucedido do job (`lastSuccessAt`, menos de 45 min) |
| `screens.response.json` | Exemplo completo de `GET /admin/usage/screens` (P3; uma linha por tela, sem conta) |
| `catalog.json` | Chaves de recurso (`featureKeys`), códigos de `coverageReasons` (`coverageReasonCodes`) e telas medidas por visita (`screenKeys`, P3, separadas das chaves de recurso; rótulo das strings de navegação) |

- **Valida (api):** o teste do catálogo compara `catalog.json` com `FEATURE_USAGE_CATALOG`; o teste do catálogo de telas compara `screenKeys` com `SCREEN_VIEW_CATALOG`; o teste do presenter compara as respostas com os seis exemplos (mesmas chaves e tipos em todos os níveis).
- **Consome (app):** os testes de `features/featureUsage` exigem texto para cada chave e código e validam os exemplos contra `types.ts`.
- Os testes leem os arquivos por caminho (`fs`). Nada daqui entra em build, imagem ou código de produção.
- P3: o resumo traz `eligibleTenants`, `adoption`, `recurringTenants` e `retainedTenants` preenchidos (`adoption`/`retainedTenants` podem ser `null`); no detalhe os quatro seguem `null`.
- Dados fictícios. Mudou o contrato? Atualize estes arquivos no mesmo commit.
