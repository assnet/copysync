# Credenciais de afiliado — Design

**Spec**: `spec.md` · **Status**: Implementado 2026-10-22

---

## Architecture Overview

```mermaid
flowchart LR
  UI[AffiliateCredentialsPage\nfeatures/settings] -->|axios| SVC[affiliateCredential.service.ts]
  SVC --> R[affiliateCredential.routes.ts\npresentation]
  R --> UC[Upsert / List / Delete / SetStatus\nUseCase]
  UC --> REPO[IAffiliateCredentialRepository]
  UC --> ENC[ISecretCipher]
  REPO --> PR[PrismaAffiliateCredentialRepository] --> DB[(affiliate_credentials)]
  ENC --> AES[AesGcmSecretCipher\nshared/security]
  UC --> AUD[IAuditLogRepository]
```

Camadas conforme AGENTS.md §8. Cifra fica em `shared/security/` porque `SessionAuthState`
(`schema.prisma:230`, "encrypt at-rest") vai reutilizar depois.

## Code Reuse

| Existente | Uso aqui |
| --- | --- |
| `shared/http/hooks/authHook.ts`, `tenantHook.ts` | `preHandler` das rotas; `request.tenantContext.tenantId` |
| `shared/errors/AppError.ts` + `errors/internal/*Errors.ts` | `AffiliateCredentialErrors.ts` |
| `shared/audit/IAuditLogRepository.ts` | auditoria de upsert/delete |
| `shared/config/env.ts` (zod) | `CREDENTIALS_ENCRYPTION_KEY` |
| — (novo) `shared/security/` | pasta criada nesta feature para `ISecretCipher` |
| `modules/tenants/presentation/presenters/TenantPresenter.ts` | padrão do presenter estático |
| `modules/sessions/presentation/schemas/session.schema.ts` | padrão de JSON Schema `as const` |
| `app/src/features/settings/components/SettingsLayout.tsx` `SETTINGS_NAV` | novo item de submenu |
| `app/src/routes/AppRoutes.tsx:25-29` | rota filha de `/settings` |
| `app/src/components` `SectionCard`, `PageHeader`, `ConfirmDialog` | cards e remoção |
| `ChangePasswordForm.tsx:92-132` | campo com olho (mostrar/ocultar) |
| `services/apiClient.ts`, `services/account.service.ts` | padrão de service |
| `features/chat/strings.ts` | padrão de `strings.ts` |
| `app/src/test/renderWithTheme.tsx` | teste em modo escuro |

## Components

### API — `api/src/modules/integrations/`

```
integrations/
  domain/
    entities/AffiliateCredential.ts        # {id, tenantId, provider, publicIdentifier|null, hasSecret, hasSession, sessionSyncedAt?, status, lastValidatedAt?, createdAt, updatedAt}
    enums/AffiliateProvider.ts             # 'SHOPEE' | 'MERCADO_LIVRE' | 'AMAZON'
    enums/AffiliateCredentialStatus.ts     # 'ACTIVE' | 'INACTIVE'
    contracts/IAffiliateCredentialRepository.ts
    contracts/AffiliateCredentialRecords.ts      # EncryptedBlob, Record, Upsert*Record
    services/maskIdentifier.ts             # pura: '5577981353128' → '••••3128'
    services/affiliateProviderFields.ts    # pura: quais campos cada provider exige; valida formato
  application/
    dtos/AffiliateCredentialDTO.ts
    use-cases/ListAffiliateCredentialsUseCase.ts
    use-cases/UpsertAffiliateCredentialUseCase.ts
    use-cases/DeleteAffiliateCredentialUseCase.ts
    use-cases/SetAffiliateCredentialStatusUseCase.ts   # P2
    use-cases/ResolveAffiliateCredentialUseCase.ts     # leitura decifrada p/ offer-generator (sem rota HTTP)
    use-cases/UpsertAffiliateSessionUseCase.ts         # T7b: sessão vinda da extensão
  infrastructure/
    repositories/PrismaAffiliateCredentialRepository.ts
    mappers/PrismaAffiliateCredentialMapper.ts
  presentation/
    routes/affiliateCredential.routes.ts
    schemas/affiliateCredential.schema.ts
    presenters/AffiliateCredentialPresenter.ts
```

`shared/security/ISecretCipher.ts` + `AesGcmSecretCipher.ts`: `encrypt(plain, aad) → {ciphertext, iv, tag, keyVersion}`, `decrypt(blob, aad)` escolhe a chave pelo `keyVersion` do blob. AAD = `tenantId:provider:campo` (`secret` | `session`) em encrypt/decrypt
(blob copiado para outra linha ou coluna não decifra). `SecretCipherFactory` (`shared/security/SecretCipherFactory.ts`) valida a chave ao primeiro uso: ausente →
`SecretCipherUnavailableError` (503) só nas rotas que cifram/decifram (PUT credencial, PUT sessão; GET lista não usa cipher e responde 200); o resto da API sobe normal (AGENTS §22,
startup resiliente). Node `crypto`, sem lib.
Nesta feature só existe a versão 1 (`CREDENTIALS_ENCRYPTION_KEY`); rotação (mapa de chaves por
versão + script de recifra) fica para chore própria.

**Contrato do repositório**

```ts
// Tipos em domain/contracts/AffiliateCredentialRecords.ts:
// EncryptedBlob = { ciphertext: Buffer; iv: Buffer; tag: Buffer; keyVersion: number }
// AffiliateCredentialRecord = AffiliateCredential & { secret: EncryptedBlob | null; session: EncryptedBlob | null }
// UpsertAffiliateCredentialRecord = { tenantId; provider; publicIdentifier: string; secret?: EncryptedBlob }  // secret ausente = mantém
// UpsertAffiliateSessionRecord = { tenantId; provider; session: EncryptedBlob; publicIdentifierIfEmpty?: string; syncedAt: Date }
interface IAffiliateCredentialRepository {
  listByTenant(tenantId: string): Promise<AffiliateCredential[]>;
  findByTenantAndProvider(tenantId: string, provider: AffiliateProvider): Promise<AffiliateCredentialRecord | null>; // inclui campos cifrados
  findActiveByTenantAndProvider(tenantId: string, provider: AffiliateProvider): Promise<AffiliateCredentialRecord | null>; // ignora INACTIVE e linhas sem publicIdentifier (só-sessão); usado por Resolve
  upsert(input: UpsertAffiliateCredentialRecord): Promise<AffiliateCredential>; // painel: grava só público/secreto, preserva colunas de sessão
  upsertSession(input: UpsertAffiliateSessionRecord): Promise<AffiliateCredential>; // extensão: (1) upsert só das colunas de sessão (create com publicIdentifier = tag ou null; P2002 → repete 1x);
  //           (2) tag via updateMany where {tenantId, provider, publicIdentifier: null} — atômico, painel sempre vence
  delete(tenantId: string, provider: AffiliateProvider): Promise<boolean>; // deleteMany; false = não existia
  setStatus(tenantId: string, provider: AffiliateProvider, status: AffiliateCredentialStatus): Promise<AffiliateCredential | null>; // updateMany + findFirst; null = não existia
}
// Repo nunca deixa erro Prisma cru subir: P2002 no upsert concorrente → repete 1x; demais → AppError.
// Use case converte false/null em AffiliateCredentialNotFoundError (404).
```

**Rotas** (prefixo `${API_PREFIX}/integrations/affiliate-credentials`, `preHandler: [authHook, tenantHook]`)

| Método | Path | Use case | Resposta |
| --- | --- | --- | --- |
| GET | `/` | List | `{ items: AffiliateCredentialItem[] }` mascarado |
| PUT | `/:provider` | Upsert | `AffiliateCredentialItem` |
| DELETE | `/:provider` | Delete | 204 |
| PATCH | `/:provider/status` | SetStatus (P2) | `AffiliateCredentialItem` |
| PUT | `/:provider/session` | UpsertAffiliateSession (só `MERCADO_LIVRE`, extensão) | `{ provider, status, updatedAt }` |

`AffiliateCredentialItem = { provider, status, publicIdentifier | null, publicIdentifierMasked | null, hasSecret, hasSession, sessionSyncedAt | null, lastValidatedAt, updatedAt }`.
Toda resposta sai dentro do envelope padrão `{ success, data }` (`shared/http/httpResponse.ts`), que a
extensão já espera (`extension/src/contract/api.ts`).
`publicIdentifier` volta em claro (ver Tech Decisions: não é segredo) só para o diálogo de edição
pré-preencher; o card exibe `publicIdentifierMasked`. `publicIdentifier: null` = ID ainda não informado (linha criada pela extensão sem tag); o card
mostra "ID pendente" e o botão Configurar.
Body do PUT: `{ publicIdentifier: string, secret?: string }`. `secret` ausente ou vazio em
registro existente = manter; ausente em registro novo de provider que exige secret = 422.

### App — `app/src/features/settings/`

```
features/settings/
  strings.ts                                   # novo: textos de settings (conta + credenciais)
  affiliateProviders.ts                        # catálogo: key, nome do marketplace, descrição, campos, ícone
  components/AffiliateCredentialCard.tsx       # SectionCard + chip de estado + campos mascarados + ações
  components/AffiliateCredentialDialog.tsx     # form com validação local; secret com olho
  hooks/useAffiliateCredentials.ts             # load/upsert/remove com estado local (sem store global)
pages/settings/AffiliateCredentialsPage.tsx
services/affiliateCredential.service.ts
types/api.types.ts                            # + AffiliateCredentialItem, AffiliateProvider
```

Layout: `Grid` 3 colunas em `md`, 1 em `xs`. Nomes de marketplace (Shopee, Mercado Livre,
Amazon) são de terceiros e podem aparecer; marca do produto só via `APP_NAME` se precisar
(texto do aviso usa "a ferramenta").

## Data Model

```prisma
enum AffiliateProvider {
  SHOPEE
  MERCADO_LIVRE
  AMAZON
}

enum AffiliateCredentialStatus {
  ACTIVE
  INACTIVE
}

model AffiliateCredential {
  id               String @id @default(cuid())
  tenantId         String
  provider         AffiliateProvider
  publicIdentifier String? // null quando a linha nasce da extensão sem tag
  secretCiphertext Bytes?
  secretIv         Bytes?
  secretTag        Bytes?
  keyVersion       Int    @default(1) // versão da chave do secret
  status           AffiliateCredentialStatus @default(ACTIVE)
  sessionCiphertext Bytes?  // T7b: {sessionToken, csrfToken} serializado e cifrado
  sessionIv         Bytes?
  sessionTag        Bytes?
  sessionKeyVersion Int?      // versão da chave da sessão (blob independente)
  sessionSyncedAt   DateTime?
  lastValidatedAt  DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, provider])
  @@map("affiliate_credentials")
}
// model Tenant += affiliateCredentials AffiliateCredential[]  (relação inversa exigida pelo Prisma)
// AuditAction += AFFILIATE_CREDENTIAL_UPSERTED, AFFILIATE_CREDENTIAL_DELETED, AFFILIATE_SESSION_SYNCED
```

Migration única: `add_affiliate_credentials` (tabela + enums + 3 valores em `AuditAction`, incluindo os
campos de sessão do T7b).

## Error Handling

| Erro | Código | HTTP |
| --- | --- | --- |
| provider fora do enum | `HTTP_ERROR` (schema Fastify, via `errorHandler.ts`) | 400 |
| campo público inválido / secret obrigatório ausente / `secret` enviado a provider sem campo secreto (ML, Amazon) | `AFFILIATE_CREDENTIAL_INVALID` | 422 |
| delete/patch de provider não cadastrado | `AFFILIATE_CREDENTIAL_NOT_FOUND` | 404 |
| `PUT /:provider/session` com provider ≠ `MERCADO_LIVRE` | `AFFILIATE_CREDENTIAL_INVALID` | 422 |
| `CREDENTIALS_ENCRYPTION_KEY` ausente | `SECRET_CIPHER_UNAVAILABLE` (`SecretCipherUnavailableError` em `shared/errors/internal/SecretCipherErrors.ts`) | 503 |
| falha de cifra/decifra (chave errada) | `SECRET_CIPHER_FAILED` (`SecretCipherFailedError` em `shared/errors/internal/SecretCipherErrors.ts`) | 500, log |

## Tech Decisions

- **AES-256-GCM com chave em env, não KMS.** Render não oferece KMS nativo; chave de 32 bytes
  base64 em `CREDENTIALS_ENCRYPTION_KEY`; opcional no `env.ts` (string vazia ou só espaços = ausente,
  via `preprocess`). `env.ts` não valida tamanho: a `SecretCipherFactory` checa
  `Buffer.from(v,'base64').length === 32`; malformada = ausente (503 nas rotas que cifram +
  `logger.error` no boot, chamado em `api/src/app/server.ts` via `SecretCipherFactory.check()`, sem
  imprimir o valor; `env.ts` não loga para evitar ciclo com `shared/logger/logger.ts`). Typo no dashboard nunca derruba o resto da API (AGENTS §22). `keyVersion` permite rotação futura.
  O `render.yaml` só declara o painel; a variável da API é criada à mão no dashboard da Render
  **antes** do deploy (sem ela as rotas de afiliado respondem 503). Passo explícito em T16.
- **`publicIdentifier` opcional.** A extensão pode sincronizar a sessão do Mercado Livre antes de
  o operador cadastrar o ID; bloquear com 409 quebraria o fluxo da extensão. Use case de upsert
  pelo painel continua exigindo o campo.
- **Campo público em claro, só o secreto cifrado.** Tag de associado e ID de afiliado aparecem
  na URL gerada; cifrar não protege nada e impede índice/busca. Mascaramento é só de exibição.
- **Catálogo de provedores no painel e validação de campos no domínio.** Ambos lêem a mesma
  tabela conceitual; o domínio é a fonte de verdade da regra, o painel só espelha para UX.
- **Sem store global.** Estado da página vive no hook; nenhum outro lugar consome ainda.
- **`ResolveAffiliateCredentialUseCase` sem rota.** Único ponto que decifra para uso externo (o `UpsertAffiliateSessionUseCase` decifra só para comparar
o token atual, sem devolver); o Gerador de ofertas
  injeta esse use case. Nenhuma rota devolve secret.
- **Verificar campos reais dos programas (T0)** antes de fechar enum de campos: Shopee Affiliate
  Open API usa `appId` + `secret` (assinatura HMAC); Mercado Livre e Amazon usam identificador
  na URL. Incerto: nome exato dos campos na doc oficial — não assumir sem checar (Context7/web).
