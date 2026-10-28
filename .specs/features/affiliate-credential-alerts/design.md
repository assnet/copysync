# Aviso de credencial de afiliado — Design

Spec: `spec.md`. Status: **design** (2026-10-28).

## Alternativas avaliadas

### Onde marcar "recusada"

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| Reusar `AffiliateCredential.sessionInvalidAt` (existe, nunca gravado com data; `clearSession` zera) | ❌ | Nome diz "sessão": Shopee é AppID/secret, não sessão. Extensão pode passar a usar o campo para outra coisa |
| Status novo `REJECTED` no enum `AffiliateCredentialStatus` | ❌ | `findActiveByTenantAndProvider` filtra `ACTIVE`; REJECTED viraria "ausente" e o gerador perderia a verificação de link (`GenerateOfferUseCase.ts:116`). Status é escolha do usuário (ACTIVE/INACTIVE); recusa é fato observado |
| **Colunas `rejectedAt DateTime?` + `rejectedCode String?` na credencial** | ✅ | Ortogonal ao status; uma migration aditiva; presenter expõe; zerar no upsert é uma linha |
| Tabela nova de "eventos de credencial" | ❌ | Só precisamos do último estado |

### Como pausar a loja

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| Flag em `GroupMonitorConfig` por loja | ❌ | Credencial é do tenant, não da sessão; pausar por config duplicaria |
| **`ResolveAffiliateCredentialUseCase.resolveState` devolve `rejected` quando `rejectedAt`; `BuildTenantAffiliateLinkUseCase` devolve `credential_rejected` sem chamar a loja** | ✅ | Um ponto só; vale para monitoramento. Gerador segue usando `execute`, intocado |

Decisão de contrato: `ResolveAffiliateCredentialUseCase.execute` (`:20-30`, via `findActiveByTenantAndProvider`) **não muda**:
`GenerateOfferUseCase.ts:117-125` depende dela para `checkOwnership`/`generateMlAffiliateLink`, e credencial rejeitada no
gerador continua falhando como hoje. Novo `resolveState(tenantId, provider): { state: 'ok', cred } | { state: 'missing' } | { state: 'rejected', since, code }`
lê por `findByTenantAndProvider` (`IAffiliateCredentialRepository.ts:14-17`): INACTIVE ou só-sessão (sem `publicIdentifier`)
com `rejectedAt` continuam `rejected`; sem `rejectedAt`, caem em `missing` como hoje. O contrato que o `BuildTenant…` recebe hoje é
`IAffiliateCredentialResolver` (`campaigns/domain/contracts/IAffiliateCredentialResolver.ts:12-14`, só `execute`); ele **não muda**
(fake de `GenerateOfferUseCase.test.ts:45`). `BuildTenant…` passa a receber `IAffiliateCredentialGateway` (novo, estende o resolver
com `resolveState` e `markRejected`). Quem monta: `offersContainer.ts:52-54` (compartilhado com `GenerateOffer`, `:65`) e `:90-96`.

### Onde nasce `credentialAlerts`

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| Rota nova `GET /…/credential-alerts` | ❌ | Mais uma chamada no load da página |
| Montar em `load` de `GroupMonitorConfigUseCases` | ❌ | `load` roda em todo `Save*` (`:76,122,133`): duas consultas a mais por salvar |
| **Campo em `GroupMonitorConfigDTO`, montado só em `GetGroupMonitorConfigUseCase.execute` (`:60-63`)** | ✅ | Hook `useMonitoringConfig` já carrega; invalidação igual |

Fronteira de módulo (AGENTS §8): automação não importa repositório de `integrations`. Porta no domínio de automação
`ICredentialStateSource.listStates(tenantId): { provider, usable, rejectedAt, rejectedCode }[]` em `IMonitorPorts.ts`;
adapter em `CampaignsMonitorAdapters.ts` sobre `offersContainer.credentialRepo().listByTenant` (padrão já usado: automação
só fala com o container de campaigns, `:10`). `usable` = `status === 'ACTIVE' && publicIdentifier && (!providerRequiresSecret || hasSecret) && (!providerUsesSession || hasSession)`
(entidade já tem `hasSecret`/`hasSession`, `AffiliateCredential.ts:15-16`). `listByTenant` (`PrismaAffiliateCredentialRepository.ts:46-52`)
devolve só linhas existentes: o use case itera `AFFILIATE_PROVIDERS` (`integrations/domain/enums/AffiliateProvider.ts:2`) e
trata ausência como não utilizável. Janela MISSING: `since = now − 7 dias` com `now` injetável em `GroupMonitorConfigDeps`. **Um alerta por loja**: `rejectedAt`
presente ⇒ `REJECTED` (prevalece sobre MISSING mesmo com capturas `CREDENTIAL_MISSING` recentes); senão, não utilizável + captura
recente ⇒ `MISSING`. `GroupMonitorConfigDeps` (`:15-19`, hoje
`{ monitors, directory, entitlements }`) ganha `credentialStates` e `captured`; `configDeps()` em `automationContainer.ts:22`
injeta; `GroupMonitorConfigUseCases.test.ts:11` e `monitorTestFakes.ts` ganham fake.

`credentialAlerts` é **opcional** no DTO: `Save*` devolvem `load()` sem o campo e o hook (`useMonitoringConfig.ts:37,52,60`)
faz `setConfig(data)` (`:37`); o hook passa a preservar `credentialAlerts` anterior quando `data` não traz (`setConfig(prev => ({ ...data, credentialAlerts: data.credentialAlerts ?? prev?.credentialAlerts ?? [] }))`).

MISSING só com captura recente: `ICapturedOfferRepository.listRecentMissingProviders(tenantId, since): AffiliateProvider[]`
(`SELECT DISTINCT marketplace WHERE tenantId AND status='SKIPPED' AND reason='CREDENTIAL_MISSING' AND marketplace IS NOT NULL AND capturedAt >= since`;
`marketplace` é `AffiliateProvider?`, `schema.prisma:1129`).
`marketplace` já é coluna de `CapturedOffer` (gravada no SKIPPED: `ProcessPending…:106` passa `{ marketplace }`). Índice novo
`[tenantId, status, capturedAt]` (hoje só `[status, capturedAt]` e `[tenantId, sessionId, capturedAt]`, `schema.prisma:1150-1151`).

## Fluxo

```
captura PENDING
  → BuildTenantAffiliateLinkUseCase.execute
      → credentials.resolveState(tenant, provider)
          rejected → return { kind: 'credential_rejected', provider, since }     (CRED-03, sem rede)
          missing  → return { kind: 'credential_missing', provider }
          ok       → chama loja
                      catch AFFILIATE_CREDENTIAL_REJECTED → credentials.markRejected(tenant, provider, code)
                                                            return { kind: 'credential_rejected', … }  (CRED-01)
                      catch RATE_LIMITED | UNAVAILABLE    → { kind: 'failed', code }                   (CRED-04)
  → ProcessPendingCapturedOffersUseCase.resolve (if-chain :105-107; branch novo ANTES de :107)
      credential_rejected → SKIPPED / CREDENTIAL_REJECTED, data { marketplace }                     (CRED-02)
      (sem o branch: cai em replacements.set(…, null) :107 → link some do texto; se for o único, UNSUPPORTED_MARKETPLACE)
```

`TenantLinkResult` (`automation/domain/contracts/IMonitorPorts.ts:4-8`) ganha a mesma variante; `FakeLinkBuilder`
(`monitorTestFakes.ts:99-105`) idem.

Limpar rejeição (CRED-05):
- `UpsertAffiliateCredentialUseCase` → `UpsertAffiliateCredentialRecord` (`AffiliateCredentialRecords.ts:14-19`) ganha
  `clearRejection?: boolean` (opcional, ausente = `false`; T2 cria o campo, T3 preenche) = `!providerUsesSession(provider) && (secret !== null || existing?.publicIdentifier !== publicIdentifier)`,
  com `secret` a variável local validada (`:32-39`; `input.secret` é `string | undefined`, nunca `null`) e `existing` lido
  por `findByTenantAndProvider` (hoje só lido no ramo `:42-47`; passa a ser lido sempre). ML pelo painel só troca a
  etiqueta e a rejeição é da sessão: nunca limpa.
- `UpsertAffiliateSessionUseCase` → `UpsertAffiliateSessionRecord` (`domain/contracts/AffiliateCredentialRecords.ts:25-31`)
  ganha campo `clearRejection?: boolean`; o use case passa `changed` (`:43`; chamada ao repo em `:46-52`). A extensão reenvia os mesmos cookies por alarme/startup/cookie-changed
  (`extension/src/background/syncSession.ts`, `lifecycle.ts:15`); sem a condição, cada sync liberaria uma nova chamada ao ML.
- `ClearAffiliateSessionUseCase` → repo `clearSession` (`:122-136`) zera a rejeição junto (sem sessão = "não conectado").
  O `where` atual filtra `sessionCiphertext: { not: null }` (`:124`); a rejeição hoje só nasce com sessão (ML), então
  cobre; manter o filtro.
- `setStatus` (reativar) **não** limpa: a chave recusada continua a mesma. `markRejected` é `updateMany` (no-op se a linha foi apagada no meio; `update` lançaria P2025, que
`BuildTenant….failure` relança e vira `INTERNAL_ERROR`).

## Componentes

### API

| Peça | Mudança |
| --- | --- |
| `prisma/schema.prisma` `AffiliateCredential` | `rejectedAt DateTime?`, `rejectedCode String?` (migration `add_affiliate_credential_rejection`) |
| `integrations/domain/entities/AffiliateCredential.ts` | campos novos |
| `IAffiliateCredentialRepository` | `markRejected(tenantId, provider, code, at)`; `upsert`/`upsertSession` zeram rejeição |
| `PrismaAffiliateCredentialRepository` + mapper | idem |
| `ResolveAffiliateCredentialUseCase` | `resolveState` (novo, por `findByTenantAndProvider`) + `execute` inalterado |
| `MarkAffiliateCredentialRejectedUseCase` (novo, `integrations/application/use-cases`) | grava via `markRejected` + `AuditLog AFFILIATE_CREDENTIAL_REJECTED` (sem segredo, só provider/code); ctor posicional `(repo, audit)` como `UpsertAffiliateSessionUseCase.ts:23-28`. Valor novo no enum Prisma `AuditAction` (`schema.prisma:50-74`) e na union `shared/audit/IAuditLogRepository.ts:5-28`; migration própria com `ALTER TYPE "AuditAction" ADD VALUE` (não pode rodar na mesma transação que o uso) |
| `campaigns/domain/contracts/IAffiliateCredentialGateway.ts` (novo) | `extends IAffiliateCredentialResolver` + `resolveState`, `markRejected`. `IAffiliateCredentialResolver` fica como está: fakes de `GenerateOfferUseCase.test.ts:45` não mudam |
| `campaigns/infrastructure/offersContainer.ts:52-96,102-122` | criar `const credentialRepo = lazy(() => new PrismaAffiliateCredentialRepository())` (hoje `credentials` em `:52-54` instancia o repo inline) e reusar em `credentials`; `credentialGateway = lazy(() => { const c = credentials(); const mark = new MarkAffiliateCredentialRejectedUseCase(credentialRepo(), new PrismaAuditLogRepository()); return { execute: (t, p) => c.execute(t, p), resolveState: (t, p) => c.resolveState(t, p), markRejected: (t, p, code) => mark.execute(t, p, code) }; })` (imports novos: `MarkAffiliateCredentialRejectedUseCase`, `shared/audit/PrismaAuditLogRepository`; padrão `extension.routes.ts:35`); `buildTenantAffiliateLink` (`:90-96`) recebe o gateway; `generateOffer` (`:65`) segue com `credentials()`; `credentialRepo` entra no objeto exportado (`:102-122`) para o adapter de automação |
| `BuildTenantAffiliateLinkUseCase` + `.test.ts:16` | dep tipada `IAffiliateCredentialGateway`; `resolveState` dentro do `try` de `:59-63` (herda `CREDENTIAL_UNREADABLE`); `ok` devolve a cred decifrada (`resolveState` checa `rejectedAt` por `findByTenantAndProvider` e depois chama `execute`; `execute === null` ⇒ `missing`); o `catch` de `:97-99` deixa de delegar direto a `failure()` (síncrona): primeiro `if (err instanceof AppError && err.code === 'AFFILIATE_CREDENTIAL_REJECTED') { await markRejected(…); return credential_rejected }`, senão `failure()`; variante `credential_rejected` em `TenantAffiliateLink` (`:12-17`); fake do teste ganha `resolveState`/`markRejected` |
| `automation/domain/contracts/IMonitorPorts.ts` | `TenantLinkResult` + `credential_rejected`; porta `ICredentialStateSource` |
| `automation/domain/entities/CapturedOffer.ts` | `CREDENTIAL_REJECTED` em `CAPTURED_OFFER_REASONS` e `RETRYABLE_REASONS` |
| `ProcessPendingCapturedOffersUseCase` | mapeia `credential_rejected` |
| `ICapturedOfferRepository` + Prisma | `listRecentMissingProviders` |
| `GroupMonitorDTO.ts`, `GroupMonitorConfigUseCases.ts:15-19,59-64` | `credentialAlerts` só no `Get`; deps `credentialStates`, `captured` |
| `automation/infrastructure/automationContainer.ts:22`, `CampaignsMonitorAdapters.ts` | injeção + adapter da porta |
| `groupMonitoring.schema.ts` | schema de resposta |
| `AffiliateCredentialPresenter:8-21` + `affiliateCredential.schema.ts:5-19` | `rejectedAt`, `rejectedCode` |

Lista de lojas para MISSING: `AFFILIATE_PROVIDERS` menos `AMAZON`? Não: Amazon sem credencial também vira
`CREDENTIAL_MISSING` (`BuildTenantAffiliateLinkUseCase.ts:64`). Todas as 3 entram.

### App

| Peça | Mudança |
| --- | --- |
| `types/api.types.ts` | `CapturedOfferReason` + `CREDENTIAL_REJECTED`; `GroupMonitorConfigResponse.credentialAlerts`; `AffiliateCredentialItem.rejectedAt/rejectedCode` |
| `features/monitoring/utils/settingsDraft.ts` `RETRYABLE_REASONS` | + `CREDENTIAL_REJECTED` |
| `features/monitoring/strings.ts` | reason label; `credentialAlerts.{missing(loja), rejected(loja, data), action, hintMl, hintShopee}` |
| `features/monitoring/components/CredentialAlerts.tsx` (novo) | lista de `Alert` MUI, botão `navigate('/settings/affiliate-credentials?returnTo=/monitoring')`; sem dado sensível (só nome da loja) |
| `pages/monitoring/MonitoringPage.tsx` | renderiza `<CredentialAlerts alerts={config.credentialAlerts} />` entre o header e os cards (L~110) |
| `features/settings/strings.ts`, `AffiliateCredentialCard.tsx:30-34` (`stateChip`) | status "Recusada" + dica por loja |
| `pages/settings/AffiliateCredentialsPage.tsx` | hoje sem hook de router (`:1-12`): `useSearchParams` + `useNavigate`; guarda `safeReturnPath(returnTo)` em `useRef` **antes** de limpar a query (padrão `app/src/pages/SessionsPage.tsx:23-50`), botão "Voltar ao monitoramento" |

Privacidade: nome da loja e data não são dado sensível; sem flag nova (registrar em `docs`).
Persistência: nada novo (sem rascunho).

## Erros e códigos

- Captura: reason `CREDENTIAL_REJECTED` (string livre na coluna `reason`, sem migration).
- `rejectedCode`: `AFFILIATE_CREDENTIAL_REJECTED` (único hoje; campo existe para distinguir no futuro, ex.: conta ML sem programa de afiliado).

## Docs

`docs/monitoramento-grupos.md` §2.1 (loja pausada) e §3 L104 (lista de reasons retryable do "Tentar de novo"), `docs/integracoes-credenciais-afiliado.md`
(campos novos, quem grava, o que não fazer: nunca gravar motivo com corpo da resposta).
