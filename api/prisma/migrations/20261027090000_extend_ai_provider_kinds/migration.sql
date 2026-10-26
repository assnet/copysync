-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiProviderKind" ADD VALUE 'GEMINI';
ALTER TYPE "AiProviderKind" ADD VALUE 'XAI';
ALTER TYPE "AiProviderKind" ADD VALUE 'DEEPSEEK';
ALTER TYPE "AiProviderKind" ADD VALUE 'GROQ';
ALTER TYPE "AiProviderKind" ADD VALUE 'MISTRAL';
ALTER TYPE "AiProviderKind" ADD VALUE 'OPENROUTER';
ALTER TYPE "AiProviderKind" ADD VALUE 'OPENAI_COMPATIBLE';

-- AlterTable
ALTER TABLE "ai_platform_providers" ADD COLUMN     "baseUrl" TEXT;

