-- AlterTable
ALTER TABLE "group_monitor_configs" ADD COLUMN     "weekdaysMask" INTEGER NOT NULL DEFAULT 127;

-- AlterTable
ALTER TABLE "offer_generator_configs" ADD COLUMN     "weekdaysMask" INTEGER NOT NULL DEFAULT 127,
ADD COLUMN     "windowEndMinute" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN     "windowStartMinute" INTEGER NOT NULL DEFAULT 0;

