-- Auditoria do Saver. Sozinha na migration: valor novo de enum não pode ser usado na mesma transação.
ALTER TYPE "AuditAction" ADD VALUE 'SAVER_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE 'SAVER_PERMISSION_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'SAVER_PLATFORM_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'SAVER_PLATFORM_EXPORTED';
