# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

---

## [0.3.0] — 2026-03-09 — OpenAPI 3.0 / Swagger UI

### Added

#### Dependências

- **`@fastify/swagger@8.15.0`** — geração automática de spec OpenAPI 3.0.3 a partir dos schemas das rotas; versão 8.x compatível com Fastify v4
- **`@fastify/swagger-ui@4.2.0`** — interface Swagger UI servida em `GET /docs`

#### Spec OpenAPI

- Título, versão (0.3.0), descrição e contato cadastrados em `openapi.info`
- Dois servidores declarados: `http://localhost:<PORT>` (local) e `https://washoot-api.onrender.com` (produção)
- Security scheme **`bearerAuth`** (HTTP Bearer JWT) configurado globalmente; bearer obtido via `POST /api/auth/login`
- Tags declaradas: `Health`, `Auth`, `Tenants`, `Me`, `Sessions`

#### Schemas compartilhados — `app.addSchema()`

Todos registrados via `addSchema()` para reuso por `$ref` em todas as rotas:

- **`LoginResponse`** — objeto com `success`, `data.accessToken`, `data.refreshToken`, `data.user`, `data.tenants`
- **`TenantItem`** — objeto com `id`, `name`, `slug`, `role` (enum OWNER/ADMIN/MEMBER/SUPER_ADMIN), `status`
- **`SessionStatus`** — enum dos 8 estados possíveis de sessão
- **`SessionItem`** — objeto completo de sessão com todos os campos
- **`ErrorResponse`** — objeto `{ success: false, error: { code, message } }`

#### Anotações por rota

Todas as rotas receberam `schema: { tags, summary, description?, security?, headers?, body?, params?, response }`:

- **`GET /health`** — tag Health; response 200 com `status`, `timestamp`, `environment`
- **`POST /api/auth/login`** — body existente reaproveitado; response 200 `LoginResponse`, 401 `ErrorResponse`
- **`POST /api/auth/refresh`** — response 200 `{ accessToken }`, 401 `ErrorResponse`
- **`POST /api/auth/logout`** — `security: [bearerAuth]`; response 204, 401 `ErrorResponse`
- **`GET /api/tenants`** — `security: [bearerAuth]`; response 200 array de `TenantItem`
- **`POST /api/tenants/switch`** — `security: [bearerAuth]`; response 200 `{ accessToken, tenantId, tenantName }`
- **`GET /api/me`** — `security: [bearerAuth]`; response 200 com perfil completo e tenants
- **10 rotas de sessions** — todas com `security: [bearerAuth]`, header `x-tenant-id` obrigatório, params `sessionIdParamSchema` quando aplicável, responses tipados por rota:
  - `POST /api/sessions` → 201 `SessionItem`
  - `GET /api/sessions` → 200 `{ sessions: SessionItem[], total }`
  - `GET /api/sessions/:id` → 200 `SessionItem`
  - `GET /api/sessions/:id/status` → 200 `{ sessionId, status, phone, lastConnectedAt, lastDisconnectedAt }`
  - `POST /api/sessions/:id/connect` → 200 `{ sessionId, status, qrCode?, pairingCode? }`
  - `POST /api/sessions/:id/disconnect` → 200 `{ sessionId, status }`
  - `POST /api/sessions/:id/reconnect` → 200 `{ sessionId, status, qrCode?, pairingCode? }`
  - `POST /api/sessions/:id/logout` → 200 `{ sessionId, status }`
  - `GET /api/sessions/:id/qr` → 200 `{ sessionId, qrCode }`
  - `GET /api/sessions/:id/pairing-code` → 200 `{ sessionId, pairingCode }`

#### Swagger UI

- Servido em `GET /docs` (sem autenticação)
- `docExpansion: 'list'`, `deepLinking: true`, `persistAuthorization: true`

#### CORS

- `allowedHeaders` atualizado para incluir `x-tenant-id`

### Tested

- `tsc --noEmit` — zero erros de tipagem
- Servidor sobe sem erros (`pnpm run dev`)
- `GET /docs` retorna `200 OK` com a interface Swagger UI
- spec JSON disponível em `GET /docs/json`

---

## [0.2.0] — 2026-03-09 — Integração real do Baileys ao módulo de sessions

### Added

#### Baileys — infra da engine de mensageria

- **`@whiskeysockets/baileys@7.0.0-rc.9`** instalado via npm (inclui `lib/` pré-compilado; build scripts de `postinstall` ignorados pelo pnpm por segurança — comportamento esperado)
- **`BaileysAuthStatePersistence.ts`** — implementação de `AuthenticationState` com persistência em banco (tabela `SessionAuthState`); substitui `useMultiFileAuthState`:
  - armazena credenciais e chaves Signal em um único blob JSON por sessão (`statePayload`)
  - serialização via `BufferJSON.replacer/reviver` para roundtrip correto de `Buffer`/`Uint8Array`
  - chaves de tipo `app-state-sync-key` deserializadas via `proto.Message.AppStateSyncKeyData.fromObject()`
- **`BaileysSessionRegistry.ts`** — registro em memória de conexões `WASocket` ativas; singleton compartilhado pelo processo:
  - `ActiveSessionEntry { socket, tenantId, latestQr?, latestPairingCode? }`
  - métodos: `set / get / has / delete / setQr / clearQr / setPairingCode / getQr / getPairingCode / getAll()`
- **`BaileysErrorTranslator.ts`** — tradução de erros e motivos de desconexão Baileys para `AppError` internos:
  - `translateDisconnect(sessionId, lastError)` retorna `{ shouldReconnect, error }` para cada `DisconnectReason`
  - `translateEngineError(err)` para erros genéricos de socket
  - duck-typing sobre `Boom` (sem dependência direta de `@hapi/boom`)

#### BaileysMessagingEngineAdapter — implementação completa

- Substituído stub anterior pela implementação real de `IMessagingEngine`:
  - **`connectSession`** — abre socket Baileys com versão WA buscada via `fetchLatestBaileysVersion()`, auth de banco via `BaileysAuthStatePersistence`, browser fingerprint `Browsers.ubuntu('Chrome')`
  - **`disconnectSession`** — fecha socket, remove do registry, atualiza status `DISCONNECTED`
  - **`reconnectSession`** — delega para `connectSession` (reabre socket com credenciais persistidas)
  - **`logoutSession`** — executa `socket.logout()` + fecha socket + atualiza status `LOGGED_OUT`; credenciais limpos pelo use case
  - **`getSessionStatus`** — inspeciona `ws.readyState` do socket ativo
  - **`getSessionQr`** — lê QR code em memória do registry
  - **`getSessionPairingCode`** — lê pairing code em memória do registry
  - **Reconexão automática com backoff exponencial**: base 3s, máximo 5 tentativas; falha permanente → status `FAILED`
  - Emite todos os eventos internos: `SESSION_CONNECTING`, `SESSION_CONNECTED`, `SESSION_DISCONNECTED`, `SESSION_QR_UPDATED`, `SESSION_LOGGED_OUT`

#### Schema e domínio

- **`SessionStatus`** — adicionados dois novos estados:
  - `AWAITING_QR` — socket aberto aguardando scan do QR
  - `AWAITING_PAIRING` — aguardando código de pareamento
- **Migration** `20260309185659_add_session_awaiting_states` aplicada e versionada
- **`Session.canDisconnect()`** atualizado: inclui `AWAITING_QR` e `AWAITING_PAIRING` como estados desconectáveis

#### IMessagingEngine — novos tipos e métodos

- Interfaces de input explícitas: `ConnectSessionInput`, `DisconnectSessionInput`, `ReconnectSessionInput`, `LogoutSessionInput` (todas com `tenantId`)
- Novos métodos no contrato: `getSessionQr(sessionId)` e `getSessionPairingCode(sessionId)`
- `MessagingEngineFactory.create()` agora recebe `sessionRepo` e `authStateRepo` como parâmetros

#### ISessionRepository — método de bootstrap

- **`findActiveSessionsForBootstrap()`** — retorna todas as sessões (cross-tenant) com status em `CONNECTING | AWAITING_QR | AWAITING_PAIRING | CONNECTED`; usado somente no startup para reconectar sessões ativas

#### Use Cases — integração com engine real

- **`ConnectSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.connectSession()` após atualizar status para `CONNECTING`
- **`DisconnectSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.disconnectSession()` antes de atualizar status
- **`ReconnectSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.reconnectSession()`
- **`LogoutSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.logoutSession()` + limpa `SessionAuthState`

#### Novos Use Cases

- **`GetSessionQrUseCase`** — valida tenant ownership, delega para `engine.getSessionQr()`
- **`GetSessionPairingCodeUseCase`** — valida tenant ownership, delega para `engine.getSessionPairingCode()`

#### SessionBootstrapService

- **`SessionBootstrapService`** — serviço de startup: consulta sessões ativas no banco e chama `engine.reconnectSession()` para cada uma em paralelo (`Promise.allSettled`); falhas individuais são logadas e a sessão é marcada `DISCONNECTED`, sem bloquear o boot

#### Presentation

- **`SessionPresenter`** — adicionados `toQrResult()` e `toPairingCodeResult()`
- **`session.routes.ts`** — engine singleton instanciado via `MessagingEngineFactory`; 2 novas rotas:
  - `GET /api/sessions/:id/qr` — retorna QR code atual (ou `null`)
  - `GET /api/sessions/:id/pairing-code` — retorna pairing code atual (ou `null`)
- **`server.ts`** — chama `SessionBootstrapService.bootstrap()` após o servidor iniciar; falha do bootstrap não derruba o processo

### Changed

- `api/prisma/schema.prisma` — enum `SessionStatus` com 2 novos valores
- `api/package.json` — dependência `@whiskeysockets/baileys@7.0.0-rc.9` adicionada; `package-lock.json` substituído por `pnpm-lock.yaml`

### Tested

- `tsc --noEmit` — zero erros de tipagem
- Smoke test manual end-to-end:
  - `POST /api/auth/login` → token OK
  - `POST /api/sessions` → sessão criada com status `PENDING`
  - `POST /api/sessions/:id/connect` → status muda para `CONNECTING`
  - `GET /api/sessions/:id/status` (após ~8s) → status `AWAITING_QR`
  - `GET /api/sessions/:id/qr` → QR code string retornado corretamente

---

## [0.1.0] — 2026-03-09 — Módulo de sessions com ciclo de vida completo (commit 2ef19eb)

### Added

#### Módulo de Sessions — ciclo de vida completo

- **Schema Prisma** — adicionados campos ao model `Session`:
  - `engine String @default("baileys")` — engine de mensageria da sessão
  - `externalRef String?` — referência externa fornecida pela engine
  - `lastConnectedAt DateTime?` — última conexão confirmada
  - `lastDisconnectedAt DateTime?` — última desconexão/logout
  - `deletedAt DateTime?` — soft delete
- **Schema Prisma** — model `SessionAuthState` revisado:
  - campo `data Json` renomeado para `statePayload Json`
  - adicionados `tenantId String`, `provider String @default("baileys")`, `version Int @default(0)`
  - adicionada relação com `Tenant` e índice em `tenantId`
- **Migration** `20260309175545_add_session_lifecycle_fields` aplicada e versionada

#### Domain

- **`Session.ts`** — entidade atualizada com 6 novos campos e métodos de máquina de estados:
  - `canConnect()` — PENDING | DISCONNECTED | FAILED → CONNECTING
  - `canDisconnect()` — CONNECTED | CONNECTING → DISCONNECTED
  - `canReconnect()` — DISCONNECTED | FAILED | LOGGED_OUT → CONNECTING
  - `isDeleted()` — suporte a soft delete
- **`ISessionRepository.ts`** — contratos revisados com interfaces explícitas `SessionCreateData` e `SessionStatusUpdate`
- **`ISessionAuthStateRepository.ts`** — novo contrato de persistência do estado de autenticação da engine

#### Shared — Audit

- **`IAuditLogRepository.ts`** — contrato de auditoria com tipo `AuditAction` desacoplado do Prisma
- **`PrismaAuditLogRepository.ts`** — implementação via `prisma.auditLog.create()`

#### Application — DTOs e Use Cases

- **`SessionDto.ts`** — DTOs explícitos: `CreateSessionInputDto`, `SessionItemDto`, `SessionStatusDto`, `SessionActionDto` (com `qrCode?` e `pairingCode?` reservados para integração com engine)
- **`CreateSessionUseCase`** — cria sessão em estado `PENDING`, audita `SESSION_CREATED`
- **`ListSessionsUseCase`** — lista sessões ativas do tenant
- **`GetSessionByIdUseCase`** — busca sessão por id com isolamento de tenant
- **`GetSessionStatusUseCase`** — retorna status resumido da sessão
- **`ConnectSessionUseCase`** — valida `canConnect()`, muda para `CONNECTING`, audita `SESSION_CONNECTED`; placeholder para `IMessagingEngine.connectSession()`
- **`DisconnectSessionUseCase`** — valida `canDisconnect()`, muda para `DISCONNECTED`, registra `lastDisconnectedAt`, audita `SESSION_DISCONNECTED`; placeholder para engine
- **`ReconnectSessionUseCase`** — valida `canReconnect()`, muda para `CONNECTING`, audita `SESSION_CONNECTED` com `meta.action = reconnect_requested`; placeholder para engine
- **`LogoutSessionUseCase`** — muda para `LOGGED_OUT`, limpa `SessionAuthState` via repositório, audita `SESSION_LOGGED_OUT`; placeholder para engine

#### Infrastructure

- **`PrismaSessionMapper.ts`** — converte `PrismaSession` → `Session` (domínio)
- **`PrismaSessionRepository.ts`** — implementação com padrão `updateMany({ where: {id, tenantId} })` para isolamento de tenant em nível de banco (defense-in-depth); `findById` usa `deletedAt: null`
- **`PrismaSessionAuthStateRepository.ts`** — upsert com incremento de `version`; `deleteMany` no logout

#### Presentation

- **`SessionPresenter.ts`** — transforma outputs dos use cases em respostas HTTP (`toSessionItem`, `toSessionList`, `toSessionStatus`, `toConnectResult`, `toActionResult`)
- **`session.schema.ts`** — schemas de validação JSON Schema para Fastify (`createSessionBodySchema`, `sessionIdParamSchema`)
- **`session.routes.ts`** — 8 rotas registradas, todas com `preHandler: [authHook, tenantHook]`:
  - `POST /api/sessions` — cria sessão
  - `GET /api/sessions` — lista sessões do tenant
  - `GET /api/sessions/:id` — detalhe da sessão
  - `GET /api/sessions/:id/status` — status resumido
  - `POST /api/sessions/:id/connect` — solicita conexão
  - `POST /api/sessions/:id/disconnect` — solicita desconexão
  - `POST /api/sessions/:id/reconnect` — solicita reconexão
  - `POST /api/sessions/:id/logout` — logout e limpeza de credenciais
- **`routes.ts`** — registradas as rotas de sessions em `${API_PREFIX}/sessions`

### Changed

- `api/src/app/routes.ts` — importa e registra `sessionRoutes`
- `api/prisma/schema.prisma` — modelos `Session`, `SessionAuthState` e `Tenant` atualizados

### Fixed

- Padrão `updateMany` no repositório de sessões contorna limitação do Prisma (`update` só aceita campos únicos no `where`), garantindo isolamento de tenant em todas as mutações

---

## [0.1.0] — 2026-03-09 — Commit inicial

### Added

- Estrutura inicial do monorepo (`api/`, `app/`, `panel/`, `scripts/`)
- Base da API com **Fastify + TypeScript + Prisma + PostgreSQL**
- Configuração centralizada com `dotenv`
- Logger estruturado (`pino`)
- Tratamento global de erros e healthcheck (`GET /health`)
- Módulo de **autenticação** (login, access token, refresh token)
- Módulo de **tenants** (criação, listagem, gerenciamento)
- Módulo de **usuários** (me, update)
- Multi-tenancy com `tenantHook` e `authHook`
- Schema Prisma inicial com entidades: `Tenant`, `User`, `UserTenant`, `Session`, `SessionAuthState`, `Message`, `Contact`, `AuditLog`
- Migrations versionadas
- Seed de dados iniciais
