# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

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
