-- CreateTable: batimento dos processos worker/all (docs/arquitetura-escala.md §3.1, ADOPT-10)
CREATE TABLE "worker_heartbeats" (
    "workerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "maxSessions" INTEGER NOT NULL,
    "rssMb" INTEGER NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("workerId")
);

-- CreateIndex
CREATE INDEX "worker_heartbeats_seenAt_idx" ON "worker_heartbeats"("seenAt");
