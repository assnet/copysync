# Reações em Mensagens — Decisões de Contexto

Decisões tomadas pelo usuário na fase Specify. Restringem o design.

## D1 — Seletor de emoji: barra rápida + picker completo

Hover na bolha abre barra com 👍 ❤️ 😂 😮 😢 🙏 e um botão `+` que abre o picker completo.

**Implicação**: nova dependência no `app/`. Escolha: **`emoji-picker-react`** — sem CDN de dados
(bundle local), suporta `theme: auto|light|dark` nativamente (atende o requisito de tema),
lazy-load via `React.lazy` para não pesar o bundle inicial do chat.

**Correção 2026-09-24**: os *dados* vêm no bundle, mas as *imagens* não. O `emojiStyle` padrão da
lib é `apple`, que busca cada emoji como imagem num CDN público. Obrigatório passar
`emojiStyle={EmojiStyle.NATIVE}`: sem requisição externa (privacidade, CSP, funciona offline) e o
emoji escolhido é idêntico ao que vai para o WhatsApp e aos chips. Versão verificada: 4.22.2,
peer `react >=16.8` (painel em React 19).

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

**Revisão 2026-09-24**: mantida. Instalar i18n é decisão transversal a todo o painel e está listada
como bloqueio em `.specs/project/STATE.md` ("i18n não existe no painel"). Não entra nesta feature
para não misturar escopos (AGENTS.md §34, commits sem mistura). Condição para a regra continuar
valendo: nenhuma string literal em JSX, chaves semânticas e nenhuma concatenação — frase com
variável é função (`reactorsTooltip(names)`), não template montado no componente.

## Decisões de arquitetura (discricionárias do agente)

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Modelo de dados | Tabela própria `chat_message_reactions` | Reação é 1:N por mensagem, com autor e timestamp próprios; coluna JSON quebraria consulta e unicidade |
| Chave de unicidade | `@@unique([messageId, reactorKey])` | WhatsApp: uma reação por autor por mensagem; `apply` (last-write-wins) torna a ingestão idempotente |
| `reactorKey` NOT NULL | Constante `'self'` para nossas reações; para terceiros, a identidade **crua** do protocolo: `lid:<id>` se o autor veio `@lid`, senão `pn:<dígitos>` | Em Postgres, `NULL` não colide em índice único — nulável quebraria a idempotência. Constante e não `self:<sessionId>`: a conversa pode trocar de sessão e o mesmo autor viraria duas reações. Chave crua e não o telefone resolvido: o mapeamento LID→telefone pode passar a existir entre dois eventos e a chave mudaria, duplicando o autor. O telefone resolvido vai para `reactorPhone`, só exibição. Prefixo evita colisão entre LID e telefone de mesmos dígitos |
| Remoção | **Tombstone** (`emoji = NULL`), não `DELETE` | Sem linha não há `reactedAt` para comparar: remoção atrasada apagaria reação nova, e reação atrasada ressuscitaria reação removida. Com tombstone, set e remoção passam pela mesma regra last-write-wins |
| Escrita concorrente | Transação curta com `pg_advisory_xact_lock` por (mensagem, autor) + decisão em função pura `decideReactionWrite` | Precisa de ordem, atomicidade **e** saber se o estado visível mudou (quem publica no WS). `ON CONFLICT … WHERE` não devolve o anterior, e CTE falha no primeiro insert concorrente (dois "mudou", dois WS). O lock serializa só o par; a regra fica testável sem banco |
| Relógio | Terceiros: `senderTimestampMs` (um relógio por autor). Nossos pelo painel: `now` do servidor fixado no envio, que o eco devolve intacto. Nossos pelo celular: `now` do servidor no recebimento | Gesto `self` tem duas origens; o celular pode estar atrasado. O eco precisa manter o carimbo original, senão com cliques rápidos o eco do gesto antigo sobrescreve o novo |
| Reconhecer o eco | Adapter pré-gera o id da reação, registra num `Set` em memória com TTL e marca `isEcho` na volta | Registrar antes de enviar fecha a corrida (o eco sai de dentro do `sendMessage`); eco e envio são do mesmo processo, memória basta |
| Volume de saída | Painel junta cliques (400 ms parado, ≥ 1 s entre envios da mesma mensagem, só o último vai) + limite na API por mensagem (700 ms, folga para jitter) e por sessão (429), com vaga devolvida se a engine falhar | Cada reação é uma mensagem ao WhatsApp; rajada é sinal de automação. Limite em memória por instância: não é estado crítico |
| Ordem no painel | Agregado leva `reactionsRevision` (maior `updatedAt`, tombstones incluídos); painel aceita só revisão ≥ | Resposta HTTP não tem ordem garantida entre requisições; sem revisão, uma resposta velha desfaria um WS novo |
| Contrato do port | Um método `sendReaction` com `emoji: string \| null` | `null` = remover; espelha a semântica do protocolo sem inflar o port |
| Payload do WS | Agregado completo da mensagem, não delta | Frontend aplica substituição idempotente; elimina merge incremental e divergência após reconexão |
| Quem publica | Só quem recebe `changed = true` do `apply` (use case ou listener) | Eco e `PUT` chegam em qualquer ordem; um evento WS por gesto |
| Rota | `PUT /chat/messages/:messageId/reaction` | Operação idempotente sobre um sub-recurso singular; `PUT` com `{emoji: null}` remove |
