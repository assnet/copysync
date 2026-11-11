-- Senha redefinida pelo link do e-mail. Migration própria: ADD VALUE não pode ser usado na transação que o cria.
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET_COMPLETED';
