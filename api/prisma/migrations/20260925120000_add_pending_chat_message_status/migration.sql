-- Status PENDING em mensagens do chat.
-- Mídia enviada pelo painel é gravada antes de chegar ao WhatsApp: o operador vê a bolha na
-- hora e a fila despacha depois. PENDING marca esse intervalo; texto e mensagens recebidas
-- seguem nascendo SENT. O valor vai para o fim do tipo, mesma ordem do schema.prisma.
-- Aditiva: nenhuma linha existente muda de status.

-- AlterEnum
ALTER TYPE "ChatMessageStatus" ADD VALUE 'PENDING';
