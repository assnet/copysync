# Aviso de credencial de afiliado — Tasks

**Design**: `design.md` · **Status**: **Done** (2026-10-28; api 0.43.0 · app 0.49.0). Linhas citadas abaixo são da revisão e envelheceram.

## Execução

```
Fase 1 (sequencial)   T1 → T2 → T3
Fase 2                T4 [P]  T6 [P]  (dependem de T3) → T5 (depende de T4: variante nova do tipo)
                      Fakes em `monitorTestFakes.ts` (T4, T6, T7) são aditivos: cada tarefa acrescenta o seu; sem reescrever o arquivo
Fase 3 (sequencial)   T7 → T8 → T9
Fase 4                T10 → (T11 [P]  T12 [P])   (app; T10 depende de T8)
Fase 5                T13 docs/changelog/versão
```

Gate por tarefa: `pnpm -C api tsc --noEmit` + `pnpm -C api test <arquivo>`; app: `npx tsc --noEmit` + `npx vitest run <pasta>`.
Nunca `prisma migrate dev` contra `api/.env` (produção): migration escrita à mão + validada em Postgres descartável
(memória `teste-local-postgres-descartavel`).

---

### T1: Colunas de rejeição, índice e ação de auditoria
**What**: `rejectedAt DateTime?`, `rejectedCode String?` em `AffiliateCredential`; `@@index([tenantId, status, capturedAt])` em `CapturedOffer` (hoje só `[status, capturedAt]` e `[tenantId, sessionId, capturedAt]`, `schema.prisma:1150-1151`); `AFFILIATE_CREDENTIAL_REJECTED` no enum `AuditAction` (`schema.prisma:50-74`) e na union `shared/audit/IAuditLogRepository.ts:5-28`. **Duas migrations**: `20261029000000_add_audit_action_affiliate_credential_rejected` só com `ALTER TYPE "AuditAction" ADD VALUE 'AFFILIATE_CREDENTIAL_REJECTED';` e `20261029000100_add_affiliate_credential_rejection` com colunas + índice (ADD VALUE não pode ser usado na mesma transação em que é criado).
**Where**: `api/prisma/schema.prisma:50-74,575-600,1148-1152`, `api/src/shared/audit/IAuditLogRepository.ts`, `api/prisma/migrations/…`
**Depends on**: None · **Requirement**: CRED-01, CRED-06
**Done when**: `prisma generate` ok; SQL da 2ª = `ALTER TABLE "affiliate_credentials" ADD COLUMN "rejectedAt" TIMESTAMP(3), ADD COLUMN "rejectedCode" TEXT; CREATE INDEX "captured_offers_tenantId_status_capturedAt_idx" ON "captured_offers"("tenantId","status","capturedAt");`
**Tests**: none (schema) · **Gate**: `tsc`

### T2: Entidade, mapper e repositório
**What**: campos `rejectedAt: Date | null`, `rejectedCode: string | null` na entidade; `markRejected(tenantId, provider, code, at)` via `updateMany({ where: { tenantId, provider } })` (no-op se a linha sumiu; mesmo padrão de `setStatus` :144); `upsert` (:74-89) grava `rejectedAt: null, rejectedCode: null` no `create` e, no `update`, só quando `UpsertAffiliateCredentialRecord.clearRejection` for `true` (quem decide é o use case, T3); `UpsertAffiliateCredentialRecord` (:14-19) e `UpsertAffiliateSessionRecord` (`domain/contracts/AffiliateCredentialRecords.ts:25-31`) ganham `clearRejection?: boolean` (**opcional**, ausente = `false`, para a T2 compilar antes de a T3 editar os use cases que montam o record, `UpsertAffiliateCredentialUseCase.ts:49`, `UpsertAffiliateSessionUseCase.ts:46`); `upsertSession` (:91-115) só limpa quando `true`; `clearSession` (:122-136) limpa; `setStatus` (:139-151) **não** mexe.
**Where**: `integrations/domain/entities/AffiliateCredential.ts`, `domain/contracts/IAffiliateCredentialRepository.ts`, `domain/contracts/AffiliateCredentialRecords.ts:14-31`, `infrastructure/repositories/PrismaAffiliateCredentialRepository.ts:74-151`, `infrastructure/mappers/PrismaAffiliateCredentialMapper.ts` + `.test.ts:7-17` (`row()`), `presentation/presenters/AffiliateCredentialPresenter.test.ts:12-19` (literal tipado), `AffiliateCredentialUseCases.test.ts:19-44` (`makeRecord` :19-28, `makeDeps satisfies IAffiliateCredentialRepository` :30-44), `UpsertAffiliateSessionUseCase.test.ts:14-33` (`record()` tipado e `makeDeps satisfies …` em :23-33: `markRejected: vi.fn()`)
**Depends on**: T1 · **Requirement**: CRED-01, CRED-05
**Done when**: `tsc` verde com todos os fakes/literais atualizados; comportamento do repositório Prisma (`markRejected` idempotente e no-op sem linha; `setStatus` mantém `rejectedAt`; `clearSession` zera; `upsertSession` com `clearRejection: false` mantém) é verificado na T9 (não há teste de repositório hoje).
**Tests**: unit do fake/contrato · **Gate**: `tsc` + testes de integrations

### T3: `resolveState` + `MarkAffiliateCredentialRejectedUseCase`
**What**: `ResolveAffiliateCredentialUseCase.resolveState()` devolvendo `ok | missing | rejected`, lendo por `findByTenantAndProvider` (`IAffiliateCredentialRepository.ts:14-17`; o `findActive…` filtra `ACTIVE` + `publicIdentifier`, esconderia INACTIVE/só-sessão rejeitadas). **`execute` não muda** (continua `findActive…`; credencial rejeitada ainda volta para o gerador, que segue como hoje). Use case novo `MarkAffiliateCredentialRejectedUseCase` grava rejeição e audita `AFFILIATE_CREDENTIAL_REJECTED` (só `provider`, `code`; `IAuditLogRepository` como em `UpsertAffiliateCredentialUseCase.ts:23`).
Contrato novo `campaigns/domain/contracts/IAffiliateCredentialGateway.ts` (`extends IAffiliateCredentialResolver` + `resolveState`, `markRejected`); `IAffiliateCredentialResolver` (`:12-14`) **intocado** (fake de `GenerateOfferUseCase.test.ts:45` segue válido). `resolveState` com `ok` devolve a credencial decifrada (chama `execute` depois de checar `rejectedAt`). `UpsertAffiliateSessionUseCase.ts:46-52` passa `clearRejection: changed` (`changed` em `:43`); `UpsertAffiliateCredentialUseCase.ts` passa `clearRejection: !providerUsesSession(provider) && (secret !== null || existing?.publicIdentifier !== publicIdentifier)` (`secret` local de `:32-39`; `existing` por `findByTenantAndProvider`, lido sempre, não só em `:42-47`; importar `providerUsesSession`). `resolveState`: `rejectedAt` presente ⇒ `rejected`; senão `execute(tenantId, provider)`; `null` ⇒ `missing`; cred ⇒ `ok`. `MarkAffiliateCredentialRejectedUseCase` ctor posicional `(repo, audit)`.
**Where**: `integrations/application/use-cases/ResolveAffiliateCredentialUseCase.ts:14-30`, novo `MarkAffiliateCredentialRejectedUseCase.ts`, novo `campaigns/domain/contracts/IAffiliateCredentialGateway.ts`, `UpsertAffiliateSessionUseCase.ts:43-52` + `.test.ts`, `UpsertAffiliateCredentialUseCase.ts:26-58`, `AffiliateCredentialUseCases.test.ts:138-178`
**Depends on**: T2 · **Requirement**: CRED-01, CRED-03, CRED-05
**Done when**: `rejected` com `rejectedAt` presente para ACTIVE e INACTIVE; `missing` quando `execute` devolve `null` (INACTIVE sem rejeição, sem secret); `ok` com cred decifrada; `execute` inalterado (teste existente :138-178 passa sem edição); sync com mesmo token mantém rejeição, token novo limpa; painel ML (só etiqueta) mantém; painel Shopee com secret novo ou AppID diferente limpa; Shopee salvando igual mantém.
**Tests**: 5 casos de `resolveState` + auditoria sem segredo + 2 do sync (`UpsertAffiliateSessionUseCase.test.ts`) + 4 do painel em `AffiliateCredentialUseCases.test.ts` (Shopee secret novo limpa, AppID diferente limpa, igual mantém, ML só etiqueta mantém) · **Gate**: idem

### T4 [P]: `BuildTenantAffiliateLinkUseCase` com estado de credencial
**What**: `deps.credentials` passa a ser `IAffiliateCredentialGateway`. `offersContainer.ts`: criar `credentialRepo = lazy(() => new PrismaAffiliateCredentialRepository())`, reusar em `credentials` (`:52-54`), compor `credentialGateway` (ver design; imports `MarkAffiliateCredentialRejectedUseCase` e `shared/audit/PrismaAuditLogRepository`), exportar `credentialRepo` no objeto (`:102-122`); `generateOffer` (`:65`) segue com `credentials()`. No use case: `resolveState` dentro do `try` de `:59-63`; `rejected` → `{ kind: 'credential_rejected', provider, since }` sem chamar a loja; o `catch` de `:97-99` passa a testar `err instanceof AppError && err.code === 'AFFILIATE_CREDENTIAL_REJECTED'` **antes** de `failure()` (síncrona, não serve para o `await markRejected`) → `markRejected` + `credential_rejected`; demais códigos seguem `failure()`. Inclui `mlRefFromPage`. Variante `credential_rejected` em `TenantAffiliateLink` (`:12-17`, retorno do use case) e também em `TenantLinkResult` (`automation/domain/contracts/IMonitorPorts.ts:4-8`) e no `FakeLinkBuilder` (`monitorTestFakes.ts:99-105`), senão `CampaignsTenantLinkBuilder.build` (`CampaignsMonitorAdapters.ts:9-11`) não compila.
**Where**: `campaigns/application/use-cases/BuildTenantAffiliateLinkUseCase.ts:62-115`, `BuildTenantAffiliateLinkUseCase.test.ts:16` (fake de deps), `campaigns/infrastructure/offersContainer.ts:52-96`, `automation/domain/contracts/IMonitorPorts.ts`, `monitorTestFakes.ts:99-105`
**Depends on**: T3 · **Requirement**: CRED-01, CRED-03, CRED-04
**Done when**: teste conta chamadas da loja: após rejeição, 0 chamadas na captura seguinte; rate limit não marca; `GenerateOfferUseCase` sem edição.
**Tests**: unit · **Gate**: idem

### T5: Reason `CREDENTIAL_REJECTED` na captura
**What**: `CAPTURED_OFFER_REASONS` + `RETRYABLE_REASONS`; branch novo na if-chain de `ProcessPendingCapturedOffersUseCase.resolve` (`:105-107`; `failed` :105, `credential_missing` :106), **antes** de `:107`: `credential_rejected` → `SKIPPED / CREDENTIAL_REJECTED` com `{ marketplace }`. Sem o branch, cai em `replacements.set(…, null)` e o link some em silêncio (ou `UNSUPPORTED_MARKETPLACE` se for o único).
**Where**: `automation/domain/entities/CapturedOffer.ts:5-27`, `ProcessPendingCapturedOffersUseCase.ts:99-116`, `.test.ts:106-116`
**Depends on**: T4 (variante `credential_rejected` em `TenantLinkResult` e `FakeLinkBuilder`) · **Requirement**: CRED-02
**Done when**: testes: 1 link recusado → SKIPPED/CREDENTIAL_REJECTED; 2 links (um recusado, um ok) → SKIPPED/CREDENTIAL_REJECTED (não envia texto pela metade); `RetryCapturedOfferUseCase` aceita o reason sem mudança.
**Tests**: unit · **Gate**: idem

### T6 [P]: `listRecentMissingProviders` no repositório de capturas
**What**: contrato + Prisma: `DISTINCT marketplace` com `status SKIPPED`, `reason CREDENTIAL_MISSING`, `marketplace IS NOT NULL` (coluna é `AffiliateProvider?`, `schema.prisma:1129`), `capturedAt >= since`, `tenantId`.
**Where**: `automation/domain/contracts/ICapturedOfferRepository.ts`, `infrastructure/repositories/PrismaCapturedOfferRepository.ts`, fake em `monitorTestFakes.ts`
**Depends on**: T3 · **Requirement**: CRED-06
**Done when**: query tenant-aware; usa o índice `[tenantId, status, capturedAt]` criado na T1.
**Tests**: fake + unit no T7 · **Gate**: idem

### T7: `credentialAlerts` no DTO e no use case de config
**What**: porta nova no domínio de automação `ICredentialStateSource { listStates(tenantId): { provider, usable: boolean, rejectedAt: Date | null, rejectedCode: string | null }[] }` (`automation/domain/contracts/IMonitorPorts.ts`); adapter em `CampaignsMonitorAdapters.ts` sobre `offersContainer.credentialRepo().listByTenant` (T4), com `usable` = `ACTIVE && publicIdentifier && (!providerRequiresSecret || hasSecret) && (!providerUsesSession || hasSession)` (`affiliateProviderFields.ts:36-42`, entidade `:15-16`). `GroupMonitorConfigDeps` (`GroupMonitorConfigUseCases.ts:15-19`) ganha `credentialStates` e `captured`; `configDeps()` (`automationContainer.ts:22`) injeta; fake em `monitorTestFakes.ts` e setup de `GroupMonitorConfigUseCases.test.ts:11`. O use case itera `AFFILIATE_PROVIDERS` (loja sem linha = não utilizável); `since = now − 7 dias`, `now` injetável em `GroupMonitorConfigDeps`. Cálculo **só em `GetGroupMonitorConfigUseCase.execute` (`:60-63`)**, não em `load` (`:76,122,133`). `GroupMonitorConfigDTO.credentialAlerts?` **opcional** (Save* não devolve); `since` = `rejectedAt` ou `null`. Schema de resposta.
**Where**: `automation/application/dtos/GroupMonitorDTO.ts:7-14`, `GroupMonitorConfigUseCases.ts:15-19,59-64`, `automation/domain/contracts/IMonitorPorts.ts`, `automation/infrastructure/adapters/CampaignsMonitorAdapters.ts`, `automation/infrastructure/automationContainer.ts:22`, `presentation/schemas/groupMonitoring.schema.ts:81-107`, `monitorTestFakes.ts`, `GroupMonitorConfigUseCases.test.ts:11`
**Depends on**: T2, T4, T6 · **Requirement**: CRED-06
**Done when**: teste: ML rejeitada + Shopee missing recente → 2 alertas; sem capturas → só REJECTED; `INACTIVE` com captura recente → MISSING; Shopee `ACTIVE` sem secret com captura recente → MISSING; `INACTIVE` + `rejectedAt` + captura MISSING recente → **um** alerta, REJECTED.
**Tests**: unit · **Gate**: idem

### T8: Presenter de credencial expõe rejeição
**What**: `rejectedAt`, `rejectedCode` no presenter e no schema.
**Where**: `integrations/presentation/presenters/AffiliateCredentialPresenter.ts:8-21`, `schemas/affiliateCredential.schema.ts:5-19`
**Depends on**: T2 · **Requirement**: CRED-08
**Tests**: presenter · **Gate**: idem

### T9: Migration e repositório em Postgres descartável
**What**: o repo não tem teste com banco (`api/vitest.config.mts` inclui só `src/**/*.test.ts`; `src/test/setup.ts` usa env sintético; `docs/sessoes-auth-state.md:144` diz que o Postgres descartável é script manual fora do repo). Criar: (a) `api/scripts/postgres-descartavel.sh` (ao lado de `prisma-migrate-deploy-with-retry.mjs`; `scripts/` da raiz é Python por AGENTS §7): `docker run` de Postgres efêmero + `prisma migrate deploy` com `DATABASE_URL` apontado para ele; nunca lê `api/.env`; (b) `api/vitest.int.config.mts` com `include: ['src/**/*.int.test.ts']` e setupFile próprio que **importa `src/test/setup.ts` primeiro** (env sintético: `JWT_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` etc.; `env.ts:26` valida no import e `prisma.client.ts` importa `logger` → `env`), depois exige `INTEGRATION_DATABASE_URL`, recusa host fora de `localhost`/`127.0.0.1` e sobrescreve `process.env.DATABASE_URL` (os repositórios usam o singleton `shared/database/prisma.client.ts`, que lê `DATABASE_URL`; `src/test/setup.ts` hoje injeta um sintético); **`api/vitest.config.mts` ganha `exclude: ['src/**/*.int.test.ts']`** (o `include` atual `src/**/*.test.ts` casaria com eles); script `test:int` em `api/package.json`; (c) `PrismaAffiliateCredentialRepository.int.test.ts` (`markRejected` idempotente e no-op sem linha; `setStatus` mantém; `clearSession` zera; `upsertSession` com `clearRejection` false/true; `upsert` idem) e `PrismaCapturedOfferRepository.int.test.ts` (`listRecentMissingProviders`, T6); (d) rodar T7 ponta a ponta contra o banco.
**Where**: `api/scripts/postgres-descartavel.sh`, `api/vitest.int.config.mts` + setup próprio, `api/vitest.config.mts` (exclude), `api/package.json` (`test:int`), `api/src/modules/integrations/infrastructure/repositories/PrismaAffiliateCredentialRepository.int.test.ts`, `api/src/modules/automation/infrastructure/repositories/PrismaCapturedOfferRepository.int.test.ts`
**Depends on**: T1–T8 · **Requirement**: CRED-01, CRED-05, CRED-06
**Done when**: migrations aplicam limpas; `pnpm -C api test:int` passa com o Postgres do script; `pnpm -C api test` continua sem banco; nenhuma alteração em produção. Resultado registrado no PR. **Lacuna aceita**: `test:int` não roda no CI (não há CI com banco); fica como gate manual de release, anotado na spec.

### T10: Tipos e strings do app
**What**: `CapturedOfferReason` + `CREDENTIAL_REJECTED`; `GroupMonitorConfigResponse.credentialAlerts?`; `AffiliateCredentialItem.rejectedAt: string | null`, `rejectedCode: string | null` (obrigatórios; literais tipados a atualizar: `AffiliateCredentialDialog.test.tsx:12`, `useAffiliateCredentials.test.ts:15`, `AffiliateCredentialCard.test.tsx:11`); `RETRYABLE_REASONS` do app; labels em `monitoring/strings.ts` (reason + bloco `credentialAlerts`) e `settings/strings.ts` (`statusRejected`, dicas, `backToMonitoring`). `useMonitoringConfig.apply` (`:36-39`, usado por `saveSettings` `:44` e pelos saves de grupos `:52,60`) preserva `credentialAlerts` anterior quando a resposta não traz.
**Where**: `app/src/types/api.types.ts:532-568`, `features/monitoring/utils/settingsDraft.ts:83`, `features/monitoring/strings.ts:245-252`, `features/settings/strings.ts:62-64`, `features/monitoring/hooks/useMonitoringConfig.ts:36-60`, novo `useMonitoringConfig.test.ts`
**Depends on**: T8 · **Requirement**: CRED-02, CRED-06, CRED-07, CRED-08
**Tests**: `useMonitoringConfig.test.ts` (save sem `credentialAlerts` mantém o anterior) · **Gate**: `npx tsc --noEmit` + `vitest run src/features/monitoring/hooks`

### T11 [P]: `CredentialAlerts` na página de monitoramento
**What**: componente novo com `Alert` por loja (MISSING `warning`, REJECTED `error`), botão "Configurar credencial" → `/settings/affiliate-credentials?returnTo=/monitoring`; render entre header e cards. Nada renderizado com lista vazia.
**Where**: novo `features/monitoring/components/CredentialAlerts.tsx`, `pages/monitoring/MonitoringPage.tsx:99-127`
**Depends on**: T10 · **Requirement**: CRED-07
**Done when**: teste de render (2 alertas / 0 alertas); claro/escuro; agent-browser screenshot.
**Tests**: component · **Gate**: `vitest run src/features/monitoring`

### T12 [P]: Status "Recusada" no card e volta ao monitoramento
**What**: `AffiliateCredentialCard` mostra "Recusada" (chip `error`, `stateChip` em `:30-34`) com data e dica por loja quando `rejectedAt`; some após salvar (dado vem do refetch). `AffiliateCredentialsPage` (hoje sem hook de router, `:1-12`) usa `useSearchParams`/`useNavigate`, guarda `safeReturnPath(returnTo)` (`features/sessions/utils.ts:81`) em `useRef` **antes** de limpar a query, mostra botão "Voltar ao monitoramento" (padrão `app/src/pages/SessionsPage.tsx:23-50`).
**Where**: `features/settings/components/AffiliateCredentialCard.tsx:30-34`, `AffiliateCredentialCard.test.tsx`, `pages/settings/AffiliateCredentialsPage.tsx`
**Depends on**: T10 · **Requirement**: CRED-07, CRED-08
**Tests**: component · **Gate**: `vitest run src/features/settings`

### T13: Docs, CHANGELOG, versões
**What**: `docs/monitoramento-grupos.md` §2.1 (loja pausada) e §3 (lista de reasons retryable, L104), `docs/integracoes-credenciais-afiliado.md` (colunas, quem grava e quem limpa, nunca gravar corpo da resposta, `test:int`), `CHANGELOG.md` raiz sob `[Unreleased]`, dois cabeçalhos no padrão de um escopo e uma versão: `### Added — automation/integrations (api 0.39.0) — aviso de credencial de afiliado recusada` e `### Added — app (0.45.0) — aviso de credencial no monitoramento`, com bullets `- **\`Arquivo\`** — …` (`api/CHANGELOG.md` parou em 0.24.0 e não é mais usado); hoje api 0.38.2, app 0.44.0; `package.json` dos dois.
**Depends on**: T11, T12 · **Requirement**: todos

## Cross-check dependências × diagrama

| Task | Depends on | No diagrama |
| --- | --- | --- |
| T1 | — | Fase 1 ✅ |
| T2 | T1 | Fase 1 ✅ |
| T3 | T2 | Fase 1 ✅ |
| T4, T6 | T3 | Fase 2 ✅ |
| T5 | T4 | Fase 2, após T4 ✅ |
| T7 | T2, T4, T6 | Fase 3 (após fase 2) ✅ |
| T8 | T2 | Fase 3 ✅ (poderia ser fase 2; mantido sequencial por tocar schema HTTP junto de T7) |
| T9 | T1–T8 | Fase 3 ✅ |
| T10 | T8 | Fase 4, primeiro ✅ |
| T11, T12 | T10 | Fase 4, após T10, `[P]` entre si ✅ |
| T13 | T11, T12 | Fase 5 ✅ |

## Cobertura de requisitos

| Req | Tasks |
| --- | --- |
| CRED-01 | T1, T2, T3, T4, T9 |
| CRED-06 | T1, T6, T7, T10 |
| CRED-02 | T5, T10 |
| CRED-03 | T3, T4 |
| CRED-04 | T4 |
| CRED-05 | T2, T3, T9 |
| CRED-07 | T10, T11, T12 |
| CRED-08 | T8, T10, T12 |

8 requisitos, 8 mapeados, 0 sem tarefa.
