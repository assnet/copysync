# Mensagens interativas (botões, listas, enquetes) — análise e plano

Estado: **plano, nada implementado** (2026-10-28). Recurso transversal: gerador de ofertas (roadmap 8),
monitoramento (roadmap 4) e qualquer módulo futuro que envie mensagem (chatbots, campanhas, assistentes).
Termo de produto: **ações da mensagem** (botões). Nomes de código: `interactive`, `InteractiveActions`.

## 1. Fatos verificados

### 1.1 Baileys instalado (`@whiskeysockets/baileys` 7.0.0-rc14)

- `generateWAMessageContent` **não gera** `buttons`, `sections`, `templateButtons`, `listMessage` nem
  `interactiveMessage`. Só `poll`, `product` e `buttonReply` (resposta a botão, não criação).
- PR #956 (ago/2024) removeu todo o envio de botões por pressão legal da Meta. Doc oficial
  (`baileys.wiki/messaging/sending-messages`) documenta só **enquete** (`poll`). Releases 6.7.x e
  7.0.0-rc1…rc14: nenhuma nota sobre botões; rc10 cita `interactiveMessages` como plano futuro.
- O proto continua completo: `proto.Message.InteractiveMessage`, `.NativeFlowMessage`,
  `.NativeFlowButton`, `InteractiveResponseMessage`. E a lib expõe `generateWAMessageFromContent`
  e `relayMessage(jid, msg, { additionalNodes })`: é por aí que a comunidade envia botões.
- Enquete: `sendMessage(jid, { poll: { name, values, selectableCount } })` adiciona sozinha o nó
  `<meta polltype="creation"/>`. Único "botão" com suporte oficial da lib.

### 1.2 Como a comunidade faz botões funcionar (out/2026)

Fontes independentes convergem (whatsmeow PR #1235, wa-js 4.7.0, Evolution 2.4.0-rc1, forks de Baileys):
`interactiveMessage` + `nativeFlowMessage` **sem** wrapper `viewOnceMessage`, enviado por `relayMessage` com
nó `<biz>` forjado em `additionalNodes` imitando o cliente oficial Business:

```ts
import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';

const msg = generateWAMessageFromContent(jid, {
  interactiveMessage: proto.Message.InteractiveMessage.create({
    body: { text: 'Texto da oferta' },
    footer: { text: 'rodapé' },
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons: [
        { name: 'cta_url',     buttonParamsJson: JSON.stringify({ display_text: 'Ver oferta', url, merchant_url: url }) },
        { name: 'cta_copy',    buttonParamsJson: JSON.stringify({ display_text: 'Copiar cupom', copy_code: 'ABC10' }) },
        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Quero mais', id: 'more' }) },
      ],
    }),
  }),
}, { userJid: sock.user!.id, messageId });

await sock.relayMessage(jid, msg.message!, {
  messageId: msg.key.id!,
  additionalNodes: [
    { tag: 'biz', attrs: { actual_actors: '2', host_storage: '2', privacy_mode_ts: String(Math.floor(Date.now() / 1000)) },
      content: [
        { tag: 'interactive', attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] },
        { tag: 'quality_control', attrs: { decision_id: randomHex(20), source_type: 'third_party' },
          content: [{ tag: 'decision_source', attrs: { value: 'df' } }] },
      ] },
    ...(isPrivate ? [{ tag: 'bot', attrs: { biz_bot: '1' } }] : []),
  ],
});
```

Acks medidos (whatsmeow #1235): sem `<biz>` → aceito, **nada renderiza**; `buttonsMessage` legado →
**405**; `<interactive>` sem filho → **479**; shape acima → entrega, renderiza, resposta volta como
`interactiveResponseMessage`. Limites reportados: até 2 CTA; não misturar CTA com `payment_info`.
`single_select` (lista) "só em celular recente"; `listMessage` legado não é interativo em mobile (#2465).
Sobre o "bizmatch" do WPPConnect: o termo não aparece no ecossistema; o que o wa-js 4.7.0 faz é o mesmo nó
`<biz>` acima (inclusive em grupo com sender-key).

### 1.3 Tabela: tipo × funciona × requisito

| Tipo | Android | iOS | Privado | Grupo | Requisito | Confiança |
| --- | --- | --- | --- | --- | --- | --- |
| nativeFlow `cta_url`/`cta_copy`/`quick_reply` | OK (2026) | OK (Evolution rc1) | OK (+`<bot biz_bot=1>`) | OK (wa-js 4.7.0) | `relayMessage` + `<biz>`; sem viewOnce | média |
| nativeFlow `single_select` | só recente | só recente | OK | não confirmado | idem | baixa |
| `listMessage` legado | não | não | — | — | `<biz><list/>` | baixa |
| `buttonsMessage` legado | 405 | 405 | — | — | — | nenhuma |
| `templateMessage` | não | OK 2024 | — | — | nunca com `<biz>` | nenhuma |
| carrossel | contraditório | contraditório | — | — | `<biz>` | baixa |
| **enquete `poll`** | OK | OK | OK | OK | `sendMessage` oficial | **alta** |
| **texto numerado / link** | OK | OK | OK | OK | nenhum | **alta** |

### 1.4 Riscos

- **Durabilidade**: Meta derrubou cada workaround em semanas (2021, 2022, 2023). Shape atual é de ~08/2026.
  Baileys não vai consertar: mantenedores deletaram issue (#2239) e recusaram as outras.
- **Fingerprint**: `quality_control source_type=third_party` identifica o remetente como terceiro. Nenhum
  relato isola ban por botões, mas ninguém mede. Conta Business como remetente: 2023 **não** funcionava.
- **Produto**: se o botão não renderizar, o destinatário vê só o `body` (ou nada em Web/Desktop). Oferta
  sem link visível = oferta perdida. Logo o **link de afiliado continua no texto**, sempre.
- **Dependência do fork**: trocar `@whiskeysockets/baileys` por fork "com botões" herda biz duplicado,
  atraso de release e código não auditado. Descartado.

## 2. Alternativas avaliadas

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| Trocar para fork de Baileys com botões | ❌ | perde rastreio de upstream; forks têm biz duplicado, atraso; mesma fragilidade |
| `buttonsMessage` / `templateMessage` / `listMessage` legados | ❌ | ack 405 / não renderiza; comprovado morto |
| Enviar via API oficial Cloud (templates aprovados) | ❌ agora | produto é número do cliente via Web MD; Cloud exige WABA, template aprovado, custo por conversa. Fica como engine futura |
| Só enquete (`poll`) | ✅ base | oficial, estável, grupo e privado. Serve a "qual oferta?", "quer mais?", "cupom funcionou?" |
| nativeFlow + `<biz>` atrás de flag, com fallback | ✅ opcional | é o único caminho real para botão; isolado no adapter, desligável sem deploy |
| Texto numerado + parser de resposta | ✅ fallback | zero risco; chatbot futuro precisa do parser de qualquer jeito |

Decisão: **porta genérica de ações da mensagem** com três renderizações, escolhidas por capacidade da
sessão/plano: `native` (nativeFlow+biz) → `poll` → `text` (numerado). O caller nunca sabe qual saiu.

## 3. Desenho

### 3.1 Domínio (`messaging/domain`)

```ts
// messaging/domain/value-objects/InteractiveActions.ts
export type InteractiveAction =
  | { kind: 'url';   id: string; label: string; url: string }          // cta_url
  | { kind: 'copy';  id: string; label: string; code: string }         // cta_copy (cupom)
  | { kind: 'reply'; id: string; label: string }                       // quick_reply
  | { kind: 'select'; id: string; label: string; sections: { title: string; rows: { id: string; title: string; description?: string }[] }[] };

export interface InteractiveActions { footer?: string; actions: InteractiveAction[] }  // max 3, max 2 url/copy
export type InteractiveRenderMode = 'native' | 'poll' | 'text';
```

Função pura `domain/services/planInteractiveRender.ts`: dada `InteractiveActions` + capacidades da sessão
(`{ nativeEnabled, isGroup, isPrivateBusinessSender }`) devolve `{ mode, fallbackBody }`. `fallbackBody` é o
texto numerado ("1️⃣ Ver oferta: <url>", "2️⃣ Cupom: ABC10") e a lista de opções da enquete. Testável sem banco.

### 3.2 Porta (`IMessagingEngine`)

Ampliar sem quebrar quem já usa:

```ts
export interface SendTextMessageInput { …; interactive?: InteractiveActions | null }
export interface SendMediaMessageInput { …; interactive?: InteractiveActions | null }   // caption + botões (header image)
export interface SendMessageResult { messageId: string; sentAt: Date; interactiveMode?: InteractiveRenderMode }
export interface SendPollMessageInput { sessionId; tenantId; to; question: string; options: string[]; selectableCount?: 1 }
sendPollMessage(input: SendPollMessageInput): Promise<SendMessageResult>;
```

Regra: `interactive` presente e sessão sem capacidade `native` → o **próprio adapter** cai para `text`
(anexa `fallbackBody` ao corpo). `poll` só quando o caller pede enquete (`sendPollMessage`) ou quando todas
as ações são `reply` (pergunta de escolha): aí a enquete representa fiel.

### 3.3 Adapter Baileys (único lugar com `relayMessage`)

- `engines/baileys/interactive/buildBaileysInteractiveMessage.ts` — monta `interactiveMessage` (body, footer,
  header com imagem já enviada ao WA quando houver mídia) + `nativeFlowMessage.buttons` a partir de
  `InteractiveAction`. Sem `viewOnceMessage`.
- `engines/baileys/interactive/buildBizAdditionalNodes.ts` — nó `<biz>` da §1.2; `<bot biz_bot=1>` só em privado.
  `decision_id` = 20 bytes hex aleatórios por mensagem.
- Envio: `generateWAMessageFromContent` com `messageId` pré-gerado (`createOutboundMessageId`) → registrar em
  `OutboundEchoRegistry` (hoje só mídia; estender para `interactive`) → `relayMessage`. Eco reconhecido pelo id.
- Erro cru → `MESSAGE_SEND_FAILED` com `meta.reason = 'INTERACTIVE_REJECTED'` quando ack 405/479; nesse caso
  o adapter **reenvia em modo `text`** uma vez e devolve `interactiveMode: 'text'`.
- Entrada `extractBaileysMessage`: mapear `interactiveResponseMessage.nativeFlowResponseMessage.paramsJson`
  (`{ id }`), `buttonsResponseMessage`, `listResponseMessage`, `templateButtonReplyMessage` →
  `MESSAGE_RECEIVED` com `msgType: 'INTERACTIVE_REPLY'`, `body = displayText`, novo campo
  `interactiveReply?: { actionId: string; label: string; forMessageId: string }` (contextInfo.stanzaId).
  Hoje tudo isso é descartado em silêncio.
- Enquete: `sendMessage(jid, { poll })`. Votos (`pollUpdateMessage`) exigem `getMessage` devolver a criação:
  guardar `messageSecret` + opções em `ChatMessage.interactive` (§3.4) e estender `getMessage` do adapter
  (hoje só `sentMediaCache`). Decifrar com `getAggregateVotesInPollMessage`. Fica na **fase 3**.

### 3.4 Persistência

- `ChatMessageType` += `INTERACTIVE`, `POLL`, `INTERACTIVE_REPLY`.
- `ChatMessage.interactive Json?` — `{ mode, actions, footer, pollSecret? }` para o painel renderizar e para
  o eco/voto casar. Migration `add-chat-message-interactive`.
- `Offer.interactive Json?` e `GroupMonitorSettings.interactive` (dentro do JSON de settings já existente)
  com o mesmo shape `InteractiveActions` (sem url/cupom resolvidos: template com placeholders `{link}`, `{cupom}`).

### 3.5 Fila e ofertas (`campaigns`)

- `SendOfferMessageInput` += `interactive?: InteractiveActions`. `ChatOfferMessageSender` repassa para
  `SendStoredMediaMessageUseCase`/`SendMessageUseCase` → engine. Nada de Baileys aqui.
- Composição: `OfferTextComposer` continua dono do texto. Novo serviço puro
  `campaigns/domain/services/buildOfferActions.ts` → `[ {url: affiliateUrl, label: 'Ver oferta'}, coupon ? {copy} : null ]`.
  Link fica **também** no texto (`ensureOfferLink`), por causa do fallback.
- Monitoramento: `ProcessPendingCapturedOffersUseCase` monta `interactive` a partir de `GroupMonitorSettings.interactive`
  e enfileira; não muda caminho de envio (mesma `OfferDispatch`).
- Métrica mínima: `OfferDispatch.interactiveMode` (`native|poll|text|null`) para medir quanto renderiza de fato.

### 3.6 Entitlement e flags

- Env `INTERACTIVE_NATIVE_ENABLED` (padrão **false**, liga só na Render) = interruptor global do nó `<biz>`.
  Desligado → tudo vira `text`/`poll`. Primeira defesa quando a Meta patchar.
- Entitlement `INTERACTIVE_ACTIONS_ENABLED` em `entitlementKeys.ts` (booleano; ausente = desligado), presets
  em `planPresets.ts`, exposto ao painel em `limits.interactiveActionsEnabled`. Vitrine em
  `features/plans/catalog.ts` só como texto de marketing.
- Por sessão: `Session.interactiveNativeOptOut` (futuro) para desligar num número que apresentar problema.

### 3.7 Painel (`app/`)

- Bloco **"Ações da mensagem"** em `OfferSendPanel.tsx` (junto de mentionAll/simulateTyping) e em
  `MonitoringSettingsForm.tsx`: `<Switch>` liga/desliga; chips das ações (Ver oferta, Copiar cupom, +1 resposta
  rápida com rótulo editável). Aviso fixo: "Botões dependem do aplicativo de quem recebe; se não aparecerem, a
  mensagem sai com as opções numeradas no texto". Tooltip padrão do projeto.
- `OfferChatPreview.tsx`: renderizar botões no balão; mostrar também a versão fallback (aba "sem botões").
- Chat: `ChatMessage.interactive` renderiza botões recebidos/enviados e `INTERACTIVE_REPLY` como "respondeu: X".
- `strings.ts` por feature (pt-BR), tema claro/escuro/sistema, `usePersistedState` para o rascunho,
  `Blurred` em rótulos que carreguem texto de cliente/produto.

## 4. Fases

| Fase | Entrega | Versão sugerida |
| --- | --- | --- |
| 0 — Spike (1 dia) | script em `scripts/diagnostics/` **não**: Baileys não roda em tsx. Spike dentro do adapter atrás de `INTERACTIVE_NATIVE_ENABLED`, rota interna `POST /messaging/diagnostics/interactive-probe` (admin), envia para número de teste. Medir: Android, iOS, Web, grupo, privado, remetente Business. Resultado vai para §6 | — |
| 1 — Fundação | VO `InteractiveActions`, `planInteractiveRender`, porta ampliada, adapter (envio native + fallback text, eco, `interactiveResponseMessage` na entrada), migration `ChatMessage`, env flag | api minor |
| 2 — Ofertas e monitoramento | `Offer.interactive`, `GroupMonitorSettings.interactive`, `buildOfferActions`, fila, entitlement, painel (config + preview), `interactiveMode` na fila | api+app minor |
| 3 — Enquete | `sendPollMessage`, `pollSecret`, `getMessage` estendido, votos agregados em `MESSAGE_RECEIVED`, uso em monitoramento ("qual oferta quer ver?") | minor |
| 4 — Reuso | chatbots/flows consomem `interactive` + `INTERACTIVE_REPLY` como gatilho de bloco; Telegram engine mapeia para `InlineKeyboard` nativo (sem gambiarra) | roadmap 2 |

Fase 0 é **bloqueante** para a 2: se o nativeFlow não renderizar nos testes, a fase 2 sai só com `text`/`poll`
e o bloco do painel vira "Opções numeradas" (sem promessa de botão).

## 5. O que não fazer

- `relayMessage`, `generateWAMessageFromContent`, `proto.Message.InteractiveMessage` ou nó `<biz>` fora de
  `messaging/infrastructure/engines/baileys/interactive/`.
- Trocar o pacote `@whiskeysockets/baileys` por fork.
- `viewOnceMessage` em volta do `interactiveMessage` (quebra Web/Desktop em 2026).
- Dois nós `<biz>` na mesma stanza (WhatsApp rejeita).
- Tirar o link de afiliado do texto porque "tem botão".
- Ligar `INTERACTIVE_NATIVE_ENABLED` local (`api/.env` = produção) nem por padrão na Render antes da fase 0.
- `buttonsMessage`, `templateMessage`, `listMessage` legados.
- Caller decidir modo de renderização; só o adapter sabe a capacidade da sessão.
- Prometer "botões" na vitrine de planos sem o aviso de dependência do app do destinatário.

## 6. Resultado do spike (preencher na fase 0)

| Cliente | Privado | Grupo | Remetente Business | Observações |
| --- | --- | --- | --- | --- |
| Android | | | | |
| iOS | | | | |
| Web/Desktop | | | | |

## 7. Fontes

- Baileys PR #956 (remoção de botões): https://github.com/WhiskeySockets/Baileys/pull/956
- Baileys releases: https://github.com/WhiskeySockets/Baileys/releases · doc envio: https://baileys.wiki/docs/messaging/sending-messages
- purpshell, "Buttons and lists get deprecated": https://dev.to/purpshell/buttons-and-lists-get-deprecated-by-many-libraries-54h
- whatsmeow PR #1235 (shape do `<biz>`, acks 405/479): https://github.com/tulir/whatsmeow/pull/1235
- wa-js v4.7.0 (native-flow em grupo): https://github.com/wppconnect-team/wa-js/releases/tag/v4.7.0
- Evolution API 2.4.0-rc1 (sem viewOnce): https://github.com/evolution-foundation/evolution-api/releases
- Baileys issue #2465 (lista não renderiza): https://github.com/WhiskeySockets/Baileys/issues/2465
- Forks de referência (não adotar, só ler): https://github.com/itsliaaa/baileys · https://github.com/zqdevelopers/zq_baileys_helper
