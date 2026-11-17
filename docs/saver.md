# Saver

O Saver lê os membros dos grupos de WhatsApp do cliente e salva cada contato uma única vez numa base da
plataforma, vinculado ao grupo e à data e hora da extração. Depois exporta CSV ou vCard. O tenant só vê contagens e
recebe o arquivo; ele nunca navega nos contatos. Produto `SAVER` do [acesso por produto](acesso-por-produto.md),
roadmap item 18. Plano e decisões: `.specs/features/saver/` (`context.md` resume as decisões do dono).

Estado (api 0.100.0 · app 0.123.0): **API e painel prontos** (`api/src/modules/saver/`; painel `/saver` Grupos, `/saver/settings`,
`/saver/plans` e `/admin/saver` Base de contatos). QA visual feito em banco descartável. Smoke com sessão real ainda não foi
feito: a taxa real de membros com nome e com número fica para o T28 (ação do dono).

## Planos e limites

Planos `SAVER_LITE/PRO/MAX` (`tenants/domain/planPresets.ts`, `SAVER_PLAN_PRESETS`). Na central: slugs
`copysync-saver-{lite|pro|max}-{mensal|anual}` e permissão `SAVER_{TIER}` no snapshot.

| Chave | LITE | PRO | MAX |
| --- | --- | --- | --- |
| `saver_groups` (grupos salvos) | 10 | 50 | ilimitado |
| `saver_contacts` (contatos distintos do tenant) | 10.000 | 50.000 | ilimitado |
| `saver_group_scans_per_day` (leituras em 24 h corridas) | 20 | 100 | 500 |
| `saver_auto_refresh_enabled` (atualização diária) | não | sim | sim |
| `whatsapp_sessions` / `telegram_sessions` (compartilhadas) | 1 / 0 | 1 / 0 | 2 / 0 |

- Leituras/dia e atualização diária: valores propostos no design, **adotados em 2026-11-17**. O teto de 500 no MAX
  protege o número do cliente; não é limite comercial. A execução diária em si é P2 (T29).
- Chave `saver_*` **ausente = 0/desligado**; ilimitado = JSON `null` explícito no preset. O Saver lê por
  `IEntitlementSnapshotReader.readAll` + `saverLimits.ts`, nunca pela regra "ausente = ilimitado" do resto do projeto.
- Contatos distintos: vínculo já existente não consome; contato da base que ganha o primeiro vínculo deste tenant
  consome. Ao estourar → 403 `PLAN_LIMIT_REACHED`.
- **Plano de Afiliados nunca dá Saver**: o produto exige linha `SAVER` ativa (cobrança ou concessão manual
  `PUT /admin/tenants/:tenantId/products/SAVER`). As compartilhadas só são gravadas pelo merge do acesso por produto.
- Preço: só vitrine (`features/saver/plans/catalog.ts`, a criar), nunca no banco. Valores em
  [`produto-roadmap.md`](produto-roadmap.md#planos-do-saver-decisões-de-2026-11-10-2026-11-11-e-2026-11-17).

## Audiência "Só super admin"

- Chave `saver` em `platform_settings.feature_audience`, lida a cada pedido. Valor inicial: env `SAVER_AUDIENCE`
  (`super_admin` padrão | `entitled`); depois só a flag "Só super admin" em `/admin/plan-entitlements` manda (linha
  "Saver" sem colunas de plano). Não ler a env em código novo.
- `saverAudienceHook` roda depois do gate de produto em `/saver/*`: audiência ligada e usuário não super admin → 403
  `SAVER_UNAVAILABLE`. Sem produto, antes vale `PRODUCT_UNAVAILABLE`.
- `GET /saver/access` (só `authHook`) diz ao painel se o item aparece. Não olha entitlement: o cadeado vem do produto.
- Super admin passa o gate de produto e a audiência (piloto no próprio tenant sem plano).

## Permissões

`saver/domain/services/saverPermissions.ts` (`canSaver`), checado no use case. `ADMIN`/`SUPER_ADMIN`: ver, extrair,
exportar, configurar. `OPERATOR`: ver e extrair; exportar só com liberação.

**Liberação de exportar**: tabela `saver_export_grants`, FK composta para `user_tenants` com cascade (sair do tenant
apaga a liberação). Só `ADMIN` liga/desliga (`GET /saver/permissions`, `PUT /saver/permissions/:userId`); alvo tem de
ser `OPERATOR` do mesmo tenant. `AuditLog SAVER_PERMISSION_CHANGED` só com ids. Sem RBAC geral.

## Rotas

`/saver/*` (`authHook`, `tenantHook`, gate `SAVER`, audiência): `GET /overview` (limites, uso, permissões efetivas,
config, `queueRunning`), `GET /sessions/:sessionId/groups`, `POST /extractions` (1–50 grupos),
`GET /extractions/:id`, `POST /extractions/:id/cancel`, `GET /groups`, `DELETE /groups/:id` (remoção lógica),
`GET|PUT /permissions…`, `POST /exports`, `GET|PUT /config`. Nenhuma rota de tenant devolve nome, telefone ou LID em JSON.

## Base de contatos da plataforma

- `saver_contacts` **não tem `tenantId`**: um contato por pessoa, `phone` e `lid` únicos no banco. O tenant chega aos
  contatos só por `saver_group_memberships`/`saver_groups` filtrando `tenantId` (repositórios separados:
  `ISaverMembershipRepository` × `IPlatformSaverContactRepository`).
- O vínculo guarda o nome **como lido no grupo do tenant**, `isAdmin`, primeira e última extração e a extração que
  leu. A exportação do tenant usa esse nome, nunca `contact.name` (que pode vir de outro tenant).
- Telefone é o dado principal: leitura só preenche campo vazio; nunca apaga nem troca telefone guardado. Fusão só
  quando a mesma leitura traz LID e telefone que estavam em contatos distintos; nunca por nome.
- **Só super admin**: `/admin/saver/*` (`authHook` + `saverSuperAdminHook`, fora do gate de produto):
  `GET /contacts` (busca, tenant, período; **cursor keyset assinado**, escopo = hash dos filtros; inválido = 400,
  nunca offset), `GET /contacts/:id` (vínculos: tenant, grupo, data e hora), `POST /exports` (CSV por stream).
  Toda consulta grava `SAVER_PLATFORM_VIEWED`; exportação grava `SAVER_PLATFORM_EXPORTED` com filtros e contagem.

## Exportação do tenant

`POST /saver/exports` `{ format: CSV|VCARD, groupIds | "all", options }` → `ExportSavedContactsUseCase`.

- Permissão, validação e `COUNT` antes do primeiro byte; nada a exportar → 422.
- Stream (`Readable.from` de gerador keyset em lotes de 1.000), sempre: o MAX não tem teto de contatos.
- CSV: `Nome,Telefone,LID,Extraído em` (+ `Grupo` com uma linha por grupo); fórmulas neutralizadas; datas em
  `America/Sao_Paulo`. vCard pula quem não tem telefone. Opções: prefixo no nome, remover administradores.
- `AuditLog SAVER_EXPORTED` com formato, filtros e quantidade; nunca nome ou número.

## Extração (job)

- Pedido grava `saver_extractions` + itens `QUEUED` numa transação; valida `saver_groups` e leituras/dia; ignora grupo
  já pendente (índice único parcial).
- `SaverExtractionJob` (tick 2 s, sem sobreposição) pega só sessões com lease vivo **deste processo** e sem
  `deletedAt`; claim de 1 item por `FOR UPDATE SKIP LOCKED`. Ritmo: 1 grupo a cada 3–5 s por sessão, guardado em
  `saver_session_states` (banco, não memória). `engine.getGroupMembers` não busca foto nem usa `groupMetadataCache`.
- Antes de ler, sem produto `SAVER` ativo → itens do tenant cancelados.
- Manutenção 1×/h sob o lease `saver-maintenance`: `CloseOrphanSaverExtractionsUseCase`. Nenhum job apaga contato.
- Flag `SAVER_EXTRACTION_WORKER_ENABLED` (padrão `false`; `.env` aponta para produção). **Ligar no `http` e no
  `worker`**: o job só sobe no `worker` (`jobs.has('saverExtraction')`), mas `queueRunning` do resumo, servido pelo
  `http`, lê a mesma flag. Desligada = aviso "fila parada" no painel.

## Erros e pausas

| Caso | Tratamento |
| --- | --- |
| Limite de taxa (`ENGINE_RATE_LIMITED`, 429) | sessão pausada 15 min (`pausedUntil`); item volta sem contar tentativa |
| Engine indisponível | pausa de 15 min; conta tentativa (3ª = `FAILED`), senão grupo inacessível pausaria para sempre |
| Sessão desconectada | item volta em 60 s, sem contar tentativa |
| Grupo inexistente/sem acesso | `FAILED`; extração termina `PARTIAL` |
| Outros | backoff 30 s · 2ⁿ, `FAILED` na 3ª |
| Sessão Telegram | `ENGINE_OPERATION_UNSUPPORTED` (só WhatsApp) |

## Sessão excluída e grupo removido

- Exclusão de sessão é **lógica** (`sessions.deletedAt`): FK não dispara. A manutenção cancela itens pendentes dessa
  sessão e fecha a extração (`PARTIAL` se algo foi concluído, senão `CANCELLED`). Grupos e contatos ficam exportáveis.
- Grupo é único por `(tenantId, groupJid)`: reler por outra sessão atualiza o mesmo registro.
- Remover grupo = `removedAt`: sai da lista e do limite, cancela pendentes; vínculos e contatos ficam. Extrair de novo
  reativa.

## LID

Membro com número oculto vem só com LID (sem sufixo, só dígitos). Fica guardado, entra no CSV (coluna LID) e fica
fora do vCard. Só-telefone e só-LID da mesma pessoa viram dois contatos até uma leitura trazer o par. O par LID de
participante de grupo mora aqui, não no chat ([`chat-ingestao-por-entitlement.md`](chat-ingestao-por-entitlement.md)).

## Pendências jurídicas (bloqueio de venda em escala)

Com a base sendo da plataforma, a CopySync vira controladora de dado pessoal de terceiros. Antes de vender em escala,
o dono decide com apoio jurídico: termos avisando o tenant de que a plataforma guarda os contatos, base legal, canal de
exclusão a pedido do titular e regra de retenção.

- **D4** aviso de uso responsável com aceite versionado (T31): só começa quando o dono avisar.
- **D5** retenção/expurgo (T32): sem regra, nada é apagado sozinho; `tenant_products.inactiveSince` já existe.

## O que não fazer

- Tratar chave `saver_*` ausente como ilimitada; omitir `telegram_sessions: 0` do preset.
- Criar rota de tenant com nome, telefone ou LID em JSON; ler `saver_contacts` em caminho de tenant sem passar pelo
  vínculo com `tenantId`; usar `contact.name` em arquivo de tenant.
- Expor a base a quem não é `SUPER_ADMIN`; consultar a base sem `AuditLog`.
- Registrar nome, número ou LID em log ou auditoria (só ids, filtros e contagens).
- Apagar ou sobrescrever telefone guardado; fundir contato por nome ou heurística; duplicar contato.
- Buscar foto de perfil; alterar `getGroupParticipants`, `groupMetadataCache` ou eventos do adapter.
- Importar `chat`, `campaigns`, `automation`, `link-rotation` ou `storefront` em `modules/saver`.
- Extrair em rota HTTP ou em job singleton de cluster; guardar ritmo em memória.
- Ligar `SAVER_EXTRACTION_WORKER_ENABLED` fora da Render; ler `SAVER_AUDIENCE` em código novo.
- Enviar mensagem a membros extraídos; criar RBAC geral; guardar preço no banco.
