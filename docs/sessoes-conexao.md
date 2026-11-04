# Conexão de sessão (assistente)

"Nova sessão" no painel é um assistente em 4 passos (termo de produto: **sessão**, nunca "instância"):
1. Número do WhatsApp (DDD + número) → `Session.declaredPhone` normalizado `55DDDNÚMERO` (`normalizeBrazilPhone`).
2. Nome da sessão (2–40, rótulo livre) → "Criar e conectar" (`POST /sessions` + `POST /sessions/:id/connect`).
3. Conectar: QR Code com contagem regressiva (reinicia quando o QR muda; a engine troca a cada 2 min, `qrTimeout` no adapter), "Gerar novo
   código" ao expirar, ou **"Prefiro conectar com código"** (pareamento por número).
4. Conectado: número real (`Session.phone`); aviso `phoneMismatch` se for outro número.

O mesmo passo 3 é usado para reconectar uma sessão existente (`ConnectSessionDialog`).

## Onde está

| Camada | Caminho |
| --- | --- |
| Domínio | `api/src/modules/sessions/domain/services/normalizeBrazilPhone.ts` (`normalizeBrazilPhone`, `hasPhoneMismatch`) |
| Use case | `RequestSessionPairingCodeUseCase.ts`, `CreateSessionUseCase.ts` |
| Engine | `IMessagingEngine.requestPairingCode({ sessionId, tenantId, phone })`; Baileys pede `socket.requestPairingCode` no primeiro `qr` |
| Rota | `/settings/sessions` — primeiro item do submenu de Configurações (`SettingsLayout`); `/sessions` só redireciona, mantendo a query. Links novos usam o caminho novo |
| Painel | `app/src/features/sessions/` (`CreateSessionWizard`, `SessionConnectPanel`, `SessionConnectedPanel`, `useSessionConnection`, `utils.ts`, `strings.ts`) |

## API

- `POST /sessions` `{ name, declaredPhone? }` → 422 `SESSION_PHONE_INVALID` (`meta.field`).
- Sessão (`GET /`, `GET /:id`, `/status`) traz `declaredPhone` e `phoneMismatch`.
- `POST /sessions/:id/pairing-code` `{ phone? }` (sem `phone` usa `declaredPhone`) → `{ sessionId, status, pairingCode|null }`;
  o código pode chegar depois: o painel consulta `GET /:id/pairing-code`. Erros: 404, 409 `SESSION_ALREADY_CONNECTED`,
  422 `SESSION_PHONE_INVALID`, 400 `PAIRING_FAILED`. As rotas de sessão respondem **sem** envelope `{ success, data }`.

## Regras e limites

- `phoneMismatch`: só com os dois números; ignora sufixo do JID e trata como igual número com/sem o nono dígito (JID de
  muitos celulares brasileiros vem sem o 9).
- O número pedido para pareamento fica em memória no adapter (`pairingPhones`) até a sessão abrir; restart da API volta
  para QR. Quando os QRs acabam, a reconexão automática pede **código novo**: o painel mostra o que vier no polling.
- Não verificado contra o WhatsApp real: momento do pedido, pareamento com nono dígito, troca QR ↔ código na mesma sessão.

## Telegram (painel) — v0.64.0

A tela `/settings/sessions` tem sessões de **WhatsApp** e **Telegram**, cada canal com limite do plano
(`GET /sessions/limits` → chips "WhatsApp 1/1" / "Telegram 0/1"; `limit null` = ilimitado;
`telegram.enabled=false` = cartão "Indisponível no momento", nunca erro). "Nova sessão" abre o
seletor de canal (`ChannelPickerDialog`); canal no limite abre `PlanLimitBanner` (kinds
`whatsappSessions` / `telegramSessions` em `linkRotation/planUpsell.ts`, limites do catálogo).
`?create=1|whatsapp` abre direto o assistente do WhatsApp (monitoramento/rodízio); `?create=telegram`, o do Telegram.

- Assistente `CreateTelegramSessionWizard`: telefone com DDI (`normalizeInternationalPhone`; sem DDI assume +55)
  → nome → conectar → pronto. Criar **não** chama `/connect` (isso iniciaria o login por QR).
- Passo conectar (`TelegramConnectPanel` + `useTelegramLogin`): padrão **código** — "Enviar código"
  (`POST /:id/telegram/send-code`) → campo de 5 dígitos (`POST /:id/telegram/sign-in`) → senha de duas etapas
  só se vier `AWAITING_PASSWORD` (`POST /:id/telegram/password`). A fase vem do **status** da sessão, então
  reload volta ao ponto certo. "Reenviar" tem cooldown local de 60 s (`CooldownBar` no `serverNow()`);
  `TELEGRAM_FLOOD_WAIT` (`meta.seconds`) vira aviso com contagem. Erros de código/senha ficam inline no campo.
- "Prefiro escanear o QR Code" → `SessionConnectPanel` com `channel="telegram"` (passos
  Configurações › Dispositivos › Conectar dispositivo); QR = string `tg://login?token=…` de `GET /:id/qr`,
  validade 30 s (`TELEGRAM_QR_TTL_MS`), o polling pega o token novo. Voltar ao código: `conn.switchToCode()`.
- `ConnectSessionDialog` (reconectar pelo cartão) usa o mesmo painel: abre em QR (o cartão já chamou
  `connect`/`reconnect`) ou em código quando o status já é `AWAITING_CODE`/`AWAITING_PASSWORD`.
- Estado dos assistentes (passo, telefone, nome, `sessionId`) em `useSessionWizardState` (`usePersistedState`,
  escopo `tab`, chave `sessions.createWizard.<canal>`), limpo ao fechar. Código e senha nunca são persistidos.
- Privacidade: flags `sessions.sessionName`, `sessions.sessionPhone`, `sessions.sessionAvatar`
  (`SessionCard`, `ConnectSessionDialog`, `SessionConnectedPanel`).
- Ícones da feature são Lucide via `AppIcon` (WhatsApp `message-circle`, Telegram `send`).

Pontos ainda não verificados contra a API real: `send-code` a partir de `PENDING` sem `connect` prévio;
troca QR → código com login por QR em andamento (o painel só chama `send-code`); formato exato de `meta.seconds`.
