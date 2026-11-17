# Saver — Design

**Spec**: `spec.md` · **Status**: Draft · **Depende de**: `product-access` (aprovado em 2026-11-11) (produto `SAVER`, `withProduct`, `resolvePlan`, `IProductAccessReader`).

## 1. Visão

```
painel /saver ──▶ API /saver/* ──[authHook, tenantHook, gate SAVER]──▶ use cases ──▶ tabelas saver_*
                     │ listar grupos da sessão ─▶ getActiveEngine().listParticipatingGroups (já existe)
                     │ pedir extração ─▶ grava saver_extractions + saver_extraction_items (QUEUED)
                     └ exportar ─▶ vínculos DO TENANT (+ phone/lid do contato) ─▶ CSV / vCard ─▶ AuditLog

super admin /admin/saver ──▶ API /admin/saver/* ──[authHook, super admin]──▶ use cases Platform* ──▶ saver_contacts (todos os tenants)

worker (ou `all`) ── SaverExtractionJob (tick 2 s) ──▶ para cada sessão LOCAL com vez liberada:
     claim de 1 item (SKIP LOCKED) ─▶ engine.getGroupMembers ─▶ mergeGroupRead ─▶ saver_contacts + vínculos, lotes de 500
     ─▶ saver_session_states.nextScanAt = agora + 3–5 s     (estado no banco, não em memória)
```

O módulo `api/src/modules/saver/` só importa de `shared/`, de `tenants/domain` (entitlements, produto) e de
`messaging/domain/contracts` (porta do engine). Nada de `chat`, `campaigns`, `automation`, `link-rotation`, `storefront`.

## 2. Plano, limites e permissões

### 2.1 Entitlements (`tenants/domain/entitlementKeys.ts`, `planPresets.ts`)

| Chave | Tipo | Ausente | `SAVER_LITE` | `SAVER_PRO` | `SAVER_MAX` |
| --- | --- | --- | --- | --- | --- |
| `saver_groups` (grupos salvos) | número | 0 | 10 | 50 | `null` (ilimitado) |
| `saver_contacts` (contatos distintos vinculados ao tenant) | número | 0 | 10.000 | 50.000 | `null` (ilimitado) |
| `saver_group_scans_per_day` (leituras em 24 h) — *proposta* | número | 0 | 20 | 100 | 500 |
| `saver_auto_refresh_enabled` — *proposta* | booleano | desligado | não | sim | sim |
| `whatsapp_sessions` (compartilhada) | número | regra de `product-access` | 1 | 1 | 2 |
| `telegram_sessions` (compartilhada) | número | regra de `product-access` | 0 | 0 | 0 |

Grupos, contatos e sessões: decisão do dono (D1). Linhas marcadas *proposta* não foram respondidas; valem até o dono
trocar. `saver_group_scans_per_day` no `SAVER_MAX` tem teto de propósito: é proteção do número do cliente, não limite
comercial (500 leituras a 3–5 s ≈ 35 min de fila contínua por dia). Ilimitado grava JSON `null` **explícito**
(`planPresets.ts:30` já suporta); omitir a chave valeria zero no Saver. Slugs na central:
`copysync-saver-{lite|pro|max}-{mensal|anual}`. Preço (só na vitrine, `features/saver/plans/catalog.ts`, nunca no banco), por mês: mensal R$ 29,90 / 39,90 / 49,90; anual R$ 23,90 / 32,90 / 39,90, cobrado anualmente (R$ 286,80 / 394,80 / 478,80).

As compartilhadas ficam no preset, mas o sync do plano Saver as **exclui** (`excludeKeys: SHARED_KEYS`); quem escreve é
o merge de `product-access` (maior valor entre produtos ativos; tenant legado ilimitado não é tocado). `telegram_sessions: 0`
é obrigatório: sessões são recurso do tenant, sem gate, e chave ausente vale ilimitado (`CreateSessionUseCase.ts:43-48`).

`SAVER_PLAN_SLUGS` (`SAVER_LITE`, `SAVER_PRO`, `SAVER_MAX`) fica em `planPresets.ts`; `PLAN_SLUGS` (Afiliados) **não muda**,
para a ordenação de tier da reconciliação seguir igual; os slugs Saver entram em `ALL_PLAN_SLUGS` (criado em
`product-access`), que é o que a tela admin de presets valida. `planPresetRows()` passa a incluir as linhas Saver; os presets
entram em produção por data migration `ON CONFLICT DO NOTHING` (padrão `20261111090500_add_marketplace_shein_entitlement`).
Leitura de limite no Saver: `PrismaEntitlementReader.getNumber` devolve `null` tanto para linha ausente quanto para JSON
`null` (`PrismaEntitlementReader.ts:27-33`), e o resto do projeto lê esse `null` como ilimitado. O Saver não pode herdar
isso, então lê por `IEntitlementSnapshotReader.readAll` (uma consulta) e `saverLimits.ts` decide: chave **ausente = 0 /
desligado**; `null` explícito = ilimitado; número = limite.

### 2.2 Permissões (`saver/domain/services/saverPermissions.ts`, função pura)

```ts
export type SaverAction = 'view' | 'extract' | 'export' | 'configure';
export interface SaverGrants { export: boolean }   // liberação individual; hoje só exportar
export function canSaver(role: 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR', action: SaverAction, grants: SaverGrants): boolean;
// ADMIN, SUPER_ADMIN: tudo (grants ignorado) · OPERATOR: view, extract; export só com grants.export
```

- Liberação mora em tabela do próprio módulo (`saver_export_grants`), não em `user_tenants`: não toca tabela compartilhada.
- FK composta `(userId, tenantId)` → `user_tenants(userId, tenantId)` com `onDelete: Cascade` (a unicidade existe,
  `schema.prisma:240`): usuário removido do tenant perde a liberação sem código de limpeza.
- Quem vira `ADMIN` tem a linha apagada no ato da concessão seguinte e ignorada antes disso (papel manda).
- Gerenciar liberações = ação `configure` (só `ADMIN`). Alvo precisa ser `OPERATOR` do mesmo tenant.
- Leitura dos operadores do tenant: porta `ISaverTeamReader` (domínio do Saver) com implementação Prisma em
  `saver/infrastructure` lendo `user_tenants`/`users` filtrado por `tenantId`. Nada importado do módulo `users`.
### 2.3 Audiência (SAVER-47)

- `FEATURE_AUDIENCE_KEYS` (`tenants/domain/featureAudience.ts:9`) ganha a chave `saver` (audiência de produto, não entitlement; o tipo passa a aceitar as duas). Valor inicial: env `SAVER_AUDIENCE` (`super_admin|entitled`, padrão `super_admin`, molde `OFFER_HUNTER_AUDIENCE`, `env.ts:386`); depois só a flag do admin manda.
- API: `saverAudienceHook` logo após o gate de produto em `/saver/*` (molde `offerHunterAudienceHook.ts`): fora → 403 `SAVER_UNAVAILABLE`. `GET /saver/access` (só `authHook`) diz ao painel se o Saver aparece: audiência ligada → só super admin; aberta → `true` para membro válido do tenant (o cadeado vem do acesso por produto, não daqui; **não** copiar a checagem de entitlement de `isOfferHunterVisible`). `/admin/saver/*` não passa por ele.
- Admin: `/admin/plan-entitlements` ganha a linha "Saver" só com a coluna "Só super admin" (todas as colunas de plano = "—": audiência não é preset). `ListAdminPlanEntitlementsUseCase.ts:24-25` só percorre a allowlist: passa a anexar as chaves de audiência fora dela, com `plans` vazio e sem `type`; `AdminPlanEntitlementsPage.tsx:174-186` mostra "—" na célula de plano de linha sem `type` (hoje desenharia Switch e mandaria `PUT /:planSlug/saver`).
- Painel: hook `useSaverAccess` (molde `useOfferHunterAccess`, `AppLayout.tsx:327-330`); `BuildNavigationInput` ganha `saverVisible` (molde `offerHunterVisible`); `false` some com o item Saver inteiro; `true` sem produto = cadeado.

- Checagem no use case (convenção: `AcceptMarketplaceRiskUseCase.ts:40`), nunca no handler. O painel recebe o resultado
  pronto em `/saver/overview` (`permissions: { view, extract, export, configure }`), sem recalcular regra.

## 3. Banco (`api/prisma/schema.prisma`)

Padrão: `@id @default(cuid())`, colunas camelCase, `@@map` snake_case plural, `tenant onDelete: Cascade`.

```prisma
model SaverConfig {            // @@map("saver_configs")
  tenantId String @id
  namePrefix String?  excludeAdminsByDefault Boolean @default(false)
  defaultFormat String @default("CSV")   // CSV | VCARD
  autoRefresh Boolean @default(false)
  updatedAt DateTime @updatedAt
}
model SaverGroup {             // @@map("saver_groups")
  id  tenantId  sessionId String?  (Session onDelete: SetNull)
  groupJid String  name String  memberCount Int  phoneCount Int  lidOnlyCount Int
  lastScannedAt DateTime?  lastScanStatus String?  createdAt
  removedAt DateTime?
  @@unique([tenantId, groupJid])   // o grupo é o mesmo por qualquer sessão do tenant; sessionId = última sessão que leu
}
model SaverContact {           // @@map("saver_contacts")  — base da PLATAFORMA: 1 linha por pessoa, SEM tenantId
  id
  phone String? @unique  lid String? @unique
  name String?                                   // melhor nome conhecido; só o super admin lê
  firstSeenAt DateTime  lastSeenAt DateTime
  @@index([lastSeenAt])
}
model SaverGroupMembership {   // @@map("saver_group_memberships")  — vínculo contato × grupo do tenant que extraiu
  id  tenantId  groupId (SaverGroup onDelete: Cascade)  contactId (SaverContact onDelete: Restrict)
  name String?                                   // nome como lido NESTE grupo; é o que o tenant exporta
  isAdmin Boolean
  firstExtractedAt DateTime  lastExtractedAt DateTime  lastExtractionId String?   // data e hora da extração
  leftAt DateTime?
  @@unique([groupId, contactId])  @@index([contactId])  @@index([tenantId, contactId])
}
model SaverExportGrant {       // @@map("saver_export_grants")
  id  tenantId  userId  grantedByUserId String?  createdAt
  userTenant UserTenant @relation(fields: [userId, tenantId], references: [userId, tenantId], onDelete: Cascade)
  @@unique([tenantId, userId])
}
model SaverExtraction {        // @@map("saver_extractions")
  id  tenantId  sessionId String? (Session onDelete: SetNull)  requestedByUserId String?  trigger String // MANUAL | AUTO
  status String // QUEUED | RUNNING | DONE | PARTIAL | FAILED | CANCELLED
  totalGroups  doneGroups  failedGroups  membersFound  newContacts  createdAt  finishedAt?
  @@index([tenantId, createdAt])
}
model SaverExtractionItem {    // @@map("saver_extraction_items")
  id  extractionId (onDelete: Cascade)  tenantId  sessionId (Session onDelete: Cascade)  groupId (SaverGroup onDelete: Cascade)
  status String // QUEUED | RUNNING | DONE | FAILED | CANCELLED
  attempts Int @default(0)  nextAttemptAt DateTime @default(now())  lockedUntil DateTime?
  errorCode String?  finishedAt DateTime?
  @@index([sessionId, status, nextAttemptAt])
}
model SaverSessionState {      // @@map("saver_session_states")
  sessionId String @id (Session onDelete: Cascade)
  tenantId  nextScanAt DateTime  pausedUntil DateTime?  pauseReason String?
}
```

- **Base da plataforma**: `saver_contacts` não tem `tenantId` de propósito (mesmo caso de `redirect_links`): é dado da
  CopySync. A regra "consulta tenant-aware sem `tenantId` é proibida" continua valendo: todo caminho do tenant entra por
  `saver_group_memberships`/`saver_groups` filtrando `tenantId`; só os use cases `Platform*` (super admin) leem
  `saver_contacts` direto. Dois repositórios separados (`ISaverMembershipRepository` × `IPlatformSaverContactRepository`)
  para o erro não compilar por acidente.
- **Isolamento entre tenants (SAVER-46)**: exportação do tenant lê `membership.name`, nunca `contact.name` (que pode ter
  vindo do grupo de outro tenant). Do contato global o tenant só recebe `phone` e `lid`, que ele mesmo leu.
- **Sem duplicar (SAVER-44)**: garantia do banco (`@unique` em `phone` e em `lid`). Dois tenants extraindo a mesma pessoa
  ao mesmo tempo: a segunda inserção bate na unicidade e vira atualização (`INSERT … ON CONFLICT … DO UPDATE` em SQL cru
  por lote, ordenado por chave para não haver deadlock). Fusão de dois contatos roda em transação com
  `pg_advisory_xact_lock` sobre as duas chaves.
- **Data e hora da extração**: `firstExtractedAt`/`lastExtractedAt` no vínculo; `lastExtractionId` aponta a extração
  (tenant, sessão, usuário). Não há linha por (contato × extração): reler o mesmo grupo todo dia multiplicaria a tabela
  sem ganho. Se o dono quiser o histórico completo de cada releitura, vira tabela à parte depois.
- Remover grupo é lógico: `SaverGroup.removedAt`. Some para o tenant, libera o limite, cancela pendentes; vínculos e
  contatos ficam. Extrair de novo o mesmo grupo reativa a linha.
- Tenant excluído (só se um dia houver exclusão física de tenant; hoje não existe): grupos e vínculos caem por cascade; contatos ficam na base (sem vínculo).
- Limite `saver_contacts` = `COUNT(DISTINCT contactId)` dos vínculos do tenant em grupos não removidos.
- Unicidade de item pendente por grupo: índice único parcial `("groupId") WHERE status IN ('QUEUED','RUNNING')` em SQL cru na migration (SAVER-10).
- `phone` guarda só dígitos com DDI; `lid` guarda o identificador sem sufixo. NULLs não colidem nos índices únicos.
- Sessão excluída: a exclusão é **lógica** (`sessions.deletedAt`, `PrismaSessionRepository.ts:207-211`), então FK `SetNull`/`Cascade` nunca dispara e não é o mecanismo. O passo de manutenção do job cancela os itens `QUEUED`/`RUNNING` de sessão com `deletedAt` (padrão `skipForDeletedSessions`, `ProcessDueOfferDispatchesUseCase.ts:112`) e fecha a extração (`PARTIAL` se algum item foi concluído, senão `CANCELLED`); `claimNext` ignora sessão com `deletedAt`. Grupos e contatos ficam para exportar. O grupo é único por `(tenantId, groupJid)`, então reler por outra sessão atualiza o mesmo registro; o índice parcial de item pendente fica livre depois do cancelamento.
- Migrations: `create_saver_tables`, `add_audit_actions_saver` (`SAVER_EXPORTED`, `SAVER_PERMISSION_CHANGED`; enum em migration própria; inclui `SAVER_PLATFORM_VIEWED`, `SAVER_PLATFORM_EXPORTED`), `add_saver_plan_presets` (data migration dos presets). `UserTenant` ganha só o campo de relação inversa (nenhuma coluna).
- Volume: LITE/PRO têm teto (10 mil / 50 mil contatos). `SAVER_MAX` não tem: por isso exportação por stream, lista só por cursor, e alerta em log quando um tenant passa de 500 mil contatos (sem bloquear).

## 4. API

### 4.1 Engine (única mudança fora do módulo, em `messaging`)

```ts
// IMessagingEngine.ts
getGroupMembers(sessionId: string, groupJid: string): Promise<GroupMemberInfo[]>;
export interface GroupMemberInfo { phone: string | null; lid: string | null; name: string | null; isAdmin: boolean }
```

| Arquivo | Mudança |
| --- | --- |
| `messaging/domain/contracts/IMessagingEngine.ts` | método + tipo |
| `engines/baileys/group/normalizeGroupMembers.ts` (novo, puro) | participante da lib → `GroupMemberInfo`: telefone de `phoneNumber` ou de `id` quando PN; LID de `lid` ou de `id` quando `@lid`; nome `name ?? notify ?? verifiedName ?? null` |
| `BaileysMessagingEngineAdapter.ts` | `getGroupMembers`: `requireConnectedEntry` → `groupMetadata(jid)` → normaliza. **Não** lê nem grava `groupMetadataCache`, não busca foto, não toca `getGroupParticipants` |
| `BaileysErrorTranslator.ts` | reconhecer limite de taxa (`rate-overlimit`/429) → `EngineRateLimitedError` (novo, 429). A T13 confirma na lib a forma exata do erro antes de mapear; sem confirmação, fica o comportamento atual (`EngineTemporarilyUnavailableError`) e o Saver trata os dois como pausa |
| `TelegramMessagingEngineAdapter.ts` | `getGroupMembers` lança `EngineOperationUnsupportedError` (já existe, `MessagingErrors.ts:57`) |
| `remote/engineCallPlan.ts`, `RemoteMessagingEngineAdapter.ts`, `MessagingEngineRouter.ts`, fakes | entrada `rpc` (o `satisfies` obriga) |
| `remote/engineCallPlan.test.ts:42`, `RemoteMessagingEngineAdapter.test.ts:62` | testes de contrato: contagem de métodos `rpc` (17 → 18) e `ARGS[m]` por método. Únicas edições em teste alheio; nenhuma asserção existente é removida |

`getGroupParticipants` (menção a todos, participantes do chat) fica byte a byte como está.

### 4.2 Domínio (`saver/domain`)
- `enums/`: status de extração e de item, `SaverExportFormat`.
- `services/saverPermissions.ts`, `services/saverLimits.ts` (puros).
- `services/mergeGroupRead.ts` (puro): `(contatosDaBaseQueCasam, vínculosDoGrupo, lidos, agora, extractionId) → { contactInserts[], contactUpdates[], contactMerges[], membershipUpserts[], markLeft[] }`. Identidade do contato na base da plataforma: casa por `lid`; senão por `phone`; senão insere. Só-LID que ganhou telefone é atualizado. **Regra de preenchimento**: `phone`, `lid` e `name` do contato só passam de vazio para preenchido; valor lido nulo nunca sobrescreve (leitura só-LID de quem já tem telefone mantém o telefone). LID conhecido chegando com telefone diferente: mantém o guardado e insere o novo como outro contato (sem `lid`, para não violar a unicidade). Contato só-telefone e leitura só-LID da mesma pessoa não casam (não há chave em comum): ficam dois contatos até uma leitura trazer o par. Se `lid` casa com um contato e `phone` com outro → `contactMerges` (fica o de `firstSeenAt` mais antigo; nome não vazio mais recente; vínculos migram). Nome lido vai sempre para o vínculo; no contato só sobrescreve por valor não vazio. Vínculo recebe `lastExtractedAt = agora` e `lastExtractionId`. Quem voltou ao grupo tem `leftAt` limpo. O repositório busca só os contatos cujo `phone`/`lid` está na leitura (`WHERE phone = ANY(...) OR lid = ANY(...)`), nunca a tabela inteira.
- `services/exportFormatters.ts` (puro): `csvHeader(opts)`, `toCsvLine(row)`, `toVCardEntry(row)`, `neutralizeFormula`, `formatCapturedAt(date)` (fuso fixo `America/Sao_Paulo`: `Tenant` não tem fuso no schema), `applyExportOptions(row, { prefix, excludeAdmins, onePerGroup })`. Por linha, para servir ao stream. CSV do tenant: `Nome,Telefone,LID,Extraído em` (+ `Grupo` com `onePerGroup`); CSV do super admin: `Nome,Telefone,LID,Primeira extração,Última extração,Tenants,Grupos`. vCard pula quem não tem telefone.
- `contracts/`: `ISaverGroupRepository`, `ISaverMembershipRepository` (tenant), `IPlatformSaverContactRepository` (super admin e gravação da extração), `ISaverExportGrantRepository`, `ISaverTeamReader`, `ISaverExtractionQueue`, `ISaverSessionStateStore`, `ISaverConfigRepository`. Tipos do domínio, nunca Prisma.

### 4.3 Aplicação (`saver/application/use-cases`)

| Use case | Regra |
| --- | --- |
| `GetSaverOverviewUseCase` | limites, uso (grupos, contatos, leituras 24 h), permissões efetivas do usuário (papel + liberação), config, `queueRunning` (flag do job) |
| `ListSaverSessionGroupsUseCase` | sessão do tenant, WhatsApp, conectada → `engine.listParticipatingGroups` + marca salvos |
| `RequestSaverExtractionUseCase` | `canSaver(extract)`; valida `saver_groups` (salvos + novos) e `saver_group_scans_per_day`; cria/atualiza `SaverGroup`, extração e itens numa transação; ignora grupo já pendente |
| `GetSaverExtractionUseCase` / `CancelSaverExtractionUseCase` | progresso; cancela itens `QUEUED` |
| `ProcessNextSaverItemUseCase` | passo do job (abaixo) |
| `ListSaverGroupsUseCase` | grupos salvos do tenant com contagens (membros, com número, só LID) e última extração. **Não existe use case de tenant que devolva linha de contato** |
| `ListPlatformSaverContactsUseCase` / `GetPlatformSaverContactUseCase` / `ExportPlatformSaverContactsUseCase` | só `SUPER_ADMIN` (checado no use case **e** na rota); cursor keyset assinado (molde `metrics/application/use-cases/infraCostTenantCursor.ts`; escopo = hash dos filtros; inválido = 400, nunca offset; `OpaqueCursor` só carrega offset); busca, filtro por tenant/período; detalhe = vínculos (tenant, grupo, data e hora); exportação por stream; `AuditLog SAVER_PLATFORM_VIEWED`/`SAVER_PLATFORM_EXPORTED` com filtros e contagem |
| `ExportSavedContactsUseCase` | `canSaver(export, grants)`; entrada = grupos do tenant + opções; `COUNT` antes (total, só-LID fora do vCard; 0 → 422); gerador assíncrono por keyset em lotes de 1.000 sobre os vínculos do tenant (nome do vínculo, `phone`/`lid` do contato, `MAX(lastExtractedAt)`); `AuditLog` com a contagem |
| `ListSaverExportGrantsUseCase` / `SetSaverExportGrantUseCase` | `configure`; lista operadores do tenant com o estado; liga/desliga; valida alvo `OPERATOR` do tenant; `AuditLog SAVER_PERMISSION_CHANGED` (ids, nunca nome/e-mail) |
| `RemoveSaverGroupUseCase` | `canSaver(configure)`; marca `removedAt`, cancela itens pendentes; nenhum `DELETE` |
| `GetSaverConfigUseCase` / `UpdateSaverConfigUseCase` | `configure`; `autoRefresh` só com entitlement |
| `CloseOrphanSaverExtractionsUseCase` | fecha extração sem item pendente (sessão excluída). Expurgo de dados: fora da v1 (D5) |

`ProcessNextSaverItemUseCase.execute({ localSessionIds, now })`:
1. `stateStore.dueSessions(localSessionIds, now)` → sessões sem `pausedUntil` futuro e com `nextScanAt <= now`.
2. Para cada uma: `queue.claimNext(sessionId, now)` (uma instrução `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`; marca `RUNNING`, `lockedUntil = now + 60 s`; itens `RUNNING` com trava vencida voltam a concorrer).
3. Sem produto `SAVER` ativo (`IProductAccessReader`) → cancela itens do tenant.
4. `engine.getGroupMembers` → carrega da base os contatos que casam → `mergeGroupRead` → confere `saver_contacts` (contatos distintos do tenant + os que ganham primeiro vínculo dele) → grava em lotes de 500 numa transação → atualiza contadores do grupo e da extração (`membersFound`, `newContacts`).
5. Erro: sessão desconectada → devolve a `QUEUED` sem contar tentativa, `nextAttemptAt = now + 60 s`; limite de taxa/indisponível → `pausedUntil = now + 15 min` e devolve o item; grupo inexistente/sem acesso → `FAILED` definitivo; outros → `attempts + 1`, espera 30 s · 2ⁿ, `FAILED` na 3ª.
6. Sempre: `nextScanAt = now + sorteio(3–5 s)`; fecha a extração se não restam itens.

### 4.4 Infraestrutura
- `repositories/Prisma*` + `mappers/`; `saverContainer.ts` com `lazy()` (padrão `linkRotationContainer.ts:47-133`).
- `jobs/SaverExtractionJob.ts`: `setInterval(2 s).unref()`, sem sobreposição de ticks; obtém as sessões deste processo pelo filtro de dono no SQL (`ownerWorkerId = workerId` e `leaseUntil > now`, sem `deletedAt`, molde `PrismaLinkRotationMemberSyncStore.ts:24`); nunca `listLocalSessionIds`, que inclui socket com QR não lido; a cada hora, sob `PrismaJobLease` `saver-maintenance`, roda `CloseOrphanSaverExtractionsUseCase` (nenhum dado de contato é apagado por job na v1). Não há singleton de cluster para a extração: cada processo cuida das próprias sessões; o claim com `SKIP LOCKED` impede trabalho duplicado.
- `app/processJobs.ts`: `'saverExtraction'` em `ProcessJob` e `WORKER_JOBS`. `app/server.ts`: liga com `jobs.has('saverExtraction') && env.SAVER_EXTRACTION_WORKER_ENABLED`; para no shutdown.
- `shared/config/env.ts`: `SAVER_EXTRACTION_WORKER_ENABLED` (padrão `false`; "`.env` aponta para produção, `true` só na Render").

### 4.5 Apresentação (`saver/presentation`) — prefixo `${API_PREFIX}/saver`, `preHandler: [authHook, tenantHook]`, registrado com `withProduct('SAVER', saverRoutes)`

| Rota | Use case |
| --- | --- |
| `GET /overview` | `GetSaverOverview` |
| `GET /sessions/:sessionId/groups` | `ListSaverSessionGroups` |
| `POST /extractions` `{ sessionId, groupJids[] }` (1–50) | `RequestSaverExtraction` |
| `GET /extractions/:id` · `POST /extractions/:id/cancel` | progresso / cancelar |
| `GET /groups` · `DELETE /groups/:id` | grupos salvos |
| `GET /permissions` · `PUT /permissions/:userId` `{ export: boolean }` | liberações de exportar (só `ADMIN`) |
| `POST /exports` `{ format, groupIds \| "all", options }` | `ExportSavedContacts` → `Content-Type` + `Content-Disposition` (`contentDispositionHeader`, `staticMediaPolicy.ts:53`) |
| `GET /config` · `PUT /config` | configuração |

Base da plataforma — prefixo `${API_PREFIX}/admin/saver`, hook de super admin (padrão `/admin/plan-entitlements`), **fora** do gate de produto:

| Rota | Use case |
| --- | --- |
| `GET /contacts?cursor&search&tenantId&from&to` | `ListPlatformSaverContacts` |
| `GET /contacts/:id` | `GetPlatformSaverContact` (vínculos: tenant, grupo, data e hora) |
| `POST /exports` | `ExportPlatformSaverContacts` (CSV por stream) |

JSON Schema `as const` com `additionalProperties: false`; `SaverPresenter`; handlers finos; resposta de arquivo com `return reply…send(Readable.from(gerador))` (nunca `send` + `return;`, AGENTS §14). Sempre stream: `SAVER_MAX` não tem teto de contatos. Validação, permissão e contagem acontecem **antes** do primeiro byte; erro no meio do stream encerra a conexão e fica em log (sem nome/número).

## 5. Painel (`app/src/features/saver/`)

```
features/saver/
  strings.ts · types.ts · privacy (flags em features/privacy/privacyFlags.ts)
  hooks/useSaverOverview.ts · useSaverGroups.ts · useSaverExtraction.ts · useSaverConfig.ts
  components/SessionPicker.tsx · GroupSelectionTable.tsx · ExtractionProgress.tsx
             ExportDialog.tsx · HiddenNumberNotice.tsx · SaverLimitBanner.tsx
  pages/SaverGroupsPage.tsx · SaverSettingsPage.tsx · SaverPlansPage.tsx
  plans/catalog.ts (+ teste que trava catálogo × presets)
services/saver.service.ts
```

- Menu (`navigation/model.ts:139`): `soon('saver'…)` vira produto `available` com `Grupos` (`/saver`), `Configurações` (`/saver/settings`), `Planos` (`/saver/plans`); ícone atual `Bookmark`. Tagline em `navigation/strings.ts:20`: "Exporte os contatos dos seus grupos" (D3 fechada).
- Rotas em `AppRoutes.tsx` sob `<ProductRoute product="SAVER">`; `/saver/plans` fora do guard; `/members` redireciona para `/saver` (D6). Registra `PRODUCT_HOME.SAVER = '/saver'` e `PRODUCT_PLANS_PATH.SAVER = '/saver/plans'` em `features/products/productAccess.ts` (até aqui o tenant só-Saver caía em Assinatura).
- Fluxo de Grupos: escolher sessão → tabela com seleção e busca → "Salvar contatos" → `ExtractionProgress` (consulta a cada 3 s enquanto ativo; para ao fechar).
- Sem tela de contatos no tenant. `GroupSelectionTable` mostra por grupo salvo: membros, com número, só LID, última extração; `HiddenNumberNotice` com a contagem só-LID. Exportar parte daqui (grupos marcados ou todos).
- Super admin: `features/saverAdmin/` (`PlatformContactsPage`, `PlatformContactsTable`, `PlatformContactDetailDrawer`, `platformSaver.service.ts`), rota `/admin/saver` no grupo de administração do menu; "carregar mais" por cursor; exportar CSV; flags `saverAdmin.*`.
- Exportar: `ExportDialog` (formato, prefixo, remover administradores, uma linha por grupo) mostra quantos entram e, no vCard, quantos ficam fora por não ter número; download por `Blob` + `<a download>` (padrão `offerStory/shareImage.ts:43-58`). Botão visível conforme `permissions.export` do resumo (admin, ou operador liberado).
- Configurações ganha a seção "Quem pode exportar": operadores do tenant com `Switch` do tema e `Tooltip` explicando o efeito; só `ADMIN` vê. Nome/e-mail do operador sob flag de privacidade `saver.teamNames`.
- `usePersistedState` (escopo `tab`): `saver.sessionId`, `saver.selectedGroups`, `saver.memberFilters`, `saver.exportOptions`; limpos ao concluir a extração/exportação. Dado do servidor nunca é salvo.
- Privacidade: tenant `saver.groupNames`, `saver.teamNames`; super admin `saverAdmin.contactNames`, `saverAdmin.contactPhones` (telefone e LID), `saverAdmin.tenantNames`; com `Blurred`/`useBlur`.
- Limite atingido: `PLAN_LIMIT_REACHED` → `SaverLimitBanner` com CTA para `/saver/plans`.
- Componentes padrão: `Switch` do tema, `Tooltip` do MUI, `AppIcon`; sem emoji e sem ícone de brilho; claro/escuro/sistema; foco e rótulos acessíveis.

## 6. Reuso

| Componente | Local | Uso |
| --- | --- | --- |
| Estrutura de módulo, container `lazy()` | `api/src/modules/link-rotation/` | molde |
| `PlanLimitReachedError`, `PlanFeatureUnavailableError` | `shared/errors/internal/PlanErrors.ts` | limites |
| `PrismaEntitlementReader` / `IEntitlementSnapshotReader` | `tenants/` | leitura de limites |
| `OpaqueCursor` | `shared/http/pagination/OpaqueCursor.ts` | lista de membros |
| `PrismaJobLease` | `shared/infrastructure/jobs/PrismaJobLease.ts` | manutenção |
| `IAuditLogRepository` | `shared/audit/` | exportação |
| `listParticipatingGroups` | `IMessagingEngine.ts:298` | grupos da sessão (sem mudança) |
| `contentDispositionHeader` | `shared/storage/staticMediaPolicy.ts:53` | download |
| `usePersistedState`, `Blurred`, `AppIcon`, `serverNow` | `app/src/…` | padrões de tela |
| `features/redirectLinks/` | `app/src/features/redirectLinks/` | molde de feature de painel |

## 7. Erros

| Cenário | Tratamento | O que o usuário vê |
| --- | --- | --- |
| Sem produto | 403 `PRODUCT_UNAVAILABLE` | Vitrine do Saver |
| Limite de plano | 403 `PLAN_LIMIT_REACHED` (`key`, `limit`) | Faixa com o limite e CTA |
| Sem permissão (papel ou liberação) | 403 `FORBIDDEN` | Ação oculta; mensagem "peça ao administrador" se forçada |
| Sessão desconectada | `SESSION_NOT_CONNECTED` | "Reconecte a sessão" + atalho |
| Sessão Telegram | `ENGINE_OPERATION_UNSUPPORTED` | "Disponível só para WhatsApp" |
| Limite de taxa do WhatsApp | pausa de 15 min da sessão no Saver | "Leitura pausada, retoma às HH:MM" (`CooldownBar` + `serverNow()`) |
| Grupo inacessível | item `FAILED`, extração `PARTIAL` | Lista dos grupos que falharam |
| Exportação vazia | 422 | "Nenhum contato nos filtros" (vCard: "nenhum contato com número") |
| Fila parada (flag desligada) | `queueRunning: false` no resumo | Aviso na tela de Grupos |

Nenhum erro cru do Baileys sobe: tudo passa pelo tradutor.

## 8. Decisões técnicas

| Decisão | Escolha | Razão |
| --- | --- | --- |
| Ritmo por sessão | `saver_session_states` no banco | AGENTS/escala: sem estado operacional novo só em memória; sobrevive a reinício e adoção |
| Fila | tabela + `SKIP LOCKED` | Sem Redis em produção; volume baixo |
| Janela do limite diário | últimas 24 h corridas | Evita erro de fuso |
| Nome do membro | o que o metadata trouxer; sem nome → vazio | Independência do Chat; enriquecimento passivo fica em P2 |
| Telefone | dado principal; nunca apagado nem trocado por leitura | Decisão do dono (2026-11-11): foco da base é o telefone |
| Só-LID | guardado; entra no CSV com a coluna LID; fora do vCard | Dono quer nome, telefone e LID na lista; vCard exige número |
| Contato | único na plataforma (sem `tenantId`), vínculo por grupo do tenant | Decisão do dono (D5, 2026-11-11): base é da CopySync; só super admin consulta |
| Nome | guardado no vínculo e no contato | Sem isso o tenant A exportaria nome lido pelo tenant B |
| Tenant × contatos | só contagens e arquivo; nenhuma rota JSON com linha de contato | Decisão do dono |
| Descarte automático | nenhum na v1 | D5 adiada; apagar é irreversível, então o padrão é não apagar |
| Exportar | `ADMIN`, ou `OPERATOR` liberado por `ADMIN`; auditado | D2; saída de dado pessoal de terceiros |
| Liberação individual | tabela própria só para `export` | Atende a D2 sem criar RBAC geral nem tocar `user_tenants` |

## 9. Riscos

| Risco | Mitigação |
| --- | --- |
| Bloqueio do número do usuário por leitura em volume | 1 grupo/3–5 s por sessão, sem foto, pausa de 15 min em limite de taxa, limite diário por plano; smoke com conta real antes de vender |
| Tocar a porta do engine quebra Afiliados/Chat | Método novo; `getGroupParticipants` intocado; `satisfies` do plano de chamadas acusa esquecimento; smoke de menção e participantes |
| Nome vazio na maioria dos membros | Declarado na tela e no doc; P2 de enriquecimento; smoke mede a taxa real antes da vitrine prometer "nome" |
| Dados pessoais de terceiros (LGPD) — **subiu de gravidade**: com a base sendo da plataforma, a CopySync vira controladora de números de terceiros colhidos pelas sessões dos clientes | Acesso só super admin e auditado; tenant isolado por vínculo. **Fora do alcance do código, decisão do dono com apoio jurídico antes de vender**: base legal, cláusula nos termos avisando o tenant de que a plataforma guarda os contatos, canal de exclusão a pedido do titular, regra de retenção. `docs/saver.md` lista como bloqueio de venda em escala |
| Vazamento da base (um único alvo com todos os contatos) | Sem rota de tenant para linhas; rota admin com cursor, sem `limit` livre; exportação admin auditada; nada em log |
| Produção em `all`: job na mesma instância da API | Tick leve (1 claim por sessão), sem laço ocupado; flag desligável |
| Worker separado no futuro | Job já itera sessões locais; nada a mudar |
| Tabela crescer (`SAVER_MAX` sem teto, sem expurgo) | Contato único na plataforma reduz linhas; índices por tenant; alerta em log acima de 500 mil; regra de retenção entra com a D5 |
| Fusão de contatos errada junta duas pessoas | Só funde quando a **mesma leitura** traz `lid` e `phone` juntos no mesmo participante; nunca por nome |
| Subagente rodar migration em produção | Mesma regra das outras features: só Postgres descartável |

## 10. O que não fazer

- Não buscar foto de perfil nem chamar `profilePictureUrl`.
- Não importar nada de `chat`, `campaigns`, `automation`, `link-rotation`, `storefront` dentro de `modules/saver`.
- Não alterar `getGroupParticipants`, `groupMetadataCache` nem os eventos tratados pelo adapter.
- Não processar extração em rota HTTP nem em job singleton de cluster.
- Não tratar chave `saver_*` ausente como ilimitada; ilimitado é `null` explícito no preset.
- Não apagar contato por job na v1 (retenção em aberto); não duplicar contato: unicidade é do banco.
- Não criar rota de tenant que devolva nome, telefone ou LID em JSON; não ler `saver_contacts` em caminho de tenant sem passar pelo vínculo com `tenantId`; não usar `contact.name` em arquivo de tenant.
- Não expor a base da plataforma a papel que não seja `SUPER_ADMIN`; não consultar a base sem `AuditLog`.
- Não apagar nem sobrescrever telefone guardado; leitura só preenche campo vazio.
- Não fundir contatos por nome nem por heurística; não criar RBAC geral: liberação individual é só `export`.
- Não registrar em log nem em auditoria nome, número ou LID; auditoria guarda só contagem, filtros e ids.
- Não enviar mensagem a membros extraídos a partir do Saver.
- Não ligar `SAVER_EXTRACTION_WORKER_ENABLED` fora da Render.
- Não guardar preço no banco; vitrine em `features/saver/plans/catalog.ts`.
