-- Tentativas de confirmação de senha do usuário logado em ação sensível (docs/seguranca-login.md).
-- A linha é gravada antes do bcrypt (success = false) e conta no teto de 5 falhas em 15 min.
CREATE TABLE "password_confirmation_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_confirmation_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "password_confirmation_attempts_userId_createdAt_idx" ON "password_confirmation_attempts"("userId", "createdAt");

ALTER TABLE "password_confirmation_attempts" ADD CONSTRAINT "password_confirmation_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
