-- AlterEnum: estados do login Telegram (código enviado ao app / senha de duas etapas)
ALTER TYPE "SessionStatus" ADD VALUE 'AWAITING_CODE';
ALTER TYPE "SessionStatus" ADD VALUE 'AWAITING_PASSWORD';
