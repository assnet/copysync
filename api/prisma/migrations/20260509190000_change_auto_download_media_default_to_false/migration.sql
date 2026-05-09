ALTER TABLE "chat_conversations"
ALTER COLUMN "autoDownloadMedia" SET DEFAULT false;

UPDATE "chat_conversations"
SET "autoDownloadMedia" = false
WHERE "isGroup" = true;