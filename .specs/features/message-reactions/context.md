# Reações em Mensagens — Decisões de Contexto

Decisões tomadas pelo usuário na fase Specify. Restringem o design.

## D1 — Seletor de emoji: barra rápida + picker completo

Hover na bolha abre barra com 👍 ❤️ 😂 😮 😢 🙏 e um botão `+` que abre o picker completo.

**Implicação**: nova dependência no `app/`. Escolha: **`emoji-picker-react`** — sem CDN de dados
(bundle local), suporta `theme: auto|light|dark` nativamente (atende o requisito de tema),
lazy-load via `React.lazy` para não pesar o bundle inicial do chat.

**Bônus**: o mesmo componente destrava o botão "Emoji (em breve)" do `MessageComposer.tsx:130` numa
iteração seguinte — o picker é isolado em `EmojiPicker.tsx` reutilizável, fora de `messages/`.

## D2 — Sem reações de histórico/backfill

Só reações recebidas em tempo real (evento `messages.reaction` com a sessão conectada).
`IngestHistorySyncUseCase` **não** é tocado.

**Implicação**: reação para mensagem inexistente é descartada com log `debug`, não enfileirada.
Se no futuro entrar backfill, o ponto de extensão é o mesmo `IngestMessageReactionUseCase`.

## D3 — Strings centralizadas, sem instalar i18n agora

O `app/` não tem lib de i18n. Criar `app/src/features/chat/strings.ts` com todas as labels da
feature (tooltips, `aria-label`, itens de menu, mensagens de erro). Componentes importam de lá —
nenhuma string literal em JSX.

**Implicação**: quando o `react-i18next` entrar, a migração é substituir o objeto por `t()` sem
tocar em componente. Débito registrado — a exigência de i18n do AGENTS.md fica parcialmente atendida
(preparado, não implementado).

## Decisões de arquitetura (discricionárias do agente)

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Modelo de dados | Tabela própria `chat_message_reactions` | Reação é 1:N por mensagem, com autor e timestamp próprios; coluna JSON quebraria consulta e unicidade |
| Chave de unicidade | `@@unique([messageId, reactorKey])` | WhatsApp: uma reação por autor por mensagem; upsert torna a ingestão idempotente |
| `reactorKey` NOT NULL | Constante `'self'` para nossas reações, telefone/LID para terceiros | Em Postgres, `NULL` não colide em índice único — nulável quebraria a idempotência. Constante e não `self:<sessionId>`: a conversa pode trocar de sessão e o mesmo autor viraria duas reações |
| Contrato do port | Um método `sendReaction` com `emoji: string \| null` | `null` = remover; espelha a semântica do protocolo sem inflar o port |
| Payload do WS | Agregado completo da mensagem, não delta | Frontend aplica substituição idempotente; elimina merge incremental e divergência após reconexão |
| Rota | `PUT /chat/messages/:messageId/reaction` | Operação idempotente sobre um sub-recurso singular; `PUT` com `{emoji: null}` remove |
