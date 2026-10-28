/**
 * Setup dos testes de integração: env sintético primeiro (`env.ts` valida no import), depois o banco
 * LOCAL obrigatório. Recusa qualquer host que não seja localhost: `api/.env` aponta para produção e
 * nenhum teste pode alcançá-la por engano.
 */
import './setup';

const url = process.env['INTEGRATION_DATABASE_URL'];
if (!url) {
  throw new Error('INTEGRATION_DATABASE_URL ausente. Suba o banco com scripts/postgres-descartavel.sh start.');
}
const host = new URL(url).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') {
  throw new Error(`INTEGRATION_DATABASE_URL precisa apontar para localhost (recebido: ${host}).`);
}
process.env['DATABASE_URL'] = url;
