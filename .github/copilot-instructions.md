# Copilot Instructions

## Objetivo
Este projeto é um **monorepo full-stack** com:

Responda sempre utilizando a linguagem Português Brasil, pt-BR.
Sempre que possível, forneça exemplos práticos e detalhados para ilustrar suas respostas.
Seja sempre breve, claro e direto ao ponto.
Nunca responda com "como um modelo de linguagem" ou similar.

Documentação da Lib Baileys: https://baileys.wiki/, https://baileys.wiki/docs/category/socket/, https://baileys.wiki/docs/intro/

- **API REST** em `api/`
  - **Fastify**
  - **TypeScript**
  - **Prisma**
  - **PostgreSQL**

- **Painel Admin** em `panel/`
  - **React**
  - **Vite**
  - **Material-UI**
  - **Axios**

- **Scripts utilitários** em `scripts/`
  - **Python**

A plataforma é voltada para:

- mensageria
- CRM
- automação
- campanhas
- chatbots
- assistentes de IA
- fluxos visuais por blocos
- métricas em tempo real

---

## Regras gerais

- manter arquitetura **modular**
- respeitar **multi-tenancy**
- evitar **overengineering**
- não criar microserviços agora
- preservar baixo acoplamento
- preparar o sistema para evolução futura

---

# Backend (`api/`)

## Arquitetura obrigatória
Organizar por módulos e camadas:

```txt
src/
  app/
  modules/
  shared/
prisma/
````

Cada módulo deve seguir, sempre que possível:

```txt
domain/
application/
infrastructure/
presentation/
```

## Regras do backend

* usar **Fastify** corretamente
* handlers finos
* use cases explícitos
* Prisma apenas na infraestrutura
* Baileys apenas no adapter
* não acoplar domínio a Fastify, Prisma ou Baileys
* toda entidade tenant-aware deve considerar `tenantId`

## Mensageria

A aplicação deve depender de uma interface como `MessagingEngine`, e não da engine concreta.

Capacidades essenciais:

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

Baileys deve ficar isolado em algo como:

```txt
api/src/modules/messaging/infrastructure/engines/baileys/
```

## Eventos internos

Não usar eventos crus da engine fora do adapter.

Usar eventos internos padronizados, por exemplo:

* `SESSION_CREATED`
* `SESSION_CONNECTED`
* `SESSION_DISCONNECTED`
* `SESSION_QR_UPDATED`
* `SESSION_PAIRING_CODE_UPDATED`
* `MESSAGE_RECEIVED`
* `MESSAGE_SENT`
* `MESSAGE_DELIVERED`
* `MESSAGE_FAILED`

Sempre incluir `tenantId` e `sessionId` quando aplicável.

## Erros internos

Nunca deixar erro cru da engine subir para handler/controller.

Traduzir para erros internos como:

* `SESSION_EXPIRED`
* `PAIRING_FAILED`
* `ENGINE_TEMPORARILY_UNAVAILABLE`
* `RECOVERABLE_CONNECTION_ERROR`
* `SESSION_NOT_FOUND`
* `SESSION_ALREADY_CONNECTED`
* `MESSAGE_SEND_FAILED`
* `ENGINE_NOT_READY`

## Prisma

Regras obrigatórias:

* use case não importa `@prisma/client`
* domain não depende de model Prisma
* handler/controller não acessa Prisma
* criar repository por domínio
* usar migrations versionadas
* não usar `db push` como fluxo principal
* não retornar model Prisma direto no HTTP

## Padrões

### DTO

* entrada e saída explícitas
* não usar model Prisma como DTO
* não usar entidade de domínio como payload HTTP direto

### Presenter

* pertence à presentation
* transforma saída do use case em resposta HTTP
* não contém regra de negócio

### Repository

* contrato de persistência
* implementação na infraestrutura
* não expor Prisma para application

### Prisma Mapper

* converter Prisma ↔ domínio / estrutura interna
* evitar mapping espalhado pelo projeto

## Controllers / Handlers

Devem:

* validar entrada
* chamar use case
* usar presenter
* mapear erro para HTTP

Não devem:

* conter regra de negócio
* acessar Prisma
* acessar engine concreta

## Use Cases

Devem:

* representar uma ação de negócio
* ser pequenos e coesos
* depender de interfaces
* ter input/output explícitos

Não devem:

* depender de Fastify
* depender de Prisma direto
* depender da engine concreta

---

# Frontend (`panel/`)

## Stack

* React
* Vite
* Material-UI
* Axios

## Organização recomendada

Organizar por feature:

```txt
src/
  app/
  pages/
  features/
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

* separar por feature
* evitar lógica de negócio pesada em componentes
* centralizar HTTP em services
* usar Axios organizado
* manter consistência visual com Material-UI
* preparar o painel para:

  * gestão de sessões
  * mensagens
  * campanhas
  * flows por blocos
  * automações
  * assistentes
  * métricas e dashboards

## Proibido no painel

* componente gigante com múltiplas responsabilidades
* chamada HTTP espalhada sem padrão
* lógica forte de negócio dentro da UI
* acoplamento à estrutura interna do banco
* acoplamento a payload cru da API

---

# Scripts (`scripts/`)

## Regras

* scripts em Python são auxiliares
* não colocar regra central do produto em scripts
* scripts não substituem a API
* cada script deve ter objetivo claro
* usar scripts para manutenção, importação, exportação, diagnóstico e apoio operacional

---

# Multi-tenancy

Regra obrigatória:

* toda operação tenant-aware deve considerar `tenantId`
* nunca implementar consulta ou mutação tenant-aware sem contexto de tenant válido
* não quebrar isolamento entre tenants

---

# Observabilidade e métricas

A arquitetura deve permitir evolução para:

* métricas em tempo real
* volume de mensagens por tenant
* taxa de entrega
* falhas de envio
* tempo de resposta
* gargalos operacionais
* desempenho por fluxo
* desempenho de chatbot
* desempenho de assistente de IA
* dashboards operacionais

Implementar desde cedo:

* `GET /health`
* logs estruturados
* tratamento global de erros
* config centralizada
* startup resiliente
* shutdown gracioso

---

# Branch / release

## Branches

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
* release recebe apenas estabilização
* hotfix sai de `main` e volta para `develop`

---

# Commits

Formato:

```txt
type(scope): descrição curta
```

Tipos:

* `feat`
* `fix`
* `refactor`
* `perf`
* `chore`
* `docs`
* `test`
* `build`
* `ci`

Exemplos:

* `feat(auth): adiciona refresh token`
* `feat(sessions): cria conexão de sessão`
* `fix(metrics): corrige agregação por tenant`

Evitar commits vagos como:

* `update`
* `ajustes`
* `mudanças`
* `correções diversas`

---

# Regras para o Copilot não quebrar a arquitetura

## Nunca fazer

* chamar Prisma em handler/controller
* chamar Baileys fora do adapter
* usar model Prisma em domain
* misturar DTO com entidade
* devolver objeto cru do Prisma no HTTP
* criar consulta tenant-aware sem `tenantId`
* criar service genérico faz-tudo
* espalhar mapping manual pelo projeto
* colocar lógica forte no componente React
* colocar chamadas Axios aleatórias em qualquer componente

## Sempre fazer

* respeitar módulos
* usar interfaces quando necessário
* criar use cases explícitos
* criar presenter quando houver resposta HTTP
* usar repository por domínio
* usar mapper para Prisma ↔ domínio
* manter separação entre `api/`, `panel/` e `scripts/`

---

# Anti-padrões proibidos

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
* editar migration já aplicada
* consulta sem filtro de tenant
* salvar tudo em JSON sem necessidade

## Frontend

* componente gigante
* chamadas HTTP espalhadas
* estado global desorganizado
* lógica demais dentro da UI

## Operação

* depender de memória para persistência crítica
* depender de arquivo local para auth state
* ignorar restart e reconexão
* não ter healthcheck
* não ter logging estruturado

---

# Ordem de implementação

Seguir esta ordem:

1. estrutura inicial do monorepo
2. base da `api/`
3. schema inicial do Prisma
4. contratos/interfaces centrais
5. eventos internos
6. erros internos
7. autenticação e tenant context
8. sessions
9. messaging
10. base do `panel/`
11. evolução para flows / automation / assistants / metrics

---

# Ao gerar código

Sempre:

* respeitar a arquitetura
* manter baixo acoplamento
* preservar multi-tenancy
* evitar overengineering
* gerar código pronto para teste
* explicar rapidamente a função de cada arquivo novo