-- Auth state por chave (docs/sessoes-auth-state.md). Aditiva: tabela nova; session_auth_states.statePayload fica (rollback).

-- CreateTable
CREATE TABLE "session_auth_keys" (
    "sessionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_auth_keys_pkey" PRIMARY KEY ("sessionId","key")
);

-- AddForeignKey
ALTER TABLE "session_auth_keys" ADD CONSTRAINT "session_auth_keys_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

