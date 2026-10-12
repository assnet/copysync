### 📖 Sobre

**CopySync API** — backend do CopySync, plataforma de mensageria, CRM, automação,
assistentes de IA e métricas operacionais em tempo real, conectada ao WhatsApp Web via Baileys.

- Painel: https://copysync.app
- API: https://api.copysync.app
- Documentação OpenAPI: `GET /docs` na API

### Principais recursos

📲 Envio e recebimento de mensagens (texto, imagem, áudio, vídeo, documentos)
👥 Gestão de grupos e contatos
🤖 Chatbots, automações e assistentes de IA
🔗 Integração com sistemas externos
📂 Upload resumível de mídia em partes (`chunkedUpload`)
📡 Eventos em tempo real por WebSocket
🏢 Multi-tenant com contexto por requisição

### Stack

Fastify · TypeScript · Prisma ORM · PostgreSQL · Baileys (isolado em
`src/modules/messaging/infrastructure/engines/baileys/`). Regras de arquitetura em [`../AGENTS.md`](../AGENTS.md).

### Marca

Guia de rebranding e inventário de referências: [`../docs/rebranding-copysync.md`](../docs/rebranding-copysync.md).

### Documentação da biblioteca Baileys

- https://baileys.wiki/docs/intro/
- https://github.com/WhiskeySockets/Baileys/releases

### Matar sessão oculta na porta 3000 (Windows/PowerShell)

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Write-Host "Matando PID $_"; Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
```
