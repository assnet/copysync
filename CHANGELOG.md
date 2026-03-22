# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

### Fixed

#### Infraestrutura — Prisma Client não gerado após `pnpm i`

- **`api/package.json`** — adicionado script `"postinstall": "prisma generate"` para que o Prisma Client seja gerado automaticamente após cada instalação; adicionado campo `"pnpm.onlyBuiltDependencies"` com `@prisma/client`, `@prisma/engines`, `prisma`, `esbuild`, `protobufjs`, `sharp` e `@whiskeysockets/baileys` para que o pnpm execute os build scripts desses pacotes sem exigir confirmação interativa. Resolve o erro `Cannot find module '.prisma/client/default'` ao iniciar pela primeira vez após clonar ou reinstalar dependências.

#### Frontend — Botão Conectar não abria o dialog de QR Code

- **`app/src/features/sessions/components/SessionCard.tsx`** — ao clicar em **Conectar**, após a resposta bem-sucedida de `sessionService.connect()`, agora chama `onRequestQr({ ...session, status: res.status })` para abrir imediatamente o `QrCodeDialog` com o status já atualizado. Anteriormente o usuário precisava clicar manualmente no ícone de QR Code separado para ver o código. O dialog exibe spinner enquanto aguarda o QR (status `CONNECTING`) e o código SVG assim que disponível no ciclo de polling de 4 s.

### Notes

- O QR Code é gerado como **SVG** via `QRCodeSVG` da lib `qrcode.react` (escalável, sem perda de qualidade).

---
