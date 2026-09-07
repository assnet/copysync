# Testes

Runner: **Vitest 5** em `api/` e `app/`. Introduzido junto com a feature de reações
(antes disso o projeto só tinha `tsc --noEmit`).

## Comandos

| Gate | Comando | Quando |
| --- | --- | --- |
| `quick` | `cd api && pnpm test` **ou** `cd app && pnpm test` | Fim de qualquer task que toque um dos apps |
| `full` | `cd api && pnpm typecheck && pnpm test` + `cd app && pnpm typecheck && pnpm test` | Antes de commit e antes de PR |
| `watch` | `pnpm test:watch` | Durante o desenvolvimento |
| `smoke` | Roteiro manual com sessão WhatsApp real conectada | Antes de merge de feature de mensageria |

`pnpm build` da API ignora testes (`tsconfig.build.json` exclui `src/**/*.test.ts`), então nada de
teste vai para `dist/`.

## Convenções

- **Co-locados**: `Arquivo.test.ts` ao lado de `Arquivo.ts`; `Componente.test.tsx` ao lado do componente
- Imports explícitos do Vitest (`import { describe, it, expect } from 'vitest'`) — sem `globals: true`
- Nomes de teste em pt-BR, descrevendo o comportamento do produto, não o nome do método
- `clearMocks`/`restoreMocks` ligados: nenhum teste depende de estado deixado por outro
- Painel: `renderWithTheme` (`app/src/test/renderWithTheme.tsx`) envolve o componente no
  `ThemeProvider` e aceita o modo — todo componente visual deve ter ao menos uma asserção no escuro
- Testing Library: consultar por texto/role/label, nunca por classe CSS ou estrutura interna

## Matriz de cobertura

| Camada | Tipo exigido | Motivo |
| --- | --- | --- |
| `domain/entities`, `domain/contracts` | nenhum | Só tipos e estruturas — o `tsc` já cobre |
| `application/use-cases` | **unit** | Onde mora a regra; dependências entram como dublês (repos, engine) |
| `shared/utils`, funções puras | **unit** | Barato e determinístico |
| `infrastructure/mappers` | **unit** | Tradução Prisma ↔ domínio erra em silêncio |
| `infrastructure/repositories` | nenhum (por ora) | Exigiria banco de teste; validado por smoke |
| `infrastructure/engines/baileys` | **unit** na normalização pura | O adapter inteiro não é testável sem socket, mas a extração/normalização de payload é função pura e já mostrou ser onde o erro se esconde |
| `presentation/routes`, `presenters` | nenhum (por ora) | Precisa de Fastify em pé; validado por smoke |
| `app/` funções puras (`utils.ts`, formatação, agregação) | **unit** | Barato |
| `app/` componentes com lógica visível (chips, barras, listas) | **unit** com Testing Library | Comportamento que o operador vê |
| `app/` páginas (`ChatPage`) | nenhum (por ora) | Estado grande e acoplado a WS/HTTP; validado por smoke |

## Paralelismo

Todos os tipos acima são **parallel-safe**: sem banco, sem porta de rede, sem arquivo compartilhado.
Tasks que só escrevem testes unitários podem manter o marcador `[P]`.

## Dívida conhecida

- Sem teste de integração com Postgres — repositórios Prisma não têm rede de segurança automatizada
- Sem teste de rota (Fastify `inject` seria o caminho natural quando fizer falta)
- `ChatPage` concentra estado demais para ser testável hoje; extrair a redução de estado das mensagens
  para funções puras tornaria testável sem refactor grande
