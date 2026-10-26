# Conexão de sessão (assistente)

"Nova sessão" no painel é um assistente em 4 passos (termo de produto: **sessão**, nunca "instância"):
1. Número do WhatsApp (DDD + número) → `Session.declaredPhone` normalizado `55DDDNÚMERO` (`normalizeBrazilPhone`).
2. Nome da sessão (2–40, rótulo livre) → "Criar e conectar" (`POST /sessions` + `POST /sessions/:id/connect`).
3. Conectar: QR Code com contagem regressiva (reinicia quando o QR muda; a Baileys troca ~a cada 20 s), "Gerar novo
   código" ao expirar, ou **"Prefiro conectar com código"** (pareamento por número).
4. Conectado: número real (`Session.phone`); aviso `phoneMismatch` se for outro número.

O mesmo passo 3 é usado para reconectar uma sessão existente (`ConnectSessionDialog`).

## Onde está

| Camada | Caminho |
| --- | --- |
| Domínio | `api/src/modules/sessions/domain/services/normalizeBrazilPhone.ts` (`normalizeBrazilPhone`, `hasPhoneMismatch`) |
| Use case | `RequestSessionPairingCodeUseCase.ts`, `CreateSessionUseCase.ts` |
| Engine | `IMessagingEngine.requestPairingCode({ sessionId, tenantId, phone })`; Baileys pede `socket.requestPairingCode` no primeiro `qr` |
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
