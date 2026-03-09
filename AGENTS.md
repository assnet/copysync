# AGENTS.md

## Visão geral do projeto

Este projeto é um sistema full-stack organizado em monorepo, com foco em mensageria, CRM, automação, assistentes de IA e métricas operacionais em tempo real.

Sempre interaja utilizando a linguagem Português Brasil, pt-BR.

### Estrutura principal

- **API REST** em `api/`
  - **Fastify**
  - **TypeScript**
  - **Prisma ORM**
  - **PostgreSQL**
  - preparada para deploy na **Render**

- **Painel Admin** em `panel/`
  - **React**
  - **Vite**
  - **Material-UI**
  - **Axios**

- **Scripts utilitários** em `scripts/`
  - **Python**

---

# 1. Visão de produto

A plataforma deve ser construída para permitir que o usuário final consiga:

- criar **chatbots**
- montar **automações**
- configurar **assistentes de IA**
- conectar fluxos usando **blocos visuais**
- operar sem necessidade de programação
- monitorar **conversas e desempenho em tempo real**
- identificar gargalos operacionais
- escalar com base em métricas e dados, não por achismo

## Direção funcional

A arquitetura deve suportar progressivamente:

- múltiplas sessões por tenant
- campanhas e envios automatizados
- atendimento humano + IA
- fluxos conversacionais por blocos
- automações orientadas a eventos
- integrações externas
- métricas por tenant, sessão, fluxo, campanha e operador
- observabilidade operacional e analítica

---

# 2. Objetivo arquitetural

A arquitetura inicial deve ser um **monólito modular por aplicação**, dentro de um monorepo.

## Regras

- não criar microserviços agora
- separar responsabilidades entre `api/`, `panel/` e `scripts/`
- manter baixo acoplamento
- preparar extração futura de módulos se houver necessidade real
- preservar consistência entre backend e frontend

## Aplicações do monorepo

### `api/`
Responsável por:
- autenticação
- multi-tenancy
- sessões
- mensageria
- contatos
- campanhas
- automações
- flows
- assistentes
- métricas
- integrações

### `panel/`
Responsável por:
- interface administrativa
- gestão de tenants
- gestão de sessões
- visualização de mensagens
- construtor visual de fluxos
- dashboards e métricas
- configuração de automações e assistentes

### `scripts/`
Responsável por:
- utilitários de manutenção
- migração/importação
- saneamento de dados
- apoio operacional
- tarefas específicas offline

---

# 3. Stack obrigatória

## Backend
- **Fastify**
- **TypeScript**
- **Prisma ORM**
- **PostgreSQL**

## Frontend
- **React**
- **Vite**
- **Material-UI**
- **Axios**

## Scripts
- **Python**

---

# 4. Estrutura do repositório

```txt
/
  api/
  panel/
  scripts/
  AGENTS.md
  .github/
    copilot-instructions.md
````

---

# 5. Estrutura obrigatória da API

```txt
api/
  src/
    app/
      app.ts
      server.ts
      routes.ts

    modules/
      auth/
        domain/
        application/
        infrastructure/
        presentation/

      tenants/
        domain/
        application/
        infrastructure/
        presentation/

      users/
        domain/
        application/
        infrastructure/
        presentation/

      sessions/
        domain/
        application/
        infrastructure/
        presentation/

      messaging/
        domain/
        application/
        infrastructure/
          engines/
            baileys/
        presentation/

      contacts/
        domain/
        application/
        infrastructure/
        presentation/

      campaigns/
        domain/
        application/
        infrastructure/
        presentation/

      inbox/
        domain/
        application/
        infrastructure/
        presentation/

      integrations/
        domain/
        application/
        infrastructure/
        presentation/

      automation/
        domain/
        application/
        infrastructure/
        presentation/

      chatbots/
        domain/
        application/
        infrastructure/
        presentation/

      assistants/
        domain/
        application/
        infrastructure/
        presentation/

      flows/
        domain/
        application/
        infrastructure/
        presentation/

      metrics/
        domain/
        application/
        infrastructure/
        presentation/

    shared/
      config/
      core/
      database/
      errors/
      events/
      http/
      logger/
      types/
      utils/

  prisma/
    schema.prisma
    migrations/
    seed.ts
```

---

# 6. Estrutura recomendada do painel

```txt
panel/
  src/
    app/
    pages/
    features/
      auth/
      tenants/
      sessions/
      messaging/
      contacts/
      campaigns/
      automation/
      chatbots/
      assistants/
      flows/
      metrics/
    components/
    services/
    hooks/
    contexts/
    routes/
    theme/
    utils/
    types/
```

## Regras do painel

* organizar por feature
* evitar lógica de negócio pesada em componentes
* separar serviços HTTP
* usar Axios centralizado
* usar Material-UI com consistência visual
* preparar a UI para dashboards, builders e métricas
* evitar acoplamento do painel à estrutura interna do banco

---

# 7. Estrutura recomendada de scripts

```txt
scripts/
  maintenance/
  imports/
  exports/
  diagnostics/
  migrations/
  helpers/
```

## Regras dos scripts

* scripts Python não devem conter regra central do produto
* scripts são auxiliares, não substituem a API
* scripts não podem virar fonte primária de fluxo operacional
* todo script deve ter objetivo claro e delimitado

---

# 8. Responsabilidade de cada camada da API

## Domain

Pode conter:

* entidades
* value objects
* enums
* contratos
* regras puras

Não pode conter:

* Fastify
* Prisma
* Baileys
* HTTP
* detalhes de banco

## Application

Pode conter:

* use cases
* DTOs
* interfaces
* orquestração de fluxo

Não pode conter:

* Fastify request/reply
* Prisma direto
* engine concreta

## Infrastructure

Pode conter:

* Prisma repositories
* adapters
* providers
* implementações externas
* mappers

## Presentation

Pode conter:

* controllers
* routes
* schemas de validação
* presenters
* handlers HTTP do Fastify

---

# 9. Regra central da mensageria

O sistema não pode depender diretamente do Baileys fora do adapter.

É proibido:

* rota Fastify chamar Baileys
* controller chamar Baileys
* use case usar tipo interno do Baileys
* domínio conhecer evento cru da lib

O Baileys deve ficar isolado em:

```txt
api/src/modules/messaging/infrastructure/engines/baileys/
```

---

# 10. Porta principal do motor

Criar uma interface principal, como `MessagingEngine`, representando apenas capacidades de produto.

## Capacidades essenciais

* iniciar sessão
* conectar
* desconectar
* obter status
* enviar texto
* enviar mídia
* receber mensagem
* receber QR
* receber pairing code
* logout
* reconectar

## Exemplo conceitual

```ts
export interface MessagingEngine {
  createSession(input: CreateSessionInput): Promise<void>;
  connectSession(sessionId: string): Promise<ConnectSessionResult>;
  disconnectSession(sessionId: string): Promise<void>;
  reconnectSession(sessionId: string): Promise<void>;
  logoutSession(sessionId: string): Promise<void>;
  getSessionStatus(sessionId: string): Promise<MessagingSessionStatus>;
  sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult>;
  sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult>;
}
```

---

# 11. Guia de adapters para troca futura de engine

## Regras

Toda engine futura deve ficar atrás da mesma porta principal.

### Adapters esperados

* `BaileysMessagingEngineAdapter`
* `WppConnectMessagingEngineAdapter`
* `WhatsmeowMessagingEngineAdapter`

### O adapter deve

* encapsular a lib
* traduzir eventos
* traduzir erros
* mapear payloads
* impedir vazamento de tipos internos

### O adapter não deve

* conter regra de negócio
* conter autorização
* conter resposta HTTP
* decidir fluxo de produto

### Factory

Criar `MessagingEngineFactory` para permitir troca por config.

---

# 12. Eventos internos padronizados

Criar contrato interno estável.

```ts
export type InternalMessagingEvent =
  | { type: 'SESSION_CREATED'; sessionId: string; tenantId: string }
  | { type: 'SESSION_CONNECTING'; sessionId: string; tenantId: string }
  | { type: 'SESSION_CONNECTED'; sessionId: string; tenantId: string }
  | { type: 'SESSION_DISCONNECTED'; sessionId: string; tenantId: string; reason?: string }
  | { type: 'SESSION_QR_UPDATED'; sessionId: string; tenantId: string; qrCode: string }
  | { type: 'SESSION_PAIRING_CODE_UPDATED'; sessionId: string; tenantId: string; pairingCode: string }
  | { type: 'MESSAGE_RECEIVED'; sessionId: string; tenantId: string; from: string; body: string; raw?: unknown }
  | { type: 'MESSAGE_SENT'; sessionId: string; tenantId: string; messageId: string }
  | { type: 'MESSAGE_DELIVERED'; sessionId: string; tenantId: string; messageId: string }
  | { type: 'MESSAGE_FAILED'; sessionId: string; tenantId: string; reason: string };
```

## Regras

* o restante do sistema só pode consumir eventos internos
* incluir `tenantId` e `sessionId` quando aplicável
* não depender de payload cru da engine

---

# 13. Tradução de erros

Nunca deixar erro cru da engine subir para a API.

## Traduzir para erros internos

* `SESSION_EXPIRED`
* `PAIRING_FAILED`
* `ENGINE_TEMPORARILY_UNAVAILABLE`
* `RECOVERABLE_CONNECTION_ERROR`
* `SESSION_NOT_FOUND`
* `SESSION_ALREADY_CONNECTED`
* `SESSION_NOT_CONNECTED`
* `MESSAGE_SEND_FAILED`
* `ENGINE_NOT_READY`
* `INVALID_SESSION_STATE`

---

# 14. Regras específicas do Fastify

## Usar Fastify corretamente

* handlers finos
* validação por schema
* plugins bem separados
* decorators apenas quando realmente fizer sentido
* não transformar Fastify em Express disfarçado

## É proibido

* lógica de negócio no handler
* acesso direto ao Prisma em route handler
* montar arquivos gigantes de rotas
* ignorar tipagem do Fastify

## Direção

* rotas por módulo
* controllers/handlers específicos
* validação previsível
* respostas consistentes

---

# 15. Regras específicas do Prisma

## Regras

* Prisma só na infraestrutura
* use case não importa `@prisma/client`
* domain não depende de model Prisma
* controller/handler não acessa Prisma

## Repositórios por domínio

* `PrismaUserRepository`
* `PrismaTenantRepository`
* `PrismaSessionRepository`
* `PrismaMessageRepository`

## Não retornar model Prisma diretamente

Mapear sempre para estruturas internas.

## Multi-tenancy

Toda entidade tenant-aware deve ter `tenantId`.

---

# 16. Convenções de migrations

## Regras

* migrations versionadas e descritivas
* nunca editar migration já aplicada em produção
* usar evolução incremental
* não usar `db push` como fluxo principal
* revisar índices e unicidade em cada mudança relevante

## Exemplos de nomes

* `create-tenants-users-sessions`
* `add-session-auth-state`
* `create-messages-and-contacts`
* `add-flows-and-automation-foundation`
* `create-metrics-events`

---

# 17. Padrão de DTO / Presenter / Repository / Prisma Mapper

## DTO

* entrada e saída explícitas
* não usar entidade como payload HTTP
* não usar model Prisma como DTO

## Presenter

* pertence à presentation
* transforma saída do use case em resposta HTTP
* não contém regra de negócio

## Repository

* contrato de persistência
* implementação na infraestrutura
* não expor Prisma para application

## Prisma Mapper

* converte Prisma ↔ domínio / estrutura interna
* evita mapping espalhado
* exemplos:

  * `PrismaSessionMapper`
  * `PrismaMessageMapper`

---

# 18. Padrão de controllers / handlers

## Devem

* validar entrada
* chamar use case
* usar presenter
* traduzir erro para HTTP

## Não devem

* conter regra de negócio
* acessar Prisma
* acessar engine concreta

---

# 19. Padrão de use cases

## Devem

* representar uma ação de negócio
* ser pequenos e coesos
* depender de interfaces
* ter input/output explícitos

## Não devem

* depender de Fastify
* depender de Prisma direto
* depender de engine concreta

---

# 20. Autenticação e tenant context

## Recursos

* login
* access token
* refresh token
* middleware/auth hook
* tenant context

## Regras

* não consultar senha a cada request
* toda operação tenant-aware deve carregar contexto válido
* tokens devem permitir resolução consistente do contexto

---

# 21. Entidades iniciais esperadas

## Base inicial

* `Tenant`
* `User`
* `UserTenant`
* `Session`
* `SessionAuthState`
* `Message`
* `Contact`
* `Campaign`
* `CampaignMessage`
* `AuditLog`

## Evolução futura

* `Flow`
* `FlowNode`
* `FlowEdge`
* `Automation`
* `Assistant`
* `ConversationMetric`
* `ExecutionMetric`
* `EventLog`

---

# 22. Observabilidade, métricas e operação

A arquitetura deve permitir evolução para métricas em tempo real.

## Medições futuras

* volume de mensagens por tenant
* volume por sessão
* taxa de entrega
* falhas
* tempo de resposta
* gargalos
* throughput por fluxo
* desempenho de chatbot
* desempenho de assistente de IA
* conversões por automação
* métricas por bloco/fluxo

## Operação mínima

* `GET /health`
* logs estruturados
* tratamento global de erros
* config centralizada
* startup resiliente
* shutdown gracioso

---

# 23. Branch / release

## Branches principais

* `main`
* `develop`
* `release/x.y.z`
* `feature/nome-da-feature`
* `fix/nome-do-fix`
* `hotfix/x.y.z`
* `chore/nome`

## Regras

* nunca desenvolver em `main`
* toda feature nasce de branch própria
* release recebe só estabilização
* hotfix sai de `main` e depois volta para `develop`

---

# 24. Convenções de commits

## Formato

```txt
type(scope): descrição curta
```

## Tipos

* `feat`
* `fix`
* `refactor`
* `perf`
* `chore`
* `docs`
* `test`
* `build`
* `ci`

## Exemplos

* `feat(auth): adiciona refresh token`
* `feat(sessions): cria conexão de sessão`
* `fix(metrics): corrige agregação por tenant`

---

# 25. Regras para o Copilot não quebrar a arquitetura

## Proibido

* chamar Prisma em handler/controller
* chamar Baileys fora do adapter
* usar model Prisma em domain
* misturar DTO com entidade
* devolver objeto cru do Prisma no HTTP
* quebrar multi-tenancy
* criar consulta tenant-aware sem `tenantId`
* criar service genérico faz-tudo
* espalhar mapping manual pelo projeto
* colocar lógica forte no componente React
* colocar chamadas Axios direto em qualquer componente sem organização

## Sempre fazer

* respeitar módulos
* usar interfaces quando necessário
* criar use cases explícitos
* criar presenter quando a resposta exigir
* usar repository por domínio
* usar mapper para Prisma ↔ domínio
* manter separação backend/frontend/scripts

---

# 26. Anti-padrões proibidos

## Backend

* microserviços prematuros
* handler gordo
* use case gigante
* repository genérico para tudo
* domínio acoplado a Prisma
* domínio acoplado a Fastify
* domínio acoplado ao Baileys

## Banco

* `db push` como fluxo principal
* editar migration aplicada
* consulta sem filtro de tenant
* salvar tudo em JSON sem necessidade

## Frontend

* componente gigante com regra demais
* chamada HTTP espalhada
* estado global desorganizado
* acoplamento visual com payload cru da API

## Operação

* depender de memória para persistência crítica
* depender de arquivo local para auth state
* ignorar restart/reconexão
* não ter healthcheck
* não ter logging

---

# 27. Convenções de nomenclatura

## Sufixos

* `UseCase`
* `Repository`
* `Adapter`
* `Controller`
* `Mapper`
* `Factory`
* `Presenter`

## Evitar

* `Helper`
* `Manager`
* `CommonService`
* `UtilsService`

---

# 28. Estratégia de construção por fases

## Fase 1 — Base

* Fastify + TypeScript
* Prisma + PostgreSQL
* config centralizada
* estrutura modular
* migrations iniciais
* healthcheck
* tratamento global de erros
* autenticação inicial
* tenant context

## Fase 2 — Sessões

* criação de sessão
* conexão
* persistência de estado
* status
* QR
* pairing code
* logout
* reconexão

## Fase 3 — Mensageria

* envio de texto
* envio de mídia
* recebimento
* persistência
* eventos internos

## Fase 4 — Painel Admin

* autenticação
* gestão de sessões
* listagem de mensagens
* base visual do painel
* integração com API

## Fase 5 — Flows, automações e IA

* base de flows por blocos
* automações
* assistentes
* execução orientada a eventos

## Fase 6 — Métricas e robustez

* retries
* reconexão automática
* auditoria
* coleta de métricas
* dashboards em tempo real

---

# 29. Ordem obrigatória de trabalho

1. propor estrutura inicial do monorepo
2. propor estrutura da `api/`
3. propor schema inicial do Prisma
4. definir contratos/interfaces centrais
5. definir eventos internos
6. definir erros internos
7. criar base da API
8. implementar autenticação e tenant context
9. implementar sessions
10. implementar messaging
11. criar base do panel
12. preparar evolução para flows / automation / assistants / metrics

---

# 30. Regra final

Sempre priorizar:

* clareza
* modularidade
* baixo acoplamento
* multi-tenancy
* evolutividade
* estabilidade operacional
* simplicidade suficiente
* código pronto para produção incremental
* suporte futuro a chatbots, automações, assistentes de IA, builders em blocos e métricas em tempo real