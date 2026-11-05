-- T24: logins em andamento (QR/código sem leitura) por worker; não ocupam vaga do teto.
ALTER TABLE "worker_heartbeats" ADD COLUMN "pendingLogins" INTEGER NOT NULL DEFAULT 0;
