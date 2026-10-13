# AGENTS.md

## Visão geral do projeto

Este projeto é um sistema full-stack organizado em monorepo, com foco em mensageria, CRM, automação, assistentes de IA e métricas operacionais em tempo real.

Sempre interaja utilizando a linguagem Português Brasil, pt-BR.

Documentação da Lib Baileys: https://baileys.wiki/, https://baileys.wiki/docs/category/socket/, https://baileys.wiki/docs/intro/, https://github.com/WhiskeySockets/Baileys/releases

Pode buscar inspiração nos projetos legados em: legado1/ e legado2/

## Marca e domínios

- Produto: **CopySync** (rebranding do WaioPrime; cópia do repositório original).
- Painel: https://copysync.app · API: https://api.copysync.app
- Logo e ícones: `app/public/assets/brand/` (fonte `logo-source.png`; favicon, apple-touch, 192/512). Nome do produto só via `APP_NAME` em `app/src/shared/branding/brand.ts`; logo via `BrandLogo`.
- O banco de produção na Render mantém o nome `waioprime` — **não renomear**.
- Estado do rebranding, pendências por fase e o que não mexer: [`docs/rebranding-copysync.md`](docs/rebranding-copysync.md).
- A marca só aparece em texto exibido, `<title>`, OpenAPI e assets. Nomes de funções, chaves, eventos e rotas descrevem o recurso (white label).
- Funcionalidades, planos/limites e ordem de entrega do produto: [`docs/produto-roadmap.md`](docs/produto-roadmap.md). Feature nova deve caber em um item de lá.
- Escala (lease de sessão, shard, worker × http, filas, servidores): [`docs/arquitetura-escala.md`](docs/arquitetura-escala.md). Nada de estado operacional novo em memória sem equivalente externo previsto lá.

###

## agentbrowser e outras skills estao em .agents/skills

## BANCO DE DADOS (SOMENTE LEITURA)

- ACESSO(SOMENTE LEITURA): postgresql://waiochat_jesus:OkIsmdZTOzi36eqfZHwuME4lMhGAKbVd@dpg-d7oihnqpmmbs73b714s0-a.virginia-postgres.render.com/waioprime?sslmode=require

- NUNCA DEVE ALTERAR DADOS DO BANCO SEM AUTORIZACAO CLARA E PRÉVIA.

### USE MCP's
- Sempre que necessário use o MCP apropriado se facilitar e melhorar a execução das tarefas.

### SUBAGENTS

- Use subagents o máximo possível.

### SEMPRE UTILIZE AS SKILLS COM SUB AGENTS

- use as skills disponiveis em .agents.
- Podes usar o agent browser para verificar se o visual do layout ficou certo.
- copywritten para bons textos.
- ui/ux max para melhores telas.
- Use sempre Tooltip Libraries para melhorar a acessibilidade de forma clean, e moderna.
- Sempre verifique se i18n está coberto em toda implementação verificada e implementada.
- Use agent browser para verificar se o resultado está coerente e profissional como solicitado.

### SEMPRE ATUALIZAR O PACKAGE JSON

- Sempre atualizar o package json e manifest, com a nova versão a cada alteração do projeto, sempre respeitando as normas internacinais de controle de versão.

### TODA NOVA FEATURE E TODA MANUTENÇÃO:

- Deve ser implementada como projeto white label, todos os termos, nomes de funções e etc, devem usar nomes claros dos recursos, evitando no nome do app.
- Deve obrigatóriamente ser compatível com o sistema i18n implantado no projeto.
- Deve obrigatóriamente ser compatível com os modos: sistema, claro e escuro.
- Deve obrigatóriamente ser documentado de forma adequado no projeto, para futuros processos terem conhecimento e saber o que fazer e o que não fazer.
- Deve obrigatóriamente sempre tentar economizar caracteres nos processos, para não travar os terminais e não extrapolar limites de prompts.

### Estrutura principal

- **API REST** em `api/`
  - **Fastify**
  - **TypeScript**
  - **Prisma ORM**
  - **PostgreSQL**
  - preparada para deploy na **Render**

- **Painel Admin** em `app/`
  - **React**
  - **Vite**
  - **Material-UI**
  - **Axios**

- **Scripts utilitários** em `scripts/`
  - **Python**

- **Extensão Chrome** em `extension/` — webpack + TypeScript; doc em [`docs/extensao-navegador.md`](docs/extensao-navegador.md)

### MCP (Cursor — desenvolvimento local)

Integração com Model Context Protocol (Postgres read-only, Stripe, GitHub, Render, Context7). Secrets no **macOS Keychain** — nunca no git.

- **Documentação completa:** [`.cursor/MCP_SETUP.md`](.cursor/MCP_SETUP.md)
- **Config do projeto:** [`.cursor/mcp.json`](.cursor/mcp.json)
- **Instalação dos scripts:** `.cursor/scripts/mcp/install-mcp-scripts.sh`
- **Abrir o IDE com MCP:** `cursor-waioprime` ou `cw` (após cadastrar secrets)

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
- separar responsabilidades entre `api/`, `app/` e `scripts/`
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

### `app/`
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
  app/
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
app/
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
* **recursos de grupo só aparecem em conversa de grupo**: participantes, "Ver todos",
  download automático de mídia e "Sair do grupo" ficam sob `{isGroup && (…)}` em
  `ConversationDetailsPanel`. Conversa de contato não renderiza seção de grupo vazia
* dados sensíveis paginam no servidor: o front envia apenas o cursor assinado, nunca
  `limit`/`offset` — ver `api/src/shared/http/pagination/OpaqueCursor.ts`
* estilos globais injetados por código levam `data-app`, senão o `DomGuardian` os
  remove como injeção de extensão
* upload de arquivo só por `chunkedUpload` (partes de 8 MiB, retomável) — ver
  `docs/chat-midias-anexos.md`

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
* regras puras — quando a regra não pertence a uma entidade específica, fica em
  `domain/services/` como **função pura** (ex.: `chat/domain/services/diffRemoteState.ts`,
  que decide o que muda ao espelhar estado vindo de outro aparelho). Sem classe, sem
  estado, sem dependência: é o que permite testar a regra sem banco. O contrato do
  repositório importa os tipos desse módulo, nunca o contrário

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
* ffmpeg/ffprobe — só na infra do módulo `media`, via `spawn` com array, sem shell

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

Mídia enviada pelo painel é gravada `PENDING` com id externo pré-gerado **antes** do envio
(o eco é reconhecido por esse id) — ver `docs/chat-midias-anexos.md`.

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

## Erros de mídia e upload (`shared/errors/internal/MediaErrors.ts`)

* `MEDIA_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `MEDIA_PROCESSING_FAILED` (422),
  `MEDIA_PROCESSOR_UNAVAILABLE` (503)
* `UPLOAD_NOT_FOUND` (404), `UPLOAD_INCOMPLETE` (409), `UPLOAD_IN_PROGRESS` (409),
  `INSUFFICIENT_STORAGE` (507)

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
* nenhum boot escreve em massa no banco sem flag (`api/.env` aponta para produção) —
  ex.: `MEDIA_PENDING_RECOVERY_ENABLED`, ligada só na Render

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
11. criar base do app
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

---

# 31. Fluxo Git e Versionamento (OBRIGATÓRIO)

## 31.1 Estrutura de Branches

```
feature/* → develop → release/* → main (tag vX.Y.Z)
```

**Regras imutáveis:**

* `main`: apenas código em produção (protegida, nunca desenvolvimento direto)
* `develop`: integração contínua de features
* `feature/*`: desenvolvimento de novas funcionalidades
* `release/*`: preparação e estabilização de versão
* `hotfix/*`: correções urgentes em produção
* `fix/*`: correções pontuais em develop
* `chore/*`: tarefas de manutenção, infra, deps

## 31.2 Workflow de Desenvolvimento

### Feature Development

1. Criar branch: `feature/nome-descritivo` a partir de `develop`
2. Desenvolver: commits atômicos e descritivos
3. Build + verificação: `tsc --noEmit` na `api/` e `app/`
4. PR para develop: código revisado antes do merge
5. Merge: preservar histórico limpo

### Release Process

1. Criar release: `release/vX.Y.Z` a partir de `develop`
2. Estabilização: apenas bugfixes, sem features novas
3. Atualizar versão nos `package.json` de `api/` e `app/` → campo `"version": "X.Y.Z"`
4. Atualizar `CHANGELOG.md` com a seção `[X.Y.Z]`
5. QA final: smoke test completo
6. Merge em `main` via PR → criar TAG `vX.Y.Z`
7. Merge back: `main` → `develop` para sincronizar

### Hotfix

1. Criar hotfix: `hotfix/vX.Y.Z+1` a partir de `main`
2. Corrigir: mudança mínima e cirúrgica
3. Atualizar `package.json` + `CHANGELOG.md`
4. Merge em `main` → TAG `vX.Y.Z+1`
5. Merge back: `main` → `develop`

## 31.3 Versionamento Semântico

Seguir **SemVer** (X.Y.Z):

* **X (Major)**: quebra de compatibilidade, refactor arquitetural, mudança de contrato
* **Y (Minor)**: novas funcionalidades, backward-compatible
* **Z (Patch)**: correções de bugs, melhorias sem impacto funcional

**Versão vive em:**

* `api/package.json` → campo `"version"`
* `app/package.json` → campo `"version"`
* `api/CHANGELOG.md` → seção `[X.Y.Z]`
* TAG Git no `main` → `vX.Y.Z`

**NUNCA:**

* Usar nome de branch como versão (ex: branch `v0.11.0`)
* Versionar sem TAG no `main`
* Criar TAG fora do `main`
* Alterar `package.json` de versão sem atualizar o `CHANGELOG.md`

---

# 32. Documentação de Feature (OBRIGATÓRIO)

Toda `feature/*` significativa DEVE ser documentada no `CHANGELOG.md` antes do merge em `develop`.

## Template de entrada no CHANGELOG

```markdown
## [Unreleased]

### Added / Fixed / Changed / Removed

#### Módulo impactado (api/ ou app/)

- **`NomeDoArquivo.ts`** — descrição objetiva do que foi adicionado/corrigido e por quê
- **`OutroArquivo.tsx`** — idem
```

## Regras

* Toda entrada deve referenciar os arquivos afetados
* Descrever o problema e a solução, não apenas "foi ajustado"
* Entradas de `Added`, `Fixed`, `Changed` e `Removed` são separadas por tipo
* Cada feature deve ter escopo de módulo identificado (`auth`, `sessions`, `messaging`, `chat`, `contacts`, etc.)

---

# 33. Documentação de Release (OBRIGATÓRIO)

Toda `release/vX.Y.Z` DEVE ter sua seção própria no `CHANGELOG.md`.

## Template de seção de release

```markdown
## [X.Y.Z] — YYYY-MM-DD — Título descritivo da release

### Added

#### Backend — [descrição do conjunto de features]

- **`Arquivo.ts`** — o quê e por quê

#### Frontend — [descrição]

- **`Componente.tsx`** — o quê e por quê

### Fixed

- **`Arquivo.ts`** — bug corrigido e causa raiz

### Changed

- **`Arquivo.ts`** — o que mudou e impacto

### Breaking Changes (se houver)

- Descrever claramente qualquer mudança de contrato de API, schema Prisma ou evento interno
- Indicar migração necessária (ex: nova migration Prisma)
```

## Regras

* Seção criada junto com a branch `release/vX.Y.Z`
* Atualizada durante estabilização
* Congelada ao criar a TAG
* Somente features/fixes já em `develop` podem entrar
* Breaking changes documentados com plano de migração

---

# 34. Padrão de Commits

**Formato**: `tipo(escopo): descrição curta`

**Tipos:**

* `feat`: nova funcionalidade
* `fix`: correção de bug
* `refactor`: refatoração sem impacto funcional
* `chore`: tarefas de manutenção (deps, build, infra)
* `docs`: documentação
* `perf`: melhoria de performance
* `test`: testes
* `build`: configuração de build/CI
* `ci`: pipelines e deploy

**Escopos sugeridos:** `auth`, `sessions`, `messaging`, `chat`, `contacts`, `campaigns`, `flows`, `automation`, `assistants`, `metrics`, `app`, `api`, `prisma`, `baileys`

**Exemplos:**

```
feat(chat): adiciona funcionalidade Responder com preview de citação
fix(messaging): corrige crash ao responder mensagem de imagem no Baileys
refactor(sessions): extrai lógica de reconexão para ReconnectSessionUseCase
chore(deps): atualiza @whiskeysockets/baileys para versão X.Y.Z
fix(chat): corrige bloco de resposta sumindo após envio (substituição otimística)
```

**Proibido:**

* `update`, `ajustes`, `fix bug`, `correções diversas`, `WIP`, `teste`
* Commits gigantes que misturam features não relacionadas

---

# 35. Padrão de Pull Requests

**Título**: `[TIPO] Descrição clara do que foi feito`

**Descrição obrigatória:**

```markdown
## O quê

[Descrição do que foi implementado/corrigido]

## Por quê

[Motivo / problema resolvido / issue referenciada]

## Como

[Abordagem técnica resumida: camadas tocadas, padrões usados]

## Impacto

- Módulos: [listar: auth / sessions / messaging / chat / etc.]
- Arquivos principais: [listar]
- Breaking change: [Sim / Não]
- Migration Prisma necessária: [Sim / Não]
- Restart da API necessário: [Sim / Não]

## Checklist

- [ ] `tsc --noEmit` sem erros na `api/`
- [ ] `tsc --noEmit` sem erros na `app/`
- [ ] Smoke test manual passou
- [ ] CHANGELOG.md atualizado
- [ ] Multi-tenancy preservado (consultas tenant-aware têm `tenantId`)
- [ ] Nenhum model Prisma exposto fora da infra
- [ ] Nenhuma chamada Baileys fora do adapter
```

---

# 36. Proibições Absolutas de Versionamento e Processo

1. **Merge em `develop`** sem:
   - Build TypeScript passando (`tsc --noEmit`)
   - Smoke test validado
   - CHANGELOG.md atualizado

2. **Merge em `main`** sem:
   - TAG criada
   - Seção de release no CHANGELOG.md completa
   - QA final aprovado

3. **Criar TAG** fora do `main`

4. **Alterar contrato de API** (request/response HTTP, schema Prisma, evento interno) sem:
   - Atualizar emissor E consumidor
   - Documentar no CHANGELOG.md
   - Criar migration Prisma versionada (se banco impactado)

5. **Chamar Baileys fora do adapter** em `api/src/modules/messaging/infrastructure/engines/baileys/`

6. **Chamar Prisma fora da camada de infraestrutura**

7. **Alterar schema Prisma** sem:
   - Criar migration versionada e descritiva (`prisma migrate dev --name descricao`)
   - Jamais editar migration já aplicada em produção

8. **Criar consulta tenant-aware** sem filtro de `tenantId`

9. **Fazer deploy** de versão sem TAG e sem entrada correspondente no CHANGELOG.md