-- Recuperação de senha (docs/recuperacao-de-senha.md): pedidos e tokens de uso único (só o hash). Aditiva.

-- CreateTable
CREATE TABLE "password_reset_requests" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "userId" TEXT,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_requests_tokenHash_key" ON "password_reset_requests"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_requests_email_createdAt_idx" ON "password_reset_requests"("email", "createdAt");

-- CreateIndex
CREATE INDEX "password_reset_requests_ip_createdAt_idx" ON "password_reset_requests"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "password_reset_requests_userId_idx" ON "password_reset_requests"("userId");

-- AddForeignKey
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
