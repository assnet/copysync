-- CreateEnum
CREATE TYPE "OfferImageMode" AS ENUM ('MEDIA', 'LINK_PREVIEW');

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "imageMode" "OfferImageMode" NOT NULL DEFAULT 'MEDIA';

-- AlterTable
ALTER TABLE "group_monitor_configs" ADD COLUMN     "imageMode" "OfferImageMode" NOT NULL DEFAULT 'MEDIA';

