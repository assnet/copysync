# Contrato do uso dos recursos

Fixtures que amarram a API e o painel sem import entre `api/` e `app/` (`.specs/features/usage-metrics/design.md` §5, D16).

| Arquivo | O que é |
| --- | --- |
| `summary.response.json` | Exemplo completo de `GET /admin/usage/summary` |
| `feature-detail.response.json` | Exemplo completo de `GET /admin/usage/features/:featureKey` (`inScope: false` = tipo/plano excluem o recurso; resposta zerada) |
| `feature-tenants.response.json` | Exemplo completo de `GET /admin/usage/features/:featureKey/tenants` (nomes fictícios) |
| `summary.daily.response.json` / `feature-detail.daily.response.json` | Os mesmos, lidos do agregado diário: `source: "daily"`, `range.maxDays: 400` e `freshAt` = último tick bem-sucedido do job (`lastSuccessAt`, menos de 45 min) |
| `catalog.json` | Chaves de recurso (`featureKeys`) e códigos de `coverageReasons` (`coverageReasonCodes`) |

- **Valida (api):** o teste do catálogo compara `catalog.json` com `FEATURE_USAGE_CATALOG`; o teste do presenter compara as respostas com os três exemplos (mesmas chaves e tipos em todos os níveis).
- **Consome (app):** os testes de `features/featureUsage` exigem texto para cada chave e código e validam os exemplos contra `types.ts`.
- Os testes leem os arquivos por caminho (`fs`). Nada daqui entra em build, imagem ou código de produção.
- Dados fictícios. Mudou o contrato? Atualize estes arquivos no mesmo commit.
