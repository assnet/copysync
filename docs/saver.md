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
- Compra: o botão "Assinar <plano>" da vitrine abre `/redirect/saver-<lite|pro|max>-<mensal|anual>` (`saverCheckoutPath`).
  Os 6 links nascem na migration `20261117130000_add_saver_checkout_redirect_links` (só `INSERT … ON CONFLICT (slug) DO
  NOTHING`: slug existente não é tocado) apontando para os checkouts Cakto, já ligados ao webhook da central. Trocar destino =
  Plataforma → Links de redirecionamento, sem deploy.
- Preço: só vitrine (`features/saver/plans/catalog.ts`), nunca no banco. Valores em
  [`produto-roadmap.md`](produto-roadmap.md#planos-do-saver-decisões-de-2026-11-10-2026-11-11-e-2026-11-17).

## Audiência "Só super admin"

- Chave `saver` em `platform_settings.feature_audience`, lida a cada pedido. Valor inicial: env `SAVER_AUDIENCE`
  (`super_admin` padrão | `entitled`); depois só a flag "Só super admin" em `/admin/plan-entitlements` manda (linha
  "Saver" sem colunas de plano). Não ler a env em código novo.
- `saverAudienceHook` roda depois do gate de produto em `/saver/*`: audiência ligada e usuário não super admin → 403
  `SAVER_UNAVAILABLE`. Sem produto, antes vale `PRODUCT_UNAVAILABLE`.
- `GET /saver/access` (só `authHook`) diz ao painel se o item aparece. Não olha entitlement: o cadeado vem do produto.
- Super admin passa o gate de produto e a audiência (piloto no próprio tenant sem plano).
- Piloto (SAVER-47): super admin em tenant **sem** o produto `SAVER` usa os limites do preset `SAVER_MAX` (`effectiveSaverLimits`/`isSaverPilot` em `domain/services/saverLimits.ts`, via `loadSaverLimits`) no resumo (`pilot: true`), no pedido, na config e no teto de contatos do job (item `requestedBySuperAdmin`). Tenant com o produto usa os entitlements, mesmo para super admin. Não estender o piloto a ADMIN nem criar cache de limites.

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

## Grupos da sessão: membros e comunidades

`GET /sessions/:sessionId/groups` devolve por grupo `memberCount` (null = desconhecido), `kind` e `selectable` +
`unselectableReason`. Vem de `ParticipatingGroupInfo` (contrato do engine), na mesma chamada `groupFetchAllParticipating`
já em cache: `memberCount = size ?? participants.length`; `kind` por `isCommunity` (`COMMUNITY`, comunidade "pai") e
`isCommunityAnnounce` (`COMMUNITY_ANNOUNCE`, grupo de avisos), senão `GROUP`. Tipos do Baileys só no adapter.

- Comunidade "pai" não tem conversa nem membros próprios (o WhatsApp devolve só a administração dela): `selectable:
  false`, `unselectableReason: COMMUNITY_PARENT` (regra em `domain/services/saverGroupKind.ts`). `POST /extractions`
  com ela → 400 `VALIDATION_ERROR` antes de gravar. Para ler os membros da comunidade, use o grupo de avisos: ele
  reúne todos os membros.
- Painel: "N membros" (pt-BR, `—` se desconhecido), selo com Tooltip para comunidade/avisos, total de membros dos
  marcados ao lado do limite por pedido, botão de copiar nome (copia o nome real mesmo com `saver.groupNames`
  borrado; Tooltip e `aria-label` não mostram o nome nesse caso).

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
- **Filtro por país e DDD** (`ddi`, `ddd`), igual na lista, na exportação e nos indicadores: é o começo do telefone
  (`phone` guarda só dígitos com DDI, então `phone LIKE '<ddi><ddd>%'`). `ddi` precisa ser um código de país inteiro
  (1 a 3 dígitos: `5` e `551` são recusados); `ddd` tem 2 dígitos e só vale com `ddi = 55`. Fora disso, 400. Contato só
  com LID nunca casa quando há DDI. Os dois entram no escopo do cursor assinado (cursor de outro DDI/DDD = 400) e na
  auditoria (não são dado pessoal). Índice `saver_contacts_phone_pattern_idx` (`text_pattern_ops`, migration
  `20261117140000`): o índice único de `phone` não atende prefixo fora da collation C. O padrão entra no SQL como
  literal conferido (`^\d{1,5}$`), porque `LIKE` com parâmetro não usa índice no plano genérico.
- **Indicadores** `GET /admin/saver/contacts/summary` (mesmos filtros, sem cursor) →
  `{ total, filtered, withPhone, lidOnly, topDdi[≤5], topDdd[≤8], ddiBase, dddBase }`. `total` = base inteira;
  `filtered` = casa com os filtros, partido em `withPhone`/`lidOnly`. Os rankings ignoram o próprio filtro de DDI/DDD
  (a tela destaca a barra filtrada sem as outras sumirem); `topDdd` só vem com `ddi = 55` e só com DDD em uso;
  `ddiBase`/`dddBase` são o total de cada ranking (base das porcentagens; `dddBase` soma só o que o ranking soma,
  DDD inexistente fica fora). Uma contagem por prefixo de 4 dígitos (`GROUP BY LEFT(phone, 4)`) dobrada por
  `domain/services/phoneRegions.ts`: DDI tem 1 a 3 dígitos e os códigos não são prefixo um do outro, então a função
  conhece os de 1 e 2 dígitos e o resto tem 3. `SET LOCAL statement_timeout` de 3 s na mesma transação das duas
  contagens; estourou = 503 `SAVER_SUMMARY_UNAVAILABLE`.
  **Auditado** como a lista: `SAVER_PLATFORM_VIEWED` com `kind: 'summary'`, filtros (nunca o texto da busca) e
  `count`. Com `search`, a contagem responde se um nome ou LID existe na base, então é consulta a dado pessoal.
- **Custo conhecido** (medido em 2026-11-17: produção tem cerca de 2 mil contatos): o resumo conta a base inteira a
  cada chamada (`COUNT(*)` + agrupamento por prefixo) e o índice `saver_contacts_phone_pattern_idx` é criado sem
  `CONCURRENTLY` (o migrate roda em transação; trava escrita na tabela durante a criação). Aceitável neste tamanho.
  Rever quando a base passar de ~500 mil contatos: contador agregado ou cache para o resumo, e índice novo criado
  à mão com `CONCURRENTLY` antes do deploy.
- Painel (`features/saverAdmin/`): faixa de indicadores com as barras de país/DDD (clicar filtra, clicar na ativa
  remove), filtros País (DDI) com "Outro código…" e DDD (só com o Brasil), telefone com DDI/DDD destacados, selo
  "Só LID", lista em cartões abaixo de `md` e rodapé "Mostrando X de Y" (Y = `filtered`). Os indicadores carregam à
  parte (`usePlatformContactsSummary`): se falharem, aviso discreto com "Tentar de novo" e a lista segue, com o
  rodapé só na quantidade exibida. A contagem fica guardada com os filtros a que responde: durante a troca de
  filtro a tela mostra o resumo anterior inteiro (esmaecido) e o rodapé só usa o total quando ele é dos filtros da
  lista. Campos de filtro alteram o estado por atualização funcional (o DDI digitado é aplicado por timer de 400 ms
  e não pode desfazer outra escolha). Nomes de país e região de DDD ficam em `strings.ts`.
- Não fazer: `substring(phone, 1, 2)` para achar o DDI; `limit`/`offset` vindo do painel; borrar os indicadores
  como se fossem contato; tirar a auditoria do resumo; devolver contato no resumo; `trim` em `ddi`/`ddd` (o schema
  da rota já exige só dígitos); aceitar DDD com outro país; salvar lista ou
  indicadores no navegador (só os filtros, `usePersistedState` versão 1).

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

## Número oculto: o que conseguimos recuperar e o que não

O WhatsApp só entrega o telefone dos membros de grupo de comunidade/avisos para quem é **admin** do grupo. Sessão
que lê como membro comum recebe só LID (produção, 2026-11-17: 4/957, 3/219 com número, todos admins). É limite da
plataforma, não erro de leitura.

Recuperamos, sempre sem consulta nova ao WhatsApp:

| Fonte | Onde | O que rende |
| --- | --- | --- |
| Mapa local LID→telefone da sessão | `engines/baileys/group/resolveLocalLidPhones.ts`, chamado em `getGroupMembers`; usa `lidMapping.getPNsForLIDs` (só cache + key store `lid-mapping`, persistido em `session_auth_keys`), blocos de 500 | Telefone de quem a sessão já viu: postou em grupo, conversou 1:1, veio no histórico. Pouco (≈ 5 % num grupo de 219), de graça |
| Contatos do próprio tenant | `ISaverKnownContactReader` → `PrismaSaverKnownContactReader` (lê `chat_contacts` por `tenantId`), `enrichWithKnownContacts` antes do `mergeGroupRead` | Telefone do só-LID com par visto em conversa 1:1 do tenant; nome para quem veio sem nome (casa por LID ou telefone) |
| Sessão admin | Painel: selo "Você é admin", aviso "Números ocultos: esta sessão não é admin", filtro "Sou admin" (`selfIsAdmin` na listagem = `canInvite` do engine) | Ler com a sessão do número que é admin traz todos os números. É a única forma de recuperar a maioria |

Regras: falha em qualquer fonte = membro segue sem telefone, a leitura nunca cai. O nome vindo de `chat_contacts`
(`tenantName`) entra **só no vínculo do tenant**; nunca em `saver_contacts.name` (SAVER-46). O telefone descoberto
vai para a base como qualquer telefone lido. Nome que é só número não conta como nome. `groupMetadata` quase nunca
traz nome: coluna Nome vazia no CSV é falta de nome na origem, não erro.

Continua impossível: número de quem nunca interagiu com a sessão nem com o tenant, em grupo onde a sessão não é
admin. Enriquecimento passivo (aprender par/nome quando o membro posta) é a T30, ainda não implementada.

**Proibido** (risco de banimento do número do cliente): USync, `onWhatsApp`, `fetchStatus`, `profilePictureUrl` ou
qualquer IQ por membro; `getLIDForPN`/`getLIDsForPNs` em lote (dispara USync quando falta no mapa); abrir conversa
ou enviar mensagem para descobrir número; usar contato ou nome de outro tenant.

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
- Liberar comunidade "pai" para leitura ou buscar `groupMetadata` por grupo só para contar membros na listagem.
- Consultar o WhatsApp por membro para revelar número oculto (lista em "Número oculto").
- Buscar foto de perfil; alterar `getGroupParticipants`, `groupMetadataCache` ou eventos do adapter.
- Importar `chat`, `campaigns`, `automation`, `link-rotation` ou `storefront` em `modules/saver`.
- Extrair em rota HTTP ou em job singleton de cluster; guardar ritmo em memória.
- Ligar `SAVER_EXTRACTION_WORKER_ENABLED` fora da Render; ler `SAVER_AUDIENCE` em código novo.
- Enviar mensagem a membros extraídos; criar RBAC geral; guardar preço no banco.
