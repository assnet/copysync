# Credenciais de afiliado — Tasks

**Design**: `design.md` · **Status**: Executado 2026-10-22
**Gates** (`.specs/codebase/TESTING.md`): quick = `pnpm test` no app tocado; full = `typecheck && test` nos dois.
**Branch**: `feature/affiliate-credentials` a partir de `develop`. Versão alvo: **0.18.0** (minor).

---

## Execution Plan

```
Fase 1 (sequencial):      T0 → T1 → T2
Fase 2 API (paralelo):    T2 ─┬→ T3 [P] ─┐
                              ├→ T4 [P] ─┼→ T6 → T7 → T7b → T8
                              └→ T5 [P] ─┘
Fase 3 App (paralelo c/ Fase 2 após T2): T2 → T9 → T10 → T11 → T12 → T13
T7b ──→ T13 (estado "Sessão sincronizada" do card ML)
Fase 4 (sequencial):      T8 + T13 → T14 → T15 → T16
```

T9 depende só do contrato (T2 fixa o DTO), então o painel anda junto com a API; T10 segue T9.

---

## Task Breakdown

### T0: Verificar campos oficiais dos 3 programas de afiliado
**What**: Confirmar nome e formato dos campos (Shopee appId/secret; ML id de afiliado; Amazon associate tag) na doc oficial e registrar em `design.md` + `STATE.md` (decisão).
**Where**: `.specs/features/affiliate-credentials/design.md`, `.specs/project/STATE.md`
**Depends on**: None · **Requirement**: AFCRED-05
**Tools**: Skill `anthropic-skills:deep-research` ou WebSearch; MCP Context7 se houver SDK.
**Done when**: tabela "Campos por marketplace" da spec marcada como verificada, com regex de formato por campo.
**Tests**: none · **Gate**: —

### T1: Schema Prisma + migration
**What**: Enums `AffiliateProvider`, `AffiliateCredentialStatus`, model `AffiliateCredential` (inclui campos de sessão do T7b e `publicIdentifier` opcional), relação inversa em `Tenant`, 3 valores novos em `AuditAction` (`AFFILIATE_CREDENTIAL_UPSERTED`, `AFFILIATE_CREDENTIAL_DELETED`, `AFFILIATE_SESSION_SYNCED`); migration única `add_affiliate_credentials`.
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_add_affiliate_credentials/`
**Depends on**: T0 · **Reuses**: migration `20260309213710_add_session_deleted_audit_action` (padrão de enum) · **Requirement**: AFCRED-03, AFCRED-09, AFCRED-13
**Done when**: migration gerada contra banco **local**; `prisma generate` ok. ⚠️ `api/.env` aponta para o Postgres de produção na Render e o Prisma CLI lê esse arquivo por padrão: rodar sempre com a variável de processo sobrepondo, ex. `DATABASE_URL="$(grep ^DATABASE_URL= .env.dev | cut -d= -f2-)" pnpm prisma migrate dev --name add_affiliate_credentials`, e antes conferir (sem imprimir o valor) que o host em `.env.dev` é `localhost:5440`, ex. `grep -c '@localhost:5440/' .env.dev` = 1. Nunca `pnpm prisma:migrate` puro.
**Tests**: none · **Gate**: `pnpm typecheck` (api)

### T2: Domínio + contratos + DTO
**What**: `AffiliateCredential.ts`, enums, `IAffiliateCredentialRepository.ts`, `AffiliateCredentialRecords.ts`, `AffiliateCredentialDTO.ts`, `AffiliateCredentialErrors.ts`; `AuditAction` union em `shared/audit`.
**Where**: `api/src/modules/integrations/domain/**`, `application/dtos/`, `api/src/shared/errors/internal/AffiliateCredentialErrors.ts`, `api/src/shared/audit/IAuditLogRepository.ts`
**Depends on**: T1 · **Reuses**: `SessionErrors.ts` · **Requirement**: AFCRED-03, AFCRED-04
**Done when**: tipos exportados; nenhum import de `@prisma/client` em domain/application.
**Tests**: none · **Gate**: typecheck

### T3: Funções puras de domínio [P]
**What**: `maskIdentifier.ts` (`••••` + 4 últimos; < 4 chars → tudo mascarado) e `affiliateProviderFields.ts` (campos exigidos por provider + `validatePublicIdentifier(provider, value)`).
**Where**: `api/src/modules/integrations/domain/services/` + `.test.ts` co-locados
**Depends on**: T2 · **Requirement**: AFCRED-04, AFCRED-05
**Done when**: testes cobrem cada provider, trim, vazio, tamanho curto.
**Tests**: unit · **Gate**: quick (api)

### T4: Cifra de segredo [P]
**What**: `ISecretCipher.ts` + `AesGcmSecretCipher.ts` (AES-256-GCM, iv 12 bytes, tag 16, `keyVersion`); `CREDENTIALS_ENCRYPTION_KEY` em `env.ts` (opcional; vazia/espaços = ausente; tamanho ≠ 32 bytes após base64 = ausente + `logger.error`, checado na `SecretCipherFactory`), factory do cipher lança `SecretCipherUnavailableError` (503) se ausente, AAD por campo (ver abaixo), em `src/test/setup.ts` e em `api/.env.local` (gitignored; gerada com `openssl rand -base64 32`; **nunca** em `api/.env.dev`, que está versionado apesar do `.gitignore`, nem em `api/.env`); `env.ts` carrega `.env.local` antes do zod com `process.loadEnvFile` só se o arquivo existir (sem lib nova); `engines.node` em `api/package.json` sobe para `>=20.12.0` (mínimo do `loadEnvFile`); `SecretCipherFailedError` e `SecretCipherUnavailableError` em `shared/errors/internal/SecretCipherErrors.ts`; AAD = `tenantId:provider:campo` (`secret` | `session`), para blob trocado entre colunas não decifrar.
**Where**: `api/src/app/server.ts` (`SecretCipherFactory.check()` + `logger.error` no boot), `api/src/shared/security/`, `api/src/shared/errors/internal/SecretCipherErrors.ts`, `api/src/shared/config/env.ts`, `api/src/test/setup.ts`, `api/.env.local`, `api/package.json` (`engines`)
**Depends on**: T2 · **Requirement**: AFCRED-06
**Done when**: `pnpm dev` sobe com a chave vinda de `.env.local` e `git status` não lista o arquivo; round-trip ok; ciphertext ≠ plain; tag adulterada lança `SecretCipherFailedError`; AAD de outro tenant não decifra; chave curta → 503 sem derrubar boot; chave ausente ou vazia → 503 só no cipher, boot segue (teste de `env.ts`).
**Tests**: unit · **Gate**: quick (api)

### T5: Repositório Prisma + mapper [P]
**What**: `PrismaAffiliateCredentialRepository.ts` (`listByTenant`, `findByTenantAndProvider`, `findActiveByTenantAndProvider`, `upsert` — só público/secreto, preserva sessão —, `upsertSession` — colunas de sessão + `publicIdentifier` só se null —, `delete`, `setStatus`, todos com `tenantId`; `delete`/`setStatus` via `deleteMany`/`updateMany` com contagem; P2002 no upsert concorrente repete 1x; nenhum erro Prisma cru sobe); tipos em `domain/contracts/AffiliateCredentialRecords.ts` (T2); mapper deriva `hasSecret`/`hasSession` e `PrismaAffiliateCredentialMapper.ts`.
**Where**: `api/src/modules/integrations/infrastructure/`
**Depends on**: T2 · **Reuses**: `PrismaSessionMapper` · **Requirement**: AFCRED-03, AFCRED-08
**Done when**: nenhum model Prisma sai do método; `upsert` usa `tenantId_provider`.
**Tests**: none (infra sem banco nos testes) · **Gate**: typecheck

### T6: Use cases
**What**: `ListAffiliateCredentialsUseCase`, `UpsertAffiliateCredentialUseCase` (valida via T3, cifra via T4, secret vazio em registro existente = mantém, auditoria), `DeleteAffiliateCredentialUseCase` (404 + auditoria), `SetAffiliateCredentialStatusUseCase` (P2), `ResolveAffiliateCredentialUseCase` (decifra; lê via `findActiveByTenantAndProvider`; retorno tipado com `publicIdentifier: string` obrigatório), `UpsertAffiliateSessionUseCase` (T7b).
**Where**: `api/src/modules/integrations/application/use-cases/` + `.test.ts`
**Depends on**: T3, T4, T5 · **Reuses**: `DeleteSessionUseCase.ts:47` (audit), `api/src/modules/media/application/use-cases/GetUploadSessionUseCase.test.ts` (`makeDeps`) · **Requirement**: AFCRED-03, 04, 06, 07, 08, 09, 10
**Done when**: testes: upsert novo exige secret na Shopee; upsert existente sem secret mantém ciphertext; delete inexistente 404; audit sem valor da chave; resolve ignora `INACTIVE` e linha ML só-sessão (`publicIdentifier` null).
**Tests**: unit · **Gate**: quick (api)

### T7: Presenter + schemas + rotas
**What**: `AffiliateCredentialPresenter.ts`, `affiliateCredential.schema.ts` (params enum, body, response `AffiliateCredentialItem#` via `app.addSchema`), `affiliateCredential.routes.ts` (GET, PUT, DELETE, PATCH status) com `[authHook, tenantHook]`; registro em `src/app/routes.ts`.
**Where**: `api/src/modules/integrations/presentation/`, `api/src/app/routes.ts`, `api/src/app/app.ts` (addSchema)
**Depends on**: T6 · **Reuses**: `session.schema.ts` (schema), `auth.routes.ts:46` + `shared/http/httpResponse.ts` (envelope `{ success, data }`; **não** copiar `session.routes.ts`, que responde corpo cru) · **Requirement**: AFCRED-03, 04, 08, 10
**Done when**: handlers finos (schema → use case → presenter); nenhuma resposta contém campo secreto; OpenAPI mostra as 4 rotas.
**Tests**: unit do presenter (sem `secret*`/`session*` na saída; `publicIdentifier` null) + `app.inject` do GET serializando `publicIdentifier` null (schema de response com `type: ['string','null']`) · **Gate**: quick (api)

### T7b: Rota de sessão do marketplace (extensão Chrome)
**What**: `PUT /integrations/affiliate-credentials/:provider/session` (só `MERCADO_LIVRE`), body `{ sessionToken, csrfToken, affiliateTag?, capturedAt }` (contrato em `extension/src/contract/api.ts`), `[authHook, tenantHook]`; use case `UpsertAffiliateSessionUseCase` cifra `sessionToken`/`csrfToken` com `ISecretCipher` (T4), grava em `sessionCiphertext/Iv/Tag` + `sessionSyncedAt` (T1), grava via `upsertSession` (cria a linha se não existir; `publicIdentifier` = `affiliateTag` ou null; `affiliateTag` preenche `publicIdentifier` só se vazio); `affiliateTag` passa por `validatePublicIdentifier` (T3): inválida é descartada (sessão grava mesmo assim, `tagIgnored: true` no meta da auditoria), para não travar a renovação a cada 30 min; o schema da rota limita `maxLength: 64`; `sessionSyncedAt` = `now()` do servidor (`capturedAt` só vai para o meta da auditoria); auditoria só quando o `sessionToken` difere do atual decifrado (alarme de 30 min não enche `audit_logs`); se o blob atual não decifra, trata como "mudou": regrava, audita sem valor e loga warn (nunca 500 em loop); `:provider` ≠ `MERCADO_LIVRE` → 422 `AFFILIATE_CREDENTIAL_INVALID`; `affiliateTag` só preenche `publicIdentifier` vazio — valor do painel sempre vence (decisão); schema da rota: `sessionToken`/`csrfToken` `maxLength: 8192` (cookie real medido no T0; ajustar se maior), `affiliateTag` sem `maxLength` no schema (tamanho validado no domínio e tag descartada, nunca 400); corrigir também "T7" → "T7b" em `docs/extensao-navegador.md:45`; auditoria `AFFILIATE_SESSION_SYNCED` sem valor do token. Resposta `{ provider, status, updatedAt }` no envelope padrão. Corrigir comentário `extension/src/contract/api.ts:11` ("T7" → "T7b").
**Where**: `api/src/modules/integrations/{application,presentation}/`, `extension/src/contract/api.ts` (comentário), `docs/extensao-navegador.md`
**Depends on**: T7 · **Requirement**: AFCRED-06, AFCRED-09, AFCRED-13 · **Doc**: `docs/extensao-navegador.md` (Pendências #1)
**Done when**: extensão em `pnpm dev` sincroniza e o popup mostra "Sessão sincronizada"; testes: sessão nova cria linha com `publicIdentifier` null; `affiliateTag` inválida → sessão gravada e tag ignorada; resposta no envelope `{ success, data }`; segundo sync com mesmo token não audita; blob atual indecifrável → regrava sem 500; linha existente sem ID + tag válida → `publicIdentifier` preenchido; linha com ID + tag diferente → ID mantido; provider ≠ ML → 422; `GET /` não expõe o token.
**Tests**: unit · **Gate**: quick (api)

### T8: Smoke da API
**What**: Com `pnpm dev` local apontando para banco local (não produção): PUT/GET/DELETE via curl; checar linha no banco cifrada e `audit_logs`.
**Where**: roteiro em `docs/integracoes-credenciais-afiliado.md` (seção "Smoke")
**Depends on**: T7b · **Requirement**: AFCRED-03..09
**Done when**: roteiro executado e anotado.
**Tests**: smoke · **Gate**: full (api)

### T9: Tipos + service + strings [P]
**What**: `AffiliateCredentialItem`, `AffiliateProvider` em `types/api.types.ts`; `services/affiliateCredential.service.ts` (`list/upsert/remove/setStatus`); `features/settings/strings.ts` (textos de credenciais + migrar os inline de `SettingsAccountPage` e `ChangePasswordForm` para lá); `features/settings/affiliateProviders.ts` (catálogo com campos de T0).
**Where**: `app/src/types/api.types.ts`, `app/src/services/`, `app/src/features/settings/`
**Depends on**: T2 (contrato) · **Reuses**: `auth.service.ts` (lê `res.data.data` do envelope; não `session.service.ts`), `chat/strings.ts` · **Requirement**: AFCRED-05, AFCRED-12, AFCRED-13
**Done when**: nenhum texto novo inline; nome do produto ausente.
**Tests**: none · **Gate**: typecheck (app)

### T10: `AffiliateCredentialDialog`
**What**: Dialog com campos do catálogo; público obrigatório + regex; secret com olho (padrão `ChangePasswordForm.tsx:92-132`), placeholder "mantido se vazio" na edição; mantém valores em erro de API; `Tooltip` MUI nos ícones.
**Where**: `app/src/features/settings/components/AffiliateCredentialDialog.tsx` + `.test.tsx`
**Depends on**: T9 · **Requirement**: AFCRED-05, 06(UI), 07, 12
**Done when**: teste: submit vazio não chama `onSubmit`; edição envia `secret` ausente quando vazio; render no escuro.
**Tests**: unit (Testing Library, `renderWithTheme`) · **Gate**: quick (app)

### T11: `AffiliateCredentialCard` + hook
**What**: `AffiliateCredentialCard.tsx` (`SectionCard`, chip Configurado/Não configurado/Inativo, campos mascarados read-only, botões Configurar/Editar/Remover com `ConfirmDialog`, switch Ativo P2) e `hooks/useAffiliateCredentials.ts` (carrega lista, mescla com catálogo, remove/status otimista com rollback no card; upsert **não** é otimista: diálogo fica aberto até 2xx e mantém valores em erro).
**Where**: `app/src/features/settings/components/`, `app/src/features/settings/hooks/`, testes co-locados
**Depends on**: T9, T10 · **Reuses**: `app/src/features/sessions/components/SessionCard.tsx` (ações), `ConfirmDialog` · **Requirement**: AFCRED-02, 04, 07, 08, 10, 12, 13
**Done when**: teste: lista vazia → 3 cards "Não configurado"; item configurado mostra máscara e nunca o valor; card Mercado Livre mostra "Sessão sincronizada" + data quando `hasSession`, "ID pendente" quando `publicIdentifier` é null, e orientação para instalar/abrir a extensão quando `hasSession` é false; diálogo de edição pré-preenche `publicIdentifier` em claro; escuro.
**Tests**: unit · **Gate**: quick (app)

### T12: Página + submenu + rota
**What**: `pages/settings/AffiliateCredentialsPage.tsx` (`PageHeader` + aviso explicando para que servem as chaves + grid de cards); item em `SETTINGS_NAV` (`SettingsLayout.tsx:7-9`) com ícone renderizado (corrigir: `icon` hoje é ignorado); `<Route path="affiliate-credentials">` em `AppRoutes.tsx:25-29`.
**Where**: `app/src/pages/settings/`, `app/src/features/settings/components/SettingsLayout.tsx`, `app/src/routes/AppRoutes.tsx`
**Depends on**: T11 · **Requirement**: AFCRED-01, AFCRED-02
**Done when**: `/settings/affiliate-credentials` abre; submenu marca ativo; menu lateral "Configurações" segue ativo.
**Tests**: none · **Gate**: typecheck (app)

### T13: Verificação visual
**What**: Abrir o painel local, percorrer P1 nos modos claro e escuro, capturar screenshots; ajustar espaçamento/contraste.
**Where**: screenshots no scratchpad; ajustes nos componentes de T10/T11
**Depends on**: T12, T7b · **Requirement**: AFCRED-12
**Tools**: Skill `agent-browser`; Skill `ui-ux-pro-max` para revisão.
**Done when**: sem texto cortado, sem cor fixa, chips legíveis no escuro.
**Tests**: smoke · **Gate**: quick (app)

### T14: Documentação
**What**: `docs/integracoes-credenciais-afiliado.md` (o que guarda, cifra, rotação de chave, o que não fazer: nunca devolver secret, nunca logar body do PUT); roadmap item 3 → ✅; `STATE.md` decisões (cifra em env, público em claro).
**Where**: `docs/`, `docs/produto-roadmap.md`, `.specs/project/STATE.md`
**Depends on**: T8, T13 · **Requirement**: todos
**Tests**: none · **Gate**: —

### T15: Versão + CHANGELOG
**What**: `api/package.json` e `app/package.json` → `0.18.0`; (`app/public/site.webmanifest` não tem `version`); `api/CHANGELOG.md` seção `[Unreleased]` → Added (api `integrations`, app `settings`), com arquivos.
**Where**: raiz, `api/`, `app/`
**Depends on**: T14 · **Done when**: `pnpm typecheck && pnpm test` nos dois.
**Tests**: — · **Gate**: full

### T16: Commits + PR para `develop`
**What**: commits atômicos (`feat(integrations): …`, `feat(settings): …`, `docs: …`, `chore(release): …`); PR com template do AGENTS.md §35. Checklist do PR inclui: **criar `CREDENTIALS_ENCRYPTION_KEY` (32 bytes base64) no dashboard da Render antes do deploy** — `render.yaml` não declara a API; sem ela as rotas de afiliado respondem 503.
**Depends on**: T15 · **Gate**: full + CI verde

---

## Diagram ↔ Definition Cross-Check

| Task | Depends on (definição) | No diagrama | OK |
| --- | --- | --- | --- |
| T0 | — | início | ✅ |
| T1 | T0 | T0→T1 | ✅ |
| T2 | T1 | T1→T2 | ✅ |
| T3/T4/T5 | T2 | T2→{T3,T4,T5} [P] | ✅ |
| T6 | T3,T4,T5 | {T3,T4,T5}→T6 | ✅ |
| T7 | T6 | T6→T7 | ✅ |
| T7b | T7 | T7→T7b | ✅ |
| T8 | T7b | T7b→T8 | ✅ |
| T9 | T2 | T2→T9 [P] | ✅ |
| T10 | T9 | T9→T10 | ✅ |
| T11 | T9,T10 | →T11 | ✅ |
| T12 | T11 | T11→T12 | ✅ |
| T13 | T12,T7b | T13 após T12 e API pronta | ✅ |
| T14 | T8,T13 | T8+T13→T14 | ✅ |
| T15 | T14 | T14→T15 | ✅ |
| T16 | T15 | T15→T16 | ✅ |

## Test Co-location Validation (TESTING.md)

| Task | Camada | Exigido | Na task | OK |
| --- | --- | --- | --- | --- |
| T2 | domain contracts/entities | none | none | ✅ |
| T3 | domain/services (função pura) | unit | unit | ✅ |
| T4 | shared/security | unit | unit | ✅ |
| T5 | infrastructure/repositories | none (sem banco em teste) | none | ✅ |
| T6 | application/use-cases | unit | unit | ✅ |
| T7 | presentation | none (mínimo) | unit (presenter) + inject (extra) | ✅ |
| T10/T11 | componentes visuais | unit + asserção no escuro | unit + escuro | ✅ |
| T12 | page/route | none | none | ✅ |

## Traceability

| ID | Tasks |
| --- | --- |
| AFCRED-01 | T12 |
| AFCRED-02 | T11, T12 |
| AFCRED-03 | T1, T2, T5, T6, T7 |
| AFCRED-04 | T2, T3, T6, T7, T11 |
| AFCRED-05 | T0, T3, T9, T10 |
| AFCRED-06 | T4, T6, T7b, T10 |
| AFCRED-07 | T6, T10, T11 |
| AFCRED-08 | T5, T6, T7, T8, T11 |
| AFCRED-09 | T1, T6, T7b |
| AFCRED-10 | T6, T7, T11 |
| AFCRED-11 | — (P3, não planejado) |
| AFCRED-12 | T9, T10, T11, T13 |
| AFCRED-13 | T1, T7b, T9, T11 |

**Coverage:** 13 total, 12 mapeados, 1 não mapeado (AFCRED-11, P3 adiado por decisão de escopo).

## Ferramentas por task (confirmar)

- T0: WebSearch / deep-research / Context7
- T3–T7, T9–T12: subagent `general-purpose` por task, com `coding-principles` + TESTING.md
- T13: `agent-browser` + `ui-ux-pro-max`
- Banco: **somente local** para migration e smoke; produção `waioprime` fica intocada até deploy via `prisma:deploy` na Render.
