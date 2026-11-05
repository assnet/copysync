/**
 * Setup dos testes de integração só-Redis (`*.redis.int.test.ts`): rodam sem Postgres.
 * Env sintético (`setup.ts`) e `DATABASE_URL` forçada para um localhost inexistente: mesmo com a
 * variável de produção exportada no shell, nenhum teste daqui alcança banco real. Redis só localhost.
 */
import './setup';

process.env['DATABASE_URL'] = 'postgresql://test:test@127.0.0.1:1/redis_only_sem_banco';

const url = process.env['INTEGRATION_REDIS_URL'];
if (url) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`INTEGRATION_REDIS_URL precisa apontar para localhost (recebido: ${host}).`);
  }
}
