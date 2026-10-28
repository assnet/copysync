-- Padrões do monitoramento: janela 06:00–18:00 e 15–40 min entre envios (só linhas novas; configurações salvas não mudam).

-- AlterTable
ALTER TABLE "group_monitor_configs" ALTER COLUMN "windowStartMinute" SET DEFAULT 360,
ALTER COLUMN "windowEndMinute" SET DEFAULT 1080,
ALTER COLUMN "intervalMinSeconds" SET DEFAULT 900,
ALTER COLUMN "intervalMaxSeconds" SET DEFAULT 2400;

